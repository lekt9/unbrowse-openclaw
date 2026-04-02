import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("exports plugin metadata", async () => {
  const mod = await import("../index.ts");
  const plugin = mod.default as { id?: string; name?: string; register?: unknown };

  assert.equal(plugin.id, "unbrowse-openclaw");
  assert.equal(plugin.name, "Unbrowse Browser");
  assert.equal(typeof plugin.register, "function");
});

test("strict mode bootstrap guide forbids browser fallback", async () => {
  const mod = await import("../index.ts");
  const guide = mod.__test.buildBootstrapGuide(mod.__test.normalizeConfig({ routingMode: "strict" }));

  assert.match(guide, /strict mode/i);
  assert.match(guide, /Do not use `browser`/);
});

test("fallback mode config keeps browser available", async () => {
  const mod = await import("../index.ts");
  const snippet = mod.__test.buildSuggestedConfig("fallback");

  assert.match(snippet, /"unbrowse-openclaw"/);
  assert.match(snippet, /allow: \["unbrowse-openclaw"\]/);
  assert.doesNotMatch(snippet, /slots:/);
  assert.doesNotMatch(snippet, /deny: \["browser"\]/);
});

test("resolve action maps to unbrowse CLI args", async () => {
  const mod = await import("../index.ts");
  const args = mod.__test.buildArgs({
    action: "resolve",
    intent: "get prices",
    url: "https://example.com",
    path: "data.items[]",
    extract: "title,price",
    limit: 5,
    dryRun: true,
  });

  assert.deepEqual(args, [
    "resolve",
    "--intent",
    "get prices",
    "--url",
    "https://example.com",
    "--path",
    "data.items[]",
    "--extract",
    "title,price",
    "--limit",
    "5",
    "--dry-run",
  ]);
});

test("before-agent guidance makes unbrowse the default web path", async () => {
  const mod = await import("../index.ts");
  const guide = mod.__test.buildBootstrapGuide(mod.__test.normalizeConfig({ routingMode: "strict" }));
  const systemPrompt = mod.__test.buildBeforeAgentStartGuidance(
    mod.__test.normalizeConfig({ routingMode: "strict" }),
  );

  assert.match(guide, /Use `unbrowse` as the default web path/);
  assert.match(systemPrompt, /`unbrowse` tool is the preferred website path/);
  assert.match(systemPrompt, /Strict mode is on/);
});

test("strict mode block reason points agents back to the Unbrowse path", async () => {
  const mod = await import("../index.ts");
  const reason = mod.__test.buildBrowserFallbackBlockReason();

  assert.match(reason, /`browser` is disabled/);
  assert.match(reason, /Use `unbrowse`/);
});

test("trusted install guide explains the local-load path", async () => {
  const mod = await import("../index.ts");
  const guide = mod.__test.buildTrustedInstallGuide("strict");

  assert.match(guide, /Trusted local-load path/);
  assert.match(guide, /node:child_process/);
  assert.match(guide, /process\.env/);
  assert.match(guide, /allow: \["unbrowse-openclaw"\]/);
});

test("plugin manifest ships the browser-routing skill", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../openclaw.plugin.json", import.meta.url), "utf8"),
  ) as { skills?: string[] };

  assert.deepEqual(manifest.skills, ["./skills"]);
  assert.match(
    readFileSync(new URL("../skills/unbrowse-browser/SKILL.md", import.meta.url), "utf8"),
    /Route website tasks through the Unbrowse-backed browser path/,
  );
});

test("package exposes the npm installer bin", () => {
  const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { bin?: Record<string, string>; dependencies?: Record<string, string> };

  assert.equal(pkg.bin?.["unbrowse-openclaw"], "./bin/unbrowse-openclaw.mjs");
  assert.equal(pkg.dependencies?.unbrowse, "^1.1.5");
});
