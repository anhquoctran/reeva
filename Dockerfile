# Dockerfile

FROM node:24-alpine AS base
# Enable Corepack and activate Yarn so builds can use `yarn` when needed
RUN corepack enable && corepack prepare yarn@stable --activate

# Stage 1: Install all dependencies (development + production)
FROM base AS deps
WORKDIR /app
ADD package.json yarn.lock ./
RUN yarn install

# Stage 2: Install production only dependencies
FROM base AS production-deps
WORKDIR /app
ADD package.json yarn.lock ./
RUN yarn workspaces focus

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
COPY --from=production-deps /app/node_modules /app/node_modules
COPY --from=build /app/build /app/build
COPY --from=build /app/package.json /app/package.json
# Ensure Node ESM import aliases (package.json 'imports') are available in production
# so #services/* etc resolve correctly for runtime paths.

EXPOSE 3333
CMD ["node", "build/bin/server.js"]
