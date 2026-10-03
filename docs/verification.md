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

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Pass, lockfile is up to date |
| `pnpm audit` | Pass, no known vulnerabilities found by the configured registry audit at the time run |
| `pnpm typecheck` | Pass |
| `pnpm lint` | Pass |
| `pnpm test` | Pass, 17 focused regression tests, including product-scoped semver, OTA selection, default resolution, deactivation, generated names, and route access matrix |
| `pnpm verify:migration-upgrade` | Pass on disposable SQLite: fresh migrations, new migration down/reapply, synthetic legacy user upgrade, user preserved, old remember-me token revoked |
| `pnpm verify:software-migration` | Pass on disposable SQLite: additive product migration down/reapply, legacy `appName` preserved as the `reeva` product name, version `7.8.9` backfilled, non-null software foreign key and foreign-key check passed |
| `REEVA_TEST_MYSQL_HOST=127.0.0.1 REEVA_TEST_MYSQL_PORT=13306 REEVA_TEST_MYSQL_USER=root REEVA_TEST_MYSQL_PASSWORD=<temporary password> pnpm verify:migration:mysql` | Pass on disposable MySQL 8.4.11: fresh migrations, additive down/reapply, preserved legacy user, revoked synthetic remember-me token, public-release index and reservation foreign key verified; random schema dropped afterward |
| `pnpm build` | Pass, production client assets and server bundle generated |
| `pnpm verify:production-smoke` | Pass after a fresh rebuild: temporary SQLite migrations + seed, CSRF form login, seeded root authentication, root Software/Version/Artifact pages, product-scoped invalid API input (`400`), unknown software (`404`), and legacy route input (`400`) |
| Docker Compose verification | Pass: `docker compose config --quiet` and `docker compose build app`; then a temporary Compose project with synthetic environment, fresh SQLite volume, random loopback port, migrations/seed, root login, CMS pages, and legacy API validation; project, container, and volume removed |
| MySQL software-product migration | Pass on disposable MySQL 8.4.11: software migration down/reapply, old version `7.8.9` and legacy product name retained; random schema/container removed afterward |
| `docker build -t reeva:multi-software-audit .` | Pass using Node 24 and frozen pnpm install |
| Production-container HTTP smoke | Pass after fresh SQLite migrations: scoped invalid check `400`, unknown software `404`, legacy invalid check `400`, unauthenticated `/cms/software` redirects `302`; temporary container removed |
| Conflict-resolution production image smoke (`docker build --tag reeva:conflict-smoke .`, then temporary container) | Pass: container runs fresh SQLite migrations and seed as the unprivileged `node` user, serves `/login` with Vite assets, authenticates the seeded root account, and renders Software/Version/Artifact CMS pages; container and its writable layer removed |

The stream-disconnect regression intentionally logs the simulated stream error through the application's warning logger; the test itself passes and confirms the accepted download count remains one.

The lockfile resolves `stream-json@3.7.0`, above the 3.5.0 fix for [GHSA-528h-pc64-c93x](https://github.com/advisories/GHSA-528h-pc64-c93x) (CVE-2026-71429). MinIO 8.0.7's notification parser was patched because its bundled code expects the incompatible v1 parser path/API; the patch uses Node's line reader and JSON parser.

## Performance measurements

`pnpm benchmark:ota` used a synthetic 64 MiB file, one and four concurrent local storage workers, seven alternating samples per mode, and an isolated SQLite database with 100,000 aligned version/artifact/history rows. The final measurement was run without the test/build jobs running alongside it. These are local microbenchmarks, not production HTTP measurements. The storage comparison isolates copy/hash behavior; it does not include the web server, multipart parser, cloud network, or database transaction.

| Workload | Before | After | Observation |
| --- | --- | --- | --- |
| 64 MiB local copy/hash, concurrency 1 | Buffer p50/p95 279.54/305.28 ms; 228.94 MiB/s; peak RSS 116.47 MiB | Stream + four hashes p50/p95 301.08/378.74 ms; 212.57 MiB/s; peak RSS 110.44 MiB | Streaming lowered measured peak RSS 5.2% but p50 was 7.7% slower and throughput 7.1% lower in this run; no single-worker speed improvement claimed. |
| 64 MiB local copy/hash, concurrency 4 | Buffer p50/p95 934.75/1127.22 ms; 273.87 MiB/s; peak RSS 309.47 MiB | Stream + four hashes p50/p95 990.22/1173.60 ms; 258.53 MiB/s; peak RSS 141.38 MiB | Streaming lowered measured peak RSS 54.3%; p50 was 5.9% slower and throughput 5.6% lower. This synthetic comparison does not capture the multipart parser's full-buffer allocation avoided by the application. |
| OTA update selection, 100,000 candidates | p50/p95 63.451/66.744 ms; all 100,000 rows returned for in-memory scan | p50/p95 12.815/14.100 ms; one row returned by SQL filter/limit | About 79.8% lower p50 in this synthetic dataset; query is a SQLite approximation of the application query. |
| Releases count + page | p50/p95 47.282/50.907 ms; 2 queries; 20 rows | p50/p95 47.788/50.127 ms; 2 queries; 20 rows | The shared eligibility query added about 1.1% p50 in this run; no latency improvement claimed. |
| Multi-software update check, 100,000 rows split evenly across two products | Filtered shared eligibility without product scope: p50/p95 12.815/14.100 ms; 1 row returned | Software-scoped query: p50/p95 12.649/15.591 ms; 1 row returned | The scoped query stayed within measurement noise of the shared query; the isolation benefit is correctness, not a claimed speedup. |
| Multi-software releases count + page | Shared eligibility: p50/p95 47.788/50.127 ms; 2 queries; 20 rows | Software-scoped: p50/p95 50.569/51.832 ms; 2 queries; 20 rows | About 5.8% higher p50 for the extra product predicate on this in-memory SQLite workload. |
| Dashboard hourly chart | Failed: SQLite reports `no such function: HOUR` | p50/p95 50.083/55.434 ms; 120 grouped rows | New dialect-compatible chart query executes on the same synthetic history table. |

The benchmark output is machine-dependent and should be rerun on deployment hardware before making capacity decisions. It does not provide end-to-end upload/download throughput, RSS under a complete server workload, MySQL timings, or a representative customer dataset. The before/after query columns compare synthetic equivalent SQL shapes, not a captured production build before and after deployment.

## Migration, rollback, and runtime limits

- Fresh migration and upgrade checks ran on temporary SQLite and MySQL 8.4.11. The software-product migration's down and reapply paths passed on both; synthetic existing data retained its product display name/version mapping. The wider auth/storage migration checks also preserve an old user, initialize `auth_version=0`, and delete remember-me rows. Generated MySQL schemas and the disposable smoke container were removed.
- The software migration's rollback guard deliberately prevents restoring global version uniqueness if distinct software products share a semantic-version tuple. Reconcile those versions or restore a verified pre-migration backup to roll back after multi-product data has been created.
- Full `migration:reset` on a disposable SQLite database failed in the historical `1774900000001_alter_all_tables_soft_delete` table rebuild while foreign-key checks were enabled. Historical migration files were not rewritten. A real deployment rollback must restore a verified pre-upgrade backup; no existing database was reset or migrated by this audit.
- MySQL migration schema behavior is checked using MySQL 8.4.11 in a disposable service and random temporary schema. The full historical reset path, application query plans, concurrent quota/auth writes, production locking behavior, and upgrade from a production-like MySQL dataset were not checked. Do not infer full MySQL runtime verification from this migration test.
- No S3, MinIO, SeaweedFS, SMTP, reverse proxy, or production credentials were available. Provider integration coverage uses local storage and test doubles. Object-store IAM, request signing, network timeouts, and cloud consistency remain unverified.
- A crash after writing an object but before database completion can leave an expiring reservation/object. Upload attempts to the same provider retry cleanup; if that provider remains unused or unavailable, storage lifecycle/operator cleanup is still required.
- There is no release signing protocol in the existing OTA client contract. The server returns checksums, but client-side signature enforcement and signing-key operations were outside the available code contract and remain a product/deployment decision.
- No production deploy, push, or existing/user database change was performed. The MySQL migration check dropped only its randomly named temporary schema; the HTTP smoke container used temporary storage and was removed.
