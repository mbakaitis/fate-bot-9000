/**
 * The logic half of `npm run setup:github`.
 *
 * Everything here is pure: arguments in, `gh` argument lists and comparison
 * results out. `scripts/setup-github.js` owns the subprocesses, the terminal,
 * and the exit code. The split is the same one `scripts/lib/registration.js`
 * uses, and it exists for the same reason — a script that reconfigures a
 * repository's protection rules is worth testing without a repository.
 *
 * Two rules shape the design:
 *
 * - **Requesting is not saving.** GitHub accepts a ruleset and then stores
 *   whatever the plan tier, organization policy, and repository visibility
 *   allow, silently dropping the rest. So every builder here has a matching
 *   comparison function, and the CLI is expected to read back what GitHub kept
 *   and diff it rather than trust its own `201`.
 * - **Names, never values.** The secret report is built from name lists,
 *   because `gh secret list` returns names and this script has no reason to
 *   hold a value. Nothing here takes a credential as an argument.
 *
 * @see https://docs.github.com/en/rest/repos/rules
 * @see https://docs.github.com/en/rest/deployments/environments
 */

/** How the command is invoked, quoted back in every argument error. */
export const GITHUB_USAGE = "usage: npm run setup:github -- [--repo <owner/name>] "
  + "[--reviewer <login>] [--enable-deploy] [--yes] [--dry-run]";

/** The repository variable that is the deployment opt-in. */
export const DEPLOY_VARIABLE = "DEPLOY_ENABLED";

/** The ruleset this script owns. Matched by name, so a re-run updates it. */
export const RULESET_NAME = "protected-branches";

/** The CI job every protected branch must see pass. Named in `ci.yml`. */
export const REQUIRED_STATUS_CHECK = "test";

/** The long-lived branches, in the order the ruleset lists them. */
export const PROTECTED_BRANCHES = ["main", "develop"];

/** What stands in for a reviewer id nothing has resolved yet, in a dry run. */
export const REVIEWER_PLACEHOLDER = "<the authenticated user>";

/**
 * The deployment environments, each pinned to the one branch that may deploy
 * to it. `production` also gets a human gate; `non-prod` deliberately does not,
 * because a gate nobody wants is a gate everybody clicks through.
 *
 * @type {ReadonlyArray<{ name: string, branch: string, requiredReviewers: boolean }>}
 */
export const GITHUB_ENVIRONMENTS = [
  { name: "non-prod", branch: "develop", requiredReviewers: false },
  { name: "production", branch: "main", requiredReviewers: true },
];

/**
 * The Discord secrets each environment needs, at environment scope.
 *
 * Environment scope, not repository scope: a repository-wide `DISCORD_TOKEN`
 * would be visible to both and would make the production bot reachable from a
 * `develop` deploy.
 *
 * @type {ReadonlyMap<string, string[]>}
 */
export const ENVIRONMENT_SECRETS = new Map([
  ["non-prod", ["DISCORD_TOKEN", "DISCORD_APPLICATION_ID", "DISCORD_GUILD_ID"]],
  ["production", ["DISCORD_TOKEN", "DISCORD_APPLICATION_ID"]],
]);

/** Secrets the deploy job needs that may sit at either scope. */
export const SHARED_SECRETS = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"];

/**
 * Secrets whose absence from CI is correct, called out so the report does not
 * read as a list of things to go and fix. Only the Worker verifies signatures,
 * and it reads its public key from a Cloudflare secret.
 */
export const CI_ABSENT_SECRETS = ["DISCORD_PUBLIC_KEY"];

/** Arguments that stand alone, mapped to the field each one sets. */
const GITHUB_FLAGS = new Map([
  ["--enable-deploy", "enableDeploy"],
  ["--yes", "yes"],
  ["-y", "yes"],
  ["--dry-run", "dryRun"],
  ["--help", "help"],
]);

/** Arguments that take the next argument as their value. */
const GITHUB_OPTIONS = new Map([
  ["--repo", "repo"],
  ["--reviewer", "reviewer"],
]);

/**
 * Parse the CLI's arguments.
 *
 * A typo stops the run rather than falling back to a default: the defaults
 * here decide which repository gets reconfigured and whether deployment is
 * switched on.
 *
 * @param {string[]} argv Arguments without the node binary or script path.
 * @returns {{
 *   repo: string | undefined,
 *   reviewer: string | undefined,
 *   enableDeploy: boolean,
 *   yes: boolean,
 *   dryRun: boolean,
 *   help: boolean,
 * }}
 * @throws {Error} On an unrecognized argument or an option with no value.
 */
export const parseGithubArguments = (argv) => {
  const parsed = {
    repo: undefined,
    reviewer: undefined,
    enableDeploy: false,
    yes: false,
    dryRun: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const flag = GITHUB_FLAGS.get(argument);

    if (flag !== undefined) {
      parsed[flag] = true;
      continue;
    }

    const option = GITHUB_OPTIONS.get(argument);

    if (option === undefined) {
      throw new Error(`Unrecognized argument ${argument} — ${GITHUB_USAGE}`);
    }

    const value = argv[index + 1];

    if (value === undefined || GITHUB_FLAGS.has(value) || GITHUB_OPTIONS.has(value)) {
      throw new Error(`${argument} needs a value — ${GITHUB_USAGE}`);
    }

    parsed[option] = value;
    index += 1;
  }

  return parsed;
};

/**
 * Why this run cannot start.
 *
 * @param {{ ghInstalled: boolean, authenticated: boolean }} state
 * @returns {string | null} A message a reader can act on, or `null` to proceed.
 */
export const describePreflightFailure = ({ ghInstalled, authenticated }) => {
  if (ghInstalled === false) {
    return "The GitHub CLI (gh) is not on PATH. Install it from https://cli.github.com and "
      + "run gh auth login, then re-run npm run setup:github.";
  }

  if (authenticated === false) {
    return "gh is installed but not signed in. Run gh auth login, then re-run "
      + "npm run setup:github.";
  }

  return null;
};

/**
 * Read an owner and repository out of whatever names one.
 *
 * Accepts `owner/name` and every remote URL form `git remote get-url` returns,
 * so the common case needs no `--repo`.
 *
 * @param {string} text
 * @returns {{ owner: string, repository: string }}
 * @throws {Error} When no owner can be read, which includes the case of a bare
 *   repository name — guessing the owner is how the wrong repository gets
 *   reconfigured.
 */
export const parseRepositorySlug = (text) => {
  const cleaned = String(text).trim().replace(/\/+$/, "").replace(/\.git$/, "");
  const match = /(?:^|[/:])([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/.exec(cleaned);

  if (match === null) {
    throw new Error(
      `Cannot read an owner and repository from "${text}" — pass --repo owner/name.`,
    );
  }

  return { owner: match[1], repository: match[2] };
};

/**
 * Build a `gh api` argument list.
 *
 * A body is always passed on stdin rather than as `-f` pairs: the payloads
 * here are nested, and `--input -` is the one form that survives nesting.
 *
 * @param {string} path The API path, without a leading slash.
 * @param {{ method?: string, input?: boolean }} [options]
 * @returns {string[]}
 */
export const ghApi = (path, { method = "GET", input = false } = {}) => [
  "api",
  ...(method === "GET" ? [] : ["--method", method]),
  path,
  ...(input ? ["--input", "-"] : []),
];

/**
 * The `gh api` call that reads one ruleset including its rules.
 *
 * The list endpoint omits `rules`, so the readback needs the id first — which
 * is also what makes a second run an update rather than a duplicate.
 *
 * @param {{ owner: string, repository: string }} slug
 * @param {number} id
 * @returns {string[]}
 */
export const rulesetShowCommand = ({ owner, repository }, id) =>
  ghApi(`repos/${owner}/${repository}/rulesets/${id}`);

/**
 * The environment configuration to request.
 *
 * `custom_branch_policies` rather than `protected_branches`: the protected
 * variant allows any protected branch, which is both of them, so it would let
 * `main` deploy to `non-prod`. The two booleans must be opposites.
 *
 * The branch itself is not part of this payload — GitHub takes the allowed
 * branches as separate deployment-branch-policy resources, which is why the
 * plan has a step per branch.
 *
 * @param {object} environment
 * @param {boolean} environment.requiredReviewers
 * @param {number | string} [environment.reviewerId] The reviewer's numeric id,
 *   or the placeholder when nothing has resolved one yet.
 * @returns {Record<string, unknown>}
 */
export const buildEnvironmentPayload = ({
  requiredReviewers,
  reviewerId = REVIEWER_PLACEHOLDER,
}) => ({
  wait_timer: 0,
  // False so the reviewer may approve their own deploy: a solo project with
  // self-review prevented on has an environment nobody can ever deploy to.
  prevent_self_review: false,
  // An explicit empty list clears reviewers; omitting the key would leave
  // whatever a previous run set, which is not idempotent.
  reviewers: requiredReviewers ? [{ type: "User", id: reviewerId }] : [],
  deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
});

/**
 * The branch ruleset to request.
 *
 * One ruleset covering both long-lived branches, with exactly the rules in
 * `docs/using-this-template.md`, "Configure branch protection". No
 * `branch_name_pattern`: it is a metadata-restriction rule type, which GitHub
 * rejects on Free and Pro regardless of visibility, so asking for it would
 * guarantee a divergence on the plans most projects are on. Branch naming
 * stays a review concern.
 *
 * @param {{ branches?: string[], statusCheck?: string }} [options]
 * @returns {Record<string, any>}
 */
export const buildRulesetPayload = ({
  branches = PROTECTED_BRANCHES,
  statusCheck = REQUIRED_STATUS_CHECK,
} = {}) => ({
  name: RULESET_NAME,
  target: "branch",
  enforcement: "active",
  conditions: {
    ref_name: { include: branches.map((branch) => `refs/heads/${branch}`), exclude: [] },
  },
  rules: [
    { type: "deletion" },
    { type: "non_fast_forward" },
    {
      type: "pull_request",
      parameters: {
        required_approving_review_count: 1,
        dismiss_stale_reviews_on_push: true,
        require_code_owner_review: false,
        require_last_push_approval: false,
        required_review_thread_resolution: true,
        allowed_merge_methods: ["merge", "squash", "rebase"],
      },
    },
    {
      type: "required_status_checks",
      parameters: {
        strict_required_status_checks_policy: true,
        required_status_checks: [{ context: statusCheck }],
      },
    },
  ],
});

/**
 * What this run would do to GitHub, in order.
 *
 * Every step is idempotent on its own — environments and rulesets are
 * upserted — so the only state the plan needs is what makes a second run an
 * update rather than a duplicate: the existing ruleset id, and the branch
 * policies already attached to each environment. `current` is `null` in a dry
 * run, which has read nothing, and the plan then describes a fresh repository.
 *
 * @param {object} request
 * @param {{ owner: string, repository: string }} request.slug
 * @param {boolean} request.enableDeploy
 * @param {number | string} [request.reviewerId]
 * @param {{
 *   rulesetId: number | null,
 *   branchPolicies: Record<string, Array<{ id: number, name: string }>>,
 * } | null} request.current
 * @returns {Array<{ key: string, label: string, command: string[], input?: object }>}
 */
export const buildGithubPlan = ({ slug, enableDeploy, reviewerId, current }) => {
  const { owner, repository } = slug;
  const base = `repos/${owner}/${repository}`;
  const steps = [];

  for (const environment of GITHUB_ENVIRONMENTS) {
    const { branch } = environment;

    steps.push({
      key: `environment:${environment.name}`,
      label: `create or update the ${environment.name} environment, restricted to ${branch}`,
      command: ghApi(`${base}/environments/${environment.name}`, { method: "PUT", input: true }),
      input: buildEnvironmentPayload({ ...environment, reviewerId }),
    });

    const policies = current?.branchPolicies?.[environment.name] ?? [];

    if (policies.some((policy) => policy.name === branch) === false) {
      steps.push({
        key: `branch-policy:${environment.name}`,
        label: `allow ${branch} to deploy to ${environment.name}`,
        command: ghApi(`${base}/environments/${environment.name}/deployment-branch-policies`, {
          method: "POST",
          input: true,
        }),
        input: { name: branch },
      });
    }

    for (const stale of policies.filter((policy) => policy.name !== branch)) {
      steps.push({
        key: `branch-policy-remove:${environment.name}:${stale.name}`,
        label: `stop allowing ${stale.name} to deploy to ${environment.name}`,
        command: ghApi(
          `${base}/environments/${environment.name}/deployment-branch-policies/${stale.id}`,
          { method: "DELETE" },
        ),
      });
    }
  }

  if (enableDeploy) {
    steps.push({
      key: "variable",
      label: `set the ${DEPLOY_VARIABLE} repository variable to true, enabling deployment`,
      command: [
        "variable", "set", DEPLOY_VARIABLE, "--repo", `${owner}/${repository}`, "--body", "true",
      ],
    });
  }

  const rulesetId = current?.rulesetId ?? null;

  steps.push({
    key: "ruleset",
    label: rulesetId === null
      ? `create the ${RULESET_NAME} ruleset over ${PROTECTED_BRANCHES.join(" and ")}`
      : `update the ${RULESET_NAME} ruleset (#${rulesetId})`,
    command: ghApi(
      rulesetId === null ? `${base}/rulesets` : `${base}/rulesets/${rulesetId}`,
      { method: rulesetId === null ? "POST" : "PUT", input: true },
    ),
    input: buildRulesetPayload(),
  });

  return steps;
};

/**
 * Render a plan, or a list of readback calls, for a human to read.
 *
 * The body is printed in full. None of these payloads can hold a credential —
 * this script never handles one — so there is nothing to redact, and a reader
 * checking a dry run needs to see exactly what would be sent.
 *
 * @param {Array<{ label: string, command: string[], input?: object }>} steps
 * @returns {string}
 */
export const describeGithubPlan = (steps) => steps.map((step) => [
  `- ${step.label}`,
  `    gh ${step.command.join(" ")}`,
  ...(step.input === undefined
    ? []
    : JSON.stringify(step.input, null, 2).split("\n").map((line) => `      ${line}`)),
].join("\n")).join("\n");

/**
 * The calls that read back what GitHub actually kept.
 *
 * Keyed rather than positional so the CLI can ask for one by name, and listed
 * here rather than inline so a dry run can print them without the CLI holding
 * a second copy of each argument list.
 *
 * @param {{ slug: { owner: string, repository: string } }} request
 * @returns {Array<{ key: string, label: string, command: string[] }>}
 */
export const buildVerificationCommands = ({ slug }) => {
  const { owner, repository } = slug;
  const base = `repos/${owner}/${repository}`;
  const nameWithOwner = `${owner}/${repository}`;

  return [
    { key: "rulesets", label: "the repository's rulesets", command: ghApi(`${base}/rulesets`) },
    ...GITHUB_ENVIRONMENTS.flatMap((environment) => [
      {
        key: `environment:${environment.name}`,
        label: `the ${environment.name} environment as saved`,
        command: ghApi(`${base}/environments/${environment.name}`),
      },
      {
        key: `branch-policies:${environment.name}`,
        label: `the branches allowed to deploy to ${environment.name}`,
        command: ghApi(`${base}/environments/${environment.name}/deployment-branch-policies`),
      },
      {
        key: `secrets:${environment.name}`,
        label: `the secret names set on ${environment.name}`,
        command: ["secret", "list", "--repo", nameWithOwner, "--env", environment.name,
          "--json", "name"],
      },
    ]),
    {
      key: "secrets",
      label: "the secret names set on the repository",
      command: ["secret", "list", "--repo", nameWithOwner, "--json", "name"],
    },
    {
      key: "variable",
      label: `the ${DEPLOY_VARIABLE} variable`,
      command: ghApi(`${base}/actions/variables/${DEPLOY_VARIABLE}`),
    },
  ];
};

/**
 * Compare one requested rule parameter with the value GitHub stored.
 *
 * GitHub normalizes what it keeps — it adds defaults a request omitted, and
 * annotates a status check with the integration that owns it — so a literal
 * deep comparison reports differences that are not divergences. Only the
 * fields the request actually asked for are compared, and the one nested shape
 * among them is reduced to the thing that was being asked for: the contexts.
 *
 * @param {string} key
 * @param {unknown} value
 * @returns {string} A comparable rendering.
 */
const normalizeParameter = (key, value) => {
  if (key === "required_status_checks" && Array.isArray(value)) {
    return JSON.stringify(value.map((check) => check.context).sort());
  }

  return JSON.stringify(Array.isArray(value) ? [...value].sort() : value);
};

/**
 * What GitHub did not save of the ruleset that was asked for.
 *
 * The honest half of this script. A `201` means the request was accepted, not
 * that every rule in it survived: plan tier, organization policy, and
 * repository visibility each silently drop rules.
 *
 * @param {object} comparison
 * @param {ReturnType<typeof buildRulesetPayload>} comparison.requested
 * @param {Record<string, any> | null | undefined} comparison.readback
 * @returns {string[]} One line per divergence; empty when nothing diverged.
 */
export const diffRuleset = ({ requested, readback }) => {
  if (readback === null || readback === undefined) {
    return [`No ruleset named ${requested.name} came back from GitHub: nothing was saved.`];
  }

  const divergences = [];

  if (readback.enforcement !== requested.enforcement) {
    divergences.push(
      `ruleset enforcement saved as "${readback.enforcement}", not "${requested.enforcement}" — `
      + "it is not being enforced.",
    );
  }

  const saved = new Map((readback.rules ?? []).map((rule) => [rule.type, rule]));

  for (const rule of requested.rules) {
    const actual = saved.get(rule.type);

    if (actual === undefined) {
      divergences.push(`ruleset rule ${rule.type} was requested but did not save.`);
      continue;
    }

    for (const [key, value] of Object.entries(rule.parameters ?? {})) {
      const stored = actual.parameters?.[key];

      if (normalizeParameter(key, stored) !== normalizeParameter(key, value)) {
        divergences.push(
          `ruleset rule ${rule.type} parameter ${key} saved as ${JSON.stringify(stored)}, `
          + `not ${JSON.stringify(value)}.`,
        );
      }
    }
  }

  const covered = new Set(readback.conditions?.ref_name?.include ?? []);

  for (const ref of requested.conditions.ref_name.include) {
    if (covered.has(ref) === false) {
      divergences.push(`ruleset does not cover ${ref}.`);
    }
  }

  return divergences;
};

/**
 * What GitHub did not save of one environment.
 *
 * Required reviewers are the rule most likely to be dropped: environment
 * protection rules are a paid feature on private repositories, and GitHub
 * accepts the request and stores nothing rather than refusing it.
 *
 * @param {object} comparison
 * @param {string} comparison.name
 * @param {string} comparison.branch The one branch that should be allowed.
 * @param {boolean} comparison.requiredReviewers
 * @param {Record<string, any> | null | undefined} comparison.readback
 * @param {Array<{ id: number, name: string }>} comparison.branchPolicies
 * @returns {string[]} One line per divergence; empty when nothing diverged.
 */
export const diffEnvironment = ({ name, branch, requiredReviewers, readback, branchPolicies }) => {
  if (readback === null || readback === undefined) {
    return [`environment ${name} was not saved.`];
  }

  const divergences = [];

  if (readback.deployment_branch_policy?.custom_branch_policies !== true) {
    divergences.push(
      `environment ${name} is not restricted to a named branch, so any branch can deploy to it.`,
    );
  }

  const allowed = branchPolicies.map((policy) => policy.name);

  if (allowed.includes(branch) === false) {
    divergences.push(`environment ${name} does not allow ${branch} to deploy to it.`);
  }

  for (const extra of allowed.filter((candidate) => candidate !== branch)) {
    divergences.push(`environment ${name} also allows ${extra}, which was not requested.`);
  }

  const protections = new Set((readback.protection_rules ?? []).map((rule) => rule.type));

  if (requiredReviewers && protections.has("required_reviewers") === false) {
    divergences.push(
      `environment ${name} saved without required reviewers. GitHub only enforces environment `
      + "protection rules on a private repository under Team or Enterprise; make the repository "
      + "public or upgrade the plan, then re-run.",
    );
  }

  return divergences;
};

/**
 * Which secret names exist, and which are missing.
 *
 * Names only. `gh secret list` returns names, never values, which is the whole
 * reason this script can report on secrets at all without handling one.
 *
 * @param {object} state
 * @param {string[]} [state.repositorySecrets] Names set at repository scope.
 * @param {Record<string, string[]>} [state.environmentSecrets] Names per environment.
 * @returns {{ lines: string[], missing: string[] }} `missing` is
 *   `environment/NAME`, so a caller can count it without re-deriving scope.
 */
export const summarizeSecrets = ({ repositorySecrets = [], environmentSecrets = {} }) => {
  const atRepository = new Set(repositorySecrets);
  const lines = [];
  const missing = [];

  for (const [name, required] of ENVIRONMENT_SECRETS) {
    const atEnvironment = new Set(environmentSecrets[name] ?? []);
    const expected = [...required, ...SHARED_SECRETS];
    const set = expected.filter(
      (secret) => atEnvironment.has(secret) || atRepository.has(secret),
    );
    const absent = expected.filter((secret) => set.includes(secret) === false);

    lines.push(`  ${name}: ${set.length === 0 ? "nothing set" : `set — ${set.join(", ")}`}`);

    if (absent.length > 0) {
      lines.push(`    missing — ${absent.join(", ")}`);
      missing.push(...absent.map((secret) => `${name}/${secret}`));
    }
  }

  lines.push(
    `  ${CI_ABSENT_SECRETS.join(", ")} is absent from CI on purpose: only the Worker verifies `
    + "signatures, and it reads that from its own Cloudflare secret.",
  );
  lines.push("  This script never sets a secret value. Add them by hand, at environment scope.");

  return { lines, missing };
};

/**
 * What the deployment opt-in is currently set to.
 *
 * @param {string | null} value The variable's value, or `null` when unset.
 * @returns {string}
 */
export const describeDeployVariable = (value) => {
  if (value === null) {
    return `  ${DEPLOY_VARIABLE} is not set, so the deploy job is skipped on every push. `
      + "Re-run with --enable-deploy once the Cloudflare and Discord secrets are in place.";
  }

  if (value === "true") {
    return `  ${DEPLOY_VARIABLE} is true: deployment is enabled.`;
  }

  return `  ${DEPLOY_VARIABLE} is "${value}", not "true", so the deploy job is skipped.`;
};
