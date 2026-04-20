<p align="center">
  <img src="app-icon.png" width="128" alt="Braindump" />
</p>

<h1 align="center">BRAINDUMP</h1>

<p align="center">
  <em>Capture every thought. Let an agent — cloud or local — sort them out.</em>
</p>

---

Braindump is a **quick-capture desktop app** for developers, designers, and anyone who has ideas faster than they can organize them. Start a project, open a blank page, and write — no structure, no tags, no priority — just unfiltered thoughts. When you're done, hit **Process** and an agent turns the dump into a clean, prioritized, correlated backlog. Choose between **Claude** (fast, high-quality, API-backed) or a **local model via Ollama** (nothing leaves your machine). First launch walks you through the choice.

### Why it exists

In the middle of a demo, a 1:1, a drive, or the shower, ideas arrive. Pausing to file each one into the right tracker kills the flow — and kills the idea. Braindump gives you a single keystroke between "had a thought" and "written down," then does the organizing later, in one pass, when you're ready.

### What you get

- **Zero-friction capture** — pick a project, start typing. A blank page and your choice of font/size.
- **Immersive writing mode** — an optional animated backdrop behind the textarea (drifting color bands, a perspective grid that scrolls toward you, seamless sine waves, and a distant sun for the richer themes) plus an in-footer NTS Radio player with three presentation modes: a cover-art chip, a floating 300px mini-card, or the show's cover art blurred into the background. Default is NTS 1 live — now-playing metadata (show, DJ, cover art) polls from NTS's public API. Click the show-name label to open a searchable picker of the full [Otaku](https://www.nts.live/shows/otaku) archive (anime + video-game OSTs, monthly) — pick any past episode and it plays inline via Mixcloud's widget, with position preserved across pause and mode switches.
- **Agent processing** — dumps get split into discrete items, corrected, expanded, categorized (bug · task · idea · feedback · question · note), prioritized (urgent → low), topic-clustered (`auth`, `onboarding ux`, `deploy pipeline`…), and cross-referenced against items you already captured.
- **Two processing paths — you choose** — cloud (Claude via the `claude` CLI) or fully local (Ollama + your choice of tiered models from Qwen 2.5 7B through 72B). First launch presents a wizard that detects what you have installed, downloads + sets up the local runtime end-to-end if you pick that path, and remembers your choice. Switch anytime from settings.
- **Multiple views** — group items by priority, topic, or category. Each view hides the grouping dimension from rows (so "bugs" inside a `bugs` group don't repeat), colors group headers by category/priority, and flags urgent items in non-priority views.
- **Inline editing** — click any field to edit. Titles, bodies, categories, priorities, tags. Topic uses an autocomplete combobox against existing project topics, normalized to lowercase+trim so "Auth" and "auth" collapse into one canonical cluster.
- **Soft delete + trash** — single-click delete moves items to a recoverable trash view; a 3-second inline confirm gate guards permanent deletion.
- **Local-first data, always** — every capture and item lives in a SQLite database on your machine. No telemetry. If you pick the local processing path, no captures *ever* leave your device. If you pick Claude, only the text of a capture is sent — and only at the moment you hit Process. The optional music feature, if you enable it, plays the NTS Radio live stream directly, polls their public "now playing" endpoint, and embeds Mixcloud's widget for archive episodes; no captures are sent to any of them.
- **Themed to your mood** — four palettes: `light` (warm paper), `dark` (sumi-ink), `gilt` (gold-leaf plate + cream sun + teal bands, a literal take on the logo), and `vapor` (nostalgia vaporwave — night-sky indigo + magenta + teal). Writing font and size are configurable.
- **Auto-updates** — Braindump checks for a newer version on each launch. When one's available, you'll see a dot on the settings gear; click **Install update** in Settings and it downloads, verifies, replaces itself, and restarts. No manual re-installs after the first one.

### Processing providers

| | **Cloud (Claude)** | **Local (Ollama)** |
|---|---|---|
| Quality | Highest — Sonnet 4.6 default, Opus 4.7 / Haiku 4.5 / Sonnet 4.5 selectable | Good enough for extraction + correlation; may drop subtle links on large existing-item lists |
| Speed | ~10–40 s per dump | ~15–60 s per dump on Apple Silicon (model stays warm after first run) |
| Privacy | Capture text sent to Anthropic's API | Nothing leaves the device |
| Runtime cost | Your existing Claude Pro/Max plan or API key | None after setup |
| Disk | Zero additional | ~5 GB for the model + ~200 MB for Ollama |
| Setup | Just install + login to the `claude` CLI (see below) | Handled end-to-end by the first-run wizard — downloads Ollama, installs to `~/Applications`, pulls the model, verifies |
| Network needed | Every time you process | Only during initial setup |

Structured-output is enforced in both paths: Claude via careful prompting + JSON parsing, Ollama via the `/api/chat` endpoint's schema-constrained `format` parameter. Both return the same typed `AgentResult` on the Rust side.

---

## Quickstart

### Prerequisites

Pick one path.

**Cloud (Claude).** Install the [Claude CLI](https://github.com/anthropics/claude-code) once:

```bash
npm install -g @anthropic-ai/claude-code
claude login
```

Any Claude account works — Pro, Max, or API.

**Local (Ollama).** You don't need to install anything in advance — the first-run wizard downloads Ollama and the model for you on macOS. (Linux/Windows auto-install are on the roadmap; in the meantime you can install [Ollama](https://ollama.com/download) manually and Braindump will detect it.) You'll need ~6 GB of free disk and 8 GB of RAM is recommended.

### Install Braindump

**macOS (one-liner):**

```bash
curl -fsSL https://raw.githubusercontent.com/James-W-Berry/braindump/main/install.sh | bash
```

This downloads the latest release, moves the app to `/Applications`, and strips Gatekeeper's quarantine attribute (Braindump isn't code-signed with an Apple Developer ID yet, so macOS would otherwise block the unsigned app on first launch).

**Linux** (Ubuntu / Debian / Arch / Fedora — anything that runs AppImages):

```bash
curl -fsSL https://raw.githubusercontent.com/James-W-Berry/braindump/main/install.sh | bash
```

Same script — drops a portable `.AppImage` into `~/.local/bin/braindump.AppImage`. The AppImage bundles everything it needs, so there are no distro-specific package requirements. Tested on Arch, Ubuntu, Fedora, and Debian.

If you'd rather install the `.deb` manually (Ubuntu/Debian only), grab it from the [release page](https://github.com/James-W-Berry/braindump/releases/latest).

**Windows:**

Download the `.msi` or `.exe` from the [latest release](https://github.com/James-W-Berry/braindump/releases/latest) and run it. SmartScreen will warn on first launch because the installer isn't code-signed — click **More info → Run anyway**.

### First run

1. Launch Braindump (`open -a BRAINDUMP` on macOS, or click the icon).
2. **Pick a processing path.** A provider wizard greets you with two cards:
   - **Cloud (Claude)** — shows green if the `claude` CLI is detected on your `PATH`. Click **Use Claude** to commit.
   - **Local (Ollama)** — shows a short setup plan (size, disk, RAM). Click **Set up Local** and the wizard runs four steps: install Ollama (if missing), start the service, pull the model, verify with a tiny test call. Progress bars throughout. Every step has a "having trouble? install manually" escape hatch.
3. The **General** project is created for you. Switch or add more from the toolbar dropdown.
4. Start writing in the capture page. No structure needed.
5. When you're done, hit **⌘+↵** (or the **Process** button). Your agent takes over — cloud or local, same flow — and 10–60 seconds later your dump is organized under the **Items** tab.
6. Come back later, reorder within a group with the ↑/↓ buttons on hover, check items off as you finish them, and click any field to edit in place.
7. Switch providers anytime from Settings → Provider → **switch**, which re-runs the wizard.

---

## Building it yourself

If you'd rather build from source (e.g. for an unreleased platform, or to contribute):

### Stack

- **Frontend** — React 19 + TypeScript + Vite + Tailwind CSS 4
- **Desktop shell** — [Tauri 2](https://tauri.app) (Rust backend + system webview frontend)
- **Storage** — SQLite via `tauri-plugin-sql`, migrations in [`src-tauri/migrations/`](src-tauri/migrations)
- **Agent (cloud)** — shells out to the `claude` CLI in headless mode (`claude -p --model … --output-format json`)
- **Agent (local)** — HTTP to Ollama at `localhost:11434/api/chat` with a JSON-schema `format` parameter so output is structured-typed without post-hoc cleanup
- **Provider abstraction** — one `process_capture` Tauri command dispatches on a `provider: "claude" | "ollama"` arg, returning the same `AgentResult` shape regardless of backend
- **Setup orchestration** — `setup.rs` exposes Tauri commands for detecting Claude/Ollama, streaming the Ollama binary download + zip extraction to `~/Applications`, streaming model pull progress from `/api/pull`, and verifying with a trivial test call. The wizard listens for `setup-progress` events to render live progress
- **Icons** — [lucide-react](https://lucide.dev) for UI, plus a custom SVG brand mark (gold-leaf plate + cream sun + teal bands) generated at build-time into all platform sizes via `tauri icon`
- **Build toolchain** — [Bun](https://bun.sh) for the JS side, stable Rust for the Tauri side, [rsvg-convert](https://wiki.gnome.org/Projects/LibRsvg) for SVG→PNG when regenerating icons

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
│   │   ├── Logo.tsx             # inline SVG of the brand mark
│   │   ├── Editable.tsx         # click-to-edit text + select + autocomplete-combo primitives
│   │   ├── CaptureAmbient.tsx   # theme-tinted animated backdrop (bands + grid + sine waves + sun)
│   │   ├── NTSPlayer.tsx        # NTS player — live `<audio>` + archive Mixcloud iframe (Widget API) with 3 presentation modes
│   │   ├── EpisodePicker.tsx    # searchable popover of past Otaku episodes (NTS API)
│   │   ├── SettingsPopover.tsx  # theme/provider/model/font settings
│   │   ├── SetupWizard.tsx      # first-run provider picker + local install flow
│   │   ├── ScreenshotStudio.tsx # matted snapshot export
│   │   └── ProcessingView.tsx   # agent processing screen
│   ├── lib/
│   │   ├── db.ts                # SQLite wrappers
│   │   ├── agent.ts             # invokes the Rust process_capture command
│   │   ├── setup.ts             # wraps Tauri setup commands + progress event listener
│   │   ├── screenshot.ts        # DOM → PNG capture (with form-state mirroring)
│   │   ├── updater.ts           # auto-update status state machine
│   │   └── settings.ts          # localStorage-persisted settings + useSettings hook
│   └── index.css                # theme tokens + ambient/capture animations + global styles
└── src-tauri/
    ├── src/
    │   ├── lib.rs               # Tauri setup + plugin/command registration + migrations
    │   ├── agent.rs             # process_capture dispatch: Claude CLI OR Ollama HTTP
    │   ├── setup.rs             # provider detection, Ollama install/pull/verify, progress events
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

- Linux / Windows auto-install flows in the local-provider wizard
- SHA256 pinning on the Ollama download (currently skipped — see the `OLLAMA_MACOS_SHA256` constant in `setup.rs`)
- Cancellation for the model pull during setup
- Global hotkey to pop a capture window from anywhere
- Export items to Linear, GitHub, Notion, or a Markdown file
- Auto-processing on schedule (cron-like)
- Multiple project archetypes with per-project agent prompts
- Streaming agent output instead of the current fixed processing screen
- Code signing + notarization so macOS/Windows users don't need the quarantine-strip workaround

## License

MIT — see [LICENSE](LICENSE).
