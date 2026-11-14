# Two distributions over the one server: the Campaign Site and the App. Each app must have its
# own hostname, because the session cookie and OIDC_REDIRECT_URI belong to the App alone.

locals {
  sites = {
    web = { port = local.ports.web, aliases = var.web_aliases, comment = "Tejido Campaign Site" }
    app = { port = local.ports.app, aliases = var.app_aliases, comment = "Tejido App" }
  }
}

# Pages are rendered per request and carry sessions: never cached.
data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

# SvelteKit's fingerprinted assets: cached for as long as CloudFront allows.
data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

# Passes the viewer's Host, cookies and query string, plus CloudFront-Forwarded-Proto. The apps
# rebuild their public URL from those two headers (HOST_HEADER, PROTOCOL_HEADER in the units).
data "aws_cloudfront_origin_request_policy" "all_viewer" {
  name = "Managed-AllViewerAndCloudFrontHeaders-2022-06"
}

resource "aws_cloudfront_distribution" "site" {
  for_each = local.sites

  enabled         = true
  comment         = each.value.comment
  aliases         = each.value.aliases
  is_ipv6_enabled = true
  http_version    = "http2and3"
  price_class     = "PriceClass_100"

  origin {
    origin_id   = "server"
    domain_name = aws_eip.server.public_dns

    # Plain HTTP on this hop: the server has no certificate. See the README, "Known gaps".
    custom_origin_config {
      http_port              = each.value.port
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
      origin_read_timeout    = 60
    }
  }

  default_cache_behavior {
    target_origin_id         = "server"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer.id
    compress                 = true
  }

  ordered_cache_behavior {
    path_pattern           = "/_app/immutable/*"
    target_origin_id       = "server"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = data.aws_cloudfront_cache_policy.optimized.id
    compress               = true
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = length(each.value.aliases) == 0
    acm_certificate_arn            = length(each.value.aliases) == 0 ? null : var.acm_certificate_arn
    ssl_support_method             = length(each.value.aliases) == 0 ? null : "sni-only"
    minimum_protocol_version       = length(each.value.aliases) == 0 ? "TLSv1" : "TLSv1.2_2021"
  }
}
