/**
 * Runs the integration test global setup once: creates the golden template
 * (dolt init + migrations) and writes its path to GOLDEN_TEMPLATE_PATH_FILE
 * so that `bun test __tests__/integration` can find it. Bun does not run
 * Vitest-style globalSetup automatically; this script is invoked before
 * test:integration in package.json.
 */
import globalSetup from "../__tests__/integration/global-setup";

globalSetup()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Integration global setup failed:", err);
    process.exit(1);
  });
