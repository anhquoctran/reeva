# Dockerfile

FROM node:24-alpine as base

# Stage 1: Install all dependencies (development + production)
FROM base as deps
WORKDIR /app
ADD package.json package-lock.json ./
RUN npm ci

# Stage 2: Install production only dependencies
FROM base as production-deps
WORKDIR /app
ADD package.json package-lock.json ./
RUN npm ci --omit=dev

# Stage 3: Build the application
FROM base as build
WORKDIR /app
COPY --from=deps /app/node_modules /app/node_modules
ADD . .
RUN node ace build

# Stage 4: Final production image
FROM base
ENV NODE_ENV=production
WORKDIR /app
COPY --from=production-deps /app/node_modules /app/node_modules
COPY --from=build /app/build /app/build
# package.json and other files are already in build/ if you configure correctly, 
# but usually we copy them or the whole build folder contents.
# Adonis 6 build folder is self-contained.

EXPOSE 3333
CMD ["node", "build/bin/server.js"]
