locals {
  public_services = { for k, v in var.services : k => v if v.host != null }
  secret_keys = [
    "DATABASE_URL",
    "DATABASE_SYSTEM_URL",
    "DATABASE_ADMIN_URL",
    "RABBITMQ_URL",
    "CLICKHOUSE_URL",
    "JWT_SECRET",
    "FAKE_PAYMENT_WEBHOOK_SECRET",
    "REVALIDATE_SECRET",
  ]
  scheme = var.certificate_arn == "" ? "http" : "https"
  common_env = merge(
    {
      NODE_ENV                  = "production"
      LOG_LEVEL                 = "info"
      REDIS_URL                 = "redis://${aws_elasticache_replication_group.redis.primary_endpoint_address}:6379/0"
      CLICKHOUSE_DATABASE       = "cip"
      S3_BUCKET                 = aws_s3_bucket.media.bucket
      S3_REGION                 = var.region
      S3_PUBLIC_URL             = "https://${aws_s3_bucket.media.bucket_regional_domain_name}"
      API_URL                   = "${local.scheme}://api.${var.domain}"
      INTERNAL_API_URL          = "http://api.${local.name}.internal:4100"
      API_INTERNAL_URL          = "http://api.${local.name}.internal:4100"
      ADMIN_URL                 = "${local.scheme}://admin.${var.domain}"
      COLLECTOR_PUBLIC_URL      = "${local.scheme}://collect.${var.domain}"
      REALTIME_PUBLIC_URL       = "${local.scheme == "https" ? "wss" : "ws"}://ws.${var.domain}/ws"
      STOREFRONT_URL_TEMPLATE   = "${local.scheme}://{store}.shop.${var.domain}"
      STOREFRONT_REVALIDATE_URL = "http://storefront.${local.name}.internal:4130/api/revalidate"
      COOKIE_SECURE             = var.certificate_arn == "" ? "false" : "true"
      LLM_PROVIDER              = var.llm_provider
      API_HOST                  = "0.0.0.0"
      COLLECTOR_HOST            = "0.0.0.0"
      GATEWAY_HOST              = "0.0.0.0"
    },
    var.otel_exporter_endpoint == "" ? {} : { OTEL_EXPORTER_OTLP_ENDPOINT = var.otel_exporter_endpoint },
  )
}

resource "aws_ecs_cluster" "main" {
  name = local.name

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name       = aws_ecs_cluster.main.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
  }
}

resource "aws_service_discovery_private_dns_namespace" "internal" {
  name = "${local.name}.internal"
  vpc  = aws_vpc.main.id
}

resource "aws_service_discovery_service" "svc" {
  for_each = var.services
  name     = each.key

  dns_config {
    namespace_id   = aws_service_discovery_private_dns_namespace.internal.id
    routing_policy = "MULTIVALUE"

    dns_records {
      ttl  = 10
      type = "A"
    }
  }

  health_check_custom_config {
    failure_threshold = 1
  }
}

resource "aws_cloudwatch_log_group" "svc" {
  for_each          = var.services
  name              = "/ecs/${local.name}/${each.key}"
  retention_in_days = var.log_retention_days
}

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "${local.name}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "execution_secrets" {
  name = "read-app-secret"
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = [aws_secretsmanager_secret.app.arn]
    }]
  })
}

resource "aws_iam_role" "task" {
  name               = "${local.name}-ecs-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy" "task_s3" {
  name = "media-bucket"
  role = aws_iam_role.task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
      Resource = [aws_s3_bucket.media.arn, "${aws_s3_bucket.media.arn}/*"]
    }]
  })
}

resource "aws_ecs_task_definition" "svc" {
  for_each                 = var.services
  family                   = "${local.name}-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = each.value.cpu
  memory                   = each.value.memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([{
    name         = each.key
    image        = "${var.image_registry}-${each.key}:${var.image_tag}"
    essential    = true
    command      = each.value.command
    portMappings = [{ containerPort = each.value.port, protocol = "tcp" }]
    environment = [for k, v in merge(local.common_env, {
      API_PORT           = "4100"
      COLLECTOR_PORT     = "4110"
      GATEWAY_PORT       = "4120"
      STREAM_WORKER_PORT = "4150"
      DOMAIN_WORKER_PORT = "4151"
      PORT               = tostring(each.value.port)
      HOSTNAME           = "0.0.0.0"
    }) : { name = k, value = v }]
    secrets = [for key in local.secret_keys : {
      name      = key
      valueFrom = "${aws_secretsmanager_secret.app.arn}:${key}::"
    }]
    healthCheck = {
      command     = ["CMD-SHELL", "wget -qO- http://127.0.0.1:${each.value.port}${each.value.health_path} >/dev/null || exit 1"]
      interval    = 15
      timeout     = 5
      retries     = 4
      startPeriod = 60
    }
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.svc[each.key].name
        awslogs-region        = var.region
        awslogs-stream-prefix = each.key
      }
    }
  }])
}

resource "aws_lb" "main" {
  name               = local.name
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id
  idle_timeout       = 120
}

resource "aws_lb_target_group" "svc" {
  for_each             = local.public_services
  name                 = substr("${local.name}-${each.key}", 0, 32)
  port                 = each.value.port
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = aws_vpc.main.id
  deregistration_delay = 15

  health_check {
    path                = each.value.health_path
    matcher             = "200-399"
    interval            = 15
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  dynamic "stickiness" {
    for_each = each.key == "realtime-gateway" ? [1] : []
    content {
      type    = "lb_cookie"
      enabled = true
    }
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = var.certificate_arn == "" ? "fixed-response" : "redirect"

    dynamic "fixed_response" {
      for_each = var.certificate_arn == "" ? [1] : []
      content {
        content_type = "text/plain"
        message_body = "not found"
        status_code  = "404"
      }
    }

    dynamic "redirect" {
      for_each = var.certificate_arn == "" ? [] : [1]
      content {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }
  }
}

resource "aws_lb_listener" "https" {
  count             = var.certificate_arn == "" ? 0 : 1
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "not found"
      status_code  = "404"
    }
  }
}

resource "aws_lb_listener_rule" "svc" {
  for_each     = local.public_services
  listener_arn = var.certificate_arn == "" ? aws_lb_listener.http.arn : aws_lb_listener.https[0].arn
  priority     = 100 + index(sort(keys(local.public_services)), each.key)

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.svc[each.key].arn
  }

  condition {
    host_header {
      values = ["${each.value.host}.${var.domain}"]
    }
  }
}

resource "aws_ecs_service" "svc" {
  for_each               = var.services
  name                   = each.key
  cluster                = aws_ecs_cluster.main.id
  task_definition        = aws_ecs_task_definition.svc[each.key].arn
  desired_count          = each.value.desired_count
  launch_type            = "FARGATE"
  enable_execute_command = true
  propagate_tags         = "SERVICE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.tasks.id]
    assign_public_ip = false
  }

  service_registries {
    registry_arn = aws_service_discovery_service.svc[each.key].arn
  }

  dynamic "load_balancer" {
    for_each = contains(keys(local.public_services), each.key) ? [1] : []
    content {
      target_group_arn = aws_lb_target_group.svc[each.key].arn
      container_name   = each.key
      container_port   = each.value.port
    }
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  depends_on = [aws_lb_listener.http, aws_lb_listener.https]
}

resource "aws_ecs_task_definition" "migrate" {
  family                   = "${local.name}-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([{
    name        = "migrate"
    image       = "${var.image_registry}-api:${var.image_tag}"
    essential   = true
    command     = ["node", "apps/api/dist/migrate-cli.js"]
    environment = [for k, v in local.common_env : { name = k, value = v }]
    secrets = [for key in local.secret_keys : {
      name      = key
      valueFrom = "${aws_secretsmanager_secret.app.arn}:${key}::"
    }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.svc["api"].name
        awslogs-region        = var.region
        awslogs-stream-prefix = "migrate"
      }
    }
  }])
}
