-- Independent signer database; contains no private key material.
CREATE TABLE IF NOT EXISTS signing_requests (
  id varchar(64) PRIMARY KEY,
  product varchar(80) NOT NULL,
  payload text NOT NULL,
  payload_digest varchar(64) NOT NULL,
  key_id varchar(64) NOT NULL,
  key_version integer NOT NULL CHECK (key_version > 0),
  public_key text NOT NULL,
  status varchar(16) NOT NULL CHECK (status IN ('pending', 'signed')),
  signature varchar(86),
  expires_at bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'signed') = (signature IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS signer_expiry ON signing_requests(expires_at) WHERE signature IS NULL;
CREATE TABLE IF NOT EXISTS signing_audit (
  id bigserial PRIMARY KEY,
  request_id varchar(64) NOT NULL,
  event varchar(32) NOT NULL,
  actor varchar(32) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
