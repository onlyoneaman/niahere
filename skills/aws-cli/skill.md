---
name: aws-cli
description: Use this skill for AWS CLI usage, command references, and common workflows (S3, DynamoDB, IAM, STS, SSO, Lambda, CloudWatch, OpenSearch). Trigger this for questions about what `aws` commands do, which subcommands to use, and where to find authoritative docs.
---

# AWS CLI

Use this skill when the user needs practical guidance for the AWS CLI (`aws`) and common service operations.

## Authentication

### Default profile (preferred)
The default profile uses static IAM keys stored in `~/.aws/credentials`. These don't expire.

```bash
aws sts get-caller-identity
```

### SSO profile (fallback)
SSO tokens expire (typically 8-24h). Avoid unless specifically needed.

```bash
# Login (opens browser)
aws sso login --profile PowerUserAccess-592636539130

# Use SSO profile
aws s3 ls --profile PowerUserAccess-592636539130
```

### Auth troubleshooting
- `InvalidClientTokenId` = keys are wrong or revoked. Check `~/.aws/credentials`.
- `ExpiredToken` = SSO/session token expired. Re-run `aws sso login`.
- Always try default profile first before falling back to SSO.

## Kay.ai account context

- **Account ID**: 592636539130
- **Region**: us-east-1
- **IAM User**: aman

## Common services and commands

### S3

```bash
# List buckets
aws s3 ls

# List objects in bucket
aws s3 ls s3://bucket-name/

# Copy file to/from S3
aws s3 cp file.txt s3://bucket-name/path/
aws s3 cp s3://bucket-name/path/file.txt ./

# Sync directory
aws s3 sync ./local-dir s3://bucket-name/path/

# Presigned URL (1 hour default)
aws s3 presign s3://bucket-name/path/file.txt --expires-in 3600
```

**Kay buckets**: `kay-document-storage-{beta|prod}`, `carrier-appetite-files-{beta|prod}`

### DynamoDB

```bash
# List tables
aws dynamodb list-tables

# Scan table (careful with large tables)
aws dynamodb scan --table-name TableName --max-items 5

# Get item
aws dynamodb get-item --table-name TableName --key '{"pk": {"S": "value"}}'

# Query by partition key
aws dynamodb query --table-name TableName \
  --key-condition-expression "pk = :pk" \
  --expression-attribute-values '{":pk": {"S": "value"}}'

# Put item
aws dynamodb put-item --table-name TableName --item '{"pk": {"S": "value"}, "sk": {"S": "value"}}'

# Update item
aws dynamodb update-item --table-name TableName \
  --key '{"pk": {"S": "value"}}' \
  --update-expression "SET #attr = :val" \
  --expression-attribute-names '{"#attr": "fieldName"}' \
  --expression-attribute-values '{":val": {"S": "newValue"}}'

# Delete item
aws dynamodb delete-item --table-name TableName --key '{"pk": {"S": "value"}}'
```

**Kay tables**: `ChatData-{env}`, `UserData-{env}`, `OutlookData-{env}`, `ProposalConfig-{env}`, `carrier-appetite-guidelines-{env}`

### CloudWatch Logs

```bash
# List log groups
aws logs describe-log-groups --query 'logGroups[].logGroupName'

# Get recent log events
aws logs filter-log-events --log-group-name /aws/lambda/function-name \
  --start-time $(date -d '1 hour ago' +%s000) \
  --limit 50

# Search logs by pattern
aws logs filter-log-events --log-group-name /aws/lambda/function-name \
  --filter-pattern "ERROR"

# Tail logs (live)
aws logs tail /aws/lambda/function-name --follow
```

### Lambda

```bash
# List functions
aws lambda list-functions --query 'Functions[].FunctionName'

# Invoke function
aws lambda invoke --function-name my-function --payload '{"key": "value"}' output.json

# Get function config
aws lambda get-function-configuration --function-name my-function

# View recent invocations
aws lambda list-event-source-mappings --function-name my-function
```

### STS (Security Token Service)

```bash
# Check current identity
aws sts get-caller-identity

# Get temporary credentials (for scripts)
aws sts get-session-token --duration-seconds 3600
```

### IAM

```bash
# List users
aws iam list-users

# List access keys for user
aws iam list-access-keys --user-name aman

# Check key last used
aws iam get-access-key-last-used --access-key-id AKIAXXXXXXXX
```

## Output formatting

```bash
# JSON (default)
aws s3 ls --output json

# Table format
aws dynamodb list-tables --output table

# Text (for scripting)
aws sts get-caller-identity --output text --query 'Account'

# JMESPath queries
aws dynamodb list-tables --query 'TableNames[?contains(@, `ChatData`)]'
```

## Environment variables

```bash
# Override profile
export AWS_PROFILE=PowerUserAccess-592636539130

# Override region
export AWS_DEFAULT_REGION=us-east-1

# Direct credentials (avoid — prefer credentials file)
export AWS_ACCESS_KEY_ID=AKIA...
export AWS_SECRET_ACCESS_KEY=...
```

## Config file locations

- **Credentials**: `~/.aws/credentials` (access keys)
- **Config**: `~/.aws/config` (profiles, region, output format)
- **SSO cache**: `~/.aws/sso/cache/` (SSO tokens, expire periodically)

## Tips

- Always use `--region us-east-1` or set it in config — Kay resources are all in us-east-1.
- Use `--query` with JMESPath to filter output instead of piping through jq.
- Use `--no-paginate` for commands that paginate by default when you want all results.
- Use `--dry-run` where supported (EC2) to test permissions without making changes.
- Never use `--output text` for DynamoDB results — the format loses type information.
