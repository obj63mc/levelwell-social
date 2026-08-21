#[cfg(all(debug_assertions, target_os = "macos"))]
fn set_dev_dock_icon() {
  use objc2::{AllocAnyThread, MainThreadMarker};
  use objc2_app_kit::{NSApplication, NSImage};
  use objc2_foundation::NSData;

  // Running as a bare binary (no .app bundle), so macOS can't find icon.icns.
  let bytes = include_bytes!("../icons/icon.png");
  if let Some(mtm) = MainThreadMarker::new() {
    let data = NSData::with_bytes(bytes);
    if let Some(image) = NSImage::initWithData(NSImage::alloc(), &data) {
      let app = NSApplication::sharedApplication(mtm);
      unsafe { app.setApplicationIconImage(Some(&image)) };
    }
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_notification::init())
    .setup(|_app| {
      #[cfg(all(debug_assertions, target_os = "macos"))]
      set_dev_dock_icon();
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
