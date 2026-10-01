# Contributing

Thanks for helping improve this template. This guide is for changing **the template itself**. If you are building an application from it, read [Using this template](docs/using-this-template.md) instead.

## What this repository is

This is upstream boilerplate that other projects start from. A change here can reach every project generated from it, so the bar is different from a normal application repository:

- Keep the base Worker small. Application-specific logic belongs in projects, not here.
- Every addition needs a documented purpose, a local-development story, a test strategy, and a removal path.
- Changes must be adoptable deliberately. Downstream projects review upstream diffs; they never blind-copy them.

The full maintenance contract is [claude.md](claude.md). This document is the practical workflow.

## Prerequisites

- Node.js 22. `.nvmrc` is the source of truth, so `nvm use` picks the right version; `engines.node` in `package.json` and every workflow read from it, and a contract test keeps the three in agreement.
- npm
- A GitHub account with access to this repository

No Cloudflare account is required to contribute. The whole test suite runs locally.

```sh
git clone https://github.com/mbakaitis/cloudflare-workers-discord-template.git
cd cloudflare-workers-discord-template
npm install
npm test
```

## Branching

Create a short-lived branch and open a pull request. Branch names must be `feature/<name>`, `release/<name>`, or `hotfix/<name>`, using lowercase letters, numbers, dots, underscores, or hyphens after the prefix. Include the issue number when the work comes from an issue:

```sh
git switch main
git pull --ff-only
git switch -c feature/12-clarify-binding-docs
```

> **Note:** This template repository itself has no `develop` branch and deploys nothing, so contributions branch from `main` and target `main`. The `develop` → `main` promotion flow described in [Gitflow and branching](docs/gitflow-and-branching.md) is what *generated projects* use, and the deployment workflow implements it for them.

Reference issues in commit messages with a closing keyword so GitHub links and closes them on merge:

```sh
git commit -m "Clarify binding placement rules; fixes #12"
```

## The change loop

1. **Read first.** Check the relevant section of [claude.md](claude.md) and the current Cloudflare or Wrangler documentation. Do not rely on stale examples.
2. **Write a failing test.** Behavior changes follow red-green-refactor. Bug fixes get a regression test that fails before the fix.
3. **Make the smallest change** consistent with the existing patterns.
4. **Run the checks.**

   ```sh
   npm test        # unit tests with coverage, plus configuration contract tests
   npm run lint
   ```

5. **Update the docs in the same change.** If you change a command, a file layout, or a workflow, update the README and the affected guide together with the code.
6. **Add a changeset** unless the change is exempt (below).
7. **Report what you ran** in the pull request, including any check you could not run and why.

### Documentation-only changes

A change that touches only Markdown files — no source, test, configuration, script, lockfile, or workflow file — does not require tests, lint, or Wrangler validation. Verify instead that the commands, paths, and links you mention actually exist, and say in the pull request that validation was skipped as documentation-only. A changeset is optional for these.

This exemption disappears the moment the same change also touches code or configuration.

## Testing expectations

`npm test` runs two suites and a coverage gate, and all three matter:

- **Unit tests** (`test/index.test.js`, Vitest via `@cloudflare/vitest-pool-workers`) exercise the Worker in the real Workers runtime through Miniflare. Cover success, malformed input, and expected error responses.
- **Contract tests** (`test/contracts/`, Node's built-in test runner) protect the promises of the boilerplate — that non-production and production Workers stay distinct, that production bindings never sit at the top level, that deployment stays opt-in, and that the release workflow keeps its shape.

Keep tests deterministic: no live Cloudflare calls, no shared mutable state, no wall-clock dependence, no undeclared credentials.

### Template-only contract tests

Contract tests ship downstream, so a test that only passes in this repository's layout is a defect in the template — a project built from it would fail `npm test` on its first run through no fault of its own. Some assertions are still worth making about *this* checkout, though: that the template declares exactly two environments, that it wires up exactly the three documented MCP servers at their documented URLs, that `.dev.vars.example` holds nothing but placeholders.

Those live in a file named `test/contracts/<subject>.template-only.test.js`, beside the shipped `<subject>.test.js` it was split from:

- The `.template-only.test.js` suffix is matched by the existing `test/contracts/*.test.js` glob in the `test:contracts` script, so no `package.json` change is needed. Do not use a subdirectory instead — `node --test` against a directory applies its own default patterns, which also match non-test `.js` files under `test/`.
- A project created from this template deletes these files whole. Nothing in a `.template-only.test.js` file may be imported by a sibling that ships, so repeat a small shared constant rather than exporting it from the template-only side.
- When you split an assertion out, the shipped half must keep asserting the underlying promise in a relaxed form, not lose it. `workflow.test.js` no longer pins the MCP server list; it asserts that `.mcp.json` and `.vscode/mcp.json` declare the *same* set, that every entry is `{ type, url }`, and that no entry carries a credential-shaped key. `discord.test.js` no longer pins the environment set; it asserts that both a non-production and a production environment exist, leaving a project free to add a third.
- Prove the relaxed form can still fail before you call the split done. Break the thing it guards, watch it go red, and revert. A guard nobody has seen fail is not a guard.
- **Register it in [template-manifest.json](template-manifest.json).** A `.template-only.test.js` file that nobody added to the manifest's `prune` list ships to a project that cannot pass it. `test/contracts/manifest.template-only.test.js` reads `test/contracts/` and fails on any template-only file the manifest does not name, so this is enforced rather than remembered. The same rule applies to anything else added here that is template-only, not just tests.

### Template-owned surface: the manifest and the payload

Two things in this repository exist only to turn a copy of it into somebody's project, and both are read by `npm run setup`:

| Path | What belongs in it |
| --- | --- |
| [template-manifest.json](template-manifest.json) | Declarative data, no logic: the paths a new project prunes, the `.changeset/*.md` glob, the directories it removes whole, the `.template/` payload's copy destinations, the six instruction files as maintainer/downstream pairs, the placeholder tokens, and the paths and npm scripts setup deletes as its last act |
| [.template/](.template/) | The downstream replacements for the documents written from the template's point of view — `README.md`, `CHANGELOG.md`, `docs/using-ai.md`, `docs/using-this-template.md` — as real Markdown files with `{{PLACEHOLDER}}` tokens |

The payload is files rather than strings in a script on purpose. Prose does not belong in JavaScript string literals, and rewriting Markdown sections by regex is the part most likely to break silently on a future edit. Only the documents whose *entire* framing is template-specific get a shipped replacement; everything else survives, with its links to pruned pages rewritten to the upstream blob URL.

**The standing rule: anything you add to this repository that is template-only must be registered in the manifest in the same change.** A file that exists only to maintain the template and is not in `prune` ships to a project that has no use for it, and often cannot pass it. `test/contracts/manifest.template-only.test.js` enforces the parts it can — every path the manifest names must exist, every `.template/` file must have exactly one destination, every placeholder must be both declared and used, and every `*.template-only.test.js` file must be pruned — so a manifest that drifts from the repository fails `npm test` rather than surfacing in somebody's new project.

The reverse also needs saying: `npm run setup:github` is **not** template-only. It is idempotent and it verifies rather than only applying, so re-running it is how a project re-checks its GitHub settings. `test/contracts/setup-github.template-only.test.js` asserts that the manifest leaves it, its library, its shipped test, and its npm script alone.

### The fresh-project acceptance check

The template's central claim is that `npm run setup` turns a fresh copy into a project that is green with no manual edits. Two checks hold it, at two speeds, because the fast one cannot prove the claim and the slow one cannot live in the unit suite:

- `test/contracts/setup-acceptance.template-only.test.js` runs in `npm test`. It builds a project from `git archive HEAD` into a temporary directory, runs setup there unattended, and asserts the *shape* of the result: nothing template-only left behind, every payload destination written, no unsubstituted `{{PLACEHOLDER}}`, no dangling relative link, no credential-shaped literal. It takes about half a second and it never installs anything.
- `.github/workflows/template-acceptance.yml` is the slow half, and the only thing that proves "green". It does the same build in CI and then runs `npm ci`, `npm run lint`, and the full `npm test` inside the generated project. It is a separate workflow rather than a job in `ci.yml`: the branch-protection required status check is named `test` and that name must keep meaning the job in `ci.yml`, and this workflow spawns a script that deletes itself during setup, so the manifest prunes the whole file rather than cutting a job out of a surviving one.

Because the fast check archives `HEAD`, a file added in your working tree is invisible to it until you commit. Commit before reading too much into a local pass; CI checks out the merge commit and sees everything.

A change that adds an inbound link to `docs/using-this-template.md`, or a document to the `.template/` payload, will show up here first. That is the point — the alternative is a new project discovering it.

### Coverage is a ratchet

`npm test` measures coverage over `src/` and `scripts/lib/` and fails when it drops below the thresholds in [vitest.config.js](vitest.config.js). The provider is Istanbul, not V8, because tests run inside `workerd` and V8 coverage does not work in the Workers pool.

The rule is one-directional:

- **Never lower a threshold to make a change pass.** If new code cannot reach the current level, the fix is a test, or a design that is testable without a network — usually injecting the dependency instead of reaching for it. Lowering the number converts a reviewed promise into a silent regression.
- **Raise a threshold by hand** in the same pull request that measures higher. `coverage.thresholds.autoUpdate` would do this for you and is deliberately not used: a threshold that rises without anyone noticing is not a promise anyone made. The new number belongs in the diff.
- A contract test asserts the thresholds exist and are non-zero, so the ratchet cannot be quietly deleted. It does not assert the values — that would just be a second place to update, and the reviewed diff is the real control.

Run `npx vitest run --coverage` while iterating; the console report lists the uncovered lines, and `coverage/index.html` shows the uncovered branches. Both are gitignored.

If a contract test fails, that is usually the point. When a change *intentionally* breaks a promise, update the test, the documentation, and the migration notes in the same pull request, and classify the release accordingly.

## Changesets

Record the downstream impact of anything that changes the template contract:

```sh
npm run changeset
npm run changeset:status
```

Choose `patch` for compatible fixes, docs, tests, and dependency bumps; `minor` for compatible capabilities or new extension points; `major` for breaking changes to scripts, file layout, runtime assumptions, environments, bindings, or migration requirements. Commit the generated `.changeset/*.md` file with the pull request. See [Versioning and changesets](docs/versioning-and-changesets.md) for how a changeset becomes a version and a tag.

## Keeping the instruction files in sync

Three files carry maintenance guidance for AI assistants and must agree:

| File | Role |
| --- | --- |
| [claude.md](claude.md) | Canonical maintenance guide |
| [AGENTS.md](AGENTS.md) | Entry point for tools that read `AGENTS.md` |
| [.github/copilot-instructions.md](.github/copilot-instructions.md) | Entry point for GitHub Copilot |

If you change a requirement in one, update the other two in the same pull request, and update the **instruction contract version** in all three headers. That version is separate from the `package.json` version:

- **Patch** — clarify wording, fix a typo, add an example.
- **Minor** — add a compatible requirement that does not invalidate the existing project structure.
- **Major** — change a requirement so that maintainers or downstream projects must revise their workflow.

Each maintainer file has a downstream counterpart — `claude-for-users.md`, `AGENTS-for-users.md`, `.github/copilot-instructions-for-users.md` — written for an application built from the template rather than for maintaining it. They don't carry the instruction contract version, since a single application has no upstream file to stay in sync with. When a change to a maintainer file also affects what a downstream application should do (TDD, environment isolation, secrets handling, treating MCP results as research), mirror it into the matching `-for-users` file in the same pull request; when a change is specific to maintaining this template, it does not belong there. See [The instruction files](docs/using-ai.md#the-instruction-files) for the full breakdown of what belongs in each set.

`test/contracts/instructions.template-only.test.js` enforces the mechanical half of that: all six files present, one identical Semantic Version across the maintainer three, and no version on the counterparts. It cannot tell whether the *content* was mirrored, so that part is still a review responsibility.

The audit it drives still detects which of the three layouts it is looking at — template, swapped project, or no AI files at all — and applies the matching rule, because a half-finished swap is the failure mode worth catching; see `test/helpers/instruction-files.js`. The test is [template-only](#template-only-contract-tests) because the contract version it enforces is the template's, and a project has no upstream file to stay in sync with. If you change the file names or the version header, change that helper in the same pull request, and keep every layout covered.

## Pull request expectations

- CI passes.
- At least one approving review, with review threads resolved.
- The diff contains no secrets, no cross-wired environments, and no unrelated lockfile or configuration churn.
- Documentation, changelog impact, and release classification agree with the code.
- The description says what changed, whether downstream projects need to act, and how to roll back.

## Please do not

- Commit secrets, `.dev.vars`, populated `.env` files, private Cloudflare account identifiers, or generated deployment state.
- Point local or non-production configuration at production data stores, queues, buckets, or services.
- Add TypeScript as a project requirement. The implementation stays JavaScript with JSDoc on exported functions, Worker handlers, configuration contracts, and non-obvious behavior.
- Add a dependency, binding, service, or deployment target because it might be useful later.
- Broaden MCP permissions or add credentials to shared configuration to make a task convenient. Keep `.claude/settings.local.json` local and permission-scoped.
- Enable `DEPLOY_ENABLED` on this template repository. It stays unset here by design.

## Where things live

| Path | Contents |
| --- | --- |
| `src/` | Worker source; `src/index.js` is the entry point and routes only |
| `src/discord/` | Discord protocol modules: signature verification, response builders |
| `test/` | Unit tests |
| `test/helpers/` | Test fixtures, including the Ed25519 interaction signer |
| `test/contracts/` | Contract tests protecting the template's promises |
| `docs/` | User-facing guides |
| `.github/workflows/` | CI, deployment, release, and the fresh-project acceptance run |
| `.changeset/` | Pending release notes |
| `scripts/` | The template's own CLIs; `scripts/lib/` holds their pure halves, inside the coverage ratchet |
| `wrangler.jsonc` | Worker names, compatibility date, environments, bindings |
| `template-manifest.json` | What is template-only: the paths a new project prunes, the payload's destinations, the instruction-file pairs |
| `.template/` | The downstream replacements `npm run setup` copies over the template-framed documents |
| `.template/` | The downstream replacements for the documents written from the template's point of view, with `{{PLACEHOLDER}}` tokens |
| `scripts/lib/setup.js` | The pure planner that turns the manifest into an ordered list of operations |
