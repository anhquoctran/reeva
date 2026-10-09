FROM rust:1.98-bookworm AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY schema.sql ./schema.sql
RUN cargo build --release --locked

FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10001 --create-home signer
COPY --from=build /src/target/release/reeva-signer /usr/local/bin/reeva-signer
USER 10001
EXPOSE 8443
ENTRYPOINT ["reeva-signer"]
