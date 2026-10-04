# Refactor plan and target architecture

## Target flow

1. HTTP controllers validate public input and return stable status codes.
2. Authentication gates every CMS route; root-only middleware guards user, storage, and global-settings administration.
3. `ArtifactRepository.publicQuery()` is the single release-eligibility rule. It uses `EXISTS` predicates for version, platform, architecture, and storage-provider state; target lookups then filter artifacts by IDs. Check, latest, releases, API download, and local-file serving all use it.
4. Services own domain rules. API responses use explicit DTOs rather than serializing Lucid models with provider configuration.
5. Storage providers accept `Readable` streams and declared lengths. Uploads reserve quota in a DB transaction, use `artifacts/<reservation UUID>/payload` keys, and compensate by deleting the new object when the DB write fails. The next upload to a provider retries cleanup of expired reservations and their deterministic object keys.
6. Download counters use an atomic SQL increment. Downloads make no third-party geolocation request; new location fields remain null until a licensed HTTPS source is configured.
7. Password reset tokens are stored as SHA-256 digests, consumed once in a transaction, and advance a per-user auth version. Session middleware rejects stale cookies; remember-me remains enabled for 30 days and is rotated by Adonis.
8. New schema changes use additive migrations; necessary historical PostgreSQL bootstrap repairs are documented below. No deployed database is reset; the user's `yargs-parser` lockfile change is retained. The `braces` advisory has no published fixed release in the current GitHub advisory, so the dependency is locally patched with a bounded parse depth and a regression test until an upstream version is available. CI checks the installed depth-bound patch and rejects all other advisories; raw audit still reports the upstream version.
9. Storage providers are configured in PostgreSQL and resolved for each new request. Root-only CMS forms create/edit local and S3-compatible providers; activating one updates the default under an advisory-locked transaction without restarting any instance. The existing artifacts keep their provider IDs. Entire provider JSON is AES-256-GCM encrypted at rest using the persistent `APP_KEY`, omitted from model serialization, and exposed to the edit view only as a redacted DTO. Secret fields are write-only, preserve existing credentials when blank, and clear only through explicit controls. An additive migration encrypts existing plaintext rows and converts the old environment-backed provider once; Docker strips legacy S3 variables before starting the web process. A bounded reusable client pool is closed on shutdown. Runtime commit metadata is provided through optional `APP_GIT_SHA`, so the image does not need Git installed.

## Multi-software product boundary

- `software` is the product boundary. A software row has a stable unique slug, a display name, and active/default flags. A version belongs to one software; artifacts inherit the product through that version, avoiding a redundant product ID that could disagree with its version.
- Semantic-version uniqueness is `(software_id, major, minor, patch)`. The additive migration creates the default `reeva` product, takes its display name from the old `appName` setting when present, and backfills all existing versions without moving artifacts or changing object keys/checksums.
- The same `publicQuery(softwareId)` predicate defines public eligibility and adds active-software eligibility. Product-specific check/latest/releases/download routes use the slug; legacy routes preserve their paths and resolve the active default product for existing OTA clients.
- Product creation, display-name changes, active state, and default selection are root-only CMS operations. Slugs are immutable because clients persist them. Only active software may be selected as default, and the current default must be replaced before it can be disabled.
- Software display names feed filenames for new artifacts. Existing filenames are unchanged until an administrator uses the existing bulk filename sync action; storage keys and checksums are never rewritten by this refactor.
- No product delete operation is provided: products may own historic versions and artifacts. Deactivation removes a product from public OTA paths while retaining history and stored objects.
- Rolling back the product migration is guarded: it refuses to restore global semver uniqueness while multiple products contain the same version tuple. A deployed rollback must first reconcile those releases, or restore a verified pre-migration database backup and matching application version.

## Decisions

- Public eligibility requires a non-deleted, published, non-archived artifact, an active/non-deleted version, non-deleted platform and architecture rows, and a non-deleted active storage provider.
- Access policy follows the existing account model: every active authenticated CMS account may manage versions/artifacts; only root accounts may manage users, storage-provider credentials, and global settings. No finer-grained role model exists.
- A channel is one of `dev`, `staging`, `beta`, or `stable`; artifact uniqueness already includes channel in the existing migration history.
- Quota counts every artifact row, including soft-deleted and archived ones, because soft-delete/archive retain the stored object. New in-flight uploads count through expiring reservations.
- Artifact delete remains a logical soft-delete and retains its object; this avoids irreversible removal and is consistent with existing lifecycle behavior. Archive removes an artifact from public eligibility but does not move the object.
- Download count means a storage object was opened for a client request; it is incremented atomically before stream delivery, so a later client disconnect is still one attempted download.
- Node 24 and pnpm 11.20.0 are the supported local/build toolchain, based on `package.json`, `pnpm-workspace.yaml`, and the pnpm lockfile.
- PostgreSQL is the only supported database. Compose provisions a dedicated PostgreSQL 17 instance on a private network with a nonsuperuser application role and persistent random credentials. Direct starts use the sole Lucid `pg` connection with optional verified TLS. A bounded authenticated preflight runs before migrations without leaking driver messages or secrets.

## Migration and rollback

- Earlier additive migrations supply auth rate limits, upload reservations, auth versions and public release indexes. PostgreSQL fresh/seeded upgrade/down/reapply is now the supported verification path; prior SQLite/MySQL checks are historical evidence only.
- Newly issued password-reset tokens are hashed. Existing plaintext reset tokens continue to verify only until their current one-hour expiry; a successful legacy-token reset consumes them in the same transaction. The additive auth-version migration deletes existing persistent remember tokens and logs out sessions that lack the new version field, so users sign in again once after upgrade.
- Newly uploaded storage keys are unique and channel-independent. Existing object keys remain readable and are not rewritten.
- Production recovery uses a verified database backup and matching application/storage configuration. Full reset is exercised only against disposable PostgreSQL databases. Cross-backend migration is an explicit offline JSON import into an empty migrated PostgreSQL target, described in `docs/postgresql.md`.

## PostgreSQL-only transition

- The supported runtime has one Lucid `pg` connection, using native UUID, JSONB, boolean and timestamp types. Remove SQLite/MySQL drivers, connection branches, environment aliases and executable verification/benchmark paths. Keep OTA URLs and storage keys/checksums unchanged.
- Compose provisions PostgreSQL 17 on its private network with its own persistent volume. A one-shot initializer creates a random database password in a separate private volume when `POSTGRES_PASSWORD` is absent; both the database and app read that password file. Compose's managed connection is explicit and does not reuse legacy `.env` MySQL host/port settings. Direct starts use `DB_*` settings, with optional verified TLS.
- Keep migration identities and applied history. Repair historical statements only where they prevent a fresh PostgreSQL bootstrap (deferred trigger ordering and UUID foreign key). Add a new migration for deployed PostgreSQL schema changes. Verify fresh, rollback/reapply and seeded upgrade paths on disposable PostgreSQL databases.
- Tests and verification scripts create randomly named PostgreSQL databases, reject direct use of a normal database by the test runner, and remove only resources they created. CI uses PostgreSQL. Runtime smoke covers migration, seed, CSRF/login, CMS, OTA validation and assets.
- Provide an explicit transactional JSON data-import path into an empty migrated PostgreSQL target for SQLite/MySQL exports; validate constraints, preserve IDs/metadata/object keys, and invalidate old authentication tokens at cutover. Do not automatically migrate or remove existing databases/volumes.

- PostgreSQL `COUNT`/`int8` results are normalized at domain boundaries; release pagination uses Lucid to strip aggregate-incompatible columns/order. Dashboard buckets use UTC and exclude soft-deleted history. CMS text search uses ILIKE.
- Default software/provider changes use transaction-scoped advisory locks. A new migration enforces one active default product and live provider uniqueness, indexes activity and supplies the Adonis PostgreSQL session table. Cookie and database sessions are supported; the previously advertised but unconfigured memory store is rejected.

- License issuance/removal locks its license row and commits activation/count/signing state together. Removal checks both IDs; machine IDs and expiry are validated. Signing-key initialization uses advisory namespace 3 to preserve one key across instances.
