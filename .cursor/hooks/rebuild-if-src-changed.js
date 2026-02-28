#!/usr/bin/env node

const path = require("path");
const { execSync } = require("child_process");

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  try {
    const payload = JSON.parse(input || "{}");
    const roots = payload.workspace_roots || [process.cwd()];
    const root = path.resolve(roots[0]);
    const srcDir = path.join(root, "src");
    const srcRelative = path.relative(root, srcDir) || "src";

    // Check for changes under src/ (modified, added, deleted, untracked)
    const status = execSync(
      `git status --porcelain -- "${srcRelative}"`,
      { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
    ).trim();

    if (!status) {
      return;
    }

    // Run build from repo root
    execSync("pnpm build", {
      cwd: root,
      encoding: "utf8",
      stdio: "inherit",
    });
    console.error("[cursor hook] Rebuilt after src/ changes.");
    // Run cheap-gate so dist is validated
    try {
      execSync("bash scripts/cheap-gate.sh", {
        cwd: root,
        encoding: "utf8",
        stdio: "inherit",
      });
      console.error("[cursor hook] Cheap gate passed.");
    } catch (gateErr) {
      console.error("[cursor hook] cheap-gate failed (non-fatal):", gateErr.message);
    }
  } catch (err) {
    // Non-zero git status or missing pnpm is fine; don't break the hook protocol
    if (err.code !== "ENOENT" && err.status !== 128) {
      console.error("[cursor hook] rebuild-if-src-changed:", err.message);
    }
  }
});
