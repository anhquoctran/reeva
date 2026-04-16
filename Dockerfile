# Dockerfile

FROM node:24-alpine AS base

# Enable Corepack and prepare pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Stage 1: Install all dependencies for build
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Stage 2: Install production only dependencies
# We use hoisted linker to ensure node_modules is self-contained and copyable
FROM base AS production-deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm config set node-linker hoisted && \
    pnpm install --prod --frozen-lockfile

# Stage 3: Build the application
FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules /app/node_modules
ADD . .
# make SWC baseUrl absolute (fixes - base_dir('./') must be absolute) and skip Vite in constrained container builds
RUN node ace build

# Stage 4: Final production image
FROM base AS production
ENV NODE_ENV=production
WORKDIR /app
# Copy hoisted node_modules
COPY --from=production-deps /app/node_modules /app/node_modules
COPY --from=build /app/build /app/build
COPY --from=build /app/package.json /app/package.json

EXPOSE 3333
CMD ["node", "build/bin/server.js"]
