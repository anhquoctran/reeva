#!/bin/sh
set -eu

# The application owns its database but cannot create roles/databases or bypass RLS.
# psql quotes both identifiers and literals; passwords are never printed.
psql --set=ON_ERROR_STOP=1 --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" \
  --set=app_user="$REEVA_DB_USER" --set=db_name="$POSTGRES_DB" \
  --set=app_password="$(cat /run/reeva-secrets/db_password)" <<'SQL'
CREATE ROLE :"app_user" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'app_password';
ALTER DATABASE :"db_name" OWNER TO :"app_user";
GRANT USAGE, CREATE ON SCHEMA public TO :"app_user";
SQL
