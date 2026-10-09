#!/bin/sh
set -eu
signer_password="$(cat /run/signer-db/password)"
psql -v ON_ERROR_STOP=1 --username postgres --dbname signer --set=signer_password="$signer_password" <<'SQL'
CREATE ROLE signer LOGIN PASSWORD :'signer_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER DATABASE signer OWNER TO signer;
GRANT ALL ON SCHEMA public TO signer;
SQL
