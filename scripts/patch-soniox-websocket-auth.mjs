import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// SDK 2.3.0 still authenticates STT in the first message and has no transport hook.
// Keep this version-scoped patch until the official SDK supports connection auth.
const sdkDirectory = dirname(createRequire(import.meta.url).resolve("@soniox/client"));
const sdkPackage = JSON.parse(readFileSync(join(sdkDirectory, "..", "package.json"), "utf8"));
if (sdkPackage.version !== "2.3.0") {
  throw new Error("Review the Soniox WebSocket authentication patch before changing SDK 2.3.0.");
}

const replacements = [
  [
    "function buildConfigMessage(config, apiKey) {\n\treturn {\n\t\tapi_key: apiKey,",
    "function buildConfigMessage(config) {\n\treturn {"
  ],
  [
    "const ws = new WebSocket(this.wsBaseUrl);",
    "const ws = new WebSocket(this.wsBaseUrl, [\"soniox-api-key\", this.apiKey]);"
  ],
  [
    "const configMessage = buildConfigMessage(this.config, this.apiKey);",
    "const configMessage = buildConfigMessage(this.config);"
  ]
];

// patchBundle accepts only the expected original or already-patched STT blocks.
function patchBundle(source, filename) {
  let patched = source.replaceAll("\r\n", "\n");
  for (const [before, after] of replacements) {
    const originalCount = patched.split(before).length - 1;
    const patchedCount = patched.split(after).length - 1;
    if (originalCount === 1 && patchedCount === 0) {
      patched = patched.replace(before, after);
    } else if (originalCount !== 0 || patchedCount !== 1) {
      throw new Error(`Unexpected Soniox SDK STT source in ${filename}; authentication patch refused.`);
    }
  }
  return patched;
}

// Validate both module formats before writing either; repeated installs are safe.
const bundles = ["index.mjs", "index.cjs"].map((filename) => {
  const path = join(sdkDirectory, filename);
  const source = readFileSync(path, "utf8");
  return { path, source, patched: patchBundle(source, filename) };
});
for (const { path, source, patched } of bundles) {
  if (source !== patched) writeFileSync(path, patched, "utf8");
}
