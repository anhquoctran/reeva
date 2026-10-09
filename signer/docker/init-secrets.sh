#!/bin/sh
set -eu
umask 077
mkdir -p /authority /signer-tls /bao-tls /trust /auth /requester /approver /db-secret /db-admin /operator /bao-client /artifacts

# Authority is mounted only into this one-shot initializer, never into Reeva,
# signer, or OpenBao. Private-cloud host administrators remain trusted.
if [ ! -f /authority/ca.key ]; then
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out /authority/ca.key.tmp 2>/dev/null
  mv /authority/ca.key.tmp /authority/ca.key
fi
if [ ! -f /trust/ca.pem ]; then
  openssl req -x509 -new -sha256 -days 3650 -key /authority/ca.key \
    -subj '/CN=Reeva private signing CA' -out /trust/ca.pem.tmp
  mv /trust/ca.pem.tmp /trust/ca.pem
fi
issue() {
  directory="$1"; hostname="$2"
  if [ ! -f "$directory/key.pem" ]; then
    openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$directory/key.pem.tmp" 2>/dev/null
    mv "$directory/key.pem.tmp" "$directory/key.pem"
  fi
  if [ ! -f "$directory/cert.pem" ]; then
    openssl req -new -key "$directory/key.pem" -subj "/CN=$hostname" -out "$directory/request.csr"
    printf 'subjectAltName=DNS:%s,DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n' "$hostname" > "$directory/extensions"
    openssl x509 -req -sha256 -days 365 -in "$directory/request.csr" -CA /trust/ca.pem \
      -CAkey /authority/ca.key -set_serial "0x$(openssl rand -hex 16)" \
      -extfile "$directory/extensions" -out "$directory/cert.pem.tmp" 2>/dev/null
    mv "$directory/cert.pem.tmp" "$directory/cert.pem"
    rm "$directory/request.csr" "$directory/extensions"
  fi
  openssl verify -CAfile /trust/ca.pem "$directory/cert.pem" >/dev/null
}
issue /signer-tls signer
issue /bao-tls openbao
secret() {
  path="$1"
  if [ ! -f "$path" ]; then
    openssl rand -hex 32 > "$path.tmp"
    mv "$path.tmp" "$path"
  fi
}
secret /requester/token
secret /approver/token
secret /db-secret/password
secret /db-admin/password
cp /requester/token /auth/requester
cp /approver/token /auth/approver
chown -R 10001:10001 /signer-tls /auth /approver /operator /bao-client /db-secret /artifacts
chown -R 1000:1000 /requester
# The pinned OpenBao image uses UID 100, GID 1000.
chown -R 100:1000 /bao-tls
chmod 700 /bao-tls
chmod 600 /bao-tls/key.pem
chmod 755 /trust /db-secret /db-admin
chmod 444 /bao-tls/cert.pem /trust/ca.pem /db-secret/password /db-admin/password
chmod 700 /signer-tls /auth /approver /operator /bao-client /requester /artifacts
chmod 600 /signer-tls/key.pem /auth/* /approver/token /requester/token
echo 'Signing transport and role credentials ready; no vault has been unsealed.'
