FROM node:24-alpine
RUN apk add --no-cache openssl
WORKDIR /tools
COPY signer/docker/init-secrets.sh /tools/init-secrets.sh
COPY scripts/signer_admin.mjs /tools/signer_admin.mjs
USER 10001
ENTRYPOINT ["node", "/tools/signer_admin.mjs"]
