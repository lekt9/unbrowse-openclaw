#!/usr/bin/env bash

set -euo pipefail

MODE="strict"
INSTALL_MODE="link"
RESTART_GATEWAY=0
KEEP_TOOLS_PROFILE=0
PLUGIN_PATH=""
declare -a OPENCLAW_SCOPE=()

usage() {
  cat <<'EOF'
Usage: bash scripts/install-openclaw.sh [options]

Installs and configures the Unbrowse OpenClaw plugin so it stays sticky.

Options:
  --mode <strict|fallback>  Routing mode to write into plugin config (default: strict)
  --strict                  Shortcut for --mode strict
  --fallback                Shortcut for --mode fallback
  --link                    Link the local plugin path into OpenClaw (default)
  --copy                    Copy the plugin into OpenClaw instead of linking
  --restart                 Restart the OpenClaw gateway service after config writes
  --keep-tools-profile      Do not unset tools.profile
  --dev                     Target the OpenClaw dev profile
  --profile <name>          Target a named OpenClaw profile
  --plugin-path <path>      Override plugin path
  -h, --help                Show this help
EOF
}

log() {
  printf '[unbrowse-openclaw] %s\n' "$*"
}

warn() {
  printf '[unbrowse-openclaw] warn: %s\n' "$*" >&2
}

die() {
  printf '[unbrowse-openclaw] error: %s\n' "$*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)
      [[ $# -ge 2 ]] || die "--mode requires a value"
      MODE="$2"
      shift 2
      ;;
    --strict)
      MODE="strict"
      shift
      ;;
    --fallback)
      MODE="fallback"
      shift
      ;;
    --link)
      INSTALL_MODE="link"
      shift
      ;;
    --copy)
      INSTALL_MODE="copy"
      shift
      ;;
    --restart)
      RESTART_GATEWAY=1
      shift
      ;;
    --keep-tools-profile)
      KEEP_TOOLS_PROFILE=1
      shift
      ;;
    --dev)
      OPENCLAW_SCOPE=(--dev)
      shift
      ;;
    --profile)
      [[ $# -ge 2 ]] || die "--profile requires a value"
      OPENCLAW_SCOPE=(--profile "$2")
      shift 2
      ;;
    --plugin-path)
      [[ $# -ge 2 ]] || die "--plugin-path requires a value"
      PLUGIN_PATH="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

if [[ "$MODE" != "strict" && "$MODE" != "fallback" ]]; then
  die "--mode must be strict or fallback"
fi

if [[ -z "$PLUGIN_PATH" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  PLUGIN_PATH="$(cd "$SCRIPT_DIR/.." && pwd)"
fi
PLUGIN_PATH="$(cd "$PLUGIN_PATH" && pwd)"

[[ -f "$PLUGIN_PATH/package.json" ]] || die "package.json not found under $PLUGIN_PATH"
[[ -f "$PLUGIN_PATH/openclaw.plugin.json" ]] || die "openclaw.plugin.json not found under $PLUGIN_PATH"

command -v openclaw >/dev/null 2>&1 || die "openclaw CLI not found on PATH"
command -v node >/dev/null 2>&1 || die "node not found on PATH"

PLUGIN_ID="$(
  node -e '
    const fs = require("node:fs");
    const pkg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    process.stdout.write(typeof pkg.name === "string" && pkg.name ? pkg.name : "unbrowse-openclaw");
  ' "$PLUGIN_PATH/package.json"
)"

oc() {
  openclaw "${OPENCLAW_SCOPE[@]}" "$@"
}

config_get_json() {
  local path="$1"
  local value=""
  value="$(oc config get "$path" --json 2>/dev/null || true)"
  printf '%s' "$value"
}

merge_allowlist() {
  CURRENT_JSON="$1" TARGET_ID="$2" node <<'NODE'
const raw = (process.env.CURRENT_JSON || "").trim();
let current = [];
if (raw) {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) current = parsed.filter((entry) => typeof entry === "string" && entry.trim());
  } catch {}
}
const merged = Array.from(new Set([...current, process.env.TARGET_ID].filter(Boolean)));
process.stdout.write(JSON.stringify(merged));
NODE
}

merge_plugin_config() {
  CURRENT_JSON="$1" MODE_VALUE="$2" node <<'NODE'
const raw = (process.env.CURRENT_JSON || "").trim();
const mode = process.env.MODE_VALUE === "fallback" ? "fallback" : "strict";
let current = {};
if (raw) {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) current = parsed;
  } catch {}
}
const timeoutMs = Number.isInteger(current.timeoutMs) ? current.timeoutMs : 120000;
const merged = {
  ...current,
  routingMode: mode,
  preferInBootstrap: true,
  allowBrowserFallback: mode === "fallback",
  timeoutMs,
};
process.stdout.write(JSON.stringify(merged));
NODE
}

inspect_profile_footguns() {
  local by_provider_json agents_json
  by_provider_json="$(config_get_json "tools.byProvider")"
  agents_json="$(config_get_json "agents.list")"

  CURRENT_JSON="$by_provider_json" node <<'NODE'
const raw = (process.env.CURRENT_JSON || "").trim();
if (!raw) process.exit(0);
try {
  const parsed = JSON.parse(raw);
  const offenders = Object.entries(parsed ?? {})
    .filter(([, value]) => value && typeof value === "object" && typeof value.profile === "string" && value.profile.trim())
    .map(([key, value]) => `${key}:${value.profile}`);
  if (offenders.length > 0) {
    process.stderr.write(
      `[unbrowse-openclaw] warn: tools.byProvider profiles may still hide plugin tools: ${offenders.join(", ")}\n`,
    );
  }
} catch {}
NODE

  CURRENT_JSON="$agents_json" node <<'NODE'
const raw = (process.env.CURRENT_JSON || "").trim();
if (!raw) process.exit(0);
try {
  const parsed = JSON.parse(raw);
  const offenders = Array.isArray(parsed)
    ? parsed
        .map((entry, index) => {
          const profile = entry?.tools?.profile;
          const id = typeof entry?.id === "string" && entry.id ? entry.id : `index:${index}`;
          return typeof profile === "string" && profile.trim() ? `${id}:${profile}` : null;
        })
        .filter(Boolean)
    : [];
  if (offenders.length > 0) {
    process.stderr.write(
      `[unbrowse-openclaw] warn: per-agent tools.profile values may still hide plugin tools: ${offenders.join(", ")}\n`,
    );
  }
} catch {}
NODE
}

INSTALL_ARGS=(plugins install "$PLUGIN_PATH")
if [[ "$INSTALL_MODE" == "link" ]]; then
  INSTALL_ARGS+=(--link)
fi

log "installing plugin from $PLUGIN_PATH ($INSTALL_MODE, mode=$MODE)"
oc "${INSTALL_ARGS[@]}"

ALLOWLIST_JSON="$(merge_allowlist "$(config_get_json "plugins.allow")" "$PLUGIN_ID")"
ENTRY_CONFIG_JSON="$(merge_plugin_config "$(config_get_json "plugins.entries.$PLUGIN_ID.config")" "$MODE")"
CURRENT_TOOLS_PROFILE="$(config_get_json "tools.profile")"

log "merging plugins.allow"
oc config set plugins.allow "$ALLOWLIST_JSON" --strict-json

log "enabling plugin entry"
oc config set "plugins.entries.$PLUGIN_ID.enabled" "true" --strict-json
oc config set "plugins.entries.$PLUGIN_ID.config" "$ENTRY_CONFIG_JSON" --strict-json

if [[ "$KEEP_TOOLS_PROFILE" -eq 0 ]]; then
  if [[ -n "$CURRENT_TOOLS_PROFILE" ]]; then
    log "unsetting tools.profile so plugin tools stay visible"
    oc config unset tools.profile >/dev/null
  fi
else
  warn "keeping tools.profile; plugin tools may stay hidden"
fi

inspect_profile_footguns

if [[ "$RESTART_GATEWAY" -eq 1 ]]; then
  if oc gateway restart; then
    log "gateway restarted"
  else
    warn "gateway restart failed; run 'openclaw ${OPENCLAW_SCOPE[*]} gateway restart' manually"
  fi
else
  log "restart not requested; run 'openclaw ${OPENCLAW_SCOPE[*]} gateway restart' after install"
fi

printf '\n'
log "done"
log "plugin: $PLUGIN_ID"
log "mode: $MODE"
log "path: $PLUGIN_PATH"
if [[ "$KEEP_TOOLS_PROFILE" -eq 0 ]]; then
  if [[ -n "$CURRENT_TOOLS_PROFILE" ]]; then
    log "tools.profile: removed"
  else
    log "tools.profile: not set"
  fi
fi
