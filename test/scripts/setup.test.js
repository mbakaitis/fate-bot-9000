import { describe, expect, it } from "vitest";
import {
  COVERAGE_FLOOR,
  DEV_VARS,
  DEV_VARS_EXAMPLE,
  IDENTITY_REWRITES,
  PACKAGE_MANIFEST,
  PROJECT_INITIAL_VERSION,
  PROJECT_SLUG_MAX_LENGTH,
  SETUP_TRANSFORMS,
  SETUP_USAGE,
  applyTransform,
  buildPlaceholderValues,
  buildProvenance,
  describeRemainingWork,
  describeSetupPlan,
  deriveWorkerNames,
  findSetupBlockers,
  parseSetupArguments,
  planInstructionFiles,
  planProjectSetup,
  planSetup,
  recordProvenance,
  removeInstructionContractSection,
  removePackageScript,
  resolvePruneGlobs,
  rewriteCoverageThresholds,
  rewritePackageLock,
  rewritePackageManifest,
  rewriteTemplateLinks,
  rewriteWranglerNames,
  setupListingSources,
  substitutePlaceholders,
} from "../../scripts/lib/setup.js";

/**
 * A manifest small enough to reason about, shaped exactly like
 * `template-manifest.json`. The planner is given a manifest and a file
 * listing rather than a repository, so every case here is a pure value in and
 * a pure value out — `test/contracts/manifest.template-only.test.js` is what
 * runs the planner against the real manifest and the real checkout.
 */
const manifest = {
  instructionFiles: [
    { maintainer: "claude.md", downstream: "claude-for-users.md" },
    { maintainer: "AGENTS.md", downstream: "AGENTS-for-users.md" },
  ],
  copy: [
    { from: ".template/README.md", to: "README.md" },
    { from: ".template/CHANGELOG.md", to: "CHANGELOG.md" },
  ],
  prune: ["CONTRIBUTING.md", "CHANGELOG.md", "template-manifest.json"],
  pruneGlobs: [".changeset/*.md"],
  pruneDirectories: [".template"],
  selfDelete: {
    paths: ["scripts/setup.js", "scripts/lib/setup.js"],
    packageScripts: ["setup"],
  },
};

/** Everything the sample manifest talks about, as a checkout would list it. */
const files = [
  ".changeset/config.json",
  ".changeset/one.md",
  ".changeset/two.md",
  ".template/CHANGELOG.md",
  ".template/README.md",
  "AGENTS-for-users.md",
  "AGENTS.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "README.md",
  "claude-for-users.md",
  "claude.md",
  "scripts/lib/setup.js",
  "scripts/setup.js",
  "template-manifest.json",
];

/**
 * The paths a plan deletes, in plan order.
 *
 * @param {Array<Record<string, unknown>>} plan
 * @returns {string[]}
 */
const deleted = (plan) =>
  plan.filter((operation) => operation.kind === "delete").map((operation) => operation.path);

describe("resolvePruneGlobs", () => {
  it("expands a glob against the files that are actually present", () => {
    expect(resolvePruneGlobs([".changeset/*.md"], files)).toEqual([
      ".changeset/one.md",
      ".changeset/two.md",
    ]);
  });

  it("keeps a wildcard inside one path segment", () => {
    // `.changeset/*.md` must not reach a nested file: a glob that quietly
    // recursed would delete things the manifest never named.
    expect(resolvePruneGlobs([".changeset/*.md"], [".changeset/nested/deep.md"])).toEqual([]);
  });

  it("treats the rest of a glob as literal text", () => {
    // The `.` is a regular expression metacharacter; if it leaked through
    // unescaped, `.changeset/*.md` would also match `.changeset/xxmd`.
    expect(resolvePruneGlobs([".changeset/*.md"], [".changeset/oneXmd"])).toEqual([]);
  });

  it("resolves nothing when no glob is declared", () => {
    expect(resolvePruneGlobs([], files)).toEqual([]);
  });
});

describe("planInstructionFiles", () => {
  it("swaps each downstream counterpart over its maintainer file", () => {
    expect(
      planInstructionFiles({
        instructionFiles: manifest.instructionFiles,
        files,
        mode: "swap",
      }),
    ).toEqual([
      { kind: "move", from: "claude-for-users.md", to: "claude.md", overwrite: true },
      { kind: "move", from: "AGENTS-for-users.md", to: "AGENTS.md", overwrite: true },
    ]);
  });

  it("moves rather than overwrites when the maintainer file is already gone", () => {
    expect(
      planInstructionFiles({
        instructionFiles: manifest.instructionFiles,
        files: ["claude-for-users.md", "AGENTS-for-users.md"],
        mode: "swap",
      }),
    ).toEqual([
      { kind: "move", from: "claude-for-users.md", to: "claude.md", overwrite: false },
      { kind: "move", from: "AGENTS-for-users.md", to: "AGENTS.md", overwrite: false },
    ]);
  });

  it("does nothing when the swap already happened", () => {
    // A half-failed setup run must be safe to re-run, so a repository that
    // already carries only the maintainer names is a no-op rather than an
    // error.
    expect(
      planInstructionFiles({
        instructionFiles: manifest.instructionFiles,
        files: ["claude.md", "AGENTS.md"],
        mode: "swap",
      }),
    ).toEqual([]);
  });

  it("deletes every instruction file that is present", () => {
    expect(
      planInstructionFiles({
        instructionFiles: manifest.instructionFiles,
        files: ["claude.md", "claude-for-users.md", "AGENTS.md"],
        mode: "delete",
      }),
    ).toEqual([
      { kind: "delete", path: "claude.md", reason: "instruction-files" },
      { kind: "delete", path: "claude-for-users.md", reason: "instruction-files" },
      { kind: "delete", path: "AGENTS.md", reason: "instruction-files" },
    ]);
  });

  it("leaves the instruction files alone on request", () => {
    expect(
      planInstructionFiles({ instructionFiles: manifest.instructionFiles, files, mode: "keep" }),
    ).toEqual([]);
  });

  it("refuses an unrecognized mode rather than guessing one", () => {
    expect(() =>
      planInstructionFiles({ instructionFiles: manifest.instructionFiles, files, mode: "swp" }),
    ).toThrow(/swap|delete|keep/);
  });
});

describe("planSetup", () => {
  it("copies the payload before anything is deleted", () => {
    const plan = planSetup({ manifest, files });
    const lastCopy = plan.findLastIndex((operation) => operation.kind === "copy");
    const firstDelete = plan.findIndex((operation) => operation.kind.startsWith("delete"));

    expect(lastCopy).toBeGreaterThanOrEqual(0);
    expect(firstDelete).toBeGreaterThan(lastCopy);
  });

  it("records whether each copy overwrites a file that is already there", () => {
    const plan = planSetup({ manifest, files: [".template/README.md", ".template/CHANGELOG.md"] });

    expect(plan.filter((operation) => operation.kind === "copy")).toEqual([
      { kind: "copy", from: ".template/README.md", to: "README.md", overwrite: false },
      { kind: "copy", from: ".template/CHANGELOG.md", to: "CHANGELOG.md", overwrite: false },
    ]);
  });

  it("replaces a pruned path that a copy writes to, rather than deleting it", () => {
    // CHANGELOG.md is on both lists: the template's history does not survive,
    // but the payload writes a fresh one over it. Deleting it after the copy
    // would throw the replacement away.
    const plan = planSetup({ manifest, files });

    expect(deleted(plan)).not.toContain("CHANGELOG.md");
    expect(plan).toContainEqual({
      kind: "copy",
      from: ".template/CHANGELOG.md",
      to: "CHANGELOG.md",
      overwrite: true,
    });
  });

  it("skips a pruned path that is not present", () => {
    const plan = planSetup({ manifest, files: files.filter((file) => file !== "CONTRIBUTING.md") });

    expect(deleted(plan)).not.toContain("CONTRIBUTING.md");
  });

  it("deletes each path once, whichever list reached it first", () => {
    const overlapping = {
      ...manifest,
      prune: [...manifest.prune, ".changeset/one.md"],
    };
    const plan = planSetup({ manifest: overlapping, files });

    expect(deleted(plan).filter((path) => path === ".changeset/one.md")).toHaveLength(1);
  });

  it("empties a pruned directory before removing it", () => {
    const plan = planSetup({ manifest, files });
    const removal = plan.findIndex(
      (operation) => operation.kind === "delete-directory" && operation.path === ".template",
    );

    expect(removal).toBeGreaterThan(plan.findIndex((o) => o.path === ".template/README.md"));
    expect(plan.filter((operation) => operation.kind === "delete-directory")).toEqual([
      { kind: "delete-directory", path: ".template" },
    ]);
  });

  it("does not remove a directory that is not there", () => {
    const plan = planSetup({
      manifest,
      files: files.filter((file) => !file.startsWith(".template/")),
    });

    expect(plan.filter((operation) => operation.kind === "delete-directory")).toEqual([]);
  });

  it("leaves the changeset configuration alone while pruning the changesets", () => {
    const plan = planSetup({ manifest, files });

    expect(deleted(plan)).toContain(".changeset/one.md");
    expect(deleted(plan)).toContain(".changeset/two.md");
    expect(deleted(plan)).not.toContain(".changeset/config.json");
  });

  it("puts the setup script's own removal last", () => {
    const plan = planSetup({ manifest, files });
    const selfDeletes = [
      plan.findIndex((operation) => operation.path === "scripts/lib/setup.js"),
      plan.findIndex((operation) => operation.kind === "remove-package-script"),
    ];
    const others = plan
      .map((operation, index) => ({ operation, index }))
      .filter(({ operation }) => !manifest.selfDelete.paths.includes(operation.path))
      .filter(({ operation }) => operation.kind !== "remove-package-script")
      .map(({ index }) => index);

    for (const index of selfDeletes) {
      expect(index).toBeGreaterThan(Math.max(...others));
    }

    expect(plan.at(-1)).toEqual({ kind: "remove-package-script", name: "setup" });
  });

  it("swaps the instruction files by default, and honours an explicit mode", () => {
    expect(planSetup({ manifest, files })).toContainEqual({
      kind: "move",
      from: "claude-for-users.md",
      to: "claude.md",
      overwrite: true,
    });

    expect(
      planSetup({ manifest, files, instructionMode: "keep" }).some(
        (operation) => operation.kind === "move",
      ),
    ).toBe(false);
  });

  it("plans the same operations when the plan has already been applied once", () => {
    // Idempotence at the planning layer: given the tree setup would leave
    // behind, there is nothing left to do but the copies, which overwrite.
    const applied = [
      ".changeset/config.json",
      "AGENTS.md",
      "CHANGELOG.md",
      "README.md",
      "claude.md",
    ];
    const plan = planSetup({ manifest, files: applied });

    expect(deleted(plan)).toEqual([]);
    expect(plan.filter((operation) => operation.kind === "delete-directory")).toEqual([]);
    expect(plan.filter((operation) => operation.kind === "move")).toEqual([]);
  });
});

/**
 * Below: the identity transforms. These cases use miniature fixtures so every
 * branch is reachable and the failure message points at one rule.
 * `test/contracts/setup-transforms.template-only.test.js` runs the same
 * functions against the repository's real files, which is what notices an
 * upstream edit that moves an anchor a transform keys on.
 */

describe("deriveWorkerNames", () => {
  it("derives a base, a non-production, and a production Worker name", () => {
    expect(deriveWorkerNames("acme-bot")).toEqual({
      base: "acme-bot",
      nonProd: "acme-bot-non-prod",
      production: "acme-bot-production",
    });
  });

  it("satisfies the environment-isolation naming contract", () => {
    // The same three assertions test/contracts/environment-isolation.test.js
    // makes about wrangler.jsonc, asserted here against the derivation rather
    // than assumed: unique names, a non-production indicator, and a
    // production indicator.
    const names = deriveWorkerNames("acme-bot");
    const all = [names.base, names.nonProd, names.production];

    expect(new Set(all).size).toBe(all.length);
    expect(names.nonProd).toContain("non-prod");
    expect(names.production).toContain("production");
  });

  it("accepts a single-character slug", () => {
    expect(deriveWorkerNames("a").base).toBe("a");
  });

  it("requires a slug", () => {
    expect(() => deriveWorkerNames(undefined)).toThrow(/slug is required/);
    expect(() => deriveWorkerNames("")).toThrow(/slug is required/);
  });

  it("rejects anything Cloudflare would not accept as a Worker name", () => {
    // Alphanumerics and dashes only, no underscores, and no leading or
    // trailing dash — the workers.dev constraint the template deploys under.
    for (const slug of ["Acme-Bot", "acme_bot", "-acme", "acme-", "acme bot", "acme.bot"]) {
      expect(() => deriveWorkerNames(slug)).toThrow(/lowercase letters, digits, and dashes/);
    }
  });

  it("leaves room for the longest environment suffix", () => {
    expect(deriveWorkerNames("a".repeat(PROJECT_SLUG_MAX_LENGTH)).production).toHaveLength(63);
    expect(() => deriveWorkerNames("a".repeat(PROJECT_SLUG_MAX_LENGTH + 1))).toThrow(/limit/);
  });
});

/** A wrangler.jsonc shaped like the real one, small enough to read whole. */
const wranglerFixture = `{
  "name": "old-name",
  "main": "src/index.js",
  "compatibility_date": "2026-08-18",
  "secrets": {
    "required": ["DISCORD_PUBLIC_KEY"]
  },
  "env": {
    "non-prod": {
      "name": "old-name-non-prod"
    },
    "production": {
      "name": "old-name-production"
    }
  }
}
`;

describe("rewriteWranglerNames", () => {
  const names = deriveWorkerNames("acme-bot");

  it("replaces exactly the three Worker names", () => {
    const rewritten = rewriteWranglerNames(wranglerFixture, names);

    expect(JSON.parse(rewritten)).toEqual({
      name: "acme-bot",
      main: "src/index.js",
      compatibility_date: "2026-08-18",
      secrets: { required: ["DISCORD_PUBLIC_KEY"] },
      env: {
        "non-prod": { name: "acme-bot-non-prod" },
        production: { name: "acme-bot-production" },
      },
    });
  });

  it("changes nothing but the three name values, byte for byte", () => {
    const rewritten = rewriteWranglerNames(wranglerFixture, names);

    expect(rewritten.replaceAll("acme-bot", "old-name")).toBe(wranglerFixture);
  });

  it("is idempotent", () => {
    const once = rewriteWranglerNames(wranglerFixture, names);

    expect(rewriteWranglerNames(once, names)).toBe(once);
  });

  it("refuses a configuration that is missing a name to rewrite", () => {
    expect(() => rewriteWranglerNames("{ \"env\": {} }", names)).toThrow(/base Worker name/);
    expect(() => rewriteWranglerNames("{ \"name\": \"a\", \"env\": {} }", names))
      .toThrow(/nonProd Worker name/);
    expect(() =>
      rewriteWranglerNames("{ \"name\": \"a\", \"env\": { \"non-prod\": { \"name\": \"b\" } } }", names))
      .toThrow(/production Worker name/);
  });

  it("refuses a configuration that reuses one name across environments", () => {
    const shared = wranglerFixture.replaceAll("old-name-non-prod", "old-name-production");

    expect(() => rewriteWranglerNames(shared, names)).toThrow(/reuses a Worker name/);
  });

  it("refuses to rewrite when a name appears somewhere it was not expected", () => {
    const extra = wranglerFixture.replace("\"main\": \"src/index.js\"", "\"main\": \"old-name\"");

    expect(() => rewriteWranglerNames(extra, names)).toThrow(/rewrote 4/);
  });
});

/** A package.json carrying every key the transform touches. */
const packageFixture = `{
  "name": "old-name",
  "version": "0.2.0",
  "description": "Boilerplate template for a Discord bot",
  "keywords": [
    "cloudflare",
    "template",
    "boilerplate",
    "discord"
  ],
  "author": "Someone <someone@example.com>",
  "license": "MIT",
  "scripts": {
    "dev": "wrangler dev",
    "setup": "node scripts/setup.js"
  }
}
`;

describe("rewritePackageManifest", () => {
  const project = { name: "acme-bot", description: "Answers questions in chat." };

  it("takes the project's identity and drops the template's", () => {
    const manifest = JSON.parse(rewritePackageManifest(packageFixture, project));

    expect(manifest.name).toBe("acme-bot");
    expect(manifest.description).toBe("Answers questions in chat.");
    expect(manifest.version).toBe("0.0.0");
    expect(manifest.keywords).toEqual(["cloudflare", "discord"]);
    expect(manifest.scripts).toEqual({ dev: "wrangler dev" });
  });

  it("leaves the author and the license alone", () => {
    // Deliberate: rewriting a copyright holder is not the setup script's call.
    // The CLI prints a warning instead.
    const manifest = JSON.parse(rewritePackageManifest(packageFixture, project));

    expect(manifest.author).toBe("Someone <someone@example.com>");
    expect(manifest.license).toBe("MIT");
  });

  it("preserves key order and the file's two-space formatting", () => {
    const rewritten = rewritePackageManifest(packageFixture, project);

    expect(Object.keys(JSON.parse(rewritten))).toEqual(Object.keys(JSON.parse(packageFixture)));
    expect(rewritten).toContain("\n  \"version\": \"0.0.0\",\n");
    expect(rewritten.endsWith("}\n")).toBe(true);
  });

  it("tolerates a manifest with neither keywords nor a setup script", () => {
    const bare = rewritePackageManifest("{\n  \"name\": \"old-name\"\n}\n", project);

    expect(JSON.parse(bare)).toEqual({
      name: "acme-bot",
      description: "Answers questions in chat.",
      version: "0.0.0",
    });
  });

  it("is idempotent", () => {
    const once = rewritePackageManifest(packageFixture, project);

    expect(rewritePackageManifest(once, project)).toBe(once);
  });
});

/** The first ten lines of a lockfile, which is where both names live. */
const lockFixture = `{
  "name": "old-name",
  "version": "0.2.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": {
      "name": "old-name",
      "version": "0.2.0",
      "license": "MIT"
    },
    "node_modules/old-name-lookalike": {
      "name": "old-name-lookalike",
      "version": "1.0.0"
    }
  }
}
`;

describe("rewritePackageLock", () => {
  it("updates the root and workspace identity and nothing else", () => {
    const rewritten = rewritePackageLock(lockFixture, { name: "acme-bot" });

    expect(rewritten.match(/"name": "acme-bot"/g)).toHaveLength(2);
    expect(rewritten).toContain("\"name\": \"old-name-lookalike\"");
    expect(rewritten).toContain("\"version\": \"1.0.0\"");
    expect(
      rewritten
        .replaceAll("\"name\": \"acme-bot\"", "\"name\": \"old-name\"")
        .replaceAll(`"version": "${PROJECT_INITIAL_VERSION}"`, "\"version\": \"0.2.0\""),
    ).toBe(lockFixture);
  });

  it("resets both versions to the one package.json starts at", () => {
    // test/contracts/versioning.test.js ships downstream and compares the
    // lockfile's two versions against package.json's. A rename that left the
    // template's version behind would fail a new project's first `npm test`.
    const parsed = JSON.parse(rewritePackageLock(lockFixture, { name: "acme-bot" }));

    expect(parsed.version).toBe(PROJECT_INITIAL_VERSION);
    expect(parsed.packages[""].version).toBe(PROJECT_INITIAL_VERSION);
    expect(parsed.packages["node_modules/old-name-lookalike"].version).toBe("1.0.0");
  });

  it("accepts an explicit version", () => {
    const rewritten = rewritePackageLock(lockFixture, { name: "acme-bot", version: "1.2.3" });

    expect(JSON.parse(rewritten).version).toBe("1.2.3");
    expect(JSON.parse(rewritten).packages[""].version).toBe("1.2.3");
  });

  it("is idempotent", () => {
    const once = rewritePackageLock(lockFixture, { name: "acme-bot" });

    expect(rewritePackageLock(once, { name: "acme-bot" })).toBe(once);
  });

  it("refuses a lockfile it does not recognize", () => {
    expect(() => rewritePackageLock("{\n  \"lockfileVersion\": 3\n}\n", { name: "acme-bot" }))
      .toThrow(/root name/);
    expect(() => rewritePackageLock("{\n  \"name\": \"old-name\"\n}\n", { name: "acme-bot" }))
      .toThrow(/packages\[""\] name/);
    expect(() => rewritePackageLock("{\n  \"name\": \"a\",\n  \"lockfileVersion\": 3\n}\n",
      { name: "acme-bot" })).toThrow(/packages\[""\] name/);
  });
});

/** The coverage section of vitest.config.js, comment and all. */
const vitestFixture = `    coverage: {
      provider: "istanbul",
      include: ["src/**/*.js", "scripts/lib/**/*.js"],
      // A ratchet, not an aspiration: these numbers are the level the suite
      // currently reaches. Raise them by hand when a change measures higher, so
      // the new promise appears in a reviewed diff; never lower them to make a
      // change pass. \`thresholds.autoUpdate\` is deliberately not used — a
      // threshold that moves on its own is not a reviewed promise.
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
`;

describe("rewriteCoverageThresholds", () => {
  it("lowers all four thresholds to the floor", () => {
    const rewritten = rewriteCoverageThresholds(vitestFixture);

    for (const metric of ["branches", "functions", "lines", "statements"]) {
      expect(rewritten).toContain(`${metric}: ${COVERAGE_FLOOR},`);
    }

    expect(rewritten).not.toContain("100");
  });

  it("uses a floor that still satisfies the coverage contract", () => {
    // test/contracts/coverage.test.js requires every threshold to be a number
    // greater than zero, so a floor of 0 would quietly disable the check.
    expect(COVERAGE_FLOOR).toBeGreaterThan(0);
  });

  it("accepts an explicit floor", () => {
    expect(rewriteCoverageThresholds(vitestFixture, 70)).toContain("branches: 70,");
  });

  it("replaces the ratchet comment with wording that fits a project", () => {
    const rewritten = rewriteCoverageThresholds(vitestFixture);

    expect(rewritten).not.toContain("A ratchet, not an aspiration");
    expect(rewritten).toContain("      // A floor, not a ratchet");
  });

  it("leaves the provider and the include patterns alone", () => {
    const rewritten = rewriteCoverageThresholds(vitestFixture);

    expect(rewritten).toContain("provider: \"istanbul\",");
    expect(rewritten).toContain("include: [\"src/**/*.js\", \"scripts/lib/**/*.js\"],");
    // The comment still names `thresholds.autoUpdate`; what must not appear is
    // the setting itself.
    expect(rewritten).not.toContain("autoUpdate:");
  });

  it("is idempotent", () => {
    const once = rewriteCoverageThresholds(vitestFixture);

    expect(rewriteCoverageThresholds(once)).toBe(once);
  });

  it("refuses a configuration with no thresholds block", () => {
    expect(() => rewriteCoverageThresholds("coverage: { provider: \"istanbul\" }"))
      .toThrow(/no coverage thresholds block/);
  });
});

describe("substitutePlaceholders", () => {
  const values = { PROJECT_NAME: "acme-bot", TEMPLATE_VERSION: "0.2.0" };

  it("replaces every declared token", () => {
    expect(substitutePlaceholders("# {{PROJECT_NAME}} at {{TEMPLATE_VERSION}}", values))
      .toBe("# acme-bot at 0.2.0");
  });

  it("replaces a token that appears more than once", () => {
    expect(substitutePlaceholders("{{PROJECT_NAME}}/{{PROJECT_NAME}}", values))
      .toBe("acme-bot/acme-bot");
  });

  it("leaves text without tokens untouched, and is therefore idempotent", () => {
    const once = substitutePlaceholders("# {{PROJECT_NAME}}", values);

    expect(substitutePlaceholders(once, values)).toBe(once);
  });

  it("refuses to ship a file with an unsubstituted token", () => {
    // The failure this prevents is a new project whose README greets the
    // reader with {{PROJECT_DESCRIPTION}}.
    expect(() => substitutePlaceholders("{{PROJECT_NAME}} — {{PROJECT_DESCRIPTION}}", values))
      .toThrow(/\{\{PROJECT_DESCRIPTION\}\}/);
  });
});

describe("rewriteTemplateLinks", () => {
  const upstream = { templateRepository: "https://example.com/owner/repo" };
  const blob = "https://example.com/owner/repo/blob/main/docs/using-this-template.md";

  it("sends an anchored link upstream with its anchor intact", () => {
    expect(rewriteTemplateLinks("see [Step 6](using-this-template.md#6-configure)", upstream))
      .toEqual({ text: `see [Step 6](${blob}#6-configure)`, rewritten: 1 });
  });

  it("sends a bare setup-guide link upstream too", () => {
    expect(rewriteTemplateLinks("see [Using this template](using-this-template.md)", upstream))
      .toEqual({ text: `see [Using this template](${blob})`, rewritten: 1 });
  });

  it("counts every link it rewrote", () => {
    const text = "[a](using-this-template.md) [b](using-this-template.md#x)";

    expect(rewriteTemplateLinks(text, upstream).rewritten).toBe(2);
  });

  it("leaves other links alone, and is therefore idempotent", () => {
    const { text } = rewriteTemplateLinks("[a](discord-bot.md#x) [b](using-this-template.md)",
      upstream);

    expect(rewriteTemplateLinks(text, upstream)).toEqual({ text, rewritten: 0 });
  });
});

/** The section of docs/versioning-and-changesets.md that does not survive. */
const versioningFixture = `## Deployment is separate

Versioning and deployment are independent.

## Two version numbers

This repository carries two, and they move independently:

| Version | Where | Describes |
| --- | --- | --- |
| Package version | \`package.json\` | The code |
| Instruction contract version | Headers of \`claude.md\` | The requirements |

Both use Semantic Versioning. See [CONTRIBUTING.md](../CONTRIBUTING.md#keeping-the-files-in-sync).

## What every release should state

- What changed.
`;

describe("removeInstructionContractSection", () => {
  it("removes the whole section, not just the row that stopped being true", () => {
    // The section's own premise is "this repository carries two"; with the
    // instruction contract version gone, a one-row table under that sentence
    // is worse than no section.
    const rewritten = removeInstructionContractSection(versioningFixture);

    expect(rewritten).not.toContain("## Two version numbers");
    expect(rewritten).not.toContain("Instruction contract version");
    expect(rewritten).not.toContain("../CONTRIBUTING.md");
  });

  it("keeps the sections on either side", () => {
    const rewritten = removeInstructionContractSection(versioningFixture);

    expect(rewritten).toContain("## Deployment is separate");
    expect(rewritten).toContain("## What every release should state");
    expect(rewritten).toContain("- What changed.");
  });

  it("is idempotent", () => {
    const once = removeInstructionContractSection(versioningFixture);

    expect(removeInstructionContractSection(once)).toBe(once);
  });
});

describe("parseSetupArguments", () => {
  it("defaults to an interactive run that swaps the instruction files", () => {
    expect(parseSetupArguments([])).toEqual({
      name: undefined,
      description: undefined,
      instructionMode: "swap",
      yes: false,
      dryRun: false,
      force: false,
      help: false,
    });
  });

  it("reads a name, a description, and an instruction mode", () => {
    const parsed = parseSetupArguments([
      "--name", "acme-bot",
      "--description", "Answers questions in chat.",
      "--ai", "delete",
      "--dry-run",
      "--force",
    ]);

    expect(parsed).toEqual({
      name: "acme-bot",
      description: "Answers questions in chat.",
      instructionMode: "delete",
      yes: false,
      dryRun: true,
      force: true,
      help: false,
    });
  });

  it("accepts the short form of the confirmation flag", () => {
    expect(parseSetupArguments(["-y"]).yes).toBe(true);
    expect(parseSetupArguments(["--yes"]).yes).toBe(true);
    expect(parseSetupArguments(["--help"]).help).toBe(true);
  });

  it("refuses an unrecognized argument rather than ignoring it", () => {
    // A typo that silently becomes a default is a typo that renames the wrong
    // thing, and this script only runs once.
    expect(() => parseSetupArguments(["--nam", "acme-bot"])).toThrow(/--nam/);
    expect(() => parseSetupArguments(["acme-bot"])).toThrow(/acme-bot/);
  });

  it("refuses an option with no value", () => {
    expect(() => parseSetupArguments(["--name"])).toThrow(/--name needs a value/);
    expect(() => parseSetupArguments(["--name", "--yes"])).toThrow(/--name needs a value/);
  });

  it("refuses an instruction mode it cannot honour", () => {
    expect(() => parseSetupArguments(["--ai", "maybe"])).toThrow(/swap, delete, keep/);
  });

  it("states its own usage", () => {
    expect(SETUP_USAGE).toContain("--name");
    expect(SETUP_USAGE).toContain("--dry-run");
  });
});

describe("findSetupBlockers", () => {
  it("clears a clean checkout that has never been set up", () => {
    expect(findSetupBlockers({ provenance: undefined, dirtyFiles: [] })).toEqual([]);
  });

  it("refuses to run twice", () => {
    const blockers = findSetupBlockers({
      provenance: { repository: "https://example.com/owner/repo", version: "0.2.0" },
      dirtyFiles: [],
    });

    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toMatch(/already/i);
    expect(blockers[0]).toContain("template");
  });

  it("refuses a dirty working tree and names the escape hatch", () => {
    const blockers = findSetupBlockers({ provenance: null, dirtyFiles: ["src/index.js"] });

    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toContain("--force");
    expect(blockers[0]).toContain("src/index.js");
  });

  it("names the first few dirty files rather than all of them", () => {
    const [blocker] = findSetupBlockers({
      dirtyFiles: ["one.js", "two.js", "three.js", "four.js", "five.js", "six.js", "seven.js"],
      provenance: undefined,
    });

    expect(blocker).toContain("one.js, two.js, three.js, four.js, five.js, …");
    expect(blocker).not.toContain("seven.js");
  });

  it("runs on a dirty tree when told to", () => {
    expect(findSetupBlockers({ dirtyFiles: ["src/index.js"], force: true })).toEqual([]);
  });

  it("ignores a dirty tree on a dry run, which writes nothing", () => {
    expect(findSetupBlockers({ dirtyFiles: ["src/index.js"], dryRun: true })).toEqual([]);
  });

  it("tolerates a checkout whose tree state could not be read", () => {
    // `git status` fails in a directory that is not a repository. That is not
    // a reason to refuse; it is a reason not to claim the tree is clean.
    expect(findSetupBlockers({ dirtyFiles: null })).toEqual([]);
  });

  it("reports both problems at once", () => {
    expect(findSetupBlockers({
      provenance: { version: "0.2.0" },
      dirtyFiles: ["src/index.js"],
    })).toHaveLength(2);
  });
});

describe("buildProvenance", () => {
  const clock = new Date("2026-09-18T14:30:00.000Z");
  const upstream = { repository: "https://example.com/owner/repo", version: "0.2.0" };

  it("records where a project came from, dated by the clock it was given", () => {
    expect(buildProvenance({ ...upstream, commit: "abc1234", now: clock })).toEqual({
      repository: upstream.repository,
      version: upstream.version,
      commit: "abc1234",
      setupDate: "2026-09-18",
    });
  });

  it("omits the commit when there is none to record", () => {
    expect(buildProvenance({ ...upstream, now: clock }).commit).toBeUndefined();
    expect(buildProvenance({ ...upstream, commit: "  ", now: clock }).commit).toBeUndefined();
    expect(buildProvenance({ ...upstream, commit: " abc1234 ", now: clock }).commit)
      .toBe("abc1234");
  });

  it("requires a clock, so no caller can make the record non-deterministic", () => {
    expect(() => buildProvenance(upstream)).toThrow(/clock/);
    expect(() => buildProvenance({ ...upstream, now: new Date("nonsense") })).toThrow(/clock/);
  });
});

describe("recordProvenance", () => {
  const provenance = { repository: "https://example.com/owner/repo", setupDate: "2026-09-18" };

  it("adds the template key without disturbing the rest of the manifest", () => {
    const recorded = JSON.parse(recordProvenance(packageFixture, provenance));

    expect(recorded.template).toEqual(provenance);
    expect(recorded.name).toBe(JSON.parse(packageFixture).name);
    expect(Object.keys(recorded).at(-1)).toBe("template");
  });

  it("is idempotent", () => {
    const once = recordProvenance(packageFixture, provenance);

    expect(recordProvenance(once, provenance)).toBe(once);
  });
});

describe("removePackageScript", () => {
  it("removes one script and leaves the others", () => {
    const manifestText = removePackageScript(packageFixture, "setup");
    const scripts = JSON.parse(manifestText).scripts;

    expect(scripts.setup).toBeUndefined();
    expect(scripts).toEqual(
      Object.fromEntries(
        Object.entries(JSON.parse(packageFixture).scripts).filter(([key]) => key !== "setup"),
      ),
    );
  });

  it("tolerates a manifest with no scripts at all, and is idempotent", () => {
    const bare = "{\n  \"name\": \"acme-bot\"\n}\n";

    expect(removePackageScript(bare, "setup")).toBe(bare);
    expect(removePackageScript(removePackageScript(packageFixture, "setup"), "setup"))
      .toBe(removePackageScript(packageFixture, "setup"));
  });
});

describe("applyTransform", () => {
  const context = {
    names: deriveWorkerNames("acme-bot"),
    project: { name: "acme-bot", description: "Answers questions in chat." },
    upstream: { templateRepository: "https://example.com/owner/repo" },
    provenance: { repository: "https://example.com/owner/repo", setupDate: "2026-09-18" },
  };

  /** One case per transform the plan can name, with the file each one targets. */
  const cases = [
    ["worker-names", wranglerFixture, (text) => expect(text).toContain("\"acme-bot-production\"")],
    ["package-identity", packageFixture, (text) =>
      expect(JSON.parse(text).name).toBe("acme-bot")],
    ["package-lock-identity", lockFixture, (text) =>
      expect(JSON.parse(text).version).toBe(PROJECT_INITIAL_VERSION)],
    ["coverage-floor", vitestFixture, (text) =>
      expect(text).toContain(`branches: ${COVERAGE_FLOOR}`)],
    ["template-links", "[a](using-this-template.md#x)", (text) =>
      expect(text).toContain("https://example.com/owner/repo/blob/main/docs/")],
    ["instruction-contract-section", versioningFixture, (text) =>
      expect(text).not.toContain("## Two version numbers")],
    ["provenance", packageFixture, (text) =>
      expect(JSON.parse(text).template.setupDate).toBe("2026-09-18")],
  ];

  it("applies every transform the plan can name", () => {
    for (const [name, text, assertion] of cases) {
      assertion(applyTransform(name, text, context));
    }

    expect(cases.map(([name]) => name).sort()).toEqual([...SETUP_TRANSFORMS.keys()].sort());
  });

  it("refuses a transform it does not know", () => {
    expect(() => applyTransform("reformat-everything", "", context))
      .toThrow(/reformat-everything/);
  });

  it("names only transforms it can apply", () => {
    // The plan is data; a rewrite entry naming a transform that does not exist
    // would fail halfway through a one-shot script.
    for (const { transform } of IDENTITY_REWRITES) {
      expect(SETUP_TRANSFORMS.has(transform)).toBe(true);
    }
  });
});

/** The sample manifest, extended with the parts `planProjectSetup` reads. */
const projectManifest = {
  ...manifest,
  templateRepository: "https://example.com/owner/repo",
  prune: [...manifest.prune, DEV_VARS_EXAMPLE],
};

/** The sample listing, extended with the files the identity rewrites target. */
const projectFiles = [
  ...files,
  DEV_VARS_EXAMPLE,
  ...IDENTITY_REWRITES.map(({ path }) => path),
];

/**
 * The index of the first operation matching a predicate, for order assertions.
 *
 * @param {Array<Record<string, unknown>>} plan
 * @param {(operation: Record<string, unknown>) => boolean} predicate
 * @returns {number}
 */
const positionOf = (plan, predicate) => plan.findIndex(predicate);

describe("planProjectSetup", () => {
  it("orders the whole run: copy, rewrite, swap, secrets, prune, provenance, remote, self", () => {
    const plan = planProjectSetup({ manifest: projectManifest, files: projectFiles });
    const copy = positionOf(plan, (operation) => operation.kind === "copy");
    const rewrite = positionOf(plan, (operation) => operation.kind === "rewrite");
    const swap = positionOf(plan, (operation) => operation.kind === "move");
    const devVars = positionOf(plan, (operation) => operation.kind === "copy-if-absent");
    const prune = positionOf(plan, (operation) => operation.reason === "prune");
    const provenance = positionOf(plan, (operation) => operation.transform === "provenance");
    const remote = positionOf(plan, (operation) => operation.kind === "add-remote");
    const self = positionOf(plan, (operation) => operation.reason === "self-delete");

    expect(copy).toBeGreaterThanOrEqual(0);
    expect(rewrite).toBeGreaterThan(copy);
    expect(swap).toBeGreaterThan(rewrite);
    expect(devVars).toBeGreaterThan(swap);
    expect(prune).toBeGreaterThan(devVars);
    expect(provenance).toBeGreaterThan(prune);
    expect(remote).toBeGreaterThan(provenance);
    expect(self).toBeGreaterThan(remote);
    expect(plan.at(-1).kind).toBe("remove-package-script");
  });

  it("copies the local secrets example before pruning it", () => {
    const plan = planProjectSetup({ manifest: projectManifest, files: projectFiles });
    const copied = positionOf(plan, (operation) => operation.kind === "copy-if-absent");
    const pruned = positionOf(plan, (operation) =>
      operation.kind === "delete" && operation.path === DEV_VARS_EXAMPLE);

    expect(plan[copied]).toEqual({
      kind: "copy-if-absent",
      from: DEV_VARS_EXAMPLE,
      to: DEV_VARS,
      existing: false,
    });
    expect(pruned).toBeGreaterThan(copied);
  });

  it("marks a .dev.vars that is already there, so no local secret is overwritten", () => {
    const plan = planProjectSetup({
      manifest: projectManifest,
      files: [...projectFiles, DEV_VARS],
    });

    expect(plan.find((operation) => operation.kind === "copy-if-absent").existing).toBe(true);
  });

  it("plans no secrets copy when the example is already gone", () => {
    const plan = planProjectSetup({
      manifest: projectManifest,
      files: projectFiles.filter((file) => file !== DEV_VARS_EXAMPLE),
    });

    expect(plan.some((operation) => operation.kind === "copy-if-absent")).toBe(false);
  });

  it("leaves an upstream remote that already exists alone", () => {
    const plan = planProjectSetup({
      manifest: projectManifest,
      files: projectFiles,
      hasUpstreamRemote: true,
    });

    expect(plan.find((operation) => operation.kind === "add-remote")).toEqual({
      kind: "add-remote",
      name: "upstream",
      url: `${projectManifest.templateRepository}.git`,
      skip: true,
    });
  });

  it("skips a rewrite whose file is not present", () => {
    const plan = planProjectSetup({
      manifest: projectManifest,
      files: projectFiles.filter((file) => file !== "wrangler.jsonc"),
    });

    expect(plan.some((operation) => operation.path === "wrangler.jsonc")).toBe(false);
    expect(plan.some((operation) => operation.transform === "coverage-floor")).toBe(true);
  });

  it("honours the instruction-file mode", () => {
    const plan = planProjectSetup({
      manifest: projectManifest,
      files: projectFiles,
      instructionMode: "keep",
    });

    expect(plan.some((operation) => operation.kind === "move")).toBe(false);
  });

  it("still plans the provenance and the rewrites after a half-finished run", () => {
    // Everything prunable is gone but the identity was never rewritten: the
    // second run has to plan the remaining work rather than throw.
    const plan = planProjectSetup({
      manifest: projectManifest,
      files: [...IDENTITY_REWRITES.map(({ path }) => path), PACKAGE_MANIFEST],
    });

    expect(plan.some((operation) => operation.transform === "provenance")).toBe(true);
    expect(plan.some((operation) => operation.kind === "delete")).toBe(false);
  });
});

describe("describeSetupPlan", () => {
  it("renders one line per operation, naming the file and the reason", () => {
    const plan = planProjectSetup({ manifest: projectManifest, files: projectFiles });
    const described = describeSetupPlan(plan);

    expect(described.split("\n")).toHaveLength(plan.length);
    expect(described).toContain(".template/README.md");
    expect(described).toContain("(prune)");
    expect(described).toContain(`${projectManifest.templateRepository}.git`);
    expect(described).toContain(".template/");
  });

  it("never renders the contents of a file, only its path", () => {
    const described = describeSetupPlan(planProjectSetup({
      manifest: projectManifest,
      files: projectFiles,
    }));

    expect(described).toContain(DEV_VARS);
    expect(described.split("\n").every((line) => line.length < 200)).toBe(true);
  });

  it("says when the upstream remote is left alone", () => {
    expect(describeSetupPlan([{ kind: "add-remote", name: "upstream", url: "x", skip: true }]))
      .toMatch(/already exists/);
  });

  it("refuses an operation it cannot describe", () => {
    expect(() => describeSetupPlan([{ kind: "reformat", path: "src/index.js" }]))
      .toThrow(/reformat/);
  });
});

describe("describeRemainingWork", () => {
  it("names the author, the human-only steps, and the GitHub companion", () => {
    const lines = describeRemainingWork({ author: "Ada Lovelace <ada@example.com>" }).join("\n");

    expect(lines).toContain("Ada Lovelace");
    expect(lines).toContain("LICENSE.md");
    expect(lines).toContain("Discord application");
    expect(lines).toContain("wrangler secret put");
    expect(lines).toContain("Interactions Endpoint URL");
    expect(lines).toContain("npm run setup:github");
  });

  it("says something sensible when the manifest names no author", () => {
    expect(describeRemainingWork({}).join("\n")).toContain("LICENSE.md");
  });

  it("names no secret value", () => {
    expect(describeRemainingWork({ author: "Ada" }).join("\n")).not.toMatch(/replace-me/);
  });
});

describe("setupListingSources", () => {
  it("collects every path an operation could touch", () => {
    const { paths } = setupListingSources(projectManifest);

    for (const path of [
      ...projectManifest.prune,
      ...projectManifest.copy.map((entry) => entry.from),
      ...projectManifest.selfDelete.paths,
      ...IDENTITY_REWRITES.map((entry) => entry.path),
      DEV_VARS,
      DEV_VARS_EXAMPLE,
      PACKAGE_MANIFEST,
    ]) {
      expect(paths).toContain(path);
    }

    expect(new Set(paths).size).toBe(paths.length);
  });

  it("walks a pruned directory but only reads a glob's own directory", () => {
    // A glob matches within one path segment, so its parent needs a shallow
    // read — and a glob with no slash resolves to `.`, which must never start
    // a recursive walk of the whole project.
    const { directories } = setupListingSources({
      ...projectManifest,
      pruneGlobs: [".changeset/*.md", "*.tmp"],
    });

    expect(directories).toContainEqual({ path: ".changeset", recursive: false });
    expect(directories).toContainEqual({ path: ".", recursive: false });
    expect(directories).toContainEqual({ path: ".template", recursive: true });
  });
});

describe("buildPlaceholderValues", () => {
  it("supplies a value for every token the payload declares", () => {
    expect(buildPlaceholderValues({
      project: { name: "acme-bot", description: "Answers questions in chat." },
      upstream: { repository: "https://example.com/owner/repo", version: "0.2.0" },
    })).toEqual({
      PROJECT_NAME: "acme-bot",
      PROJECT_DESCRIPTION: "Answers questions in chat.",
      TEMPLATE_REPOSITORY: "https://example.com/owner/repo",
      TEMPLATE_VERSION: "0.2.0",
    });
  });

  it("produces values a payload file can actually be substituted with", () => {
    const values = buildPlaceholderValues({
      project: { name: "acme-bot", description: "Answers questions in chat." },
      upstream: { repository: "https://example.com/owner/repo", version: "0.2.0" },
    });

    expect(substitutePlaceholders("# {{PROJECT_NAME}} — {{TEMPLATE_VERSION}}", values))
      .toBe("# acme-bot — 0.2.0");
  });
});
