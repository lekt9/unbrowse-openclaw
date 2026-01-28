#!/usr/bin/env bun
/**
 * Local test — parse a real HAR file through the unbrowse pipeline.
 * Usage: bun test-local.ts <har-file>
 */

import { parseHar } from "./src/har-parser.ts";
import { generateSkill } from "./src/skill-generator.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const harPath = process.argv[2];
if (!harPath) {
  console.log("Usage: bun test-local.ts <har-file>");
  console.log("Example: bun test-local.ts ~/Documents/stocktwits.com_Archive*.har");
  process.exit(1);
}

console.log(`\n=== Unbrowse Test ===\n`);
console.log(`HAR: ${harPath}`);

// 1. Parse HAR
const raw = JSON.parse(readFileSync(harPath, "utf-8"));
console.log(`Entries in HAR: ${raw.log?.entries?.length ?? 0}\n`);

const apiData = parseHar(raw);

console.log(`Service: ${apiData.service}`);
console.log(`Base URL: ${apiData.baseUrl}`);
console.log(`Base URLs: ${apiData.baseUrls.join(", ")}`);
console.log(`Auth method: ${apiData.authMethod}`);
console.log(`Auth headers: ${Object.keys(apiData.authHeaders).length}`);
for (const [k, v] of Object.entries(apiData.authHeaders)) {
  console.log(`  ${k}: ${v.slice(0, 60)}${v.length > 60 ? "..." : ""}`);
}
console.log(`Cookies: ${Object.keys(apiData.cookies).length}`);
console.log(`Requests: ${apiData.requests.length}`);
console.log(`Endpoints: ${Object.keys(apiData.endpoints).length}`);

console.log(`\nEndpoints:`);
for (const [key, reqs] of Object.entries(apiData.endpoints).slice(0, 20)) {
  const r = reqs[0];
  console.log(`  ${r.method} ${r.path} (${reqs.length}x, status ${r.status})`);
}
if (Object.keys(apiData.endpoints).length > 20) {
  console.log(`  ... and ${Object.keys(apiData.endpoints).length - 20} more`);
}

// 2. Generate skill
const outputDir = "/tmp/unbrowse-test-skills";
console.log(`\nGenerating skill to: ${outputDir}`);

const result = await generateSkill(apiData, outputDir);
console.log(`\nSkill: ${result.service}`);
console.log(`Dir: ${result.skillDir}`);
console.log(`Endpoints: ${result.endpointCount}`);
console.log(`Auth headers: ${result.authHeaderCount}`);
console.log(`Cookies: ${result.cookieCount}`);

// 3. Show generated files
console.log(`\nGenerated files:`);
const files = ["SKILL.md", "auth.json", "scripts/api.ts", "test.ts"];
for (const f of files) {
  const path = join(result.skillDir, f);
  try {
    const content = readFileSync(path, "utf-8");
    console.log(`\n--- ${f} (${content.length} bytes) ---`);
    console.log(content.slice(0, 500));
    if (content.length > 500) console.log(`... (${content.length - 500} more bytes)`);
  } catch {
    console.log(`  ${f}: NOT FOUND`);
  }
}

console.log(`\n=== Done ===\n`);
