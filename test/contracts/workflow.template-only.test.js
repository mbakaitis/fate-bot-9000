import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * Assertions about the tooling configuration that are true only of this
 * template. A project created from this template deletes this whole file, so
 * nothing here may be imported by a sibling that ships downstream.
 *
 * See `CONTRIBUTING.md`, "Template-only contract tests".
 */

const mcpConfigPaths = [
  new URL("../../.mcp.json", import.meta.url),
  new URL("../../.vscode/mcp.json", import.meta.url),
];

/**
 * The documentation servers this template wires up, at the URLs
 * `docs/using-ai.md` names.
 *
 * Exact values, because a silently changed URL points an assistant at nothing
 * and a silently added server is a dependency nobody reviewed. A project is
 * free to add or drop servers, which is why `workflow.test.js` asserts only
 * that the two configuration files agree and neither holds a credential.
 */
const expectedServers = {
  "cloudflare-docs": "https://docs.mcp.cloudflare.com/mcp",
  "discord-docs": "https://docs.discord.com/mcp",
  github: "https://api.githubcopilot.com/mcp/",
};

describe("template MCP server contract", () => {
  it("declares exactly the documented MCP servers at their documented URLs", async () => {
    for (const configPath of mcpConfigPaths) {
      const config = JSON.parse(await readFile(configPath, "utf8"));
      const servers = config.mcpServers ?? config.servers;

      assert.deepEqual(Object.keys(servers).sort(), Object.keys(expectedServers).sort());

      for (const [name, url] of Object.entries(expectedServers)) {
        assert.equal(servers[name].url, url, `${name} must point at ${url}`);
      }
    }
  });
});
