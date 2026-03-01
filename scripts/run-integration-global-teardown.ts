/**
 * Runs the integration test global teardown: removes the golden template
 * directory and the GOLDEN_TEMPLATE_PATH_FILE so no temp dirs are leaked.
 * Same pattern as run-integration-global-setup.ts; invoked after
 * test:integration or after gate runs that execute integration tests.
 */
import globalTeardown from "../__tests__/integration/global-teardown";

globalTeardown()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Integration global teardown failed:", err);
    process.exit(1);
  });
