# Production domain: Route 53 + ACM

`dryroute.com` is registered at Namecheap but DNS is managed here, in Route
53, so the apex domain can use native ALIAS records pointing at CloudFront
(apex records can't be CNAMEs, and Route 53 ALIAS records are the free,
idiomatic way around that for AWS targets).

This sets up the shared pieces both `infra/frontend-hosting/` (serves
`app.dryroute.com`) and `infra/landing-hosting/` (serves `dryroute.com`)
depend on: the hosted zone and a single ACM certificate covering both names.

## Prerequisites

- AWS CLI configured against the same account used for
  `infra/frontend-hosting/` (`aws sts get-caller-identity` to confirm)
- Access to the Namecheap account that owns `dryroute.com`, to change its
  nameservers

## One-time setup

### 1. Create the Route 53 hosted zone

```bash
aws route53 create-hosted-zone \
  --name dryroute.com \
  --caller-reference "dryroute-com-$(date +%s)" \
  --query 'DelegationSet.NameServers'
```

Note the 4 returned nameserver hostnames (e.g. `ns-123.awsdns-45.com`, ...).

### 2. Point Namecheap at Route 53

In the Namecheap dashboard, open Domain List -> `dryroute.com` -> Manage ->
Nameservers, switch from "Namecheap BasicDNS" to "Custom DNS", and enter the
4 nameservers from step 1. Registration stays at Namecheap; only DNS
resolution moves to Route 53. Propagation is usually well under a few hours
but can take up to 48h.

Verify once it's propagated:

```bash
dig NS dryroute.com +short
```

### 3. Request the ACM certificate (must be `us-east-1` for CloudFront)

```bash
aws acm request-certificate \
  --region us-east-1 \
  --domain-name dryroute.com \
  --subject-alternative-names app.dryroute.com \
  --validation-method DNS \
  --query 'CertificateArn' --output text
```

Note the returned ARN - both `infra/frontend-hosting/cloudfront-distribution.json`
and `infra/landing-hosting/cloudfront-distribution.json` reference it.

### 4. Add the DNS validation records

```bash
aws acm describe-certificate \
  --region us-east-1 \
  --certificate-arn <CERT_ARN> \
  --query 'Certificate.DomainValidationOptions[].ResourceRecord'
```

For each of the two returned records (one per domain name), insert it into
the hosted zone:

```bash
aws route53 change-resource-record-sets \
  --hosted-zone-id <HOSTED_ZONE_ID> \
  --change-batch '{
    "Changes": [{
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "<RECORD_NAME>",
        "Type": "CNAME",
        "TTL": 300,
        "ResourceRecords": [{ "Value": "<RECORD_VALUE>" }]
      }
    }]
  }'
```

Then wait for validation:

```bash
aws acm wait certificate-validated --region us-east-1 --certificate-arn <CERT_ARN>
```

### 5. Point both subdomains at their CloudFront distributions

Only do this after each distribution has its `Aliases` and `ViewerCertificate`
filled in and has been created/updated (see
`infra/landing-hosting/README.md` and `infra/frontend-hosting/README.md`).

For each of `dryroute.com` (-> landing distribution) and `app.dryroute.com`
(-> PWA distribution):

```bash
aws route53 change-resource-record-sets \
  --hosted-zone-id <HOSTED_ZONE_ID> \
  --change-batch '{
    "Changes": [{
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "<dryroute.com or app.dryroute.com>",
        "Type": "A",
        "AliasTarget": {
          "HostedZoneId": "Z2FDTNDATAQYW2",
          "DNSName": "<distribution-domain-name>.cloudfront.net",
          "EvaluateTargetHealth": false
        }
      }
    }]
  }'
```

`Z2FDTNDATAQYW2` is CloudFront's fixed alias hosted zone ID (same for every
CloudFront distribution, in every region). Repeat with `Type: AAAA` for IPv6
if the distributions have IPv6 enabled (the default).

## Verifying

- `dig dryroute.com +short` and `dig app.dryroute.com +short` resolve
- `https://dryroute.com` and `https://app.dryroute.com` load over HTTPS with
  a valid cert (no browser warning)
