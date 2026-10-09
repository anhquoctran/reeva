use std::{env, sync::Arc, time::Duration};

use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Path, State},
    http::{HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use base64::{
    Engine,
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
};
use ed25519_dalek::{
    Signature, VerifyingKey,
    pkcs8::{DecodePublicKey, EncodePublicKey, spki::der::pem::LineEnding},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row, postgres::PgPoolOptions};
use subtle::ConstantTimeEq;
use tokio::sync::Semaphore;

type Result<T> = std::result::Result<T, ApiError>;

#[derive(Debug)]
struct ApiError(StatusCode, &'static str);
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({"error": self.1}))).into_response()
    }
}
fn invalid(message: &'static str) -> ApiError {
    ApiError(StatusCode::BAD_REQUEST, message)
}
fn unavailable() -> ApiError {
    ApiError(
        StatusCode::SERVICE_UNAVAILABLE,
        "Signing backend unavailable or sealed.",
    )
}
fn database_error(_: sqlx::Error) -> ApiError {
    tracing::error!("signer database operation failed");
    ApiError(
        StatusCode::SERVICE_UNAVAILABLE,
        "Signing database unavailable.",
    )
}

#[derive(Clone)]
struct App {
    db: PgPool,
    bao: Bao,
    requester_hash: [u8; 32],
    approver_hash: [u8; 32],
    slots: Arc<Semaphore>,
    requests: Arc<Semaphore>,
}
#[derive(Clone)]
struct Bao {
    http: reqwest::Client,
    url: String,
    token_file: String,
}

fn digest(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}
fn token_hash(value: &str) -> [u8; 32] {
    Sha256::digest(value.as_bytes()).into()
}
fn check_auth(headers: &HeaderMap, expected: &[u8; 32]) -> Result<()> {
    let token = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or("");
    if token.len() > 256 || !bool::from(token_hash(token).ct_eq(expected)) {
        return Err(ApiError(
            StatusCode::UNAUTHORIZED,
            "Invalid signing identity.",
        ));
    }
    Ok(())
}
fn check_read(headers: &HeaderMap, app: &App) -> Result<()> {
    if check_auth(headers, &app.requester_hash).is_ok() {
        return Ok(());
    }
    check_auth(headers, &app.approver_hash)
}
fn valid_slug(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 80
        && !value.starts_with('-')
        && !value.ends_with('-')
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}
fn valid_hex(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Manifest {
    schema_version: u32,
    software: String,
    version: String,
    codename: Option<String>,
    changelog: Option<String>,
    channel: String,
    platform: String,
    architecture: String,
    file_name: String,
    size_bytes: u64,
    sha256: String,
}
fn parse_payload(payload: &str, product: &str) -> Result<(Vec<u8>, Manifest)> {
    if payload.is_empty() || payload.len() > 120_000 {
        return Err(invalid("Invalid manifest size."));
    }
    let bytes = URL_SAFE_NO_PAD
        .decode(payload)
        .map_err(|_| invalid("Invalid base64url payload."))?;
    if URL_SAFE_NO_PAD.encode(&bytes) != payload {
        return Err(invalid("Noncanonical payload."));
    }
    let m: Manifest =
        serde_json::from_slice(&bytes).map_err(|_| invalid("Invalid release manifest."))?;
    let parts: Vec<_> = m.version.split('.').collect();
    let semver = parts.len() == 3
        && parts.iter().all(|p| {
            !p.is_empty()
                && (p.len() == 1 || !p.starts_with('0'))
                && p.bytes().all(|b| b.is_ascii_digit())
                && p.parse::<u32>().is_ok_and(|n| n <= i32::MAX as u32)
        });
    let context_ok = [&m.platform, &m.architecture]
        .iter()
        .all(|v| !v.is_empty() && v.len() <= 100 && !v.chars().any(char::is_control));
    if m.schema_version != 1
        || !valid_slug(product)
        || m.software != product
        || !semver
        || !["stable", "beta", "dev", "staging"].contains(&m.channel.as_str())
        || !context_ok
        || m.file_name.is_empty()
        || m.file_name.len() > 500
        || m.file_name
            .chars()
            .any(|c| c.is_control() || c == '/' || c == '\\')
        || m.size_bytes > 9_007_199_254_740_991
        || !valid_hex(&m.sha256)
        || m.codename.as_ref().is_some_and(|v| v.len() > 1024)
        || m.changelog.as_ref().is_some_and(|v| v.len() > 90_000)
    {
        return Err(invalid("Unsupported or mismatched release metadata."));
    }
    Ok((bytes, m))
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PublicKey {
    product: String,
    key_version: u32,
    key_id: String,
    public_key: String,
}
impl Bao {
    async fn call(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<Value> {
        let token = tokio::fs::read_to_string(&self.token_file)
            .await
            .map_err(|_| unavailable())?;
        let mut request = self
            .http
            .request(method, format!("{}/v1/{path}", self.url))
            .header("X-Vault-Token", token.trim());
        if let Some(value) = body {
            request = request.json(&value);
        }
        let response = request.send().await.map_err(|_| unavailable())?;
        if !response.status().is_success() {
            return Err(unavailable());
        }
        // Provider metadata is bounded separately from the incoming request body.
        if response.content_length().is_some_and(|n| n > 262_144) {
            return Err(unavailable());
        }
        let mut response = response;
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| unavailable())? {
            if bytes.len() + chunk.len() > 262_144 {
                return Err(unavailable());
            }
            bytes.extend_from_slice(&chunk);
        }
        serde_json::from_slice(&bytes).map_err(|_| unavailable())
    }
    async fn key(&self, product: &str, version: Option<u32>) -> Result<PublicKey> {
        if !valid_slug(product) {
            return Err(invalid("Invalid product slug."));
        }
        let result = self
            .call(
                reqwest::Method::GET,
                &format!("transit/keys/reeva-{product}"),
                None,
            )
            .await?;
        let data = &result["data"];
        if data["type"] != "ed25519"
            || data["derived"] != false
            || data["exportable"] != false
            || data["allow_plaintext_backup"] != false
        {
            return Err(ApiError(
                StatusCode::CONFLICT,
                "Signing key does not satisfy custody policy.",
            ));
        }
        let latest = data["latest_version"]
            .as_u64()
            .and_then(|n| u32::try_from(n).ok())
            .ok_or_else(unavailable)?;
        let version = version.unwrap_or(latest);
        if version == 0
            || version > latest
            || u64::from(version) < data["min_encryption_version"].as_u64().unwrap_or(0)
        {
            return Err(ApiError(
                StatusCode::CONFLICT,
                "Signing key version is disabled.",
            ));
        }
        let raw = data["keys"][version.to_string()]["public_key"]
            .as_str()
            .ok_or_else(unavailable)?;
        let raw: [u8; 32] = STANDARD
            .decode(raw)
            .map_err(|_| unavailable())?
            .try_into()
            .map_err(|_| unavailable())?;
        let key = VerifyingKey::from_bytes(&raw).map_err(|_| unavailable())?;
        let der = key.to_public_key_der().map_err(|_| unavailable())?;
        Ok(PublicKey {
            product: product.into(),
            key_version: version,
            key_id: digest(der.as_bytes()),
            public_key: key
                .to_public_key_pem(LineEnding::LF)
                .map_err(|_| unavailable())?,
        })
    }
    async fn sign(&self, key: &PublicKey, bytes: &[u8]) -> Result<String> {
        let result = self.call(reqwest::Method::POST, &format!("transit/sign/reeva-{}", key.product),
            Some(json!({"input": STANDARD.encode(bytes), "key_version": key.key_version, "prehashed": false}))).await?;
        let wrapped = result["data"]["signature"]
            .as_str()
            .ok_or_else(unavailable)?;
        let prefix = format!("vault:v{}:", key.key_version);
        let sig = STANDARD
            .decode(wrapped.strip_prefix(&prefix).ok_or_else(unavailable)?)
            .map_err(|_| unavailable())?;
        let signature = Signature::from_slice(&sig).map_err(|_| unavailable())?;
        let public =
            VerifyingKey::from_public_key_pem(&key.public_key).map_err(|_| unavailable())?;
        public
            .verify_strict(bytes, &signature)
            .map_err(|_| unavailable())?;
        Ok(URL_SAFE_NO_PAD.encode(signature.to_bytes()))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateRequest {
    product: String,
    payload: String,
    key_id: String,
    key_version: u32,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Approval {
    payload_digest: String,
    artifact_sha256: String,
    artifact_size_bytes: u64,
    expires_at: i64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SigningRequest {
    id: String,
    product: String,
    payload: String,
    payload_digest: String,
    key_id: String,
    key_version: u32,
    public_key: String,
    status: String,
    signature: Option<String>,
    expires_at: i64,
}
fn request_id(product: &str, key_id: &str, bytes: &[u8]) -> String {
    let mut hash = Sha256::new();
    hash.update(b"reeva-signer-v1\0");
    hash.update(product.as_bytes());
    hash.update([0]);
    hash.update(key_id.as_bytes());
    hash.update([0]);
    hash.update(bytes);
    hex::encode(hash.finalize())
}
fn row_request(row: sqlx::postgres::PgRow) -> SigningRequest {
    SigningRequest {
        id: row.get("id"),
        product: row.get("product"),
        payload: row.get("payload"),
        payload_digest: row.get("payload_digest"),
        key_id: row.get("key_id"),
        key_version: row.get::<i32, _>("key_version") as u32,
        public_key: row.get("public_key"),
        status: row.get("status"),
        signature: row.get("signature"),
        expires_at: row.get("expires_at"),
    }
}
async fn public_key(
    State(app): State<App>,
    headers: HeaderMap,
    Path(product): Path<String>,
) -> Result<Json<PublicKey>> {
    check_read(&headers, &app)?;
    Ok(Json(app.bao.key(&product, None).await?))
}
async fn create_request(
    State(app): State<App>,
    headers: HeaderMap,
    Json(input): Json<CreateRequest>,
) -> Result<Json<SigningRequest>> {
    check_auth(&headers, &app.requester_hash)?;
    if !valid_hex(&input.key_id) || input.key_version == 0 || input.key_version > i32::MAX as u32 {
        return Err(invalid("Invalid signing key."));
    }
    let (bytes, _) = parse_payload(&input.payload, &input.product)?;
    let key = app.bao.key(&input.product, Some(input.key_version)).await?;
    if key.key_id != input.key_id {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "Public key fingerprint changed.",
        ));
    }
    let id = request_id(&input.product, &key.key_id, &bytes);
    let mut tx = app.db.begin().await.map_err(database_error)?;
    sqlx::query("SET LOCAL lock_timeout='6s'")
        .execute(&mut *tx)
        .await
        .map_err(database_error)?;
    // Serialize admission across replicas; a requester cannot grow storage without bound.
    sqlx::query("SELECT pg_advisory_xact_lock(1929247734, 1)")
        .execute(&mut *tx)
        .await
        .map_err(database_error)?;
    sqlx::query("DELETE FROM signing_requests WHERE signature IS NULL AND expires_at < EXTRACT(EPOCH FROM now())::bigint - 86400")
        .execute(&mut *tx).await.map_err(database_error)?;
    let existing = sqlx::query("SELECT * FROM signing_requests WHERE id=$1")
        .bind(&id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(database_error)?;
    if let Some(mut row) = existing {
        if row.get::<String, _>("status") == "pending" {
            let renewed = sqlx::query("UPDATE signing_requests SET expires_at=EXTRACT(EPOCH FROM now())::bigint+86400 WHERE id=$1 AND expires_at < EXTRACT(EPOCH FROM now())::bigint RETURNING *")
                .bind(&id).fetch_optional(&mut *tx).await.map_err(database_error)?;
            if let Some(value) = renewed {
                row = value;
                sqlx::query("INSERT INTO signing_audit(request_id,event,actor) VALUES($1,'renewed','requester')")
                    .bind(&id).execute(&mut *tx).await.map_err(database_error)?;
            }
        }
        tx.commit().await.map_err(database_error)?;
        return Ok(Json(row_request(row)));
    }
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM signing_requests")
        .fetch_one(&mut *tx)
        .await
        .map_err(database_error)?;
    if count >= 10_000 {
        return Err(ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "Signing request retention limit reached. Export audit and prune old completed requests.",
        ));
    }
    let row = sqlx::query("INSERT INTO signing_requests(id,product,payload,payload_digest,key_id,key_version,public_key,status,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,'pending',EXTRACT(EPOCH FROM now())::bigint+86400) RETURNING *")
        .bind(&id).bind(&input.product).bind(&input.payload).bind(digest(&bytes)).bind(&key.key_id)
        .bind(key.key_version as i32).bind(&key.public_key).fetch_one(&mut *tx).await.map_err(database_error)?;
    sqlx::query(
        "INSERT INTO signing_audit(request_id,event,actor) VALUES($1,'requested','requester')",
    )
    .bind(&id)
    .execute(&mut *tx)
    .await
    .map_err(database_error)?;
    tx.commit().await.map_err(database_error)?;
    Ok(Json(row_request(row)))
}
async fn get_request(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<SigningRequest>> {
    check_read(&headers, &app)?;
    if !valid_hex(&id) {
        return Err(invalid("Invalid request identifier."));
    }
    let row = sqlx::query("SELECT * FROM signing_requests WHERE id=$1")
        .bind(id)
        .fetch_optional(&app.db)
        .await
        .map_err(database_error)?
        .ok_or(ApiError(
            StatusCode::NOT_FOUND,
            "Signing request not found.",
        ))?;
    Ok(Json(row_request(row)))
}
async fn approve(
    State(app): State<App>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(input): Json<Approval>,
) -> Result<Json<SigningRequest>> {
    check_auth(&headers, &app.approver_hash)?;
    if !valid_hex(&id) {
        return Err(invalid("Invalid request identifier."));
    }
    let _permit = app.slots.clone().try_acquire_owned().map_err(|_| {
        ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "Signer concurrency limit reached.",
        )
    })?;
    let mut tx = app.db.begin().await.map_err(database_error)?;
    sqlx::query("SET LOCAL lock_timeout='6s'")
        .execute(&mut *tx)
        .await
        .map_err(database_error)?;
    let row = sqlx::query("SELECT * FROM signing_requests WHERE id=$1 FOR UPDATE")
        .bind(&id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(database_error)?
        .ok_or(ApiError(
            StatusCode::NOT_FOUND,
            "Signing request not found.",
        ))?;
    let mut request = row_request(row);
    let (bytes, manifest) = parse_payload(&request.payload, &request.product)?;
    if input.payload_digest != request.payload_digest
        || input.artifact_sha256 != manifest.sha256
        || input.artifact_size_bytes != manifest.size_bytes
        || input.expires_at != request.expires_at
    {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "Approval does not match the exact manifest and artifact.",
        ));
    }
    let key = app
        .bao
        .key(&request.product, Some(request.key_version))
        .await?;
    if key.key_id != request.key_id {
        return Err(ApiError(StatusCode::CONFLICT, "Signing key changed."));
    }
    if request.status == "signed" {
        tx.commit().await.map_err(database_error)?;
        return Ok(Json(request));
    }
    let now: i64 = sqlx::query_scalar("SELECT EXTRACT(EPOCH FROM now())::bigint")
        .fetch_one(&mut *tx)
        .await
        .map_err(database_error)?;
    if request.expires_at < now {
        return Err(ApiError(
            StatusCode::GONE,
            "Approval request expired. Resubmit and review the renewed request.",
        ));
    }
    let signature = app.bao.sign(&key, &bytes).await?;
    // Recheck custody policy before releasing a signature. Already issued signatures cannot be recalled.
    if app
        .bao
        .key(&request.product, Some(request.key_version))
        .await?
        .key_id
        != key.key_id
    {
        return Err(unavailable());
    }
    sqlx::query("UPDATE signing_requests SET status='signed',signature=$2 WHERE id=$1")
        .bind(&id)
        .bind(&signature)
        .execute(&mut *tx)
        .await
        .map_err(database_error)?;
    sqlx::query("INSERT INTO signing_audit(request_id,event,actor) VALUES($1,'approved-and-signed','approver')").bind(&id).execute(&mut *tx).await.map_err(database_error)?;
    tx.commit().await.map_err(database_error)?;
    request.status = "signed".into();
    request.signature = Some(signature);
    tracing::info!(request_id = %id, "release signed");
    Ok(Json(request))
}
async fn ready(State(app): State<App>) -> Result<Json<Value>> {
    sqlx::query("SELECT 1")
        .execute(&app.db)
        .await
        .map_err(database_error)?;
    app.bao
        .call(reqwest::Method::GET, "auth/token/lookup-self", None)
        .await?;
    Ok(Json(json!({"ready": true})))
}
async fn bounded_requests(
    State(app): State<App>,
    request: axum::extract::Request,
    next: Next,
) -> Response {
    let Ok(_permit) = app.requests.clone().try_acquire_owned() else {
        return ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "Request concurrency limit reached.",
        )
        .into_response();
    };
    match tokio::time::timeout(Duration::from_secs(30), next.run(request)).await {
        Ok(response) => response,
        Err(_) => ApiError(
            StatusCode::GATEWAY_TIMEOUT,
            "Signing request deadline exceeded.",
        )
        .into_response(),
    }
}
fn router(app: App) -> Router {
    Router::new()
        .route("/health", get(|| async { Json(json!({"alive": true})) }))
        .route("/ready", get(ready))
        .route("/v1/products/{product}/key", get(public_key))
        .route("/v1/requests", post(create_request))
        .route("/v1/requests/{id}", get(get_request))
        .route("/v1/requests/{id}/approve", post(approve))
        .layer(DefaultBodyLimit::max(131_072))
        .layer(middleware::from_fn_with_state(
            app.clone(),
            bounded_requests,
        ))
        .with_state(app)
}
async fn read_secret(path: &str) -> std::result::Result<String, Box<dyn std::error::Error>> {
    let secret = tokio::fs::read_to_string(path).await?.trim().to_owned();
    if secret.len() < 32 || secret.len() > 256 {
        return Err("Invalid credential file".into());
    }
    Ok(secret)
}
fn setting(name: &str, default: &str) -> String {
    env::var(name).unwrap_or_else(|_| default.to_owned())
}

#[tokio::main]
async fn main() -> std::result::Result<(), Box<dyn std::error::Error>> {
    rustls::crypto::ring::default_provider()
        .install_default()
        .map_err(|_| "TLS provider initialization failed")?;
    tracing_subscriber::fmt().with_target(false).init();
    let user = read_secret(&setting("SIGNER_REQUESTER_TOKEN_FILE", "/auth/requester")).await?;
    let approver = read_secret(&setting("SIGNER_APPROVER_TOKEN_FILE", "/auth/approver")).await?;
    if user == approver {
        return Err("Requester and approver identities must differ".into());
    }
    let password = read_secret(&setting("SIGNER_DB_PASSWORD_FILE", "/db-secret/password")).await?;
    let options = sqlx::postgres::PgConnectOptions::new()
        .host(&setting("SIGNER_DB_HOST", "signer-postgres"))
        .username("signer")
        .database("signer")
        .password(&password);
    let db = PgPoolOptions::new()
        .max_connections(20)
        .acquire_timeout(Duration::from_secs(5))
        .connect_with(options)
        .await?;
    let mut schema_tx = db.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(1929247734, 2)")
        .execute(&mut *schema_tx)
        .await?;
    sqlx::raw_sql(include_str!("../schema.sql"))
        .execute(&mut *schema_tx)
        .await?;
    schema_tx.commit().await?;
    let url = setting("OPENBAO_URL", "https://openbao:8200")
        .trim_end_matches('/')
        .to_owned();
    if !url.starts_with("https://") {
        return Err("OPENBAO_URL must use HTTPS".into());
    }
    let ca = tokio::fs::read(setting("SIGNER_CA_FILE", "/trust/ca.pem")).await?;
    let http = reqwest::Client::builder()
        .add_root_certificate(reqwest::Certificate::from_pem(&ca)?)
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(2))
        .timeout(Duration::from_secs(5))
        .build()?;
    let bao = Bao {
        http,
        url,
        token_file: setting("OPENBAO_TOKEN_FILE", "/bao-client/token"),
    };
    let renewal = bao.clone();
    let renew_task = tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(3600));
        loop {
            interval.tick().await;
            if renewal
                .call(
                    reqwest::Method::POST,
                    "auth/token/renew-self",
                    Some(json!({})),
                )
                .await
                .is_err()
            {
                tracing::warn!(
                    "OpenBao renewal unavailable; signing will fail closed if credential expires"
                );
            }
        }
    });
    let app = App {
        db,
        bao,
        requester_hash: token_hash(&user),
        approver_hash: token_hash(&approver),
        slots: Arc::new(Semaphore::new(8)),
        requests: Arc::new(Semaphore::new(64)),
    };
    let tls = axum_server::tls_rustls::RustlsConfig::from_pem_file(
        setting("SIGNER_TLS_CERT", "/tls/cert.pem"),
        setting("SIGNER_TLS_KEY", "/tls/key.pem"),
    )
    .await?;
    let handle = axum_server::Handle::new();
    let stop = handle.clone();
    let shutdown = tokio::spawn(async move {
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                .expect("SIGTERM handler");
        tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = terminate.recv() => {} }
        stop.graceful_shutdown(Some(Duration::from_secs(20)));
    });
    tracing::info!("signer listening with TLS on port 8443");
    let result = axum_server::bind_rustls("0.0.0.0:8443".parse::<std::net::SocketAddr>()?, tls)
        .handle(handle)
        .serve(router(app.clone()).into_make_service())
        .await;
    renew_task.abort();
    let _ = renew_task.await;
    shutdown.abort();
    let _ = shutdown.await;
    app.db.close().await;
    result?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use tower::ServiceExt;

    fn payload(product: &str) -> String {
        URL_SAFE_NO_PAD.encode(
            serde_json::to_vec(&json!({
        "schemaVersion":1,"software":product,"version":"1.2.3","codename":null,"changelog":null,
        "channel":"stable","platform":"linux","architecture":"x64","fileName":"app.bin",
        "sizeBytes":3,"sha256":digest(b"abc") }))
            .unwrap(),
        )
    }
    #[test]
    fn manifest_rejects_wrong_context_and_encoding() {
        let valid = payload("desktop");
        assert!(parse_payload(&valid, "desktop").is_ok());
        assert!(parse_payload(&valid, "other").is_err());
        assert!(parse_payload(&(valid.clone() + "="), "desktop").is_err());
        let bytes = URL_SAFE_NO_PAD.decode(valid).unwrap();
        let mut json: Value = serde_json::from_slice(&bytes).unwrap();
        for (field, bad) in [
            ("version", json!("01.2.3")),
            ("channel", json!("evil")),
            ("fileName", json!("../app")),
            ("sizeBytes", json!(-1)),
            ("sha256", json!("zz")),
        ] {
            let previous = json[field].clone();
            json[field] = bad;
            assert!(
                parse_payload(
                    &URL_SAFE_NO_PAD.encode(serde_json::to_vec(&json).unwrap()),
                    "desktop"
                )
                .is_err()
            );
            json[field] = previous;
        }
    }
    #[test]
    fn independent_roles_and_stable_request_identity() {
        let mut headers = HeaderMap::new();
        headers.insert("authorization", "Bearer requester-secret".parse().unwrap());
        assert!(check_auth(&headers, &token_hash("requester-secret")).is_ok());
        assert!(check_auth(&headers, &token_hash("approver-secret")).is_err());
        assert_ne!(
            request_id("one", "key", b"payload"),
            request_id("two", "key", b"payload")
        );
        assert_ne!(
            request_id("one", "key", b"payload"),
            request_id("one", "key", b"changed")
        );
    }
    fn synthetic_app() -> App {
        App {
            db: PgPoolOptions::new()
                .connect_lazy("postgresql://localhost/synthetic")
                .unwrap(),
            bao: Bao {
                http: reqwest::Client::new(),
                url: "https://localhost".into(),
                token_file: "missing".into(),
            },
            requester_hash: token_hash("requester-secret"),
            approver_hash: token_hash("approver-secret"),
            slots: Arc::new(Semaphore::new(1)),
            requests: Arc::new(Semaphore::new(64)),
        }
    }
    #[tokio::test(start_paused = true)]
    async fn slow_requests_time_out_and_release_capacity() {
        let app = synthetic_app();
        let capacity = app.requests.clone();
        let routes = Router::new()
            .route(
                "/slow",
                get(|| async {
                    tokio::time::sleep(Duration::from_secs(120)).await;
                    StatusCode::OK
                }),
            )
            .layer(middleware::from_fn_with_state(app, bounded_requests));
        let response = routes
            .oneshot(
                axum::http::Request::builder()
                    .uri("/slow")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::GATEWAY_TIMEOUT);
        assert_eq!(capacity.available_permits(), 64);
    }
    #[tokio::test]
    async fn requester_cannot_approve_and_unauthenticated_cannot_read() {
        let routes = router(synthetic_app());
        let res = routes
            .clone()
            .oneshot(
                axum::http::Request::builder()
                    .uri(format!("/v1/requests/{}", "a".repeat(64)))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
        let res = routes
            .oneshot(
                axum::http::Request::builder()
                    .method("POST")
                    .uri(format!("/v1/requests/{}/approve", "a".repeat(64)))
                    .header("authorization", "Bearer requester-secret")
                    .header("content-type", "application/json")
                    .body(Body::from(
                    r#"{"payloadDigest":"a","artifactSha256":"b","artifactSizeBytes":3,"expiresAt":1}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    }
}
