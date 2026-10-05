output "alb_dns_name" {
  description = "Point api, collect, ws, admin and *.shop records of the domain at this name (CNAME/ALIAS)."
  value       = aws_lb.main.dns_name
}

output "urls" {
  description = "Public URLs once DNS is in place."
  value = {
    api        = "${local.scheme}://api.${var.domain}"
    collector  = "${local.scheme}://collect.${var.domain}"
    realtime   = local.common_env.REALTIME_PUBLIC_URL
    admin      = "${local.scheme}://admin.${var.domain}"
    storefront = local.common_env.STOREFRONT_URL_TEMPLATE
  }
}

output "ecs_cluster" {
  value = aws_ecs_cluster.main.name
}

output "migrate_task_definition" {
  description = "Run once per release: aws ecs run-task --cluster <cluster> --launch-type FARGATE --task-definition <this> --network-configuration ..."
  value       = aws_ecs_task_definition.migrate.arn
}

output "private_subnet_ids" {
  value = aws_subnet.private[*].id
}

output "task_security_group_id" {
  value = aws_security_group.tasks.id
}

output "postgres_endpoint" {
  value = aws_db_instance.postgres.address
}

output "redis_endpoint" {
  value = aws_elasticache_replication_group.redis.primary_endpoint_address
}

output "rabbitmq_endpoints" {
  value = aws_mq_broker.rabbitmq.instances[0].endpoints
}

output "rabbitmq_console_url" {
  value = aws_mq_broker.rabbitmq.instances[0].console_url
}

output "clickhouse_endpoint" {
  value     = local.clickhouse_url
  sensitive = true
}

output "app_secret_arn" {
  description = "Secrets Manager secret with database/broker URLs and signing secrets."
  value       = aws_secretsmanager_secret.app.arn
}

output "media_bucket" {
  value = aws_s3_bucket.media.bucket
}
