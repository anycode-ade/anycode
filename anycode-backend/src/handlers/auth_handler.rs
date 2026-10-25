use axum::http::{HeaderMap, Uri, header};
use socketioxide::extract::{SocketRef, TryData};

use crate::app_state::AppState;

#[derive(Debug)]
pub struct AuthError(pub String);

impl std::fmt::Display for AuthError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for AuthError {}

pub fn extract_token_from_http(headers: &HeaderMap, uri: &Uri) -> Option<String> {
    // 1. Check query parameter: `?token=...`
    if let Some(query) = uri.query() {
        for (k, v) in url::form_urlencoded::parse(query.as_bytes()) {
            if k == "token" && !v.is_empty() {
                return Some(v.into_owned());
            }
        }
    }

    // 2. Check Authorization header: `Bearer ...`
    if let Some(auth_hdr) = headers.get(header::AUTHORIZATION) {
        if let Ok(s) = auth_hdr.to_str() {
            if let Some(tok) = s.strip_prefix("Bearer ").or_else(|| s.strip_prefix("bearer ")) {
                let trimmed = tok.trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
            }
        }
    }

    // 3. Check Cookie header: `anycode_token=...`
    if let Some(cookie_hdr) = headers.get(header::COOKIE) {
        if let Ok(cookies) = cookie_hdr.to_str() {
            for cookie in cookies.split(';') {
                let mut parts = cookie.trim().splitn(2, '=');
                if let (Some(k), Some(v)) = (parts.next(), parts.next()) {
                    if k == "anycode_token" && !v.is_empty() {
                        return Some(v.to_string());
                    }
                }
            }
        }
    }

    None
}

pub fn extract_token_from_socket<A: socketioxide::adapter::Adapter>(
    socket: &socketioxide::socket::Socket<A>,
    auth: Option<&serde_json::Value>,
) -> Option<String> {
    // 1. Check socket.io handshake auth payload
    if let Some(val) = auth {
        if let Some(s) = val.as_str() {
            let trimmed = s.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
        if let Some(s) = val.get("token").and_then(|v| v.as_str()) {
            let trimmed = s.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }

    // 2. Fall back to handshake HTTP headers & URI query parameters
    let req = socket.req_parts();
    extract_token_from_http(&req.headers, &req.uri)
}

pub async fn auth_middleware(
    socket: SocketRef,
    TryData(auth): TryData<serde_json::Value>,
    state: socketioxide::extract::State<AppState>,
) -> Result<(), AuthError> {
    if state.is_auth_required() {
        let candidate = extract_token_from_socket(&socket, auth.as_ref().ok());
        if !state.is_token_valid(candidate.as_deref()) {
            tracing::warn!("Socket.IO connection rejected: invalid or missing access token");
            return Err(AuthError("Unauthorized: invalid or missing token".to_string()));
        }
    }

    crate::handlers::connection_handler::setup_socket(&socket, &state).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{HeaderMap, HeaderValue, Uri};

    #[test]
    fn test_extract_token_from_query() {
        let headers = HeaderMap::new();
        let uri: Uri = "http://localhost:3000/?token=my-secret-123".parse().unwrap();
        assert_eq!(
            extract_token_from_http(&headers, &uri),
            Some("my-secret-123".to_string())
        );
    }

    #[test]
    fn test_extract_token_from_auth_header() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::AUTHORIZATION,
            HeaderValue::from_static("Bearer token_from_header"),
        );
        let uri: Uri = "http://localhost:3000/".parse().unwrap();
        assert_eq!(
            extract_token_from_http(&headers, &uri),
            Some("token_from_header".to_string())
        );
    }

    #[test]
    fn test_extract_token_from_cookie() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::COOKIE,
            HeaderValue::from_static("other=123; anycode_token=cookie_secret; something=else"),
        );
        let uri: Uri = "http://localhost:3000/".parse().unwrap();
        assert_eq!(
            extract_token_from_http(&headers, &uri),
            Some("cookie_secret".to_string())
        );
    }

    #[test]
    fn test_extract_token_missing() {
        let headers = HeaderMap::new();
        let uri: Uri = "http://localhost:3000/".parse().unwrap();
        assert_eq!(extract_token_from_http(&headers, &uri), None);
    }

    #[test]
    fn test_token_validation_logic() {
        let (tx, _) = tokio::sync::mpsc::channel(1);
        let (acp_tx, _) = tokio::sync::mpsc::channel(1);

        // Without token configured
        let state_open = AppState::new(tx.clone(), acp_tx.clone(), None);
        assert!(!state_open.is_auth_required());
        assert!(state_open.is_token_valid(None));
        assert!(state_open.is_token_valid(Some("anything")));

        // With token configured
        let state_protected = AppState::new(tx, acp_tx, Some("secret_pass_123".to_string()));
        assert!(state_protected.is_auth_required());
        assert!(!state_protected.is_token_valid(None));
        assert!(!state_protected.is_token_valid(Some("wrong_pass")));
        assert!(state_protected.is_token_valid(Some("secret_pass_123")));
    }
}
