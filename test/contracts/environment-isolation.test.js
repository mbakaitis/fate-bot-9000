import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const wranglerConfigPath = new URL(
  "../../wrangler.jsonc",
  import.meta.url,
);

describe("environment isolation contract", () => {
  it("defines separate Worker names for each environment", async () => {
    const configText = await readFile(wranglerConfigPath, "utf8");
    const config = JSON.parse(configText);

    // Verify top-level name exists
    assert.equal(typeof config.name, "string", "Top-level name must be defined");
    assert.match(config.name, /\S/, "Top-level name must not be empty");

    // Verify non-prod environment exists and has a name
    assert.equal(typeof config.env?.["non-prod"]?.name, "string", "env.non-prod.name must be defined");
    assert.match(config.env["non-prod"].name, /\S/, "env.non-prod.name must not be empty");

    // Verify production environment exists and has a name
    assert.equal(typeof config.env?.production?.name, "string", "env.production.name must be defined");
    assert.match(config.env.production.name, /\S/, "env.production.name must not be empty");
  });

  it("ensures Worker names are unique across environments", async () => {
    const configText = await readFile(wranglerConfigPath, "utf8");
    const config = JSON.parse(configText);

    const names = [
      config.name,
      config.env["non-prod"].name,
      config.env.production.name,
    ];

    // Check for duplicates
    const uniqueNames = new Set(names);
    assert.equal(
      uniqueNames.size,
      names.length,
      "All Worker names must be unique across top-level, non-prod, and production environments",
    );
  });

  it("ensures non-prod and production are properly distinguished by name", async () => {
    const configText = await readFile(wranglerConfigPath, "utf8");
    const config = JSON.parse(configText);

    const nonProdName = config.env["non-prod"].name;
    const prodName = config.env.production.name;

    // Simple check: production name should contain 'production' or 'prod'
    // and non-prod should not contain 'production'
    assert(
      nonProdName.includes("non-prod") || nonProdName.includes("staging") || nonProdName.includes("dev"),
      `non-prod Worker name should include a non-production indicator, got: ${nonProdName}`,
    );

    assert(
      prodName.includes("production") || prodName.includes("prod"),
      `production Worker name should include 'production' or 'prod', got: ${prodName}`,
    );
  });

  it("prevents configuration of production bindings at top level", async () => {
    const configText = await readFile(wranglerConfigPath, "utf8");
    const config = JSON.parse(configText);

    // Check that top-level config does not define production-specific resources
    // (bindings, durable objects, etc. that suggest production configuration)
    const topLevelEnv = config;

    // Ensure no conflicting/production-specific bindings at top level
    if (topLevelEnv.d1_databases || topLevelEnv.r2_buckets || topLevelEnv.kv_namespaces) {
      throw new Error(
        "Top-level Wrangler config should not define production bindings. " +
        "Move all resource bindings into env.non-prod or env.production.",
      );
    }
  });

  it("documents the intended environment in each binding configuration", async () => {
    const configText = await readFile(wranglerConfigPath, "utf8");
    const config = JSON.parse(configText);

    // Ensure non-prod environment has proper structure
    assert(config.env["non-prod"], "env.non-prod must be defined");
    
    // Ensure production environment has proper structure
    assert(config.env.production, "env.production must be defined");

    // This is a structural test; actual resource-specific tests should verify
    // that staging/non-prod resources do not point to production account/resource IDs.
  });
});
