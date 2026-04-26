mod agent;
mod screenshot;
mod setup;

use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Manager, WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_sql::{Migration, MigrationKind};

// Dev and prod use separate SQLite files so in-progress migrations and
// experimental schema changes can't corrupt the production DB. Paired with
// the dev-only bundle identifier in tauri.dev.conf.json, this gives two
// layers of isolation: different app-data dir AND different filename.
#[cfg(debug_assertions)]
const DB_URL: &str = "sqlite:braindump-dev.db";
#[cfg(not(debug_assertions))]
const DB_URL: &str = "sqlite:braindump.db";

/// Currently-registered quick-capture shortcut. Held in app state so
/// `set_quick_capture_shortcut` can unregister it before swapping in a new
/// combo.
struct QuickCaptureShortcut(Mutex<Option<Shortcut>>);

fn default_shortcut() -> Shortcut {
    // Ctrl+Cmd+B on macOS; Ctrl+Alt+B elsewhere (there's no Cmd key).
    // Both combos are rarely bound by other apps and don't clash with
    // in-app shortcuts that typically use Cmd or Ctrl alone.
    #[cfg(target_os = "macos")]
    let s = "Ctrl+Cmd+KeyB";
    #[cfg(not(target_os = "macos"))]
    let s = "Ctrl+Alt+KeyB";
    s.parse().expect("default shortcut string must parse")
}

/// Hides the quick-capture window, and on macOS — if the main window
/// wasn't already visible — also hides the whole app so focus returns to
/// the previously-active application rather than falling through to the
/// hidden main window (which otherwise gets pulled to the foreground).
#[tauri::command]
fn dismiss_quick_capture(app: tauri::AppHandle) {
    dismiss_quick_capture_inner(&app);
}

fn dismiss_quick_capture_inner(app: &tauri::AppHandle) {
    if let Some(qc) = app.get_webview_window("quick-capture") {
        let _ = qc.hide();
    }

    #[cfg(target_os = "macos")]
    {
        // Deactivate FIRST so focus returns to the user's previous app
        // before we touch main's level (preventing a one-frame flash of
        // main coming to front as its level restores).
        unsafe {
            use objc2::{class, msg_send, runtime::AnyObject};
            let ns_app_class = class!(NSApplication);
            let ns_app: *mut AnyObject = msg_send![ns_app_class, sharedApplication];
            let _: () = msg_send![ns_app, deactivate];
        }
        if let Some(main) = app.get_webview_window("main") {
            restore_main_level(&main);
        }
    }
}

#[tauri::command]
fn set_quick_capture_shortcut(
    app: tauri::AppHandle,
    state: tauri::State<'_, QuickCaptureShortcut>,
    shortcut: String,
) -> Result<(), String> {
    let parsed: Shortcut = shortcut
        .parse()
        .map_err(|_| format!("invalid shortcut: {}", shortcut))?;
    let gs = app.global_shortcut();
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(old) = guard.take() {
        let _ = gs.unregister(old);
    }
    if let Err(e) = gs.register(parsed.clone()) {
        // Registration failed (e.g. taken by another app). Leave state at
        // None so the next attempt doesn't try to unregister a phantom.
        return Err(e.to_string());
    }
    *guard = Some(parsed);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "initial schema",
            sql: include_str!("../migrations/001_initial.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "add topic column to items",
            sql: include_str!("../migrations/002_add_topic.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "add position column for manual ordering",
            sql: include_str!("../migrations/003_add_position.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "add deleted_at column for soft delete",
            sql: include_str!("../migrations/004_soft_delete.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "one draft capture per project",
            sql: include_str!("../migrations/005_draft_unique.sql"),
            kind: MigrationKind::Up,
        },
    ];

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations)
                .build(),
        )
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        toggle_quick_capture(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            let default = default_shortcut();
            match app.global_shortcut().register(default.clone()) {
                Ok(()) => {
                    app.manage(QuickCaptureShortcut(Mutex::new(Some(default))));
                }
                Err(e) => {
                    eprintln!("failed to register default quick-capture shortcut: {e}");
                    app.manage(QuickCaptureShortcut(Mutex::new(None)));
                }
            }

            // Autostart passes --hidden so the app wakes up quietly at login
            // and just waits for the global hotkey. Without this the main
            // window would pop up every time the user logs in.
            if std::env::args().any(|a| a == "--hidden") {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.hide();
                }
            }

            build_tray(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Keep the app alive in the background so the global hotkey (and
            // the quick-capture window) still work when the user "closes"
            // the main window. Quit path is via OS menu / Cmd+Q.
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            agent::process_capture,
            setup::check_claude,
            setup::check_ollama,
            setup::install_ollama,
            setup::launch_ollama,
            setup::pull_ollama_model,
            setup::verify_ollama_setup,
            setup::system_ram_gb,
            setup::open_external_url,
            screenshot::save_png_to_desktop,
            set_quick_capture_shortcut,
            dismiss_quick_capture,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // `RunEvent::Reopen` is gated to macOS in tauri-runtime, so the match
    // itself only compiles there. Non-macOS gets an empty handler.
    #[cfg(target_os = "macos")]
    app.run(|app_handle, event| {
        // macOS: clicking the dock icon for a hidden app fires Reopen —
        // re-show the main window so the user doesn't think we quit.
        if let tauri::RunEvent::Reopen { .. } = event {
            if let Some(win) = app_handle.get_webview_window("main") {
                let _ = win.show();
                let _ = win.set_focus();
            }
        }
    });

    #[cfg(not(target_os = "macos"))]
    app.run(|_, _| {});
}

fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "tray_show", "Show BRAINDUMP", true, None::<&str>)?;
    let quick = MenuItem::with_id(app, "tray_quick", "Quick Capture", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "tray_quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quick, &sep, &quit])?;

    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| tauri::Error::AssetNotFound("default window icon".into()))?;

    TrayIconBuilder::with_id("braindump-tray")
        .icon(icon)
        .tooltip("BRAINDUMP")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "tray_show" => {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
            "tray_quick" => toggle_quick_capture(app),
            "tray_quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

fn toggle_quick_capture(app: &tauri::AppHandle) {
    // The global-shortcut callback runs on a worker thread. All AppKit
    // calls (NSWindow, NSApplication) must happen on the main thread or
    // macOS will crash us with a non-unwinding panic, so bounce the whole
    // toggle through the main-thread dispatcher.
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let Some(win) = handle.get_webview_window("quick-capture") else {
            return;
        };
        let visible = win.is_visible().unwrap_or(false);
        if !visible {
            show_quick_capture_keyed(&handle, &win);
            return;
        }
        if !win.is_focused().unwrap_or(false) {
            show_quick_capture_keyed(&handle, &win);
            return;
        }
        dismiss_quick_capture_inner(&handle);
    });
}

/// Shows quick capture and gives it focus. On macOS we also:
///   * lower the main window's level so when NSApp activates, main stays
///     behind other apps' windows (no flash-to-front);
///   * reposition qc centered on the screen of whatever was frontmost
///     BEFORE we activate, so the panel appears where the user is.
fn show_quick_capture_keyed(app: &tauri::AppHandle, qc: &tauri::WebviewWindow) {
    use tauri::Emitter;

    #[cfg(target_os = "macos")]
    {
        reposition_on_current_screen(qc);
        if let Some(main) = app.get_webview_window("main") {
            if main.is_visible().unwrap_or(false) {
                set_main_below_others(&main);
            }
        }
    }

    let _ = qc.show();

    // Activate + make key via direct AppKit calls. Going through Tauri's
    // set_focus is unreliable when the window has just been repositioned
    // to a different display — macOS can leave the window visible but
    // *not* the OS-level key window, so DOM focus calls in the webview
    // silently no-op.
    #[cfg(target_os = "macos")]
    unsafe {
        use objc2::{class, msg_send, runtime::AnyObject};
        use std::ffi::c_void;

        let ns_app_class = class!(NSApplication);
        let ns_app: *mut AnyObject = msg_send![ns_app_class, sharedApplication];
        let _: () = msg_send![ns_app, activate];

        if let Ok(ns_window_ptr) = qc.ns_window() {
            if !ns_window_ptr.is_null() {
                let ns_window = ns_window_ptr as *mut AnyObject;
                let _: () =
                    msg_send![ns_window, makeKeyAndOrderFront: std::ptr::null::<c_void>()];
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    let _ = qc.set_focus();

    let _ = qc.emit("quick-capture-shown", ());
}

#[cfg(target_os = "macos")]
fn reposition_on_current_screen(win: &tauri::WebviewWindow) {
    use objc2::{class, msg_send, runtime::AnyObject};
    use objc2_foundation::{NSPoint, NSRect};

    let Ok(ns_window_ptr) = win.ns_window() else {
        return;
    };
    if ns_window_ptr.is_null() {
        return;
    }
    let ns_window = ns_window_ptr as *mut AnyObject;

    unsafe {
        // mainScreen = the screen containing the frontmost window. Called
        // before we activate our app so it returns the user's current
        // foreground-app screen, not ours.
        let main_screen: *mut AnyObject = msg_send![class!(NSScreen), mainScreen];
        if main_screen.is_null() {
            return;
        }
        let screen_frame: NSRect = msg_send![main_screen, frame];
        let window_frame: NSRect = msg_send![ns_window, frame];
        let new_origin = NSPoint::new(
            screen_frame.origin.x
                + (screen_frame.size.width - window_frame.size.width) / 2.0,
            screen_frame.origin.y
                + (screen_frame.size.height - window_frame.size.height) / 2.0,
        );
        let _: () = msg_send![ns_window, setFrameOrigin: new_origin];
    }
}

#[cfg(target_os = "macos")]
fn set_main_below_others(win: &tauri::WebviewWindow) {
    use objc2::{msg_send, runtime::AnyObject};

    let Ok(ns_window_ptr) = win.ns_window() else {
        return;
    };
    if ns_window_ptr.is_null() {
        return;
    }
    let ns_window = ns_window_ptr as *mut AnyObject;
    unsafe {
        // -1 < NSNormalWindowLevel (0). Even when our app activates, a
        // window at this level stays below normal windows from other apps.
        let _: () = msg_send![ns_window, setLevel: -1_isize];
    }
}

#[cfg(target_os = "macos")]
fn restore_main_level(win: &tauri::WebviewWindow) {
    use objc2::{msg_send, runtime::AnyObject};

    let Ok(ns_window_ptr) = win.ns_window() else {
        return;
    };
    if ns_window_ptr.is_null() {
        return;
    }
    let ns_window = ns_window_ptr as *mut AnyObject;
    unsafe {
        let _: () = msg_send![ns_window, setLevel: 0_isize];
        // Send main to the back of its (now normal) level so it doesn't
        // sit above other apps' windows when the user returns to them.
        let _: () = msg_send![ns_window, orderBack: std::ptr::null::<AnyObject>()];
    }
}
