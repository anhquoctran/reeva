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
RUN node ace build --ignore-ts-errors
# Debug: verify build output
RUN echo "=== BUILD OUTPUT ===" && \
    ls -la build/app/services/storage/ && \
    echo "=== BUILD PACKAGE.JSON IMPORTS ===" && \
    node -e "console.log(JSON.stringify(require('./build/package.json').imports, null, 2))" && \
    echo "=== COMPILED PROVIDER IMPORT ===" && \
    head -1 build/providers/storage_provider.js

# Stage 4: Final production image
FROM base AS production
ENV NODE_ENV=production
WORKDIR /app

# Copy production dependencies
COPY --from=production-deps /app/node_modules /app/node_modules
# Copy built app
COPY --from=build /app/build/ /app/

# Debug: verify final container structure
RUN echo "=== FINAL CONTAINER ===" && \
    ls -la /app/app/services/storage/ && \
    echo "=== PACKAGE.JSON ===" && \
    node -e "console.log(JSON.stringify(require('./package.json').imports, null, 2))" && \
    echo "=== TEST RESOLUTION ===" && \
    node -e "try { require.resolve('#services/storage/storage_manager'); console.log('RESOLVED OK') } catch(e) { console.log('RESOLVE FAILED:', e.message) }"

EXPOSE 3333
CMD ["node", "bin/server.js"]
