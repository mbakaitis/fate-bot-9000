import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const vitestConfigPath = new URL("../../vitest.config.js", import.meta.url);
const packagePath = new URL("../../package.json", import.meta.url);

const thresholdKeys = ["branches", "functions", "lines", "statements"];

/**
 * Read the coverage section of the Vitest configuration.
 *
 * The configuration is imported rather than pattern-matched so these assertions
 * describe the values Vitest actually receives.
 *
 * @returns {Promise<Record<string, unknown>>}
 */
async function readCoverageConfig() {
  const { default: config } = await import(vitestConfigPath.href);

  return config.test?.coverage ?? {};
}

describe("coverage ratchet contract", () => {
  it("enforces non-zero coverage thresholds", async () => {
    const coverage = await readCoverageConfig();
    const thresholds = coverage.thresholds;

    assert.ok(
      thresholds,
      "vitest.config.js must configure test.coverage.thresholds",
    );

    for (const key of thresholdKeys) {
      assert.equal(
        typeof thresholds[key],
        "number",
        `the ${key} coverage threshold must be a number`,
      );
      assert.ok(
        thresholds[key] > 0,
        `the ${key} coverage threshold must be greater than zero`,
      );
    }
  });

  it("raises thresholds only through a reviewed change", async () => {
    const coverage = await readCoverageConfig();

    assert.notEqual(
      coverage.thresholds?.autoUpdate,
      true,
      "coverage.thresholds.autoUpdate would raise the ratchet without review",
    );
  });

  it("uses the Istanbul provider the Workers pool requires", async () => {
    const coverage = await readCoverageConfig();

    assert.equal(coverage.provider, "istanbul");
  });

  it("measures the template's Worker source and script libraries", async () => {
    const coverage = await readCoverageConfig();

    assert.ok(Array.isArray(coverage.include));
    assert.ok(coverage.include.some((pattern) => pattern.startsWith("src/")));
    assert.ok(
      coverage.include.some((pattern) => pattern.startsWith("scripts/lib/")),
    );
  });

  it("measures coverage as part of npm test", async () => {
    const manifest = JSON.parse(await readFile(packagePath, "utf8"));

    assert.match(manifest.scripts.test, /--coverage\b/);
  });
});
