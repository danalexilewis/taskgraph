import * as fs from "node:fs";
import * as path from "node:path";
import type { Command } from "commander";
import { ResultAsync } from "neverthrow";
import { type AppError, buildError, ErrorCode } from "../domain/errors";

type SetupOptions = {
  docs: boolean;
  cursor: boolean;
  force: boolean;
};

type CopyResult = {
  created: string[];
  skipped: string[];
};

/** Minimal .cursor rule(s) always installed so the system knows how to use tg. */
const MINIMAL_CURSOR_RULES = [".cursor/rules/tg-usage.mdc"];

function copyTree(
  srcDir: string,
  destDir: string,
  repoRoot: string,
  options: SetupOptions,
  result: CopyResult,
): void {
  if (!fs.existsSync(srcDir)) return;
  // Ensure destination exists so we merge contents side-by-side with existing files
  fs.mkdirSync(destDir, { recursive: true });
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      if (!fs.existsSync(destPath)) {
        fs.mkdirSync(destPath, { recursive: true });
      }
      copyTree(srcPath, destPath, repoRoot, options, result);
      continue;
    }

    if (!entry.isFile()) continue;

    const rel = path.relative(repoRoot, destPath);
    if (fs.existsSync(destPath) && !options.force) {
      result.skipped.push(rel);
      continue;
    }

    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(srcPath, destPath);
    result.created.push(rel);
  }
}

export function setupCommand(program: Command) {
  program
    .command("setup")
    .description(
      "Scaffold repo conventions (docs/skills, example domain docs; optionally Cursor rules/agents/skills)",
    )
    .option("--no-docs", "Do not scaffold docs/ (domain docs + docs/skills)")
    .option(
      "--cursor",
      "Also scaffold Cursor rules, agents, skills, and AGENT.md into .cursor/",
    )
    .option("--force", "Overwrite existing files", false)
    .action(async (rawOptions: unknown, cmd) => {
      const raw = rawOptions as Partial<SetupOptions>;
      const options: SetupOptions = {
        docs: raw.docs ?? true,
        cursor: raw.cursor ?? false,
        force: raw.force ?? false,
      };
      const repoRoot = process.cwd();
      // At runtime this file is at dist/cli/setup.js; templates live at dist/template.
      const templateRoot = path.join(__dirname, "..", "template");

      const run = (): void => {
        const result: CopyResult = { created: [], skipped: [] };

        if (!fs.existsSync(templateRoot)) {
          throw buildError(
            ErrorCode.FILE_READ_FAILED,
            `Template directory missing: ${templateRoot}`,
          );
        }

        if (options.docs) {
          const docsSrc = path.join(templateRoot, "docs");
          // Merges into existing docs/ and docs/skills/; adds template files that don't exist
          copyTree(
            docsSrc,
            path.join(repoRoot, "docs"),
            repoRoot,
            options,
            result,
          );
        }

        // .config/ (Worktrunk wt.toml, etc.) — always scaffold when template has it
        const configSrc = path.join(templateRoot, ".config");
        if (fs.existsSync(configSrc)) {
          copyTree(
            configSrc,
            path.join(repoRoot, ".config"),
            repoRoot,
            options,
            result,
          );
        }

        // Always install minimal rule so the system knows how to use tg
        for (const rel of MINIMAL_CURSOR_RULES) {
          const srcPath = path.join(templateRoot, rel);
          const destPath = path.join(repoRoot, rel);
          if (!fs.existsSync(srcPath)) continue;
          fs.mkdirSync(path.dirname(destPath), { recursive: true });
          if (fs.existsSync(destPath) && !options.force) {
            result.skipped.push(rel);
            continue;
          }
          fs.copyFileSync(srcPath, destPath);
          result.created.push(rel);
        }

        if (options.cursor) {
          const cursorSrc = path.join(templateRoot, ".cursor");
          // Merges into existing .cursor/ and .cursor/rules/; adds template files that don't exist
          copyTree(
            cursorSrc,
            path.join(repoRoot, ".cursor"),
            repoRoot,
            options,
            result,
          );
          const agentMdSrc = path.join(templateRoot, "AGENT.md");
          const agentMdDest = path.join(repoRoot, "AGENT.md");
          if (fs.existsSync(agentMdSrc)) {
            const rel = path.relative(repoRoot, agentMdDest);
            if (fs.existsSync(agentMdDest) && !options.force) {
              result.skipped.push(rel);
            } else {
              fs.copyFileSync(agentMdSrc, agentMdDest);
              result.created.push(rel);
            }
          }
        }

        const json = Boolean(cmd.parent?.opts().json);
        if (json) {
          console.log(
            JSON.stringify({
              status: "ok",
              created: result.created.sort(),
              skipped: result.skipped.sort(),
            }),
          );
          return;
        }

        console.log("TaskGraph scaffold complete.");
        if (result.created.length > 0) {
          console.log("Created:");
          result.created.sort().forEach((p) => {
            console.log(`  + ${p}`);
          });
        }
        if (result.skipped.length > 0) {
          console.log("Skipped (already exists):");
          result.skipped.sort().forEach((p) => {
            console.log(`  = ${p}`);
          });
          console.log("Tip: re-run with --force to overwrite.");
        }
        if (!options.cursor && options.docs) {
          console.log(
            "Tip: add Cursor rules, agents, and skills with: pnpm tg setup --cursor",
          );
        }
      };

      const res = await ResultAsync.fromPromise(
        Promise.resolve().then(run),
        (e) =>
          buildError(
            ErrorCode.FILE_READ_FAILED,
            "Failed to scaffold repo files",
            e,
          ),
      );

      res.match(
        () => {},
        (error: unknown) => {
          const appError = error as AppError;
          console.error(`Error: ${appError.message}`);
          if (cmd.parent?.opts().json) {
            console.log(
              JSON.stringify({
                status: "error",
                code: appError.code,
                message: appError.message,
                cause: appError.cause,
              }),
            );
          }
          process.exit(1);
        },
      );
    });
}
