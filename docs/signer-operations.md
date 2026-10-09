# Private-cloud OTA signer

Reeva includes a Rust service under `signer/`, using OpenBao Transit for pure
Ed25519 signing. Reeva holds public keys/signatures and a **requester** credential.
The **approver** and **vault operator** tools have separate volume mounts and
credentials. No private signing key is uploaded to Reeva or exported by this flow.

This is software-backed custody, not an HSM or FROST implementation. A
compromised signer can use its OpenBao signing credential. A compromised unsealed
OpenBao host can expose software-held keys. Docker/root/hypervisor administrators
on a single host can access all mounted secrets. These are explicit trust limits.

## Start and initialize

```sh
docker compose up -d --build
docker compose run --rm signer-operator init
docker compose run --rm signer-operator provision YOUR_SOFTWARE_SLUG
```

The first command starts Reeva, its PostgreSQL, signer, a separate signer
PostgreSQL, and OpenBao. Reeva is published on host port **8797** by default
(container port 8888). No signer,
database, or OpenBao port is published. HTTPS is verified using a generated
private CA; requester/approver tokens and database passwords are generated into
role-specific persistent volumes. Keep volume ownership intact.

`init` is an explicit, one-time ceremony. It creates three Shamir unseal shares
with threshold two, temporarily records recovery material and the initial root
token in the operator-only volume, unseals OpenBao, waits for its active leader,
and issues the signer a restricted 24-hour periodic token. The Rust service
renews that token hourly. Missing/expired tokens, a sealed vault, provider errors,
or invalid signatures prevent new signing; there is no PEM fallback.

For production, transfer unseal shares to independent offline custodians. Do
not leave all shares beside the vault snapshot in the same backup or host.
After provisioning the initial products, revoke/remove the initial root token:

```sh
docker compose run --rm signer-operator retire-root
```

The command leaves the shares in the temporary recovery file so operators can
export them; it does not distribute shares or erase backups. Remove that local
recovery file after verified offline custody is established. The default file
is `/operator/initialization.json` inside the operator tool. Keeping it locally
is a convenience for development and defeats independent recovery custody.

Future administration can use `SIGNER_OPERATOR_TOKEN_FILE` mounted into the
operator tool, obtained through your OpenBao administration/authentication
procedure. `SIGNER_RECOVERY_FILE` can point to a temporarily mounted recovery
JSON containing a `keys` array for unseal; never provide this file to Reeva,
signer, or the approver container. Avoid secrets in shell history and logs.

`init` refuses to overwrite an existing vault or recovery file. If initialization
fails, inspect the vault and protected recovery file before retrying. An empty
placeholder file is not a usable backup. Never reset a vault volume to bypass
an initialization or unseal problem.

## Publish a signed release

1. A vault operator provisions the product key using its **permanent API slug**.
   The command prints only public key material, fingerprint, and key version.
2. In **CMS → Software**, import the managed signer public key. Embed the public
   key in the client through your trusted build/release process. CMS registration
   alone cannot establish client trust.
3. Upload a draft, open its edit page, and click **Request managed signature**.
   The request ID binds the product, public key fingerprint, and exact manifest
   bytes. Repeated requests for the same content are idempotent.
4. On the trusted approval workstation, review the manifest using the separate
   approver tool. Obtain the build artifact independently of the Reeva server:

   ```sh
   docker compose run --rm signer-admin review REQUEST_ID
   docker compose run --rm \
     -v /absolute/path/to/trusted-build:/build:ro \
     signer-admin approve REQUEST_ID /build/app.bin REVIEWED_PAYLOAD_DIGEST
   ```

   The approval command streams the local artifact to compute SHA-256 and size,
   compares them with the reviewed manifest, and submits an approval bound to
   the exact manifest digest and request expiry. Check product, version, channel,
   platform, architecture, and key fingerprint during review. A correct hash
   cannot establish that a malicious build pipeline produced safe software.
5. In CMS, refresh the artifact page, **Import approved signature**, then publish.
   Reeva verifies the exact current manifest again. Metadata changes require a
   new signature. There is no signing approval endpoint in the CMS.
6. Sign existing active releases before enabling **Require verified signatures**.
   Clients must enforce signatures themselves, verify signed context and downloaded
   hash/size, and reject unknown keys and rollback. Existing clients that ignore
   signature metadata gain no signature protection.

Pending requests expire after 24 hours. Approval after expiry is rejected.
Resubmitting an expired pending request renews its expiry and requires renewed
approval; stale expiry-bound approvals are rejected. Signatures already issued
do not expire through this request TTL. TUF-style freshness is not implemented.

## Operations and scale

```sh
docker compose up -d --scale signer=2
```

Replicas share durable request/audit state in PostgreSQL; row locks serialize
approval of the same request. Completed requests return the stored result.
Audit insertion and result storage commit together before a signature is exposed.
A crash after OpenBao signs but before DB commit can cause another signing call
on retry; the implementation does not promise exactly-once backend operations.

The default Compose deployment has **one OpenBao node and one signer database**.
Several containers on one machine do not provide host failure tolerance. For
production HA, deploy signer replicas on different hosts and operate an HA
OpenBao cluster and PostgreSQL separately. The signer supports `OPENBAO_URL`,
`OPENBAO_TOKEN_FILE`, `SIGNER_CA_FILE`, `SIGNER_DB_HOST`, and
`SIGNER_DB_PASSWORD_FILE` for that deployment. Extend the trust bundle for an
external HTTPS backend; do not disable certificate validation.

After an OpenBao restart it stays sealed:

```sh
docker compose run --rm signer-operator unseal
```

Use independently held recovery material in production. Reeva can still serve
previously published signed artifacts while new signing is unavailable.
`/health` checks process liveness; `/ready` also checks the signer DB and usable
OpenBao runtime credential. Compose health is liveness and does not certify
that custody is unsealed or a product key exists.

Requests are bounded to 10,000 stored rows, incoming bodies to 128 KiB, payloads
to 120,000 base64url characters, concurrent HTTP requests to 64, and concurrent
signing operations to eight per replica. A 30-second handler deadline bounds
body processing and backend/DB work; caller timeouts can be shorter. A timed-out
caller should retrieve the request's state before retrying, because a completed
commit can outlive the response. Expired unsigned rows older than an additional day are pruned on new
submission. Export audit and arrange a reviewed retention policy before pruning
completed requests. Audit rows are retained, so monitor database size. Logs
contain request IDs/outcomes, not tokens, private material, or provider bodies.

The application audit table is transactional, not tamper-proof. A compromised
signer/database administrator can alter it. Export records to an independently
administered log destination when tamper detection or compliance requires it.

Initial transport leaf certificates last one year and the private CA ten years.
Monitor expiry. Renew leaf certificates using your PKI, atomically replace the
corresponding TLS volume files, and restart signer/OpenBao; unseal OpenBao after
restart. Rotate trust roots and requester/approver credentials as coordinated
changes. Signer loads role credentials at startup, so credential replacement
requires signer restart and corresponding caller credential replacement.

Back up signer PostgreSQL, OpenBao Raft snapshots, transport identity, and
credentials using encrypted, access-controlled backup procedures. Keep unseal
custody separate. Never run `docker compose down -v` against a deployed stack:
that removes signing keys and application data. Test restoration with synthetic
data in an isolated environment, including signer request identity and the
client's trusted public-key fingerprint.

Revoking a token or disabling a key stops new use; it cannot revoke signatures
already held by clients. Key rotation must include authenticated client trust
transition as described in [OTA signatures](ota-signatures.md). Do not enable
provider auto-rotation before clients trust the replacement key. The runtime
token cannot export, create, configure, or delete product keys. Product
administration remains an operator responsibility.

## Development verification

```sh
cargo fmt --manifest-path signer/Cargo.toml --check
cargo clippy --manifest-path signer/Cargo.toml --locked --all-targets -- -D warnings
cargo test --manifest-path signer/Cargo.toml --locked
cargo audit --file signer/Cargo.lock
pnpm typecheck
pnpm lint
pnpm test
pnpm verify:migration-upgrade
pnpm build
pnpm verify:production-smoke
pnpm verify:docker-compose
node scripts/benchmark_ota_signatures.mjs
```

The Compose verifier copies source into a temporary directory, generates a new
project and synthetic keys, exercises real OpenBao/PostgreSQL, and removes only
that project's volumes. It does not use the repository's `.env` or deployed data.
Actual results and limitations belong in [verification](verification.md).
