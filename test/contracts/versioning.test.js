import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const packagePath = new URL("../../package.json", import.meta.url);
const lockPath = new URL("../../package-lock.json", import.meta.url);

/**
 * Read the package manifest and its lockfile together.
 *
 * Both are parsed as JSON rather than pattern-matched so these assertions
 * describe the values npm actually reads.
 *
 * @returns {Promise<{ manifest: Record<string, unknown>, lock: Record<string, unknown> }>}
 */
async function readManifests() {
  const [manifest, lock] = await Promise.all([
    readFile(packagePath, "utf8").then(JSON.parse),
    readFile(lockPath, "utf8").then(JSON.parse),
  ]);

  return { manifest, lock };
}

describe("versioning contract", () => {
  it("keeps the lockfile's version in step with the manifest", async () => {
    const { manifest, lock } = await readManifests();

    assert.equal(
      lock.version,
      manifest.version,
      "package-lock.json's root version must match package.json",
    );
    assert.equal(
      lock.packages?.[""]?.version,
      manifest.version,
      "package-lock.json's packages[\"\"] version must match package.json",
    );
  });

  it("keeps the lockfile's name in step with the manifest", async () => {
    const { manifest, lock } = await readManifests();

    assert.equal(lock.name, manifest.name);
    assert.equal(lock.packages?.[""]?.name, manifest.name);
  });

  it("refreshes the lockfile when a version is cut", async () => {
    const { manifest } = await readManifests();

    // `changeset version` rewrites package.json and CHANGELOG.md but never
    // touches the lockfile, so the release script has to refresh it or every
    // release ships a lockfile naming the previous version.
    assert.match(
      manifest.scripts.version,
      /--package-lock-only\b/,
      "the version script must refresh package-lock.json after bumping",
    );
  });
});
