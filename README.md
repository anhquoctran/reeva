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

## Prerequisites

- Node.js >= 24.0.0
- npm or yarn

## Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd reeva
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   Copy `.env.example` to `.env` and configure your settings.

4. Run database migrations:
   ```bash
   npm run db:migrate
   ```

5. Seed the database (optional):
   ```bash
   npm run db:seed
   ```

## Development

Start the development server with hot module replacement:
```bash
npm run dev
```

## Building

Build the application for production:
```bash
npm run build
```

## Running

Start the production server:
```bash
npm start
```

## Testing

Run the test suite:
```bash
npm test
```

## Docker

You can also run the application using Docker:

1. Build and start the containers:
   ```bash
   docker-compose up --build
   ```

## Scripts

- `npm run dev` - Start development server with HMR
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run test` - Run tests
- `npm run lint` - Lint code
- `npm run format` - Format code
- `npm run typecheck` - Type check
- `npm run db:migrate` - Run database migrations
- `npm run db:seed` - Seed database
- `npm run db:fresh` - Reset and seed database

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

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and linting
5. Submit a pull request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.