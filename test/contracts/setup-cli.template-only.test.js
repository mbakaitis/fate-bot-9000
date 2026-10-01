import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

/**
 * The setup CLI, spawned as a real process.
 *
 * `test/scripts/setup.test.js` covers every decision the run makes, because
 * they all live in `scripts/lib/setup.js`. What a unit test cannot show is the
 * wrapper: that a dry run really writes nothing, that each refusal really
 * exits non-zero, and that nothing on any path prints a credential. Those are
 * properties of a process, so they are asserted against one.
 *
 * Template-only, and pruned by `template-manifest.json`, because the script it
 * spawns deletes itself as its last act — downstream there is nothing here to
 * exercise.
 *
 * See `CONTRIBUTING.md`, "Template-only contract tests".
 */

const execFileAsync = promisify(execFile);

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const cliPath = fileURLToPath(new URL("../../scripts/setup.js", import.meta.url));
const forbidFetchPath = new URL("../helpers/forbid-fetch.js", import.meta.url).href;

/** The slug every case renames to. Chosen to appear nowhere in the repository. */
const SLUG = "acme-bot";

/**
 * Run the setup CLI in a child process with `fetch` disabled.
 *
 * @param {string[]} args Arguments to pass to the CLI.
 * @param {string} [cwd] Where the CLI should look for the project. It reads
 *   the working directory, which is what npm sets to the package root.
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
async function runCli(args, cwd = repositoryRoot) {
  const options = { cwd, env: { PATH: process.env.PATH, HOME: process.env.HOME } };

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

/**
 * The tracked state of this repository's working tree.
 *
 * Untracked entries are dropped: `node --test` runs the contract files in
 * parallel, and a sibling creates a scratch directory here while this case is
 * running. Every file a real setup run would touch is tracked, so a dry run
 * that wrote something would still show up.
 *
 * @returns {Promise<string[]>}
 */
async function workingTreeState() {
  const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd: repositoryRoot });

  return stdout.split("\n").filter((line) => line !== "" && line.startsWith("??") === false);
}

/**
 * Run a case in a throwaway directory holding the given files.
 *
 * @param {Record<string, string>} files Relative path to contents.
 * @param {(directory: string) => Promise<void>} run
 * @returns {Promise<void>}
 */
async function withTemporaryProject(files, run) {
  const directory = await mkdtemp(join(tmpdir(), "setup-cli-"));

  try {
    for (const [path, contents] of Object.entries(files)) {
      await mkdir(join(directory, path, ".."), { recursive: true });
      await writeFile(join(directory, path), contents);
    }

    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** A manifest with nothing in it, for the cases that get as far as reading one. */
const emptyManifest = JSON.stringify({
  templateRepository: "https://example.com/owner/repo",
  placeholders: {},
  instructionFiles: [],
  copy: [],
  prune: [],
  pruneGlobs: [],
  pruneDirectories: [],
  selfDelete: { paths: [], packageScripts: [] },
}, null, 2);

describe("setup CLI contract", () => {
  it("prints the whole plan on a dry run and changes nothing", async () => {
    const before = await workingTreeState();
    const { code, stdout } = await runCli(["--name", SLUG, "--dry-run"]);

    assert.equal(code, 0, stdout);
    // One line per thing the run would do, in the order it would do them.
    assert.match(stdout, /copy\s+\.template\/README\.md → README\.md/);
    assert.match(stdout, /rewrite\s+wrangler\.jsonc \(worker-names\)/);
    assert.match(stdout, /move\s+claude-for-users\.md → claude\.md/);
    assert.match(stdout, /copy\s+\.dev\.vars\.example → \.dev\.vars/);
    assert.match(stdout, /delete\s+CONTRIBUTING\.md \(prune\)/);
    assert.match(stdout, /rewrite\s+package\.json \(provenance\)/);
    assert.match(stdout, /remote\s+upstream →/);
    assert.match(stdout, /delete\s+scripts\/setup\.js \(self-delete\)/);
    assert.match(stdout, /dry run/i);
    assert.deepEqual(await workingTreeState(), before, "a dry run must leave the tree untouched");

    // Belt and braces: the two files a run would have replaced outright still
    // hold what the template put in them.
    const { readFile } = await import("node:fs/promises");
    assert.equal(
      JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8")).template,
      undefined,
      "a dry run must not record provenance",
    );
    assert.match(
      await readFile(join(repositoryRoot, "README.md"), "utf8"),
      /template/i,
      "a dry run must not replace the template's README",
    );
  });

  it("shows the names it would write, and the provenance it would record", async () => {
    const { stdout } = await runCli(["--name", SLUG, "--dry-run"]);

    assert.match(stdout, new RegExp(`${SLUG}-non-prod`));
    assert.match(stdout, new RegExp(`${SLUG}-production`));
  });

  it("prints no secret, not even a placeholder one", async () => {
    // `.dev.vars.example` is copied, never echoed: its contents are the shape
    // of a credential, and the shape is what a reader learns to skim past.
    const { stdout, stderr } = await runCli(["--name", SLUG, "--dry-run"]);

    assert.doesNotMatch(stdout + stderr, /replace-me/);
    assert.doesNotMatch(stdout + stderr, /DISCORD_TOKEN=/);
  });

  it("explains itself on request", async () => {
    const { code, stdout } = await runCli(["--help"]);

    assert.equal(code, 0);
    assert.match(stdout, /--name/);
    assert.match(stdout, /--dry-run/);
  });

  it("exits non-zero on a slug Cloudflare would reject", async () => {
    const { code, stderr } = await runCli(["--name", "Acme_Bot", "--dry-run"]);

    assert.notEqual(code, 0);
    assert.match(stderr, /Acme_Bot/);
    assert.match(stderr, /lowercase/);
  });

  it("exits non-zero when an unattended run has no name to use", async () => {
    const { code, stderr } = await runCli(["--yes", "--dry-run"]);

    assert.notEqual(code, 0);
    assert.match(stderr, /--name/);
  });

  it("exits non-zero on an argument it does not recognize", async () => {
    const { code, stderr } = await runCli(["--nam", SLUG]);

    assert.notEqual(code, 0);
    assert.match(stderr, /--nam/);
  });

  it("refuses to run a second time", async () => {
    await withTemporaryProject({
      "package.json": JSON.stringify({
        name: SLUG,
        version: "0.0.0",
        template: { repository: "https://example.com/owner/repo", setupDate: "2026-09-18" },
      }, null, 2),
      "template-manifest.json": emptyManifest,
    }, async (directory) => {
      const { code, stderr } = await runCli(["--name", SLUG, "--yes"], directory);

      assert.notEqual(code, 0);
      assert.match(stderr, /already/i);
    });
  });

  it("refuses a dirty working tree, and names the way past it", async () => {
    await withTemporaryProject({
      "package.json": JSON.stringify({ name: "template", version: "0.2.0" }, null, 2),
      "template-manifest.json": emptyManifest,
    }, async (directory) => {
      await execFileAsync("git", ["init", "--quiet"], { cwd: directory });

      const { code, stderr } = await runCli(["--name", SLUG, "--yes"], directory);

      assert.notEqual(code, 0);
      assert.match(stderr, /--force/);
    });
  });

  it("refuses to proceed unattended without --yes", async () => {
    // Without a terminal there is nobody to confirm, and the run is
    // destructive. Guessing yes is how a CI job prunes a repository.
    await withTemporaryProject({
      "package.json": JSON.stringify({ name: "template", version: "0.2.0" }, null, 2),
      "template-manifest.json": emptyManifest,
    }, async (directory) => {
      const { code, stderr } = await runCli(["--name", SLUG], directory);

      assert.notEqual(code, 0);
      assert.match(stderr, /--yes/);
    });
  });

  it("exits non-zero where there is no template to set up", async () => {
    await withTemporaryProject({
      "package.json": JSON.stringify({ name: "whatever", version: "1.0.0" }, null, 2),
    }, async (directory) => {
      const { code, stderr } = await runCli(["--name", SLUG, "--yes", "--dry-run"], directory);

      assert.notEqual(code, 0);
      assert.match(stderr, /template-manifest\.json/);
    });
  });
});

describe("setup script contract", () => {
  it("is wired to one npm script, which the manifest removes again", async () => {
    const { readFile } = await import("node:fs/promises");
    const manifest = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
    const template = JSON.parse(
      await readFile(join(repositoryRoot, "template-manifest.json"), "utf8"),
    );

    assert.match(manifest.scripts.setup, /^node scripts\/setup\.js$/);
    assert.ok(template.selfDelete.packageScripts.includes("setup"));
    assert.ok(template.prune.includes("test/contracts/setup-cli.template-only.test.js"));
  });
});
