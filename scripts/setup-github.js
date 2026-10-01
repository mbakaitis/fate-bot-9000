#!/usr/bin/env node
/**
 * Apply this template's GitHub-side structure, then check what GitHub kept.
 *
 * ```sh
 * npm run setup:github                        # apply, leaving deployment off
 * npm run setup:github -- --dry-run           # print every gh call, run none
 * npm run setup:github -- --enable-deploy     # also set DEPLOY_ENABLED=true
 * npm run setup:github -- --repo acme/acme-bot --yes
 * ```
 *
 * It creates the `non-prod` and `production` environments with their branch
 * restrictions, optionally sets the `DEPLOY_ENABLED` opt-in, and creates or
 * updates the branch ruleset described in `docs/using-this-template.md`,
 * "Configure branch protection".
 *
 * Unlike `npm run setup`, this script is permanent. It is idempotent, and
 * re-running it is the supported way to re-check GitHub settings after a plan
 * change, an organization policy change, or a visibility change.
 *
 * The readback is the point. GitHub accepts a ruleset and then stores whatever
 * the plan tier, organization policy, and repository visibility allow, without
 * saying what it dropped — so this reads every resource back, names each
 * divergence, and exits non-zero when one is found.
 *
 * It never sets a secret value. `gh secret list` returns names, so the secret
 * report says which names exist and which are missing, and nothing here ever
 * holds a credential.
 *
 * Everything worth testing lives in `scripts/lib/setup-github.js`; this file
 * owns the subprocesses, the terminal, and the exit code.
 */
import { createInterface } from "node:readline/promises";
import { spawn } from "node:child_process";
import {
  DEPLOY_VARIABLE,
  GITHUB_ENVIRONMENTS,
  GITHUB_USAGE,
  RULESET_NAME,
  buildGithubPlan,
  buildRulesetPayload,
  buildVerificationCommands,
  describeDeployVariable,
  describeGithubPlan,
  describePreflightFailure,
  diffEnvironment,
  diffRuleset,
  parseGithubArguments,
  parseRepositorySlug,
  rulesetShowCommand,
  summarizeSecrets,
} from "./lib/setup-github.js";

/**
 * Run a command, capturing its output.
 *
 * `spawn` rather than `execFile` because every write here sends its body on
 * stdin: the payloads are nested, and `--input -` is the one form that
 * survives nesting.
 *
 * @param {string} file
 * @param {string[]} args
 * @param {string} [input] Written to stdin and then closed.
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
const run = (file, args, input) => new Promise((resolve) => {
  const child = spawn(file, args, { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", () => resolve({ code: 127, stdout, stderr }));
  child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  child.stdin.on("error", () => {});
  child.stdin.end(input ?? "");
});

/**
 * Run `gh`, or throw with whatever it complained about.
 *
 * @param {string[]} args
 * @param {object} [input] Serialized to stdin as JSON.
 * @returns {Promise<string>} Trimmed stdout.
 * @throws {Error} Carrying `gh`'s own stderr, which is the actionable part.
 */
const gh = async (args, input) => {
  const { code, stdout, stderr } = await run(
    "gh",
    args,
    input === undefined ? undefined : JSON.stringify(input),
  );

  if (code !== 0) {
    throw new Error(`gh ${args.join(" ")} failed:\n${stderr.trim() || stdout.trim()}`);
  }

  return stdout.trim();
};

/**
 * Run a `gh api` read, treating "not there" as a value rather than an error.
 *
 * A missing environment, ruleset, or variable is the normal state of a fresh
 * repository and of every readback taken before the thing was created.
 *
 * @param {string[]} args
 * @returns {Promise<any | null>} The parsed body, or `null` on any failure.
 */
const readJson = async (args) => {
  const { code, stdout } = await run("gh", args);

  if (code !== 0) {
    return null;
  }

  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
};

/**
 * Ask one question on the terminal.
 *
 * @param {string} question
 * @returns {Promise<string>}
 */
const ask = async (question) => {
  const readline = createInterface({ input: process.stdin, output: process.stdout });

  try {
    return await readline.question(question);
  } finally {
    readline.close();
  }
};

/** Whether an answer means yes. Anything else, including silence, means no. */
const affirmative = (answer) => /^y(es)?$/i.test(answer.trim());

/**
 * Work out which repository this run targets.
 *
 * `--repo` wins; otherwise the `origin` remote, which is right in every case
 * where the script is run from the checkout it is configuring. Nothing is
 * guessed from the directory name.
 *
 * @param {string | undefined} repo
 * @returns {Promise<{ owner: string, repository: string }>}
 * @throws {Error} When neither source names a repository.
 */
const resolveRepository = async (repo) => {
  if (repo !== undefined) {
    return parseRepositorySlug(repo);
  }

  const { code, stdout } = await run("git", ["remote", "get-url", "origin"]);

  if (code !== 0) {
    throw new Error(
      "No origin remote to read the repository from — pass --repo owner/name.",
    );
  }

  return parseRepositorySlug(stdout);
};

/**
 * The secret names set at one scope.
 *
 * @param {string[]} command
 * @returns {Promise<string[]>} Names only; `gh secret list` returns no values.
 */
const secretNames = async (command) => {
  const listed = await readJson(command);

  return Array.isArray(listed) ? listed.map((secret) => secret.name) : [];
};

/**
 * Print the plan and the readback calls, and change nothing.
 *
 * A dry run executes no `gh` at all, including the preflight: `gh auth status`
 * contacts GitHub, and "prints what it would do" has to mean it.
 *
 * @param {{ owner: string, repository: string }} slug
 * @param {ReturnType<typeof parseGithubArguments>} args
 * @returns {number}
 */
const dryRun = (slug, args) => {
  const plan = buildGithubPlan({
    slug,
    enableDeploy: args.enableDeploy,
    // Nothing has been read, so the plan describes a repository where none of
    // this exists yet. A real run reads first and may update instead.
    current: null,
  });

  console.log(`Repository:    ${slug.owner}/${slug.repository}`);
  console.log(`Deployment:    ${args.enableDeploy ? `${DEPLOY_VARIABLE}=true` : "left disabled"}`);
  console.log("");
  console.log("Would apply:");
  console.log(describeGithubPlan(plan));
  console.log("");
  console.log("Would then read back:");
  console.log(describeGithubPlan(buildVerificationCommands({ slug })));
  console.log("");
  console.log("Dry run: no gh command was run and nothing was changed.");

  return 0;
};

/**
 * Read enough of the current state to make the plan idempotent.
 *
 * @param {{ owner: string, repository: string }} slug
 * @returns {Promise<{ rulesetId: number | null, branchPolicies: Record<string, object[]> }>}
 */
const readCurrentState = async (slug) => {
  const verification = new Map(
    buildVerificationCommands({ slug }).map((command) => [command.key, command.command]),
  );
  const rulesets = await readJson(verification.get("rulesets")) ?? [];
  const existing = rulesets.find((ruleset) => ruleset.name === RULESET_NAME);
  const branchPolicies = {};

  for (const environment of GITHUB_ENVIRONMENTS) {
    const policies = await readJson(verification.get(`branch-policies:${environment.name}`));

    branchPolicies[environment.name] = policies?.branch_policies ?? [];
  }

  return { rulesetId: existing?.id ?? null, branchPolicies };
};

/**
 * Read back what GitHub kept, and say where it differs from what was asked.
 *
 * @param {{ owner: string, repository: string }} slug
 * @returns {Promise<string[]>} One line per divergence.
 */
const verify = async (slug) => {
  const verification = new Map(
    buildVerificationCommands({ slug }).map((command) => [command.key, command.command]),
  );
  const rulesets = await readJson(verification.get("rulesets")) ?? [];
  const listed = rulesets.find((ruleset) => ruleset.name === RULESET_NAME);
  const divergences = diffRuleset({
    requested: buildRulesetPayload(),
    readback: listed === undefined ? null : await readJson(rulesetShowCommand(slug, listed.id)),
  });

  for (const environment of GITHUB_ENVIRONMENTS) {
    const readback = await readJson(verification.get(`environment:${environment.name}`));
    const policies = await readJson(verification.get(`branch-policies:${environment.name}`));

    divergences.push(...diffEnvironment({
      ...environment,
      readback,
      branchPolicies: policies?.branch_policies ?? [],
    }));
  }

  return divergences;
};

/**
 * Print the secret names that exist, and the deployment opt-in's value.
 *
 * @param {{ owner: string, repository: string }} slug
 * @returns {Promise<void>}
 */
const report = async (slug) => {
  const verification = new Map(
    buildVerificationCommands({ slug }).map((command) => [command.key, command.command]),
  );
  const environmentSecrets = {};

  for (const environment of GITHUB_ENVIRONMENTS) {
    environmentSecrets[environment.name] = await secretNames(
      verification.get(`secrets:${environment.name}`),
    );
  }

  const { lines } = summarizeSecrets({
    repositorySecrets: await secretNames(verification.get("secrets")),
    environmentSecrets,
  });
  const variable = await readJson(verification.get("variable"));

  console.log("Secrets:");

  for (const line of lines) {
    console.log(line);
  }

  console.log("");
  console.log("Deployment:");
  console.log(describeDeployVariable(variable?.value ?? null));
};

/**
 * Preflight, plan, apply, verify, report.
 *
 * @returns {Promise<number>} The process exit code.
 * @throws {Error} With a message a reader can act on, for every refusal.
 */
const main = async () => {
  const args = parseGithubArguments(process.argv.slice(2));

  if (args.help) {
    console.log(GITHUB_USAGE);

    return 0;
  }

  const slug = await resolveRepository(args.repo);

  if (args.dryRun) {
    return dryRun(slug, args);
  }

  const failure = describePreflightFailure({
    ghInstalled: (await run("gh", ["--version"])).code === 0,
    authenticated: (await run("gh", ["auth", "status"])).code === 0,
  });

  if (failure !== null) {
    throw new Error(failure);
  }

  const interactive = process.stdin.isTTY === true && args.yes === false;
  // The deployment opt-in is the one step that makes pushes deploy, so it
  // needs a flag or a person — never a default.
  const enableDeploy = args.enableDeploy || (interactive
    && affirmative(await ask(`Set ${DEPLOY_VARIABLE}=true and enable deployment? [y/N] `)));
  const reviewer = args.reviewer === undefined
    ? await gh(["api", "user", "--jq", ".id"])
    : await gh(["api", `users/${args.reviewer}`, "--jq", ".id"]);
  const plan = buildGithubPlan({
    slug,
    enableDeploy,
    reviewerId: Number(reviewer),
    current: await readCurrentState(slug),
  });

  console.log(`Repository:    ${slug.owner}/${slug.repository}`);
  console.log(`Reviewer:      ${args.reviewer ?? "the authenticated user"} (#${reviewer})`);
  console.log(`Deployment:    ${enableDeploy ? `${DEPLOY_VARIABLE}=true` : "left disabled"}`);
  console.log("");
  console.log(describeGithubPlan(plan));
  console.log("");

  if (args.yes === false) {
    if (interactive === false) {
      throw new Error(
        "Refusing to apply the plan above without confirmation and without a terminal to ask "
        + "for it: re-run with --yes, or with --dry-run to see the plan only.",
      );
    }

    if (affirmative(await ask(`Apply this to ${slug.owner}/${slug.repository}? [y/N] `)) === false) {
      console.log("Nothing was changed.");

      return 1;
    }
  }

  for (const step of plan) {
    await gh(step.command, step.input);
    console.log(`  applied: ${step.label}`);
  }

  console.log("");

  const divergences = await verify(slug);

  if (divergences.length === 0) {
    console.log("Readback: GitHub saved everything that was requested.");
  } else {
    console.log("Readback: GitHub did NOT save everything that was requested.");

    for (const divergence of divergences) {
      console.log(`  - ${divergence}`);
    }
  }

  console.log("");
  await report(slug);

  return divergences.length === 0 ? 0 : 1;
};

try {
  process.exitCode = await main();
} catch (error) {
  // The message only. A stack trace adds nothing a reader can act on, and
  // printing the error object risks printing whatever it was carrying.
  console.error(error.message);
  process.exitCode = 1;
}
