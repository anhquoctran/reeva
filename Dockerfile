# Dockerfile

FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.20.0 --activate

# Stage 1: Install all dependencies (development + production)
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile

# Stage 2: Install production only dependencies
FROM base AS production-deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN pnpm install --prod --frozen-lockfile

# Stage 3: Build the application
FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules /app/node_modules
ADD . .
# Build only needs schema-valid dummy configuration; production credentials are
# supplied when the container runs and are never copied into the image.
RUN NODE_ENV=production PORT=3333 HOST=0.0.0.0 LOG_LEVEL=info \
    APP_KEY=build-only-key-012345678901234567890123456789 \
    APP_URL=http://localhost:3333 SESSION_DRIVER=cookie DB_CONNECTION=sqlite \
    MAIL_MAILER=smtp MAIL_FROM_NAME=Reeva MAIL_FROM_ADDRESS=build@example.invalid \
    SMTP_HOST=localhost SMTP_PORT=1025 node ace build

# Stage 4: Final production image
FROM base AS production
ENV NODE_ENV=production
WORKDIR /app
COPY --from=production-deps /app/node_modules /app/node_modules
COPY --from=build /app/build /app/build
COPY --from=build /app/package.json /app/package.json
RUN mkdir -p /app/storage/uploads && chown -R node:node /app/storage
USER node

EXPOSE 3333
CMD ["node", "build/bin/server.js"]
