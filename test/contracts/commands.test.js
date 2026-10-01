import { readdir, readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const commandsDirectory = new URL("../../src/commands/", import.meta.url);
const registryPath = new URL("index.js", commandsDirectory);

/**
 * The command registry is the one module both halves of the template read: the
 * Worker dispatches from it and the registration script registers from it. That
 * only works while it imports under plain Node, so this contract test runs
 * outside the Workers pool on purpose — it is the check that a
 * `cloudflare:`-prefixed import has not made the registry Worker-only.
 */
describe("command registry contract", () => {
  it("imports under plain Node", async () => {
    const registry = await import(registryPath.href);

    assert.ok(Array.isArray(registry.commands), "src/commands/index.js must export a commands array");
  });

  it("declares no Workers-runtime imports anywhere under src/commands/", async () => {
    const files = (await readdir(commandsDirectory)).filter((name) => name.endsWith(".js"));

    assert.ok(files.length > 0, "expected at least src/commands/index.js");

    for (const file of files) {
      const source = await readFile(new URL(file, commandsDirectory), "utf8");

      assert.doesNotMatch(
        source,
        /from\s+["']cloudflare:/,
        `src/commands/${file} imports a cloudflare: module, which the registration script cannot load`,
      );
    }
  });
});
