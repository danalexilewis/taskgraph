/**
 * tg health (ping): check Dolt/DB reachability only. No migrations.
 * Exit 0 if reachable, non-zero with clear message if connection refused / timeout.
 */
import type { Command } from "commander";
import { doltSql } from "../db/connection";
import { ErrorCode } from "../domain/errors";
import { readConfig, rootOpts } from "./utils";
import { detectAndApplyServerPort, probePort } from "./server";

const HEALTH_TIMEOUT_MS = 5000; // used for server probe only

export function healthCommand(program: Command): void {
  program
    .command("health")
    .description("Check Dolt/DB reachability (no migrations). Exit 0 if reachable.")
    .action(async (_options, cmd) => {
      const configResult = readConfig();
      if (configResult.isErr()) {
        console.error(configResult.error.message);
        if (configResult.error.code === ErrorCode.CONFIG_NOT_FOUND) {
          console.error("Run tg init first.");
        }
        process.exit(1);
      }
      const config = configResult.value;
      await detectAndApplyServerPort(config);
      const port = process.env.TG_DOLT_SERVER_PORT;
      if (port) {
        try {
          await probePort(Number(port), HEALTH_TIMEOUT_MS);
          if (rootOpts(cmd).json) {
            console.log(JSON.stringify({ status: "ok", message: "Dolt reachable" }));
          } else {
            console.log("Dolt reachable.");
          }
          process.exit(0);
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Connection failed";
          if (rootOpts(cmd).json) {
            console.log(JSON.stringify({ status: "error", message: msg }));
          } else {
            console.error("Dolt unreachable:", msg);
          }
          process.exit(1);
        }
      }
      const result = await doltSql("SELECT 1", config.doltRepoPath);
      result.match(
        () => {
          if (rootOpts(cmd).json) {
            console.log(JSON.stringify({ status: "ok", message: "Dolt reachable" }));
          } else {
            console.log("Dolt reachable.");
          }
          process.exit(0);
        },
        (e: unknown) => {
          const msg =
            e && typeof e === "object" && "message" in e
              ? String((e as { message: unknown }).message)
              : "Connection failed";
          if (rootOpts(cmd).json) {
            console.log(JSON.stringify({ status: "error", message: msg }));
          } else {
            console.error("Dolt unreachable:", msg);
          }
          process.exit(1);
        },
      );
    });
}
