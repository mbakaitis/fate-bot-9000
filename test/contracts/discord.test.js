import { readFile, stat } from "node:fs/promises";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { credentialShapes } from "../helpers/credential-shapes.js";

const execFileAsync = promisify(execFile);

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const wranglerConfigPath = new URL("../../wrangler.jsonc", import.meta.url);
const gitignorePath = new URL("../../.gitignore", import.meta.url);
const deployWorkflowPath = new URL("../../.github/workflows/deploy.yml", import.meta.url);

/**
 * The Discord credentials the Worker's environments must declare.
 *
 * These are names, never values: each environment is backed by its own Discord
 * application, so the same three names resolve to different secrets in
 * non-production and production.
 */
const requiredDiscordSecrets = ["DISCORD_PUBLIC_KEY", "DISCORD_APPLICATION_ID", "DISCORD_TOKEN"];

/** File extensions whose bytes are not text and cannot hold a pasted secret. */
const binaryExtensions = [".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp", ".woff", ".woff2"];

/**
 * Parse `wrangler.jsonc`.
 *
 * The file carries no comments today, so `JSON.parse` is enough and keeps this
 * contract test dependency-free — matching `environment-isolation.test.js`.
 *
 * @returns {Promise<Record<string, any>>}
 */
async function readWranglerConfig() {
  return JSON.parse(await readFile(wranglerConfigPath, "utf8"));
}

/**
 * Every configuration level that must declare the Discord secrets: the top
 * level and each named environment.
 *
 * @param {Record<string, any>} config
 * @returns {Array<{ label: string, level: Record<string, any> }>}
 */
function secretDeclarationLevels(config) {
  return [
    { label: "top level", level: config },
    ...Object.entries(config.env ?? {}).map(([name, level]) => ({
      label: `env.${name}`,
      level,
    })),
  ];
}

/**
 * Collect every string in a parsed configuration, with the path that reached it.
 *
 * @param {unknown} value
 * @param {string} [path]
 * @returns {Array<{ path: string, value: string }>}
 */
function collectStrings(value, path = "") {
  if (typeof value === "string") {
    return [{ path, value }];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => collectStrings(entry, `${path}[${index}]`));
  }

  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, entry]) =>
      collectStrings(entry, path ? `${path}.${key}` : key),
    );
  }

  return [];
}

/**
 * Split the deployment workflow's job names out of its `jobs:` mapping.
 *
 * The registration steps inherit the `DEPLOY_ENABLED` guard by living in the
 * guarded job, so "which jobs exist" is part of what that guarantee rests on.
 *
 * @param {string} workflow Raw `deploy.yml`.
 * @returns {string[]}
 */
function jobNames(workflow) {
  const jobsBlock = workflow.split(/\njobs:\n/)[1];

  assert.ok(jobsBlock, "deploy.yml must declare a jobs: mapping");

  return jobsBlock
    .split("\n")
    .filter((line) => /^ {2}[A-Za-z][\w-]*:$/.test(line))
    .map((line) => line.trim().replace(/:$/, ""));
}

/**
 * Split the deploy job's `steps:` list into blocks, in file order.
 *
 * Parsed by indentation rather than with a YAML library so the contract tests
 * stay dependency-free, matching `workflow.test.js`. Each step's continuation
 * lines are trimmed and joined, which is enough to assert what a step runs and
 * which secrets it reads; only the order of the blocks is load-bearing.
 *
 * @param {string} workflow Raw `deploy.yml`.
 * @returns {string[]} One entry per step, in the order the workflow runs them.
 */
function deployJobSteps(workflow) {
  const stepsBlock = workflow.split(/\n {4}steps:\n/)[1];

  assert.ok(stepsBlock, "deploy.yml must declare a steps: list for its deploy job");

  /** @type {string[][]} */
  const steps = [];

  for (const line of stepsBlock.split("\n")) {
    if (/^ {6}- /.test(line)) {
      steps.push([line.replace(/^ {6}- /, "")]);
    } else if (line.trim() !== "") {
      assert.ok(steps.length > 0, `unexpected line before the first step: ${line}`);
      steps[steps.length - 1].push(line.trim());
    }
  }

  return steps.map((lines) => lines.join("\n"));
}

/**
 * List the repository's tracked text files.
 *
 * `git ls-files` rather than a directory walk: the scan is about what is
 * committed, so an ignored local `.dev.vars` is correctly invisible to it.
 *
 * A path the index still carries but the working tree no longer has is
 * skipped. That is what a repository looks like between a deletion and its
 * commit — running `npm test` straight after `npm run setup` is the case that
 * matters — and a file that is not there cannot be leaking a credential.
 *
 * @returns {Promise<string[]>}
 */
async function trackedTextFiles() {
  const { stdout } = await execFileAsync("git", ["ls-files", "-z"], { cwd: repositoryRoot });
  const tracked = stdout
    .split("\0")
    .filter(Boolean)
    .filter((file) => !binaryExtensions.some((extension) => file.endsWith(extension)));
  const present = await Promise.all(tracked.map(async (file) => {
    try {
      await stat(join(repositoryRoot, file));

      return file;
    } catch {
      return null;
    }
  }));

  return present.filter((file) => file !== null);
}

describe("Discord secret declaration contract", () => {
  it("declares the required Discord secret names at every configuration level", async () => {
    const config = await readWranglerConfig();

    for (const { label, level } of secretDeclarationLevels(config)) {
      const declared = level.secrets?.required;

      assert.ok(
        Array.isArray(declared),
        `wrangler.jsonc ${label} must declare secrets.required`,
      );

      for (const name of requiredDiscordSecrets) {
        assert.ok(
          declared.includes(name),
          `wrangler.jsonc ${label} must declare ${name} in secrets.required`,
        );
      }
    }
  });

  it("covers both a non-production and a production environment", async () => {
    const config = await readWranglerConfig();
    const environments = Object.keys(config.env ?? {});

    // Both must exist; the set is deliberately not pinned, because a project
    // built from this template may add a third environment. That this template
    // itself ships exactly two is asserted in
    // `discord.template-only.test.js`.
    for (const name of ["non-prod", "production"]) {
      assert.ok(
        environments.includes(name),
        `wrangler.jsonc must declare an env.${name} environment, got ${environments.join(", ")}`,
      );
    }
  });

  it("declares Discord secret names without any Discord value", async () => {
    const config = await readWranglerConfig();
    const declaredPaths = new Set([
      "secrets.required",
      ...Object.keys(config.env ?? {}).map((name) => `env.${name}.secrets.required`),
    ]);

    for (const { path, value } of collectStrings(config)) {
      if (!value.includes("DISCORD")) {
        continue;
      }

      const container = path.replace(/\[\d+\]$/, "");
      assert.ok(
        declaredPaths.has(container),
        `wrangler.jsonc mentions ${value} at ${path}; Discord credentials belong in secrets, `
          + "so only secrets.required may name them",
      );
    }

    const configText = await readFile(wranglerConfigPath, "utf8");
    for (const { name, pattern } of credentialShapes) {
      assert.doesNotMatch(configText, pattern, `wrangler.jsonc contains a ${name}-shaped literal`);
    }
  });
});

describe("committed secret scan contract", () => {
  it("finds no credential-shaped literal in any tracked file", async () => {
    const files = await trackedTextFiles();
    const findings = [];

    for (const file of files) {
      const contents = await readFile(join(repositoryRoot, file), "utf8");

      for (const { name, pattern } of credentialShapes) {
        const match = pattern.exec(contents);

        if (match) {
          const line = contents.slice(0, match.index).split("\n").length;
          findings.push(`${file}:${line} looks like a ${name}`);
        }
      }
    }

    assert.deepEqual(findings, [], findings.join("\n"));
  });

  it("scans a meaningful number of tracked files", async () => {
    const files = await trackedTextFiles();

    // A scan that silently matched nothing would pass the assertion above while
    // guarding nothing at all.
    assert.ok(files.length > 20, `expected the scan to cover the repository, got ${files.length}`);
  });
});

describe("local development secrets contract", () => {
  it("ignores local secret files while tracking the example", async () => {
    const gitignore = await readFile(gitignorePath, "utf8");

    assert.match(gitignore, /^\.dev\.vars$/m);
    assert.match(gitignore, /^\.dev\.vars\.\*$/m);
    assert.match(gitignore, /^!\.dev\.vars\.example$/m);
    assert.match(gitignore, /^\.env$/m);
    assert.match(gitignore, /^\.env\.\*$/m);
  });

  it("ignores .dev.vars and .env in practice, and not the example", async () => {
    /**
     * Ask Git itself rather than re-implementing its pattern precedence: the
     * negation only works because it follows the wildcard, and only Git can
     * confirm that.
     *
     * @param {string} path
     * @returns {Promise<boolean>}
     */
    const isIgnored = async (path) => {
      try {
        await execFileAsync("git", ["check-ignore", "-q", path], { cwd: repositoryRoot });

        return true;
      } catch (error) {
        assert.equal(error.code, 1, `git check-ignore failed for ${path}: ${error.stderr}`);

        return false;
      }
    };

    assert.equal(await isIgnored(".dev.vars"), true);
    assert.equal(await isIgnored(".dev.vars.non-prod"), true);
    assert.equal(await isIgnored(".env"), true);
    assert.equal(await isIgnored(".env.production"), true);
    // `git check-ignore` consults the patterns, not the filesystem, so this
    // still holds after a project deletes `.dev.vars.example`.
    assert.equal(await isIgnored(".dev.vars.example"), false);
  });
});

describe("deploy-time registration contract", () => {
  /** The only secrets a registration step may read, unqualified by environment. */
  const registrationSecrets = new Set([
    "DISCORD_TOKEN",
    "DISCORD_APPLICATION_ID",
    "DISCORD_GUILD_ID",
  ]);

  /**
   * The deploy job's steps, and the indexes of the ones that register commands.
   *
   * @returns {Promise<{ steps: string[], deployIndex: number, registrationIndexes: number[] }>}
   */
  const readDeploySteps = async () => {
    const steps = deployJobSteps(await readFile(deployWorkflowPath, "utf8"));

    return {
      steps,
      deployIndex: steps.findIndex((step) => step.includes("cloudflare/wrangler-action@v3")),
      registrationIndexes: steps
        .map((step, index) => (step.includes("npm run register:") ? index : -1))
        .filter((index) => index >= 0),
    };
  };

  it("registers commands after the deploy that makes the endpoint live", async () => {
    const { steps, deployIndex, registrationIndexes } = await readDeploySteps();

    assert.ok(deployIndex >= 0, "deploy.yml must deploy with cloudflare/wrangler-action@v3");
    assert.ok(registrationIndexes.length > 0, "deploy.yml must register the command definitions");

    for (const index of registrationIndexes) {
      // The index, not merely the presence: registering before the deploy would
      // advertise commands the live Worker does not yet handle.
      assert.ok(
        index > deployIndex,
        `step ${index} registers commands at or before the deploy step ${deployIndex}:\n`
          + steps[index],
      );
    }
  });

  it("keeps registration inside the DEPLOY_ENABLED-guarded job", async () => {
    const workflow = await readFile(deployWorkflowPath, "utf8");

    // One job, so there is no ungated job a registration step could drift into.
    assert.deepEqual(jobNames(workflow), ["deploy"]);
    assert.match(workflow, /if:\s*\$\{\{\s*vars\.DEPLOY_ENABLED\s*==\s*'true'\s*\}\}/);

    const guardIndex = workflow.indexOf("vars.DEPLOY_ENABLED");
    const stepsIndex = workflow.indexOf("\n    steps:\n");

    assert.ok(
      guardIndex >= 0 && stepsIndex > guardIndex,
      "the DEPLOY_ENABLED guard must sit on the job, above its steps, so every step inherits it",
    );
  });

  it("registers globally from main and to a guild everywhere else", async () => {
    const { steps, registrationIndexes } = await readDeploySteps();

    // Which branch runs which script is asserted here; that `register:production`
    // means `--global` and `register:non-prod` means `--guild` is asserted once,
    // in `registration.test.js`, so the scope mapping has a single home.
    const registrationSteps = registrationIndexes.map((index) => steps[index]);
    const production = registrationSteps.filter((step) =>
      step.includes("npm run register:production"));
    const nonProduction = registrationSteps.filter((step) =>
      step.includes("npm run register:non-prod"));

    assert.equal(production.length, 1, "exactly one step may register production commands");
    assert.equal(nonProduction.length, 1, "exactly one step may register non-production commands");
    assert.match(production[0], /if:\s*\$\{\{\s*github\.ref_name == 'main'\s*\}\}/);
    assert.match(nonProduction[0], /if:\s*\$\{\{\s*github\.ref_name != 'main'\s*\}\}/);
  });

  it("gives each registration step only its own environment's secrets", async () => {
    const workflow = await readFile(deployWorkflowPath, "utf8");
    const { steps, registrationIndexes } = await readDeploySteps();

    // Isolation comes from the GitHub Environment the job selects: the same
    // secret names resolve to the production or the non-production Discord
    // application, and nothing names the other environment's values.
    assert.match(
      workflow,
      /environment:\s*\$\{\{\s*github\.ref_name == 'main' && 'production' \|\| 'non-prod'\s*\}\}/,
    );

    for (const index of registrationIndexes) {
      const step = steps[index];

      for (const [, name] of step.matchAll(/secrets\.([A-Z0-9_]+)/g)) {
        assert.ok(
          registrationSecrets.has(name),
          `registration step ${index} reads secrets.${name}; a registration step may read only `
            + `${[...registrationSecrets].join(", ")}, which the environment resolves`,
        );
      }

      for (const [, variable, secret] of step.matchAll(
        /^([A-Z0-9_]+):\s*\$\{\{\s*secrets\.([A-Z0-9_]+)\s*\}\}$/gm,
      )) {
        assert.equal(
          variable,
          secret,
          `registration step ${index} feeds ${variable} from secrets.${secret}`,
        );
      }
    }

    /**
     * The one registration step that runs the given script.
     *
     * @param {string} script
     * @returns {string}
     */
    const registrationStep = (script) => {
      const matches = registrationIndexes
        .map((index) => steps[index])
        .filter((step) => step.includes(script));

      assert.equal(matches.length, 1, `expected exactly one step running ${script}`);

      return matches[0];
    };

    const production = registrationStep("npm run register:production");
    const nonProduction = registrationStep("npm run register:non-prod");

    // A global registration has no guild to scope to, so production is never
    // handed one — an unused guild id is one accident away from being used.
    assert.doesNotMatch(production, /GUILD/);
    assert.match(nonProduction, /DISCORD_GUILD_ID:\s*\$\{\{\s*secrets\.DISCORD_GUILD_ID\s*\}\}/);

    for (const step of [production, nonProduction]) {
      for (const name of ["DISCORD_TOKEN", "DISCORD_APPLICATION_ID"]) {
        assert.match(step, new RegExp(`${name}:\\s*\\$\\{\\{\\s*secrets\\.${name}\\s*\\}\\}`));
      }
    }
  });
});
