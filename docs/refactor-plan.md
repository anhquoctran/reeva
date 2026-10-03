# Refactor plan and target architecture

## Target flow

1. HTTP controllers validate public input and return stable status codes.
2. Authentication gates every CMS route; root-only middleware guards user, storage, and global-settings administration.
3. `ArtifactRepository.publicQuery()` is the single release-eligibility rule. It uses `EXISTS` predicates for version, platform, architecture, and storage-provider state; target lookups then filter artifacts by IDs. Check, latest, releases, API download, and local-file serving all use it.
4. Services own domain rules. API responses use explicit DTOs rather than serializing Lucid models with provider configuration.
5. Storage providers accept `Readable` streams and declared lengths. Uploads reserve quota in a DB transaction, use `artifacts/<reservation UUID>/payload` keys, and compensate by deleting the new object when the DB write fails. The next upload to a provider retries cleanup of expired reservations and their deterministic object keys.
6. Download counters use an atomic SQL increment. Downloads make no third-party geolocation request; new location fields remain null until a licensed HTTPS source is configured.
7. Password reset tokens are stored as SHA-256 digests, consumed once in a transaction, and advance a per-user auth version. Session middleware rejects stale cookies; remember-me remains enabled for 30 days and is rotated by Adonis.
8. Migrations are additive. No deployed database is reset; the user's `yargs-parser` lockfile change is retained. The `braces` advisory has no published fixed release in the current GitHub advisory, so the dependency is locally patched with a bounded parse depth and a regression test until an upstream version is available.
9. S3-compatible services use one AWS SDK SigV4 adapter with `.env`-backed endpoint, region, path-style, credential, retry, and connect/socket-timeout settings; legacy MinIO/SeaweedFS records normalize into that contract. A bounded reusable client pool is closed on shutdown. Build output contains no copied `.env`; deployment injects secrets at runtime. Runtime commit metadata is provided through optional `APP_GIT_SHA`, so the image does not need Git installed.

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

## Migration and rollback

- New auth-rate-limit and upload-reservation tables, the `users.auth_version` column, and the public-release covering index are added without modifying historical migrations. The new migration down/up was exercised on SQLite and MySQL and reverses only these additions.
- Newly issued password-reset tokens are hashed. Existing plaintext reset tokens continue to verify only until their current one-hour expiry; a successful legacy-token reset consumes them in the same transaction. The additive auth-version migration deletes existing persistent remember tokens and logs out sessions that lack the new version field, so users sign in again once after upgrade.
- Newly uploaded storage keys are unique and channel-independent. Existing object keys remain readable and are not rewritten.
- The existing full SQLite `migration:reset` path is not a supported rollback route: an old migration rebuilds a referenced table while foreign-key checks are active. Its historical file remains unchanged. Roll back releases by restoring the pre-upgrade database backup; the newly added migration itself reversed successfully before the old migration failed during the isolated check.
