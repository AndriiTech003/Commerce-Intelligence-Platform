# AWS deployment (OpenTofu / Terraform) — optional

Reference infrastructure for running the platform on AWS. It is **validated, never applied** in this repository
(`tofu init -backend=false && tofu validate`). Works with OpenTofu ≥ 1.6 or Terraform ≥ 1.6.

## What it creates

| File | Resources |
|---|---|
| `network.tf` | VPC, 2 public + 2 private subnets, internet gateway, NAT gateway (one, or one per AZ), route tables |
| `security.tf` | Security groups: ALB (80/443 from the internet) → tasks (4100–4199) → Postgres 5432, Redis 6379, Amazon MQ 5671/443, ClickHouse 8123 |
| `data.tf` | RDS PostgreSQL 16 (`postgres16` parameter group, `pg_stat_statements` preloaded; pgvector is a supported RDS extension created by the migrations), ElastiCache Redis 7, Amazon MQ for RabbitMQ (single instance), ClickHouse on EC2 (Ubuntu 24.04 arm64, user data installs the official package, Prometheus endpoint on 9363) **or** ClickHouse Cloud via `clickhouse_cloud_url`, S3 media bucket, Secrets Manager secret with all connection strings and signing secrets |
| `ecs.tf` | ECS cluster (Fargate + Fargate Spot, ARM64), Cloud Map namespace `<name>.internal`, one task definition + service per app (`var.services`), CloudWatch log groups, ALB with host-based routing, target groups, HTTP→HTTPS redirect when a certificate is set, one-off `migrate` task definition |
| `outputs.tf` | ALB DNS name, public URLs, endpoints, secret ARN, migrate task ARN |

Services (`var.services`): `api` (api.<domain>), `collector` (collect.<domain>), `realtime-gateway` (ws.<domain>,
sticky), `storefront` (`*.shop.<domain>` — one subdomain per store), `admin` (admin.<domain>) behind the ALB;
`stream-worker` and `domain-worker` are internal. Images are expected at
`<image_registry>-<service>:<image_tag>` built from `infra/docker/*.Dockerfile`.

## Usage

```sh
cd infra/terraform/aws
tofu init                       # add a backend block (S3 + DynamoDB lock) for real use
tofu plan -var domain=cip.example.com -var certificate_arn=arn:aws:acm:... -var image_tag=v1.0.0
tofu apply                      # not done in this repository
```

After the first apply:

1. Create DNS records (`api`, `collect`, `ws`, `admin`, `*.shop`) pointing at `alb_dns_name`.
2. Bootstrap Postgres once with the admin URL from the secret: roles `app_user` / `app_system` (passwords = the
   `DATABASE_URL` / `DATABASE_SYSTEM_URL` passwords in the secret) and `CREATE EXTENSION vector, citext` — the
   same steps as `scripts/setup-local.mjs`.
3. Create the RabbitMQ vhost `cip` and apply the topology (`node infra/rabbitmq/apply.mjs` against the broker's
   management URL), and run the ClickHouse migrations (`infra/clickhouse/migrate.mjs`) against `clickhouse_endpoint`.
4. Run the `migrate_task_definition` once per release (`aws ecs run-task … --launch-type FARGATE` with the
   private subnets and task security group from the outputs), then deploy the services (new `image_tag`).

## Notes and trade-offs

- Single NAT gateway, single-instance Amazon MQ, single-node ClickHouse and Redis without replicas keep a demo
  around the price of the managed services; flip `single_nat_gateway`, `db_multi_az`, and use a cluster
  deployment of Amazon MQ for production.
- Amazon MQ exposes AMQPS on 5671; the secret already contains an `amqps://` URL.
- Redis transit encryption is off because the services use `redis://`; enable it together with `rediss://`.
- `OTEL_EXPORTER_OTLP_ENDPOINT` is passed when `otel_exporter_endpoint` is set (for example an ADOT collector or
  a Jaeger/Tempo instance in the VPC). Prometheus scraping inside the VPC can target the Cloud Map names
  (`<service>.<name>.internal:<port>/metrics`).
- S3 access uses the task role; set `S3_ENDPOINT`/keys only for non-AWS object storage.
