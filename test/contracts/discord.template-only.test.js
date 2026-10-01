import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * Assertions about the Discord surface that are true only of this template.
 *
 * A project created from this template deletes this whole file, so nothing here
 * may be imported by a sibling that ships downstream. The two small constants
 * below are therefore repeated rather than shared with `discord.test.js`:
 * coupling the shipped file to this one would break the moment it is deleted.
 *
 * See `CONTRIBUTING.md`, "Template-only contract tests".
 */

const wranglerConfigPath = new URL("../../wrangler.jsonc", import.meta.url);
const devVarsExamplePath = new URL("../../.dev.vars.example", import.meta.url);

/** The Discord credentials the Worker's environments must declare, by name. */
const requiredDiscordSecrets = ["DISCORD_PUBLIC_KEY", "DISCORD_APPLICATION_ID", "DISCORD_TOKEN"];

/**
 * Parse `wrangler.jsonc`.
 *
 * The file carries no comments today, so `JSON.parse` is enough and keeps this
 * contract test dependency-free — matching `discord.test.js`.
 *
 * @returns {Promise<Record<string, any>>}
 */
async function readWranglerConfig() {
  return JSON.parse(await readFile(wranglerConfigPath, "utf8"));
}

describe("template environment set contract", () => {
  it("declares exactly a non-production and a production environment", async () => {
    const config = await readWranglerConfig();
    const environments = Object.keys(config.env ?? {});

    // The template ships exactly these two. A project may add a third, which is
    // why `discord.test.js` asserts only that both of these exist.
    assert.deepEqual(environments.sort(), ["non-prod", "production"]);
  });
});

describe("template local development secrets contract", () => {
  it("provides a placeholder-only .dev.vars.example covering every Discord variable", async () => {
    const example = await readFile(devVarsExamplePath, "utf8");
    const assignments = new Map(
      example
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => {
          const [name, ...rest] = line.split("=");

          return [name.trim(), rest.join("=").trim().replace(/^"|"$/g, "")];
        }),
    );

    for (const name of [...requiredDiscordSecrets, "DISCORD_GUILD_ID"]) {
      assert.ok(assignments.has(name), `.dev.vars.example must document ${name}`);
    }

    for (const [name, value] of assignments) {
      assert.match(
        value,
        /replace-me/,
        `.dev.vars.example must give ${name} an obvious placeholder, not ${value}`,
      );
    }
  });
});
