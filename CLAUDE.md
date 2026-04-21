# Braindump

Local-first Tauri desktop app. React frontend + Rust backend. SQLite is the only persistence layer, stored per-user in the OS app-data directory.

## Dev / Prod execution boundary

Braindump is one codebase that runs in two modes. The single biggest source of production bugs here is **dev and prod silently sharing state on the same machine**. Before touching any of these, think about which mode you're in and which data you're about to touch.

### The two modes

| | Command | Identifier | App-data dir (macOS) | SQLite file |
|---|---|---|---|---|
| Prod | `bun run tauri build` | `io.github.jameswberry.braindump` | `~/Library/Application Support/io.github.jameswberry.braindump/` | `braindump.db` |
| Dev | `bun run tauri:dev` | `io.github.jameswberry.braindump.dev` | `~/Library/Application Support/io.github.jameswberry.braindump.dev/` | `braindump-dev.db` |

Two layers of isolation: different bundle identifier **and** different DB filename. Either alone prevents the shared-DB class of bug, together they prevent it even if someone bypasses `tauri.dev.conf.json`.

Wiring:
- [src-tauri/src/lib.rs](src-tauri/src/lib.rs) — `DB_URL` const branches on `cfg!(debug_assertions)`.
- [src/lib/db.ts](src/lib/db.ts) — mirrors the branch using `import.meta.env.DEV`.
- [src-tauri/tauri.dev.conf.json](src-tauri/tauri.dev.conf.json) — overrides identifier, productName, icon.
- [src/lib/updater.ts](src/lib/updater.ts) — skips auto-check in dev so dev never prompts to install the prod `.app` over itself.
- [scripts/tauri.mjs](scripts/tauri.mjs) — wrapper that auto-injects the dev config for the `dev` subcommand, so `bun run tauri dev` can't accidentally hit the prod identifier.

Run dev via `bun run tauri dev` — the wrapper injects `--config src-tauri/tauri.dev.conf.json` for you. `bun run tauri build` still uses the base prod config (no injection for build).

### Rules

1. **Never edit a migration that has already shipped in a released build.** Add a new numbered migration instead. Tauri's SQL plugin uses sqlx, which checksums each migration row in `_sqlx_migrations`. If the checksum of a shipped migration changes, both dev and prod refuse to boot with "migration X was previously applied but …". The shipped file is immutable; treat it as write-once.

2. **Migrations must be idempotent and forward-only.** Use `IF NOT EXISTS` / `IF EXISTS` guards. There is no down migration path in `tauri-plugin-sql`; once applied, it's applied.

3. **Migrations are bundled into the Rust binary** via `include_str!()` in [src-tauri/src/lib.rs](src-tauri/src/lib.rs). Adding a new `.sql` file alone does nothing — you must also register it in the `migrations` vec. Older shipped builds without the new entry will see a "newer migration was applied that I don't know about" error if they open the same DB.

4. **If you need to rename or reshape a migration you just wrote locally and haven't released**, it's safe — but only if the dev DB hasn't applied it yet. If dev applied it: delete `braindump-dev.db` and let the new migration re-apply clean. Never hand-edit a migration after it's been applied locally and expect sqlx to recover.

5. **Don't read or write the prod DB from anything you run during development.** The dev identifier + dev filename make this almost impossible, but if you find yourself hard-coding a path, stop.

### Unbricking prod

If a user reports prod won't start with a migration-checksum or "previously applied but missing" error, it almost always means their installed `.app` is an older version than the DB. Ship them a newer build that knows about the applied migrations; don't try to roll back the DB.

## Project context

Strategy docs (if present) live in [docs/](docs/).
