# Signed OTA releases

Reeva can attach an Ed25519 signature to a release manifest. The private key
stays with the publisher or an isolated signing service; Reeva stores only
public keys and detached signatures. The app must pin the matching public key
and verify the signature and downloaded artifact locally before installation.
Sending a public key to Reeva does not authenticate an app.

For production key custody, signing authorization, HSM/KMS compatibility, and
recovery requirements, read [Private key security research](private-key-security.md).
The file-based CLI below generates an unencrypted PEM; owner-only permissions
do not provide hardware-backed key protection.

Docker Compose also includes a Rust/OpenBao managed signer. Its initialization,
independent approval, and CMS integration are documented in [signer operations](signer-operations.md).

The additive migration `1777400000000_add_ota_release_signatures` adds the
policy, key, and signature columns. A rollback drops registered public keys and
release signatures, so only roll it back as a coordinated application
downgrade after taking a verified database backup and disabling the signed-only
policy.

## Enable signing for a software product

1. On a trusted signing workstation, generate a key pair:

   ```sh
   node scripts/ota_signing.mjs generate ./reeva-signing-key
   ```

   Back up `reeva-ota-private.pem` securely and keep it off the Reeva server.
   The script creates it with owner-only permissions on POSIX systems. Do not
   commit either key file.

2. Register `reeva-ota-public.pem` under **CMS → Software → OTA signing keys**.
   Embed that public key in the client app. The key ID is the lowercase hex
   SHA-256 fingerprint of the public key's DER SPKI encoding.

3. Upload the artifact as a draft. On its edit page, review the manifest and
   copy the base64url payload. Sign it on the trusted workstation:

   ```sh
   node scripts/ota_signing.mjs sign \
     --payload-base64url '<payload shown by Reeva>' \
     --private-key ./reeva-signing-key/reeva-ota-private.pem
   ```

   Paste the output into the artifact's detached-signature field. Reeva checks
   it against the selected active public key before saving. Then publish the
   artifact. If the product requires signed updates, publishing an unsigned or
   invalidly signed artifact is rejected.

4. Sign all currently published releases before enabling **Require verified
   signatures**. Reeva checks each current public release and only enables the
   policy when its signature is valid. With the policy on, all OTA check,
   latest, release-list, direct-download, and local-storage paths exclude
   unsigned releases and releases signed by revoked keys.

## Client verification contract

The check/latest/releases response keeps its existing fields and may include:

```json
{
  "signedManifest": {
    "payload": "<base64url UTF-8 JSON bytes>",
    "signature": "<base64url 64-byte Ed25519 signature>",
    "keyId": "<64 lowercase hex characters>"
  }
}
```

The decoded payload is compact UTF-8 JSON with these fields in this order:
`schemaVersion`, `software`, `version`, `codename`, `changelog`, `channel`,
`platform`, `architecture`, `fileName`, `sizeBytes`, `sha256`. Clients must
verify the signature over the decoded payload bytes with a pinned key whose
fingerprint matches `keyId`; then parse the verified JSON and compare its
software, version, channel, platform, and architecture with the requested
update context. After downloading, verify the artifact's exact byte count and
SHA-256 against the signed manifest before installing it. Treat missing,
unknown-key, malformed, or invalid signatures as a failed update. Do not send
the pinned public key to Reeva as proof of app identity.

Clients should also persist their highest installed version and reject
rollback. This manifest protocol does not yet provide TUF-style expiring
repository metadata, freeze-attack detection, threshold roles, or online
timestamp signing. A compromised API can still suppress a newer release. Use a
TUF client and repository metadata if those protections are required.

## Key rotation and compatibility

Register the new public key before using its private key. Ship an app update
that trusts both the old and new public keys, signed with the old key; then
start signing new releases with the new key. Re-sign any published artifacts
that must remain available after revoking the old key. Revocation immediately
removes signatures made by that key; clients that pin only the revoked key
cannot verify releases signed by the replacement key.

The API additions are optional for existing clients. Old clients that ignore
`signedManifest` do not gain signature protection, even when signatures are
available. Set **Require verified signatures** after deploying clients that
enforce verification. Reeva's private key is never uploaded to or stored by
Reeva in this workflow.
