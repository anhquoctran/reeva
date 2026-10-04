# Object storage

Reeva stores provider configuration in PostgreSQL. Root admins can add and edit
local or S3-compatible providers in **CMS → Storage**, then activate a provider
without restarting Reeva or its Docker container. The new default is read from
the database for each new upload. Existing artifacts keep their recorded
provider, so switching the default does not move old files.

Editing an existing provider's endpoint, bucket, or local path changes where
all artifacts linked to that provider are read from. It does not copy objects.
Before changing those values, preserve the same object keys at the new location
and verify access, or add a separate provider and activate it for new uploads.

## Add an S3-compatible provider

Open **CMS → Storage → Add Provider**, select the driver, and enter the endpoint,
region, bucket, addressing style, and credentials. The bucket must already
exist. Reeva uses AWS SDK for JavaScript v3 Signature Version 4 for `PutObject`,
`GetObject`, `DeleteObject`, and presigned `GetObject` URLs. It does not create
buckets or require bucket-list permission. Leave credentials empty to use the
AWS credential chain where the provider supports it.

Use these common settings as a starting point:

| Service                | Endpoint                                                                 | Region                           | Addressing         |
| ---------------------- | ------------------------------------------------------------------------ | -------------------------------- | ------------------ |
| AWS S3                 | Leave empty                                                              | Bucket region                    | Automatic          |
| MinIO                  | `http://minio:9000`                                                      | `us-east-1` or bucket region     | Path style         |
| SeaweedFS S3 gateway   | `http://seaweedfs:8333`                                                  | `us-east-1` or configured region | Path style         |
| Cloudflare R2          | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`                          | `auto`                           | Virtual-host style |
| OCI path style         | `https://<namespace>.compat.objectstorage.<region>.oci.customer-oci.com` | OCI region                       | Path style         |
| OCI virtual-host style | `https://vhcompat.objectstorage.<region>.oci.customer-oci.com`           | OCI region                       | Virtual-host style |

Endpoint URLs must use HTTP or HTTPS and cannot contain URL credentials, query
strings, or fragments. Use a private endpoint only when Reeva is meant to access
that network service. S3 credential fields are optional as a pair; to rotate a
pair, enter both fields. Blank fields preserve existing credentials. The form
never reads stored secrets back; use its clear checkboxes to remove a key pair
or session token.

## Secret storage and multiple instances

The complete provider config is authenticated-encrypted with AES-256-GCM before
it is written to PostgreSQL. The `APP_KEY` is the encryption key, so every
Reeva instance sharing the database must use the same persistent `APP_KEY`.
Back it up securely. Changing it without first re-encrypting provider rows makes
those configs unreadable. Database backups contain ciphertext; protect the
database and `APP_KEY` as separate secrets.

Provider credentials are not included in model serialization or CMS HTML. Each
application process reads current provider rows from PostgreSQL, so edits and
default-provider changes take effect on subsequent requests across instances.
Requests already in progress can finish with the configuration they started
with. A storage endpoint is intentionally admin-configurable; only trusted root
admins should be allowed to change it.

## Upgrade from environment-backed S3

The first startup with this release migrates legacy environment-backed provider
records into encrypted database config. For that one startup, retain the old
`S3_*` values in the deployment environment so the migration can copy them.
After migration succeeds, remove those values from the deployment configuration
and manage the provider in the CMS. New installs do not need any S3 setting in
`.env`. The Compose entrypoint removes the compatibility values before starting
the application process.

If a legacy environment-backed row exists but its old bucket or credentials are
missing/incomplete, the migration stops with an error rather than silently
changing where existing artifacts are expected to live. Restore the old complete
settings for one startup, verify the database migration, and then edit/activate
the provider in the CMS.

The separate legacy-data import also encrypts storage configs. Supply the same
`APP_KEY` as the destination Reeva instance when running `pnpm db:import`.

## Compatibility and verification

S3 compatibility describes the API operations Reeva calls; it does not promise
full feature parity. Reeva stores release checksums in PostgreSQL and streams
uploads and proxied downloads. SDK optional CRC checksums are disabled because
compatible services do not all implement those headers consistently. The
repository has a signed local S3 contract test and an optional integration test
for an isolated disposable bucket:

```sh
REEVA_TEST_S3_ENDPOINT=http://127.0.0.1:9000 \
REEVA_TEST_S3_ACCESS_KEY_ID=reeva-test-access \
REEVA_TEST_S3_SECRET_ACCESS_KEY=reeva-test-secret \
pnpm test
```

Only the endpoint used in a test or deployment has been verified. Test each
target service and its IAM policy before using it for releases; passing MinIO or
SeaweedFS does not establish identical behavior for OCI, R2, AWS, or every
service version.

After `pnpm build`, `pnpm benchmark:s3` measures a streaming upload/download
against a disposable target. It reports p50/p95 latency, throughput, and process
RSS for the selected workload. Never point its create/delete mode at a
production bucket. The benchmark uses `S3_BENCH_*` variables only; those are
test-tool settings and are unrelated to Reeva's runtime provider configuration.
