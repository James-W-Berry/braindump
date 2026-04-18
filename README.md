<p align="center">
  <img src="app-icon.png" width="128" alt="Braindump" />
</p>

<h1 align="center">BRAINDUMP</h1>

<p align="center">
  <em>Capture every thought. Let an agent sort them out.</em>
</p>

---

Braindump is a **quick-capture desktop app** for developers, designers, and anyone who has ideas faster than they can organize them. Start a project, open a blank page, and write — no structure, no tags, no priority — just unfiltered thoughts. When you're done, hit **Process** and a Claude agent turns the dump into a clean, prioritized, correlated backlog.

### Why it exists

In the middle of a demo, a 1:1, a drive, or the shower, ideas arrive. Pausing to file each one into the right tracker kills the flow — and kills the idea. Braindump gives you a single keystroke between "had a thought" and "written down," then does the organizing later, in one pass, when you're ready.

### What you get

- **Zero-friction capture** — pick a project, start typing. A blank page and your choice of font/size.
- **Agent processing** — dumps get split into discrete items, corrected, expanded, categorized (bug · task · idea · feedback · question · note), prioritized (urgent → low), topic-clustered (`auth`, `onboarding ux`, `deploy pipeline`…), and cross-referenced against items you already captured.
- **Multiple views** — group items by priority, topic, or category. Search instantly. Hide or show completed items. Reorder within a group with ↑/↓ controls that appear on hover.
- **Inline editing** — click any field to edit. Title, body, category, priority, topic, tags.
- **Soft delete + trash** — deleted items linger for 7 days so you can restore them.
- **Local-first, private** — everything lives in a SQLite database on your machine. No cloud, no telemetry. The agent runs through the `claude` CLI you already have installed; dumps never leave your machine except for the one API call you explicitly trigger.
- **Your Claude subscription, no new token bill** — Braindump shells out to the `claude` CLI, which uses whatever authentication you already have (Claude Pro/Max plan, or API key). Pick between Sonnet 4.6 (default), Opus 4.7, Haiku 4.5, or Sonnet 4.5 in settings.
- **Themed to your mood** — light (warm paper) and dark (sumi-ink + vaporwave teal) themes. Writing font and size are configurable.
- **Auto-updates** — Braindump checks for a newer version on each launch. When one's available, you'll see a dot on the settings gear; click **Install update** in Settings and it downloads, verifies, replaces itself, and restarts. No manual re-installs after the first one.

---

## Quickstart

### Prerequisites

Braindump delegates the agent work to the [Claude CLI](https://github.com/anthropics/claude-code). You'll need it installed and authenticated once:

```bash
npm install -g @anthropic-ai/claude-code
claude login
```

Any Claude account works — Pro, Max, or API.

### Install Braindump

**macOS (one-liner):**

```bash
curl -fsSL https://raw.githubusercontent.com/James-W-Berry/braindump/main/install.sh | bash
```

This downloads the latest release, moves the app to `/Applications`, and strips Gatekeeper's quarantine attribute (Braindump isn't code-signed with an Apple Developer ID yet, so macOS would otherwise block the unsigned app on first launch).

**Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/James-W-Berry/braindump/main/install.sh | bash
```

Same script — drops an `.AppImage` into `~/.local/bin/`.

**Windows:**

Download the `.msi` or `.exe` from the [latest release](https://github.com/James-W-Berry/braindump/releases/latest) and run it. SmartScreen will warn on first launch because the installer isn't code-signed — click **More info → Run anyway**.

### First run

1. Launch Braindump (`open -a BRAINDUMP` on macOS, or click the icon).
2. The **General** project is created for you. Switch or add more from the dropdown in the toolbar.
3. Start writing in the capture page. No structure needed.
4. When you're done, hit **⌘+↵** (or the **Process** button). A Claude session takes over, and 15–40 seconds later your dump is organized under the **Items** tab.
5. Come back later, reorder within a group with the ↑/↓ buttons on hover, check items off as you finish them.

---

## Building it yourself

If you'd rather build from source (e.g. for an unreleased platform, or to contribute):

### Stack

- **Frontend** — React 19 + TypeScript + Vite + Tailwind CSS 4
- **Desktop shell** — [Tauri 2](https://tauri.app) (Rust backend + system webview frontend)
- **Storage** — SQLite via `tauri-plugin-sql`, migrations in [`src-tauri/migrations/`](src-tauri/migrations)
- **Agent** — shells out to the `claude` CLI in headless mode (`claude -p --model … --output-format json`)
- **Icons** — [lucide-react](https://lucide.dev) plus a custom ensō glyph for the brand mark
- **Build toolchain** — [Bun](https://bun.sh) for the JS side, stable Rust for the Tauri side

### Dev setup

```bash
# install JS deps
bun install

# run in dev (hot reload)
bun run tauri dev

# production build (outputs .dmg / .msi / .AppImage / .deb in src-tauri/target/release/bundle/)
bun run tauri build
```

You need:

- **Rust** 1.85+ (stable). `rustup update stable` if you're older.
- **Bun** 1.0+ (or replace `bun` with `npm`/`pnpm` — all package.json scripts work).
- **Platform build tools** — Xcode CLT on macOS, build-essential + WebKit2GTK on Linux, MSVC on Windows.

### Project layout

```
braindump/
├── app-icon.svg, app-icon.png   # source of truth for all platform icons
├── install.sh                   # curl-bash installer for macOS / Linux
├── .github/workflows/release.yml  # CI: tag → build all platforms → draft release
├── index.html                   # splash + theme bootstrap
├── src/
│   ├── App.tsx                  # top-level UI (header + capture + items + trash)
│   ├── components/
│   │   ├── Logo.tsx             # inline SVG of the ensō mark
│   │   ├── Editable.tsx         # click-to-edit text + select primitives
│   │   ├── SettingsPopover.tsx  # theme/model/font settings
│   │   └── ProcessingView.tsx   # agent processing screen
│   ├── lib/
│   │   ├── db.ts                # SQLite wrappers
│   │   ├── agent.ts             # invokes the Rust command that shells to claude
│   │   └── settings.ts          # localStorage-persisted settings + useSettings hook
│   └── index.css                # theme tokens + global styles
└── src-tauri/
    ├── src/
    │   ├── lib.rs               # Tauri setup + plugin registration + migrations
    │   ├── agent.rs             # spawns the claude CLI, parses JSON output
    │   └── main.rs
    ├── migrations/              # schema evolution (projects, captures, items, …)
    ├── capabilities/            # Tauri permission config
    └── tauri.conf.json          # window config, bundle targets, identifier
```

### Releasing

Tag + push:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The [release workflow](.github/workflows/release.yml) builds macOS (universal), Linux (AppImage + deb), and Windows (msi + exe) in parallel, signs each artifact for the updater, generates a `latest.json` manifest, and attaches everything to a **draft** GitHub Release. Review, then publish.

No code signing is configured yet — see the install script comments and [distribution notes in the README](#install-braindump) for what that means for users. If you want to add Apple Developer ID signing + notarization or Windows code signing later, Tauri's action supports both via secrets.

#### One-time: set up the updater signing key

Braindump's auto-updater verifies every update with a signature. You generate a keypair once; the private key lives in GitHub Actions secrets and signs each release, and the public key is embedded in `tauri.conf.json` so the installed app can verify downloads.

```bash
# Generate the keypair. You'll be asked to set a passphrase (remember it).
bun tauri signer generate -w ~/.tauri/braindump.key
```

This prints both the public key and the path to the private key. Then:

1. Open `src-tauri/tauri.conf.json` and replace the `plugins.updater.pubkey` placeholder with the public key printed by the command.
2. In your GitHub repo → Settings → Secrets and variables → Actions → New repository secret, add:
   - **`TAURI_SIGNING_PRIVATE_KEY`** — the contents of `~/.tauri/braindump.key` (the private key file).
   - **`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`** — the passphrase you set.
3. Commit + push the updated `tauri.conf.json`. Future tagged releases will be signed automatically.

**Losing the private key** means you can't ship updates to anyone on an old version — they'd have to re-install from scratch. Back it up in a password manager.

---

## Roadmap ideas

- Global hotkey to pop a capture window from anywhere
- Export items to Linear, GitHub, Notion, or a Markdown file
- Auto-processing on schedule (cron-like)
- Multiple project archetypes with per-project agent prompts
- Streaming agent output instead of the current fixed processing screen
- Code signing + notarization so macOS/Windows users don't need the quarantine-strip workaround

## License

MIT — see [LICENSE](LICENSE).
