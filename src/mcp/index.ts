import { readConfig } from "../cli/utils.js";
import { run } from "./server.js";

async function main(): Promise<void> {
  const configResult = readConfig();
  if (configResult.isErr()) {
    console.error(configResult.error.message);
    process.exit(1);
  }
  try {
    await run(configResult.value);
  } catch (err) {
    console.error("MCP server error:", err);
    process.exit(1);
  }
}

main();
