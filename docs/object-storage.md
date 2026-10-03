# S3-compatible object storage

Reeva uses one AWS SDK for JavaScript v3 adapter for AWS S3 and S3-compatible
services. The adapter uses Signature Version 4 for `PutObject`, `GetObject`,
`DeleteObject`, and presigned `GetObject` URLs. Uploads and proxied downloads use
Node streams. Reeva stores its SHA-256 and other release checksums in the
database; the SDK is configured not to add optional CRC headers by default,
because compatible services do not all implement the same optional checksum
features.

S3 compatibility is an API contract, not a promise of feature parity. Reeva
uses only the four operations above and does not create buckets or use
vendor-specific features. Check the provider's current operation and signing
support before choosing a service or enabling extra bucket policies/features.

## Configure through `.env`

Copy `.env.example` to `.env`, set `STORAGE_DRIVER=s3`, and fill in the values
for exactly one service. Reeva Compose passes these values to the app container.
For direct deployments, provide the same environment variables to the process,
then run `pnpm db:seed` once after migrations (or after changing the storage
driver). The seeder creates/selects an environment-backed provider without
storing its secrets in the database. Compose runs the idempotent seeders during
startup and reselects it each time.
Leave `STORAGE_DRIVER=database` to keep the default selected in the CMS/database.
When switching an existing installation back from `s3`, select the intended
DB-managed provider as default in the CMS; Reeva does not guess which earlier
default to restore.

The bucket must already exist. Reeva does not call bucket-list or bucket-create
APIs during startup or uploads, so the IAM key only needs object read/write
access to the configured bucket. S3-compatible endpoint URLs must use `http://`
or `https://`, must not contain credentials/query strings, and may include a
reverse-proxy path only if that service supports signing requests through a path
prefix.

```dotenv
STORAGE_DRIVER=s3
S3_ENDPOINT=
S3_REGION=us-east-1
S3_BUCKET=reeva-artifacts
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_SESSION_TOKEN=
S3_FORCE_PATH_STYLE=auto
S3_MAX_ATTEMPTS=3
S3_CONNECTION_TIMEOUT_MS=10000
S3_SOCKET_TIMEOUT_MS=120000
S3_DOWNLOAD_URL_TTL_SECONDS=3600
```

`S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` must be supplied together.
`S3_SESSION_TOKEN` is optional and requires that pair. When the pair is empty,
the AWS SDK default credential provider chain is used (for example, an AWS task
role). `S3_MAX_ATTEMPTS` accepts 1–10. Connection timeout accepts 1–120000 ms
and socket inactivity timeout accepts 1–600000 ms. These are network timeouts,
not a total upload/download deadline; raise the socket timeout on slow links.
Presigned URL lifetime accepts 1–604800 seconds. The current OTA API serves
downloads through Reeva's authenticated
release-eligibility check and stream proxy; it does not send storage credentials
to OTA clients.

The database record created for this provider contains only
`{ "driver": "s3", "configSource": "environment" }`. Credentials, endpoint,
region, and bucket remain in environment variables. Use the same configuration
on every Reeva instance sharing the database, since artifact rows refer to the
provider record rather than copying connection configuration onto each artifact.

## Provider examples

| Service                                 | Example endpoint                                                         | Region                                            | Path style                        |
| --------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------- | --------------------------------- |
| AWS S3                                  | Leave `S3_ENDPOINT` empty                                                | AWS bucket region                                 | `auto` selects virtual-host style |
| MinIO                                   | `http://minio:9000`                                                      | `us-east-1` or configured bucket region           | `true`                            |
| SeaweedFS S3 gateway                    | `http://seaweedfs:8333` (use the address reachable from Reeva)           | `us-east-1` or configured region                  | `true`                            |
| Cloudflare R2                           | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`                          | `auto`                                            | `false` (virtual-host style)      |
| OCI Object Storage (path style)         | `https://<namespace>.compat.objectstorage.<region>.oci.customer-oci.com` | OCI region identifier, for example `us-ashburn-1` | `true`                            |
| OCI Object Storage (virtual-host style) | `https://vhcompat.objectstorage.<region>.oci.customer-oci.com`           | OCI region identifier, for example `us-ashburn-1` | `false`                           |

For endpoint-based services, `auto` selects path-style requests. Set
`S3_FORCE_PATH_STYLE=false` only when the service and endpoint are configured
for virtual-hosted-style buckets and DNS/TLS certificates cover bucket hostnames.
This is especially important for a custom endpoint accessed with an IP address
or a self-signed/local certificate.

OCI S3 access uses an OCI Customer Secret Key access/secret pair. Its endpoint
host must match the selected addressing style. R2 uses its
S3 API token credentials. MinIO and SeaweedFS use credentials configured on
their respective S3 gateways. These provider credentials should have only the
bucket permissions needed by Reeva and must be injected as deployment secrets,
not committed into `.env`.

Legacy DB-managed records using `driver: "minio"` or `driver: "seaweedfs"`
continue to work. Their host/port/SSL and `accessKey`/`secretKey` fields are
normalized by the shared adapter. New deployments should prefer the `.env`
configuration above to keep secrets out of CMS-editable JSON.

## Compatibility boundary

The shared client covers the object operations Reeva needs; it does not certify
all S3 operations or all provider-specific options. Providers can differ in API
subsets, bucket naming, IAM policy, request limits, URL style, and checksum
support. The repository test suite exercises a signed local HTTP S3 contract and
contains an opt-in integration test for a disposable real S3-compatible bucket.
Only the configured endpoint used during a test/deployment has actually been
verified. Passing one S3-compatible service does not establish that OCI, R2,
AWS, MinIO, or every SeaweedFS version behaves identically.

The vendor docs show these differences directly: [R2 uses region `auto` and
documents virtual-hosted presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/),
while [OCI documents separate path-style and virtual-host endpoint
forms](https://docs.oracle.com/en-us/iaas/Content/Object/Tasks/s3compatibleapi.htm).
Review each vendor's current operation support before enabling any feature
beyond Reeva's `PutObject`, `GetObject`, `DeleteObject`, and signed `GetObject`
URL needs.

For any target service, run the integration test against a disposable bucket
before production use:

```sh
REEVA_TEST_S3_ENDPOINT=http://127.0.0.1:9000 \
REEVA_TEST_S3_ACCESS_KEY_ID=reeva-test-access \
REEVA_TEST_S3_SECRET_ACCESS_KEY=reeva-test-secret \
pnpm test
```

The integration test creates a randomly named bucket and deletes the uploaded
test object and bucket. Use only an isolated test service and credentials with
permission to create/delete that test bucket.

## Measure a test endpoint

After `pnpm build`, `pnpm benchmark:s3` can compare a 64 MiB streaming upload and
download at concurrency 1 and 4 (8 samples per concurrency by default). It
reports upload/download p50/p95, throughput derived from p50, and process RSS
baseline/peak/delta per concurrency. Set `S3_BENCH_CONCURRENCIES=1` or `4` to
run a concurrency level in a fresh process. It verifies downloaded bytes with
SHA-256 and deletes each object.
To let the benchmark create and delete a unique bucket on a disposable service,
set `S3_BENCH_CREATE_BUCKET=true`; otherwise set `S3_BENCH_BUCKET` to a dedicated
test bucket. Benchmark results describe that endpoint and machine only, not a
cloud provider in general. Never point this destructive test at a production
bucket.

```sh
S3_BENCH_ENDPOINT=http://127.0.0.1:9000 \
S3_BENCH_ACCESS_KEY_ID=reeva-test-access \
S3_BENCH_SECRET_ACCESS_KEY=reeva-test-secret \
S3_BENCH_CREATE_BUCKET=true \
pnpm benchmark:s3
```
