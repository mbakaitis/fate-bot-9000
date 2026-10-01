# Using AI With This Template

This template was built with AI assistance, and it is wired so that AI tools are useful on it from the first clone. Nothing here requires you to use AI — every command works the same way by hand. But if you do, the scaffolding is already in place.

Two ideas drive the design:

1. **Give the tools the context they need.** Maintenance rules, environment boundaries, and workflow expectations are written down in files the tools read automatically, not held in someone's head or a chat history.
2. **Do not trust context alone.** Instructions guide an assistant; they cannot constrain it. So the promises that matter are enforced by tests and by human gates that no assistant can bypass.

## What is already set up

| Piece | Where | What it does |
| --- | --- | --- |
| Instruction files | `claude.md`, `AGENTS.md`, `.github/copilot-instructions.md` (and their `-for-users` counterparts) | Tell an assistant how to work in this repository |
| Documentation MCP servers | `.mcp.json`, `.vscode/mcp.json` | Let an assistant read current Cloudflare and Discord documentation instead of guessing |
| GitHub MCP server | `.mcp.json`, `.vscode/mcp.json` | Lets an assistant read issues and repository data you already have access to |
| Contract tests | `test/contracts/` | Fail the build when a change breaks an environment or workflow promise |
| Coverage ratchet | `vitest.config.js` | Fails the build when new code lands untested |
| Human gates | `DEPLOY_ENABLED`, protected environments, required review | Keep deployment and production out of reach of automation |

## The instruction files

This repository ships two parallel sets of three files, because different tools look for different filenames and because a template has a different audience than the project built from it:

| Maintainer file (this repository) | Read by | Downstream counterpart |
| --- | --- | --- |
| [claude.md](../claude.md) | Claude Code, and the canonical version of the guidance | `claude-for-users.md` |
| [AGENTS.md](../AGENTS.md) | Tools that follow the `AGENTS.md` convention | `AGENTS-for-users.md` |
| [.github/copilot-instructions.md](../.github/copilot-instructions.md) | GitHub Copilot | `.github/copilot-instructions-for-users.md` |

The left column describes maintaining *this template* for many future projects: mission and scope, downstream alignment, an instruction contract version. The `-for-users` files describe building *an application* on top of it: environment isolation, TDD, secrets handling, treating MCP results as research rather than authorization — with the template-maintenance-only material removed. Neither set is a subset of the other; they're written for different jobs.

`claude.md` and `claude-for-users.md` are each the full guide for their audience; the `AGENTS.md`/`.github/copilot-instructions.md` files and their `-for-users` counterparts are shorter entry points that stay consistent with the matching full guide, not independent sources of truth.

The maintainer files carry an **instruction contract version** in their headers, separate from the package version, so a change to what this template requires is visible and reviewable rather than silent. See [Versioning and changesets](versioning-and-changesets.md#two-version-numbers). The `-for-users` files carry no such version — a single application has no upstream file to stay in sync with, so the concept doesn't apply once they're in place.

### Switching to the downstream files

`npm run setup` did this for you, once, when you created your project — see step 1 of [Using This Template](using-this-template.md#1-create-and-clone-your-repository). It renamed `claude-for-users.md` to `claude.md`, `AGENTS-for-users.md` to `AGENTS.md`, and `.github/copilot-instructions-for-users.md` to `.github/copilot-instructions.md`, leaving three files rather than six. Running it with `--ai delete` removes all six instead; `--ai keep` leaves the decision for later.

The files are replaced outright rather than edited down. A half-edited maintainer file is easy to leave half-finished, and it would still carry the instruction-contract-version machinery a single application has no use for. It is also why setup does all three renames or none: three is a coherent layout and six is a coherent layout, but two is a repository nobody can reason about.

`npm test` checks the outcome either way. The contract test works out which of the three layouts it is looking at, holds the template to the version contract, holds a project to *not* carrying one, and fails a swap that only happened for some of the three.

From there, the files describe your project and your project alone. Edit them as your requirements change; there is no upstream sync to preserve.

## MCP servers

Both configuration files declare the same three servers in the two schemas that tools expect. `.mcp.json` uses the Claude-compatible `mcpServers` key; `.vscode/mcp.json` uses VS Code's `servers` key. A contract test asserts both stay in agreement.

- **Cloudflare Docs** (`https://docs.mcp.cloudflare.com/mcp`) — current Workers and Wrangler documentation. This matters more than it sounds: Cloudflare's platform moves quickly, and a model's training data will confidently describe Wrangler behavior that changed a year ago. Looking it up beats remembering it.
- **Discord Docs** (`https://docs.discord.com/mcp`) — Discord's own read-only documentation server, for the interaction contract this bot implements: required signature headers, response types, acknowledgement windows, and the bulk-overwrite semantics of command registration. Those details are exactly the kind a model recalls plausibly and wrongly, and getting the signature part wrong is a security bug rather than a broken feature.
- **GitHub** (`https://api.githubcopilot.com/mcp/`) — issues and repository data. Your editor prompts you to authenticate on first use.

The two documentation servers need no authentication. GitHub does, and it stays unavailable until you complete that prompt — an assistant cannot authorize itself.

**Neither file contains a token.** They hold only non-secret server URLs, which is why they are safe to commit. If a tool needs credentials, they belong in that tool's own local configuration.

In VS Code, `.vscode/mcp.json` is the configuration to use. If you rely on another client's configuration instead, you may need to enable `chat.mcp.discovery.enabled`.

### Documentation lookup is not authorization

Reading documentation is research. It is not permission to deploy, change a Cloudflare account, create resources, or handle secrets. An assistant that has just read the Wrangler documentation still has no business running a deployment.

Verify important platform claims against official documentation, and record the decision and the link in the repository when it affects the template contract. A documentation link in a pull request is worth more than a confident assertion in a chat window.

## The guardrails that actually hold

Instruction files are advisory. These are not.

**Contract tests** (`test/contracts/`) run as part of `npm test` and encode the promises that matter:

- Non-production and production Workers must have distinct names.
- Production bindings must not sit in the top-level Wrangler configuration.
- Deployment must stay behind the explicit `DEPLOY_ENABLED` opt-in.
- The release workflow must keep its reviewed shape.
- One Node.js version, declared in one place.
- The coverage thresholds must exist and must be above zero.
- The instruction files must form one coherent set — either the template's six, with a single agreed contract version across the maintainer three, or your project's after the swap, carrying no version at all. A half-finished swap fails.

This is the layer that makes AI assistance safe here. An assistant that suggests pointing non-production at a production database does not produce a subtle bug for a reviewer to catch six weeks later — it produces a failing test, immediately, before anything is deployed. When a contract test fails, that is the system working.

**The coverage ratchet** turns "please write tests" from a request into a build failure. `npm test` measures coverage over `src/` and `scripts/lib/` and fails when it falls below the thresholds in `vitest.config.js`. Untested code cannot land, whoever wrote it.

It only moves one way. Raising a threshold is a hand-edit in a reviewed diff; lowering one to make a change pass is the thing the ratchet exists to prevent. If you ask an assistant for a feature and it comes back having relaxed a threshold, that is the finding, not the fix — and the contract test above means deleting the thresholds outright fails too.

**Human gates** cover what tests cannot. Deployment is off until you set `DEPLOY_ENABLED`, production requires environment approval, protected branches require review, and Cloudflare credentials live in GitHub secrets that no local tool can read. Automation can open a pull request; it cannot ship to production.

None of that is checked by a test, and it cannot be: a contract test reads a checkout, not GitHub's live settings. `npm run setup:github` is the substitute — it applies the environments, the branch ruleset, and the `DEPLOY_ENABLED` opt-in, then reads each one back and names anything GitHub did not save. Requesting a rule is not the same as having one, and it exits non-zero when the two differ.

## Working effectively

**Test-driven development is the requirement, and it is also what makes AI-assisted changes reviewable.** Write the failing test first, then the change. A test that failed before and passes after is evidence. A confident explanation is not. This is also the honest reason this project skips TypeScript: tests catch the mistakes that matter, in the runtime the code actually runs in.

**Point at the guide, not at the whole repository.** "Follow the environment rules in `claude.md` and add a contract test" produces better results than "add a D1 binding," because the first prompt carries the constraints and the second invites a plausible guess.

**Ask for current documentation.** When a change touches Wrangler configuration, compatibility dates, or bindings, ask the assistant to check the Cloudflare documentation and cite what it found.

**Review the diff, every time.** Look specifically for secrets, cross-wired environments, application logic that drifted into the template, and unnecessary lockfile churn. This is in the change workflow in `claude.md` because it is the step most easily skipped.

**Run the checks yourself.** `npm test` and `npm run lint` are the same commands CI runs. Do not take "the tests should pass" for an answer.

**Documentation-only changes skip the checks.** A change touching only Markdown does not need tests or lint — verify instead that the commands, paths, and links it mentions actually exist. This exists so that fixing a typo does not cost a full validation cycle.

## Keep secrets and permissions out of shared configuration

- `.claude/settings.local.json` is local and permission-scoped, and it is gitignored. Keep it that way. Do not broaden tool permissions to make a task convenient.
- `.dev.vars`, `.env` files with values, and generated deployment state stay out of Git. The ignore rules already cover them; keep them current.
- Never paste a Cloudflare API token, account identifier you intend to keep private, or production data into a prompt. Assume prompt content leaves your machine.
- Deployment credentials belong in GitHub secrets, reachable only by the reviewed workflows.

## If you would rather not use AI

Delete the instruction files and the MCP configuration. Everything else — the Worker, the tests, the environments, the release workflow — works exactly the same. The contract tests protect the same promises whether a human or a model wrote the change, which is rather the point.
