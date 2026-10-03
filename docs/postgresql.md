# PostgreSQL deployment and data transition

Reeva now supports PostgreSQL only. The verified runtime is PostgreSQL 17 (`postgres:17-alpine` in Compose). Existing SQLite/MySQL database files, servers and storage objects are not converted, reset or deleted automatically.

## New installation

```sh
docker compose up -d --build
docker compose ps
```

The app listens at `http://localhost:8888`. Compose provisions a dedicated application role/database, waits for PostgreSQL, authenticates, runs migrations and seeds idempotently. Set `ADMIN_EMAIL`/`ADMIN_PASSWORD` in `.env` to provision the first root user. SMTP requires separate configuration.

Volumes retain PostgreSQL data (`reeva_postgres`), local objects/application key (`reeva_storage`), application database credentials (`reeva_database_credentials`) and separate administrative credentials (`reeva_postgres_admin`). Back up these along with S3 objects when applicable. PostgreSQL has no published host port; the app role has no superuser, role creation, database creation, replication or RLS bypass privileges.

`POSTGRES_USER`/`POSTGRES_DB` configure the managed application identity. Blank `POSTGRES_PASSWORD` generates a persistent random password. Changing identity or the configured password after initialization fails safely; coordinate role/password and secret-file rotation while the application is stopped. Do not delete volumes to rotate credentials. Explicit passwords should be strong and contain no leading/trailing whitespace or newlines (password files are trimmed).

Direct Node starts use `DB_CONNECTION=pg`, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_DATABASE` and `DB_PASSWORD` or `DB_PASSWORD_FILE`. The application role must own its database for migrations. `DB_SSL=true` verifies server certificates; `DB_SSL_CA_PATH` optionally supplies a PEM CA. Compose uses its private network without TLS and ignores direct-start `DB_*` connection overrides. A remote TLS deployment has not been exercised in this local verification.

## Existing installations: explicit import

1. Stop source writes. Back up its database, local/object storage and application key. Keep the source intact for recovery. Record row counts and representative artifact IDs/checksums/keys.
2. Export source rows into JSON with an existing database export tool or a read-only script. The importer accepts this interchange format, not SQL dumps:

   ```json
   { "formatVersion": 1, "tables": { "users": [], "versions": [], "artifacts": [] } }
   ```

   Allowed tables: `users`, `settings`, `platforms`, `architectures`, `storage_providers`, `software`, `versions`, `artifacts`, `download_histories`, `licenses`, `license_activations`, `storage_upload_reservations`. Include every source row, including soft-deleted rows, and preserve snake_case column names, UUIDs and UTC timestamp meanings. Export bigint values as decimal strings to avoid JSON rounding. SQLite/MySQL booleans `0`/`1` and JSON strings are normalized. `versions.version_number` is ignored; semantic version parts remain authoritative. If the source has no software table, versions are assigned to a new default `reeva` product. Otherwise include the software rows and their version foreign keys.

   Database sessions, reset/remember tokens, rate limits and migration trackers are skipped. User auth versions are advanced to invalidate sessions. File contents are not part of the JSON export. Password hashes and storage configurations may contain sensitive data: keep the export outside this repository, restrict file permissions and never publish it.

3. Create an **empty destination** and run migrations without normal seeding. For managed Compose, before its first normal app start:

   ```sh
   docker compose build app
   docker compose up -d postgres
   docker compose run --rm --no-deps --entrypoint node \
     -e APP_KEY=temporary-migration-key-012345678901234567890123 \
     app build/ace.js migration:run --force
   ```

   These commands initialize the dedicated volumes/database and migration-created default product only. If normal startup has already seeded tables, provision a separate empty destination/project; the importer deliberately refuses nonempty targets.

4. Validate, then import the securely stored export:

   ```sh
   docker compose run --rm --no-deps --entrypoint node \
     -v /absolute/secure/export.json:/import/export.json:ro \
     app scripts/import_legacy_data.mjs --file /import/export.json --empty-target --dry-run
   docker compose run --rm --no-deps --entrypoint node \
     -v /absolute/secure/export.json:/import/export.json:ro \
     app scripts/import_legacy_data.mjs --file /import/export.json --empty-target
   ```

   The importer locks destination tables, validates empty-target state, inserts in dependency order, validates counts and commits in one transaction. Dry-run executes the same inserts/constraints and rolls everything back. Any FK/UUID/uniqueness/format failure rolls back all imported rows. Migration records on the destination are retained; source migration records are never copied. Large exports currently load into memory and insert rows sequentially: schedule an offline maintenance window and validate duration against your data volume.

5. Preserve artifact storage paths/objects. S3 bucket, keys and credentials must still refer to the same objects. Local provider roots must point to the mounted destination path (normally `/app/storage/uploads`); deliberately adjust a legacy absolute root in the export before import if necessary. Existing non-UUID legacy identifiers require an explicit consistent ID/FK mapping before export; the importer refuses incompatible identifiers rather than guessing. Expired upload reservations should be reconciled against the source storage before copying so imported cleanup does not delete an object you intend to retain.
6. Start `docker compose up -d --build`; verify login, product/version counts, representative public downloads and their checksum/size, then switch traffic. Imported users must log in again; passwords themselves are preserved. No source database in this workspace was imported as part of the refactor.

For an external PostgreSQL destination, pass `DB_*` variables explicitly and use `pnpm db:import --file /secure/export.json --empty-target --dry-run`. The CLI intentionally does not load `.env`. Remove `--dry-run` only after reviewing the result.

## Migrations and recovery

Migration filenames/IDs remain stable. Two historical schema statements were repaired because a fresh PostgreSQL install could never complete: the users trigger now executes after table creation and remember-me token user IDs use UUID foreign keys. The obsolete MySQL prefix-index branch was removed; the software rollback HAVING expression now works on PostgreSQL.

New migration `1777200000000_postgresql_release_invariants` adds a single default-product index, requires a default product to be active, allows a soft-deleted storage default to be replaced indexes live download activity and creates the Adonis database session table. Cookie sessions remain the default; `SESSION_DRIVER=database` is also supported and smoke-tested. Concurrent default selection uses transaction-scoped PostgreSQL advisory locks shared by services and storage seeding.

Back up before an upgrade. Invalid existing defaults may cause the new constraints to refuse migration; review/fix those rows deliberately before retrying. Rollback from multi-software to the old global version constraint refuses duplicate semantic versions across products without dropping rows. Rolling back the latest storage index can also refuse when a deleted and live default coexist under the older stricter predicate. Resolve those invariants explicitly or restore a backup; do not remove data to force rollback. Source-backend recovery is a separate operation: stop target writes and restore source traffic from its retained backup, accounting for any writes made after cutover.

## Verification

`pnpm test`, `pnpm verify:migration-upgrade`, `pnpm verify:legacy-import` and `pnpm verify:s3-env` each use generated `reeva_test_*` databases. By default they start/remove a disposable PostgreSQL container. CI may provide explicit `REEVA_TEST_PG_*` credentials to a disposable server with database-creation privileges. Neither mode reads application `.env` database credentials.
