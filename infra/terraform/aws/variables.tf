variable "project" {
  type        = string
  default     = "cip"
  description = "Name prefix for every resource."
}

variable "environment" {
  type        = string
  default     = "demo"
  description = "Environment name (demo, staging, prod)."
}

variable "region" {
  type        = string
  default     = "eu-central-1"
  description = "AWS region."
}

variable "vpc_cidr" {
  type        = string
  default     = "10.40.0.0/16"
  description = "CIDR of the VPC; two public and two private /20 subnets are carved from it."
}

variable "az_count" {
  type        = number
  default     = 2
  description = "Number of availability zones (2 minimum for RDS subnet groups and the ALB)."
}

variable "single_nat_gateway" {
  type        = bool
  default     = true
  description = "One NAT gateway for all private subnets (cheaper) instead of one per AZ."
}

variable "domain" {
  type        = string
  default     = "cip.example.com"
  description = "Base domain. Hosts: api.<domain>, collect.<domain>, ws.<domain>, admin.<domain>, <store>.shop.<domain>."
}

variable "certificate_arn" {
  type        = string
  default     = ""
  description = "ACM certificate for *.<domain> and *.shop.<domain>. Empty = HTTP listener only."
}

variable "image_registry" {
  type        = string
  default     = "ghcr.io/ashamrai/commerce-intelligence-platform"
  description = "Registry prefix; images are <registry>-<service>:<image_tag> (see infra/docker/*.Dockerfile)."
}

variable "image_tag" {
  type        = string
  default     = "latest"
  description = "Image tag deployed for every service."
}

variable "services" {
  description = "ECS Fargate services: container port, health path, public host prefix (null = internal), sizes and count."
  type = map(object({
    port          = number
    health_path   = string
    host          = optional(string)
    cpu           = number
    memory        = number
    desired_count = number
    command       = optional(list(string))
  }))
  default = {
    api = {
      port = 4100, health_path = "/health/ready", host = "api", cpu = 512, memory = 1024, desired_count = 2
    }
    collector = {
      port = 4110, health_path = "/health/ready", host = "collect", cpu = 256, memory = 512, desired_count = 2
    }
    realtime-gateway = {
      port = 4120, health_path = "/health/ready", host = "ws", cpu = 256, memory = 512, desired_count = 1
    }
    stream-worker = {
      port = 4150, health_path = "/health/ready", cpu = 512, memory = 1024, desired_count = 1
    }
    domain-worker = {
      port = 4151, health_path = "/health/ready", cpu = 256, memory = 512, desired_count = 1
    }
    storefront = {
      port = 4130, health_path = "/api/revalidate", host = "*.shop", cpu = 512, memory = 1024, desired_count = 2
    }
    admin = {
      port = 4140, health_path = "/login", host = "admin", cpu = 256, memory = 512, desired_count = 1
    }
  }
}

variable "db_instance_class" {
  type        = string
  default     = "db.t4g.medium"
  description = "RDS PostgreSQL 16 instance class."
}

variable "db_allocated_storage" {
  type        = number
  default     = 50
  description = "RDS storage in GiB (gp3, autoscaling up to 4x)."
}

variable "db_multi_az" {
  type        = bool
  default     = false
  description = "Multi-AZ RDS deployment."
}

variable "redis_node_type" {
  type        = string
  default     = "cache.t4g.small"
  description = "ElastiCache Redis node type."
}

variable "mq_instance_type" {
  type        = string
  default     = "mq.m7g.medium"
  description = "Amazon MQ (RabbitMQ) broker instance type."
}

variable "mq_engine_version" {
  type        = string
  default     = "3.13"
  description = "Amazon MQ RabbitMQ engine version."
}

variable "clickhouse_mode" {
  type        = string
  default     = "ec2"
  description = "\"ec2\" runs a single-node ClickHouse on EC2; \"cloud\" uses ClickHouse Cloud (clickhouse_cloud_url)."

  validation {
    condition     = contains(["ec2", "cloud"], var.clickhouse_mode)
    error_message = "clickhouse_mode must be ec2 or cloud."
  }
}

variable "clickhouse_cloud_url" {
  type        = string
  default     = ""
  description = "HTTPS endpoint of a ClickHouse Cloud service (https://<id>.<region>.aws.clickhouse.cloud:8443) when clickhouse_mode = cloud."
}

variable "clickhouse_instance_type" {
  type        = string
  default     = "m7g.large"
  description = "EC2 instance type for self-hosted ClickHouse."
}

variable "clickhouse_volume_gb" {
  type        = number
  default     = 100
  description = "gp3 data volume for ClickHouse."
}

variable "log_retention_days" {
  type        = number
  default     = 14
  description = "CloudWatch log retention."
}

variable "otel_exporter_endpoint" {
  type        = string
  default     = ""
  description = "Optional OTLP/HTTP endpoint (Jaeger/Tempo/collector) passed as OTEL_EXPORTER_OTLP_ENDPOINT."
}

variable "llm_provider" {
  type        = string
  default     = "fake"
  description = "LLM provider used by the API (fake needs no key)."
}
