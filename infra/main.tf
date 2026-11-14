# One server runs both apps. They share a SQLite file and an evidence folder on disk
# (see the root README, "Two apps, one system"), so they have to share a machine.
# CloudFront sits in front: one distribution per app, in cloudfront.tf.

locals {
  # The port each app listens on. CloudFront reaches them directly; nothing else can.
  ports = {
    web = 3000
    app = 3001
  }
}

data "aws_caller_identity" "current" {}

# ---------------------------------------------------------------------------------------------
# Network: the default VPC, reachable only from CloudFront
# ---------------------------------------------------------------------------------------------

data "aws_vpc" "default" {
  default = true
}

data "aws_subnet" "server" {
  vpc_id            = data.aws_vpc.default.id
  availability_zone = var.availability_zone
  default_for_az    = true
}

data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_security_group" "server" {
  name_prefix = "${var.name}-server-"
  description = "Tejido server: app ports from CloudFront only. No SSH; use Session Manager."
  vpc_id      = data.aws_vpc.default.id

  lifecycle {
    create_before_destroy = true
  }
}

# One rule covering both ports. The CloudFront prefix list counts as about 55 rules against a
# default quota of 60 per security group, so a second rule referencing it would not fit.
resource "aws_vpc_security_group_ingress_rule" "from_cloudfront" {
  security_group_id = aws_security_group.server.id
  description       = "Both apps, from CloudFront edge servers"
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront.id
  ip_protocol       = "tcp"
  from_port         = min(values(local.ports)...)
  to_port           = max(values(local.ports)...)
}

resource "aws_vpc_security_group_egress_rule" "all" {
  security_group_id = aws_security_group.server.id
  description       = "Qatom, Anthropic, npm, AWS APIs"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

# ---------------------------------------------------------------------------------------------
# Release bundles: infra/deploy.sh uploads here, the server downloads
# ---------------------------------------------------------------------------------------------

resource "aws_s3_bucket" "releases" {
  bucket_prefix = "${var.name}-releases-"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "releases" {
  bucket                  = aws_s3_bucket.releases.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "releases" {
  bucket = aws_s3_bucket.releases.id

  rule {
    id     = "expire-old-releases"
    status = "Enabled"
    filter {}

    expiration {
      days = 14
    }
  }
}

# ---------------------------------------------------------------------------------------------
# The server's identity: Session Manager, its release bundles, its one secret parameter
# ---------------------------------------------------------------------------------------------

data "aws_iam_policy_document" "assume_ec2" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "server" {
  name_prefix        = "${var.name}-server-"
  assume_role_policy = data.aws_iam_policy_document.assume_ec2.json
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.server.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "server" {
  statement {
    sid       = "ReadReleases"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.releases.arn}/*"]
  }

  # The parameter is encrypted with the account's default aws/ssm key, which needs no
  # separate KMS grant.
  statement {
    sid     = "ReadEnvFile"
    actions = ["ssm:GetParameter"]
    resources = [
      "arn:aws:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter/${trimprefix(var.env_parameter_name, "/")}"
    ]
  }
}

resource "aws_iam_role_policy" "server" {
  name   = "releases-and-env"
  role   = aws_iam_role.server.id
  policy = data.aws_iam_policy_document.server.json
}

resource "aws_iam_instance_profile" "server" {
  name_prefix = "${var.name}-server-"
  role        = aws_iam_role.server.name
}

# ---------------------------------------------------------------------------------------------
# The server and its data
# ---------------------------------------------------------------------------------------------

data "aws_ssm_parameter" "al2023" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

# The database and the evidence live on their own volume, so replacing the server keeps them.
resource "aws_ebs_volume" "data" {
  availability_zone = var.availability_zone
  size              = var.data_volume_size_gb
  type              = "gp3"
  encrypted         = true

  tags = {
    Name = "${var.name}-data"
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_instance" "server" {
  ami                    = data.aws_ssm_parameter.al2023.value
  instance_type          = var.instance_type
  subnet_id              = data.aws_subnet.server.id
  vpc_security_group_ids = [aws_security_group.server.id]
  iam_instance_profile   = aws_iam_instance_profile.server.name

  user_data = templatefile("${path.module}/instance/user-data.sh.tftpl", {
    data_volume_serial = replace(aws_ebs_volume.data.id, "-", "")
    web_port           = local.ports.web
    app_port           = local.ports.app
    region             = var.region
    releases_bucket    = aws_s3_bucket.releases.bucket
    env_parameter_name = var.env_parameter_name
    deploy_script      = file("${path.module}/instance/tejido-deploy.sh")
  })

  # The boot script runs once. Changing it replaces the server; the data volume moves across,
  # and the next infra/deploy.sh puts the apps back.
  user_data_replace_on_change = true

  metadata_options {
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  root_block_device {
    volume_type = "gp3"
    volume_size = 20
    encrypted   = true
  }

  tags = {
    Name = "${var.name}-server"
  }

  lifecycle {
    # A newer Amazon Linux image must not replace a running server on an unrelated apply.
    ignore_changes = [ami]
  }
}

resource "aws_volume_attachment" "data" {
  device_name = "/dev/sdf"
  volume_id   = aws_ebs_volume.data.id
  instance_id = aws_instance.server.id
}

# A fixed address, so the CloudFront origin survives a stop and start.
resource "aws_eip" "server" {
  domain   = "vpc"
  instance = aws_instance.server.id

  tags = {
    Name = "${var.name}-server"
  }
}
