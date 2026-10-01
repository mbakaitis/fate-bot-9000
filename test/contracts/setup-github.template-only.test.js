import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * `npm run setup:github` survives setup.
 *
 * Every other script this template ships for its own benefit is pruned by
 * `template-manifest.json` when a project runs `npm run setup`. This one is
 * not, and that is a decision worth a test rather than a comment: it is
 * idempotent and it verifies rather than only applies, so re-running it is how
 * a project re-checks its GitHub settings after a plan change, an organization
 * policy change, or a visibility change.
 *
 * Template-only, because the manifest it reads is itself pruned downstream.
 * `test/contracts/setup-github.test.js` holds the half a project keeps.
 *
 * See `CONTRIBUTING.md`, "Template-only contract tests".
 */

const manifestPath = new URL("../../template-manifest.json", import.meta.url);

/** Everything the manifest removes, by whatever route. */
const removedPaths = (manifest) => [
  ...manifest.prune,
  ...manifest.selfDelete.paths,
];

describe("setup:github survives setup", () => {
  it("is not pruned, and neither is its library or its shipped test", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const removed = removedPaths(manifest);

    for (const path of [
      "scripts/setup-github.js",
      "scripts/lib/setup-github.js",
      "test/contracts/setup-github.test.js",
      "test/scripts/setup-github.test.js",
    ]) {
      assert.ok(
        removed.includes(path) === false,
        `${path} is permanent, but the manifest removes it`,
      );
    }
  });

  it("keeps its npm script, which setup must not delete", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

    assert.ok(manifest.selfDelete.packageScripts.includes("setup:github") === false);
  });

  it("prunes its own template-only half", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

    assert.ok(manifest.prune.includes("test/contracts/setup-github.template-only.test.js"));
  });
});
