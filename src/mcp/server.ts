import type { Config } from "../cli/utils.js";
import { McpServer, StdioServerTransport } from "./sdk-loader.js";
import { registerTools } from "./tools.js";

/**
 * Run the MCP server over stdio. Reads config from .taskgraph/config.json (passed in)
 * so the server has the Dolt repo path for future tool use.
 */
export async function run(config: Config): Promise<void> {
  const server = new McpServer(
    { name: "taskgraph-mcp", version: "3.0.0" },
    { capabilities: { tools: {} } },
  );
  registerTools(server, config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Keep process alive; transport uses stdin/stdout.
}
