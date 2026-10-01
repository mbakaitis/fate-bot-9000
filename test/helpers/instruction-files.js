/**
 * The instruction-file contract, as a pure audit over a set of files.
 *
 * This template ships two parallel sets of AI instruction files, and a
 * downstream project renames one set over the other during setup (see
 * `docs/using-this-template.md`). So there is no single correct file layout to
 * assert: the version contract applies to the template's layout and is
 * meaningless in a project's, where there is no upstream file to stay in sync
 * with. The audit therefore decides which layout it is looking at, then applies
 * the rule that belongs to that layout.
 *
 * Detecting the layout from the file set — rather than tolerating whatever is
 * present — is what keeps a half-finished swap from passing. That state
 * (`claude.md` replaced, `AGENTS.md` still the maintainer copy) is the one
 * `docs/using-ai.md` warns about, and it is invisible to a check that simply
 * skips missing files.
 */

/** Files an AI tool reads. In this repository, the maintainer guidance. */
export const MAINTAINER_FILES = [
  "claude.md",
  "AGENTS.md",
  ".github/copilot-instructions.md",
];

/** Their downstream counterparts, renamed into place by a new project. */
export const DOWNSTREAM_FILES = [
  "claude-for-users.md",
  "AGENTS-for-users.md",
  ".github/copilot-instructions-for-users.md",
];

const VERSION_DECLARATION = /^\*\*Instruction contract version:\*\*\s*(\S+)\s*$/m;
const SEMVER = /^\d+\.\d+\.\d+$/;

/**
 * The instruction contract version a file declares.
 *
 * @param {string} contents File contents.
 * @returns {string | null} The declared version, or `null` when there is none.
 */
export const declaredVersion = (contents) =>
  VERSION_DECLARATION.exec(contents)?.[1] ?? null;

/**
 * The counterpart of a maintainer file, by position.
 *
 * @param {string} name A path from {@link MAINTAINER_FILES}.
 * @returns {string} The matching path from {@link DOWNSTREAM_FILES}.
 */
const counterpartOf = (name) => DOWNSTREAM_FILES[MAINTAINER_FILES.indexOf(name)];

/**
 * Check a set of instruction files against the contract.
 *
 * @param {Map<string, string>} files Present files only, keyed by
 *   repository-relative path. Absent from the map means absent from the
 *   repository.
 * @returns {{ layout: "template" | "downstream" | "none", problems: string[] }}
 *   `layout` is what the file set looks like; `problems` is empty when the
 *   layout satisfies its own rule, and otherwise holds one message per defect,
 *   each naming the file and what to do about it.
 */
export function auditInstructionFiles(files) {
  const present = (name) => files.has(name);
  const counterpartsPresent = DOWNSTREAM_FILES.filter(present);
  const inPlacePresent = MAINTAINER_FILES.filter(present);

  if (counterpartsPresent.length === 0 && inPlacePresent.length === 0) {
    return { layout: "none", problems: [] };
  }

  // A counterpart still on disk means the swap has not happened, so this is the
  // template's own layout and the full version contract applies.
  if (counterpartsPresent.length > 0) {
    return { layout: "template", problems: auditTemplateLayout(files) };
  }

  return { layout: "downstream", problems: auditDownstreamLayout(files) };
}

/**
 * Apply the template's rule: all six files present, the three maintainer files
 * declaring one identical Semantic Version, the three counterparts declaring
 * none.
 *
 * @param {Map<string, string>} files
 * @returns {string[]}
 */
function auditTemplateLayout(files) {
  const problems = [];

  for (const name of MAINTAINER_FILES) {
    const counterpart = counterpartOf(name);

    if (!files.has(name)) {
      problems.push(
        `${name} is missing while ${counterpart} is still present — restore it, or finish the swap by moving every counterpart into place`,
      );
      continue;
    }

    if (!files.has(counterpart)) {
      problems.push(
        `${name}'s counterpart ${counterpart} is missing while other counterparts remain — a half-finished swap: move every counterpart into place, or restore ${counterpart}`,
      );
      continue;
    }

    const version = declaredVersion(files.get(name));

    if (version === null) {
      problems.push(
        `${name} declares no instruction contract version — add one, or if this project completed the swap, remove the leftover counterpart files`,
      );
    } else if (!SEMVER.test(version)) {
      problems.push(
        `${name} declares "${version}", which is not a Semantic Version like 3.0.0`,
      );
    }
  }

  for (const name of DOWNSTREAM_FILES) {
    if (files.has(name) && declaredVersion(files.get(name)) !== null) {
      problems.push(
        `${name} declares an instruction contract version — the downstream files carry none, because a single application has no upstream file to stay in sync with`,
      );
    }
  }

  // Only well-formed versions can disagree. A malformed one was already
  // reported above, and repeating it here would turn one mistake into two
  // findings.
  const versions = new Set(
    MAINTAINER_FILES.filter((name) => files.has(name))
      .map((name) => declaredVersion(files.get(name)))
      .filter((version) => version !== null && SEMVER.test(version)),
  );

  if (versions.size > 1) {
    problems.push(
      `the maintainer instruction files declare different contract versions: ${[...versions].sort().join(", ")}`,
    );
  }

  return problems;
}

/**
 * Apply a project's rule: the counterparts are gone, so nothing may still claim
 * a contract version. Which of the three files a project keeps is its own
 * business — an application that only uses one AI tool needs only one file.
 *
 * @param {Map<string, string>} files
 * @returns {string[]}
 */
function auditDownstreamLayout(files) {
  return MAINTAINER_FILES.filter((name) => files.has(name))
    .filter((name) => declaredVersion(files.get(name)) !== null)
    .map(
      (name) =>
        `${name} still declares an instruction contract version, but the -for-users counterparts are gone — this file describes one application now, so delete the version line`,
    );
}
