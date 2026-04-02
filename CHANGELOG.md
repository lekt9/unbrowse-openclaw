# Changelog

## Unreleased

- add a package bin so the published npm package installs with `npx unbrowse-openclaw install` instead of requiring a repo checkout
- add `scripts/install-openclaw.sh` so install is one command instead of a plugin install plus manual config surgery
- add `print-trusted-install` so the README's trusted local-load path is real, not aspirational
- include `plugins.allow` in the generated config snippet so plugin enablement works on first paste
- clean up README verification/tool-allowlist guidance to match the shipped plugin behavior
- align plugin id with the published npm package name `unbrowse-openclaw` so OpenClaw install/update/config references stay consistent
- ship a native `unbrowse-browser` skill plus `before_agent_start` guidance so OpenClaw treats Unbrowse as the default web path instead of just another tool
- in strict mode, block the built-in `browser` tool via `before_tool_call`
- bump bundled `unbrowse` runtime to `1.1.5` so broken `keytar` native bindings demote to the encrypted file vault instead of crashing auth-backed runs

## 0.7.13

- npm package renamed to `unbrowse-openclaw`
- README simplified around what the plugin does and the real install path

## 0.7.12

- initial OpenClaw plugin scaffold
- Unbrowse-backed agent tool
- bootstrap guidance for preferring Unbrowse over the built-in browser tool
- strict/fallback routing presets plus generated OpenClaw config snippets
- dedicated bootstrap prompt template for agent decisioning
- plugin CLI helpers for health, bootstrap preview, and config printing
- README install/config docs aligned with OpenClaw plugin and tool-policy docs
- package prepared for scoped npm publish
