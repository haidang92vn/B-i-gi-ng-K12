import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Playwright owns browser specifications in e2e/. Vitest keeps unit tests
    // isolated so both runners can execute in the same CI job.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
