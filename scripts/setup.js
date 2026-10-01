#!/usr/bin/env node
/**
 * Turn this template into a project, once.
 *
 * ```sh
 * npm run setup                                  # interactive
 * npm run setup -- --name acme-bot --yes         # unattended
 * npm run setup -- --name acme-bot --dry-run     # prints the plan, changes nothing
 * npm run setup -- --name acme-bot --ai delete   # remove the AI instruction files
 * ```
 *
 * It copies the `.template/` payload over the documents written from the
 * template's point of view, renames the Workers and the package, lowers the
 * coverage ratchet to a project's floor, swaps the AI instruction files,
 * copies `.dev.vars.example` to `.dev.vars`, prunes the template's own
 * scaffolding, records provenance in `package.json`, adds the `upstream`
 * remote — and then deletes itself, its library, and its tests.
 *
 * Everything worth testing lives in `scripts/lib/setup.js`: what the run does
 * is a plan built from `template-manifest.json`, and this file is the part
 * that owns the filesystem, the clock, `git`, and the exit code. That split is
 * why a one-shot destructive script can be unit-tested at all.
 *
 * Two safety rules it will not bend: it refuses to run where provenance
 * already exists, and it prints paths rather than contents, so a `.dev.vars`
 * it creates is never echoed.
 */
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { execFile } from "node:child_process";
import { dirname, join, sep } from "node:path";
import { promisify } from "node:util";
import {
  PACKAGE_MANIFEST,
  SETUP_USAGE,
  UPSTREAM_REMOTE,
  applyTransform,
  buildPlaceholderValues,
  buildProvenance,
  describeRemainingWork,
  describeSetupPlan,
  deriveWorkerNames,
  findSetupBlockers,
  parseSetupArguments,
  planProjectSetup,
  removePackageScript,
  setupListingSources,
  substitutePlaceholders,
} from "./lib/setup.js";

const execFileAsync = promisify(execFile);

/** The manifest that says what belongs to the template rather than a project. */
const TEMPLATE_MANIFEST = "template-manifest.json";

/** What `package.json` and the README say when the run is given no description. */
const DEFAULT_DESCRIPTION = "A Discord bot on Cloudflare Workers.";

// npm runs a script from the package root, which is the project being set up.
const root = process.cwd();

/**
 * Resolve a project-relative path.
 *
 * @param {string} relative
 * @returns {string}
 */
const resolve = (relative) => join(root, relative);

/**
 * Read a project-relative text file.
 *
 * @param {string} relative
 * @returns {Promise<string>}
 */
const read = (relative) => readFile(resolve(relative), "utf8");

/**
 * Write a project-relative text file.
 *
 * @param {string} relative
 * @param {string} text
 * @returns {Promise<void>}
 */
const write = (relative, text) => writeFile(resolve(relative), text);

/**
 * Whether a project-relative path exists.
 *
 * @param {string} relative
 * @returns {Promise<boolean>}
 */
const exists = async (relative) => {
  try {
    await stat(resolve(relative));

    return true;
  } catch {
    return false;
  }
};

/**
 * Run `git`, or report that it could not be run.
 *
 * Setup has to work in a clone, in a **Use this template** repository, and in
 * an extracted archive that is no repository at all, so every `git` call here
 * is best-effort: `null` means "could not tell", never "no".
 *
 * @param {string[]} args
 * @returns {Promise<string | null>} Trimmed stdout, or `null` on any failure.
 */
const git = async (args) => {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd: root });

    return stdout.trim();
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

/**
 * List the files the plan could touch.
 *
 * Built from the manifest rather than from `git ls-files`: a half-finished run
 * leaves files git still believes are tracked, and an archive has no index at
 * all.
 *
 * @param {Record<string, any>} manifest
 * @returns {Promise<string[]>} Project-relative paths that exist.
 */
const collectListing = async (manifest) => {
  const { paths, directories } = setupListingSources(manifest);
  const found = [];

  for (const path of paths) {
    if (await exists(path)) {
      found.push(path);
    }
  }

  for (const { path, recursive } of directories) {
    let entries;

    try {
      entries = await readdir(resolve(path), { recursive, withFileTypes: true });
    } catch {
      // A directory the manifest names but this project no longer has: a
      // second run after a first one pruned it.
      continue;
    }

    for (const entry of entries.filter((candidate) => candidate.isFile())) {
      const absolute = join(entry.parentPath, entry.name);

      found.push(absolute.slice(root.length + 1).split(sep).join("/"));
    }
  }

  return [...new Set(found)];
};

/**
 * Carry out one planned operation.
 *
 * @param {Record<string, any>} operation
 * @param {Record<string, any>} context What the transforms and the payload need.
 * @returns {Promise<void>}
 * @throws {Error} On an operation kind this file cannot apply, which means the
 *   planner and the executor have drifted apart.
 */
const apply = async (operation, context) => {
  switch (operation.kind) {
    case "copy":
      await mkdir(dirname(resolve(operation.to)), { recursive: true });
      await write(
        operation.to,
        substitutePlaceholders(await read(operation.from), context.placeholders),
      );

      return;
    case "copy-if-absent":
      if (await exists(operation.to)) {
        console.log(`  ${operation.to} already exists; leaving it as it is.`);

        return;
      }

      await copyFile(resolve(operation.from), resolve(operation.to));

      return;
    case "rewrite":
      await write(
        operation.path,
        applyTransform(operation.transform, await read(operation.path), context),
      );

      return;
    case "move":
      await rename(resolve(operation.from), resolve(operation.to));

      return;
    case "delete":
      await rm(resolve(operation.path), { force: true });

      return;
    case "delete-directory":
      await rm(resolve(operation.path), { recursive: true, force: true });

      return;
    case "remove-package-script":
      await write(
        PACKAGE_MANIFEST,
        removePackageScript(await read(PACKAGE_MANIFEST), operation.name),
      );

      return;
    case "add-remote":
      if (operation.skip) {
        console.log(`  a remote named ${operation.name} already exists; leaving it as it is.`);

        return;
      }

      if (await git(["remote", "add", operation.name, operation.url]) === null) {
        console.log(`  could not add the ${operation.name} remote; add it by hand:`);
        console.log(`    git remote add ${operation.name} ${operation.url}`);
      }

      return;
    default:
      throw new Error(`Cannot apply setup operation ${operation.kind}`);
  }
};

/**
 * Read input, apply the plan, report.
 *
 * @returns {Promise<number>} The process exit code.
 * @throws {Error} With a message a reader can act on, for every refusal.
 */
const main = async () => {
  const args = parseSetupArguments(process.argv.slice(2));

  if (args.help) {
    console.log(SETUP_USAGE);

    return 0;
  }

  if (await exists(PACKAGE_MANIFEST) === false) {
    throw new Error(`No ${PACKAGE_MANIFEST} in ${root}: run npm run setup from the project root.`);
  }

  const packageManifest = JSON.parse(await read(PACKAGE_MANIFEST));
  const status = await git(["status", "--porcelain"]);
  const blockers = findSetupBlockers({
    provenance: packageManifest.template,
    // `null` rather than an empty list when git could not tell us, so a
    // directory that is not a repository is not mistaken for a clean one.
    dirtyFiles: status === null ? null : status.split("\n").filter(Boolean),
    force: args.force,
    dryRun: args.dryRun,
  });

  if (blockers.length > 0) {
    throw new Error(blockers.join("\n\n"));
  }

  if (await exists(TEMPLATE_MANIFEST) === false) {
    throw new Error(
      `No ${TEMPLATE_MANIFEST} in ${root}: either this project was not created from the `
      + "template, or setup has already run and pruned it.",
    );
  }

  const manifest = JSON.parse(await read(TEMPLATE_MANIFEST));
  // Prompting needs a terminal and a caller who did not ask for an unattended
  // run. Everything else has to come from the arguments or fail.
  const interactive = process.stdin.isTTY === true && args.yes === false;
  const slug = args.name ?? (interactive ? await ask("Project slug (for example acme-bot): ") : "");
  const names = deriveWorkerNames(slug);
  const answered = args.description
    ?? (interactive ? await ask("One line about what the bot does: ") : "");
  const description = answered.trim() === "" ? DEFAULT_DESCRIPTION : answered.trim();
  const files = await collectListing(manifest);
  const remotes = await git(["remote"]);
  const plan = planProjectSetup({
    manifest,
    files,
    instructionMode: args.instructionMode,
    hasUpstreamRemote: (remotes ?? "").split("\n").includes(UPSTREAM_REMOTE),
  });

  console.log(`Project:       ${names.base}`);
  console.log(`Description:   ${description}`);
  console.log(`Workers:       ${names.base}, ${names.nonProd}, ${names.production}`);
  console.log(`AI files:      ${args.instructionMode}`);
  console.log(`Template:      ${manifest.templateRepository} at ${packageManifest.version}`);
  console.log("");
  console.log(describeSetupPlan(plan));
  console.log("");

  if (args.dryRun) {
    console.log("Dry run: nothing was changed.");

    return 0;
  }

  if (args.yes === false) {
    if (interactive === false) {
      throw new Error(
        "Refusing to apply the plan above without confirmation and without a terminal to ask "
        + "for it: re-run with --yes, or with --dry-run to see the plan only.",
      );
    }

    const answer = await ask(`Apply this to ${root}? [y/N] `);

    if (/^y(es)?$/i.test(answer.trim()) === false) {
      console.log("Nothing was changed.");

      return 1;
    }
  }

  const upstream = {
    repository: manifest.templateRepository,
    version: packageManifest.version,
  };
  const project = { name: names.base, description };
  const context = {
    names,
    project,
    upstream: { templateRepository: manifest.templateRepository },
    placeholders: buildPlaceholderValues({ project, upstream }),
    provenance: buildProvenance({
      ...upstream,
      commit: await git(["rev-parse", "HEAD"]) ?? undefined,
      now: new Date(),
    }),
  };

  for (const operation of plan) {
    await apply(operation, context);
  }

  console.log(`Setup is done. ${names.base} is a project now, and this script has removed itself.`);
  console.log("");

  for (const line of describeRemainingWork(packageManifest)) {
    console.log(line);
  }

  return 0;
};

try {
  process.exitCode = await main();
} catch (error) {
  // The message only. A stack trace adds nothing a reader can act on, and
  // printing the error object risks printing whatever it was carrying.
  console.error(error.message);
  process.exitCode = 1;
}
