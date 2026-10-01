import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  COVERAGE_FLOOR,
  PROJECT_INITIAL_VERSION,
  deriveWorkerNames,
  removeInstructionContractSection,
  rewriteCoverageThresholds,
  rewritePackageLock,
  rewritePackageManifest,
  rewriteTemplateLinks,
  rewriteWranglerNames,
  substitutePlaceholders,
} from "../../scripts/lib/setup.js";

/**
 * The identity transforms, run against the repository's real files.
 *
 * `test/scripts/setup.test.js` covers the branches with miniature fixtures.
 * This file exists for the other failure mode: a transform keys on a piece of
 * text — a comment, a heading, a JSON key at a known indentation — and an
 * upstream edit moves it. A fixture-only suite stays green while
 * `npm run setup` quietly stops rewriting something. Every case here therefore
 * reads the actual file the transform targets.
 *
 * Template-only, and pruned by `template-manifest.json`, because it imports
 * `scripts/lib/setup.js` — which the setup script deletes as its last act.
 *
 * See `CONTRIBUTING.md`, "Template-only contract tests".
 */

const execFileAsync = promisify(execFile);

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Read a repository-relative file.
 *
 * @param {string} path
 * @returns {Promise<string>}
 */
const read = (path) => readFile(join(repositoryRoot, path), "utf8");

const manifest = JSON.parse(await read("template-manifest.json"));

/** The slug every case renames to. Chosen to appear nowhere in the repository. */
const SLUG = "acme-bot";

const names = deriveWorkerNames(SLUG);

describe("wrangler identity rewrite", () => {
  const path = "wrangler.jsonc";

  it("renames all three Workers in the real configuration", async () => {
    const original = await read(path);
    const rewritten = JSON.parse(rewriteWranglerNames(original, names));

    assert.equal(rewritten.name, names.base);
    assert.equal(rewritten.env["non-prod"].name, names.nonProd);
    assert.equal(rewritten.env.production.name, names.production);
  });

  it("produces names the environment-isolation contract accepts", async () => {
    // The assertions test/contracts/environment-isolation.test.js makes, run
    // against the file setup would leave behind rather than the one here.
    const rewritten = JSON.parse(rewriteWranglerNames(await read(path), names));
    const all = [rewritten.name, rewritten.env["non-prod"].name, rewritten.env.production.name];

    for (const name of all) {
      assert.match(name, /\S/);
      assert.ok(name.length <= 63, `${name} exceeds the workers.dev name limit`);
    }

    assert.equal(new Set(all).size, all.length, "Worker names must be unique");
    assert.ok(rewritten.env["non-prod"].name.includes("non-prod"));
    assert.ok(rewritten.env.production.name.includes("production"));
  });

  it("changes nothing else in the file, byte for byte", async () => {
    const original = await read(path);
    const rewritten = rewriteWranglerNames(original, names);

    assert.equal(rewritten.replaceAll(SLUG, "cloudflare-workers-discord-template"), original);
  });

  it("leaves the compatibility date, observability, and secrets untouched", async () => {
    const original = JSON.parse(await read(path));
    const rewritten = JSON.parse(rewriteWranglerNames(await read(path), names));

    assert.equal(rewritten.compatibility_date, original.compatibility_date);
    assert.deepEqual(rewritten.observability, original.observability);
    assert.deepEqual(rewritten.secrets, original.secrets);
    assert.deepEqual(rewritten.env["non-prod"].secrets, original.env["non-prod"].secrets);
    assert.deepEqual(rewritten.env.production.secrets, original.env.production.secrets);
  });

  it("is idempotent against the real file", async () => {
    const once = rewriteWranglerNames(await read(path), names);

    assert.equal(rewriteWranglerNames(once, names), once);
  });
});

describe("package identity rewrite", () => {
  const project = { name: SLUG, description: "Answers questions in chat." };

  it("rewrites only the project's identity in the real package.json", async () => {
    const original = JSON.parse(await read("package.json"));
    const rewritten = JSON.parse(rewritePackageManifest(await read("package.json"), project));
    const expected = {
      ...original,
      name: project.name,
      description: project.description,
      version: "0.0.0",
      keywords: original.keywords.filter((keyword) =>
        keyword !== "template" && keyword !== "boilerplate"),
    };

    delete expected.scripts.setup;

    assert.deepEqual(rewritten, expected);
    assert.deepEqual(Object.keys(rewritten), Object.keys(original), "key order must survive");
  });

  it("keeps the Discord keywords and drops the template ones", async () => {
    const rewritten = JSON.parse(rewritePackageManifest(await read("package.json"), project));

    for (const keyword of ["discord", "discord-bot", "slash-commands", "cloudflare"]) {
      assert.ok(rewritten.keywords.includes(keyword), `${keyword} must survive`);
    }

    for (const keyword of ["template", "boilerplate"]) {
      assert.ok(rewritten.keywords.includes(keyword) === false, `${keyword} must not survive`);
    }
  });

  it("leaves the template author's name and license in place", async () => {
    // Setup warns about these rather than rewriting them; a script that
    // reassigns a copyright holder is doing something it was not asked to.
    const original = JSON.parse(await read("package.json"));
    const rewritten = JSON.parse(rewritePackageManifest(await read("package.json"), project));

    assert.equal(rewritten.author, original.author);
    assert.equal(rewritten.license, original.license);
  });

  it("is idempotent against the real file", async () => {
    const once = rewritePackageManifest(await read("package.json"), project);

    assert.equal(rewritePackageManifest(once, project), once);
  });

  it("changes four lines of the real lockfile and no others", async () => {
    // The lockfile is npm's to format and holds a `name` and a `version` for
    // every dependency. Exactly four lines may differ: the project's own two
    // names and its own two versions.
    const original = await read("package-lock.json");
    const lines = original.split("\n");
    const rewritten = rewritePackageLock(original, { name: SLUG }).split("\n");
    const changed = lines
      .map((line, index) => [line, rewritten[index]])
      .filter(([before, after]) => before !== after);

    assert.equal(rewritten.length, lines.length, "the rewrite must not add or remove a line");
    assert.deepEqual(changed.map(([, after]) => after.trim()), [
      `"name": "${SLUG}",`,
      `"version": "${PROJECT_INITIAL_VERSION}",`,
      `"name": "${SLUG}",`,
      `"version": "${PROJECT_INITIAL_VERSION}",`,
    ]);
  });

  it("keeps the real lockfile and the real manifest agreeing on a version", async () => {
    // test/contracts/versioning.test.js ships downstream and compares the two.
    // A rename that left the template's version in the lockfile would fail a
    // new project's first `npm test`.
    const lock = JSON.parse(rewritePackageLock(await read("package-lock.json"), { name: SLUG }));
    const manifestText = rewritePackageManifest(await read("package.json"), {
      name: SLUG,
      description: "Answers questions.",
    });

    assert.equal(lock.version, JSON.parse(manifestText).version);
    assert.equal(lock.packages[""].version, JSON.parse(manifestText).version);
  });

  it("keeps the lockfile rewrite idempotent", async () => {
    const once = rewritePackageLock(await read("package-lock.json"), { name: SLUG });

    assert.equal(rewritePackageLock(once, { name: SLUG }), once);
  });
});

describe("coverage threshold rewrite", () => {
  const path = "vitest.config.js";

  it("lowers the real ratchet to the floor", async () => {
    const rewritten = rewriteCoverageThresholds(await read(path));

    for (const metric of ["branches", "functions", "lines", "statements"]) {
      assert.match(
        rewritten,
        new RegExp(`\\n\\s*${metric}: ${COVERAGE_FLOOR},`),
        `${metric} must be rewritten to the floor`,
      );
    }

    // What test/contracts/coverage.test.js asserts about the result: four
    // numbers, all above zero, with autoUpdate still absent.
    assert.ok(COVERAGE_FLOOR > 0);
    assert.ok(rewritten.includes("autoUpdate:") === false, "the setting must stay absent");
  });

  it("replaces the maintainer's ratchet comment", async () => {
    const original = await read(path);
    const rewritten = rewriteCoverageThresholds(original);

    assert.ok(original.includes("A ratchet, not an aspiration"), "the anchor comment moved");
    assert.ok(rewritten.includes("A ratchet, not an aspiration") === false);
    assert.ok(rewritten.includes("A floor, not a ratchet"));
  });

  it("leaves the provider and include patterns the Workers pool needs", async () => {
    const rewritten = rewriteCoverageThresholds(await read(path));

    assert.match(rewritten, /provider: "istanbul"/);
    assert.match(rewritten, /include: \["src\/\*\*\/\*\.js", "scripts\/lib\/\*\*\/\*\.js"\]/);
  });

  it("is idempotent against the real file", async () => {
    const once = rewriteCoverageThresholds(await read(path));

    assert.equal(rewriteCoverageThresholds(once), once);
  });
});

describe("payload placeholder substitution", () => {
  /** A value per declared placeholder, so substitution has nothing to miss. */
  const values = Object.fromEntries(
    Object.keys(manifest.placeholders).map((token) => [token, `substituted-${token}`]),
  );

  it("substitutes every token in every payload file", async () => {
    const { stdout } = await execFileAsync("git", ["ls-files", "-z", ".template"], {
      cwd: repositoryRoot,
    });
    const payloadFiles = stdout.split("\0").filter(Boolean);

    assert.ok(payloadFiles.length > 0, "the payload directory must not be empty");

    for (const file of payloadFiles) {
      const substituted = substitutePlaceholders(await read(file), values);

      assert.ok(substituted.includes("{{") === false, `${file} still carries a placeholder`);
      assert.equal(substitutePlaceholders(substituted, values), substituted, "not idempotent");
    }
  });

  it("refuses a payload file when a declared placeholder has no value", async () => {
    // Dropping a value from the manifest's placeholder set must fail the run,
    // not ship a README that greets the reader with {{PROJECT_NAME}}.
    const [token] = Object.keys(manifest.placeholders);
    const incomplete = { ...values };

    delete incomplete[token];

    const users = await Promise.all(
      manifest.copy.map(async ({ from }) => [from, await read(from)]),
    );
    const [file, contents] = users.find(([, text]) => text.includes(`{{${token}}}`));

    assert.throws(
      () => substitutePlaceholders(contents, incomplete),
      new RegExp(`\\{\\{${token}\\}\\}`),
      `${file} should have failed without a value for ${token}`,
    );
  });
});

/**
 * Where a relative link to the setup guide survives, and how many times.
 *
 * Eleven locations are affected by pruning the two maintainer documents: these
 * ten links, plus the one `../CONTRIBUTING.md` link inside the section
 * `removeInstructionContractSection` deletes. Asserting the count per file is
 * what makes a future doc edit that adds an eleventh link visible here rather
 * than in somebody's generated project.
 */
const SETUP_GUIDE_LINKS = {
  "docs/discord-bot.md": 6,
  "docs/gitflow-and-branching.md": 2,
  "docs/versioning-and-changesets.md": 1,
  "docs/using-ai.md": 1,
};

describe("setup guide link rewrite", () => {
  const upstream = { templateRepository: manifest.templateRepository };
  const blob = `${manifest.templateRepository}/blob/main/docs/using-this-template.md`;

  it("rewrites exactly the links the plan accounts for", async () => {
    let total = 0;

    for (const [path, expected] of Object.entries(SETUP_GUIDE_LINKS)) {
      const { text, rewritten } = rewriteTemplateLinks(await read(path), upstream);

      assert.equal(rewritten, expected, `${path} rewrote ${rewritten} links, expected ${expected}`);
      assert.ok(
        text.includes("](using-this-template.md") === false,
        `${path} still points at the pruned setup guide`,
      );

      total += rewritten;
    }

    assert.equal(total, 10, "ten setup-guide links, plus one CONTRIBUTING.md link removed");
  });

  it("keeps each anchor attached to the upstream URL", async () => {
    const { text } = rewriteTemplateLinks(await read("docs/gitflow-and-branching.md"), upstream);

    assert.ok(text.includes(`${blob}#6-configure-branch-protection`));
  });

  it("leaves links to surviving documents alone", async () => {
    const { text } = rewriteTemplateLinks(await read("docs/gitflow-and-branching.md"), upstream);

    assert.ok(text.includes("](versioning-and-changesets.md)"));
  });

  it("is idempotent against every affected document", async () => {
    for (const path of Object.keys(SETUP_GUIDE_LINKS)) {
      const { text } = rewriteTemplateLinks(await read(path), upstream);

      assert.deepEqual(rewriteTemplateLinks(text, upstream), { text, rewritten: 0 }, path);
    }
  });
});

describe("instruction contract section removal", () => {
  const path = "docs/versioning-and-changesets.md";

  it("removes the section that only makes sense upstream", async () => {
    const original = await read(path);

    assert.ok(original.includes("## Two version numbers"), "the anchor heading moved");

    const rewritten = removeInstructionContractSection(original);

    assert.ok(rewritten.includes("## Two version numbers") === false);
    assert.ok(rewritten.includes("Instruction contract version") === false);
    assert.ok(rewritten.includes("../CONTRIBUTING.md") === false, "the last CONTRIBUTING link");
  });

  it("leaves the rest of the document intact", async () => {
    const original = await read(path);
    const rewritten = removeInstructionContractSection(original);

    for (const heading of ["## Deployment is separate", "## What every release should state"]) {
      assert.ok(rewritten.includes(heading), `${heading} must survive`);
    }

    assert.ok(rewritten.length < original.length);
    assert.ok(rewritten.endsWith("\n"));
  });

  it("removes the document's only link to a pruned maintainer file", async () => {
    // CONTRIBUTING.md is pruned, so any surviving link to it would be dead.
    const rewritten = removeInstructionContractSection(await read(path));
    const { text } = rewriteTemplateLinks(rewritten, {
      templateRepository: manifest.templateRepository,
    });

    for (const pruned of manifest.prune.filter((entry) => entry.endsWith(".md"))) {
      const relative = pruned.startsWith("docs/") ? pruned.slice("docs/".length) : `../${pruned}`;

      assert.ok(
        text.includes(`](${relative})`) === false && text.includes(`](${relative}#`) === false,
        `${path} links to ${pruned}, which the setup script deletes`,
      );
    }
  });

  it("is idempotent against the real file", async () => {
    const once = removeInstructionContractSection(await read(path));

    assert.equal(removeInstructionContractSection(once), once);
  });
});
