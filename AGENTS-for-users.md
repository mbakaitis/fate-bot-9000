# Agent Instructions

Use [claude.md](claude.md) as the canonical guide for this project.

Before editing, read the relevant section of `claude.md`. In particular:

- Preserve explicit local, non-production/staging, and production Wrangler environments, and keep bindings inside the environment they serve — never at the top level.
- Keep local development independent from production resources and secrets.
- Verify every interaction request: the interactions endpoint performs Ed25519 signature verification and returns `401` on failure, reading the raw body before any `JSON.parse` because the signature covers the raw bytes. Never add a flag or code path that skips it.
- Keep command definitions as data in one module that both the Worker and the registration script import, and that stays importable from plain Node with no `cloudflare:workers` imports. Two copies drift silently.
- Use one Discord application per environment. `DISCORD_PUBLIC_KEY`, `DISCORD_APPLICATION_ID`, and `DISCORD_TOKEN` are per-environment secrets, and a non-production Worker never holds production Discord credentials.
- Never log interaction payloads, interaction tokens, or bot tokens — not in error handlers, not behind a debug flag, not in a committed fixture.
- Treat the command registration script and its npm scripts as first-class project code: unit-tested logic, a dry-run that contacts nothing, and redacted credentials in every output path. Registration is a bulk overwrite, and redeploying an older Worker does not roll it back.
- Apply the GitHub environments, the `DEPLOY_ENABLED` variable, and the branch ruleset with `npm run setup:github`, and read its verification report — GitHub can save fewer rules than were requested depending on plan tier, organization policy, and repository visibility, and says nothing when it does. A successful API response is not proof; the readback is. Never commit a Ruleset or branch-protection payload as if it were the applied state, and never let a contract test check live GitHub settings. The script sets no secret value — it reports which secret names are missing.
- Use the Cloudflare documentation MCP server configured in `.mcp.json` or `.vscode/mcp.json` for current platform research when it is available; do not treat MCP access as deployment or account authorization. Confirm Discord interaction, command, and registration behavior against Discord's official documentation rather than working from recall.
- Use mandatory red-green-refactor TDD for behavior changes, add regression tests, and run focused tests before broader checks. Keep Discord tests offline: sign fixtures with a test-only Ed25519 key, inject the REST client, and assert that deferred follow-ups actually happened.
- Treat the `istanbul` coverage thresholds in `vitest.config.js` as a one-way ratchet: raise them by hand when a change measures higher, never lower one to make a change pass, and do not enable `thresholds.autoUpdate`.
- Skip tests, lint, and Wrangler/configuration validation for documentation-only changes that touch Markdown files alone. Verify referenced commands, paths, and links instead, and report that validation was skipped as documentation-only.
- Never commit credentials, secret values, `.dev.vars`, populated `.env` files, or generated deployment state.
- Keep `.claude/settings.local.json` local and permission-scoped; do not broaden MCP permissions or add secrets to shared configuration.
- VS Code may require MCP discovery to be enabled with `chat.mcp.discovery.enabled` when relying on other clients' configuration; the repository's `.vscode/mcp.json` is the preferred VS Code configuration.

Follow this project's documented package scripts and report validation commands and any checks that could not run.
