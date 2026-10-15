use anyhow::Result;
use anycode::{config, start_server, ServerOptions};

#[tokio::main]
async fn main() -> Result<()> {
    config::handle_early_cli_flags();

    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::new("info"))
        .init();

    let server_options = config::resolve_server_options()?;
    let opts = ServerOptions {
        host: "0.0.0.0".to_string(),
        port: server_options.port,
        token: server_options.token,
    };

    start_server(opts, None, None).await
}
