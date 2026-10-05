resource "random_password" "db" {
  length  = 32
  special = false
}

resource "random_password" "db_app" {
  length  = 32
  special = false
}

resource "random_password" "mq" {
  length  = 32
  special = false
}

resource "random_password" "clickhouse" {
  length  = 32
  special = false
}

resource "random_password" "jwt" {
  length  = 64
  special = false
}

resource "random_password" "revalidate" {
  length  = 48
  special = false
}

resource "random_password" "webhook" {
  length  = 48
  special = false
}

resource "aws_db_subnet_group" "main" {
  name       = local.name
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_parameter_group" "postgres16" {
  name        = "${local.name}-pg16"
  family      = "postgres16"
  description = "PostgreSQL 16 for CIP (pgvector is created by the migrations with CREATE EXTENSION vector)"

  parameter {
    name         = "shared_preload_libraries"
    value        = "pg_stat_statements"
    apply_method = "pending-reboot"
  }

  parameter {
    name  = "log_min_duration_statement"
    value = "500"
  }

  parameter {
    name  = "rds.force_ssl"
    value = "0"
  }

  parameter {
    name         = "max_connections"
    value        = "400"
    apply_method = "pending-reboot"
  }
}

resource "aws_db_instance" "postgres" {
  identifier                   = local.name
  engine                       = "postgres"
  engine_version               = "16"
  instance_class               = var.db_instance_class
  allocated_storage            = var.db_allocated_storage
  max_allocated_storage        = var.db_allocated_storage * 4
  storage_type                 = "gp3"
  storage_encrypted            = true
  db_name                      = "cip"
  username                     = "cip_admin"
  password                     = random_password.db.result
  db_subnet_group_name         = aws_db_subnet_group.main.name
  vpc_security_group_ids       = [aws_security_group.postgres.id]
  parameter_group_name         = aws_db_parameter_group.postgres16.name
  multi_az                     = var.db_multi_az
  backup_retention_period      = 7
  deletion_protection          = var.environment == "prod"
  skip_final_snapshot          = var.environment != "prod"
  final_snapshot_identifier    = var.environment == "prod" ? "${local.name}-final" : null
  performance_insights_enabled = true
  auto_minor_version_upgrade   = true
}

resource "aws_elasticache_subnet_group" "main" {
  name       = local.name
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_elasticache_parameter_group" "redis" {
  name   = "${local.name}-redis7"
  family = "redis7"

  parameter {
    name  = "maxmemory-policy"
    value = "volatile-lru"
  }
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id       = local.name
  description                = "CIP realtime counters, profiles, bandit state, idempotency, rate limits"
  engine                     = "redis"
  engine_version             = "7.1"
  node_type                  = var.redis_node_type
  num_cache_clusters         = 1
  port                       = 6379
  parameter_group_name       = aws_elasticache_parameter_group.redis.name
  subnet_group_name          = aws_elasticache_subnet_group.main.name
  security_group_ids         = [aws_security_group.redis.id]
  at_rest_encryption_enabled = true
  transit_encryption_enabled = false
  automatic_failover_enabled = false
}

resource "aws_mq_broker" "rabbitmq" {
  broker_name                = local.name
  engine_type                = "RabbitMQ"
  engine_version             = var.mq_engine_version
  host_instance_type         = var.mq_instance_type
  deployment_mode            = "SINGLE_INSTANCE"
  publicly_accessible        = false
  subnet_ids                 = [aws_subnet.private[0].id]
  security_groups            = [aws_security_group.mq.id]
  auto_minor_version_upgrade = true

  user {
    username = "cip"
    password = random_password.mq.result
  }

  logs {
    general = true
  }
}

data "aws_ami" "ubuntu_arm" {
  count       = var.clickhouse_mode == "ec2" ? 1 : 0
  most_recent = true
  owners      = ["099720109477"]

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-arm64-server-*"]
  }
}

resource "aws_instance" "clickhouse" {
  count                  = var.clickhouse_mode == "ec2" ? 1 : 0
  ami                    = data.aws_ami.ubuntu_arm[0].id
  instance_type          = var.clickhouse_instance_type
  subnet_id              = aws_subnet.private[0].id
  vpc_security_group_ids = [aws_security_group.clickhouse[0].id]
  iam_instance_profile   = aws_iam_instance_profile.clickhouse[0].name

  root_block_device {
    volume_size = var.clickhouse_volume_gb
    volume_type = "gp3"
    encrypted   = true
  }

  metadata_options {
    http_tokens = "required"
  }

  user_data = templatefile("${path.module}/templates/clickhouse-user-data.sh.tftpl", {
    password = random_password.clickhouse.result
  })

  tags = { Name = "${local.name}-clickhouse" }
}

resource "aws_iam_role" "clickhouse" {
  count = var.clickhouse_mode == "ec2" ? 1 : 0
  name  = "${local.name}-clickhouse"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ec2.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy_attachment" "clickhouse_ssm" {
  count      = var.clickhouse_mode == "ec2" ? 1 : 0
  role       = aws_iam_role.clickhouse[0].name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "clickhouse" {
  count = var.clickhouse_mode == "ec2" ? 1 : 0
  name  = "${local.name}-clickhouse"
  role  = aws_iam_role.clickhouse[0].name
}

resource "aws_s3_bucket" "media" {
  bucket_prefix = "${local.name}-media-"
  force_destroy = var.environment != "prod"
}

resource "aws_s3_bucket_public_access_block" "media" {
  bucket                  = aws_s3_bucket.media.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_secretsmanager_secret" "app" {
  name_prefix = "${local.name}-app-"
  description = "Runtime secrets of the CIP services"
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({
    DATABASE_URL                = "postgres://app_user:${random_password.db_app.result}@${aws_db_instance.postgres.address}:5432/cip"
    DATABASE_SYSTEM_URL         = "postgres://app_system:${random_password.db_app.result}@${aws_db_instance.postgres.address}:5432/cip"
    DATABASE_ADMIN_URL          = "postgres://cip_admin:${random_password.db.result}@${aws_db_instance.postgres.address}:5432/cip"
    RABBITMQ_URL                = "amqps://cip:${random_password.mq.result}@${replace(aws_mq_broker.rabbitmq.instances[0].endpoints[0], "amqps://", "")}/cip"
    CLICKHOUSE_URL              = local.clickhouse_url
    JWT_SECRET                  = random_password.jwt.result
    FAKE_PAYMENT_WEBHOOK_SECRET = random_password.webhook.result
    REVALIDATE_SECRET           = random_password.revalidate.result
  })
}

locals {
  clickhouse_url = var.clickhouse_mode == "ec2" ? "http://default:${random_password.clickhouse.result}@${aws_instance.clickhouse[0].private_ip}:8123" : var.clickhouse_cloud_url
}
