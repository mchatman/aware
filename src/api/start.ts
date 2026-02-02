/**
 * Standalone entry point for the Aware API server.
 * Usage: npx tsx src/api/start.ts
 * @module
 */

import { startApiServer } from "./index.js";

startApiServer().catch((err) => {
  console.error("Failed to start API server:", err);
  process.exit(1);
});
