import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

/**
 * The GitHub setup CLI, spawned as a real process.
 *
 * `test/scripts/setup-github.test.js` covers every decision the run makes,
 * because they all live in `scripts/lib/setup-github.js`. What a unit test
 * cannot show is the wrapper: that `--dry-run` really runs no `gh` at all,
 * that a refusal really exits non-zero, and that no path prints a credential.
 * Those are properties of a process, so they are asserted against one, with a
 * `gh` of our own first on `PATH` that records every invocation and would let
 * a real call be seen.
 *
 * This file ships downstream. The script it exercises is permanent — unlike
 * `npm run setup`, re-running it is how a project re-checks its GitHub
 * settings — so the contract it holds is a project's contract too.
 */

const execFileAsync = promisify(execFile);

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const packagePath = new URL("../../package.json", import.meta.url);
const cliPath = fileURLToPath(new URL("../../scripts/setup-github.js", import.meta.url));

/** The repository every case names. Owned by nobody; contacted by nothing. */
const REPOSITORY = "acme/acme-bot";

/**
 * A `gh` that answers the calls this script makes, out of a fixture.
 *
 * Enough of the API surface to let the apply-then-read-back path run end to
 * end offline. `STUB_RULESET` is the ruleset the fake GitHub claims to have
 * saved, which is how a case describes a rule that a plan tier dropped.
 */
const apiStub = `
const args = process.argv.slice(2);
const joined = args.join(" ");
const say = (value) => {
  process.stdout.write(JSON.stringify(value));
  process.exit(0);
};

if (args[0] === "--version") {
  process.stdout.write("gh version 2.0.0\\n");
  process.exit(0);
}

if (joined === "auth status") process.exit(0);

if (joined === "api user --jq .id") {
  process.stdout.write("12345\\n");
  process.exit(0);
}

if (args[0] === "secret") say([]);
if (args[0] === "variable") process.exit(0);
// Every write: the plan's own calls, which this fake accepts unconditionally.
if (args.includes("--method")) say({});

const path = args[1];

if (path.endsWith("/rulesets")) say([{ id: 42, name: "protected-branches" }]);
if (path.endsWith("/rulesets/42")) say(JSON.parse(process.env.STUB_RULESET));

if (path.endsWith("/deployment-branch-policies")) {
  const environment = path.split("/").at(-2);

  say({ branch_policies: [{ id: 1, name: environment === "production" ? "main" : "develop" }] });
}

if (/\\/environments\\/[^/]+$/.test(path)) {
  say({
    deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
    protection_rules: [{ type: "required_reviewers" }],
  });
}

// DEPLOY_ENABLED, and anything unforeseen: not found.
process.exit(1);
`;

/**
 * Run the CLI with a `gh` of our own first on `PATH`.
 *
 * The default stub records every invocation and exits non-zero, so anything
 * that reaches it both shows up in the log and fails the run rather than being
 * quietly tolerated. A case that needs the apply path passes `apiStub`.
 *
 * @param {string[]} args Arguments to pass to the CLI.
 * @param {object} [options]
 * @param {string} [options.stub] A Node program to install as `gh`.
 * @param {Record<string, string>} [options.env] Extra environment for the run.
 * @returns {Promise<{ code: number, stdout: string, stderr: string, ghCalls: string[] }>}
 */
async function runCli(args, { stub, env = {} } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "setup-github-"));
  const log = join(directory, "gh-calls.log");
  const program = join(directory, "gh.mjs");
  const shim = join(directory, "gh");

  try {
    await writeFile(log, "");
    await writeFile(program, stub ?? "process.exit(1);\n");
    await writeFile(
      shim,
      `#!/bin/sh\necho "$@" >> ${JSON.stringify(log)}\n`
      + `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(program)} "$@"\n`,
    );
    await chmod(shim, 0o755);

    const options = {
      cwd: repositoryRoot,
      env: { PATH: `${directory}:${process.env.PATH}`, HOME: process.env.HOME, ...env },
    };
    let result;

    try {
      const { stdout, stderr } = await execFileAsync(process.execPath, [cliPath, ...args], options);

      result = { code: 0, stdout, stderr };
    } catch (error) {
      result = { code: error.code, stdout: error.stdout, stderr: error.stderr };
    }

    const calls = (await readFile(log, "utf8")).split("\n").filter(Boolean);

    return { ...result, ghCalls: calls };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * The ruleset the fake GitHub will claim to have saved.
 *
 * @param {string} [dropped] A rule type the fake silently refuses to store.
 * @returns {Promise<string>}
 */
async function savedRuleset(dropped) {
  const { buildRulesetPayload } = await import("../../scripts/lib/setup-github.js");
  const ruleset = buildRulesetPayload();

  return JSON.stringify({
    id: 42,
    ...ruleset,
    rules: ruleset.rules.filter((rule) => rule.type !== dropped),
  });
}

describe("setup:github CLI contract", () => {
  it("prints every gh command it would run, and runs none of them", async () => {
    const { code, stdout, ghCalls } = await runCli(["--repo", REPOSITORY, "--dry-run"]);

    assert.equal(code, 0, stdout);
    assert.deepEqual(ghCalls, [], "a dry run must not invoke gh at all, not even for preflight");
    assert.match(stdout, /gh api --method PUT repos\/acme\/acme-bot\/environments\/non-prod/);
    assert.match(stdout, /gh api --method PUT repos\/acme\/acme-bot\/environments\/production/);
    assert.match(
      stdout,
      /gh api --method POST repos\/acme\/acme-bot\/environments\/production\/deployment-branch-policies/,
    );
    assert.match(stdout, /gh api --method POST repos\/acme\/acme-bot\/rulesets/);
    assert.match(stdout, /gh api repos\/acme\/acme-bot\/rulesets\b/);
    assert.match(stdout, /gh secret list --repo acme\/acme-bot --env non-prod --json name/);
    assert.match(stdout, /nothing was changed/i);
  });

  it("leaves the deployment opt-in alone unless it is asked for", async () => {
    const without = await runCli(["--repo", REPOSITORY, "--dry-run"]);
    const asked = await runCli(["--repo", REPOSITORY, "--dry-run", "--enable-deploy"]);

    assert.doesNotMatch(without.stdout, /gh variable set DEPLOY_ENABLED/);
    assert.match(asked.stdout, /gh variable set DEPLOY_ENABLED --repo acme\/acme-bot --body true/);
  });

  it("asks for no rule GitHub's Free and Pro plans reject", async () => {
    const { stdout } = await runCli(["--repo", REPOSITORY, "--dry-run"]);

    for (const rejected of [
      "branch_name_pattern",
      "tag_name_pattern",
      "commit_message_pattern",
      "commit_author_email_pattern",
      "committer_email_pattern",
    ]) {
      assert.doesNotMatch(stdout, new RegExp(rejected));
    }
  });

  it("asks gh for secret names, never values", async () => {
    const { stdout } = await runCli(["--repo", REPOSITORY, "--dry-run"]);

    assert.doesNotMatch(stdout, /secret\s+set/);
    assert.doesNotMatch(stdout, /--body\s+\$/);
    assert.match(stdout, /--json name/);
  });

  it("explains itself on request without touching gh", async () => {
    const { code, stdout, ghCalls } = await runCli(["--help"]);

    assert.equal(code, 0);
    assert.deepEqual(ghCalls, []);
    assert.match(stdout, /--dry-run/);
    assert.match(stdout, /--enable-deploy/);
  });

  it("exits non-zero on an argument it does not recognize", async () => {
    const { code, stderr } = await runCli(["--rep", REPOSITORY]);

    assert.notEqual(code, 0);
    assert.match(stderr, /--rep/);
  });

  it("exits non-zero on something that is not an owner and repository", async () => {
    const { code, stderr } = await runCli(["--repo", "acme-bot", "--dry-run"]);

    assert.notEqual(code, 0);
    assert.match(stderr, /--repo/);
  });

  it("fails with an actionable message when gh cannot be run", async () => {
    // The default stub exits non-zero for everything, which is what an
    // unauthenticated gh looks like to this script.
    const { code, stderr, ghCalls } = await runCli(["--repo", REPOSITORY, "--yes"]);

    assert.notEqual(code, 0);
    assert.match(stderr, /gh auth login/);
    assert.doesNotMatch(stderr, /at Object\.|at async/, "a refusal must not print a stack trace");
    assert.ok(ghCalls.length > 0, "a real run does run its preflight");
  });
});

describe("setup:github readback contract", () => {
  it("reports success only when GitHub saved everything that was asked for", async () => {
    const { code, stdout } = await runCli(["--repo", REPOSITORY, "--yes"], {
      stub: apiStub,
      env: { STUB_RULESET: await savedRuleset() },
    });

    assert.equal(code, 0, stdout);
    assert.match(stdout, /GitHub saved everything that was requested/);
    // An existing ruleset is updated, not duplicated.
    assert.match(stdout, /applied: update the protected-branches ruleset \(#42\)/);
  });

  it("names the dropped rule and exits non-zero when GitHub kept less", async () => {
    // This is the failure the whole readback exists for: GitHub accepts the
    // request and stores fewer rules than it declares, saying nothing.
    const { code, stdout } = await runCli(["--repo", REPOSITORY, "--yes"], {
      stub: apiStub,
      env: { STUB_RULESET: await savedRuleset("required_status_checks") },
    });

    assert.notEqual(code, 0, "a divergence must fail the run");
    assert.match(stdout, /did NOT save everything/);
    assert.match(stdout, /required_status_checks was requested but did not save/);
  });

  it("reports the secret names that are missing without ever holding a value", async () => {
    const { stdout } = await runCli(["--repo", REPOSITORY, "--yes"], {
      stub: apiStub,
      env: { STUB_RULESET: await savedRuleset() },
    });

    assert.match(stdout, /missing — DISCORD_TOKEN, DISCORD_APPLICATION_ID, DISCORD_GUILD_ID/);
    assert.match(stdout, /DISCORD_PUBLIC_KEY is absent from CI on purpose/);
    assert.match(stdout, /never sets a secret value/);
    assert.match(stdout, /DEPLOY_ENABLED is not set/);
  });

  it("refuses to apply anything unattended without --yes", async () => {
    const { code, stderr, ghCalls } = await runCli(["--repo", REPOSITORY], { stub: apiStub });

    assert.notEqual(code, 0);
    assert.match(stderr, /--yes/);
    assert.ok(
      ghCalls.every((call) => call.includes("--method") === false),
      "a run that was never confirmed must not write anything",
    );
  });
});

describe("setup:github script contract", () => {
  it("is wired to one npm script", async () => {
    const manifest = JSON.parse(await readFile(packagePath, "utf8"));

    assert.match(manifest.scripts["setup:github"], /^node scripts\/setup-github\.js$/);
  });

  it("requires the status check the CI workflow actually defines", async () => {
    const { REQUIRED_STATUS_CHECK } = await import("../../scripts/lib/setup-github.js");
    const workflow = await readFile(join(repositoryRoot, ".github/workflows/ci.yml"), "utf8");

    // The required status check is a job name, matched by string on GitHub's
    // side. Renaming the job without renaming this is how branch protection
    // starts requiring a check that can never report.
    assert.match(workflow, new RegExp(`^\\s+name: ${REQUIRED_STATUS_CHECK}$`, "m"));
  });

  it("restricts each environment to the branch its deploy workflow expects", async () => {
    const { GITHUB_ENVIRONMENTS } = await import("../../scripts/lib/setup-github.js");
    const workflow = await readFile(join(repositoryRoot, ".github/workflows/deploy.yml"), "utf8");

    for (const { name, branch } of GITHUB_ENVIRONMENTS) {
      assert.match(workflow, new RegExp(`'${name}'`), `deploy.yml never deploys to ${name}`);
      assert.match(workflow, new RegExp(branch), `deploy.yml never mentions ${branch}`);
    }
  });
});
