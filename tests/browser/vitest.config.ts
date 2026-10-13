import { defineConfig } from "vitest/config";
import sharedConfig from "../../vitest.config";

// Keep real-browser checks separate from the browser-free unit test command.
export default defineConfig({ ...sharedConfig, test: { ...sharedConfig.test, include: ["tests/browser/**/*.test.ts"] } });
