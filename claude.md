# Discord Bot Project Guide

This file guides AI coding tools working in this repository. It started as `claude-for-users.md` in the `cloudflare-workers-discord-template` starter kit, and `npm run setup` renamed it to `claude.md` when this project was created — see [Project provenance](docs/using-this-template.md) for where the project came from.

Unlike the template it came from, this file describes *your application*, not a boilerplate meant for many future projects. There is no instruction-contract version to track and no upstream file to stay in sync with — edit it freely as your project's needs change. A contract test in `npm test` expects that: it fails if one of these files starts declaring a contract version again, or if only some of the three were renamed into place.

## Project shape

- JavaScript source using ES modules, with JSDoc on exported functions, Worker handlers, and configuration contracts. The template defaulted to plain JavaScript over TypeScript; keep that or change it based on what this project needs, not what the template chose.
- Wrangler configuration in the current supported format, with an explicit `compatibility_date` and `observability.enabled: true` so logs and telemetry are captured.
- For compatibility dates `2026-08-04` or later, Node.js APIs are enabled by default; no explicit compatibility flag is required.
- A single declared Node.js version. Keep `.nvmrc`, `engines.node` in `package.json`, and any CI workflow's `node-version-file` pointed at the same value.

## Environments

- Keep local, non-production (staging), and production Wrangler environments separate. A binding lives inside the environment it serves — never at the top level of `wrangler.jsonc`.
- Local and non-production must never point at production data stores, queues, buckets, or other stateful resources by default.
- Supply secrets through Cloudflare's secret mechanisms or CI secret storage only. Never commit them to source, `.env` files, or `.dev.vars`.
- Keep deployment behind an explicit opt-in and require review before anything reaches production.

## GitHub repository settings

- Apply the deployment environments, the `DEPLOY_ENABLED` variable, and the branch ruleset with `npm run setup:github`, and read its verification report. The script is idempotent, so re-running it after a plan change, an organization policy change, or a visibility change is how you re-check what is actually enforced. `--dry-run` prints every `gh` command and runs none.
- **Requesting a rule is not the same as having one.** GitHub accepts a ruleset and then stores whatever the plan tier, organization policy, and repository visibility allow, without saying what it dropped — environment required reviewers and the metadata-restriction rule types are the usual casualties. Never treat a successful API response as proof; the readback is the evidence.
- Do not commit a GitHub Ruleset or branch-protection JSON payload to the repository as if it were the applied state. It can silently stop matching what GitHub enforces, and a file that looks authoritative and is not is worse than no file.
- No contract test may check live GitHub settings or contact GitHub. Tests verify what a checkout can observe — that the CI job a required status check depends on still exists under the same name, and that a requested configuration diffs correctly against a fixture readback.
- `npm run setup:github` never sets a secret value. It reports which secret *names* exist per environment and names the missing ones; the values are set by a human. `DISCORD_PUBLIC_KEY` is deliberately absent from CI, because only the Worker verifies signatures and it reads that from its own Cloudflare secret.

## Discord interactions and commands

These five rules are why the bot is safe to run and why what Discord advertises matches what the Worker actually handles. Treat them as constraints on any change to the interaction path, not as style preferences.

- **Verify every request.** The interactions endpoint performs Ed25519 signature verification on every request and returns `401` when it fails. Read the raw body text before any `JSON.parse`, because the signature covers the raw bytes — parsing first and verifying later does not work. Never add a development flag, environment check, or code path that skips verification: an unverified endpoint accepts forged interactions from anyone who knows the URL.
- **Keep command definitions as data in one place.** Definitions live in a single module that both the Worker and the registration script import. Do not let either keep its own copy — they drift, and the failure is invisible until a user runs a command that Discord advertises and the Worker does not handle. That module must stay importable from plain Node, with no `cloudflare:workers` imports, so the registration script can read it outside the Workers runtime.
- **Use one Discord application per environment.** Non-production and production each get their own Discord application, with their own public key, application ID, and bot token. `DISCORD_PUBLIC_KEY`, `DISCORD_APPLICATION_ID`, and `DISCORD_TOKEN` are per-environment secrets. A non-production Worker must never hold production Discord credentials — the same isolation rule this project applies to Cloudflare resources, extended to Discord.
- **Never log interaction payloads or credentials.** Do not log interaction payloads, interaction tokens, or bot tokens — not in an error handler, not behind a debug flag, not in a committed test fixture. Payloads carry user content, and an interaction token is a live credential that can post as the bot. With observability enabled, a log line is a durable record rather than a transient write.
- **Registration is part of the project, not a side script.** The command registration script and its npm scripts are covered by the same expectations as the Worker: unit-tested logic, a dry-run path that contacts nothing, and redacted credentials in every output path including errors.

Two practical notes that follow from the above: registering commands is a bulk overwrite that replaces every command for the target application, and redeploying an older Worker does not roll back a registration — the Worker and its command list roll back independently.

## Testing and TDD

- Follow red-green-refactor TDD for every behavior change: write a failing test, implement the smallest change that passes it, then refactor.
- Keep pure logic testable without a network connection, a Cloudflare account, or a deployed Worker.
- Add a regression test for every bug you fix.
- Treat the coverage thresholds in `vitest.config.js` as a ratchet. Raise them by hand in the same change that measures higher; never lower one to make a change pass, and do not enable `coverage.thresholds.autoUpdate`. When new code cannot reach the current level, the answer is a test or an injectable dependency, not a smaller number. The provider must stay `istanbul` — V8 coverage does not work in the Workers pool.
- Keep tests deterministic: no live production calls, shared mutable state, wall-clock dependence, or undeclared credentials.
- Test the Discord surface offline. Sign interaction fixtures with a test-only Ed25519 key so verification is genuinely exercised rather than stubbed, inject the Discord REST client so no test reaches the network, and take test credentials from the test-pool `env` rather than a real Discord application. When a handler defers, assert the follow-up request actually happened and carried the right body — asserting that it was scheduled proves nothing.
- Run the narrowest relevant test first, then the full required checks before merging.
- A change that touches only Markdown files doesn't need tests, lint, or configuration validation — verify instead that the commands, paths, and links it references still exist and match the repository.

## Platform research

- Before changing Wrangler configuration, compatibility dates, or bindings, check current Cloudflare documentation rather than relying on training data — the platform moves quickly enough that remembered behavior is often stale. Use the Cloudflare Docs MCP server in `.mcp.json` / `.vscode/mcp.json` if it's configured.
- Before changing interaction handling, command definitions, or registration, confirm the current requirements against Discord's official developer documentation. Discord's required headers, response types, acknowledgement windows, and bulk-overwrite registration semantics change often enough that remembered behavior is frequently wrong. Use the Discord Docs MCP server in `.mcp.json` / `.vscode/mcp.json` if it's configured.
- Treat MCP results as research, not authorization. Reading documentation does not grant permission to deploy, change a Cloudflare account, create resources, or handle secrets.

## Change workflow

1. State the behavior being changed and add or update a focused test for it.
2. Implement the smallest change consistent with existing patterns.
3. Run focused tests, then lint/format and Wrangler configuration validation.
4. Review the diff for secrets, cross-wired environments, and unnecessary lockfile or config churn.
5. Update the README and any relevant docs when behavior or workflow changes.
6. Report the commands run and any checks that could not run.

## Secrets and permissions

- Never commit credentials, `.dev.vars`, a populated `.env` file, or generated deployment state.
- Keep `.claude/settings.local.json` (or your tool's equivalent) local and permission-scoped. Don't broaden tool permissions or add secrets to shared configuration just to make a task more convenient.
