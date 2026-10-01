import { describe, expect, it } from "vitest";
import {
  CI_ABSENT_SECRETS,
  DEPLOY_VARIABLE,
  ENVIRONMENT_SECRETS,
  GITHUB_ENVIRONMENTS,
  GITHUB_USAGE,
  PROTECTED_BRANCHES,
  REQUIRED_STATUS_CHECK,
  REVIEWER_PLACEHOLDER,
  RULESET_NAME,
  SHARED_SECRETS,
  buildEnvironmentPayload,
  buildGithubPlan,
  buildRulesetPayload,
  buildVerificationCommands,
  describeDeployVariable,
  describeGithubPlan,
  describePreflightFailure,
  diffEnvironment,
  diffRuleset,
  ghApi,
  parseGithubArguments,
  parseRepositorySlug,
  rulesetShowCommand,
  summarizeSecrets,
} from "../../scripts/lib/setup-github.js";

/** The repository every case targets. Owned by nobody; contacted by nothing. */
const slug = { owner: "acme", repository: "acme-bot" };

/**
 * A readback shaped the way GitHub returns one, with the requested payload
 * echoed back intact. Cases narrow it to describe a rule that did not save.
 *
 * @returns {Record<string, any>}
 */
const savedRuleset = () => JSON.parse(JSON.stringify({ id: 42, ...buildRulesetPayload() }));

describe("setup:github arguments", () => {
  it("defaults to a run that changes GitHub and leaves deployment disabled", () => {
    expect(parseGithubArguments([])).toEqual({
      repo: undefined,
      reviewer: undefined,
      enableDeploy: false,
      yes: false,
      dryRun: false,
      help: false,
    });
  });

  it("reads every flag and option", () => {
    const parsed = parseGithubArguments([
      "--repo", "acme/acme-bot",
      "--reviewer", "someone",
      "--enable-deploy",
      "--dry-run",
      "-y",
    ]);

    expect(parsed).toMatchObject({
      repo: "acme/acme-bot",
      reviewer: "someone",
      enableDeploy: true,
      dryRun: true,
      yes: true,
    });
  });

  it("treats --help as a request to explain itself", () => {
    expect(parseGithubArguments(["--help"]).help).toBe(true);
    expect(GITHUB_USAGE).toMatch(/--dry-run/);
    expect(GITHUB_USAGE).toMatch(/--enable-deploy/);
  });

  it("refuses an argument it does not recognize rather than guessing", () => {
    expect(() => parseGithubArguments(["--rep", "acme/acme-bot"]))
      .toThrow(/Unrecognized argument --rep/);
  });

  it("refuses an option with no value", () => {
    expect(() => parseGithubArguments(["--repo"])).toThrow(/--repo needs a value/);
    expect(() => parseGithubArguments(["--repo", "--yes"])).toThrow(/--repo needs a value/);
  });
});

describe("preflight", () => {
  it("passes only when gh is installed and authenticated", () => {
    expect(describePreflightFailure({ ghInstalled: true, authenticated: true })).toBe(null);
  });

  it("names the missing tool rather than failing on a stack trace", () => {
    expect(describePreflightFailure({ ghInstalled: false, authenticated: false }))
      .toMatch(/GitHub CLI/);
  });

  it("names the authentication step when gh is present but signed out", () => {
    expect(describePreflightFailure({ ghInstalled: true, authenticated: false }))
      .toMatch(/gh auth login/);
  });
});

describe("repository slug", () => {
  it("reads owner and repository from every form a remote takes", () => {
    for (const text of [
      "acme/acme-bot",
      "https://github.com/acme/acme-bot",
      "https://github.com/acme/acme-bot.git",
      "git@github.com:acme/acme-bot.git",
      "ssh://git@github.com/acme/acme-bot.git",
      "  acme/acme-bot/  ",
    ]) {
      expect(parseRepositorySlug(text)).toEqual(slug);
    }
  });

  it("refuses anything it cannot read an owner out of", () => {
    expect(() => parseRepositorySlug("acme-bot")).toThrow(/--repo/);
    expect(() => parseRepositorySlug("")).toThrow(/--repo/);
  });
});

describe("gh command building", () => {
  it("builds a GET with no method flag", () => {
    expect(ghApi("repos/acme/acme-bot/rulesets")).toEqual(["api", "repos/acme/acme-bot/rulesets"]);
  });

  it("builds a body-carrying call that reads its input from stdin", () => {
    expect(ghApi("repos/acme/acme-bot/environments/non-prod", { method: "PUT", input: true }))
      .toEqual([
        "api", "--method", "PUT", "repos/acme/acme-bot/environments/non-prod", "--input", "-",
      ]);
  });

  it("names one ruleset by id", () => {
    expect(rulesetShowCommand(slug, 42)).toEqual(["api", "repos/acme/acme-bot/rulesets/42"]);
  });
});

describe("the requested configuration", () => {
  it("restricts each environment to its own branch", () => {
    expect(GITHUB_ENVIRONMENTS).toEqual([
      { name: "non-prod", branch: "develop", requiredReviewers: false },
      { name: "production", branch: "main", requiredReviewers: true },
    ]);
  });

  it("uses a custom branch policy, because a protected-branches policy names no branch", () => {
    const payload = buildEnvironmentPayload({ requiredReviewers: false });

    expect(payload.deployment_branch_policy).toEqual({
      protected_branches: false,
      custom_branch_policies: true,
    });
    expect(payload.reviewers).toEqual([]);
  });

  it("asks for a reviewer only where one is wanted", () => {
    const payload = buildEnvironmentPayload({ requiredReviewers: true, reviewerId: 12345 });

    expect(payload.reviewers).toEqual([{ type: "User", id: 12345 }]);
    expect(payload.prevent_self_review).toBe(false);
  });

  it("stands a placeholder in for a reviewer id nothing has resolved yet", () => {
    const payload = buildEnvironmentPayload({ requiredReviewers: true });

    expect(payload.reviewers).toEqual([{ type: "User", id: REVIEWER_PLACEHOLDER }]);
  });

  it("covers both long-lived branches and enforces rather than evaluates", () => {
    const ruleset = buildRulesetPayload();

    expect(ruleset.name).toBe(RULESET_NAME);
    expect(ruleset.target).toBe("branch");
    expect(ruleset.enforcement).toBe("active");
    expect(ruleset.conditions.ref_name.include)
      .toEqual(PROTECTED_BRANCHES.map((branch) => `refs/heads/${branch}`));
  });

  it("matches the table in docs/using-this-template.md, rule for rule", () => {
    const rules = new Map(buildRulesetPayload().rules.map((rule) => [rule.type, rule.parameters]));

    expect([...rules.keys()].sort())
      .toEqual(["deletion", "non_fast_forward", "pull_request", "required_status_checks"]);
    expect(rules.get("pull_request")).toMatchObject({
      required_approving_review_count: 1,
      dismiss_stale_reviews_on_push: true,
      required_review_thread_resolution: true,
    });
    expect(rules.get("required_status_checks")).toEqual({
      strict_required_status_checks_policy: true,
      required_status_checks: [{ context: REQUIRED_STATUS_CHECK }],
    });
  });

  it("carries no branch_name_pattern rule, which Free and Pro reject outright", () => {
    expect(buildRulesetPayload().rules.some((rule) => rule.type === "branch_name_pattern"))
      .toBe(false);
  });
});

describe("the plan", () => {
  it("creates both environments, their branch policies, and the ruleset", () => {
    const plan = buildGithubPlan({ slug, enableDeploy: false, current: null });
    const keys = plan.map((step) => step.key);

    expect(keys).toEqual([
      "environment:non-prod",
      "branch-policy:non-prod",
      "environment:production",
      "branch-policy:production",
      "ruleset",
    ]);
    expect(plan.at(-1).command).toEqual([
      "api", "--method", "POST", "repos/acme/acme-bot/rulesets", "--input", "-",
    ]);
  });

  it("updates the ruleset it already created rather than adding a second one", () => {
    const plan = buildGithubPlan({
      slug,
      enableDeploy: false,
      current: { rulesetId: 42, branchPolicies: {} },
    });

    expect(plan.at(-1).command).toEqual([
      "api", "--method", "PUT", "repos/acme/acme-bot/rulesets/42", "--input", "-",
    ]);
    expect(plan.at(-1).label).toMatch(/update/);
  });

  it("leaves a branch policy that is already right alone, and removes one that is not", () => {
    const plan = buildGithubPlan({
      slug,
      enableDeploy: false,
      current: {
        rulesetId: null,
        branchPolicies: {
          "non-prod": [{ id: 7, name: "develop" }],
          production: [{ id: 8, name: "release" }],
        },
      },
    });
    const keys = plan.map((step) => step.key);

    expect(keys).not.toContain("branch-policy:non-prod");
    expect(keys).toContain("branch-policy:production");
    expect(plan.find((step) => step.key === "branch-policy-remove:production:release").command)
      .toEqual([
        "api", "--method", "DELETE",
        "repos/acme/acme-bot/environments/production/deployment-branch-policies/8",
      ]);
  });

  it("sets the deployment opt-in only when it was asked for", () => {
    const without = buildGithubPlan({ slug, enableDeploy: false, current: null });
    const withFlag = buildGithubPlan({ slug, enableDeploy: true, current: null });

    expect(without.some((step) => step.key === "variable")).toBe(false);
    expect(withFlag.find((step) => step.key === "variable").command)
      .toEqual(["variable", "set", DEPLOY_VARIABLE, "--repo", "acme/acme-bot", "--body", "true"]);
  });

  it("passes the reviewer id through to the production environment", () => {
    const plan = buildGithubPlan({ slug, enableDeploy: false, reviewerId: 99, current: null });

    expect(plan.find((step) => step.key === "environment:production").input.reviewers)
      .toEqual([{ type: "User", id: 99 }]);
  });

  it("prints one gh invocation per step, with the body it would send", () => {
    const described = describeGithubPlan(buildGithubPlan({
      slug,
      enableDeploy: true,
      current: null,
    }));

    expect(described).toMatch(/gh api --method PUT repos\/acme\/acme-bot\/environments\/non-prod/);
    expect(described).toMatch(/gh variable set DEPLOY_ENABLED/);
    expect(described).toMatch(/"custom_branch_policies": true/);
  });

  it("reads back everything it wrote, plus the secret names and the variable", () => {
    const keys = buildVerificationCommands({ slug }).map((command) => command.key);

    expect(keys).toEqual([
      "rulesets",
      "environment:non-prod",
      "branch-policies:non-prod",
      "secrets:non-prod",
      "environment:production",
      "branch-policies:production",
      "secrets:production",
      "secrets",
      "variable",
    ]);
  });

  it("asks gh for secret names only, never values", () => {
    const secrets = buildVerificationCommands({ slug })
      .filter((command) => command.key.startsWith("secrets"));

    for (const command of secrets) {
      expect(command.command).toContain("--json");
      expect(command.command).toContain("name");
      expect(command.command.join(" ")).not.toMatch(/value/);
    }
  });
});

describe("the readback comparison", () => {
  it("finds nothing wrong when GitHub saved what was asked for", () => {
    expect(diffRuleset({ requested: buildRulesetPayload(), readback: savedRuleset() })).toEqual([]);
  });

  it("reports a ruleset that is not there at all", () => {
    expect(diffRuleset({ requested: buildRulesetPayload(), readback: null }))
      .toEqual([`No ruleset named ${RULESET_NAME} came back from GitHub: nothing was saved.`]);
  });

  it("reports an enforcement status that protects nothing", () => {
    const readback = { ...savedRuleset(), enforcement: "evaluate" };

    expect(diffRuleset({ requested: buildRulesetPayload(), readback }).join("\n"))
      .toMatch(/enforcement saved as "evaluate"/);
  });

  it("reports a rule that did not save", () => {
    const readback = savedRuleset();

    readback.rules = readback.rules.filter((rule) => rule.type !== "required_status_checks");

    expect(diffRuleset({ requested: buildRulesetPayload(), readback }).join("\n"))
      .toMatch(/required_status_checks was requested but did not save/);
  });

  it("reports a rule that saved with a weaker parameter", () => {
    const readback = savedRuleset();

    readback.rules.find((rule) => rule.type === "pull_request")
      .parameters.required_approving_review_count = 0;

    expect(diffRuleset({ requested: buildRulesetPayload(), readback }).join("\n"))
      .toMatch(/required_approving_review_count saved as 0, not 1/);
  });

  it("ignores parameter fields GitHub adds that were never requested", () => {
    const readback = savedRuleset();
    const checks = readback.rules.find((rule) => rule.type === "required_status_checks");

    checks.parameters.do_not_enforce_on_create = false;
    checks.parameters.required_status_checks = [{ context: "test", integration_id: null }];

    expect(diffRuleset({ requested: buildRulesetPayload(), readback })).toEqual([]);
  });

  it("reports a rule whose parameters vanished entirely", () => {
    const readback = savedRuleset();

    delete readback.rules.find((rule) => rule.type === "pull_request").parameters;

    expect(diffRuleset({ requested: buildRulesetPayload(), readback }).length)
      .toBeGreaterThan(0);
  });

  it("reports every rule missing from a readback that carries no rules at all", () => {
    // The shape GitHub's ruleset *list* endpoint returns. Diffing against it
    // by mistake has to read as "nothing saved", never as "all fine".
    const { id, name, target, enforcement, conditions } = savedRuleset();
    const divergences = diffRuleset({
      requested: buildRulesetPayload(),
      readback: { id, name, target, enforcement, conditions },
    });

    expect(divergences).toHaveLength(buildRulesetPayload().rules.length);
    expect(divergences.every((line) => line.includes("did not save"))).toBe(true);
  });

  it("reports a branch the ruleset does not cover", () => {
    const readback = savedRuleset();

    readback.conditions = { ref_name: { include: ["refs/heads/main"], exclude: [] } };

    expect(diffRuleset({ requested: buildRulesetPayload(), readback }).join("\n"))
      .toMatch(/does not cover refs\/heads\/develop/);
  });

  it("reports a ruleset that came back with no conditions at all", () => {
    const readback = savedRuleset();

    delete readback.conditions;

    expect(diffRuleset({ requested: buildRulesetPayload(), readback }).length).toBe(2);
  });

  it("finds nothing wrong with an environment GitHub saved as asked", () => {
    expect(diffEnvironment({
      name: "production",
      branch: "main",
      requiredReviewers: true,
      readback: {
        deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
        protection_rules: [{ type: "required_reviewers" }],
      },
      branchPolicies: [{ id: 1, name: "main" }],
    })).toEqual([]);
  });

  it("reports an environment that is not there", () => {
    expect(diffEnvironment({
      name: "production",
      branch: "main",
      requiredReviewers: true,
      readback: null,
      branchPolicies: [],
    })).toEqual(["environment production was not saved."]);
  });

  it("reports required reviewers that the plan tier refused, and says why", () => {
    const divergences = diffEnvironment({
      name: "production",
      branch: "main",
      requiredReviewers: true,
      readback: {
        deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
        protection_rules: [],
      },
      branchPolicies: [{ id: 1, name: "main" }],
    });

    expect(divergences.join("\n")).toMatch(/required reviewers/);
    expect(divergences.join("\n")).toMatch(/private repository/);
  });

  it("reports an unrestricted environment and every branch it should not allow", () => {
    const divergences = diffEnvironment({
      name: "non-prod",
      branch: "develop",
      requiredReviewers: false,
      readback: { deployment_branch_policy: null, protection_rules: [] },
      branchPolicies: [{ id: 2, name: "main" }],
    });

    expect(divergences.join("\n")).toMatch(/not restricted/);
    expect(divergences.join("\n")).toMatch(/does not allow develop/);
    expect(divergences.join("\n")).toMatch(/also allows main/);
  });

  it("reports an environment whose branch policy came back as protected-branches", () => {
    const divergences = diffEnvironment({
      name: "non-prod",
      branch: "develop",
      requiredReviewers: false,
      readback: {
        deployment_branch_policy: { protected_branches: true, custom_branch_policies: false },
      },
      branchPolicies: [{ id: 2, name: "develop" }],
    });

    expect(divergences.join("\n")).toMatch(/not restricted/);
  });
});

describe("the secret report", () => {
  it("names what is set and what is missing, per environment", () => {
    const { lines, missing } = summarizeSecrets({
      repositorySecrets: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
      environmentSecrets: {
        "non-prod": ["DISCORD_TOKEN", "DISCORD_APPLICATION_ID", "DISCORD_GUILD_ID"],
        production: ["DISCORD_TOKEN"],
      },
    });

    expect(missing).toEqual(["production/DISCORD_APPLICATION_ID"]);
    expect(lines.join("\n")).toMatch(/non-prod: set/);
    expect(lines.join("\n")).toMatch(/missing — DISCORD_APPLICATION_ID/);
  });

  it("accepts a shared secret at either scope", () => {
    const viaEnvironment = summarizeSecrets({
      repositorySecrets: [],
      environmentSecrets: {
        "non-prod": [...ENVIRONMENT_SECRETS.get("non-prod"), ...SHARED_SECRETS],
        production: [...ENVIRONMENT_SECRETS.get("production"), ...SHARED_SECRETS],
      },
    });

    expect(viaEnvironment.missing).toEqual([]);
  });

  it("says an environment with nothing set has nothing set", () => {
    const { lines, missing } = summarizeSecrets({ environmentSecrets: {} });

    expect(missing.length).toBe(ENVIRONMENT_SECRETS.get("non-prod").length
      + ENVIRONMENT_SECRETS.get("production").length + SHARED_SECRETS.length * 2);
    expect(lines.join("\n")).toMatch(/non-prod: nothing set/);
  });

  it("says the absent public key is absent on purpose", () => {
    const { lines } = summarizeSecrets({ repositorySecrets: [] });

    expect(lines.join("\n")).toMatch(new RegExp(`${CI_ABSENT_SECRETS[0]}.*on purpose`));
  });

  it("never reports a secret value, because it is never given one", () => {
    const { lines } = summarizeSecrets({
      repositorySecrets: ["CLOUDFLARE_API_TOKEN"],
      environmentSecrets: { "non-prod": ["DISCORD_TOKEN"] },
    });

    expect(lines.join("\n")).not.toMatch(/=/);
  });
});

describe("the deployment variable", () => {
  it("reads true as enabled", () => {
    expect(describeDeployVariable("true")).toMatch(/enabled/);
  });

  it("reads an absent variable as the deploy job being skipped", () => {
    expect(describeDeployVariable(null)).toMatch(/--enable-deploy/);
  });

  it("reads any other value as not true", () => {
    expect(describeDeployVariable("yes")).toMatch(/"yes", not "true"/);
  });
});
