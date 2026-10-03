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
   Copy `.env.example` to `.env` and configure your settings.

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
Docker Compose. Set `PORT` to override it; Docker Compose publishes the same
port on the host and in the container.

## Building

Build the application for production:

```bash
pnpm build
```

## Running

Start the production server:

```bash
pnpm start
```

### Docker Compose quick start

From the repository root, run:

```bash
docker compose up -d --build
```

Compose uses SQLite in a persistent named volume by default, creates and persists
an application key when one is not configured, applies pending migrations,
seeds the base data, and starts Reeva on port `8888`. No `.env` file or separate
migration command is required.

Set both `ADMIN_EMAIL` and `ADMIN_PASSWORD` (at least 16 characters) in `.env`
before starting to create the initial root account. Without them, no default or
shared administrator password is created and CMS login remains unprovisioned.
To use MySQL, set `DB_CONNECTION=mysql` and provide a database reachable from the
container via `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and `DB_DATABASE`.
Configure SMTP as well if password reset and other email delivery are needed.

To use AWS S3 or an S3-compatible service such as MinIO, SeaweedFS, OCI Object
Storage, or Cloudflare R2, set `STORAGE_DRIVER=s3` and the `S3_*` variables in
`.env`. The bucket must already exist. See [S3-compatible object storage](docs/object-storage.md)
for provider examples and the compatibility boundary.

Check startup with `docker compose ps` and view application logs with `docker compose logs -f app`.

## Managing multiple software products

Root users can add products at **CMS → Software**. Each product has a permanent lowercase slug, its own semantic-version sequence, and active/default state. A version belongs to exactly one product; artifacts inherit that product from their version. Slugs appear in OTA API paths and should be treated as stable client identifiers.

The additive database migration creates the default product with slug `reeva` and moves every existing version under it. When an `appName` setting exists, its value becomes the display name; otherwise the display name is `Reeva`. Existing artifacts stay attached to the same versions and keep their storage keys and checksums. New artifact filenames use their product's display name.

Existing clients can keep using `/api/check`, `/api/latest`, `/api/releases`, and `/api/download/:id`; these paths use whichever active product is marked default. New clients should use the product-scoped paths:

```text
GET /api/software/:slug/check?platform=windows&arch=x64&channel=stable&version=1.2.3
GET /api/software/:slug/latest?platform=windows&arch=x64&channel=stable
GET /api/software/:slug/releases?platform=windows&arch=x64&channel=stable&page=1&limit=20
GET /api/software/:slug/download/:id
```

The API remains public. Product-specific download URLs returned from the scoped endpoints retain the slug, so an artifact cannot be downloaded through another product's path. Deactivating a product immediately removes its releases from public OTA selection and download while retaining the database rows and stored objects. Select a new default before deactivating the current default. Version numbers may repeat across different products but remain unique within one product.

## Testing

Run the test suite:

```bash
pnpm test
```

## Docker

You can also run the application using Docker:

1. Build and start the containers:
   ```bash
   docker compose up --build
   ```

## Scripts

- `pnpm dev` - Start development server with HMR
- `pnpm build` - Build for production
- `pnpm start` - Start production server
- `pnpm test` - Run tests
- `pnpm lint` - Lint code
- `pnpm format` - Format code
- `pnpm typecheck` - Type check
- `pnpm verify:production-smoke` - Smoke test the built production server using a temporary SQLite database
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
- Configure the database and `APP_KEY` before starting; run `pnpm db:migrate` as a release step before deploying new application code.
- Set `MAX_UPLOAD_SIZE` to the maximum multipart request size your proxy and temporary disk can support. Uploads are streamed to storage after body parsing.
- The server does not trust forwarded headers by default. Set `TRUSTED_PROXIES` to the reverse proxy IPs/CIDRs when running behind a proxy.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and linting
5. Submit a pull request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
