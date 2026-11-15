use anyhow::Result;
use anycode::{config, start_server, ServerOptions};

#[tokio::main]
async fn main() -> Result<()> {
    if let Some(update_opts) = config::parse_update_cli_args(std::env::args().skip(1))? {
        return anycode::updater::run_self_update(update_opts).await;
    }

    config::handle_early_cli_flags();

    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::new("info"))
        .init();

    let server_options = config::resolve_server_options()?;
    let current_dir = anycode::utils::current_dir();
    let data_dir = config::resolve_instance_data_dir(
        server_options.data_dir.as_deref(),
        server_options.profile.as_deref(),
        &current_dir,
    );
    let server_name = server_options
        .name
        .clone()
        .or_else(|| server_options.profile.clone());
    let opts = ServerOptions {
        host: "0.0.0.0".to_string(),
        port: server_options.port,
        token: server_options.token,
        initial_workspace: None,
        data_dir: Some(data_dir),
        name: server_name,
    };

    start_server(opts, None, None).await
}
