import * as path from "node:path";

let sdkRoot = path.dirname(
  require.resolve("@modelcontextprotocol/sdk/package.json"),
);
if (path.basename(sdkRoot) === "cjs" || path.basename(sdkRoot) === "esm") {
  sdkRoot = path.join(sdkRoot, "..", "..");
}

const mcp = require(path.join(sdkRoot, "dist/cjs/server/mcp.js"));
const stdio = require(path.join(sdkRoot, "dist/cjs/server/stdio.js"));

export const McpServer = mcp.McpServer;
export const StdioServerTransport = stdio.StdioServerTransport;
