import { readFile, readdir, stat } from "node:fs/promises";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { join, dirname } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { credentialShapes } from "../helpers/credential-shapes.js";
import { buildPlaceholderValues, planSetup, resolvePruneGlobs } from "../../scripts/lib/setup.js";

/**
 * The `template-manifest.json` and `.template/` audit.
 *
 * This whole file is template-only, rather than a shipped test with a
 * tolerated-absence branch, because every promise in it is about two things a
 * project no longer has: the manifest prunes itself and the payload directory
 * on the way out. A shipped version would be a file whose every assertion is
 * vacuous downstream — something a reader of a new project has to open and
 * reason about before discovering it guards nothing.
 *
 * What ships instead already exists: `discord.test.js` scans every tracked
 * file for credential shapes, which covers `.template/` and the manifest while
 * they are here, and Iteration 5's acceptance test asserts the outcome — that
 * a project created from this template carries none of this.
 *
 * See `CONTRIBUTING.md`, "Template-only contract tests".
 */

const execFileAsync = promisify(execFile);

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const manifestPath = join(repositoryRoot, "template-manifest.json");
const payloadDirectory = ".template";

/** A `{{TOKEN}}` in a payload file. */
const placeholderPattern = /\{\{([A-Z0-9_]+)\}\}/g;

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

const { stdout } = await execFileAsync("git", ["ls-files", "-z"], { cwd: repositoryRoot });
const trackedFiles = stdout.split("\0").filter(Boolean);

/**
 * Whether a repository-relative path exists on disk.
 *
 * @param {string} path
 * @returns {Promise<boolean>}
 */
const exists = async (path) => {
  try {
    await stat(join(repositoryRoot, path));

    return true;
  } catch {
    return false;
  }
};

/** Every file under `.template/`, repository-relative. */
const payloadFiles = trackedFiles.filter((file) => file.startsWith(`${payloadDirectory}/`));

describe("template manifest contract", () => {
  it("names only files this repository actually has", async () => {
    // The failure mode that matters: a file gets renamed upstream and the
    // manifest keeps pointing at the old path, so the setup script silently
    // stops pruning it.
    const declared = [
      ...manifest.prune,
      ...manifest.copy.map((entry) => entry.from),
      ...manifest.copy.map((entry) => entry.to),
      ...manifest.pruneDirectories,
      ...manifest.instructionFiles.flatMap(({ maintainer, downstream }) =>
        [maintainer, downstream]),
    ];

    for (const path of declared) {
      assert.ok(await exists(path), `template-manifest.json names ${path}, which does not exist`);
    }
  });

  it("resolves every glob against something", async () => {
    for (const glob of manifest.pruneGlobs) {
      assert.ok(
        resolvePruneGlobs([glob], trackedFiles).length > 0,
        `pruneGlobs entry ${glob} matches nothing; a glob that matches nothing is a typo`,
      );
    }

    // The changesets survive as files only until a release; the configuration
    // beside them is a project's own and must not be swept up with them.
    assert.ok(resolvePruneGlobs(manifest.pruneGlobs, trackedFiles)
      .includes(".changeset/config.json") === false);
  });

  it("prunes itself, the payload, and this plan", async () => {
    for (const path of ["template-manifest.json", "docs/downstream-setup-automation.md"]) {
      assert.ok(manifest.prune.includes(path), `template-manifest.json must prune ${path}`);
    }

    assert.ok(manifest.pruneDirectories.includes(payloadDirectory));
  });

  it("prunes every template-only contract test", async () => {
    // The standing rule in CONTRIBUTING.md, enforced: a `.template-only` file
    // that nobody added to the manifest ships to a project that cannot pass it.
    const contracts = await readdir(join(repositoryRoot, "test/contracts"));

    for (const file of contracts.filter((name) => name.endsWith(".template-only.test.js"))) {
      const path = `test/contracts/${file}`;

      assert.ok(manifest.prune.includes(path), `template-manifest.json must prune ${path}`);
    }
  });

  it("names the setup script's own files for deletion", async () => {
    assert.deepEqual([...manifest.selfDelete.paths].sort(), [
      "scripts/lib/setup.js",
      "scripts/setup.js",
      "test/scripts/setup.test.js",
    ]);
    assert.deepEqual(manifest.selfDelete.packageScripts, ["setup"]);

    for (const path of manifest.selfDelete.paths) {
      assert.ok(await exists(path), `template-manifest.json names ${path}, which does not exist`);
    }
  });
});

describe("template payload contract", () => {
  it("gives every payload file exactly one destination", async () => {
    const sources = manifest.copy.map((entry) => entry.from);

    assert.deepEqual(
      [...sources].sort(),
      [...payloadFiles].sort(),
      "every file under .template/ must be copied somewhere, and every copy source must exist",
    );
    assert.equal(new Set(sources).size, sources.length, "a payload file may be copied once");

    const destinations = manifest.copy.map((entry) => entry.to);
    assert.equal(
      new Set(destinations).size,
      destinations.length,
      "two payload files may not write to the same destination",
    );
  });

  it("writes every destination into a directory that exists", async () => {
    for (const { to } of manifest.copy) {
      const parent = dirname(to);

      assert.ok(
        await exists(parent),
        `.template payload writes ${to}, but ${parent} does not exist`,
      );
    }
  });

  it("uses exactly the placeholders it declares", async () => {
    const declared = new Set(Object.keys(manifest.placeholders));
    const used = new Set();

    for (const file of payloadFiles) {
      const contents = await readFile(join(repositoryRoot, file), "utf8");

      for (const [, token] of contents.matchAll(placeholderPattern)) {
        assert.ok(
          declared.has(token),
          `${file} uses {{${token}}}, which template-manifest.json does not declare`,
        );
        used.add(token);
      }
    }

    for (const token of declared) {
      assert.ok(
        used.has(token),
        `template-manifest.json declares {{${token}}}, which no payload file uses`,
      );
    }
  });

  it("has a value for every placeholder it declares", async () => {
    // The manifest declares the tokens and the setup script supplies them.
    // A token added to one side and not the other either stops the run —
    // `substitutePlaceholders` refuses a leftover — or leaves a value nothing
    // uses, so the two lists are asserted equal rather than merely compatible.
    const supplied = buildPlaceholderValues({
      project: { name: "acme-bot", description: "Answers questions in chat." },
      upstream: { repository: manifest.templateRepository, version: "0.0.0" },
    });

    assert.deepEqual(Object.keys(supplied).sort(), Object.keys(manifest.placeholders).sort());

    for (const [token, value] of Object.entries(supplied)) {
      assert.ok(typeof value === "string" && value.length > 0, `{{${token}}} has no value`);
    }
  });

  it("describes what each placeholder is for", async () => {
    for (const [token, description] of Object.entries(manifest.placeholders)) {
      assert.equal(typeof description, "string", `{{${token}}} needs a description`);
      assert.ok(description.length > 0, `{{${token}}} needs a description`);
    }
  });

  it("carries no credential-shaped literal", async () => {
    // Narrower than `discord.test.js`'s repository-wide scan and deliberately
    // duplicated at this scope: the payload becomes a project's documentation,
    // so a pasted value here would be copied into a new repository.
    for (const file of [...payloadFiles, "template-manifest.json"]) {
      const contents = await readFile(join(repositoryRoot, file), "utf8");

      for (const { name, pattern } of credentialShapes) {
        assert.doesNotMatch(contents, pattern, `${file} contains a ${name}-shaped literal`);
      }
    }
  });

  it("points at no document the setup script prunes", async () => {
    // A pruned path that the payload also writes to is replaced, not removed,
    // so it is still a link a reader can follow.
    const replaced = new Set(manifest.copy.map((entry) => entry.to));
    const pruned = new Set(manifest.prune.filter((path) => replaced.has(path) === false));

    for (const file of payloadFiles) {
      const contents = await readFile(join(repositoryRoot, file), "utf8");
      const destination = manifest.copy.find((entry) => entry.from === file).to;

      for (const [, target] of contents.matchAll(/]\(([^)#\s]+)(?:#[^)\s]*)?\)/g)) {
        if (/^[a-z]+:/.test(target)) {
          continue;
        }

        // Resolved against where the file lands, not where it lives now.
        const resolved = join(dirname(destination), target);

        assert.ok(
          pruned.has(resolved) === false,
          `${file} links to ${resolved}, which the setup script deletes`,
        );
      }
    }
  });
});

describe("template setup plan contract", () => {
  it("plans this repository without deleting anything it replaces", async () => {
    const plan = planSetup({ manifest, files: trackedFiles });
    const deletions = plan
      .filter((operation) => operation.kind === "delete")
      .map((operation) => operation.path);

    for (const { to } of manifest.copy) {
      assert.ok(
        deletions.includes(to) === false,
        `the plan deletes ${to}, which the payload replaces`,
      );
    }

    for (const path of ["docs/discord-bot.md", "src/index.js", "wrangler.jsonc", "LICENSE.md"]) {
      assert.ok(deletions.includes(path) === false, `the plan must not delete ${path}`);
    }

    for (const path of manifest.prune.filter((entry) =>
      manifest.copy.some((copy) => copy.to === entry) === false)) {
      assert.ok(deletions.includes(path), `the plan must delete ${path}`);
    }
  });

  it("empties the payload directory it was read from", async () => {
    const plan = planSetup({ manifest, files: trackedFiles });

    for (const file of payloadFiles) {
      const copied = plan.findIndex((operation) => operation.from === file);
      const removed = plan.findIndex(
        (operation) => operation.kind === "delete" && operation.path === file,
      );

      assert.ok(copied >= 0, `${file} is never copied`);
      assert.ok(removed > copied, `${file} is deleted before it is copied`);
    }

    assert.ok(plan.some((operation) =>
      operation.kind === "delete-directory" && operation.path === payloadDirectory));
  });
});
