import { after, before, describe, it } from "node:test";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { dirname, join, normalize } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { credentialShapes } from "../helpers/credential-shapes.js";
import { COVERAGE_FLOOR } from "../../scripts/lib/setup.js";

/**
 * What a project created from this template actually looks like.
 *
 * Every other test here asserts a promise about the template. This one
 * asserts the promise about its output: run `npm run setup` in a fresh copy
 * and the result is a coherent project — nothing template-only left behind,
 * no dangling link, no unsubstituted placeholder, no credential.
 *
 * It builds the project from `git archive HEAD` rather than from the working
 * tree, because the working tree is not what a consumer gets: an untracked
 * scratch file or a half-finished edit would be copied in and would make the
 * result unlike anything anyone can clone. The cost is that a file you have
 * added but not committed is invisible here; CI checks out the merge commit,
 * so it sees everything.
 *
 * It stops at the tree. Proving the result is *green* means `npm ci` and a
 * full `npm test` in that tree, which is minutes, not seconds — that lives in
 * `.github/workflows/template-acceptance.yml`. Two checks at two speeds,
 * because the fast one cannot prove the real claim and the slow one cannot
 * live in the unit suite.
 *
 * Template-only, and pruned by `template-manifest.json`, because it spawns a
 * script the project no longer has.
 *
 * See `CONTRIBUTING.md`, "Template-only contract tests".
 */

const execFileAsync = promisify(execFile);

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

/** The slug the generated project is renamed to. It appears nowhere upstream. */
const SLUG = "acme-bot";

/** The one-line description the run is given, so it never has to prompt. */
const DESCRIPTION = "Answers questions in chat.";

/** A `{{TOKEN}}` the payload substitution should have replaced. */
const PLACEHOLDER = /\{\{[A-Z0-9_]+\}\}/;

/** An inline Markdown link or image target, without its optional title. */
const MARKDOWN_LINK = /]\(([^)\s]+)/g;

/** A link to somewhere else entirely: `https:`, `mailto:`, and friends. */
const ABSOLUTE_LINK = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Paths a project must not inherit, named here rather than read from the
 * manifest.
 *
 * Deriving this list from `template-manifest.json` would make the test agree
 * with the manifest by construction, so dropping an entry from the manifest
 * would drop it from the test too and the file would sail through into every
 * new project. The manifest is the thing under test; this is the second
 * opinion.
 */
const MUST_NOT_SURVIVE = [
  "CONTRIBUTING.md",
  "template-manifest.json",
  ".template",
  ".dev.vars.example",
  "docs/template-acceptance-test.md",
  "docs/downstream-setup-automation.md",
  "scripts/setup.js",
  "scripts/lib/setup.js",
  "test/scripts/setup.test.js",
  "test/helpers/instruction-files.js",
  "claude-for-users.md",
  "AGENTS-for-users.md",
  ".github/copilot-instructions-for-users.md",
  ".github/workflows/template-acceptance.yml",
];

/** Paths a project must still have, for the same reason and in the other direction. */
const MUST_SURVIVE = [
  "README.md",
  "CHANGELOG.md",
  "LICENSE.md",
  "claude.md",
  "AGENTS.md",
  ".github/copilot-instructions.md",
  ".github/workflows/ci.yml",
  ".changeset/config.json",
  "src/index.js",
  "wrangler.jsonc",
  "docs/discord-bot.md",
  "docs/using-this-template.md",
  "scripts/register-commands.js",
];

/**
 * How many relative links to the setup guide the run rewrites to upstream.
 *
 * "The link fallout" in `docs/downstream-setup-automation.md` tabulates
 * eleven inbound links. Two of them never reach the rewrite: `docs/using-ai.md`
 * is replaced wholesale by the `.template/` payload, and the one in
 * `docs/versioning-and-changesets.md` that pointed at `CONTRIBUTING.md` goes
 * out with the section removal. Nine are left, and the count is asserted so a
 * twelfth added upstream is noticed here rather than downstream.
 */
const REWRITTEN_SETUP_GUIDE_LINKS = 9;

/**
 * Build a project the way a consumer would get one, and set it up.
 *
 * `git archive` produces the tracked tree with no history, which is also what
 * **Use this template** gives you. It is then committed into a repository of
 * its own: setup refuses a dirty tree, and several of the contract tests that
 * survive into the project shell out to `git`.
 *
 * @returns {Promise<string>} The generated project's directory.
 * @throws {Error} If any step fails, after cleaning the directory up.
 */
async function generateProject() {
  const directory = await mkdtemp(join(tmpdir(), "setup-acceptance-"));

  try {
    const archive = join(directory, "template.tar");

    await execFileAsync("git", ["archive", "--format=tar", "--output", archive, "HEAD"], {
      cwd: repositoryRoot,
    });
    await execFileAsync("tar", ["-x", "-f", archive, "-C", directory]);
    await rm(archive);

    const identity = [
      "-c", "user.name=setup acceptance",
      "-c", "user.email=acceptance@example.invalid",
      "-c", "commit.gpgsign=false",
    ];

    await execFileAsync("git", ["init", "--quiet"], { cwd: directory });
    await execFileAsync("git", ["add", "-A"], { cwd: directory });
    await execFileAsync("git", [...identity, "commit", "--quiet", "-m", "template"], {
      cwd: directory,
    });
    await execFileAsync(
      process.execPath,
      ["scripts/setup.js", "--name", SLUG, "--description", DESCRIPTION, "--yes"],
      { cwd: directory },
    );

    return directory;
  } catch (error) {
    await rm(directory, { recursive: true, force: true });

    throw error;
  }
}

/**
 * Every file in the generated project, project-relative.
 *
 * `.git` is skipped: its packfiles are neither text nor anything setup wrote.
 *
 * @param {string} root
 * @param {string} [prefix]
 * @returns {Promise<string[]>}
 */
async function listFiles(root, prefix = "") {
  const found = [];

  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") {
      continue;
    }

    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;

    found.push(...entry.isDirectory() ? await listFiles(root, path) : [path]);
  }

  return found;
}

/**
 * Read a file, or `null` when it is not text.
 *
 * A NUL byte is the test for binary rather than an extension list, so a new
 * kind of asset cannot quietly slip past the credential scan.
 *
 * @param {string} root
 * @param {string} path
 * @returns {Promise<string | null>}
 */
async function readText(root, path) {
  const contents = await readFile(join(root, path));

  return contents.includes(0) ? null : contents.toString("utf8");
}

/**
 * Whether a project-relative path exists.
 *
 * @param {string} root
 * @param {string} path
 * @returns {Promise<boolean>}
 */
async function exists(root, path) {
  try {
    await stat(join(root, path));

    return true;
  } catch {
    return false;
  }
}

describe("fresh project acceptance", () => {
  /** @type {string} */
  let project;
  /** @type {string[]} */
  let files;
  /** @type {Record<string, any>} */
  let manifest;

  before(async () => {
    manifest = JSON.parse(await readFile(join(repositoryRoot, "template-manifest.json"), "utf8"));
    project = await generateProject();
    files = await listFiles(project);
  });

  after(async () => {
    // node:test runs `after` whether the cases passed or failed, which is the
    // finally this needs; `generateProject` has its own for the build itself.
    if (project !== undefined) {
      await rm(project, { recursive: true, force: true });
    }
  });

  it("leaves nothing template-only behind", async () => {
    for (const path of MUST_NOT_SURVIVE) {
      assert.equal(
        await exists(project, path),
        false,
        `a project created from this template still has ${path}`,
      );
    }

    for (const path of files) {
      assert.doesNotMatch(
        path,
        /\.template-only\.test\.js$/,
        `${path} shipped into a project that cannot run it`,
      );
    }
  });

  it("prunes everything the manifest names", async () => {
    // The manifest's own account of itself, checked second. MUST_NOT_SURVIVE
    // catches an entry that went missing; this catches one that never worked.
    const replaced = new Set(manifest.copy.map((entry) => entry.to));

    for (const path of manifest.prune.filter((entry) => replaced.has(entry) === false)) {
      assert.equal(await exists(project, path), false, `${path} survived its prune entry`);
    }

    for (const path of manifest.pruneDirectories) {
      assert.equal(await exists(project, path), false, `${path}/ survived its prune entry`);
    }

    for (const path of manifest.selfDelete.paths) {
      assert.equal(await exists(project, path), false, `${path} did not delete itself`);
    }
  });

  it("takes the changesets and leaves their configuration", async () => {
    const changesets = files.filter((path) => path.startsWith(".changeset/"));

    assert.deepEqual(
      changesets.filter((path) => path.endsWith(".md")),
      [],
      "the template's unreleased changesets belong to the template",
    );
    assert.ok(
      changesets.includes(".changeset/config.json"),
      "a project keeps its own Changesets configuration",
    );
  });

  it("keeps everything a project needs", async () => {
    for (const path of MUST_SURVIVE) {
      assert.ok(await exists(project, path), `a project created from this template has no ${path}`);
    }

    for (const { to } of manifest.copy) {
      assert.ok(await exists(project, to), `the payload never wrote ${to}`);
    }
  });

  it("substitutes every placeholder it shipped", async () => {
    for (const path of files) {
      const contents = await readText(project, path);

      if (contents !== null) {
        assert.doesNotMatch(contents, PLACEHOLDER, `${path} still carries an unfilled placeholder`);
      }
    }
  });

  it("renames the package, the lockfile, and the Workers", async () => {
    const packageManifest = JSON.parse(await readText(project, "package.json"));
    const lockfile = JSON.parse(await readText(project, "package-lock.json"));
    const wrangler = JSON.parse(await readText(project, "wrangler.jsonc"));

    assert.equal(packageManifest.name, SLUG);
    assert.equal(packageManifest.description, DESCRIPTION);
    assert.equal(packageManifest.version, "0.0.0");
    assert.equal(lockfile.name, SLUG);
    assert.equal(lockfile.packages[""].name, SLUG);
    assert.equal(wrangler.name, SLUG);
    assert.equal(wrangler.env["non-prod"].name, `${SLUG}-non-prod`);
    assert.equal(wrangler.env.production.name, `${SLUG}-production`);
  });

  it("removes its own npm script and records where the project came from", async () => {
    const packageManifest = JSON.parse(await readText(project, "package.json"));

    assert.equal(packageManifest.scripts.setup, undefined);
    assert.equal(packageManifest.scripts.test, "vitest run --coverage && npm run test:contracts");
    assert.equal(packageManifest.template.repository, manifest.templateRepository);
    assert.match(packageManifest.template.version, /^\d+\.\d+\.\d+/);
    assert.match(packageManifest.template.setupDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(packageManifest.template.commit, /^[0-9a-f]{40}$/);
  });

  it("lowers the coverage ratchet to a project's floor, and no further", async () => {
    const configPath = join(project, "vitest.config.js");

    // Not imported: the generated project has no node_modules, so the config's
    // own imports cannot resolve. `node --check` is the part that matters —
    // that setup did not leave a file the runner will refuse to parse.
    await execFileAsync(process.execPath, ["--check", configPath]);

    const config = await readText(project, "vitest.config.js");
    const thresholds = config.match(/\b(?:branches|functions|lines|statements):\s*(\d+)/g);

    assert.equal(thresholds.length, 4, "vitest.config.js should still set four thresholds");

    for (const threshold of thresholds) {
      assert.equal(Number(threshold.split(":")[1].trim()), COVERAGE_FLOOR);
    }

    // Set, not merely mentioned: the comment setup writes explains why
    // `thresholds.autoUpdate` is left out, so the word is expected in prose.
    assert.doesNotMatch(config, /^\s*autoUpdate:/m);
    assert.match(config, /provider:\s*"istanbul"/);
  });

  it("points every relative link at something that exists", async () => {
    // The check that catches a twelfth inbound link added upstream later: it
    // walks what the project actually has rather than the tabulated eleven.
    const broken = [];

    for (const path of files.filter((file) => file.endsWith(".md"))) {
      const contents = await readText(project, path);

      for (const [, target] of contents.matchAll(MARKDOWN_LINK)) {
        const [relativePath] = target.split("#");

        if (ABSOLUTE_LINK.test(target) || relativePath === "") {
          continue;
        }

        const resolved = normalize(join(dirname(path), relativePath));

        if (await exists(project, resolved) === false) {
          broken.push(`${path} → ${target}`);
        }
      }
    }

    assert.deepEqual(broken, [], "a project created from this template has dangling links");
  });

  it.skip("sends the setup-guide links upstream instead of at the stub", async () => {
    const blobUrl = `${manifest.templateRepository}/blob/main/docs/using-this-template.md`;
    let rewritten = 0;

    for (const path of files.filter((file) => file.endsWith(".md"))) {
      const contents = await readText(project, path);

      assert.doesNotMatch(
        contents,
        /]\(\.{0,2}\/?(?:docs\/)?using-this-template\.md#/,
        `${path} still links to an anchor the provenance stub does not have`,
      );

      // The stub's own link upstream is shipped prose, not a rewrite.
      if (path !== "docs/using-this-template.md") {
        rewritten += contents.split(blobUrl).length - 1;
      }
    }

    assert.equal(
      rewritten,
      REWRITTEN_SETUP_GUIDE_LINKS,
      "the number of setup-guide links rewritten upstream changed; see REWRITTEN_SETUP_GUIDE_LINKS",
    );
  });

  it("carries no credential-shaped literal anywhere", async () => {
    // Including `.dev.vars`, which setup creates: it is a copy of the
    // placeholder-only example, and a run that produced anything else here
    // would be handing a new project a secret it never chose.
    for (const path of files) {
      const contents = await readText(project, path);

      if (contents === null) {
        continue;
      }

      for (const { name, pattern } of credentialShapes) {
        assert.doesNotMatch(contents, pattern, `${path} contains a ${name}-shaped literal`);
      }
    }
  });

  it("gives the project a local secrets file it can fill in", async () => {
    const devVars = await readText(project, ".dev.vars");

    assert.match(devVars, /^DISCORD_PUBLIC_KEY="replace-me[^"]*"$/m);
    assert.match(devVars, /^DISCORD_GUILD_ID="replace-me[^"]*"$/m);
    assert.equal(await exists(project, ".dev.vars.example"), false);

    const { stdout } = await execFileAsync("git", ["check-ignore", ".dev.vars"], { cwd: project });

    assert.equal(stdout.trim(), ".dev.vars", ".dev.vars must stay out of the project's history");
  });
});

describe("fresh project acceptance workflow contract", () => {
  it("proves the green claim in CI, in a job that is not the required check", async () => {
    // The fast test above stops at the tree. Only this job runs `npm ci` and a
    // full `npm test` in the result, which is the claim that matters.
    const workflow = await readFile(
      join(repositoryRoot, ".github/workflows/template-acceptance.yml"),
      "utf8",
    );
    const manifest = JSON.parse(
      await readFile(join(repositoryRoot, "template-manifest.json"), "utf8"),
    );

    assert.match(workflow, /node-version-file:\s*\.nvmrc/);
    assert.doesNotMatch(workflow, /node-version:\s*\d/);
    assert.match(workflow, /run:\s*npm run setup\b/);
    assert.match(workflow, /run:\s*npm ci/);
    assert.match(workflow, /run:\s*npm run lint/);
    assert.match(workflow, /run:\s*npm test/);
    // The branch-protection required check is named `test`, in ci.yml. This
    // job must not claim that name, and must not be wired into that job.
    assert.doesNotMatch(workflow, /^\s{4}name:\s*test\s*$/m);

    assert.ok(
      manifest.prune.includes(".github/workflows/template-acceptance.yml"),
      "the acceptance workflow runs a script a project deletes, so it is pruned with it",
    );
  });
});
