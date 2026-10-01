/**
 * The logic half of project setup.
 *
 * `template-manifest.json` says *what* is template-only; this module says what
 * has to happen to it, and in which order. Nothing here touches the
 * filesystem: the planner is handed a manifest and a listing of the files that
 * exist, and returns a plan the CLI executes. That split is what makes a
 * destructive one-shot script testable — a plan that deletes the wrong thing
 * can be caught in a unit test rather than in somebody's new repository.
 *
 * Three rules shape the plan:
 *
 * - **Copy before delete.** The payload in `.template/` is written over its
 *   destinations first, so a path that is both pruned and replaced ends up
 *   holding the replacement rather than nothing.
 * - **Only what is present.** Every deletion is filtered against the listing,
 *   so re-running after a half-finished run plans the remaining work instead of
 *   failing on a file that is already gone.
 * - **The script goes last.** `selfDelete` operations are ordered after
 *   everything else, because a script that deletes itself first cannot finish.
 *
 * @see docs/using-this-template.md
 */

/** Regular-expression metacharacters, plus the one wildcard a glob may use. */
const REGEXP_METACHARACTERS = /[.*+?^${}()|[\]\\]/g;

/**
 * Compile a manifest glob.
 *
 * `*` matches within a single path segment and everything else is literal.
 * Deliberately not a full glob implementation: the manifest's globs exist to
 * sweep `.changeset/*.md`, and a pattern that could recurse is a pattern that
 * could delete a directory nobody listed.
 *
 * @param {string} glob
 * @returns {RegExp}
 */
const globToRegExp = (glob) =>
  new RegExp(
    `^${glob.replace(REGEXP_METACHARACTERS, (character) =>
      character === "*" ? "[^/]*" : `\\${character}`)}$`,
  );

/**
 * Quote a literal string for use inside a regular expression.
 *
 * @param {string} value
 * @returns {string}
 */
const escapeRegExp = (value) => value.replace(REGEXP_METACHARACTERS, "\\$&");

/**
 * Resolve the manifest's globs against the files that exist.
 *
 * @param {string[]} globs From `pruneGlobs`.
 * @param {string[]} files Repository-relative paths, as `git ls-files` lists them.
 * @returns {string[]} The matching files, in listing order.
 */
export const resolvePruneGlobs = (globs, files) => {
  const patterns = globs.map(globToRegExp);

  return files.filter((file) => patterns.some((pattern) => pattern.test(file)));
};

/** What `planInstructionFiles` accepts, quoted back when it gets something else. */
const INSTRUCTION_MODES = ["swap", "delete", "keep"];

/**
 * Decide what happens to the six AI instruction files.
 *
 * The template ships three maintainer files and three `-for-users`
 * counterparts. A project keeps one set:
 *
 * - `swap` moves each counterpart over its maintainer file, which is the
 *   three `mv` commands `docs/using-ai.md` asks a reader to run by hand.
 * - `delete` removes all six, for a project that does not use AI tooling.
 * - `keep` leaves them, for a fork that is still a template.
 *
 * A repository where the swap already happened plans nothing rather than
 * failing, so an interrupted run is safe to repeat.
 *
 * @param {object} request
 * @param {Array<{ maintainer: string, downstream: string }>} request.instructionFiles
 * @param {string[]} request.files
 * @param {"swap" | "delete" | "keep"} request.mode
 * @returns {Array<Record<string, unknown>>} Move or delete operations.
 * @throws {Error} On an unrecognized mode. Guessing here would either destroy
 *   the guidance a project wanted or leave the template's own in place.
 */
export const planInstructionFiles = ({ instructionFiles, files, mode }) => {
  const present = new Set(files);

  if (mode === "keep") {
    return [];
  }

  if (mode === "swap") {
    return instructionFiles
      .filter(({ downstream }) => present.has(downstream))
      .map(({ maintainer, downstream }) => ({
        kind: "move",
        from: downstream,
        to: maintainer,
        overwrite: present.has(maintainer),
      }));
  }

  if (mode === "delete") {
    return instructionFiles
      .flatMap(({ maintainer, downstream }) => [maintainer, downstream])
      .filter((path) => present.has(path))
      .map((path) => ({ kind: "delete", path, reason: "instruction-files" }));
  }

  throw new Error(`Unrecognized instruction-file mode ${mode} — expected one of `
    + INSTRUCTION_MODES.join(", "));
};

/**
 * Turn the manifest into an ordered list of operations.
 *
 * @param {object} request
 * @param {Record<string, any>} request.manifest The parsed `template-manifest.json`.
 * @param {string[]} request.files Repository-relative paths that exist.
 * @param {"swap" | "delete" | "keep"} [request.instructionMode] Defaults to `swap`.
 * @returns {Array<Record<string, unknown>>} `copy`, `move`, `delete`,
 *   `delete-directory`, and `remove-package-script` operations, in the order
 *   they must be applied.
 */
export const planSetup = ({ manifest, files, instructionMode = "swap" }) => {
  const present = new Set(files);
  // A destination the payload writes to is replaced, never deleted, however
  // many of the manifest's lists happen to name it.
  const replaced = new Set(manifest.copy.map((entry) => entry.to));
  const queued = new Set();
  const operations = manifest.copy.map(({ from, to }) => ({
    kind: "copy",
    from,
    to,
    overwrite: present.has(to),
  }));

  operations.push(...planInstructionFiles({
    instructionFiles: manifest.instructionFiles,
    files,
    mode: instructionMode,
  }));

  /**
   * Queue one deletion, unless it is absent, already queued, or replaced.
   *
   * @param {string} path
   * @param {string} reason Which manifest list reached it, for the printed plan.
   * @returns {void}
   */
  const queueDelete = (path, reason) => {
    if (!present.has(path) || queued.has(path) || replaced.has(path)) {
      return;
    }

    queued.add(path);
    operations.push({ kind: "delete", path, reason });
  };

  for (const path of manifest.prune) {
    queueDelete(path, "prune");
  }

  for (const path of resolvePruneGlobs(manifest.pruneGlobs, files)) {
    queueDelete(path, "prune-glob");
  }

  for (const directory of manifest.pruneDirectories) {
    const contents = files.filter((file) => file.startsWith(`${directory}/`));

    for (const path of contents) {
      queueDelete(path, "prune-directory");
    }

    if (contents.length > 0) {
      operations.push({ kind: "delete-directory", path: directory });
    }
  }

  for (const path of manifest.selfDelete.paths) {
    queueDelete(path, "self-delete");
  }

  for (const name of manifest.selfDelete.packageScripts) {
    operations.push({ kind: "remove-package-script", name });
  }

  return operations;
};

/*
 * ---------------------------------------------------------------------------
 * Identity transforms
 *
 * Text in, text out. Nothing below reads or writes a file; the CLI does that,
 * so a rewrite that mangles `wrangler.jsonc` fails in a unit test rather than
 * in a new repository.
 *
 * Two rules about anchors, applied consistently:
 *
 * - An anchor the rewrite *keeps* — a JSON key, a `thresholds` block — is
 *   required. Its absence means an upstream edit moved it, and a transform
 *   that silently did nothing would be worse than a stack trace.
 * - An anchor the rewrite *consumes* — a comment it replaces, a section it
 *   deletes, a link it redirects — is optional, because its absence is
 *   exactly what a second run looks like.
 *
 * Together those two rules are what make every transform idempotent, which is
 * what makes a half-finished `npm run setup` safe to re-run. The contract
 * tests in `test/contracts/setup-transforms.template-only.test.js` run each
 * transform against the repository's real files, so a moved anchor of either
 * kind is noticed here rather than downstream.
 * ---------------------------------------------------------------------------
 */

/**
 * The longest Worker name Cloudflare accepts on a `workers.dev` subdomain,
 * which is where a project deploys until it configures a route.
 *
 * @see https://developers.cloudflare.com/workers/wrangler/configuration/
 */
export const WORKER_NAME_MAX_LENGTH = 63;

/** The per-environment suffixes `deriveWorkerNames` appends. */
const ENVIRONMENT_SUFFIXES = { nonProd: "-non-prod", production: "-production" };

/** How long a slug may be and still leave room for the longest suffix. */
export const PROJECT_SLUG_MAX_LENGTH =
  WORKER_NAME_MAX_LENGTH - Math.max(...Object.values(ENVIRONMENT_SUFFIXES).map((s) => s.length));

/**
 * Alphanumerics and dashes, lowercase, with no leading or trailing dash.
 * Cloudflare also rejects underscores.
 */
const PROJECT_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/**
 * Validate a project slug and derive the three Worker names from it.
 *
 * The derived names are what `test/contracts/environment-isolation.test.js`
 * checks after setup has run: three distinct names, one carrying a
 * non-production indicator and one carrying a production indicator.
 *
 * @param {string} slug
 * @returns {{ base: string, nonProd: string, production: string }}
 * @throws {Error} When the slug is missing, malformed, or long enough that
 *   `<slug>-production` would exceed the `workers.dev` limit.
 */
export const deriveWorkerNames = (slug) => {
  if (typeof slug !== "string" || slug.length === 0) {
    throw new Error("A project slug is required — pass --name <slug>.");
  }

  if (PROJECT_SLUG_PATTERN.test(slug) === false) {
    throw new Error(
      `${slug} is not a usable Worker name: use lowercase letters, digits, and dashes, `
      + "with no leading or trailing dash and no underscores.",
    );
  }

  if (slug.length > PROJECT_SLUG_MAX_LENGTH) {
    throw new Error(
      `${slug} is ${slug.length} characters, and ${PROJECT_SLUG_MAX_LENGTH} is the limit: `
      + `${slug}${ENVIRONMENT_SUFFIXES.production} has to fit in ${WORKER_NAME_MAX_LENGTH}.`,
    );
  }

  return {
    base: slug,
    nonProd: `${slug}${ENVIRONMENT_SUFFIXES.nonProd}`,
    production: `${slug}${ENVIRONMENT_SUFFIXES.production}`,
  };
};

/**
 * Rename the three Workers in `wrangler.jsonc`.
 *
 * The file is rewritten as text rather than re-serialized, so the
 * compatibility date, the observability block, every `secrets.required` list,
 * and the `.jsonc` file's comments — it has none today, but it is named for
 * them — survive byte for byte. Each current name is replaced only where it
 * appears as a complete JSON string, and the count is checked, so a name that
 * also happens to be some other field's value fails loudly instead of being
 * rewritten by accident.
 *
 * @param {string} text The current `wrangler.jsonc`.
 * @param {{ base: string, nonProd: string, production: string }} names
 * @returns {string}
 * @throws {Error} When a name is missing, shared between environments, or
 *   does not appear exactly once.
 */
export const rewriteWranglerNames = (text, names) => {
  const config = JSON.parse(text);
  const current = [
    ["base", config.name],
    ["nonProd", config.env?.["non-prod"]?.name],
    ["production", config.env?.production?.name],
  ];

  for (const [key, value] of current) {
    if (typeof value !== "string") {
      throw new Error(`wrangler.jsonc has no ${key} Worker name to rewrite`);
    }
  }

  const byCurrent = new Map(current.map(([key, value]) => [value, names[key]]));

  if (byCurrent.size !== current.length) {
    throw new Error("wrangler.jsonc reuses a Worker name across environments");
  }

  // Longest first, so a name that is a prefix of another cannot shadow it.
  const pattern = new RegExp(
    [...byCurrent.keys()]
      .sort((left, right) => right.length - left.length)
      .map((name) => `"${escapeRegExp(name)}"`)
      .join("|"),
    "g",
  );
  let rewrote = 0;
  const rewritten = text.replace(pattern, (match) => {
    rewrote += 1;

    return `"${byCurrent.get(match.slice(1, -1))}"`;
  });

  if (rewrote !== current.length) {
    throw new Error(
      `Expected to rewrite ${current.length} Worker names in wrangler.jsonc, rewrote ${rewrote}`,
    );
  }

  return rewritten;
};

/** Keywords that describe the template rather than anything it produces. */
const TEMPLATE_KEYWORDS = new Set(["template", "boilerplate"]);

/**
 * The version a new project starts at.
 *
 * Shared by the manifest and the lockfile rewrites on purpose:
 * `test/contracts/versioning.test.js` ships downstream and compares the two,
 * so a rename that moved one and not the other would fail a new project's
 * first `npm test`.
 */
export const PROJECT_INITIAL_VERSION = "0.0.0";

/**
 * Give `package.json` the project's identity.
 *
 * `author` and `license` are deliberately left alone: reassigning a copyright
 * holder is not a setup script's decision, so the CLI prints a warning
 * instead. The file is re-serialized with two-space indentation, which is what
 * it already uses, and key order survives because the keys are mutated in
 * place rather than rebuilt.
 *
 * @param {string} text The current `package.json`.
 * @param {{ name: string, description: string }} project
 * @returns {string}
 */
export const rewritePackageManifest = (text, { name, description }) => {
  const manifest = JSON.parse(text);

  manifest.name = name;
  manifest.description = description;
  // A project's history starts at zero; the template's version is recorded in
  // the provenance the CLI writes, not inherited as the project's own.
  manifest.version = PROJECT_INITIAL_VERSION;

  if (Array.isArray(manifest.keywords)) {
    manifest.keywords = manifest.keywords.filter((keyword) =>
      TEMPLATE_KEYWORDS.has(keyword) === false);
  }

  delete manifest.scripts?.setup;

  return `${JSON.stringify(manifest, null, 2)}\n`;
};

/** The lockfile's root `name`, which is the only one at two-space indent. */
const LOCK_ROOT_NAME = /^( {2}"name": ")[^"]*(")/m;

/** The root `version`, the only one at two-space indent. */
const LOCK_ROOT_VERSION = /^( {2}"version": ")[^"]*(")/m;

/** The `packages[""]` entry's `name`, matched together with its key. */
const LOCK_WORKSPACE_NAME = /^( {4}"": \{\n {6}"name": ")[^"]*(")/m;

/**
 * The `packages[""]` entry's `version`. Every dependency carries one at the
 * same indentation, so this is anchored on the empty package key above it.
 */
const LOCK_WORKSPACE_VERSION = /^( {4}"": \{\n {6}"name": "[^"]*",\n {6}"version": ")[^"]*(")/m;

/**
 * Give `package-lock.json` the project's identity.
 *
 * Textual for the same reason as `wrangler.jsonc`, and more so: the lockfile
 * is npm's to format, and re-serializing a 190 kB file to change a dozen
 * characters would bury the change in churn. Only the root object and
 * `packages[""]` carry the project's own name and version; every other `name`
 * and `version` in the file belongs to a dependency.
 *
 * The version moves with the name because `test/contracts/versioning.test.js`
 * ships downstream and asserts the lockfile and the manifest agree.
 *
 * @param {string} text The current `package-lock.json`.
 * @param {{ name: string, version?: string }} project Version defaults to
 *   {@link PROJECT_INITIAL_VERSION}, which is what `rewritePackageManifest`
 *   writes.
 * @returns {string}
 * @throws {Error} When a field is not where npm puts it.
 */
export const rewritePackageLock = (text, { name, version = PROJECT_INITIAL_VERSION }) => {
  const anchors = [
    ["root name", LOCK_ROOT_NAME],
    ["packages[\"\"] name", LOCK_WORKSPACE_NAME],
    ["root version", LOCK_ROOT_VERSION],
    ["packages[\"\"] version", LOCK_WORKSPACE_VERSION],
  ];

  for (const [label, pattern] of anchors) {
    if (pattern.test(text) === false) {
      throw new Error(`package-lock.json has no ${label} field to rewrite`);
    }
  }

  return text
    .replace(LOCK_ROOT_NAME, `$1${name}$2`)
    .replace(LOCK_WORKSPACE_NAME, `$1${name}$2`)
    .replace(LOCK_ROOT_VERSION, `$1${version}$2`)
    .replace(LOCK_WORKSPACE_VERSION, `$1${version}$2`);
};

/**
 * The coverage level a project created from this template starts at.
 *
 * The template holds itself to 100% because it is three commands long. An
 * application is not, and a first partially-covered feature that fails
 * `npm test` teaches a new project to lower the number — which is the habit
 * the ratchet exists to prevent. A floor high enough to catch an untested
 * module, set once and raised by hand, keeps the ratchet's meaning.
 */
export const COVERAGE_FLOOR = 80;

/** The maintainer-facing comment above the thresholds, which setup replaces. */
const RATCHET_COMMENT =
  /([ \t]*)\/\/ A ratchet, not an aspiration:[\s\S]*?is not a reviewed promise\.\n/;

/** The `thresholds` object, captured so only its interior is rewritten. */
const THRESHOLDS_BLOCK = /(thresholds: \{)([\s\S]*?)(\n[ \t]*\},)/;

/** One `metric: number` pair inside that block. */
const THRESHOLD_VALUE = /\b(branches|functions|lines|statements):\s*\d+/g;

/**
 * Render the replacement comment at the indentation the original used.
 *
 * @param {string} indent
 * @returns {string}
 */
const floorComment = (indent) => [
  "// A floor, not a ratchet: this is the level below which `npm test` fails,",
  "// not the level the suite happens to reach. Raise it by hand as coverage",
  "// improves — a number that only ever goes up is a promise, and lowering",
  "// one to make a change pass is how a suite stops meaning anything.",
  "// `thresholds.autoUpdate` is deliberately not used: a threshold that moves",
  "// on its own is not a reviewed promise.",
].map((line) => `${indent}${line}\n`).join("");

/**
 * Lower the coverage ratchet to a project's starting floor.
 *
 * The provider stays `istanbul` — the Workers pool does not emit the V8
 * coverage profile — and the include patterns are untouched, so
 * `test/contracts/coverage.test.js` still passes against the result.
 *
 * @param {string} text The current `vitest.config.js`.
 * @param {number} [floor] Defaults to {@link COVERAGE_FLOOR}.
 * @returns {string}
 * @throws {Error} When there is no thresholds block to rewrite.
 */
export const rewriteCoverageThresholds = (text, floor = COVERAGE_FLOOR) => {
  if (THRESHOLDS_BLOCK.test(text) === false) {
    throw new Error("vitest.config.js has no coverage thresholds block to rewrite");
  }

  return text
    .replace(RATCHET_COMMENT, (_match, indent) => floorComment(indent))
    .replace(THRESHOLDS_BLOCK, (_match, open, body, close) =>
      `${open}${body.replace(THRESHOLD_VALUE, (_pair, metric) => `${metric}: ${floor}`)}${close}`);
};

/** A `{{TOKEN}}` in a `.template/` payload file. */
const PLACEHOLDER = /\{\{([A-Z0-9_]+)\}\}/g;

/**
 * Fill in a payload file's placeholders.
 *
 * Failing on a leftover token is the point: a README that greets its first
 * reader with `{{PROJECT_NAME}}` is worse than a setup run that stopped and
 * said which value was missing.
 *
 * @param {string} text
 * @param {Record<string, string>} values Keyed by token name, without braces.
 * @returns {string}
 * @throws {Error} When a token in the text has no value.
 */
export const substitutePlaceholders = (text, values) => {
  const substituted = text.replace(PLACEHOLDER, (match, token) =>
    Object.hasOwn(values, token) ? values[token] : match);
  const missing = [...new Set([...substituted.matchAll(PLACEHOLDER)].map(([token]) => token))];

  if (missing.length > 0) {
    throw new Error(`No value supplied for ${missing.join(", ")}`);
  }

  return substituted;
};

/** A relative Markdown link to the setup guide, with or without an anchor. */
const SETUP_GUIDE_LINK = /\]\(using-this-template\.md(#[^)\s]*)?\)/g;

/**
 * Point the surviving documents' setup-guide links upstream.
 *
 * `docs/using-this-template.md` is replaced by a short provenance stub, so
 * these links would still resolve — but to a page that no longer contains the
 * section each one was citing. Sending them to the upstream blob URL keeps
 * every anchor accurate.
 *
 * @param {string} text
 * @param {{ templateRepository: string }} upstream
 * @returns {{ text: string, rewritten: number }} The count is what the
 *   contract test asserts, so a doc edit that adds a link is noticed.
 */
export const rewriteTemplateLinks = (text, { templateRepository }) => {
  let rewritten = 0;
  const target = `${templateRepository}/blob/main/docs/using-this-template.md`;
  const substituted = text.replace(SETUP_GUIDE_LINK, (_match, anchor) => {
    rewritten += 1;

    return `](${target}${anchor ?? ""})`;
  });

  return { text: substituted, rewritten };
};

/** The "Two version numbers" section, up to whatever heading follows it. */
const TWO_VERSION_NUMBERS_SECTION = /^## Two version numbers\n[\s\S]*?\n(?=^## )/m;

/**
 * Delete the section of `docs/versioning-and-changesets.md` that explains the
 * instruction contract version.
 *
 * A project's instruction files carry no contract version — the swap replaces
 * them with the `-for-users` set, which deliberately has none — so the section
 * documents a number that does not exist. The whole section goes rather than
 * just the row and the paragraph that names it: its premise is "this
 * repository carries two", and a one-row table under that sentence is worse
 * than no section at all. It also holds the document's last link to
 * `CONTRIBUTING.md`, which setup prunes.
 *
 * @param {string} text
 * @returns {string}
 */
export const removeInstructionContractSection = (text) =>
  text.replace(TWO_VERSION_NUMBERS_SECTION, "");

/*
 * ---------------------------------------------------------------------------
 * The run itself
 *
 * Arguments in, an ordered plan out, and the text of everything the CLI
 * prints. `scripts/setup.js` supplies the filesystem, the clock, and `git`;
 * every decision it makes is made here, where a test can reach it. The script
 * runs once in a project's life and deletes itself afterwards, so there is no
 * second chance to notice that it renamed the wrong file.
 * ---------------------------------------------------------------------------
 */

/** How the command is invoked, quoted back in every argument error. */
export const SETUP_USAGE = "usage: npm run setup -- [--name <slug>] [--description <text>] "
  + "[--ai <swap|delete|keep>] [--yes] [--dry-run] [--force]";

/** Arguments that stand alone, mapped to the field each one sets. */
const SETUP_FLAGS = new Map([
  ["--yes", "yes"],
  ["-y", "yes"],
  ["--dry-run", "dryRun"],
  ["--force", "force"],
  ["--help", "help"],
]);

/** Arguments that take the next argument as their value. */
const SETUP_OPTIONS = new Map([
  ["--name", "name"],
  ["--description", "description"],
  ["--ai", "instructionMode"],
]);

/**
 * Parse the setup CLI's arguments.
 *
 * Nothing falls back to a default on a typo. The script renames a repository
 * and deletes files once, so `--nam acme-bot` has to stop the run rather than
 * quietly proceed to an interactive prompt.
 *
 * @param {string[]} argv Arguments without the node binary or script path.
 * @returns {{
 *   name: string | undefined,
 *   description: string | undefined,
 *   instructionMode: "swap" | "delete" | "keep",
 *   yes: boolean,
 *   dryRun: boolean,
 *   force: boolean,
 *   help: boolean,
 * }}
 * @throws {Error} On an unrecognized argument, an option with no value, or an
 *   instruction mode `planInstructionFiles` could not honour.
 */
export const parseSetupArguments = (argv) => {
  const parsed = {
    name: undefined,
    description: undefined,
    instructionMode: "swap",
    yes: false,
    dryRun: false,
    force: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const flag = SETUP_FLAGS.get(argument);

    if (flag !== undefined) {
      parsed[flag] = true;
      continue;
    }

    const option = SETUP_OPTIONS.get(argument);

    if (option === undefined) {
      throw new Error(`Unrecognized argument ${argument} — ${SETUP_USAGE}`);
    }

    const value = argv[index + 1];

    if (value === undefined || SETUP_FLAGS.has(value) || SETUP_OPTIONS.has(value)) {
      throw new Error(`${argument} needs a value — ${SETUP_USAGE}`);
    }

    parsed[option] = value;
    index += 1;
  }

  if (INSTRUCTION_MODES.includes(parsed.instructionMode) === false) {
    throw new Error(`--ai ${parsed.instructionMode} is not one of `
      + `${INSTRUCTION_MODES.join(", ")} — ${SETUP_USAGE}`);
  }

  return parsed;
};

/**
 * Why this run must not proceed.
 *
 * Two refusals, and they are not equivalent. Provenance in `package.json`
 * means setup already ran: running again would prune a project's own work and
 * cannot be forced. A dirty tree only means the run would not be reviewable,
 * so `--force` covers it — and a dry run, which writes nothing, is not
 * affected either way.
 *
 * @param {object} state
 * @param {Record<string, unknown> | null | undefined} [state.provenance] The
 *   `template` key of `package.json`, if it has one.
 * @param {string[] | null | undefined} [state.dirtyFiles] Paths `git status`
 *   reported, or `null` when the tree state could not be read at all.
 * @param {boolean} [state.force]
 * @param {boolean} [state.dryRun]
 * @returns {string[]} One message per refusal; empty when the run may proceed.
 */
export const findSetupBlockers = ({ provenance, dirtyFiles, force = false, dryRun = false }) => {
  const blockers = [];

  if (provenance !== undefined && provenance !== null) {
    blockers.push(
      "package.json already carries a `template` provenance record, so npm run setup has "
      + "already run in this project. Setup is a one-shot: running it again would prune work "
      + "that is now yours.",
    );
  }

  if (dryRun === false && force === false && dirtyFiles !== null && dirtyFiles !== undefined
    && dirtyFiles.length > 0) {
    blockers.push(
      `The working tree has uncommitted changes (${dirtyFiles.slice(0, 5).join(", ")}`
      + `${dirtyFiles.length > 5 ? ", …" : ""}). Setup rewrites and deletes a lot of files at `
      + "once; commit or stash first so its diff is reviewable, or re-run with --force.",
    );
  }

  return blockers;
};

/**
 * Record where a project came from.
 *
 * Kept in `package.json` under `template` rather than in a new dotfile: a
 * project reads its own manifest, and a provenance record nobody sees is a
 * provenance record nobody checks before adopting an upstream change.
 *
 * @param {object} request
 * @param {string} request.repository The upstream template's repository URL.
 * @param {string} request.version The template version, from its `package.json`.
 * @param {string} [request.commit] The template commit, when `git` could name one.
 * @param {Date} request.now The clock, injected so the record is testable.
 * @returns {{ repository: string, version: string, commit?: string, setupDate: string }}
 * @throws {Error} When `now` is not a usable `Date`.
 */
export const buildProvenance = ({ repository, version, commit, now }) => {
  if (now instanceof Date === false || Number.isNaN(now.getTime())) {
    throw new Error("buildProvenance needs a clock: pass now as a Date.");
  }

  const recorded = typeof commit === "string" ? commit.trim() : "";

  return {
    repository,
    version,
    ...(recorded === "" ? {} : { commit: recorded }),
    setupDate: now.toISOString().slice(0, "YYYY-MM-DD".length),
  };
};

/**
 * Write a provenance record into `package.json`.
 *
 * @param {string} text The current `package.json`.
 * @param {ReturnType<typeof buildProvenance>} provenance
 * @returns {string}
 */
export const recordProvenance = (text, provenance) => {
  const manifest = JSON.parse(text);

  manifest.template = provenance;

  return `${JSON.stringify(manifest, null, 2)}\n`;
};

/**
 * Remove one npm script from `package.json`.
 *
 * The manifest names the scripts that go with the files being deleted, so the
 * removal is data rather than a hardcoded key.
 *
 * @param {string} text The current `package.json`.
 * @param {string} name The script key to remove.
 * @returns {string}
 */
export const removePackageScript = (text, name) => {
  const manifest = JSON.parse(text);

  delete manifest.scripts?.[name];

  return `${JSON.stringify(manifest, null, 2)}\n`;
};

/** `package.json`, named once so the plan and the transforms agree. */
export const PACKAGE_MANIFEST = "package.json";

/** The tracked example, which setup copies and then prunes. */
export const DEV_VARS_EXAMPLE = ".dev.vars.example";

/** The local secrets file `wrangler dev` reads. Never tracked, never printed. */
export const DEV_VARS = ".dev.vars";

/** The remote a project fetches upstream changes from. */
export const UPSTREAM_REMOTE = "upstream";

/**
 * Every file the run rewrites, and the transform that rewrites it.
 *
 * Order matters twice over. `docs/versioning-and-changesets.md` loses a
 * section before its links are rewritten, because the section being removed
 * contains one of them. And `docs/using-ai.md` is rewritten after the payload
 * has replaced it, so the link pass reads the project's copy rather than the
 * maintainer's.
 */
export const IDENTITY_REWRITES = [
  { path: "wrangler.jsonc", transform: "worker-names" },
  { path: PACKAGE_MANIFEST, transform: "package-identity" },
  { path: "package-lock.json", transform: "package-lock-identity" },
  { path: "vitest.config.js", transform: "coverage-floor" },
  { path: "docs/versioning-and-changesets.md", transform: "instruction-contract-section" },
  { path: "docs/discord-bot.md", transform: "template-links" },
  { path: "docs/gitflow-and-branching.md", transform: "template-links" },
  { path: "docs/using-ai.md", transform: "template-links" },
  { path: "docs/versioning-and-changesets.md", transform: "template-links" },
];

/**
 * The transforms a plan may name, keyed by the name it uses.
 *
 * A `Map` rather than an object literal so no `Object.prototype` key can pose
 * as a transform.
 */
export const SETUP_TRANSFORMS = new Map([
  ["worker-names", (text, { names }) => rewriteWranglerNames(text, names)],
  ["package-identity", (text, { project }) => rewritePackageManifest(text, project)],
  ["package-lock-identity", (text, { project }) => rewritePackageLock(text, project)],
  ["coverage-floor", (text) => rewriteCoverageThresholds(text)],
  ["template-links", (text, { upstream }) => rewriteTemplateLinks(text, upstream).text],
  ["instruction-contract-section", (text) => removeInstructionContractSection(text)],
  ["provenance", (text, { provenance }) => recordProvenance(text, provenance)],
]);

/**
 * Apply one named transform.
 *
 * @param {string} name A key of {@link SETUP_TRANSFORMS}.
 * @param {string} text The file's current contents.
 * @param {{
 *   names?: { base: string, nonProd: string, production: string },
 *   project?: { name: string, description: string },
 *   upstream?: { templateRepository: string },
 *   provenance?: object,
 * }} context Everything any transform needs, so the caller stays a switch-free
 *   loop over the plan.
 * @returns {string} The rewritten text.
 * @throws {Error} On a name no transform answers to.
 */
export const applyTransform = (name, text, context) => {
  const transform = SETUP_TRANSFORMS.get(name);

  if (transform === undefined) {
    throw new Error(`Unknown setup transform ${name}`);
  }

  return transform(text, context);
};

/**
 * The whole run, in the order it has to happen.
 *
 * `planSetup` decides what the manifest implies; this adds what a project's
 * identity implies and interleaves the two. The ordering is the contract:
 *
 * 1. copy the payload, so a replaced file holds its replacement;
 * 2. rewrite the identity, before the files that carry it are pruned;
 * 3. swap or delete the instruction files;
 * 4. copy the local secrets example, before it is pruned;
 * 5. prune;
 * 6. record provenance, and add the upstream remote;
 * 7. delete the setup script itself, last.
 *
 * @param {object} request
 * @param {Record<string, any>} request.manifest The parsed `template-manifest.json`.
 * @param {string[]} request.files Repository-relative paths that exist.
 * @param {"swap" | "delete" | "keep"} [request.instructionMode]
 * @param {boolean} [request.hasUpstreamRemote] When true, the remote is
 *   reported and left alone rather than replaced.
 * @returns {Array<Record<string, unknown>>}
 */
export const planProjectSetup = ({
  manifest,
  files,
  instructionMode = "swap",
  hasUpstreamRemote = false,
}) => {
  const present = new Set(files);
  const base = planSetup({ manifest, files, instructionMode });
  const isInstruction = (operation) =>
    operation.kind === "move" || operation.reason === "instruction-files";
  const isSelf = (operation) =>
    operation.reason === "self-delete" || operation.kind === "remove-package-script";

  return [
    ...base.filter((operation) => operation.kind === "copy"),
    ...IDENTITY_REWRITES
      .filter(({ path }) => present.has(path))
      .map(({ path, transform }) => ({ kind: "rewrite", path, transform })),
    ...base.filter(isInstruction),
    ...(present.has(DEV_VARS_EXAMPLE)
      ? [{
        kind: "copy-if-absent",
        from: DEV_VARS_EXAMPLE,
        to: DEV_VARS,
        existing: present.has(DEV_VARS),
      }]
      : []),
    ...base.filter((operation) =>
      operation.kind !== "copy" && isInstruction(operation) === false && isSelf(operation) === false),
    { kind: "rewrite", path: PACKAGE_MANIFEST, transform: "provenance" },
    {
      kind: "add-remote",
      name: UPSTREAM_REMOTE,
      url: `${manifest.templateRepository}.git`,
      skip: hasUpstreamRemote,
    },
    ...base.filter(isSelf),
  ];
};

/** How each kind of operation reads in the printed plan. */
const OPERATION_DESCRIPTIONS = new Map([
  ["copy", (operation) => `copy      ${operation.from} → ${operation.to}`],
  ["copy-if-absent", (operation) =>
    `copy      ${operation.from} → ${operation.to} (kept as it is if it already exists)`],
  ["rewrite", (operation) => `rewrite   ${operation.path} (${operation.transform})`],
  ["move", (operation) => `move      ${operation.from} → ${operation.to}`],
  ["delete", (operation) => `delete    ${operation.path} (${operation.reason})`],
  ["delete-directory", (operation) => `delete    ${operation.path}/ (directory)`],
  ["add-remote", (operation) => operation.skip
    ? `remote    ${operation.name} already exists, leaving it alone`
    : `remote    ${operation.name} → ${operation.url}`],
  ["remove-package-script", (operation) =>
    `rewrite   ${PACKAGE_MANIFEST} (remove the ${operation.name} script)`],
]);

/**
 * Render a plan for a human to approve.
 *
 * Paths only. No operation prints a file's contents, which is what keeps
 * `.dev.vars` out of the output even though the run creates it.
 *
 * @param {Array<Record<string, unknown>>} plan
 * @returns {string}
 * @throws {Error} On an operation kind with no description, which would
 *   otherwise be applied without appearing in what the reader approved.
 */
export const describeSetupPlan = (plan) => plan.map((operation) => {
  const describe = OPERATION_DESCRIPTIONS.get(operation.kind);

  if (describe === undefined) {
    throw new Error(`Unknown setup operation ${operation.kind}`);
  }

  return describe(operation);
}).join("\n");

/**
 * What setup could not do, printed after a successful run.
 *
 * Four of these need a human because they need credentials and a browser, and
 * the fifth is a judgement setup has no business making: reassigning a
 * copyright holder.
 *
 * @param {{ author?: string }} project The `author` field of `package.json`.
 * @returns {string[]} Lines to print in order.
 */
export const describeRemainingWork = ({ author = "the template's author" }) => [
  `LICENSE.md still carries ${author}'s copyright, and package.json still names them as the`,
  "author. Both were left alone on purpose — what your project's license and authorship should",
  "be is your call, not a setup script's.",
  "",
  "Four things only a human can do:",
  "  1. Create two Discord applications, one for non-production and one for production, and",
  "     note each one's public key, application ID, and bot token.",
  "  2. Set those three secrets on each Worker: `npx wrangler secret put <NAME> --env non-prod`,",
  "     then again with `--env production`. Never give a non-production Worker a production",
  "     credential.",
  "  3. Set the GitHub environment secret values. `npm run setup:github` creates the",
  "     environments, the DEPLOY_ENABLED variable, and the branch ruleset, and reports which",
  "     secret names are missing — it never sets a value.",
  "  4. After the first deploy, paste each Worker's `https://.../interactions` URL into its own",
  "     Discord application's Interactions Endpoint URL.",
  "",
  "See docs/discord-bot.md for what each secret is, and docs/using-this-template.md for the",
  "provenance this run recorded.",
];

/**
 * Where the CLI has to look to find out what exists.
 *
 * The plan is filtered against a listing of present files, and that listing is
 * gathered from the manifest rather than from `git ls-files`: setup has to work
 * the same in a **Use this template** repository, a clone, and an extracted
 * archive, and a half-finished run leaves files git may still think are
 * tracked.
 *
 * @param {Record<string, any>} manifest The parsed `template-manifest.json`.
 * @returns {{
 *   paths: string[],
 *   directories: Array<{ path: string, recursive: boolean }>,
 * }} Files to stat, and directories to read. Only a pruned directory is walked
 *   recursively: a glob matches within one path segment, so reading its parent
 *   shallowly is enough — and a glob with no slash at all resolves to `.`,
 *   which must never start a recursive walk of the whole project.
 */
export const setupListingSources = (manifest) => {
  const paths = new Set([
    ...manifest.prune,
    ...manifest.copy.flatMap(({ from, to }) => [from, to]),
    ...manifest.instructionFiles.flatMap(({ maintainer, downstream }) => [maintainer, downstream]),
    ...manifest.selfDelete.paths,
    ...IDENTITY_REWRITES.map(({ path }) => path),
    PACKAGE_MANIFEST,
    DEV_VARS_EXAMPLE,
    DEV_VARS,
  ]);
  const directories = new Map(
    manifest.pruneGlobs.map((glob) => [
      glob.includes("/") ? glob.slice(0, glob.lastIndexOf("/")) : ".",
      false,
    ]),
  );

  for (const directory of manifest.pruneDirectories) {
    directories.set(directory, true);
  }

  return {
    paths: [...paths],
    directories: [...directories].map(([path, recursive]) => ({ path, recursive })),
  };
};

/**
 * The value for every placeholder the payload declares.
 *
 * The keys are the contract: `substitutePlaceholders` refuses to write a file
 * with a token it has no value for, so a token added to `.template/` without a
 * value here stops the run rather than shipping `{{PROJECT_NAME}}` to a
 * project's first reader.
 *
 * @param {object} request
 * @param {{ name: string, description: string }} request.project
 * @param {{ repository: string, version: string }} request.upstream
 * @returns {Record<string, string>}
 */
export const buildPlaceholderValues = ({ project, upstream }) => ({
  PROJECT_NAME: project.name,
  PROJECT_DESCRIPTION: project.description,
  TEMPLATE_REPOSITORY: upstream.repository,
  TEMPLATE_VERSION: upstream.version,
});
