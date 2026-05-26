use axum::{
    http::{StatusCode, Uri, header},
    response::{Html, IntoResponse, Response},
};
use tracing::info;


static INDEX_HTML: &str = "index.html";

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

async fn index_html() -> Response {
    match crate::config::Dist::get(INDEX_HTML) {
        Some(content) => Html(content.data).into_response(),
        None => not_found().await,
    }
}

async fn not_found() -> Response {
    (StatusCode::NOT_FOUND, "404").into_response()
}
