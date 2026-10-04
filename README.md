# Reeva

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

An Over-The-Air (OTA) release management system built with AdonisJS.

## Features

- Built with AdonisJS framework
- TypeScript support
- Database migrations and seeders
- Authentication and authorization
- Platform and architecture management
- Artifact storage and versioning
- Download history tracking
- CMS for managing releases
- API endpoints for OTA updates
- Multiple independent software products with product-scoped versions and OTA releases

## Prerequisites

- Node.js >= 24.0.0
- pnpm 11.20.0 (pinned in `package.json`)
- PostgreSQL 17 for direct starts, or Docker Compose for a managed database

## Installation

1. Clone the repository:

   ```bash
   git clone <repository-url>
   cd reeva
   ```

2. Install dependencies:

   ```bash
   pnpm install --frozen-lockfile
   ```

3. Set up environment variables:
   Copy `.env.example` to `.env`. Configure a PostgreSQL database with `DB_CONNECTION=pg`, `DB_HOST`, `DB_PORT=5432`, `DB_USER`, `DB_PASSWORD` (or `DB_PASSWORD_FILE`), and `DB_DATABASE`. The role must own its application database to run migrations. SQLite and MySQL are no longer supported. For remote TLS, set `DB_SSL=true` and optionally `DB_SSL_CA_PATH` to a PEM CA file; server certificates are verified.

4. Run database migrations:

   ```bash
   pnpm db:migrate
   ```

5. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` (at least 16 characters) before seeding the initial root account, then seed the database:
   ```bash
   pnpm db:seed
   ```

## Development

Start the development server with hot module replacement:

```bash
pnpm dev
```

The default HTTP port is `8888` for development, production, PM2, Docker, and
Docker Compose. Set `PORT` to override the app/container port and its default
host mapping. For Compose only, `HOST_PORT` can override the host-side port
without changing the app's internal port. When it differs from the public URL,
set `APP_URL` to that URL as well (for password-reset links and generated URLs).

## Building

Build the application for production:

```bash
pnpm build
```

## Running

Start the production server:

```bash
cd build
NODE_ENV=production node --env-file=../.env bin/server.js
```

The build does not copy `.env`. Supply process environment variables instead
of `--env-file` when your deployment injects configuration.

### Docker Compose quick start

From the repository root, run:

```bash
docker compose up -d --build
```

Compose starts **PostgreSQL 17** on a private network, generates and persists random database credentials and an application key, applies pending migrations, seeds base data, and starts Reeva at **http://localhost:8888**. No `.env` file or separate migration command is required. Database data, credentials and local objects have separate persistent named volumes. The application role cannot create roles/databases or act as a superuser. PostgreSQL is not exposed on a host port.

Set both `ADMIN_EMAIL` and `ADMIN_PASSWORD` (at least 16 characters) in `.env` before starting to create the initial root account. Without them, CMS login remains unprovisioned; there is no shared administrator password. Configure SMTP for password reset email delivery.

Set `MAIL_ENABLED=false` in `.env` to temporarily disable password reset email delivery. Recreate the app container with `docker compose up -d --no-deps app` to apply the setting; rebuilding the image is not required. Set it back to `true` to re-enable email.

Compose uses `POSTGRES_USER` and `POSTGRES_DB` (both default to `reeva`). Leave `POSTGRES_PASSWORD` blank to generate a random persistent password. Keep these settings stable after the first start: changing credentials requires coordinated database role and secret rotation. Direct-start `DB_*` settings, including legacy `DB_CONNECTION=mysql`, do not override Compose's managed PostgreSQL connection. Startup validates connectivity and authentication before migrations and reports safe error codes.

**Existing SQLite/MySQL data is not automatically transferred.** Existing storage volumes and source databases are preserved. Stop writes, back up the source, and follow [the PostgreSQL migration guide](docs/postgresql.md) before starting normal seeding on the destination. An empty PostgreSQL database is a new installation, not a migration of your previous releases.

To use AWS S3 or an S3-compatible service such as MinIO, SeaweedFS, OCI Object
Storage, or Cloudflare R2, add and configure it at **CMS → Storage**. Provider
settings are encrypted in PostgreSQL and can be activated at runtime without
restarting the app. The bucket must already exist. See
[object storage](docs/object-storage.md) for provider examples, upgrade notes,
and the compatibility boundary.

Check startup with `docker compose ps` and view application logs with `docker compose logs -f app`.

## Managing multiple software products

Root users can add products at **CMS → Software**. Reeva generates a safe lowercase slug from the product name; duplicate names receive a numeric suffix. The slug is permanent after creation, has its own semantic-version sequence, and identifies the product in OTA API paths. A version belongs to exactly one product; artifacts inherit that product from their version.

The additive database migration creates the default product with slug `reeva` and moves every existing version under it. When an `appName` setting exists, its value becomes the display name; otherwise the display name is `Reeva`. Existing artifacts stay attached to the same versions and keep their storage keys and checksums. New artifact filenames use their product's display name.

Existing clients can keep using `/api/check`, `/api/latest`, `/api/releases`, and `/api/download/:id`; these paths use whichever active product is marked default. New clients should use the product-scoped paths:

```text
GET /api/software/:slug/check?platform=windows&arch=x64&channel=stable&version=1.2.3
GET /api/software/:slug/latest?platform=windows&arch=x64&channel=stable
GET /api/software/:slug/releases?platform=windows&arch=x64&channel=stable&page=1&limit=20
GET /api/software/:slug/download/:id
```

The client-facing OpenAPI 3.1 JSON is available in [`public/openapi-client.json`](public/openapi-client.json) and is served at `/openapi-client.json` on a running Reeva instance. It documents both the product-scoped endpoints and the legacy default-product endpoints.

The API remains public. Product-specific download URLs returned from the scoped endpoints retain the slug, so an artifact cannot be downloaded through another product's path. Deactivating a product immediately removes its releases from public OTA selection and download while retaining the database rows and stored objects. Select a new default before deactivating the current default. Version numbers may repeat across different products but remain unique within one product.

## Testing

Run the test suite (creates and removes a disposable PostgreSQL container/database; Docker must be available):

```bash
pnpm test
```

## Scripts

- `pnpm dev` - Start development server with HMR
- `pnpm build` - Build for production
- `pnpm start` - Start production server
- `pnpm test` - Run tests
- `pnpm lint` - Lint code
- `pnpm format` - Format code
- `pnpm typecheck` - Type check
- `pnpm verify:production-smoke` - Smoke test the isolated production build with a disposable PostgreSQL database
- `pnpm verify:docker-compose` - Verify a fresh isolated Compose startup, health, restricted DB role and restart persistence (uses an ephemeral host port)
- `pnpm verify:migration-upgrade` - Verify PostgreSQL fresh/upgrade/rollback paths
- `pnpm verify:legacy-import` - Verify atomic legacy imports and safety guards
- `pnpm db:import --file /secure/export.json --empty-target --dry-run` - Validate a legacy export against an empty migrated PostgreSQL target
- `pnpm db:migrate` - Run additive database migrations
- `pnpm db:seed` - Seed database; requires initial root credentials
- `pnpm db:fresh` - Destructively reset and seed the database (development only)

## Project Structure

- `app/` - Application code
  - `controllers/` - HTTP controllers
  - `models/` - Database models
  - `services/` - Business logic services
  - `repositories/` - Data access repositories
  - `middleware/` - HTTP middleware
- `config/` - Configuration files
- `database/` - Database migrations and seeders
- `public/` - Static assets
- `resources/` - Views and frontend resources
- `start/` - Application startup files
- `tests/` - Test files

## Deployment notes

- The container runs as the unprivileged `node` user and stores local artifacts in the persistent `/app/storage` volume.
- For direct starts, configure PostgreSQL and `APP_KEY`, migrate, seed and build before launching `build/bin/server.js`. Compose performs these startup steps and persists its generated key.
- Back up the PostgreSQL database, credential volumes, application key and object storage together. Do not remove named volumes to resolve connection errors.
- Tests accept only generated `reeva_test_*` databases. For CI/existing disposable PostgreSQL, set explicit `REEVA_TEST_PG_HOST`, `REEVA_TEST_PG_PORT`, `REEVA_TEST_PG_USER`, `REEVA_TEST_PG_PASSWORD`; the test role needs permission to create/drop test databases. Application `.env` database credentials are never used.
- Set `MAX_UPLOAD_SIZE` to the maximum multipart request size your proxy and temporary disk can support. Uploads are streamed to storage after body parsing.
- The server does not trust forwarded headers by default. Set `TRUSTED_PROXIES` to the reverse proxy IPs/CIDRs when running behind a proxy.

## Contributing

Contributions use short-lived topic branches and pull requests into `master`.
Use a standard branch prefix and Conventional Commit title, then wait for
review and the `verify` CI check before squash-merging. See the
[Git strategy and contribution flow](docs/git-workflow.md) for branch prefixes,
release tags, hotfixes, and repository rules.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
