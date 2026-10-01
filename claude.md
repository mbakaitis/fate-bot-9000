# Cloudflare Workers Discord Bot Template Maintainer Guide

**Instruction contract version:** 3.1.0

This repository is the versioned boilerplate for a Discord bot on Cloudflare Workers. Its default application serves Discord HTTP interactions from a Worker and registers its own slash commands, so a new project starts from something that already works end to end. It must remain useful when copied into a new Worker project and must make future Cloudflare, Wrangler, Discord, and platform changes deliberate, testable, and documented.

## Mission and scope

- Keep the smallest practical Discord bot that developers can install with Wrangler and extend: an interactions endpoint, a command registry, and a registration path — and no more. The bot is a worked example of the platform's shape, not a feature-complete framework.
- Treat this repository as a product: preserve a clear upgrade path, stable defaults, and a changelog.
- Prefer Cloudflare's current official documentation and supported Wrangler behavior over assumptions or stale examples.
- Keep template concerns separate from application-specific business logic. A template change should be easy to identify and safely adopt.

## Source of truth and instructions

- This file is the canonical maintenance guide. `AGENTS.md` and `.github/copilot-instructions.md` are entry points for tools that use those filenames; keep them aligned with this file.
- This file, `AGENTS.md`, and `.github/copilot-instructions.md` describe *maintaining the template*. They are not meant to be edited in place by a downstream project — that produces a file that is neither the template's guidance nor a coherent application guide. Instead, this repository ships a second, downstream-facing set: `claude-for-users.md`, `AGENTS-for-users.md`, and `.github/copilot-instructions-for-users.md`. `npm run setup` performs the swap for a new project as part of its one-time run (see "Run `npm run setup`" in `docs/using-this-template.md`), and `template-manifest.json` carries the three pairs as data rather than hardcoding them in the script. The `-for-users` files carry no instruction contract version and no upstream-sync expectation, because a single application does not need either.
- When a change here affects what a downstream application should also do — TDD, environment isolation, secrets handling, treating MCP results as research rather than authorization — mirror it into the matching `-for-users` file in the same change. When a change is specific to maintaining *this* template (mission and scope, downstream alignment, the instruction contract version itself), it does not belong in the `-for-users` files.
- Keep the instruction contract version in this file and its adapter files aligned. Use Semantic Versioning: patch for clarifications, minor for compatible requirements, and major for breaking instruction changes.
- Before changing platform configuration, consult current Cloudflare documentation for Workers, Wrangler, environments, compatibility dates, bindings, secrets, deployments, and testing. When available, use the configured Cloudflare documentation MCP server in `.mcp.json` or `.vscode/mcp.json` for this lookup.
- Before changing interaction handling, command definitions, or registration, confirm the current requirements against Discord's official developer documentation and cite what you find. Discord's interaction contract — required headers, response types, acknowledgement windows, and the bulk-overwrite semantics of registration — is not stable enough to work from recall. Use Discord's documentation MCP server for this lookup when it is configured.
- Treat MCP results as documentation research, not as authorization to change accounts, deploy code, create resources, or handle secrets. Verify important platform claims against the current official documentation and record the relevant documentation link or decision in repository docs when it affects the template contract.
- Keep `.mcp.json` and `.vscode/mcp.json` limited to non-secret server configuration. `.mcp.json` uses the Claude-compatible `mcpServers` schema; `.vscode/mcp.json` uses VS Code's `servers` schema. Keep `.claude/settings.local.json` local and permission-scoped; never add credentials or broaden MCP permissions merely to make a task convenient.
- Record important decisions and breaking changes in repository documentation. Do not rely on an issue, chat message, or implicit knowledge.
- Keep instructions actionable: name the command, file, invariant, or acceptance check whenever possible.
- GitHub Rulesets' metadata-restriction rule types (`branch_name_pattern`, `tag_name_pattern`, `commit_message_pattern`, and the author/committer email pattern rules) require GitHub Team or Enterprise and are rejected on Free/Pro regardless of repository visibility. This template does not rely on them; branch naming is enforced by review only.
- Applying a ruleset with `npm run setup:github` and verifying the readback is the documented path. The script builds the ruleset at run time, sends it, reads back what GitHub stored, and names every difference — because an imported payload can save with fewer rules than it declares depending on plan tier, organization policy, and repository visibility, and GitHub says nothing when it drops one. A `201` is evidence that the request was accepted, not that the rules exist.
- Committing a GitHub Ruleset or branch-protection JSON payload as if it were an applied artifact is still forbidden. A file in this repository can silently stop matching what GitHub actually enforces, and one that looks authoritative is worse than none. Keep the settings documented as a table a maintainer can read and check (see `docs/using-this-template.md`), let the script build the payload, and let the readback be the record.
- Contract tests still never check live GitHub settings. They verify only what a checkout can observe — for example, that the CI job a required status check depends on still exists and is still named `test`, or that the requested configuration and a fixture readback diff the way they should. No test may contact GitHub.

## Required project shape

The implementation should normally include, or document why it does not include:

- A minimal Worker entry point with an explicit `fetch` handler, a small health/basic response, and the Discord interactions route described below.
- JavaScript source using ES modules with mandatory JSDoc. Document exported functions, Worker handlers, configuration contracts, and non-obvious behavior so developers and AI tools can understand the code without reconstructing intent. Do not introduce TypeScript as a project requirement.
- Wrangler configuration in the current supported format, with an explicit `compatibility_date` and Cloudflare best practices enabled:
  - **Observability enabled**: The `observability.enabled` setting captures logs and telemetry for monitoring and debugging.
  - **No generated TypeScript binding types**: This is a JavaScript project, so it does not carry a `types` script or commit generated binding types. Document bindings with JSDoc instead. A downstream project may run `npx wrangler types` on demand for editor autocomplete, but the template must not require it, document it as a workflow step, or depend on the generated file.
  - **Node.js compatibility**: For compatibility dates `2026-08-04` or later, Node.js APIs are enabled by default and no explicit flag is required.
  - Do not commit generated credentials, API tokens, or real secrets.
- Separate `local`, `staging` (non-production Cloudflare), and `production` workflows. Use Wrangler named environments and environment-specific configuration rather than ad hoc flags.
- Explicit rules for which bindings, routes, variables, and resources exist in each environment. Production resources must never be silently reused by local or staging work.
- A local-development path that works without access to production resources. Use local emulation, fixtures, or explicit local bindings where appropriate.
- A single declared Node.js version. `.nvmrc` is the source of truth; `engines.node` in `package.json` and every workflow's `node-version-file` must agree with it, and a contract test enforces that. Do not hardcode a Node version in a workflow.
- A mandatory test setup that runs quickly in CI and locally, with unit tests for the Worker handler and meaningful tests for environment-sensitive behavior.
- Documentation covering setup, development, testing, deployment, secrets, environments, and upgrades.
- `template-manifest.json` and the `.template/` payload directory, which are how a new project stops being a copy of the template. The manifest is declarative data — prune paths, prune globs, prune directories, copy destinations, the three instruction-file pairs, the placeholder tokens, and what `npm run setup` deletes of itself. `.template/` holds the downstream replacements for the documents written from the template's point of view, as real Markdown files with `{{PLACEHOLDER}}` tokens rather than prose embedded in a script. **Anything added to this repository that is template-only must be registered in the manifest in the same change**; `test/contracts/manifest.template-only.test.js` fails on a manifest that names a path which no longer exists and on a `*.template-only.test.js` file the manifest does not prune. A permanent script is the exception and must stay out of `prune` and `selfDelete` — `npm run setup:github` is one, because it verifies as well as applies and is meant to be re-run.

Do not add a service, binding, dependency, or deployment target merely because it may be useful later. Every addition needs a documented purpose, ownership, local-development story, test strategy, and rollback or removal path.

### Discord requirements

These are contract, not convention. Each one exists because getting it wrong is either a security failure or a silent divergence between what the Worker serves and what Discord thinks exists.

- **Mandatory signature verification.** The interactions endpoint performs Ed25519 signature verification on every request and returns `401` when verification fails. There is no bypass, no development flag that disables it, and no code path that parses a body before verifying the signature that covers it — the signature is over the raw bytes, so reading the raw body must come first. Discord validates this when an Interactions Endpoint URL is saved, and an unverified endpoint is an open door for forged interactions.
- **Command definitions are data, shared by one source.** Command definitions live as plain data that both the Worker and the registration script import. Neither may carry its own copy, because two copies drift and the failure is invisible: Discord advertises a command the Worker does not handle, or the Worker handles one Discord never registered. A definition module must stay importable from plain Node — no `cloudflare:workers` imports — so the registration script can read the same definitions the Worker dispatches.
- **One Discord application per environment.** Non-production and production use separate Discord applications, each with its own public key, application ID, and bot token. A non-production Worker never holds production Discord credentials. This is the same isolation rule the template already applies to Cloudflare environments, extended to Discord: `DISCORD_PUBLIC_KEY`, `DISCORD_APPLICATION_ID`, and `DISCORD_TOKEN` are per-environment secrets, supplied through Cloudflare's secret mechanisms or CI secret storage and never committed.
- **Never log interaction payloads or credentials.** Do not log interaction payloads, interaction tokens, or bot tokens — not in error handlers, not behind a debug flag, not in a test fixture that gets committed. Interaction payloads carry user content and an interaction token is a short-lived credential that can post as the bot. Observability is enabled in this template, so a log line is a durable record, not a transient console write.
- **Registration is part of the contract.** The command registration script and its npm scripts are template-owned surface, covered by the same expectations as the Worker: unit-tested logic, a documented dry-run path that contacts nothing, and no credential in output including error paths. Changing or removing them is a contract change requiring migration notes.

## Environment and deployment rules

Use the repository's package scripts as the stable interface for contributors. A typical contract is:

- `npm run dev`: run the Worker locally with Wrangler.
- `npm run lint`: run JavaScript lint checks.
- `npm test`: run the unit test suite.
- `npm run deploy:non-prod`: deploy only the named non-production environment.
- `npm run deploy:production`: deploy only production, with an explicit confirmation or CI protection where practical.
- `npm run register:non-prod` and `npm run register:production`: register the command definitions with the environment's own Discord application, guild-scoped for non-production and global for production.
- `npm run register:dry-run`: print the registration plan — target URL, redacted headers, and body — without contacting Discord.
- `npm run setup`: the one-shot that turns a copy of this template into a project — renames, swaps the instruction files, prunes what the manifest names, records provenance, and deletes itself. It refuses to run twice or on a dirty tree, supports `--dry-run`, and never echoes the contents of `.dev.vars`.
- `npm run setup:github`: apply the GitHub environments, the `DEPLOY_ENABLED` variable, and the branch ruleset, then read each one back and report every divergence, exiting non-zero when one is found. Permanent and idempotent, unlike `npm run setup`. It sets no secret value and reports only secret *names*. `--dry-run` must run no `gh` at all, preflight included.

The exact scripts may change, but their intent must remain documented. Before merging deployment changes:

1. Confirm the target environment and account/project identifiers are explicit.
2. Confirm local and staging cannot point at production data stores, queues, buckets, or services by default.
3. Confirm secrets are supplied through Cloudflare's secret mechanisms or CI secret storage, never committed to source or `.env` files.
4. Confirm the compatibility date and any compatibility flags are intentional and documented.
5. Confirm a rollback or previous-version procedure exists.
6. Confirm each environment targets its own Discord application, and that no non-production path can register commands against, or authenticate as, the production application. Note that redeploying an older Worker does not roll back a command registration — the two roll back independently.

For CI/CD, prefer immutable, reviewable deployments from the protected default branch. Pin or constrain action and tool versions where practical, and keep Wrangler's version aligned with the supported Cloudflare workflow. Avoid deploying from a developer laptop as the only production path.

## Testing and TDD

- Follow red-green-refactor TDD for every behavior change: write a failing test, implement the smallest change, then refactor.
- Treat solid unit and regression tests as mandatory for long-term template stability; do not merge behavior changes without focused coverage.
- Keep pure logic easy to test without a network, Cloudflare account, or deployed Worker.
- Test the Worker handler through the runtime-compatible test utilities used by the project, including success, malformed input, expected error responses, and relevant binding behavior.
- Add a regression test for every bug fixed in the template.
- Treat the coverage thresholds in `vitest.config.js` as a ratchet over `src/` and `scripts/lib/`. Raise them by hand in the same change that measures higher, so the new number is reviewed; never lower one to make a change pass, and do not enable `coverage.thresholds.autoUpdate`. When new code cannot reach the current level, the answer is a test or an injectable dependency, not a smaller number. The provider must stay `istanbul` — V8 coverage does not work in the Workers pool.
- Test configuration and scripts enough to catch accidental environment drift, especially staging/production target mix-ups.
- Keep tests deterministic: no live production calls, shared mutable state, wall-clock dependence, or undeclared credentials.
- Test the Discord surface offline. Sign interaction fixtures with a test-only Ed25519 key so signature verification is genuinely exercised rather than stubbed, inject the Discord REST client so no test reaches the network, and take test credentials from the test-pool `env` — never from a real Discord application. Assert that deferred follow-ups actually happened, not merely that they were scheduled.
- Run the narrowest relevant test first, then the full required checks before merging.

At minimum, changes should pass unit tests, JavaScript linting, formatting if configured, and a Wrangler/configuration validation step. CI should run the same checks developers are instructed to run locally.

### Documentation-only changes

A change that touches only Markdown files, and no source, test, configuration, script, lockfile, or workflow file, does not require unit tests, linting, formatting, or Wrangler/configuration validation. Review it instead for accuracy: confirm that referenced commands, scripts, file paths, and internal links still exist and match the repository, and that the guidance does not contradict the instruction files. Say in the change report that validation was skipped because the change is documentation-only.

This exemption does not apply when the same change also edits code or configuration, and it does not remove the requirement to keep documentation, changelog, and migration notes consistent.

## Downstream alignment

This repository is an upstream template, not a remote package that can safely overwrite application code. Design changes so a downstream project can compare and adopt them deliberately:

- Keep template-owned files and extension points obvious.
- Avoid edits that require blind copying over downstream business logic.
- Mark intentional downstream customizations in documentation or configuration, not by silently diverging.
- Document migration steps for renamed files, changed scripts, Wrangler schema changes, runtime changes, and removed defaults.
- Include a template version in the repository or generated project metadata when practical. A downstream project should be able to identify the upstream version it started from.
- Use a repeatable process (for example, `git cherry-pick` against a fetched `upstream` remote — see `docs/using-this-template.md`) and review the diff before applying upstream changes.
- Add contract tests that protect the promises of the boilerplate. When an upstream change intentionally changes a promise, update the tests and migration notes together.
- `claude-for-users.md`, `AGENTS-for-users.md`, and `.github/copilot-instructions-for-users.md` are the template's designated extension point for AI-tool guidance in a downstream project. Keep them free of template-maintenance-only content — no mission/scope, no instruction contract version, no upstream-adoption process — so a downstream project can rename them into place without translation.
- Contract tests ship downstream, so a test that only passes in this repository's layout is a defect in the template. There are two ways to hold that line, and both are in use. Relax the shipped assertion until it states the promise rather than this checkout: `test/contracts/workflow.test.js` asserts that `.mcp.json` and `.vscode/mcp.json` declare the *same* set of servers and that no entry carries a credential, not which three servers they happen to be. Or split the checkout-specific half into `test/contracts/<subject>.template-only.test.js`, a file a project created from this template deletes whole — `instructions.template-only.test.js` holds the instruction-contract-version audit for exactly that reason. Nothing in a template-only file may be imported by a sibling that ships, and a split is not done until the relaxed half has been seen to fail. `CONTRIBUTING.md` carries the convention; hold any new contract test to it — assert the promise, not this checkout's file list.

Do not promise automatic flow-down: no synchronization mechanism exists for either supported starting path (**Use this template** or clone). Downstream projects need human review because application code, bindings, security policy, and deployment topology are project-specific.

## Documentation requirements

Update documentation in the same change when behavior or workflow changes. Documentation is written for the people who consume the template; `CONTRIBUTING.md` and this file are the only maintainer-facing documents. The current document set is:

| File | Audience and role |
| --- | --- |
| `README.md` | Consumers: what the template is, quickstart, prerequisites, commands, and links onward. Keep it short and task-oriented; move detail into `docs/`. |
| `docs/using-this-template.md` | Consumers: one-time project setup — how to start (GitHub template vs. clone), Worker naming, environment isolation, bindings, secrets, repository rules, upstream adoption. |
| `docs/discord-bot.md` | Consumers: how the bot works — the interaction lifecycle (verify, PING/PONG, dispatch), the module layout, the injection seams, and how the Discord surface is tested offline. |
| `docs/gitflow-and-branching.md` | Consumers: branches, pull requests, promotion, deployment gating, and rollback. |
| `docs/versioning-and-changesets.md` | Consumers: recording changesets, the release pull request, cutting versions and tags. |
| `docs/using-ai.md` | Consumers: how AI tooling is wired in — instruction files, MCP servers, the contract-test and human-gate guardrails, and how to adapt the instruction files downstream. |
| `CONTRIBUTING.md` | Contributors to this template: prerequisites, TDD loop, required checks, changesets, instruction-file sync, pull request expectations. |
| `CHANGELOG.md` | User-visible changes, migration notes, and release references where available. |

Keep these roles distinct rather than duplicating content: state a fact in one document and link to it from the others. When renaming, splitting, or adding a document, update every cross-reference, including the README documentation table and the instruction files.

This repository is a real GitHub template repository, so "template" is accurate terminology. There is no automated upstream-sync mechanism for either supported starting path: a repository created with **Use this template** shares no commit history with upstream at all, so `git cherry-pick` from a fetched `upstream` remote is the adoption path; a plain clone keeps full history but no repository of its own until its remote is repointed, after which the same manual adoption applies. Documentation must not promise automatic flow-down for either path. Do not document forking this repository as a supported starting path — no synchronization automation exists for it, and offering it as a choice implies there is.

Documentation must also distinguish local emulation from deployed Cloudflare behavior. Do not call a local test equivalent to an integration test unless it actually exercises the relevant Cloudflare service.

## Versioning and release discipline

Use Semantic Versioning for the template package and any published artifacts:

- **Patch**: backward-compatible fixes, docs, test improvements, and dependency updates that do not alter the supported template contract.
- **Minor**: backward-compatible features, new optional capabilities, or new extension points.
- **Major**: breaking changes to scripts, file layout, runtime assumptions, Wrangler configuration, environments, bindings, or migration requirements.

The instruction contract version describes the requirements agents and downstream maintainers are expected to follow. It is separate from the software/template version in `package.json`:

- **Patch**: clarify wording, fix a typo, or add examples without changing the required workflow.
- **Minor**: add a compatible requirement or capability that does not invalidate the existing project structure.
- **Major**: change a requirement in a way that requires downstream projects or maintainers to revise their workflow, such as changing the project language, renaming required files, changing required commands, or altering deployment and environment contracts.

Keep the instruction contract version aligned across `claude.md`, `AGENTS.md`, and `.github/copilot-instructions.md`. Every release or instruction-contract change should state whether downstream projects need action and include migration guidance when required.

Keep `package.json` version, `CHANGELOG.md`, tags, and release notes consistent. Do not edit the version casually in feature commits if releases are automated; follow the repository's chosen release tool once established. Use conventional commit messages only if the repository adopts them and documents the required format. Dependencies must be reviewed for runtime, license, security, and Wrangler compatibility impact.

Every release should state:

- what changed;
- whether downstream projects need action;
- the migration or rollback procedure;
- the supported Node.js, Wrangler, and runtime versions;
- the validation performed.

## Change workflow

1. Read the relevant Cloudflare documentation and current local docs.
2. State the behavior or contract being changed and add or update a focused test.
3. Implement the smallest change consistent with existing patterns.
4. Run focused tests, then JavaScript lint/format and configuration validation. Skip these for documentation-only Markdown changes and verify the documentation's accuracy instead.
5. Review the generated diff for secrets, environment cross-wiring, accidental application-specific code, and unnecessary lockfile or config churn.
6. Update README/guides, changelog, migration notes, and version metadata as required.
7. Report commands run and any checks that could not run.

Never commit secrets, `.dev.vars`, `.env*` files containing values, Cloudflare account identifiers that are intended to remain private, generated deployment state, or local caches. Keep ignore rules current.

## Definition of done

A template change is complete only when the code, tests, configuration, documentation, downstream impact, and release classification agree. A reviewer should be able to start a repository from this template or clone it, follow the documented commands, run tests locally without production access, identify each environment, and understand exactly how to adopt the change.
