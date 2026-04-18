mod agent;

use tauri_plugin_sql::{Migration, MigrationKind};

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
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:braindump.db", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            agent::process_capture,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
