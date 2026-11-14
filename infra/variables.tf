variable "name" {
  description = "Prefix for every resource name."
  type        = string
  default     = "tejido"
}

variable "region" {
  description = "Region of the server. CloudFront itself is global."
  type        = string
  default     = "us-east-1"
}

variable "availability_zone" {
  description = "Zone of the server and its data volume. Must be in var.region."
  type        = string
  default     = "us-east-1a"
}

variable "instance_type" {
  description = "x86_64 instance type. The server also builds the apps, so keep 2 GB of memory or more."
  type        = string
  default     = "t3.small"
}

variable "data_volume_size_gb" {
  description = "Size of the volume holding the SQLite database and uploaded evidence."
  type        = number
  default     = 20
}

variable "env_parameter_name" {
  description = "SSM SecureString parameter holding the production .env file. Created by hand, never by Terraform, so secrets stay out of state."
  type        = string
  default     = "/tejido/env"
}

variable "web_aliases" {
  description = "Custom hostnames for the Campaign Site. Empty uses the cloudfront.net name."
  type        = list(string)
  default     = []
}

variable "app_aliases" {
  description = "Custom hostnames for the App, e.g. [\"app.tejido.net\"]. Empty uses the cloudfront.net name."
  type        = list(string)
  default     = []
}

variable "acm_certificate_arn" {
  description = "ACM certificate in us-east-1 covering every alias. Required when either alias list is set."
  type        = string
  default     = null

  validation {
    condition     = var.acm_certificate_arn != null || length(concat(var.web_aliases, var.app_aliases)) == 0
    error_message = "Set acm_certificate_arn (a us-east-1 certificate) when web_aliases or app_aliases is set."
  }
}
