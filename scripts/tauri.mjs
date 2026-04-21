#!/usr/bin/env node
// Wrapper around the Tauri CLI that auto-injects the dev config for
// `tauri dev`, so `bun run tauri dev` can't accidentally hit the prod
// identifier / DB. `tauri build` still uses the base prod config.
// Explicit --config / -c passes through untouched.
//
// We invoke tauri.js directly via `process.execPath` instead of the
// node_modules/.bin shim because on Windows the shim is a .cmd/.ps1 and
// child_process.spawn can't exec it without shell:true.
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const DEV_CONFIG = "src-tauri/tauri.dev.conf.json";

const args = process.argv.slice(2);
const hasExplicitConfig = args.includes("--config") || args.includes("-c");
const injectDev = args[0] === "dev" && !hasExplicitConfig;
const finalArgs = injectDev
  ? ["dev", "--config", DEV_CONFIG, ...args.slice(1)]
  : args;

const tauriScript = resolve("node_modules/@tauri-apps/cli/tauri.js");
const child = spawn(process.execPath, [tauriScript, ...finalArgs], {
  stdio: "inherit",
});
child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});
