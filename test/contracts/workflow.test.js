import { readFile } from "node:fs/promises";
import { mkdtemp, readFile as readTextFile, rm, writeFile } from "node:fs/promises";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const repositoryRoot = new URL("../../", import.meta.url);
const deployWorkflowPath = new URL(
  "../../.github/workflows/deploy.yml",
  import.meta.url,
);
const mcpConfigPaths = [
  new URL("../../.mcp.json", import.meta.url),
  new URL("../../.vscode/mcp.json", import.meta.url),
];
const packagePath = new URL("../../package.json", import.meta.url);
const eslintConfigPath = new URL("../../eslint.config.js", import.meta.url);
const changesetConfigPath = new URL("../../.changeset/config.json", import.meta.url);
const releaseWorkflowPath = new URL(
  "../../.github/workflows/release.yml",
  import.meta.url,
);
const workflowPaths = [
  new URL("../../.github/workflows/ci.yml", import.meta.url),
  new URL("../../.github/workflows/deploy.yml", import.meta.url),
];
const nvmrcPath = new URL("../../.nvmrc", import.meta.url);
const allWorkflowPaths = [...workflowPaths, releaseWorkflowPath];

describe("deployment workflow contract", () => {
  it("requires explicit deployment opt-in", async () => {
    const workflow = await readFile(deployWorkflowPath, "utf8");

    assert.match(
      workflow,
      /if:\s*\$\{\{\s*vars\.DEPLOY_ENABLED\s*==\s*'true'\s*\}\}/,
    );
  });

  it("declares the same MCP servers in both config formats without credentials", async () => {
    /**
     * Keys that would mean a credential reached a tracked configuration file.
     *
     * A remote MCP server is addressed by URL and authorized interactively, so
     * none of these has a legitimate reason to appear here.
     */
    const credentialKeys = ["headers", "token", "apiKey", "api_key", "env", "command", "args"];

    /** @type {Array<{ label: string, names: string[] }>} */
    const declared = [];

    for (const configPath of mcpConfigPaths) {
      const label = configPath.pathname.slice(repositoryRoot.pathname.length);
      const config = JSON.parse(await readFile(configPath, "utf8"));
      const servers = config.mcpServers ?? config.servers;

      assert.ok(servers, `${label} must declare MCP servers`);

      for (const [name, server] of Object.entries(servers)) {
        for (const key of credentialKeys) {
          assert.ok(
            !(key in server),
            `${label} gives ${name} a ${key} key; MCP configuration holds no credentials`,
          );
        }

        // Exactly these two keys, so a future addition has to be reviewed here
        // rather than arriving unnoticed alongside a URL change.
        assert.deepEqual(
          Object.keys(server).sort(),
          ["type", "url"],
          `${label} must declare ${name} as { type, url } only`,
        );
        assert.equal(server.type, "http", `${label} must declare ${name} as an http server`);
        assert.match(server.url, /^https:\/\//, `${label} must give ${name} an https URL`);
      }

      declared.push({ label, names: Object.keys(servers).sort() });
    }

    // Whatever the set is, the two files must agree: an assistant reading one
    // and an editor reading the other would otherwise see different tooling.
    const [first, ...rest] = declared;

    assert.ok(first.names.length > 0, `${first.label} declares no MCP server`);

    for (const other of rest) {
      assert.deepEqual(
        other.names,
        first.names,
        `${other.label} and ${first.label} declare different MCP servers`,
      );
    }
  });

  it("defines lint scripts and an ESLint configuration", async () => {
    const packageJson = JSON.parse(await readFile(packagePath, "utf8"));

    assert.equal(packageJson.scripts.lint, "eslint .");
    assert.equal(packageJson.scripts["lint:fix"], "eslint . --fix");
    await readFile(eslintConfigPath, "utf8");
  });

  it("pins one supported Node.js version across tooling and CI", async () => {
    const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
    const nvmrc = (await readFile(nvmrcPath, "utf8")).trim();

    assert.match(nvmrc, /^\d+$/);
    assert.equal(packageJson.engines.node, `>=${nvmrc}`);

    for (const workflowPath of allWorkflowPaths) {
      const workflow = await readFile(workflowPath, "utf8");

      assert.match(workflow, /node-version-file:\s*\.nvmrc/);
      assert.doesNotMatch(workflow, /node-version:\s*\d/);
    }
  });

  it("defines the Changesets SemVer release contract", async () => {
    const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
    const changesetConfig = JSON.parse(await readFile(changesetConfigPath, "utf8"));
    const releaseWorkflow = await readFile(releaseWorkflowPath, "utf8");

    assert.equal(packageJson.scripts.changeset, "changeset");
    assert.equal(packageJson.scripts["changeset:status"], "changeset status");
    // Changesets must drive the bump, but the script may chain follow-up work
    // onto it — the lockfile refresh asserted in versioning.test.js does.
    assert.match(packageJson.scripts.version, /^changeset version\b/);
    assert.equal(packageJson.scripts.release, "changeset tag");
    assert.equal(changesetConfig.baseBranch, "main");
    assert.equal(changesetConfig.privatePackages.version, true);
    assert.match(releaseWorkflow, /branches:\s*\n\s*- main/);
    assert.match(releaseWorkflow, /fetch-depth:\s*0/);
    assert.match(releaseWorkflow, /changesets\/action@v1/);
    assert.match(releaseWorkflow, /version:\s*npm run version/);
  });

  it("names the CI job 'test' to match the documented required status check", async () => {
    const workflow = await readFile(workflowPaths[0], "utf8");

    assert.match(workflow, /jobs:\s*\n\s*test:\n(?:.*\n)*?\s*name:\s*test\b/);
  });

  it("keeps linting in the CI and deployment quality gates", async () => {
    for (const workflowPath of workflowPaths) {
      const workflow = await readFile(workflowPath, "utf8");

      assert.match(workflow, /run:\s*npm run lint/);
    }
  });

  it("rejects style violations and fixes them with ESLint", async () => {
    const fixtureDirectory = await mkdtemp(join(process.cwd(), ".eslint-contract-"));
    const fixturePath = join(fixtureDirectory, "fixture.js");

    try {
      await writeFile(fixturePath, "export default {value:1}\n");

      await assert.rejects(
        execFileAsync(
          process.execPath,
          [
            "node_modules/eslint/bin/eslint.js",
            "--config",
            fileURLToPath(eslintConfigPath),
            fixturePath,
          ],
          { cwd: process.cwd() },
        ),
      );

      await execFileAsync(process.execPath, [
        "node_modules/eslint/bin/eslint.js",
        "--config",
        fileURLToPath(eslintConfigPath),
        "--fix",
        fixturePath,
      ], { cwd: process.cwd() });

      assert.equal(await readTextFile(fixturePath, "utf8"), "export default { value: 1 };\n");
    } finally {
      await rm(fixtureDirectory, { recursive: true, force: true });
    }
  });
});