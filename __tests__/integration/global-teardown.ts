import * as fs from "node:fs";
import * as process from "node:process";
import {
  DOLT_ROOT_PATH_FILE,
  DOLT_SERVER_PORT_FILE,
  GOLDEN_SERVER_PID_FILE,
  GOLDEN_TEMPLATE_PATH_FILE,
} from "./global-setup";

export default async function globalTeardown(): Promise<void> {
  // Kill golden template's dolt sql-server so it does not outlive the test run
  if (fs.existsSync(GOLDEN_SERVER_PID_FILE)) {
    try {
      const pid = Number.parseInt(
        fs.readFileSync(GOLDEN_SERVER_PID_FILE, "utf8").trim(),
        10,
      );
      if (Number.isFinite(pid)) {
        process.kill(pid, "SIGTERM");
      }
    } catch {
      // Process may already be dead
    }
    fs.unlinkSync(GOLDEN_SERVER_PID_FILE);
  }
  if (fs.existsSync(DOLT_SERVER_PORT_FILE)) {
    fs.unlinkSync(DOLT_SERVER_PORT_FILE);
  }

  if (!fs.existsSync(GOLDEN_TEMPLATE_PATH_FILE)) return;
  const templatePath = fs
    .readFileSync(GOLDEN_TEMPLATE_PATH_FILE, "utf8")
    .trim();
  if (templatePath && fs.existsSync(templatePath)) {
    fs.rmSync(templatePath, { recursive: true, force: true });
  }
  fs.unlinkSync(GOLDEN_TEMPLATE_PATH_FILE);
  if (fs.existsSync(DOLT_ROOT_PATH_FILE)) {
    fs.unlinkSync(DOLT_ROOT_PATH_FILE);
  }
}
