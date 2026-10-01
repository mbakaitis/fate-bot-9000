import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const packagePath = new URL("../../package.json", import.meta.url);
const cliPath = fileURLToPath(new URL("../../scripts/register-commands.js", import.meta.url));
const forbidFetchPath = new URL("../helpers/forbid-fetch.js", import.meta.url).href;

/**
 * Placeholder credentials for spawning the CLI. Shaped like the real thing,
 * valid for nothing, and never sent anywhere — `forbid-fetch.js` makes every
 * `fetch` in the child process throw.
 */
const placeholderEnvironment = {
  DISCORD_TOKEN: "placeholder-token-not-a-credential",
  DISCORD_APPLICATION_ID: "000000000000000000",
  DISCORD_GUILD_ID: "111111111111111111",
};

/**
 * Run the registration CLI in a child process with `fetch` disabled.
 *
 * Spawning the real file is the point: the wrapper is the one piece of the
 * registration path Vitest does not measure, so it gets exercised as a process
 * rather than excluded from coverage by fiat.
 *
 * @param {string[]} args Arguments to pass to the CLI.
 * @param {Record<string, string>} [environment] Environment variables, merged
 *   over a `PATH`-only base so nothing leaks in from the test runner's shell.
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
async function runCli(args, environment = placeholderEnvironment) {
  const options = {
    cwd: process.cwd(),
    env: { PATH: process.env.PATH, ...environment },
  };

  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ["--import", forbidFetchPath, cliPath, ...args],
      options,
    );

    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

describe("command registration CLI contract", () => {
  it("prints the guild plan on a dry run without contacting Discord", async () => {
    const { code, stdout } = await runCli(["--guild", "--dry-run"]);

    assert.equal(code, 0);
    assert.match(
      stdout,
      new RegExp(
        `PUT https://discord\\.com/api/v10/applications/${placeholderEnvironment.DISCORD_APPLICATION_ID}`
          + `/guilds/${placeholderEnvironment.DISCORD_GUILD_ID}/commands`,
      ),
    );
    assert.match(stdout, /authorization: Bot \[redacted\]/);
    assert.match(stdout, /"name": "ping"/);
    assert.match(stdout, /nothing was sent/i);
  });

  it("never prints the bot token, on any path", async () => {
    const dryRun = await runCli(["--global", "--dry-run"]);
    const failure = await runCli(["--guild"], {
      DISCORD_TOKEN: placeholderEnvironment.DISCORD_TOKEN,
      DISCORD_APPLICATION_ID: placeholderEnvironment.DISCORD_APPLICATION_ID,
    });

    for (const { stdout, stderr } of [dryRun, failure]) {
      assert.doesNotMatch(stdout, /placeholder-token-not-a-credential/);
      assert.doesNotMatch(stderr, /placeholder-token-not-a-credential/);
    }
  });

  it("registers globally without a guild path, even with a guild id in the environment", async () => {
    const { code, stdout } = await runCli(["--global", "--dry-run"]);

    assert.equal(code, 0);
    assert.doesNotMatch(stdout, /\/guilds\//);
    assert.match(
      stdout,
      new RegExp(
        `applications/${placeholderEnvironment.DISCORD_APPLICATION_ID}/commands`,
      ),
    );
  });

  it("exits non-zero and names the missing variable", async () => {
    const { code, stderr } = await runCli(["--guild", "--dry-run"], {
      DISCORD_APPLICATION_ID: placeholderEnvironment.DISCORD_APPLICATION_ID,
    });

    assert.notEqual(code, 0);
    assert.match(stderr, /DISCORD_TOKEN/);
    assert.match(stderr, /DISCORD_GUILD_ID/);
  });

  it("exits non-zero when no scope is given", async () => {
    const { code, stderr } = await runCli(["--dry-run"]);

    assert.notEqual(code, 0);
    assert.match(stderr, /--global|--guild/);
  });
});

describe("command registration scripts contract", () => {
  it("scopes non-production to a guild and production globally", async () => {
    const manifest = JSON.parse(await readFile(packagePath, "utf8"));

    assert.match(manifest.scripts["register:non-prod"], /register-commands\.js\s+--guild\b/);
    assert.doesNotMatch(manifest.scripts["register:non-prod"], /--global\b/);
    assert.match(manifest.scripts["register:production"], /register-commands\.js\s+--global\b/);
    assert.doesNotMatch(manifest.scripts["register:production"], /--guild\b/);
    assert.match(manifest.scripts["register:dry-run"], /--dry-run\b/);
  });
});
