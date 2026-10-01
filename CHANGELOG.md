# Changelog

## 1.0.0

### Major Changes

- First stable release of the template.
  
  The setup automation, the Discord bot surface, the environment isolation contract, and the downstream documentation set are all in place, so the template contract is now something a downstream project can depend on and a version it can be compared against.

### Minor Changes

- 1c108f3: Prove the setup claim: a fresh project is green with zero edits
  
  `npm run setup` promised to turn a copy of this template into a working project. Nothing checked that the result held together. Two checks now do, at two speeds.
  
  `test/contracts/setup-acceptance.template-only.test.js` runs inside `npm test`. It builds a project from `git archive HEAD` into a temporary directory, runs setup there unattended, and asserts the shape of what comes out: nothing template-only left behind, the changesets gone but their configuration kept, every `.template/` destination written with no `{{PLACEHOLDER}}` surviving, the package, lockfile and Workers renamed, provenance recorded and the `setup` script removed, the coverage thresholds at the floor, every relative Markdown link resolving, and no credential-shaped literal anywhere. It takes about half a second and installs nothing.
  
  `.github/workflows/template-acceptance.yml` is the half that proves "green". It does the same build in CI and then runs `npm ci`, `npm run lint`, and the full `npm test` inside the generated project. It is a separate workflow rather than a job in `ci.yml` so the required status check named `test` keeps meaning the job in `ci.yml`, and so `template-manifest.json` can prune the whole file — it spawns a script that deletes itself during setup.
  
  The list of paths a project must not inherit is written out in the test rather than read from the manifest. Deriving it from the manifest would make the two agree by construction, and an entry dropped from the manifest would then be dropped from the test with it.
  
  No action for downstream projects: both checks are template-only and are pruned by setup.
- 87ad614: Add `npm run setup` — the one command that turns a copy of this template into a project.
  
  ```sh
  npm run setup                                  # interactive
  npm run setup -- --name acme-bot --yes         # unattended
  npm run setup -- --name acme-bot --dry-run     # prints the plan, changes nothing
  npm run setup -- --name acme-bot --ai delete   # remove the AI instruction files instead of swapping them
  ```
  
  `scripts/setup.js` is a thin CLI over `scripts/lib/setup.js`, the same split `scripts/register-commands.js` uses: the script owns the filesystem, the clock, `git`, and the exit code, and every decision it makes is a pure function a test can reach. That is what makes a destructive one-shot script reviewable — a plan that deletes the wrong thing fails in a unit test rather than in somebody's new repository.
  
  The order of operations is the contract, and `planProjectSetup` builds it: copy the `.template/` payload with its placeholders filled in, apply the identity rewrites, swap or delete the six AI instruction files, copy `.dev.vars.example` to `.dev.vars` (never over an existing one), prune, record provenance and add the `upstream` remote, then delete the script, its library, its tests, and its npm script — last, because a script that deletes itself first cannot finish.
  
  Provenance goes in `package.json` under a `template` key: the upstream repository, the template version, the template commit, and the date. `buildProvenance` takes the clock as an argument, so the record is testable and the tests are deterministic.
  
  Refusals, each exiting non-zero with a message naming the problem: provenance already present (setup is a one-shot, and this one cannot be forced), a dirty working tree (`--force` covers it; a dry run is exempt, since it writes nothing), a slug Cloudflare would reject, an unattended run with no `--name`, an unrecognized argument, no `template-manifest.json`, and no terminal to confirm with and no `--yes`.
  
  `--dry-run` contacts nothing and writes nothing, asserted by spawning the real script with `fetch` replaced by a landmine. Nothing on any path prints a file's contents, so the `.dev.vars` the run creates is never echoed.
  
  Two fixes that a project would otherwise have hit on its first `npm test`:
  
  - `rewritePackageLock` now resets the lockfile's two versions along with its two names. `test/contracts/versioning.test.js` ships downstream and compares the lockfile against `package.json`, which setup resets to `0.0.0`.
  - `test/contracts/discord.test.js`'s committed-secret scan skips a path the git index still carries but the working tree no longer has. That is exactly what a repository looks like between `npm run setup` and the commit that records it.
- 5db3afc: Document `npm run setup` and `npm run setup:github`, and raise the instruction contract to **3.1.0**.
  
  The documentation set now describes setup as one command rather than a checklist. No document tells a reader to do something a script now does.
  
  - **`docs/using-this-template.md`** — step 1 ends in `npm run setup` instead of three `mv` commands, with a table of everything the run does and the two things it deliberately leaves alone. Step 2 explains what setup named and why rather than asking for a hand edit. "Run it locally" no longer copies `.dev.vars.example`, because setup already did and the example is pruned. Steps 5 and 6 lead with `npm run setup:github` and keep their tables as the reference for what it applies and how to check the readback. "Setup is complete when" now asks for the provenance record and a clean divergence report. Every heading is unchanged, so every inbound anchor still resolves.
  - **`README.md`** — the quickstart is ten steps instead of eleven: cloning, installing, and setup are one step, and the separate renaming step is gone. Step 8 offers `npm run setup:github` before the by-hand walkthrough.
  - **`docs/using-ai.md`** — the instruction-file swap is described in the past tense, as something setup did, and the guardrails section says plainly that no contract test can check live GitHub settings and that `setup:github`'s readback is the substitute. `.template/docs/using-ai.md` and `.template/README.md` carry the matching changes.
  - **`docs/template-acceptance-test.md`** — Phase 3 is now `npm run setup` in a real *Use this template* repository followed by `npm test` and `npm run lint` with zero edits, which is the template's central claim and the one thing the archive-based checks cannot prove. Phase 6 covers `setup:github`'s readback, including the private-repository case where required reviewers do not save. The old manual-renaming phase is gone, so the count and every cross-reference are unchanged.
  - **`CONTRIBUTING.md`** — a new section on `template-manifest.json` and `.template/` as template-owned surface: what belongs in each, why the payload is files rather than strings in a script, the standing rule that anything template-only must be registered in the manifest in the same change, and the converse — that `npm run setup:github` is permanent and must stay out of `prune` and `selfDelete`.
  
  **Instruction contract 3.1.0** — minor, because the additions are compatible and invalidate no existing project structure. `claude.md`, `AGENTS.md`, and `.github/copilot-instructions.md` all gain:
  
  - `template-manifest.json` and `.template/` in the required project shape, with the registration rule and the permanent-script exception.
  - `npm run setup` and `npm run setup:github` in the environment and deployment scripts contract.
  - A revised GitHub Rulesets stance. Applying with `npm run setup:github` and verifying the readback is now the documented path; committing a payload as an applied artifact is still forbidden; contract tests still never check live GitHub settings.
  
  Mirrored into `claude-for-users.md`, `AGENTS-for-users.md`, and `.github/copilot-instructions-for-users.md`: only the GitHub-settings rule, which a project still needs. The manifest and `.template/` are not mirrored — a project has already pruned them.
  
  **Migration for a project created from an earlier version of this template.** No action is required; you can ignore this release. Your project has no `template-manifest.json` and no setup script, and nothing here changes how your Worker, tests, or deploy workflow behave.
  
  If you would like the pruning anyway, `template-manifest.json` in this repository is the list of what to delete: its `prune` array names the files, `pruneGlobs` covers the pending changesets, `pruneDirectories` covers `.template/` itself, and `selfDelete` names the setup script and its npm script. Two things worth copying rather than deleting: `scripts/setup-github.js` with its library and tests, and a coverage floor in `vitest.config.js` your application can actually reach.
- 5db3afc: Add `npm run setup:github` — apply the GitHub-side structure, then check what GitHub actually saved.
  
  ```sh
  npm run setup:github -- --dry-run          # print every gh command, run none
  npm run setup:github                       # apply, leaving deployment disabled
  npm run setup:github -- --enable-deploy    # also set DEPLOY_ENABLED=true
  ```
  
  It creates or updates the `non-prod` environment restricted to `develop`, the `production` environment restricted to `main` with required reviewers, and a `protected-branches` ruleset covering both branches with exactly the rules in `docs/using-this-template.md`, "Configure branch protection" — including the `test` required status check. `DEPLOY_ENABLED` is the deployment opt-in, so it is set only with `--enable-deploy` or an explicit yes at the prompt.
  
  Then it reads every one of those resources back and prints a comparison against what it asked for, naming each divergence and exiting non-zero if there is one. That readback is the reason this script exists rather than a committed ruleset payload: GitHub accepts a ruleset and stores whatever the plan tier, organization policy, and repository visibility allow, saying nothing about what it dropped. A `201` is not evidence. No `branch_name_pattern` rule is requested at all — it is a metadata-restriction rule type, rejected on Free and Pro regardless of visibility, so asking for it would guarantee a divergence on the plans most projects are on.
  
  It never sets a secret value. `gh secret list` returns names, so the report says which secret names exist per environment and names the missing ones, and calls out that `DISCORD_PUBLIC_KEY` is absent from CI on purpose — only the Worker verifies signatures, and it reads that from its own Cloudflare secret.
  
  `--dry-run` runs no `gh` at all, not even the preflight: `gh auth status` contacts GitHub, and "prints what it would do" has to mean it.
  
  Unlike `npm run setup`, this script is permanent. It is idempotent and it verifies rather than only applying, so re-running it is the supported way to re-check a repository's settings after a plan change, an organization policy change, or a visibility change. `template-manifest.json` therefore does not prune `scripts/setup-github.js`, `scripts/lib/setup-github.js`, or `test/contracts/setup-github.test.js`, and `test/contracts/setup-github.template-only.test.js` holds that decision as an assertion.
  
  Every decision lives in `scripts/lib/setup-github.js` — the `gh` argument lists, the payloads, and the diff between a requested configuration and a readback — so all of it is unit-tested offline at the repository's 100% coverage ratchet. The CLI wrapper is exercised as a spawned process against a `gh` of the test's own first on `PATH`, which proves both that a dry run invokes it zero times and that a readback missing a rule fails the run.
  
  No action for downstream projects created from an earlier version: the script is new, and a project can adopt it by copying `scripts/setup-github.js`, `scripts/lib/setup-github.js`, their two tests, and the `setup:github` package script.
- c85b775: Add the project-identity transforms to `scripts/lib/setup.js`.
  
  These are the pure rewrites that turn this template's identity into a project's. Each one takes text in and returns text out, so `npm run setup` — which lands in a later change — can be tested without a repository to destroy:
  
  - `deriveWorkerNames` validates a project slug against Cloudflare's Worker naming rules (lowercase letters, digits, and dashes, no leading or trailing dash, and short enough that `<slug>-production` fits the 63-character `workers.dev` limit) and derives the three Worker names. The derived names satisfy `test/contracts/environment-isolation.test.js`, asserted directly rather than assumed.
  - `rewriteWranglerNames` renames all three Workers in `wrangler.jsonc` as text, so the compatibility date, the observability block, and every `secrets.required` list survive byte for byte. It refuses to run if a name is missing, shared between environments, or appears somewhere it was not expected.
  - `rewritePackageManifest` sets the name and description, resets the version to `0.0.0`, drops the `template` and `boilerplate` keywords, and removes the `setup` script. `author` and `license` are deliberately left alone; the CLI will warn about them instead.
  - `rewritePackageLock` updates only the root name and `packages[""].name`, textually, rather than re-serializing a 190 kB file.
  - `rewriteCoverageThresholds` lowers the ratchet in `vitest.config.js` to a floor of **80** across all four metrics and replaces the maintainer-facing ratchet comment with wording that fits a project. The provider stays `istanbul`, `thresholds.autoUpdate` stays absent, and the include patterns are untouched, so `test/contracts/coverage.test.js` still passes against the result. The template holds itself to 100% because it is three commands long; an application is not, and a first partially-covered feature that fails `npm test` teaches a new project to lower the number, which is the habit the ratchet exists to prevent.
  - `substitutePlaceholders` fills in the `.template/` payload's `{{TOKEN}}` values and throws on a leftover token rather than shipping a README that greets its first reader with `{{PROJECT_NAME}}`.
  - `rewriteTemplateLinks` points the surviving documents' relative setup-guide links at the upstream blob URL, anchors intact, and reports how many it rewrote.
  - `removeInstructionContractSection` deletes `docs/versioning-and-changesets.md`'s "Two version numbers" section. A project's instruction files carry no contract version, so the section documents a number that does not exist — and it holds that document's last link to the pruned `CONTRIBUTING.md`.
  
  Every transform is idempotent, which is what makes a half-finished setup run safe to repeat. An anchor a rewrite keeps is required and its absence throws; an anchor a rewrite consumes is optional, because its absence is what a second run looks like.
  
  No behavior changes for anyone using the template today: nothing new runs, and no npm script was added.
  
  `test/contracts/setup-transforms.template-only.test.js` runs every transform against the repository's real files, so an upstream edit that moves an anchor fails here rather than in somebody's new project. It is template-only because it imports `scripts/lib/setup.js`, which setup deletes as its last act.
- 8cf4c4c: Add `template-manifest.json`, the `.template/` payload, and the setup planner.
  
  `template-manifest.json` declares what belongs to the template rather than to a project built from it: the paths a new project prunes, the `.changeset/*.md` glob, the `.template` and `docs/images` directories, the three instruction-file pairs, the payload's copy destinations, and the files `npm run setup` will eventually delete along with itself. It is data, so it is reviewable in a diff rather than buried in a script.
  
  `.template/` holds the downstream replacements for the four documents written from the template's point of view — `README.md`, `CHANGELOG.md`, `docs/using-ai.md`, and `docs/using-this-template.md`, which becomes a provenance stub so the inbound links in the surviving guides still resolve — with `{{PROJECT_NAME}}`, `{{PROJECT_DESCRIPTION}}`, `{{TEMPLATE_REPOSITORY}}`, and `{{TEMPLATE_VERSION}}` tokens.
  
  `scripts/lib/setup.js` is the pure half: glob resolution, the instruction-file swap/delete/keep decision, and a planner that orders copies before deletions and the script's own removal last. It writes nothing and imports nothing from the filesystem.
  
  No behavior changes for anyone using the template today: nothing new runs, and no npm script was added. The setup CLI that applies the plan lands in a later change.
  
  Two new contract tests back the promises: `test/contracts/manifest.template-only.test.js` fails when the manifest names a path that no longer exists, when a `.template-only.test.js` file is missing from the prune list, when a payload file uses an undeclared placeholder, or when a payload document links to something setup deletes. `test/helpers/credential-shapes.js` now holds the credential patterns that `discord.test.js` defined inline, so both scans share one definition.
- 9829c4c: Split the contract assertions that are true only of this template into `*.template-only.test.js` files, and relax the shipped ones to assert the promise rather than this checkout.
  
  Contract tests ship downstream, so a test that only passes in this repository's layout is a defect in the template: a project created from it fails `npm test` on its first run through no fault of its own. Three assertions were in that category — the MCP server list pinned to exactly three names and URLs, the Wrangler environment set pinned to exactly `non-prod` and `production`, and `.dev.vars.example` required to exist and to hold nothing but `replace-me` values. All three are still worth making about *this* repository, so none of them was deleted. They moved:
  
  - `test/contracts/instructions.template-only.test.js` — the whole of the former `test/contracts/instructions.test.js`, unchanged. The contract version it enforces is the template's, and a project that completed the instruction-file swap has no upstream file to stay in sync with. `test/helpers/instruction-files.js` stays where it is.
  - `test/contracts/discord.template-only.test.js` — the `.dev.vars.example` placeholder case, and the exactness of the environment set.
  - `test/contracts/workflow.template-only.test.js` — the three expected MCP server names and their exact URLs.
  
  **What ships keeps a real promise, in a weaker form.** `discord.test.js` now asserts that both a non-production and a production environment exist in `wrangler.jsonc` without pinning the set, so a project may add a third. `workflow.test.js` no longer knows which MCP servers there should be; it asserts that `.mcp.json` and `.vscode/mcp.json` declare the *same* set, whatever it is, that every entry is exactly `{ type: "http", url }` over `https://`, and that no entry carries a credential-shaped key — `headers`, `token`, `apiKey`, `api_key`, `env`, `command`, or `args`. That is the promise worth keeping: the two files agree, and neither holds a secret.
  
  Each relaxed case was shown to fail before it was accepted: adding a `headers` key to one server, declaring a server in only one of the two files, and dropping `env.production` from `wrangler.jsonc` each go red with a message naming the problem. The mirror cases were checked too — adding a third environment, or a fourth server to both files, passes the shipped test and fails the template-only one, which is exactly the line the split is meant to draw.
  
  **Naming, not foldering.** The `.template-only.test.js` suffix is already matched by the `test/contracts/*.test.js` glob in `test:contracts`, so `package.json` is untouched. A `template-only/` subdirectory would force `node --test` to recurse a directory, where its default patterns also pick up non-test `.js` files under `test/`. The suffix also makes pruning file-level, which is what a future setup script needs.
  
  Nothing here changes runtime behavior, and no threshold moved: `npm test` runs 69 Vitest cases and 54 contract cases across ten contract files, and `npm run lint` is clean.
  
  Migration for a downstream project adopting this change: cherry-pick it, then delete the three `.template-only.test.js` files and `test/helpers/instruction-files.js` from your copy — they assert things about the template, not about your application. If you had already edited `test/contracts/instructions.test.js` or deleted `.dev.vars.example` locally to get a green suite, this change makes those edits unnecessary; take the upstream files and drop your local patch.
  
  `claude.md`, `AGENTS.md`, and `.github/copilot-instructions.md` each cited `test/contracts/instructions.test.js` by path as the worked example of a downstream-safe contract test. That path no longer exists and the claim behind it no longer holds, so all three now point at the relaxed `workflow.test.js` and the `.template-only.test.js` split instead. The requirement itself is unchanged — assert the promise, not this checkout — so the instruction contract version stays at 3.0.1, and nothing was mirrored into the `-for-users` files, which carry no downstream-alignment section because a single application is not maintaining a template.
  
  `CONTRIBUTING.md` documents the convention: what belongs in a template-only file, that nothing in one may be imported by a sibling that ships, that the shipped half must keep the promise in relaxed form, and that a split is not done until the relaxed case has been seen to fail.

## 0.2.0

### Minor Changes

- c89fb68: Register the command registry with Discord from the command line.
  
  Until now the registry in `src/commands/index.js` was only half-used: the Worker dispatched from it, but nothing told Discord those commands existed. `npm run register:non-prod`, `npm run register:production`, and `npm run register:dry-run` close that loop by `PUT`ting the same definition list to Discord's bulk-overwrite endpoint — guild-scoped for non-production, global for production. Two files, split along the line that matters: `scripts/lib/registration.js` holds all the logic and takes `fetch` as an argument, so it sits under the same coverage ratchet as `src/`; `scripts/register-commands.js` is arguments in, printed output and an exit code out, with no dependencies beyond Node's global `fetch`.
  
  **The scope is a required flag, not an inference.** `--guild` and `--global` are both explicit, and `--global` ignores `DISCORD_GUILD_ID` even when the shell has one exported. Deriving the scope from whether that variable happened to be set is the design where an inherited environment sends a production registration into somebody's test guild, and the isolation rule this template already applies to Cloudflare environments applies to Discord applications too.
  
  **The token cannot be printed, by construction rather than by care.** `buildRegistrationPlan` builds the printable request with `authorization: Bot [redacted]` already in it and no credential anywhere in the object. The real token is substituted inside `executeRegistration`, into an init object that is never returned. So no code path — including every error path — has a token available to log, and the error a refusal raises carries only Discord's status and its own response text.
  
  **What the endpoint actually does**, confirmed against Discord's documentation rather than recalled: `PUT` to either scope overwrites **all** types of application commands there, slash, user, and message alike, so the body is always the complete list and never a delta; commands that did not already exist count toward Discord's daily application-command create limits; guild commands update instantly, which is what makes guild scope the right one for non-production. Registration and deployment also roll back independently — redeploying an older Worker does not unregister anything — so deploy first and register second, and a command is never advertised before something can answer it.
  
  Tests, written before the implementation. The library gets Vitest unit tests for global-versus-guild URL selection, the `Authorization: Bot <token>` header shape, the body equalling the registry's definitions, a missing or blank variable failing before any request is made, a non-2xx surfacing both status and response body, and `--dry-run` issuing nothing. The CLI wrapper is the one piece Vitest cannot measure, so `test/contracts/registration.test.js` spawns the real file as a process with placeholder credentials and `test/helpers/forbid-fetch.js` preloaded — every `fetch` in the child throws, so a dry run that reached the network fails the test instead of passing quietly. Coverage stays at 100% across all four metrics with `scripts/lib/` now measured, so the thresholds in `vitest.config.js` are unchanged: they were already at the ceiling.
  
  Also in this change: `console` joins the shared platform globals in `eslint.config.js`, since a CLI's output is its whole purpose.
  
  Documentation: a new "Registering commands" section in `docs/discord-bot.md` — the two scopes and their endpoints, the overwrite-everything and daily-limit caveats, where each `DISCORD_*` value comes from in the Developer Portal, the dry-run output, and why the redaction is structural — plus the three scripts in the `README.md` commands table.
  
  Migration: none for a downstream project that has not customized `src/commands/index.js` beyond adding commands; the scripts register whatever the registry holds. A project that wrote its own registration script should delete it and adopt these, because two definition sources are the drift this template exists to prevent. Nothing here is wired into CI yet — registration on deploy, the declared secrets, and the isolation contract tests that enforce them land next.
- 28deb6f: Add the instrumentation the Discord implementation phases will be measured by, before writing any of that code.
  
  **Coverage as a ratchet.** `npm test` now runs `vitest run --coverage`, measuring `src/` and `scripts/lib/` with `@vitest/coverage-istanbul` and failing below the thresholds in `vitest.config.js`. Istanbul rather than V8: tests run inside `workerd`, which does not emit the V8 coverage profile the default provider reads.
  
  The thresholds are pinned to the measured baseline — 100% statements, branches, functions, and lines, which is what the single existing handler and its test actually reach — not to a round aspirational number. They move one way only. Raising one is a hand-edit in a reviewed diff; lowering one to make a change pass is the thing the ratchet exists to prevent. `coverage.thresholds.autoUpdate` is deliberately unused, because a threshold that rises without anyone noticing is not a promise anyone made.
  
  Measuring first is the point of the ordering. Thresholds added after the implementation can only be pinned to whatever the suite happened to reach, and the uncovered-branch signal arrives once the design has already set. Added now, the signal that a module is awkward to test arrives while it is still cheap to restructure — which is why the coming modules take their dependencies by injection.
  
  `test/contracts/coverage.test.js` asserts the ratchet exists: thresholds present and non-zero, the Istanbul provider, both source roots measured, `--coverage` wired into `npm test`, and `autoUpdate` off. It deliberately does not assert the threshold *values* — that would only create a second place to update, and the reviewed diff is the real control.
  
  **Discord documentation MCP server.** `.mcp.json` and `.vscode/mcp.json` gain Discord's first-party read-only documentation server (`https://docs.discord.com/mcp`), URL only and no credentials, in both schema formats. Every implementation phase after this one needs the current interaction contract — required signature headers, response types, acknowledgement windows, bulk-overwrite registration semantics — and those are exactly the details a model recalls plausibly and wrongly. This lands before the code that depends on it.
  
  **Also in this change.** `test/contracts/instructions.test.js` is new: it asserts the maintainer instruction files declare the same SemVer instruction contract version and that the `-for-users` files declare none, so the sync rule in `CONTRIBUTING.md` is checked rather than merely requested. All six instruction files gain the never-lower-the-threshold rule, since they are what an assistant actually reads; this is added to the unreleased 3.0.0 contract rather than bumped, as no downstream project has consumed 3.0.0 yet.
  
  Dependency updates carried in this change: `@changesets/cli` 2.31 → 3.0.2, `eslint` 10.8 → 10.10, `wrangler` 4.124 → 4.131, `vitest` pinned to `~4.1.11` so it stays aligned with `@vitest/coverage-istanbul`. `engines.node` returns to `>=22` to match `.nvmrc`, which a dependency bump had moved to `>=24` without moving `.nvmrc`; every installed tool supports Node 22, and the contract test that pins the two together is what caught it.
  
  `npm audit` reports a high-severity `sharp`/libheif advisory reached through `@cloudflare/vitest-pool-workers` → `miniflare` → `sharp`. It is accepted, not fixed, and the decision is recorded here so it is not re-opened each iteration: every package in that chain is a devDependency used to run tests, none of it is bundled into the deployed Worker, and no current release of the Cloudflare test tooling resolves it. `npm audit fix --force` would *downgrade* `@cloudflare/vitest-pool-workers` to 0.8.30, which predates the `cloudflareTest` plugin API this repository uses — a worse outcome than the advisory. Revisit when Cloudflare ships a pool release on a patched `miniflare`.
  
  Documentation: the coverage ratchet and its one-way rule in `CONTRIBUTING.md` and `docs/using-ai.md`, the new MCP server in `docs/using-ai.md` and `README.md` (including that the GitHub server needs interactive authorization and stays unavailable until it gets it).
  
  Migration: none for downstream projects. A project that already copied `vitest.config.js` and wants the ratchet should add `@vitest/coverage-istanbul`, copy the `coverage` block, and pin the thresholds to its own measured baseline rather than to this repository's 100% — the number here reflects a template with one handler in it.
- a0d8246: Register commands automatically on every deploy, and prove the wiring with contract tests.
  
  This is the requirement the Discord work started from: a push that reaches production re-registers its slash commands, so nobody has to remember to do it by hand. `.github/workflows/deploy.yml` gains two registration steps after the `cloudflare/wrangler-action@v3` step in the same job — `npm run register:production` when `github.ref_name` is `main`, `npm run register:non-prod` otherwise.
  
  **After the deploy, not before.** The ordering is the promise. Registering first would advertise a command to Discord while the Worker that answers it is still the previous version, and a failed deploy would leave Discord describing code that never shipped. Registering second means the endpoint is live before Discord is told anything, and a failed deploy never reaches the step at all.
  
  **The guard and the isolation are inherited, not restated.** Both steps live inside the single `DEPLOY_ENABLED`-guarded job, so an unconfigured project — the state every fresh copy of this template is in — never contacts Discord. The job's `environment:` expression is what makes `secrets.DISCORD_TOKEN` resolve to the right application: the same three secret names are held separately by the `non-prod` and `production` GitHub environments, so no step names another environment's values and nothing needs an environment-qualified secret. Only the non-production step receives `DISCORD_GUILD_ID`; a global registration has no guild to scope to, and an unused guild ID is one accident away from being a used one.
  
  **Every deploy is an unconditional bulk overwrite.** That is a decision, not an oversight: there is no diff-or-skip logic, because a "nothing changed" check that is wrong is worse than a redundant `PUT`. Commands that did not already exist count toward Discord's daily application-command create limits, while re-registering an unchanged list does not — so routine deploys cost nothing against the limit.
  
  Tests, written failing first, in `test/contracts/discord.test.js`: the registration steps run *after* the deploy step, asserted by step index rather than by both merely appearing; the workflow has exactly one job and its `DEPLOY_ENABLED` guard sits above the steps that inherit it; `main` maps to `register:production` and everything else to `register:non-prod`, leaving the assertion that those script names still mean `--global` and `--guild` where it already lives in `test/contracts/registration.test.js`; and each step reads only unqualified `DISCORD_*` secrets, feeds each variable from the same-named secret, and gives a guild ID to the non-production path alone. The workflow is parsed by indentation rather than with a YAML dependency, matching the existing contract tests. Both new guards were verified against planted violations — a reordered step and a cross-wired `PRODUCTION_DISCORD_GUILD_ID` — and each failed as intended.
  
  Documentation: `docs/using-this-template.md` gains the per-environment `DISCORD_*` secrets table in step 5, why they are environment-scoped rather than repository-scoped, why `DISCORD_PUBLIC_KEY` is not among them, a "Commands register themselves on deploy" section covering the branch-to-scope mapping and the create-limit caveat, and the note that a missing Discord secret fails the run *after* the Worker is already live. `docs/gitflow-and-branching.md` now explains that slash commands do not roll back with the Worker — a dashboard rollback changes only the code, so a reverting commit on `main` is the better rollback because it redeploys and re-registers in the right order — and that the surviving mismatch shows up as an ephemeral "unknown command" rather than a crash. `docs/discord-bot.md` notes that the manual scripts are for tunnels and failed runs, since CI now owns the routine case.
  
  Migration: a downstream project that adopts this needs `DISCORD_TOKEN` and `DISCORD_APPLICATION_ID` in both GitHub environments and `DISCORD_GUILD_ID` in `non-prod` before its next deploy; without them the deploy still succeeds and only the registration step fails. A project with its own registration automation should remove it rather than run both against one application, since the last writer wins a bulk overwrite. The workflow itself cannot be exercised from this repository — `DEPLOY_ENABLED` is unset here by design — so a real project's first `develop` deploy is where this path runs for the first time.
- 4f68250: Declare the Discord secrets per environment, and make the local-development path real.
  
  The Worker has read `env.DISCORD_PUBLIC_KEY` since signature verification landed and `env.DISCORD_APPLICATION_ID` since `/slow`, but nothing in the repository said so. `wrangler.jsonc` now declares `DISCORD_PUBLIC_KEY`, `DISCORD_APPLICATION_ID`, and `DISCORD_TOKEN` under `secrets.required`, at the top level and in both `non-prod` and `production`. Names only — no value appears in any tracked file, which is the whole point of declaring them there.
  
  **What the declaration actually buys**, confirmed against Cloudflare's current documentation rather than recalled: `wrangler dev` loads only the declared names from `.dev.vars` or `.env` and logs a warning listing any that are missing, and `wrangler deploy` / `wrangler versions upload` validate that every declared secret exists on that Worker before the operation succeeds, failing with the missing names if not. A `--dry-run` does not check, because it never contacts the account. Verified against the pinned Wrangler 4.131.1: both `--dry-run --env non-prod` and `--env production` accept the configuration, and `wrangler dev` without a `.dev.vars` warns `Missing required secrets: DISCORD_PUBLIC_KEY, DISCORD_APPLICATION_ID, DISCORD_TOKEN` and starts anyway. The deploy-time failure is the one part no checkout can exercise — it needs a real account and a Worker with a secret missing.
  
  **`npm run dev` now has a documented starting point.** `.dev.vars.example` is committed with obvious placeholders for the three Worker secrets plus `DISCORD_GUILD_ID`, and `.gitignore` gains `!.dev.vars.example` — the `.dev.vars.*` rule above it was ignoring the very example file the setup guide needs to reference. `git check-ignore -v` confirms the negation: `.dev.vars`, `.dev.vars.non-prod`, `.env`, and `.env.production` are still ignored, and `.dev.vars.example` is not.
  
  `DISCORD_TOKEN` is declared for the Worker even though the default commands never call a token-authenticated endpoint — the deferred follow-up in `/slow` uses the interaction's own token via the webhook route. It is declared because the per-environment Discord credential set is a contract this template makes, and because the first token-authenticated call a downstream project adds should find the secret already isolated per environment rather than improvised. A project that wants a leaner Worker can remove that one name from `secrets.required`; the registration script reads it from the shell either way.
  
  Tests, written failing first, in a new `test/contracts/discord.test.js`: every configuration level declares all three names; the only `DISCORD`-prefixed strings anywhere in `wrangler.jsonc` are inside a `secrets.required` array; `.gitignore` both spells out and — asked of Git itself with `git check-ignore` — actually applies the ignore rules and the one negation; and `.dev.vars.example` defines every variable with a placeholder value. The repository scan is the interesting one: it walks `git ls-files` and fails on anything token-shaped or public-key-shaped in a tracked text file. It was verified by planting both shapes in a tracked file and watching it name the file and line, then removing them — a guard nobody has seen fail is not a guard.
  
  Documentation: a new step 3, "Create your Discord applications", in `docs/using-this-template.md` — why two applications rather than one, where each value lives in the Developer Portal, `wrangler secret put` per environment, that a deploy fails on a missing declared secret, and how `.dev.vars.example` becomes a local `.dev.vars`. Later steps renumber, and the links into them from `README.md`, `docs/gitflow-and-branching.md`, and `docs/versioning-and-changesets.md` were updated with them. The credential-origin table that had accumulated in `docs/discord-bot.md` now points at the setup guide instead of restating it, so the fact lives in one place.
  
  Migration: a downstream project that already deploys must set all three secrets on each Worker environment (`npx wrangler secret put <NAME> --env <environment>`) before its next deploy, because the deploy now validates them. Projects that keep local secrets in `.env` rather than `.dev.vars` are unaffected — Wrangler reads either — but note that only declared names are loaded now, so a Worker reading an undeclared variable in local development must add it to `secrets.required`. Copy `.dev.vars.example` and the `!.dev.vars.example` line if adopting this by hand.
- 3b3aed3: Add the seam commands plug into, and the document that explains the bot.
  
  **A dispatcher that takes its world as an argument.** `src/interactions.js` exports `dispatchInteraction(interaction, { env, ctx, registry, rest })` and returns a `Response`. Bindings, the execution context, the command registry, and the Discord REST client all arrive as arguments rather than imports. That is the whole design decision in this change: a test can dispatch any interaction against a registry it invented and a REST client that records calls instead of making them, with no Worker to start and no network to reach. The alternative — a dispatcher that imports the real registry and calls `fetch` — makes every command's tests slower, less precise, and eventually stubbed, and the coverage ratchet would have been the first thing to go.
  
  `src/index.js` stays a router and hands the dispatcher the registry and a REST client bound to the runtime's `fetch`. The `unsupported interaction type` branch moved out of the router and into the dispatcher, where the interaction-type decisions now live together.
  
  **One registry, readable from plain Node.** `src/commands/index.js` exports an empty `commands` array plus the JSDoc typedefs describing a command's definition, handler, and context. It ships empty on purpose: a template that guesses at commands makes a downstream project delete things before it can add its own.
  
  Nothing under `src/commands/` may import a `cloudflare:` module, because the command registration script runs under plain Node and imports the same file that the Worker dispatches from. `test/contracts/commands.test.js` enforces it from outside the Workers pool — it imports the registry under plain Node and statically rejects a `cloudflare:` import in any file in that directory, so the constraint holds for commands added later, not just for the empty registry. Two copies of a command definition drift, and the failure is invisible from either side: Discord advertises a command the Worker does not handle, or the Worker handles one Discord never registered.
  
  **An unknown command is a `200`, not a `4xx`.** A name Discord offers but the registry does not carry gets an ephemeral reply saying the commands may need registering again. Discord renders a failed interaction as its own generic notice, which tells the user nothing, and the condition is a registration mismatch — the bot's problem to explain, not the user's to decode. The reply names no part of the payload.
  
  **The outbound half.** `src/discord/rest.js` adds `editOriginalResponse()` — `PATCH /webhooks/{application.id}/{interaction.token}/messages/@original`, confirmed against Discord's documentation ([Edit Original Interaction Response](https://docs.discord.com/developers/interactions/receiving-and-responding#edit-original-interaction-response)). The interaction token in the path is the authorization, so the call carries no bot token, and the token is valid for 15 minutes after the interaction. The API base is pinned to `v10`, since an unversioned base URL redirects to Discord's oldest supported version.
  
  It takes `fetch` as an argument, and `createRest(fetchImpl)` binds one so handlers never touch `fetch` directly. On a non-2xx response it throws an error carrying the **status only** — not the URL, which contains the interaction token, and not the response body, which can quote the content that was sent. An error message is the single most likely thing to end up in a log line, and observability is enabled on this Worker, so a log line is a durable record. A test asserts the token does not appear in the thrown message.
  
  **Documentation.** `docs/discord-bot.md` is new and covers only what exists: the three-step lifecycle (verify, PING/PONG, dispatch), the per-file module layout, the two rules the layout depends on, and how the Discord surface is tested with real signatures and no network. It is linked from the documentation tables in `README.md`, `claude.md`, and the document-role lists in `AGENTS.md` and `.github/copilot-instructions.md`. Later changes extend it rather than replacing it.
  
  **Coverage.** The thresholds stay at 100% statements, branches, functions, and lines — they cannot be raised, and the new modules are fully covered at that level (62 statements, 27 branches, 13 functions). `eslint.config.js` gains `fetch` as a declared global.
  
  Migration: none for downstream projects. A project that already copied `src/index.js` and is adopting this change should take `src/interactions.js`, `src/discord/rest.js`, and `src/commands/index.js` whole, then replace its own interaction-type branching with the `dispatchInteraction` call — the router's `fetch` handler now needs `ctx` in its signature so command handlers can reach `waitUntil`.
- 143357e: Serve the slice of the Discord contract that Discord itself validates: verify the signature, answer `PING` with `PONG`, reject everything else.
  
  **The endpoint.** `src/index.js` becomes a router and nothing more — `GET /` for health, `POST /interactions` for Discord, `405` for the wrong method on that path, `404` for anything else. The interaction logic lives beside it so the security-critical decision sits in one tested place:
  
  - `src/discord/verify.js` wraps `verifyKey` from `discord-interactions`. It reads the raw body only after both signature headers are present, and returns the raw text rather than a parsed object, because the signature covers the raw bytes and nothing may parse them first.
  - `src/discord/responses.js` builds `pong()`, `reply()`, `ephemeral()`, and `deferred()`, each with the `application/json` content type Discord requires on interaction responses — including the `PING` acknowledgement, which is the first thing it checks when an Interactions Endpoint URL is saved.
  
  Verification fails closed. A missing `DISCORD_PUBLIC_KEY` rejects interactions rather than accepting them unverified, and there is no development flag that turns the check off. Discord sends deliberately invalid signatures as a routine audit and removes the endpoint URL of an app that accepts one, so a bypass would not merely be unsafe — it would break the bot.
  
  An unverified request gets `401 invalid request signature` and its body is never parsed. That ordering has its own test: a request with no signature headers *and* an unparseable body must still fail as `401`, never `400`. A `400` there would prove the Worker parsed attacker-controlled input before authenticating it.
  
  **Runtime dependency.** `discord-interactions@^4.4.0`, the template's first — Discord-maintained, no transitive dependencies, and Web Crypto only, so it runs in `workerd` untouched. The bundle is 22.5 KiB (5.15 KiB gzipped).
  
  **Tests sign for real.** `vitest.config.js` generates a throwaway Ed25519 keypair per test run and supplies the public half to the test pool as `DISCORD_PUBLIC_KEY`, with the private half used only by `test/helpers/interactions.js` to sign fixtures. `verifyKey` therefore does real cryptography against a real signature instead of being stubbed, which is the only way a test of this module means anything. Generating the pair per run also keeps every key-shaped literal out of the repository and keeps test credentials unmistakably distinct from a real Discord application's. `workerd` was confirmed to support `generateKey`, `importKey`, `sign`, and raw/pkcs8 export for Ed25519, so no committed fixture keypair was needed.
  
  Nine behaviors are covered: the health route, three flavors of rejected signature, a valid signature over a tampered body, `PING`/`PONG` with its content type, a signed but malformed JSON body, an unhandled interaction type, and the `405`/`404` routing edges.
  
  Coverage stays at 100% of statements, branches, functions, and lines — but now over 41 statements rather than 1, which is the actual strengthening. The thresholds did not rise because they were already at the ceiling. The ratchet did its job along the way: it failed the run on an untested `400` branch, which then got the test it was missing.
  
  `eslint.config.js` gains `crypto`, `Request`, and `TextEncoder` as declared globals rather than inline disable comments at each use site.
  
  Migration: none for a downstream project that has not yet customized `src/index.js`. A project that has one must merge its own routes with the new router and keep `POST /interactions` verifying first. The Worker now reads `env.DISCORD_PUBLIC_KEY`; a later change declares it as a per-environment secret, and until then a local `.dev.vars` supplies it.
- df92363: Add the first two commands, and the pattern the rest are written against.
  
  **`/ping` and `/echo`.** Each is one file under `src/commands/` exporting `definition` and `handler`, listed in `src/commands/index.js`. The definition and the handler are co-located on purpose: they are two halves of one thing, and separating them is how a bot ends up advertising a command nobody implemented. Both are examples rather than features — a downstream project is expected to delete them once it has its own — so each one earns its place by showing exactly one thing. `/ping` is the shortest complete command. `/echo` is the option-parsing example.
  
  **Definitions declare their contexts instead of inheriting them.** `type`, `integration_types`, and `contexts` all have Discord-side defaults, and every definition in this template states all three anyway. Where a command can be used should be a property of this repository, visible in a diff, not a consequence of how a particular Discord application happens to be configured — and the two are configured separately per environment, so a default is a place they can silently disagree. `src/discord/command-types.js` is new and holds the constants (`ApplicationCommandType`, `ApplicationCommandOptionType`, `ApplicationIntegrationType`, `InteractionContextType`), confirmed against Discord's documentation ([application command structure](https://docs.discord.com/developers/interactions/application-commands#application-command-object-application-command-structure), [contexts](https://docs.discord.com/developers/interactions/application-commands#contexts)). Discord applies `integration_types` and `contexts` only to globally-scoped commands, which is documented rather than worked around: a guild-scoped registration is already confined to its guild.
  
  **An option is untrusted input even when Discord marked it required.** `/echo` declares `required: true` and still checks. Discord does enforce it, but a handler that assumes so throws on the first payload that disagrees, and a thrown handler is a failed interaction — Discord's own generic error notice, which tells the user nothing. A missing, misnamed, wrong-typed, or whitespace-only option gets an ephemeral reply naming what was missing. Options arrive as an array of `{ name, type, value }` rather than a keyed object, so reading one is a lookup; `/echo` does it in one place so "nothing given" is decided once.
  
  **Echoed user content cannot mention anyone.** `reply()` takes an optional `{ suppressMentions }`, which sets `allowed_mentions: { parse: [] }` ([allowed mentions](https://docs.discord.com/developers/resources/message#allowed-mentions-object)), and `/echo` uses it. Interaction responses parse user mentions by default, so sending raw user input back means the bot can ping somebody on a stranger's behalf. The risk in a `/echo` example is small; the habit it would teach is not, and this is the file new commands get copied from. The parameter is optional, so `reply(content)` is unchanged.
  
  **Registry-wide validation, not per-command validation.** `test/commands/registry.test.js` checks every entry in `commands` against Discord's rules — the naming regex and lowercase requirement, a non-empty description within 100 characters, declared `type`/`integration_types`/`contexts`, valid option names and descriptions, required options before optional ones, unique names, a callable handler. Written against the array rather than against `ping` and `echo` by name, so a command added later is checked without anyone remembering to extend it. The failure then lands at `npm test` instead of as a generic `400` from the bulk-overwrite endpoint after a deploy has already run.
  
  The command tests dispatch through `dispatchInteraction` against the real registry rather than one the test invents. A command is only working when it is *in the registry* and its handler answers, and a test that supplies its own registry passes even when the command was never registered.
  
  **Coverage.** Thresholds stay at 100% statements, branches, functions, and lines — they cannot be raised. The new code is fully covered at that level: 81 statements (from 62), 35 branches (from 27), 17 functions (from 13).
  
  Migration: none. `reply()`'s new parameter is optional and `src/commands/index.js` previously exported an empty array, so a downstream project that already has its own commands keeps them and takes `src/discord/command-types.js` plus, optionally, `test/commands/registry.test.js` — which is worth taking on its own, since it validates whatever commands that project already has. A project that wants the examples takes `src/commands/ping.js` and `src/commands/echo.js` and adds them to its own registry array. Note that adding commands changes nothing on Discord's side until they are registered.
- 742ceea: Re-point this repository from the generic `cloudflare-workers-template` boilerplate to a Discord bot template. This change is identity only — no Worker behavior changes, and `src/` is untouched.
  
  - `package.json`: renamed to `cloudflare-workers-discord-template`, description now names a Discord bot on Cloudflare Workers, keywords gain `discord`, `discord-bot`, and `slash-commands`, and the version resets to `0.1.0` as the baseline for this template's own history.
  - `wrangler.jsonc`: all three Worker names renamed, keeping the `-non-prod` and `-production` suffixes. The existing contract tests in `test/contracts/environment-isolation.test.js` are the check that environment isolation survived the rename.
  - Stale references to the old project updated in `README.md`, `claude-for-users.md`, `CONTRIBUTING.md`, and `docs/using-this-template.md`. The upstream remote URL documented for downstream adoption is now `https://github.com/mbakaitis/cloudflare-workers-discord-template.git`.
  - `CHANGELOG.md`: the inherited history is replaced with a single `0.1.0` entry recording derivation from `cloudflare-workers-template@1.0.0`. That history described releases of a differently named package with a different purpose, so carrying it forward would have implied this package shipped those versions.
  
  Migration: none for existing downstream projects. Anything generated from the old template already has its own name and its own remote, and nothing here changes a command, a file path, or a deployment contract. A project that documented the upstream remote as `github.com/mbakaitis/workers.git` should repoint it.
  
  Classified `minor` rather than `major` deliberately: on a `0.x` version a `major` bump would jump straight to `1.0.0`, which would claim a stable release in the middle of an unfinished branch series. The aggregate bump for the series is reconciled before release.
- 4479102: Add `/slow`, the deferred-response example, and the injected timer it needs.
  
  **Why this command exists.** Discord requires an initial response within 3 seconds and invalidates the interaction token if one does not arrive; the token then stays valid for 15 minutes ([interaction callback](https://docs.discord.com/developers/interactions/receiving-and-responding#interaction-callback)). So work that cannot promise to beat 3 seconds has to acknowledge inside the window and send the real answer afterwards. That is the one shape a bot template has to demonstrate, because a command that gets it wrong looks fine in development and fails under load — the promise is about the worst case, not the average.
  
  `/slow` acknowledges with `DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE` (type `5`), hands the rest to `ctx.waitUntil`, and completes the interaction through `rest.editOriginalResponse()` — `PATCH /webhooks/{application.id}/{interaction.token}/messages/@original` ([edit original interaction response](https://docs.discord.com/developers/interactions/receiving-and-responding#edit-original-interaction-response)). `waitUntil` is not optional: Cloudflare cancels asynchronous work that is neither awaited nor scheduled once the response goes out, so without it the follow-up dies mid-flight and the user's loading state never resolves ([`ctx.waitUntil()`](https://developers.cloudflare.com/workers/runtime-apis/context/#waituntil)).
  
  **The two failures are handled differently, on purpose.** If the slow work throws, the edit still goes out carrying a short failure message — there is a live token and a user watching a spinner, and letting it time out tells them nothing. If the *edit* throws, it is swallowed: the only channel to the user is the call that just failed, and a rejection left unhandled inside `waitUntil` fails the invocation after a successful response was already sent, recording a Worker error nobody can act on while the user sees a command that worked. Neither path logs, and the failure message quotes nothing from the payload.
  
  **`src/runtime.js` is new: ambient capabilities are bound at the entry point, not imported by handlers.** It holds `sleep`, the template's only timer, and `src/index.js` passes it through the dispatcher into the command context alongside `rest`. A handler that reaches for a timer itself is a handler whose tests have to wait, so `dispatchInteraction(interaction, { env, ctx, registry, rest, sleep })` gained one field and `CommandContext` gained `sleep`. `/slow`'s tests inject a `sleep` they hold open and release by hand, which is what makes the ordering assertion — acknowledged first, edited later — deterministic instead of a race with the microtask queue.
  
  **The follow-up is asserted, not assumed.** `test/commands/slow.test.js` settles the `waitUntil` promise through `createExecutionContext()` and `waitOnExecutionContext()` from `cloudflare:test`, then asserts against a recording `rest` fake that the `PATCH` happened and what it carried. A test that only checked the promise was scheduled would pass against a follow-up that never ran. The whole suite still runs in under a second and waits on nothing: `src/runtime.js` is exercised directly at zero milliseconds and every command test injects its own timer.
  
  **Coverage.** Thresholds stay at 100% statements, branches, functions, and lines — they were already at the ceiling and cannot be raised. `src/` is now feature-complete and fully covered at that level: 100 statements (from 81), 35 branches (unchanged), 22 functions (from 17), 95 lines. Nothing in `src/` is unreachable and nothing is excluded from measurement.
  
  Migration: none required. A downstream project that already has its own commands keeps them; `/slow` is a worked example and is expected to be deleted along with `/ping` and `/echo`. A project that wants the deferral pattern takes `src/commands/slow.js`, `src/runtime.js`, and the one-line `sleep` pass-through in `src/index.js` and `src/interactions.js`. A project that has its own command handlers and adopts the dispatcher change needs no handler edits: `sleep` is an added context field, and handlers that ignore it are unaffected. Note that adding a command changes nothing on Discord's side until it is registered.

### Patch Changes

- c5d6c29: Fix the instruction-file contract test so it passes in a downstream project.
  
  `test/contracts/instructions.test.js` asserted this repository's file layout rather than the promise behind it: three maintainer instruction files declaring one agreed contract version, three `-for-users` counterparts declaring none. A project that followed the documented setup step and renamed the counterparts into place therefore failed `npm test` on its first run — the in-place files no longer carry a version, and the counterparts no longer exist.
  
  The audit now detects which layout it is looking at and applies the rule that belongs to it:
  
  - **The template's layout** — counterparts present — keeps the full contract: all six files, one identical Semantic Version across the maintainer three, no version on the counterparts.
  - **A project's layout** — counterparts gone — requires only that no in-place file still declares a contract version. Which of the three a project keeps is its own business.
  - **No instruction files at all** — the documented "delete all six" path — has nothing to check.
  
  Anything else is a half-finished swap, which now fails with a message naming each file involved. That state was previously invisible, and "skip the counterpart when it is missing" would have kept it that way.
  
  No action is needed in a downstream project beyond adopting the change: if `npm test` was already failing on this test after setup, it stops. The logic moved to `test/helpers/instruction-files.js` and is covered by fixture cases for every layout, including the failure modes.
  
  Instruction contract version 3.0.0 → 3.0.1: `claude.md` and its adapter files now state that a contract test which only passes in this repository's layout is a template defect, since contract tests ship downstream. That sharpens an existing rule rather than adding a requirement.
- 454f961: Keep `package-lock.json` in step with `package.json` when a version is cut.
  
  `changeset version` rewrites `package.json` and `CHANGELOG.md` but never touches the lockfile, so every release so far would have shipped a lockfile still naming the previous version. The `version` script now runs `npm install --package-lock-only` after the bump. Nothing else in the lockfile moves — no dependency is re-resolved, because no dependency range changed — and `node_modules` is untouched.
  
  The drift is harmless to `npm ci`, which does not verify the root package's version, and that is exactly why it survives unnoticed. It matters for anything that reads the lockfile as a description of the package: provenance, supply-chain tooling, and a downstream project trying to work out which template version it started from.
  
  `test/contracts/versioning.test.js` is new and ships downstream. It asserts the lockfile's `version` and `name` — in both the root object and `packages[""]` — match `package.json`, and that the `version` script still refreshes the lockfile. Both sync assertions were verified against injected drift rather than merely written: a lockfile temporarily set to `9.9.9` with a mismatched name fails both, and reverting restores green.
  
  Migration: none. A project created from an earlier copy of this template can adopt the one-line script change and the contract test together, and should run `npm install --package-lock-only` once to correct any drift it already has.
- c5d6c29: Fix the setup ordering in `docs/using-this-template.md` and explain where each Discord secret actually goes.
  
  Step 3 told you to run `wrangler secret put` before it told you to run the bot locally, which put the first command that needs a Cloudflare account ahead of the entire no-account path — and did it immediately after step 2 reassured you that `--dry-run` "never contacts your account." The README had the right order all along (local at step 5, Worker secrets at step 8), so the two documents disagreed about when an account becomes necessary.
  
  Neither document was wrong about the secrets themselves. `.dev.vars` and `wrangler secret put` are two different stores for the same three names, and a project needs both. But nothing said so plainly, so the pair read as a contradiction.
  
  What changed, all documentation:
  
  - **A new [Where each value goes](docs/using-this-template.md#where-each-value-goes) section** names the three stores — `.dev.vars`, Cloudflare's per-Worker encrypted store, and GitHub Environment secrets — with who reads each and which step sets it, and states that nothing synchronizes them. It is a grid of environment against store, so which names each store holds is visible per environment: `.dev.vars` is non-production only and has no production counterpart, a non-production value ends up in three places and a production value in two, and the two deliberate absences (`DISCORD_PUBLIC_KEY` everywhere in CI, `DISCORD_GUILD_ID` in production) are called out where a reader would otherwise read them as omissions. It also notes that `DISCORD_GUILD_ID` is loaded differently from the rest — `wrangler dev` reads `secrets.required` from `.dev.vars` automatically, but the registration script reads the guild ID from the shell, so the file alone is not enough.
  - **[Where each value comes from](docs/using-this-template.md#where-each-value-comes-from) now says to keep your own copy of each bot token.** The public key and application ID stay readable in the Developer Portal, so they never need recording; the token is shown once and is unrecoverable, and the cost of losing it is re-entering a reset value in every store that holds it.
  - **"Run it locally" now precedes "Set them on each Worker"** within step 3. Both anchors are unchanged, so existing links still resolve.
  - **"Set them on each Worker" opens by saying it is the first step needing a Cloudflare account**, and that Wrangler must be authenticated.
  - **The placeholder-Worker prompt is documented.** No Worker exists yet at that point, so Wrangler offers to create one to hold the secret. The docs now quote the prompt, say to answer yes, and note the two visible consequences: both Worker names appear in the dashboard before anything is deployed, and neither answers a request until the first real deploy.
  - **A new subsection explains why the step cannot wait** until after the first deploy: `secrets.required` makes the deploy fail, and `deploy.yml` has no `wrangler secret put` step, so CI can never set them.
  - The README gained brief notes at steps 5 and 8 pointing at the same distinction, and `docs/template-acceptance-test.md` Phase 7 now checks that a first-time reader was prepared for the account requirement and the placeholder Workers.
  
  No action is needed in a downstream project. No code, configuration, script, or test changed, and no documented command or file path changed.

## 0.1.0

Initial version of `cloudflare-workers-discord-template`, derived from the
`cloudflare-workers-template` boilerplate at version 1.0.0.

This template inherits that project's scaffolding — named `non-prod` and `production` Wrangler
environments, environment-isolation and workflow contract tests, the Gitflow branching and
Changesets release path, MCP wiring, and the dual maintainer/downstream AI instruction files — and
re-points it at a new purpose: a Discord bot serving HTTP interactions on a Cloudflare Worker.

The inherited changelog history is not reproduced here. It described releases of a differently
named package with a different purpose, and carrying it forward would imply this package had
shipped those versions. Consult the upstream repository for that history.

Everything after this entry is generated by Changesets at release time.
