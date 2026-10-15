use tokio_util::sync::CancellationToken;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let shutdown_token = CancellationToken::new();
  let shutdown_for_backend = shutdown_token.clone();

  tauri::Builder::default()
    .runtime(tauri_runtime_wry::Wry::default())
    .setup(move |app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      app.handle().plugin(tauri_plugin_process::init())?;
      app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;

      // Generate random secret token for this application run
      let secret_token = uuid::Uuid::new_v4().to_string();
      let secret_for_server = secret_token.clone();

      let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();

      // Spawn in-process backend server
      tauri::async_runtime::spawn(async move {
        let opts = anycode::ServerOptions {
          host: "127.0.0.1".to_string(),
          port: 0,
          token: Some(secret_for_server),
        };

        if let Err(e) = anycode::start_server(opts, Some(ready_tx), Some(shutdown_for_backend)).await {
          log::error!("Backend server error: {e}");
        }
      });

      // Wait for server to bind and return the allocated port
      let port = tauri::async_runtime::block_on(ready_rx)
        .expect("Failed to receive port from backend server");

      log::info!("Anycode backend running on 127.0.0.1:{port}");

      // Inject port and token before any webview script runs
      let init_script = format!(
        r#"window.__ANYCODE_PORT__ = {port}; window.__ANYCODE_TOKEN__ = "{secret_token}";"#
      );

      #[allow(unused_mut)]
      let mut builder = tauri::WebviewWindowBuilder::new(
        app,
        "main",
        tauri::WebviewUrl::default(),
      )
      .title("Anycode")
      .inner_size(1400.0, 900.0)
      .min_inner_size(800.0, 500.0)
      .resizable(true)
      .fullscreen(false)
      .background_color(tauri::window::Color(36, 36, 36, 255))
      .disable_drag_drop_handler()
      .zoom_hotkeys_enabled(false)
      .initialization_script(&init_script);

      #[cfg(target_os = "macos")]
      {
        builder = builder.title_bar_style(tauri::TitleBarStyle::Transparent);
      }

      let window = builder.build()?;

      #[cfg(target_os = "macos")]
      {
        let _ = window.with_webview(|webview| {
          if let Some(webview) = webview.downcast_ref::<tauri_runtime_wry::Webview>() {
            unsafe {
              let view: &objc2_web_kit::WKWebView = &*webview.inner().cast();
              view.setAllowsMagnification(true);
            }
          }
        });
      }

      #[cfg(not(target_os = "macos"))]
      let _ = window;

      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(move |_app_handle, event| {
      if let tauri::RunEvent::ExitRequested { .. } = event {
        shutdown_token.cancel();
      }
    });
}
