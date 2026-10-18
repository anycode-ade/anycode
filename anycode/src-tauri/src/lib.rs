mod workspace;

use tauri::Emitter;
use tokio_util::sync::CancellationToken;

#[tauri::command]
fn get_workspace_state() -> Result<workspace::WorkspaceConfig, String> {
  Ok(workspace::load_config())
}

#[tauri::command]
async fn open_folder_dialog() -> Result<Option<String>, String> {
  let (tx, rx) = tokio::sync::oneshot::channel();
  std::thread::spawn(move || {
    let picked = rfd::FileDialog::new()
      .set_title("Open Workspace Folder")
      .pick_folder();
    let _ = tx.send(picked);
  });

  if let Ok(Some(folder)) = rx.await {
    let canonical = folder.canonicalize().unwrap_or_else(|_| folder);
    let path_str = canonical.to_string_lossy().to_string();
    Ok(Some(path_str))
  } else {
    Ok(None)
  }
}

#[tauri::command]
fn open_workspace(path: String) -> Result<String, String> {
  let p = std::path::PathBuf::from(&path);
  if p.is_dir() {
    let canonical = p.canonicalize().unwrap_or_else(|_| p);
    let path_str = canonical.to_string_lossy().to_string();
    Ok(path_str)
  } else {
    Err(format!("Directory does not exist: {path}"))
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let active_workspace = workspace::determine_initial_workspace();
  let shutdown_token = CancellationToken::new();
  let shutdown_for_backend = shutdown_token.clone();

  tauri::Builder::default()
    .runtime(tauri_runtime_wry::Wry::default())
    .invoke_handler(tauri::generate_handler![
      get_workspace_state,
      open_folder_dialog,
      open_workspace
    ])
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

      // Setup native menu
      let handle = app.handle();
      let app_menu = tauri::menu::Submenu::with_items(handle, "Anycode", true, &[
        &tauri::menu::PredefinedMenuItem::about(handle, Some("About Anycode"), None)?,
        &tauri::menu::PredefinedMenuItem::separator(handle)?,
        &tauri::menu::PredefinedMenuItem::services(handle, None)?,
        &tauri::menu::PredefinedMenuItem::separator(handle)?,
        &tauri::menu::PredefinedMenuItem::hide(handle, None)?,
        &tauri::menu::PredefinedMenuItem::hide_others(handle, None)?,
        &tauri::menu::PredefinedMenuItem::show_all(handle, None)?,
        &tauri::menu::PredefinedMenuItem::separator(handle)?,
        &tauri::menu::PredefinedMenuItem::quit(handle, None)?,
      ])?;

      let file_menu = tauri::menu::Submenu::with_items(handle, "File", true, &[
        &tauri::menu::MenuItem::with_id(handle, "open_folder", "Open Folder...", true, Some("CmdOrCtrl+O"))?,
        &tauri::menu::MenuItem::with_id(handle, "close_workspace", "Close Workspace", true, None::<&str>)?,
      ])?;

      let edit_menu = tauri::menu::Submenu::with_items(handle, "Edit", true, &[
        &tauri::menu::PredefinedMenuItem::undo(handle, None)?,
        &tauri::menu::PredefinedMenuItem::redo(handle, None)?,
        &tauri::menu::PredefinedMenuItem::separator(handle)?,
        &tauri::menu::PredefinedMenuItem::cut(handle, None)?,
        &tauri::menu::PredefinedMenuItem::copy(handle, None)?,
        &tauri::menu::PredefinedMenuItem::paste(handle, None)?,
        &tauri::menu::PredefinedMenuItem::select_all(handle, None)?,
      ])?;

      let menu = tauri::menu::Menu::with_items(handle, &[&app_menu, &file_menu, &edit_menu])?;
      app.set_menu(menu)?;

      app.on_menu_event(move |app_handle, event| {
        if event.id() == "open_folder" {
          let handle_clone = app_handle.clone();
          std::thread::spawn(move || {
            if let Some(folder) = rfd::FileDialog::new()
              .set_title("Open Workspace Folder")
              .pick_folder()
            {
              let canonical = folder.canonicalize().unwrap_or_else(|_| folder);
              let path_str = canonical.to_string_lossy().to_string();
              let _ = handle_clone.emit("workspace_folder_selected", path_str);
            }
          });
        } else if event.id() == "close_workspace" {
          let _ = app_handle.emit("workspace_close_requested", ());
        }
      });

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
          initial_workspace: active_workspace.clone(),
        };

        if let Err(e) = anycode::start_server(opts, Some(ready_tx), Some(shutdown_for_backend)).await {
          log::error!("Backend server error: {e}");
        }
      });

      // Wait for server to bind and return the allocated port
      let port = tauri::async_runtime::block_on(ready_rx)
        .expect("Failed to receive port from backend server");

      log::info!("Anycode backend running on 127.0.0.1:{port}");

      // Inject port and token before any webview script runs. The active workspace is
      // not injected: it is read from the backend on every page load (reload included).
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
