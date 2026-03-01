import * as fs from "node:fs";
import {
  DOLT_ROOT_PATH_FILE,
  DOLT_SERVER_PORT_FILE,
  GOLDEN_SERVER_PID_FILE,
  GOLDEN_TEMPLATE_PATH_FILE,
  TEST_SERVER_PID_REGISTRY,
} from "./global-setup";
import { killDetachedProcess } from "./test-utils";

export default async function globalTeardown(): Promise<void> {
  // Kill golden template's dolt sql-server so it does not outlive the test run
  if (fs.existsSync(GOLDEN_SERVER_PID_FILE)) {
    const pid = Number.parseInt(
      fs.readFileSync(GOLDEN_SERVER_PID_FILE, "utf8").trim(),
      10,
    );
    if (Number.isFinite(pid)) {
      await killDetachedProcess(pid);
    }
    fs.unlinkSync(GOLDEN_SERVER_PID_FILE);
  }
  if (fs.existsSync(DOLT_SERVER_PORT_FILE)) {
    fs.unlinkSync(DOLT_SERVER_PORT_FILE);
  }

  // Kill any per-test dolt servers that survived (leaked) during the test run
  if (fs.existsSync(TEST_SERVER_PID_REGISTRY)) {
    try {
      const pids: number[] = JSON.parse(
        fs.readFileSync(TEST_SERVER_PID_REGISTRY, "utf8"),
      );
      for (const pid of pids) {
        await killDetachedProcess(pid);
      }
    } catch {
      // ignore parse errors
    }
    try {
      fs.unlinkSync(TEST_SERVER_PID_REGISTRY);
    } catch {
      // ignore
    }
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
