import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DOWNSTREAM_FILES,
  MAINTAINER_FILES,
  auditInstructionFiles,
} from "../helpers/instruction-files.js";

const VERSIONED = "# Guide\n\n**Instruction contract version:** 3.0.0\n";
const UNVERSIONED = "# Guide\n\nNo contract version here.\n";

/**
 * Build a file set for the audit: present files only, keyed by repository-
 * relative path. A path that is absent from the map is absent from the
 * repository, which is the distinction every case below turns on.
 *
 * @param {Array<[string, string]>} entries
 * @returns {Map<string, string>}
 */
const fileSet = (entries) => new Map(entries);

/** The layout this repository ships: three maintainer files, three counterparts. */
const templateLayout = () =>
  fileSet([
    ...MAINTAINER_FILES.map((name) => [name, VERSIONED]),
    ...DOWNSTREAM_FILES.map((name) => [name, UNVERSIONED]),
  ]);

/** The layout a downstream project has after the documented `mv` swap. */
const downstreamLayout = () =>
  fileSet(MAINTAINER_FILES.map((name) => [name, UNVERSIONED]));

/**
 * Read whichever of the six instruction files this repository actually has.
 *
 * @returns {Promise<Map<string, string>>}
 */
async function readRepositoryFiles() {
  const present = await Promise.all(
    [...MAINTAINER_FILES, ...DOWNSTREAM_FILES].map(async (name) => {
      try {
        return [name, await readFile(new URL(`../../${name}`, import.meta.url), "utf8")];
      } catch {
        return null;
      }
    }),
  );

  return fileSet(present.filter(Boolean));
}

describe("instruction file layout", () => {
  it("accepts this repository's own layout", () => {
    const { layout, problems } = auditInstructionFiles(templateLayout());

    assert.equal(layout, "template");
    assert.deepEqual(problems, []);
  });

  it("accepts a downstream project that completed the documented swap", () => {
    const { layout, problems } = auditInstructionFiles(downstreamLayout());

    assert.equal(layout, "downstream");
    assert.deepEqual(problems, []);
  });

  it("accepts a project that deleted all six files", () => {
    const { layout, problems } = auditInstructionFiles(fileSet([]));

    assert.equal(layout, "none");
    assert.deepEqual(problems, []);
  });

  it("rejects a half-finished swap", () => {
    // `mv claude-for-users.md claude.md` ran; the other two never did. This is
    // the state "ignore the counterparts when they are missing" would wave
    // through, and the one docs/using-ai.md warns about by name.
    const files = templateLayout();
    files.set("claude.md", UNVERSIONED);
    files.delete("claude-for-users.md");

    const { problems } = auditInstructionFiles(files);

    assert.equal(problems.length, 1);
    assert.match(problems[0], /claude\.md/);
  });

  it("rejects a leftover contract version after the swap", () => {
    const files = downstreamLayout();
    files.set("AGENTS.md", VERSIONED);

    const { layout, problems } = auditInstructionFiles(files);

    assert.equal(layout, "downstream");
    assert.equal(problems.length, 1);
    assert.match(problems[0], /AGENTS\.md/);
  });

  it("rejects maintainer files whose versions disagree", () => {
    const files = templateLayout();
    files.set("AGENTS.md", "**Instruction contract version:** 2.9.0\n");

    const { problems } = auditInstructionFiles(files);

    assert.equal(problems.length, 1);
    assert.match(problems[0], /3\.0\.0|2\.9\.0/);
  });

  it("rejects a maintainer file with no version at all", () => {
    const files = templateLayout();
    files.set(".github/copilot-instructions.md", UNVERSIONED);

    const { problems } = auditInstructionFiles(files);

    assert.equal(problems.length, 1);
    assert.match(problems[0], /copilot-instructions\.md/);
  });

  it("rejects a version that is not a Semantic Version", () => {
    const files = templateLayout();
    files.set("claude.md", "**Instruction contract version:** 3.0\n");

    const { problems } = auditInstructionFiles(files);

    assert.equal(problems.length, 1);
    assert.match(problems[0], /claude\.md/);
  });

  it("rejects a versioned counterpart", () => {
    const files = templateLayout();
    files.set("AGENTS-for-users.md", VERSIONED);

    const { problems } = auditInstructionFiles(files);

    assert.equal(problems.length, 1);
    assert.match(problems[0], /AGENTS-for-users\.md/);
  });

  it("rejects a missing maintainer file while counterparts remain", () => {
    const files = templateLayout();
    files.delete("claude.md");

    const { problems } = auditInstructionFiles(files);

    assert.equal(problems.length, 1);
    assert.match(problems[0], /claude\.md/);
  });

  it("holds for the instruction files actually in this repository", async () => {
    // Deliberately layout-agnostic: this same test ships downstream, where the
    // swap has happened and the version contract no longer applies.
    const { problems } = auditInstructionFiles(await readRepositoryFiles());

    assert.deepEqual(problems, []);
  });
});
