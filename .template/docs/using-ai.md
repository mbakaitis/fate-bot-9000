# Using AI With This Project

This project started from a template that was built with AI assistance, and it is wired so that AI tools are useful on it from the first clone. Nothing here requires you to use AI — every command works the same way by hand. But if you do, the scaffolding is already in place.

Two ideas drive the design:

1. **Give the tools the context they need.** Maintenance rules, environment boundaries, and workflow expectations are written down in files the tools read automatically, not held in someone's head or a chat history.
2. **Do not trust context alone.** Instructions guide an assistant; they cannot constrain it. So the promises that matter are enforced by tests and by human gates that no assistant can bypass.

## What is already set up

| Piece | Where | What it does |
| --- | --- | --- |
| Instruction files | `claude.md`, `AGENTS.md`, `.github/copilot-instructions.md` | Tell an assistant how to work in this repository |
| Documentation MCP servers | `.mcp.json`, `.vscode/mcp.json` | Let an assistant read current Cloudflare and Discord documentation instead of guessing |
| GitHub MCP server | `.mcp.json`, `.vscode/mcp.json` | Lets an assistant read issues and repository data you already have access to |
| Contract tests | `test/contracts/` | Fail the build when a change breaks an environment or workflow promise |
| Coverage floor | `vitest.config.js` | Fails the build when new code lands untested |
| Human gates | `DEPLOY_ENABLED`, protected environments, required review | Keep deployment and production out of reach of automation |

## The instruction files

Three files carry the same guidance, because different tools look for different filenames:

| File | Read by |
| --- | --- |
| [claude.md](../claude.md) | Claude Code, and the fullest version of the guidance |
| [AGENTS.md](../AGENTS.md) | Tools that follow the `AGENTS.md` convention |
| [.github/copilot-instructions.md](../.github/copilot-instructions.md) | GitHub Copilot |

`claude.md` is the full guide; the other two are shorter entry points that stay consistent with it rather than independent sources of truth. They describe *this project* — environment isolation, TDD, secrets handling, treating documentation lookups as research rather than authorization. Edit them as your requirements change; there is no upstream sync to preserve. If you don't use AI tooling, delete all three.

## MCP servers

Both configuration files declare the same servers in the two schemas that tools expect. `.mcp.json` uses the Claude-compatible `mcpServers` key; `.vscode/mcp.json` uses VS Code's `servers` key. A contract test asserts both stay in agreement.

- **Cloudflare Docs** (`https://docs.mcp.cloudflare.com/mcp`) — current Workers and Wrangler documentation. This matters more than it sounds: Cloudflare's platform moves quickly, and a model's training data will confidently describe Wrangler behavior that changed a year ago. Looking it up beats remembering it.
- **Discord Docs** (`https://docs.discord.com/mcp`) — Discord's own read-only documentation server, for the interaction contract this bot implements: required signature headers, response types, acknowledgement windows, and the bulk-overwrite semantics of command registration. Those details are exactly the kind a model recalls plausibly and wrongly, and getting the signature part wrong is a security bug rather than a broken feature.
- **GitHub** (`https://api.githubcopilot.com/mcp/`) — issues and repository data. Your editor prompts you to authenticate on first use.

The two documentation servers need no authentication. GitHub does, and it stays unavailable until you complete that prompt — an assistant cannot authorize itself.

**Neither file contains a token.** They hold only non-secret server URLs, which is why they are safe to commit. If a tool needs credentials, they belong in that tool's own local configuration.

In VS Code, `.vscode/mcp.json` is the configuration to use. If you rely on another client's configuration instead, you may need to enable `chat.mcp.discovery.enabled`.

### Documentation lookup is not authorization

Reading documentation is research. It is not permission to deploy, change a Cloudflare account, create resources, or handle secrets. An assistant that has just read the Wrangler documentation still has no business running a deployment.

Verify important platform claims against official documentation, and record the decision and the link in the repository when it affects how this project is configured. A documentation link in a pull request is worth more than a confident assertion in a chat window.

## The guardrails that actually hold

Instruction files are advisory. These are not.

**Contract tests** (`test/contracts/`) run as part of `npm test` and encode the promises that matter:

- Non-production and production Workers must have distinct names.
- Production bindings must not sit in the top-level Wrangler configuration.
- Deployment must stay behind the explicit `DEPLOY_ENABLED` opt-in.
- The release workflow must keep its reviewed shape.
- One Node.js version, declared in one place.
- The coverage thresholds must exist and must be above zero.

This is the layer that makes AI assistance safe here. An assistant that suggests pointing non-production at a production database does not produce a subtle bug for a reviewer to catch six weeks later — it produces a failing test, immediately, before anything is deployed. When a contract test fails, that is the system working.

**The coverage floor** turns "please write tests" from a request into a build failure. `npm test` measures coverage over `src/` and `scripts/lib/` and fails when it falls below the thresholds in `vitest.config.js`. Untested code cannot land, whoever wrote it.

It should only move one way. Raising a threshold is a hand-edit in a reviewed diff; lowering one to make a change pass defeats the point of having it. If you ask an assistant for a feature and it comes back having relaxed a threshold, that is the finding, not the fix — and the contract test above means deleting the thresholds outright fails too.

**Human gates** cover what tests cannot. Deployment is off until you set `DEPLOY_ENABLED`, production requires environment approval, protected branches require review, and Cloudflare credentials live in GitHub secrets that no local tool can read. Automation can open a pull request; it cannot ship to production.

None of that is checked by a test, and it cannot be: a contract test reads a checkout, not GitHub's live settings. `npm run setup:github` is the substitute — it applies the environments, the branch ruleset, and the `DEPLOY_ENABLED` opt-in, then reads each one back and names anything GitHub did not save. Requesting a rule is not the same as having one, and it exits non-zero when the two differ.

## Working effectively

**Test-driven development is the requirement, and it is also what makes AI-assisted changes reviewable.** Write the failing test first, then the change. A test that failed before and passes after is evidence. A confident explanation is not. This is also the honest reason this project skips TypeScript: tests catch the mistakes that matter, in the runtime the code actually runs in.

**Point at the guide, not at the whole repository.** "Follow the environment rules in `claude.md` and add a contract test" produces better results than "add a D1 binding," because the first prompt carries the constraints and the second invites a plausible guess.

**Ask for current documentation.** When a change touches Wrangler configuration, compatibility dates, or bindings, ask the assistant to check the Cloudflare documentation and cite what it found.

**Review the diff, every time.** Look specifically for secrets, cross-wired environments, and unnecessary lockfile churn. This is in the change workflow in `claude.md` because it is the step most easily skipped.

**Run the checks yourself.** `npm test` and `npm run lint` are the same commands CI runs. Do not take "the tests should pass" for an answer.

**Documentation-only changes skip the checks.** A change touching only Markdown does not need tests or lint — verify instead that the commands, paths, and links it mentions actually exist. This exists so that fixing a typo does not cost a full validation cycle.

## Keep secrets and permissions out of shared configuration

- `.claude/settings.local.json` is local and permission-scoped, and it is gitignored. Keep it that way. Do not broaden tool permissions to make a task convenient.
- `.dev.vars`, `.env` files with values, and generated deployment state stay out of Git. The ignore rules already cover them; keep them current.
- Never paste a Cloudflare API token, account identifier you intend to keep private, or production data into a prompt. Assume prompt content leaves your machine.
- Deployment credentials belong in GitHub secrets, reachable only by the reviewed workflows.

## If you would rather not use AI

Delete the instruction files and the MCP configuration. Everything else — the Worker, the tests, the environments, the release workflow — works exactly the same. The contract tests protect the same promises whether a human or a model wrote the change, which is rather the point.
