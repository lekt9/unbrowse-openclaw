# unbrowse-openclaw

Use Unbrowse inside OpenClaw.

This plugin adds a native `unbrowse` tool, teaches agents to use it first for website tasks, and gives you a strict mode that can keep agents off the built-in `browser` tool.

Use it when you want API-first web work: structured extraction, reverse-engineered site actions, less brittle browser automation.

## Install

```bash
npx unbrowse-openclaw install --restart
```

Global package path:

```bash
npm install -g unbrowse-openclaw
unbrowse-openclaw install --restart
```

From this monorepo, the dev wrapper is:

```bash
bun run openclaw:install -- --restart
```

What the installer does:

- links the local plugin into OpenClaw
- merges `plugins.allow` with `unbrowse-openclaw`
- enables the plugin entry
- writes sticky plugin config with `routingMode`, `preferInBootstrap`, and timeout
- unsets global `tools.profile` unless you pass `--keep-tools-profile`
- optionally restarts the gateway

Why the script exists: `openclaw plugins install` alone is not enough. It does not set `plugins.allow`, does not switch the plugin into strict mode, and does not remove the `tools.profile` footgun that can hide plugin tools completely.

Installer flags:

```bash
npx unbrowse-openclaw install --mode strict --restart
npx unbrowse-openclaw install --mode fallback
npx unbrowse-openclaw install --dev --restart
npx unbrowse-openclaw install --profile work --restart
npx unbrowse-openclaw install --keep-tools-profile
```

The published package depends on `unbrowse`, so the local Unbrowse CLI/runtime is pulled in automatically from npm.

If you still want the manual path, review the checked-out plugin, then point OpenClaw at it directly:

```json5
{
  plugins: {
    allow: ["unbrowse-openclaw"],
    load: { paths: ["./submodules/openclaw-unbrowse-plugin"] },
    entries: {
      "unbrowse-openclaw": {
        enabled: true,
        config: {
          routingMode: "strict",
          preferInBootstrap: true,
          timeoutMs: 120000
        }
      }
    }
  }
}
```

Why the install signatures exist:

- `node:child_process` because the plugin launches the local `unbrowse` CLI
- `process.env` because it passes local config like `UNBROWSE_URL` into that child process
- local file reads because it loads bundled prompt/skill/config files from its own directory
- no outbound web traffic happens during install or load; network traffic starts only after an agent explicitly calls `unbrowse`

Verify:

```bash
openclaw plugins info unbrowse-openclaw
openclaw unbrowse-plugin health
openclaw unbrowse-plugin print-trusted-install
```

Verify:
- `unbrowse` tool shows up in the agent tool list
- `openclaw unbrowse-plugin print-bootstrap` prints Unbrowse-first guidance

## Required Configuration

If you use the installer script above, it handles the main config writes automatically. This section is for manual installs and debugging.

After manual install, several config steps must be completed before an agent can see and call the `unbrowse` tool. Without these, the plugin may register but the tool will be invisible or the gateway will never connect.

### 1. Allow the plugin (REQUIRED)

Non-bundled plugins are not loaded without explicit allowlisting:

```bash
openclaw config set plugins.allow '["unbrowse-openclaw"]' --strict-json
```

Without this, the gateway logs: `plugins.allow is empty; discovered non-bundled plugins may auto-load: unbrowse-openclaw`

### 2. Remove tools.profile (REQUIRED if set)

If your config has a `tools.profile` (e.g. `"coding"`), plugin-registered tools like `unbrowse` will not appear — profiles define a fixed whitelist that does not include plugins.

```bash
openclaw config unset tools.profile
```

Verify the tool is visible:

```bash
openclaw gateway restart
openclaw agent --local -m "list your tools"
```

### 3. Enable Telegram plugin (if using Telegram)

The Telegram channel plugin is disabled by default:

```bash
openclaw plugins enable telegram
openclaw gateway restart
```

### 4. Set DM policy (if using Telegram)

The default `dmPolicy: "pairing"` requires manual approval per user. To allow all DMs:

```bash
openclaw config set channels.telegram.dmPolicy '"open"' --strict-json
openclaw gateway restart
```

### 5. Fix permissions (if installed with sudo)

If OpenClaw was installed as root, agent directories may be owned by root:

```bash
sudo chown -R $(whoami) ~/.openclaw/agents ~/.openclaw/workspace ~/.openclaw/logs
```


## What agents get

Tool:

```json
{
  "action": "resolve",
  "intent": "get pricing page API data",
  "url": "https://example.com"
}
```

Actions: `resolve`, `search`, `execute`, `login`, `skills`, `skill`, `health`

Integration:

- bootstrap guidance plus a `before_agent_start` system-prompt hint each run
- a shipped `unbrowse-browser` skill so the replacement policy shows up in OpenClaw's skill surface
- strict-mode blocking of the built-in `browser` tool via `before_tool_call`

## Default web path

This plugin makes `unbrowse` the default web path in practice by:

- teaching the agent to prefer `unbrowse`
- shipping a skill that reinforces the policy
- optionally blocking `browser` in strict mode

### Fallback mode

Prefer Unbrowse first. Let `browser` handle real UI-only tasks.

- [examples/openclaw.fallback.json5](./examples/openclaw.fallback.json5)

### Strict mode

Route normal web tasks through Unbrowse by blocking the built-in `browser` tool.

- [examples/openclaw.strict.json5](./examples/openclaw.strict.json5)

Strict mode is the closest thing to making Unbrowse the default browser path without patching OpenClaw core.

## Tool policy

If you use tool allowlists, allow one of:

- plugin id: `unbrowse-openclaw`
- tool name: `browser`
- tool name: `unbrowse`
- `group:plugins`

Example:

```json5
{
  tools: {
    allow: ["unbrowse", "unbrowse-openclaw"]
  }
}
```

## Local dev install

Load directly from source with `plugins.load.paths`:

```json5
{
  plugins: {
    allow: ["unbrowse-openclaw"],
    load: { paths: ["/absolute/path/to/unbrowse-openclaw"] },
    entries: {
      "unbrowse-openclaw": {
        enabled: true,
        config: {
          routingMode: "fallback",
          preferInBootstrap: true,
          allowBrowserFallback: true,
          timeoutMs: 120000
        }
      }
    }
  }
}
```

## CLI helpers

```bash
npx unbrowse-openclaw install --restart
openclaw unbrowse-plugin health
openclaw unbrowse-plugin print-bootstrap
openclaw unbrowse-plugin print-config strict
openclaw unbrowse-plugin print-config fallback
openclaw unbrowse-plugin print-trusted-install
```

## Dev

```bash
npm test
npm run typecheck
```
