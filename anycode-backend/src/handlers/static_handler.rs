use axum::{
    extract::Query,
    http::{StatusCode, Uri, header},
    response::{Html, IntoResponse, Response},
};
use serde::Deserialize;
use std::path::{Path, PathBuf};
use tokio::fs;
use tracing::info;

static INDEX_HTML: &str = "index.html";

#[derive(Debug, Deserialize)]
pub struct LocalImageQuery {
    pub path: String,
}

fn resolve_workspace_path(path: &str, workspace_root: &Path) -> PathBuf {
    let requested = PathBuf::from(path);
    if requested.is_absolute() {
        requested
    } else {
        workspace_root.join(requested)
    }
}

pub async fn static_handler(uri: Uri) -> impl IntoResponse {
    info!("static handler {:?}", uri.path());

    let path = uri.path().trim_start_matches('/');

    if path.is_empty() || path == INDEX_HTML {
        return index_html().await;
    }

    match crate::config::Dist::get(path) {
        Some(content) => {
            let mime = mime_guess::from_path(path).first_or_octet_stream();
            ([(header::CONTENT_TYPE, mime.as_ref())], content.data).into_response()
        }
        None => {
            if path.contains('.') {
                return not_found().await;
            }

            index_html().await
        }
    }
}

pub async fn local_image_handler(Query(query): Query<LocalImageQuery>) -> impl IntoResponse {
    let path = query.path.trim();
    if path.is_empty() {
        return (StatusCode::BAD_REQUEST, "missing path").into_response();
    }

    let workspace_root = crate::utils::current_dir();
    let workspace_root = match fs::canonicalize(&workspace_root).await {
        Ok(dir) => dir,
        Err(_) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, "workspace unavailable").into_response();
        }
    };

    let requested_path = resolve_workspace_path(path, &workspace_root);
    let canonical_path = match fs::canonicalize(&requested_path).await {
        Ok(path) => path,
        Err(_) => return (StatusCode::NOT_FOUND, "image not found").into_response(),
    };

    if !canonical_path.starts_with(&workspace_root) {
        return (StatusCode::FORBIDDEN, "path is outside workspace").into_response();
    }

    let ext = canonical_path
        .extension()
        .and_then(|v| v.to_str())
        .map(|v| v.to_ascii_lowercase());
    let content_type = match ext.as_deref() {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                "only .png/.jpg/.jpeg/.gif/.webp are allowed",
            )
                .into_response();
        }
    };

    match fs::read(&canonical_path).await {
        Ok(bytes) => (
            [
                (header::CONTENT_TYPE, content_type),
                (header::CACHE_CONTROL, "no-store"),
            ],
            bytes,
        )
            .into_response(),
        Err(_) => (StatusCode::NOT_FOUND, "image not found").into_response(),
    }
}

async fn index_html() -> Response {
    match crate::config::Dist::get(INDEX_HTML) {
        Some(content) => Html(content.data).into_response(),
        None => not_found().await,
    }
}

async fn not_found() -> Response {
    (StatusCode::NOT_FOUND, "404").into_response()
}
