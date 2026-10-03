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
- There is no release signing protocol in the existing OTA client contract. The server returns checksums, but client-side signature enforcement and signing-key operations were outside the available code contract and remain a product/deployment decision.
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

`STORAGE_DRIVER=s3` plus `S3_*` variables selects one environment-backed
provider. The DB stores only the provider marker; the seeder validates the
configuration and can be rerun safely. Compose runs the seeder at startup. A
direct deployment must run `pnpm db:seed` after migration and after changing the
storage driver. When switching back to DB-managed storage, choose the desired
default provider in the CMS; the seeder does not guess which prior default to
restore.

| Check                                         | Result                                                                                                                                                                                                                                                                                    |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm verify:s3-env`                          | Pass on disposable SQLite with synthetic `.invalid` endpoint/credentials; env provider was the sole default, repeat seeding added no row, and DB config held no secret.                                                                                                                   |
| S3 Compose interpolation                      | Pass with a temporary env file and synthetic values; verified endpoint, region, bucket, credential, session-token, retry, connect/socket timeout, path-style, and URL-TTL values reached the container environment.                                                                       |
| Production image with `STORAGE_DRIVER=s3`     | Pass after fresh `docker build`; isolated container completed fresh SQLite migration + seeding, returned `/login` `200`, and SQLite contained only the env-provider marker as default. It did not connect to the synthetic `.invalid` S3 endpoint.                                        |
| `docker compose up -d --build` with S3 `.env` | Pass in an isolated project with a temporary synthetic `.env`; fresh SQLite migration/seed completed, `/login` returned `200`, path-style/timeouts reached the app, and the DB stored no S3 credentials. Container, volume, and local image were removed.                                 |
| `pnpm test` without S3 endpoint               | Pass, 21 passed and 1 integration test skipped.                                                                                                                                                                                                                                           |
| `REEVA_TEST_S3_* pnpm test`                   | Pass, 22 tests against a disposable SeaweedFS S3 service. Image `chrislusf/seaweedfs@sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d` (reported version 4.48); synthetic access key and test-only STS signing key; created and removed random test bucket/object. |
| S3 protocol coverage                          | Pass: SigV4 streaming PUT, streamed GET, DELETE, presigned GET fetch, temporary session token signing, socket timeout on a stalled response, path-style/custom endpoint, and virtual-host style host construction for R2/OCI examples.                                                    |
| MinIO server integration                      | Not run: Docker Hub denied the image pull and Quay required authorization. AWS S3, OCI, and R2 integration were also unavailable.                                                                                                                                                         |

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
