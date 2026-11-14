variable "account_id" {
  description = "The Cloudflare account everything is created in. Not a secret."
  type        = string
}

variable "web_hostname" {
  description = "Hostname of the Campaign Site and backend. Its zone must be in the account."
  type        = string
  default     = "tejido.net"
}

variable "app_hostname" {
  description = "Hostname of the App. Its zone must be in the account."
  type        = string
  default     = "app.tejido.net"
}
