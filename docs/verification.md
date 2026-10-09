> **Current support:** PostgreSQL only. The PostgreSQL section at the end is the authoritative current verification. SQLite/MySQL results and previous blockers below are historical evidence, superseded by the user-requested PostgreSQL transition. They do not imply current backend support.

# Verification record

## Baseline

- Shell runtime was Node `v22.23.1`, below `package.json`'s Node `>=24.0.0`; project commands used Node `v24.18.0`.
- Repository evidence selects pnpm `11.20.0`; Docker and CI now use the same version and the pnpm lockfile. The pre-existing lockfile edit to `yargs-parser` 22.0.0/removal of its old override was retained.
- TypeScript typecheck passed before changes.
- ESLint failed with 181 errors (165 auto-fixable, 16 requiring edits).
- Test command reported `NO TESTS EXECUTED`; this was not counted as a pass.
- Production build passed before changes.
- The existing Docker image had not been built as part of the original baseline.

## After changes

Commands ran from the repository root with Node `v24.18.0` and pnpm `11.20.0`:

| Check                                                                                                                                                               | Result                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                                                                                                    | Pass, lockfile is up to date                                                                                                                                                                                                                                                            |
| `pnpm audit`                                                                                                                                                        | Passed in the initial audit snapshot; a later registry/advisory check surfaced `braces@3.0.3` GHSA-vfj7-8cjw-p6xm. Current status is nonzero and recorded below; the local depth guard mitigates the known input pattern but does not replace an upstream fixed release.                |
| `pnpm typecheck`                                                                                                                                                    | Pass                                                                                                                                                                                                                                                                                    |
| `pnpm lint`                                                                                                                                                         | Pass                                                                                                                                                                                                                                                                                    |
| `pnpm test`                                                                                                                                                         | Pass, 21 tests with one endpoint integration test skipped when no disposable S3 service is configured; includes software isolation, storage/security regressions, and R2/OCI endpoint-style signing checks                                                                              |
| `pnpm verify:migration-upgrade`                                                                                                                                     | Pass on disposable SQLite: fresh migrations, new migration down/reapply, synthetic legacy user upgrade, user preserved, old remember-me token revoked                                                                                                                                   |
| `pnpm verify:software-migration`                                                                                                                                    | Pass on disposable SQLite: additive product migration down/reapply, legacy `appName` preserved as the `reeva` product name, version `7.8.9` backfilled, non-null software foreign key and foreign-key check passed                                                                      |
| `REEVA_TEST_MYSQL_HOST=127.0.0.1 REEVA_TEST_MYSQL_PORT=13306 REEVA_TEST_MYSQL_USER=root REEVA_TEST_MYSQL_PASSWORD=<temporary password> pnpm verify:migration:mysql` | Pass on disposable MySQL 8.4.11: fresh migrations, additive down/reapply, preserved legacy user, revoked synthetic remember-me token, public-release index and reservation foreign key verified; random schema dropped afterward                                                        |
| `pnpm build`                                                                                                                                                        | Pass, production client assets and server bundle generated                                                                                                                                                                                                                              |
| `pnpm verify:production-smoke`                                                                                                                                      | Pass after a fresh rebuild: temporary SQLite migrations + seed, CSRF form login, seeded root authentication, root Software/Version/Artifact pages, product-scoped invalid API input (`400`), unknown software (`404`), and legacy route input (`400`)                                   |
| Docker Compose verification                                                                                                                                         | Pass: `docker compose config --quiet` and `docker compose build app`; then a temporary Compose project with synthetic environment, fresh SQLite volume, random loopback port, migrations/seed, root login, CMS pages, and legacy API validation; project, container, and volume removed |
| MySQL software-product migration                                                                                                                                    | Pass on disposable MySQL 8.4.11: software migration down/reapply, old version `7.8.9` and legacy product name retained; random schema/container removed afterward                                                                                                                       |
| `docker build -t reeva:multi-software-audit .`                                                                                                                      | Pass using Node 24 and frozen pnpm install                                                                                                                                                                                                                                              |
| Production-container HTTP smoke                                                                                                                                     | Pass after fresh SQLite migrations: scoped invalid check `400`, unknown software `404`, legacy invalid check `400`, unauthenticated `/cms/software` redirects `302`; temporary container removed                                                                                        |
| Conflict-resolution production image smoke (`docker build --tag reeva:conflict-smoke .`, then temporary container)                                                  | Pass: container runs fresh SQLite migrations and seed as the unprivileged `node` user, serves `/login` with Vite assets, authenticates the seeded root account, and renders Software/Version/Artifact CMS pages; container and its writable layer removed                               |

The stream-disconnect regression intentionally logs the simulated stream error through the application's warning logger; the test itself passes and confirms the accepted download count remains one.

The lockfile resolves `stream-json@3.7.0`, above the 3.5.0 fix for [GHSA-528h-pc64-c93x](https://github.com/advisories/GHSA-528h-pc64-c93x) (CVE-2026-71429). The MinIO SDK was removed from the runtime dependency graph when its separate backend was consolidated onto AWS SDK v3; no notification-parser patch remains. `pnpm audit` currently reports `braces@3.0.3` under [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm); the upstream advisory lists no fixed release. Reeva pins a local parser-depth guard at 100 and tests 2,000-level input. Audit status is still nonzero until an official fixed package version can replace the patch.

## Performance measurements

`pnpm benchmark:ota` used a synthetic 64 MiB file, one and four concurrent local storage workers, seven alternating samples per mode, and an isolated SQLite database with 100,000 aligned version/artifact/history rows. The final measurement was run without the test/build jobs running alongside it. These are local microbenchmarks, not production HTTP measurements. The storage comparison isolates copy/hash behavior; it does not include the web server, multipart parser, cloud network, or database transaction.

| Workload                                                                   | Before                                                                                      | After                                                                             | Observation                                                                                                                                                                                                    |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 64 MiB local copy/hash, concurrency 1                                      | Buffer p50/p95 279.54/305.28 ms; 228.94 MiB/s; peak RSS 116.47 MiB                          | Stream + four hashes p50/p95 301.08/378.74 ms; 212.57 MiB/s; peak RSS 110.44 MiB  | Streaming lowered measured peak RSS 5.2% but p50 was 7.7% slower and throughput 7.1% lower in this run; no single-worker speed improvement claimed.                                                            |
| 64 MiB local copy/hash, concurrency 4                                      | Buffer p50/p95 934.75/1127.22 ms; 273.87 MiB/s; peak RSS 309.47 MiB                         | Stream + four hashes p50/p95 990.22/1173.60 ms; 258.53 MiB/s; peak RSS 141.38 MiB | Streaming lowered measured peak RSS 54.3%; p50 was 5.9% slower and throughput 5.6% lower. This synthetic comparison does not capture the multipart parser's full-buffer allocation avoided by the application. |
| OTA update selection, 100,000 candidates                                   | p50/p95 63.451/66.744 ms; all 100,000 rows returned for in-memory scan                      | p50/p95 12.815/14.100 ms; one row returned by SQL filter/limit                    | About 79.8% lower p50 in this synthetic dataset; query is a SQLite approximation of the application query.                                                                                                     |
| Releases count + page                                                      | p50/p95 47.282/50.907 ms; 2 queries; 20 rows                                                | p50/p95 47.788/50.127 ms; 2 queries; 20 rows                                      | The shared eligibility query added about 1.1% p50 in this run; no latency improvement claimed.                                                                                                                 |
| Multi-software update check, 100,000 rows split evenly across two products | Filtered shared eligibility without product scope: p50/p95 12.815/14.100 ms; 1 row returned | Software-scoped query: p50/p95 12.649/15.591 ms; 1 row returned                   | The scoped query stayed within measurement noise of the shared query; the isolation benefit is correctness, not a claimed speedup.                                                                             |
| Multi-software releases count + page                                       | Shared eligibility: p50/p95 47.788/50.127 ms; 2 queries; 20 rows                            | Software-scoped: p50/p95 50.569/51.832 ms; 2 queries; 20 rows                     | About 5.8% higher p50 for the extra product predicate on this in-memory SQLite workload.                                                                                                                       |
| Dashboard hourly chart                                                     | Failed: SQLite reports `no such function: HOUR`                                             | p50/p95 50.083/55.434 ms; 120 grouped rows                                        | New dialect-compatible chart query executes on the same synthetic history table.                                                                                                                               |

The benchmark output is machine-dependent and should be rerun on deployment hardware before making capacity decisions. It does not provide end-to-end upload/download throughput, RSS under a complete server workload, MySQL timings, or a representative customer dataset. The before/after query columns compare synthetic equivalent SQL shapes, not a captured production build before and after deployment.

## Migration, rollback, and runtime limits

- Fresh migration and upgrade checks ran on temporary SQLite and MySQL 8.4.11. The software-product migration's down and reapply paths passed on both; synthetic existing data retained its product display name/version mapping. The wider auth/storage migration checks also preserve an old user, initialize `auth_version=0`, and delete remember-me rows. Generated MySQL schemas and the disposable smoke container were removed.
- The software migration's rollback guard deliberately prevents restoring global version uniqueness if distinct software products share a semantic-version tuple. Reconcile those versions or restore a verified pre-migration backup to roll back after multi-product data has been created.
- Full `migration:reset` on a disposable SQLite database failed in the historical `1774900000001_alter_all_tables_soft_delete` table rebuild while foreign-key checks were enabled. Historical migration files were not rewritten. A real deployment rollback must restore a verified pre-upgrade backup; no existing database was reset or migrated by this audit.
- MySQL migration schema behavior is checked using MySQL 8.4.11 in a disposable service and random temporary schema. The full historical reset path, application query plans, concurrent quota/auth writes, production locking behavior, and upgrade from a production-like MySQL dataset were not checked. Do not infer full MySQL runtime verification from this migration test.
- AWS S3, OCI, R2, live MinIO, SMTP, reverse proxy, production credentials, and cloud IAM were not available. A disposable SeaweedFS S3 gateway integration run is recorded below; this proves only that target image/configuration, not other vendors or versions. MinIO image retrieval was blocked by Docker Hub `access denied` and Quay `unauthorized`, so no MinIO server integration claim is made.
- A crash after writing an object but before database completion can leave an expiring reservation/object. Upload attempts to the same provider retry cleanup; if that provider remains unused or unavailable, storage lifecycle/operator cleanup is still required.
- At the original audit baseline there was no release signing protocol. The follow-up implementation and its verification status are recorded below; no OTA client source is present here, so client-side signature enforcement remains an integration requirement.
- No production deploy, push, or existing/user database change was performed. The MySQL migration check dropped only its randomly named temporary schema; the HTTP smoke container used temporary storage and was removed.

## Default HTTP port change (2026-10-03)

The requested `82905` is outside the valid TCP/UDP port range. Reeva now defaults to `8888`, chosen as the requested feng-shui number beginning with 8. An explicitly configured `PORT` continues to override the default. Docker Compose publishes the configured port on both the host and container; its default mapping is `8888:8888` instead of the previous `80:3333`.

| Check                                         | Result                                                                                                                                                                  |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node 24.18.0 + pnpm 11.20.0: `pnpm typecheck` | Pass                                                                                                                                                                    |
| `pnpm lint`                                   | Pass                                                                                                                                                                    |
| `pnpm test`                                   | Pass, 17 regression tests                                                                                                                                               |
| `pnpm build`                                  | Pass                                                                                                                                                                    |
| `pnpm verify:production-smoke`                | Pass. Runs the built server from an isolated copy without `.env` and without `PORT`; fresh SQLite migration/seed and login/CMS/API smoke succeeded on `127.0.0.1:8888`. |
| `docker compose config --quiet`               | Pass                                                                                                                                                                    |
| Docker Compose production image build         | Pass with Node 24 and frozen pnpm dependencies                                                                                                                          |
| Compose default resolution                    | Pass with Compose interpolation isolated from `.env`; resolved `PORT=8888` and host/container mapping `8888:8888`                                                       |
| Compose runtime smoke                         | Pass after fresh SQLite migrations and seed; `GET /login` returned `200` at `127.0.0.1:8888`. Temporary project, named volume, and override file were removed.          |

No port-specific performance benchmark was run because this configuration change does not alter request handling or data paths; no performance improvement is claimed. There is no database, OTA-client, or API contract change. The externally visible deployment default changes from Compose host port 80/container 3333 to 8888/8888; operators that require a different port must configure `PORT` and set `APP_URL` consistently. No production deployment or push was performed.

## OTA signed release manifests (2026-10-08)

- Added an additive PostgreSQL migration for per-software Ed25519 public keys, artifact signatures, and an opt-in signed-only policy. Existing products default to optional signatures; no existing release is automatically republished or removed.
- Reeva now exposes the exact signed payload bytes with a detached signature and key ID. CMS validates signatures before saving and enabling signed-only publication; metadata edits invalidate the prior signature. The private key remains outside the Reeva server and database.
- Node 24.11.0 / pnpm 11.20.0 typecheck, lint, production build and full regression tests pass; current detailed signer verification is recorded below. Signature regressions exercise signed-only publication, revoked/foreign keys, changed metadata, and malicious provider envelopes.
- The new migration was exercised on disposable fresh and seeded upgrade PostgreSQL databases, including rollback/reapply. No existing deployment database was migrated. No client app is in this repository, so pinned-key verification, download hashing before install and rollback handling still require integration in each OTA client. The manifest protocol does not include TUF-style expiry/freeze detection.

## Docker Compose one-command startup (2026-10-03)

The Compose configuration now has a self-contained SQLite default on the persistent `reeva_storage` volume. The container entrypoint creates a random application key in that volume when `APP_KEY` is unset, applies pending migrations, runs the idempotent base seeders, and then execs the server. Compose binds the app to `0.0.0.0:8888`, restarts it unless stopped, and checks `/login` for health. A root account is created only when both `ADMIN_EMAIL` and `ADMIN_PASSWORD` are configured; startup never installs a known default password. When MySQL is explicitly selected, a reachable MySQL database remains an operator-provided dependency.

| Check                                                                                                                               | Result                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Exact `docker compose up -d --build` in a clean temporary copy with no `.env`, no existing `storage`, and no production credentials | Pass; image built, SQLite migrations and base seeds completed, and `/login` returned `200` on port `8888`  |
| Default APP_KEY persistence across restart                                                                                          | Pass; the key file existed in the named volume and the app served `/login` after a restart                 |
| Repeat startup seed safety                                                                                                          | Pass; synthetic edits to a setting and platform display name remained intact after container restart       |
| Initial CMS administrator with configured credentials                                                                               | Pass; a synthetic admin configured in the temporary `.env` could log in after the same one-command startup |
| Compose healthcheck                                                                                                                 | Pass; container reached `healthy`                                                                          |
| Existing temporary container, network, named volume, and checkout cleanup                                                           | Pass; all removed after verification                                                                       |

The one-command smoke did not use the repository's ignored local `.env`. That file selects MySQL, so its configured database and credentials were deliberately not used; this respects the no-production-credentials constraint. A clean checkout or `.env` configured for SQLite uses the tested self-contained path. No persistent user data was migrated or removed.

## S3-compatible storage (2026-10-03)

This section records the previous environment-backed implementation. It is
historical; the current runtime configuration and verification are in the
2026-10-04 DB-managed provider section below.

`STORAGE_DRIVER=s3` plus `S3_*` variables selects one environment-backed
provider. The DB stores only the provider marker; the seeder validates the
configuration and can be rerun safely. Compose runs the seeder at startup. A
direct deployment must run `pnpm db:seed` after migration and after changing the
storage driver. When switching back to DB-managed storage, choose the desired
default provider in the CMS; the seeder does not guess which prior default to
restore.

| Check                                                                        | Result                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Historical `pnpm verify:s3-env` (superseded by `pnpm verify:storage-config`) | Pass on disposable SQLite with synthetic `.invalid` endpoint/credentials; env provider was the sole default, repeat seeding added no row, and DB config held no secret.                                                                                                                   |
| S3 Compose interpolation                                                     | Pass with a temporary env file and synthetic values; verified endpoint, region, bucket, credential, session-token, retry, connect/socket timeout, path-style, and URL-TTL values reached the container environment.                                                                       |
| Production image with `STORAGE_DRIVER=s3`                                    | Pass after fresh `docker build`; isolated container completed fresh SQLite migration + seeding, returned `/login` `200`, and SQLite contained only the env-provider marker as default. It did not connect to the synthetic `.invalid` S3 endpoint.                                        |
| `docker compose up -d --build` with S3 `.env`                                | Pass in an isolated project with a temporary synthetic `.env`; fresh SQLite migration/seed completed, `/login` returned `200`, path-style/timeouts reached the app, and the DB stored no S3 credentials. Container, volume, and local image were removed.                                 |
| `pnpm test` without S3 endpoint                                              | Pass, 21 passed and 1 integration test skipped.                                                                                                                                                                                                                                           |
| `REEVA_TEST_S3_* pnpm test`                                                  | Pass, 22 tests against a disposable SeaweedFS S3 service. Image `chrislusf/seaweedfs@sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d` (reported version 4.48); synthetic access key and test-only STS signing key; created and removed random test bucket/object. |
| S3 protocol coverage                                                         | Pass: SigV4 streaming PUT, streamed GET, DELETE, presigned GET fetch, temporary session token signing, socket timeout on a stalled response, path-style/custom endpoint, and virtual-host style host construction for R2/OCI examples.                                                    |
| MinIO server integration                                                     | Not run: Docker Hub denied the image pull and Quay required authorization. AWS S3, OCI, and R2 integration were also unavailable.                                                                                                                                                         |

The S3 adapter benchmark used Node 24.18.0, the SeaweedFS image above, 64 MiB
synthetic objects, eight samples per concurrency, and checksum-verified
downloads. Values are a local single-node measurement, not cloud service
capacity data. p95 is the maximum of eight samples with no warmup; results are
machine/load dependent. RSS is from the Node benchmark process and includes
Node allocator/runtime memory, not the separate SeaweedFS container.

| Concurrency | Upload p50/p95         | Upload p50 rate | Download p50/p95   | Download p50 rate | RSS baseline → peak (delta)      |
| ----------- | ---------------------- | --------------- | ------------------ | ----------------- | -------------------------------- |
| 1           | 349.94 / 503.75 ms     | 182.89 MiB/s    | 103.28 / 178.14 ms | 619.69 MiB/s      | 84.11 → 184.95 MiB (+100.84 MiB) |
| 4           | 1,026.48 / 1,110.98 ms | 62.35 MiB/s     | 290.37 / 559.86 ms | 220.41 MiB/s      | 82.25 → 234.72 MiB (+152.47 MiB) |

A separate concurrency-1 run with three samples measured RSS deltas of 78.2,
94.9, and 143.9 MiB for 16, 64, and 128 MiB objects. One forced-GC probe with
64 MiB confirmed upload RSS stayed near its 82 MiB baseline; consuming one
download raised RSS to 180 MiB and it remained 179 MiB after GC, while
`arrayBuffers` fell from 21 MiB to 1 MiB. This points to runtime/allocator
retention after streamed response chunks are consumed, but does not establish
the peak memory behavior of the full HTTP server or high-concurrency downloads.
No before/after S3 performance claim is made: the old AWS S3 adapter already
used the AWS SDK's readable stream path, so this change consolidates
configuration/compatibility and client reuse rather than changing the S3
payload transfer algorithm. Use the workload benchmark on deployment hardware
before setting memory/concurrency limits.

Compatibility means the required S3 subset, not identical vendor APIs. Cloudflare
documents `auto` region and virtual-hosted presigned URLs; OCI documents
different path-style and virtual-host endpoint formats. See [R2 S3
presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
and [OCI S3 Compatibility API](https://docs.oracle.com/en-us/iaas/Content/Object/Tasks/s3compatibleapi.htm).

## Docker MySQL connection failure (2026-10-03)

The current app container was restarting during migration with only Node's
outer `AggregateError` printed. Read-only inspection of non-secret environment
keys showed `DB_CONNECTION=mysql`, `DB_HOST=localhost`, `DB_PORT=3306`.
TCP probes from a disposable app container returned `ECONNREFUSED` for both
`::1:3306` and `127.0.0.1:3306`; `host.docker.internal:3306` also refused the
connection. No host listener was present on 3306. This is an unavailable
database configuration, not a Git conflict or evidence of a failed schema.

The entrypoint now checks the selected MySQL connection before key generation,
migrations or seeding. `DB_STARTUP_TIMEOUT_SECONDS` defaults to 30 (valid range
1–300). Transient connection failures retry within that budget; authentication,
unknown-database and other non-transient failures stop promptly. Diagnostics
report accumulated nested error codes and host/port, never driver messages,
SQL or credentials. SQLite does not attempt a network connection. Database
selection and existing data are never changed automatically.

| Check                                                                                                                                                                                | Result                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node 24.18.0 `pnpm typecheck`, `pnpm lint`                                                                                                                                           | Pass                                                                                                                                                                                                                                           |
| `pnpm test`                                                                                                                                                                          | 23 passed; 1 optional S3 service integration skipped because `REEVA_TEST_S3_ENDPOINT` was not supplied                                                                                                                                         |
| `docker compose config --quiet`, `docker compose build app`                                                                                                                          | Pass; production TypeScript/Vite build and final image creation succeed                                                                                                                                                                        |
| `docker run --rm -e DB_CONNECTION=mysql -e DB_HOST=localhost -e DB_PORT=3306 -e DB_STARTUP_TIMEOUT_SECONDS=1 --entrypoint node reeva-app /app/scripts/check_database_connection.mjs` | Expected exit 1, safe `ECONNREFUSED` diagnostic and container-local loopback guidance                                                                                                                                                          |
| Disposable `mysql:8.4` on a private Docker network                                                                                                                                   | Authenticated preflight waits for fresh server initialization and succeeds; synthetic wrong password returns `ER_ACCESS_DENIED_ERROR` without printing either password; production app completes fresh migration/seed and `/login` returns 200 |
| Exact `docker compose up -d --build` in an isolated source copy with synthetic SQLite `.env`, random free port and fresh named volume                                                | Pass; container becomes healthy, `/login` returns 200, production asset returns 200                                                                                                                                                            |

All test containers, anonymous MySQL volume, temporary Compose volume/network,
temporary source copy and temporary Compose image were removed. The existing
Reeva container, its volume and `.env` were preserved. The local `reeva-app`
image was rebuilt; it does not replace an already-created container until
Compose recreates it.

The first complete regression run exposed a deadline-boundary case where a
last 1 ms connection attempt replaced the prior `ECONNREFUSED` with a timeout.
The check now retains error codes across retries and stops after the deadline
wait instead of starting another expired attempt. The final complete run passes.

Current configured deployment remains blocked until the operator selects
SQLite or supplies a reachable MySQL server. That choice changes where
application data lives, so no automatic fallback was applied. No schema/API
change, data transfer or destructive migration is part of this fix. Rollback
consists of restoring the prior entrypoint/image; volumes and database contents
remain intact. No request-performance benchmark was rerun because this change
affects startup diagnostics only, and no throughput improvement is claimed.

## PostgreSQL-only refactor (2026-10-03 baseline)

Toolchain: Node **24.18.0** (explicit PATH), pnpm **11.20.0**, local macOS/Docker Desktop, PostgreSQL **17** Alpine. Application source now has one Lucid `pg` connection. `better-sqlite3` and `mysql2` were removed as installed dependencies; their names may still appear in Knex's optional peer metadata, which is not executable backend support. Automatic peer installation is disabled and required Playwright/PG types are declared explicitly. Existing lock entries/overrides were preserved; formatting was normalized only after checking parsed lock data equality. The ignored application `.env` and existing Reeva container/storage volume were not replaced.

### Checks and evidence

| Command/check                                                                | Current result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                             | Pass, including Docker production/dev install stages.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `pnpm peers check`                                                           | Pass, no peer dependency issues.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `pnpm typecheck`, `pnpm lint`                                                | Pass. Generated `database/schema.ts` was regenerated from disposable PostgreSQL, then formatted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `REEVA_TEST_S3_* pnpm test`                                                  | **29 passed, no skips**, with disposable PostgreSQL and SeaweedFS. Tests cover public eligibility/product scoping, count/pagination, concurrent defaults/constraints, soft-deleted joins/history, UUID/JSONB/int8 handling, traversal/symlinks/secrets, upload quota/duplicate/compensation, stream failure/disconnect, atomic metrics, auth/reset/throttle, and transactional license activation including a PostgreSQL trigger-induced write failure/rollback.                                                                                                                                                                                                                                    |
| `pnpm verify:migration-upgrade`                                              | Pass: all 29 migrations fresh; isolate/down/up additive migrations; legacy user/version/settings preserved; UUID remember-token FK; remember tokens revoked; duplicate cross-product semver rollback refuses safely; full reset/reapply only on generated disposable DB.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `pnpm verify:legacy-import`                                                  | Pass: dry-run rolls back; FK failure rolls back all rows; nonempty target refused; JSONB/boolean/bigint-string conversion; one/multiple product backfill; IDs, hashes, checksum and storage keys preserved; sessions/tokens omitted and user auth version advanced.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Historical `pnpm verify:s3-env` (superseded by `pnpm verify:storage-config`) | Pass on PG: preexisting env S3 default does not collide with Local seed; repeat seed is idempotent; exactly one default; DB marker contains no S3 credentials.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `pnpm build`                                                                 | Pass, TypeScript and Vite production build.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `pnpm verify:production-smoke`                                               | Pass on disposable PG: compiled server starts with no `.env` or PORT, defaults to 8888; Chromium CSRF/root login; software/version/artifact/dashboard/storage/add-provider/license pages; scoped/legacy OTA validation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `REEVA_SMOKE_SESSION_DRIVER=database pnpm verify:production-smoke`           | Pass, including actual PostgreSQL-backed session persistence through login and CMS access. Cookie sessions also pass.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `pnpm verify:docker-compose`                                                 | Pass: copies tracked/current source to an isolated project without `.env`/storage/production credentials; invokes exact `docker compose up -d --build`; PostgreSQL/app healthy with container port 8888; all 29 migrations; application role has no superuser/create-role/create-DB/replication/RLS bypass privileges. DB sentinel row, generated DB password and APP_KEY survive restart and a repeated build/start. A synthetic legacy `.env` (`mysql`, `localhost`, `3306`) cannot override managed `pg postgres 5432`. The test used an ephemeral host port because a pre-existing Reeva container already owned host port 8888. Own test containers, volumes, image and directory are removed. |
| `pnpm verify:dependencies`                                                   | Pass: zero unmitigated advisories; exactly one locally mitigated braces advisory. Installed ordinary/deep-pattern behavior is checked before accepting that exact advisory/version. All new advisories fail this check.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Raw `pnpm audit --json`                                                      | **Exit 1**, one high advisory `GHSA-vfj7-8cjw-p6xm` for upstream `braces@3.0.3`. The pinned installed patch is covered by regression. `pnpm view braces version` still returns `3.0.3`; an upstream fixed release was not available from the registry at this check. This is mitigation evidence, not a claim that raw audit is clean.                                                                                                                                                                                                                                                                                                                                                              |
| `git diff --check`, `git ls-files -u`                                        | Pass/no unresolved index conflicts. No real `.env`, database files, imported exports or generated test data are in the change set.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

The PostgreSQL baseline reproduction stopped at users trigger creation (`relation "users" does not exist`). The first release-list regression on PG then exposed an invalid count query retaining artifact columns. Both were fixed at their common sources, rather than hidden by skipping tests. PostgreSQL rate-limit UPSERT column resolution/RETURNING, numeric byte serialization, UTC activity/soft-delete handling and case-insensitive filters were updated consistently.

One intermediate SeaweedFS rerun failed with HTTP `InternalError`. Gateway logs showed `No writable volumes and no free volumes left` after a previous test bucket used the single allowed volume. The disposable gateway was recreated with capacity for ten volumes; test payload, assertions and application code were unchanged. Final 29-test run passes. This was infrastructure capacity failure, not a bypass/retry that ignored a service error. SeaweedFS image digest: `sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d` (4.48).

### Measurements on the same PostgreSQL workload

Command: `pnpm benchmark:ota`. Two software products, **100,000 synthetic rows**, 3 warmups and 25 query samples; both reference and filtered queries run on the same disposable PostgreSQL database. IDs are integers in this focused SQL fixture, whereas production uses UUIDs. These are query/algorithm measurements, not complete HTTP latency or proof of migration speedup over another backend. The valid reference query shapes model the former candidate-loading/count algorithm; the old broken PG API count was not treated as a successful benchmark. Other local services were running; repeat on deployment hardware before setting an SLA.

| Query                        | Reference p50/p95 ms | Current p50/p95 ms | Queries / returned rows                                  |
| ---------------------------- | -------------------- | ------------------ | -------------------------------------------------------- |
| Update candidate selection   | 127.718 / 158.804    | 0.776 / 1.050      | 1 each; 100,000 → 1 returned row                         |
| Release count + 20-row page  | 33.183 / 52.375      | 39.070 / 49.967    | 2 each; 20 rows; p50 regressed and p95 improved slightly |
| Software-scoped update       | —                    | 1.050 / 1.359      | 1 / 1 row                                                |
| Software-scoped count + page | —                    | 32.204 / 38.070    | 2 / 20 rows                                              |
| Native UTC dashboard bucket  | —                    | 58.850 / 62.251    | 1 / 120 buckets                                          |

The same command compares 64 MiB local buffer-copy and stream-pipeline workers with 7 samples, at concurrency 1 and 4. Memory is per-worker peak RSS; throughput is aggregate local payload transfer, not S3/network/HTTP throughput.

| Concurrency / implementation | p50/p95 ms        | Median MiB/s | Peak RSS MiB |
| ---------------------------- | ----------------- | ------------ | ------------ |
| 1, buffer                    | 337.31 / 359.86   | 189.73       | 122.72       |
| 1, stream                    | 385.53 / 531.74   | 166.00       | 123.09       |
| 4, buffer                    | 1198.10 / 1637.32 | 213.67       | 315.27       |
| 4, stream                    | 1254.79 / 1325.49 | 204.02       | 143.94       |

Streaming reduces the concurrent memory peak, but is not faster in every measurement. No universal throughput improvement is claimed. Benchmark/script changes here remove obsolete SQLite drivers and make the workload reproducible against the supported backend.

### Contract, transition and limits

- OTA URLs, JSON fields, release eligibility, object keys and checksums are retained. Byte sizes/quotas remain numeric at API/CMS boundaries. PostgreSQL is now the sole accepted DB backend; unsupported `DB_CONNECTION` values fail direct starts. `SESSION_DRIVER` accepts cookie/database, not the previously unconfigured memory store.
- Compose uses `POSTGRES_*` identity/settings and persistent generated credentials, independent of legacy direct-start `DB_*`. It does not import source metadata or remove old objects. Existing configured containers keep their previous image until explicitly recreated; the existing local restarting container was deliberately not switched to an empty database.
- Historical migration IDs remain stable. Users trigger ordering and remember-token UUID FK required narrowly scoped repairs to make fresh PG possible; native PG index/HAVING behavior is used. The new additive migration supplies sessions, default-product/live-provider invariants and activity index. See `docs/postgresql.md` for migration/import commands, backups, empty-target preparation and guarded rollback conditions.
- No actual SQLite/MySQL source data was migrated; only synthetic exports/upgrade fixtures were verified. Source export tooling is operator-specific. Invalid UUIDs, duplicate default states or inconsistent FKs are refused and need explicit reconciliation. Large JSON imports currently load into memory and insert sequentially; production volume/duration must be measured offline.
- PostgreSQL 17 local/fresh/upgrades and both session stores were exercised. External PostgreSQL TLS/CA/managed-host failover, hosted GitHub Actions, PM2 daemon operation, live AWS/OCI/R2/MinIO, cloud IAM, SMTP delivery and reverse proxies were not exercised. CI installs Chromium for the production browser smoke and runs the storage-config migration verifier; the workflow itself has not been run on GitHub in this turn.
- Existing user changes and source data were preserved; no deployment/push or destructive migration on an existing application database was performed for this refactor.

## Runtime-managed storage provider configuration (2026-10-04, current)

Toolchain for this pass: Node **24.11.0**, pnpm **11.20.0**, macOS and Docker Desktop, PostgreSQL **17**. Provider settings now live in PostgreSQL and are read for every new operation. Root admins can add, edit, and activate a local or S3-compatible provider in the CMS; a provider change needs no process/container restart. New uploads use the current default; artifacts already stored keep their provider ID. S3 credentials are authenticated-encrypted with the shared `APP_KEY`, never serialized to CMS, and can only be rotated by entering a complete pair or removed with an explicit clear action.

| Check                                       | Result                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`, `pnpm lint`, `pnpm build` | Pass. Vite assets and compiled production app built successfully.                                                                                                                                                                                                                                                                                                                                                                                    |
| `pnpm test`                                 | **33 passed, 2 skipped.** The optional live S3 endpoint test skips without `REEVA_TEST_S3_ENDPOINT`; the production-seeder credential test runs only under its synthetic smoke environment. Four provider-config tests cover ciphertext at rest, redacted serialization, write-only credential updates/clearing, immediate default switch, and tamper rejection.                                                                                     |
| `pnpm verify:storage-config`                | Pass. A disposable PostgreSQL migration converted plaintext provider JSON and a legacy environment-backed S3 record to authenticated ciphertext; rollback restored the old plaintext format and re-upgrade encrypted it again; repeated seed kept the local default and did not restore environment selection. Four focused PostgreSQL tests pass.                                                                                                   |
| `pnpm verify:migration-upgrade`             | Pass on disposable PostgreSQL: all 29 migrations fresh, then additive rollback/upgrade, seed, and reapply; existing synthetic user/version data and migration safety guards verified.                                                                                                                                                                                                                                                                |
| `pnpm verify:legacy-import`                 | Pass on disposable PostgreSQL: transaction rollback, refusal of nonempty target, multi-software IDs/checksums/keys preserved, auth sessions/tokens invalidated, and imported storage config encrypted with destination `APP_KEY`.                                                                                                                                                                                                                    |
| `pnpm verify:production-smoke`              | Pass on the compiled app with no `.env` and no `PORT`: defaults to 8888; fresh PostgreSQL migration/seed; real Chromium CSRF login; root CMS Software/Version/Artifact/Dashboard/Storage/Add/Edit Provider/License pages; scoped/legacy API errors. Latest full-page reruns used `REEVA_SMOKE_PORT=18890` because the existing Reeva process owns host 8888; cookie and PostgreSQL session drivers both passed.                                      |
| `docker compose config --quiet`             | Pass with default interpolation and with `HOST_PORT=0`. With no override normal Compose publishes host 8888 to container 8888; the verification harness can request an ephemeral host port while still exercising container port 8888.                                                                                                                                                                                                               |
| `pnpm verify:docker-compose`                | Pass in an isolated source copy and project with the exact `docker compose up -d --build`; healthy app and PostgreSQL, 29 migrations, non-superuser app role, persistent sentinel/key/password across restart, and rejection of synthetic MySQL overrides. Host port was ephemeral because the existing Reeva container kept the real host port 8888. Test project, app image and volumes were removed; that pre-existing container was not changed. |
| `git diff --check`, `git ls-files -u`       | Pass; no whitespace errors or unresolved index entries. Existing `.env` is ignored and was not added to the diff.                                                                                                                                                                                                                                                                                                                                    |

The additive config migration requires old complete `S3_*` settings only if upgrading a database that contains the legacy environment-backed provider row; new databases need no S3 environment variables. After a successful migration, remove those legacy values. All instances sharing PostgreSQL must keep the same durable `APP_KEY`; changing it without re-encrypting rows makes provider settings unreadable. Rolling the encryption migration down intentionally decrypts provider JSON for the old runtime format, so protect the database and backups during an explicitly chosen downgrade. Editing an existing provider's endpoint or bucket does not move its objects; preserve those keys or use a separate provider for new uploads. No live cloud bucket or production credentials were used in this pass. The current existing Reeva container on host port 8888 was observed but preserved; the isolated Compose check used a temporary host mapping.

No dedicated before/after latency benchmark was run for the provider-config CRUD or database lookup path in this pass; no performance improvement is claimed. The recorded OTA and stream benchmarks in the PostgreSQL baseline section cover separate query and data-transfer workloads.

## Rust managed signer / OpenBao (2026-10-08)

Toolchain: Node **24.11.0**, pnpm **11.20.0**, Rust **1.98.1**, Docker Desktop,
PostgreSQL **17**, OpenBao **2.7.0**. All signing keys, credentials, artifacts and
databases used below were synthetic and isolated. The repository `.env`,
existing Reeva container/volumes and concurrent user pagination edits were
preserved. No production deployment, commit or push was performed.

| Command/check | Result |
| --- | --- |
| `cargo fmt --manifest-path signer/Cargo.toml --check` | Pass. |
| `cargo clippy --manifest-path signer/Cargo.toml --locked --all-targets -- -D warnings` | Pass. |
| `cargo test --manifest-path signer/Cargo.toml --locked` | 4 passed: strict manifest/context validation, role/request identity, unauthorized approval/read rejection, request deadline/capacity release. |
| `cargo audit --file signer/Cargo.lock` | Pass, 241 locked dependencies, no reported vulnerabilities in the 1,295-advisory RustSec snapshot. |
| `pnpm typecheck`, `pnpm lint`, `pnpm build` | Pass, including the compiled managed signer consumer and Vite assets. |
| `pnpm test` | **39 passed, 2 skipped**. Includes signatures, signed-only/revoked-key public eligibility, stale/foreign metadata, provider-envelope substitution, proxy-prefix and deep-copy regressions. Optional real S3 and production-root-seed cases skip in the regular suite; root seeding runs and passes in the production smoke. |
| `pnpm verify:migration-upgrade` | Pass: 30 fresh migrations, seeded additive upgrade, rollback and reapply. Existing synthetic IDs/metadata preserved; signature policy defaults false and public-key table starts empty. |
| `pnpm verify:production-smoke` | Pass on compiled app, disposable PostgreSQL, Chromium CSRF/root login and CMS/API pages. Cookie sessions and a separate `REEVA_SMOKE_SESSION_DRIVER=database` run both pass. Used ports 18890/18891 to preserve the existing host-8888 app. |
| `pnpm verify:dependencies` | Pass: 0 unresolved advisories, 1 existing locally mitigated `braces` advisory. New proxy-addr/source-map-js/fast-copy advisories fixed via lock and minimum overrides; raw audit is still not entirely clean because of the reported patched braces version. |
| `node scripts/verify_signer_compose.mjs` | Pass against real isolated OpenBao and signer PostgreSQL without building Reeva; this does not replace the compiled-consumer check below. |
| `pnpm verify:docker-compose` | Pass: exact `docker compose up -d --build` in an isolated source copy, healthy app/custody processes, port 8888 internally with ephemeral host mapping, 30 migrations, nonsuperuser DB roles, persistent DB/password/APP_KEY and signing-key identity. Exercises verified TLS, requester/approver/operator separation, denied key export, independently verified Ed25519 signatures, duplicate request/approval, eight simultaneous approvals producing one result/audit, expiry/renewal and stale approval, DB audit failure after real provider signing, atomic result/audit, root-token retirement, two signer replicas, seal/restart/unseal recovery and the compiled Reeva consumer. |
| Script syntax, OpenAPI JSON parsing, `git diff --check`, `git ls-files -u` | Pass; no unresolved index conflicts, actual private keys, recovery shares or generated secret files in the change set. |

One intermediate OpenBao initialization failed because Raft had not yet become
active immediately after unseal. The operator tool now waits for the active
leader; subsequent fresh initialization and restart recovery pass. One build
observed concurrently incomplete user pagination edits; those edits were
preserved and subsequent application build/typecheck/lint/smoke passed after
the edits were complete. A temporary PostgreSQL startup check also failed under
concurrent build load; final fresh/upgrade and full test reruns pass.

### Contract, migrations, recovery and limits

- Additive Reeva migration `1777400000000` introduces public-key metadata,
  signatures, verified JSONB manifest snapshots and opt-in signed-only policy.
  Signed-only public reads compare the saved snapshot with current metadata in
  SQL, including relation names, so an edit racing a signature save cannot
  restore public eligibility with a stale signature. API envelopes also reject
  snapshots that disagree with preloaded metadata. Existing products/releases stay
  optional until deliberately signed and enabled. OTA envelopes are additive;
  clients must pin trusted public keys and enforce context/hash/size before
  install. Sending a public key to Reeva is not authentication.
- Signer request/audit state lives in its own PostgreSQL database. Startup DDL
  is advisory-locked across replicas. A failed DB commit can cause a repeated
  OpenBao sign operation, but no result is exposed before durable audit/result
  commit. Signature-request expiry is not signed update freshness.
- Back up databases and custody before upgrade. Rolling the signature migration
  down removes signature/public-key/policy metadata; it is an explicit downgrade
  that weakens server policy, not a safe way to repair custody. Restore a matching
  application and verified backup when preserving signed-only enforcement.
  Do not delete production Compose volumes. OpenBao restart deliberately requires
  operator unseal; existing signatures/releases remain available.
- This is software-backed, single-host default custody, not an HSM, FROST,
  complete KMS replacement, independent-host HA, or absolute private-key secrecy.
  Root/hypervisor administrators and an unsealed OpenBao compromise remain
  trusted risks. Temporary recovery shares must move to offline independent
  custodians. Real offline-custody ceremonies, restore drills, certificate/token
  rotation, hardware integration, remote CI execution and OTA client code were
  not exercised. Liveness health does not mean a vault is ready to sign.
- No HTTP throughput/RSS benchmark was run for the new signer. It introduces
  a new approval path without an equivalent previous signer workload. Bodies,
  response sizes and per-replica concurrency are bounded in code; those limits
  are not measured deployment capacity. Prior OTA benchmarks above apply to
  their dated workload, not the new signature predicate.

### Signature eligibility query overhead

Command: `node scripts/benchmark_ota_signatures.mjs` under Node 24.11.0.
Disposable PostgreSQL 17, **100,000 identical synthetic release rows** for both
variants, same indexes, 3 warmups and 25 alternating samples. The current
manifest comparison is read directly from production source. Correlated
`EXISTS` and optional-policy `OR` follow the production signing predicate.
These are focused SQL measurements; other public lifecycle filters, UUIDs,
HTTP, Lucid preloads and actual cryptographic operations are outside this
fixture. Synthetic signatures test presence only. Both variants return the
same result rows; the reference lacks the new stale-metadata protection.

| Operation | Presence-only p50/p95 ms | Snapshot p50/p95 ms | Queries / result rows |
| --- | --- | --- | --- |
| Latest | 1.011 / 2.553 | 1.178 / 4.668 | 1 / 1 |
| Exact count | 116.348 / 183.471 | 739.624 / 979.446 | 1 / 1 aggregate |
| First 20-row page | 0.749 / 0.889 | 1.018 / 1.261 | 1 / 20 |

The full count is slower because every candidate's snapshot is compared with
current metadata, including related targets. No speedup is claimed. Deployments
with large release histories must budget this cost; an indexed revision scheme
would require atomic invalidation for every related metadata mutation and is
not implemented here. The current predicate is retained for correct eligibility.
Local services were also running; repeat on deployment hardware before setting
an SLA. An initial experiment flattened the predicate onto top-level joins,
making PostgreSQL choose an expensive plan even for latest/page. That query
shape was not the production call site; the retained script uses the correlated
production signing shape. The release dataset was not reduced to hide count
cost. RSS/throughput and production-size payload variation were not measured.

See [signer operations](signer-operations.md) for initialization, separate
approval, root retirement, seal recovery and production trust boundaries. CI now
runs Rust formatting/clippy/tests/advisories and full Compose verification; the
hosted workflow has not run in this local task.

## Docker host port 8797 (2026-10-09)

Compose now defaults to host **8797** mapped to app/container **8888**.
Its default `APP_URL` follows the host port. The local `.env` host port and
localhost application URL were updated without changing other settings.
`docker compose config --format json` confirms published 8797, target 8888,
and `APP_URL=http://localhost:8797`; `git diff --check` passes. No containers
were recreated and no runtime tests or benchmarks were rerun for this mapping
change. Apply it using `docker compose up -d --build`.
