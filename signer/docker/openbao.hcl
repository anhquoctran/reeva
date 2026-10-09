ui = false
disable_mlock = true
storage "raft" {
  path = "/openbao/file"
  node_id = "reeva-bao-1"
}
api_addr = "https://openbao:8200"
cluster_addr = "https://openbao:8201"
listener "tcp" {
  address = "0.0.0.0:8200"
  cluster_address = "0.0.0.0:8201"
  tls_cert_file = "/bao-tls/cert.pem"
  tls_key_file = "/bao-tls/key.pem"
  tls_min_version = "tls12"
}
