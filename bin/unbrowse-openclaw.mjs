#!/usr/bin/env node

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageDir = path.resolve(__dirname, "..");
const installScript = path.join(packageDir, "scripts", "install-openclaw.sh");

function printHelp() {
  process.stdout.write(`unbrowse-openclaw

Usage:
  unbrowse-openclaw install [options]
  npx unbrowse-openclaw install [options]

Commands:
  install    Install and configure the OpenClaw plugin with sticky Unbrowse routing

Notes:
  - Package installs default to --copy so npx/global runs do not leave a broken linked path.
  - The package depends on the npm \`unbrowse\` CLI/runtime automatically.
  - OpenClaw must already be installed.
`);
}

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === "-h" || command === "--help" || command === "help") {
  printHelp();
  process.exit(0);
}

if (command !== "install") {
  process.stderr.write(`Unknown command: ${command}\n`);
  printHelp();
  process.exit(1);
}

if (!existsSync(installScript)) {
  process.stderr.write(`Missing installer: ${installScript}\n`);
  process.exit(1);
}

const forwarded = args.slice(1);
const hasInstallMode = forwarded.includes("--copy") || forwarded.includes("--link");
const installArgs = [installScript, ...(hasInstallMode ? [] : ["--copy"]), ...forwarded];

const result = spawnSync("bash", installArgs, {
  cwd: packageDir,
  stdio: "inherit",
});

if (result.error) {
  process.stderr.write(`${String(result.error)}\n`);
  process.exit(1);
}

process.exit(result.status ?? 1);
