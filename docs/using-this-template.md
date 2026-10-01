# Using This Template

This guide takes you from "I want a new Worker" to "my project deploys to Cloudflare safely." Work through it once, when you create the project. For day-to-day work afterwards, use [Gitflow and branching](gitflow-and-branching.md) and [Versioning and changesets](versioning-and-changesets.md).

It covers the things that files in your new repository cannot configure for you: repository ownership, branches, Cloudflare targets, Discord applications, secrets, and repository rules.

## 0. Choosing how to start

There are two ways to get these files, and the difference that matters is what your project's commit history looks like afterward.

| | Use this template | Clone only |
| --- | --- | --- |
| Creates a GitHub repository for you | Yes | No |
| Commit history | Fresh start, single initial commit | Full history of this repository, but no repository of your own until you repoint it |
| Linked to this repository on GitHub | No | No |
| Best for | Real projects | Evaluating the template, or preserving history to cherry-pick from later |

Neither path merges upstream changes into your repository automatically — see [Keeping up with upstream changes](#10-keeping-up-with-upstream-changes) for how to adopt them deliberately either way.

### Use this template (recommended for real projects)

Select **Use this template > Create a new repository**, then choose the owner, name, and visibility. Your project starts with a clean, single-commit history that belongs to you: no inherited commits, issues, or pull requests from this repository, and nothing for a new contributor to page through when they run `git log`. This is the leaner of the two paths.

One consequence to plan for: GitHub copies only the default branch unless you check **Include all branches**. You will create `develop` yourself in step 4 either way, since this repository does not carry one.

### Clone only

`git clone` copies this repository's full commit history to your computer without creating anything on GitHub. Its `origin` remote still points at **this** repository, so you cannot push your work anywhere of your own, and pushing at all would target the template. Use this to read the code or run the tests before deciding, or because you specifically want that history available locally (for example, to `git cherry-pick` a later template commit instead of reapplying it by hand).

To turn a clone into a project later, create an empty repository on GitHub and repoint the remote:

```sh
git remote set-url origin https://github.com/YOUR-OWNER/YOUR-REPOSITORY.git
git push -u origin main
```

This carries the full history into your new repository, which is heavier than **Use this template** but keeps every commit.

## 1. Create and clone your repository

Pick a path above and create the repository. The project name is yours; it does not have to resemble this template's name. For example, creating `acme-weather-api` under the organization `acme` gives you `github.com/acme/acme-weather-api`.

Then clone **your** repository — not this one — and install dependencies:

```sh
git clone https://github.com/acme/acme-weather-api.git
cd acme-weather-api
npm install
```

Replace `acme/acme-weather-api` with what you actually created. The `cd` command enters the directory `git clone` created, so run it only after cloning.

Keep the `.github/`, `docs/`, `src/`, `test/`, `package.json`, and `wrangler.jsonc` files unless your project has a deliberate alternative.

### Run `npm run setup`

One command turns the template into your project:

```sh
npm run setup
```

It asks for a project slug and a one-line description, prints everything it is about to do, and waits for you to confirm. Use `npm run setup -- --dry-run` to see the plan and stop there, or `npm run setup -- --name acme-weather-api --yes` to run it unattended. The bare `--` is npm's separator between its own arguments and the script's; leave it out and npm keeps the flag for itself.

| What it does | Detail |
| --- | --- |
| Names your Workers | The three `name` values in `wrangler.jsonc` become `<slug>`, `<slug>-non-prod`, and `<slug>-production` — [step 2](#2-name-your-workers) explains what each one is for |
| Renames the package | `name` and `description` in `package.json` and `package-lock.json`, with the version reset to `0.0.0` |
| Swaps the AI instruction files | `claude-for-users.md` becomes `claude.md`, and likewise for `AGENTS.md` and `.github/copilot-instructions.md`. Pass `--ai delete` to remove all six instead, or `--ai keep` to decide later |
| Creates `.dev.vars` | Copied from `.dev.vars.example`, never overwriting one you already have. Setup prints paths, never contents |
| Lowers the coverage ratchet | From the template's 100% to a floor of 80% across all four metrics — a reasonable starting point for an application, and still a ratchet |
| Replaces the template-framed documents | This guide, `README.md`, `docs/using-ai.md`, and `CHANGELOG.md` become versions written for your project |
| Prunes the template's scaffolding | `CONTRIBUTING.md`, the template's changelog and pending changesets, the template-only contract tests, and `template-manifest.json` |
| Records provenance | A `template` key in `package.json` naming the upstream repository, version, commit, and setup date |
| Adds the `upstream` remote | Unless one already exists — see [Keeping up with upstream changes](#10-keeping-up-with-upstream-changes) |
| Deletes itself | `scripts/setup.js`, its library, its tests, and the `setup` npm script, as its last act |

Setup is a one-shot. It refuses to run where provenance already exists, and refuses a dirty working tree unless you pass `--force`, so run it on a clean checkout straight after `npm install` and its whole effect lands in one reviewable commit.

Two things it deliberately leaves alone, and prints a reminder about: `LICENSE.md` still carries this template's author and copyright year, and `package.json` still names them as `author`. Both are yours to change — guessing who owns your project is not setup's job.

The AI instruction files are swapped rather than edited because the maintainer versions describe keeping this boilerplate up to date for many future projects, which stops applying the moment you build on top of it. If you don't use AI tooling, `npm run setup -- --ai delete` removes all six. See [Using AI With This Template](using-ai.md#the-instruction-files) for what each file is for.

## 2. Name your Workers

`npm run setup` already wrote these from the slug you gave it. This step is here so you know what it named and why, and so you can check it before anything is deployed.

These are Cloudflare Worker resource names — not GitHub repository names, branch names, domains, or API tokens. A Worker name identifies a deployed Worker inside your Cloudflare account.

| Wrangler field | Example value | Used for |
| --- | --- | --- |
| Top-level `name` | `acme-weather-api` | Local development; also used if someone runs `wrangler deploy` without `--env` |
| `env.non-prod.name` | `acme-weather-api-non-prod` | The Worker deployed when `develop` changes |
| `env.production.name` | `acme-weather-api-production` | The Worker deployed when `main` changes |

For the slug `acme-weather-api`, `wrangler.jsonc` now reads:

```jsonc
{
  "name": "acme-weather-api",
  "main": "src/index.js",
  "compatibility_date": "2026-08-18",
  "observability": {
    "enabled": true
  },
  "secrets": {
    "required": ["DISCORD_PUBLIC_KEY", "DISCORD_APPLICATION_ID", "DISCORD_TOKEN"]
  },
  "env": {
    "non-prod": {
      "name": "acme-weather-api-non-prod",
      "secrets": {
        "required": ["DISCORD_PUBLIC_KEY", "DISCORD_APPLICATION_ID", "DISCORD_TOKEN"]
      }
    },
    "production": {
      "name": "acme-weather-api-production",
      "secrets": {
        "required": ["DISCORD_PUBLIC_KEY", "DISCORD_APPLICATION_ID", "DISCORD_TOKEN"]
      }
    }
  }
}
```

Setup changed the three `name` values and nothing else in this file. The `secrets.required` blocks declare *names*, never values: they tell Wrangler which secrets each environment must have. Leave them as they are and see [Create your Discord applications](#3-create-your-discord-applications) for where the values come from.

Setup also set `name` in `package.json` to the same slug, so the package and the Worker agree. What is left for you is a look in the Cloudflare dashboard: confirm the names are available, and that the non-production and production names refer to separate Workers.

Leave `compatibility_date` alone unless you have a reason to move it, and treat any change to it as a deliberate, documented decision. `observability.enabled` captures logs and telemetry for the deployed Worker; keep it on.

Add bindings inside the matching environment only. A non-production D1 database belongs under `env.non-prod`; a production D1 database belongs under `env.production`. Never point non-production at production databases, buckets, queues, or other stateful resources. See [Adding environment-specific bindings](#adding-environment-specific-bindings).

### Environment isolation is enforced

Isolation is not just advice here — **contract tests** run as part of `npm test` and verify:

- **Unique Worker names.** The top-level, `non-prod`, and `production` Workers must all have distinct names.
- **Clear naming.** The `non-prod` name should contain `non-prod`, `staging`, or `dev`; the `production` name should contain `production` or `prod`.
- **No production bindings at the top level.** D1 databases, R2 buckets, KV namespaces, and similar bindings must not sit in the top-level configuration.
- **Environment structure.** The configuration must define separate `env.non-prod` and `env.production` sections.

So if you give `env.non-prod` and `env.production` the same name, or attach a database at the top level, `npm test` fails before you can deploy. Verify locally with:

```sh
npm test
npx wrangler deploy --dry-run --env non-prod
npx wrangler deploy --dry-run --env production
```

The dry runs report what each environment would deploy and bind, without deploying anything.

## 3. Create your Discord applications

Create **two** Discord applications at the [Discord Developer Portal](https://discord.com/developers/applications) — one for non-production, one for production. Name them so you can tell them apart at a glance, for example `Acme Weather (non-prod)` and `Acme Weather`.

Two applications, not one, for the same reason this template ships two Workers. Each application has its own public key, application ID, and bot token, so:

- A non-production Worker cannot answer, or post as, your production bot. Nothing you break while developing reaches real users.
- Each environment's Interactions Endpoint URL points at its own Worker, so a non-production deploy cannot take over production's endpoint.
- Non-production commands can be registered to one test guild, where they appear instantly, while production registers globally.
- A leaked non-production token is a contained incident. A shared token makes every leak a production leak.

Never copy a credential from one application into the other, and never give a non-production environment a production value.

### Where each value comes from

For each application, from its page in the Developer Portal:

| Value | Where to find it | Who reads it |
| --- | --- | --- |
| `DISCORD_PUBLIC_KEY` | **General Information > Public Key** | The Worker, to verify every interaction's signature |
| `DISCORD_APPLICATION_ID` | **General Information > Application ID** | The Worker, to edit deferred replies; the registration script, to build its URL |
| `DISCORD_TOKEN` | **Bot > Token** (use **Reset Token**; it is shown once) | The registration script, as `Authorization: Bot <token>` |
| `DISCORD_GUILD_ID` | Right-click your test server in Discord with Developer Mode on > **Copy Server ID** | The registration script, for guild-scoped non-production registration |

The public key and application ID are identifiers, not secrets; the bot token is a credential that can act as your bot. This template treats all of them as secrets anyway, because the cost of doing so is zero and the cost of confusing which is which is not.

**Keep your own copy of each bot token.** The public key and application ID stay readable in the Developer Portal indefinitely, so you can always go back for them and never need to record them anywhere. The token is different: it is displayed once, at the moment you reset it, and cannot be read again. Put it somewhere durable — a password manager, not a file in this repository — before you leave the page. If you lose it, the only recovery is **Reset Token**, which invalidates the old value and means re-entering the new one in every store that holds it: three for non-production, two for production, as the next section lays out.

### Where each value goes

The same names live in up to three different places, and they are not interchangeable. Read this once before you paste any values, because it is the part of setup most likely to leave you guessing:

| | `.dev.vars` in your working copy | Cloudflare's per-Worker secret store | GitHub **Environment** secrets |
| --- | --- | --- | --- |
| **non-production** | `DISCORD_PUBLIC_KEY`, `DISCORD_APPLICATION_ID`, `DISCORD_TOKEN`, `DISCORD_GUILD_ID` | `DISCORD_PUBLIC_KEY`, `DISCORD_APPLICATION_ID`, `DISCORD_TOKEN` | `DISCORD_TOKEN`, `DISCORD_APPLICATION_ID`, `DISCORD_GUILD_ID` |
| **production** | **never** | `DISCORD_PUBLIC_KEY`, `DISCORD_APPLICATION_ID`, `DISCORD_TOKEN` | `DISCORD_TOKEN`, `DISCORD_APPLICATION_ID` |

- **`.dev.vars`** is read by `wrangler dev` on your own machine, and by nothing else. It holds **non-production values only.** Production credentials never belong on a developer machine, so this file has no production counterpart — do not create one, even though `.gitignore` would ignore it. Set it in [Run it locally](#run-it-locally), below; no Cloudflare account needed.
- **Cloudflare's per-Worker encrypted secret store** is read by your **deployed** Worker, at runtime. Each environment's Worker holds its own Discord application's values. Set it in [Set them on each Worker](#set-them-on-each-worker), below; needs a Cloudflare account.
- **GitHub Environment secrets** are read by the command-registration step of `deploy.yml`, in CI. Set them in [step 5](#5-configure-github-environments-and-secrets), which also explains the two absences: `DISCORD_PUBLIC_KEY` is missing everywhere because only the Worker verifies signatures, and `DISCORD_GUILD_ID` is missing from `production` because production registers globally.

So a non-production value ends up in three places and a production value in two, and nothing you do locally is what makes either environment work. Setting one store does not set the others, and nothing synchronizes them: a value in `.dev.vars` never reaches Cloudflare, and a `wrangler secret put` never reaches your local `npm run dev`.

One name is loaded differently from the rest. `wrangler dev` reads the three names in `secrets.required` out of `.dev.vars` automatically, but `npm run register:non-prod` reads `DISCORD_GUILD_ID` from the shell environment — so having it in the file is not enough. Export it, or run `set -a; source .dev.vars`, before you run the script.

The rest of this step works through the first two in that order, deliberately: local development needs no Cloudflare account, so there is no reason to open one before you have the bot running on your own machine.

### Install the non-production application in your test server

Guild-scoped registration only works in a server the application is actually installed in — Discord answers `403 Missing Access` otherwise. Build an install link under **OAuth2 > URL Generator**, open it, and choose your test server. Authorizing it requires the `MANAGE_GUILD` permission on that server.

This is what the bot in this template needs, and no more:

| | Select | Why |
| --- | --- | --- |
| **Scopes** | `applications.commands` | The only scope slash commands require. It registers and serves every command in this template. |
| **Scopes** | `bot` — optional | Adds a bot user to the server. Not needed for commands in a channel; needed if you want the `BOT_DM` context that the shipped definitions declare, since that context is the DM with the bot user. |
| **Bot permissions** | none | Leave every box unchecked. |

Discord states the rule directly: application commands do not depend on a bot user in the guild, and "if your application does not require a bot user in the guild for its commands to work, you don't need to add the bot scope or a permission bitfield to the URL" ([Authorizing your application](https://docs.discord.com/developers/interactions/application-commands#authorizing-your-application)).

No permissions are needed because this bot only ever *answers an interaction it was handed*, using that interaction's token — never posting into a channel on its own initiative. Tutorials commonly check `Send Messages` in the URL generator, including [Discord's own Cloudflare Workers tutorial](https://docs.discord.com/developers/tutorials/hosting-on-cloudflare-workers#adding-bot-permissions). That permission governs sending messages to a channel, which nothing in `src/` does. Granting it costs you the ability to say the bot cannot do it.

#### The list changes when your bot does

Scopes and permissions describe *your features*, not this template, so keeping them right is your project's job and nothing in this repository can check it for you. Roughly:

- **Posting outside an interaction** — a scheduled announcement, a reply in another channel, reacting, uploading a file, pinning — needs the matching bot permission and therefore the `bot` scope.
- **Reading anything** — message history, the member list, roles — needs its own permission, and message content may need a privileged intent approved for the application.
- **Mentions.** `MENTION_EVERYONE` is one of the few permissions Discord computes from the bot's own grants when it responds to an interaction. This template suppresses mentions in user-supplied content instead; see [The Discord bot](discord-bot.md#habits-worth-copying).
- **OAuth2 features** — logging a user in, reading their guilds — add *scopes*, a client secret, and somewhere to store tokens.

When a feature needs more, widen the install URL and re-run it: changing scopes or permissions requires re-authorization, or an edit under **Server Settings > Integrations**. Record why each permission is there, the same way you would a new binding.

Do all of this for the non-production application now. The production application is installed by whoever adds it to a real server, which is a separate decision from setting this project up.

### Run it locally

Do this before anything that touches Cloudflare. Local development needs no Cloudflare account, no deployed Worker, and no production application — only your **non-production** application's values.

`npm run setup` already created `.dev.vars` for you, holding a `replace-me` placeholder for each name. Fill in the four values from your non-production application, then:

```sh
npm run dev
```

`.dev.vars` is ignored by Git, and setup pruned the `.dev.vars.example` it was copied from — the example existed to seed exactly this file. Because `wrangler.jsonc` declares `secrets.required`, Wrangler loads those three names from `.dev.vars` and warns about any still unset, so `npm run dev` starts either way: `GET /` answers `OK`, and `POST /interactions` answers `401` for anything it cannot verify.

Making the local Worker reachable by Discord itself needs a tunnel; see [Developing against a local tunnel](discord-bot.md#developing-against-a-local-tunnel) for how, and [Discord bot](discord-bot.md) for the interaction lifecycle this endpoint implements.

Nothing up to this point has touched Cloudflare, and this is a reasonable place to stop for a while: you can write commands, run `npm test`, and — with a tunnel — answer real interactions from Discord, all without an account. The next section is where that changes.

### Set them on each Worker

**This is the first step that needs a Cloudflare account**, and the first that changes anything inside it. Wrangler has to be authenticated too: `npx wrangler login` opens a browser, or export `CLOUDFLARE_API_TOKEN` in your shell.

`wrangler.jsonc` declares the names (see [step 2](#2-name-your-workers)); the values are set per environment with Wrangler and stored encrypted by Cloudflare:

```sh
npx wrangler secret put DISCORD_PUBLIC_KEY --env non-prod
npx wrangler secret put DISCORD_APPLICATION_ID --env non-prod
npx wrangler secret put DISCORD_TOKEN --env non-prod
```

Repeat with `--env production`, using the **production** application's values. Each command prompts for the value and does not echo it.

#### Your Workers do not exist yet, and Wrangler will offer to create them

Nothing has deployed at this point, so there is no `acme-weather-api-non-prod` in your account for a secret to attach to. Wrangler does not treat that as an error. It asks:

> There doesn't seem to be a Worker called "acme-weather-api-non-prod". Do you want to create a new Worker with that name and add secrets to it?

Answer yes. Wrangler uploads a placeholder Worker — a stub that serves nothing — so the secret has somewhere to live, then stores the secret on it. Your first real deploy in [step 7](#7-verify-the-deployment-path) replaces the stub with your actual code and keeps the secrets.

Two things follow, and both are normal: your Cloudflare dashboard lists both Worker names before you have deployed anything, and a request to either one fails until that first deploy. Answering no aborts and stores nothing, which only moves the problem to step 7.

#### Why this cannot wait until after the first deploy

Because the deploy is what would fail. The `secrets.required` blocks mean `wrangler deploy --env <name>` refuses to deploy an environment missing any of the three and names the ones it cannot find.

CI runs that deploy, and **CI never sets these for you.** `deploy.yml` runs `wrangler deploy` and then the registration script; it contains no `wrangler secret put` step, and GitHub is never given `DISCORD_PUBLIC_KEY` at all ([step 5](#5-configure-github-environments-and-secrets) explains why). Setting the Worker's secrets by hand, once per environment, is the only path.

A `--dry-run` does not check, because it never contacts your account — which is why [step 2](#2-name-your-workers)'s dry runs passed with none of this configured. The first real deploy is where a missing secret surfaces.

These are Cloudflare Worker secrets, set once per environment from your machine. They are separate from the GitHub Actions secrets in [step 5](#5-configure-github-environments-and-secrets), which are what CI uses for command registration.

### The endpoint URL comes last

One field on each application is deliberately left for [step 8](#8-point-each-discord-application-at-its-worker): the **Interactions Endpoint URL**. It cannot be filled in yet, and the reason is an ordering constraint that only becomes visible once everything is real — Discord sends a signed `PING` to the URL at the moment you save it and rejects the URL if nothing answers correctly. So the Worker has to exist, be deployed, and already hold its `DISCORD_PUBLIC_KEY` before the URL will save at all.

That fixes the order of the remaining steps: set the secrets, deploy, then point Discord at the deployed Worker. Command registration is the same shape of dependency in reverse — it happens automatically after each deploy ([Commands register themselves on deploy](#commands-register-themselves-on-deploy)), so commands are registered before you set the endpoint URL. They are visible in Discord and simply cannot be answered until the URL is saved, which is the harmless direction for the two to be out of step.

## 4. Create the Git branches

The long-lived branches are `main` and `develop`. Initialize them from the same verified starting commit:

```sh
git switch main
git push -u origin main
git switch -c develop
git push -u origin develop
```

If your repository starts on a different default branch, rename it to `main` first. Use `feature/<name>` for day-to-day work; `release/<name>` and `hotfix/<name>` are also permitted for short-lived coordination branches.

## 5. Configure GitHub environments and secrets

Deployment is disabled by default. This is what stops a brand-new project from attempting a Cloudflare deployment before a Worker, an account, and credentials exist.

`npm run setup:github` does the structural half of this step and [step 6](#6-configure-branch-protection) in one go:

```sh
npm run setup:github -- --dry-run   # print every gh command, run none
npm run setup:github                # apply, leaving deployment disabled
```

It needs the [GitHub CLI](https://cli.github.com), signed in with `gh auth login`. It creates the two environments with their branch restrictions and the branch ruleset, then reads all of it back and reports anything GitHub did not save. It is idempotent, and re-running it is how you re-check these settings later — after a plan change, an organization policy change, or a visibility change.

What it cannot do is set a secret **value**. It reports which secret *names* exist per environment and names the missing ones; you add the values by hand, below. Unlike `npm run setup`, this script is permanent and stays in your project.

The tables in this step and the next are the reference for what it applies, what to check in its readback, and how to do the same by hand in the web interface instead.

These are the environments it creates:

- `non-prod`, restricted to the `develop` branch.
- `production`, restricted to the `main` branch, with required reviewers enabled.

Required reviewers are the setting most likely not to save. GitHub enforces environment protection rules on a **private** repository only under Team or Enterprise; on a free private repository it creates the environment without them and says nothing. That silence is the reason the script reads back rather than trusting its own success.

Add these secrets at repository or environment scope:

- `CLOUDFLARE_API_TOKEN` — see [Creating the API token](#creating-the-api-token) below.
- `CLOUDFLARE_ACCOUNT_ID` — the Cloudflare account containing them. Find it on the Workers & Pages overview page in the dashboard.

Then add the Discord secrets the registration step reads — these belong to **each environment**, not to the repository, because the whole point is that the two resolve to different Discord applications ([step 3](#3-create-your-discord-applications) says where each value comes from):

| Secret | `non-prod` | `production` |
| --- | --- | --- |
| `DISCORD_TOKEN` | The non-production application's bot token | The production application's bot token |
| `DISCORD_APPLICATION_ID` | The non-production application ID | The production application ID |
| `DISCORD_GUILD_ID` | Your test server's ID | Leave unset — production registers globally |

A repository-scope `DISCORD_TOKEN` would be visible to both environments and would silently make the production bot reachable from a `develop` deploy. Add these at environment scope only, under **Settings > Environments > _name_ > Environment secrets**.

`DISCORD_PUBLIC_KEY` is deliberately absent: only the Worker verifies signatures, and it reads that from the Cloudflare secret set in [step 3](#set-them-on-each-worker). CI never needs it.

Then, and only then, enable deployment. `DEPLOY_ENABLED` is deliberately a repository **variable**, not a secret: it holds no sensitive value and exists purely as the explicit opt-in. Add it with the value `true` under **Settings > Secrets and variables > Actions > Variables**, or run:

```sh
npm run setup:github -- --enable-deploy
```

The flag is separate because setting this variable is the act that makes pushes deploy. `npm run setup:github` without it creates everything else and leaves deployment off, and an interactive run asks before setting it — there is no default that switches deployment on for you.

Setting `DEPLOY_ENABLED` does not deploy anything by itself — it only removes the guard inside a step that already exists in [.github/workflows/deploy.yml](../.github/workflows/deploy.yml). `deploy.yml` triggers on `push` to `main` or `develop`; a repository variable change is not a push, so it does not start a run. The next push or merge to `develop` or `main` is what actually deploys — the sequence in that run is: checkout, install, lint, test, and only if all of that passes and `DEPLOY_ENABLED` is `true`, `wrangler deploy --env non-prod` (from `develop`) or `--env production` (from `main`, after the `production` environment's required reviewer approves), then command registration. If you enabled the flag without a fresh push already queued, merge or push once more to trigger the first real deployment. Until `DEPLOY_ENABLED` exists, the deploy job is skipped every time and no Cloudflare credentials are used.

Never commit these values or put them in `.env`, `.dev.vars`, or generated files.

### Commands register themselves on deploy

You do not run `npm run register:*` by hand after the first setup. `deploy.yml` registers the command definitions as its last step, in the same `DEPLOY_ENABLED`-guarded job, immediately after the Wrangler deploy:

| Branch | Environment | Registration |
| --- | --- | --- |
| `develop` | `non-prod` | `npm run register:non-prod` — guild-scoped, to `DISCORD_GUILD_ID`, visible instantly in that one server |
| `main` | `production` | `npm run register:production` — global, against the production application |

Three consequences worth knowing before your first deploy:

- **After, not before.** Registration follows the deploy so a command is never advertised to Discord before a live Worker can answer it. A failed deploy never reaches the registration step.
- **Every deploy overwrites.** It is an unconditional bulk overwrite of that scope's command list, with no diff-or-skip logic — deploying the same commands twice re-registers them. Commands that did not already exist count toward Discord's daily application-command create limits; re-registering an unchanged list does not. So routine deploys cost nothing against the limit, while a day of adding and removing commands can reach it.
- **A missing Discord secret fails the run after the Worker is already live.** The deploy has succeeded by then; only the registration step fails, leaving Discord advertising the previous command list. Add the secrets in the table above, then re-run the job.

Registration and deployment roll back independently — see [Rollback](gitflow-and-branching.md#rollback).

### Creating the API token

Create the token at **My Profile > API Tokens > Create Token** in the Cloudflare dashboard, using **Custom Token**, not a predefined template — the predefined "Edit Cloudflare Workers" and "Workers Builds" templates grant more than this workflow needs (KV/R2 storage edit, zone-wide Workers Routes edit) because they're built for the dashboard's own Git integration, which this template does not use (see [above](#do-not-also-connect-the-repository-in-the-cloudflare-dashboard)).

For the base template with no bindings, add a single permission:

| Scope | Permission |
| --- | --- |
| Account | Workers Scripts — Edit |

Restrict the token to your account under **Account Resources**. This is sufficient for `wrangler deploy` to create and update both Workers by name — the workflow already supplies `CLOUDFLARE_ACCOUNT_ID` explicitly, so the token does not need account-listing permissions.

As you add bindings (see [Adding environment-specific bindings](#adding-environment-specific-bindings)), add the matching Edit permission to this same token — for example, **Workers R2 Storage — Edit** for an R2 bucket, or **Workers KV Storage — Edit** for a KV namespace. A deploy that references a binding your token cannot manage fails with an authorization error at deploy time, not at token-creation time, so update the token in the same pull request that adds the binding.

### Do not also connect the repository in the Cloudflare dashboard

Cloudflare offers a separate feature called [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/) (**Settings > Builds > Connect** on a Worker in the dashboard) that watches a GitHub or GitLab repository and deploys on every push, independent of GitHub Actions. This template does not use it, and connecting a Worker this way conflicts with the workflow above:

- Workers Builds runs its own deploy command (`npx wrangler deploy` by default) on every push to the branch you connect. It does not know about the `production` environment's required reviewers, `DEPLOY_ENABLED`, or this repository's lint and test gates — it would deploy regardless of whether they pass.
- Both mechanisms would target the same Worker names from the same pushes, so you cannot tell which system produced a given deployment.

Leave your Workers unconnected in the dashboard. `.github/workflows/deploy.yml` is the only deployment path this template's contract tests and documentation assume.

## 6. Configure branch protection

This template does not ship a ruleset file to import. An imported JSON payload can save with fewer rules than it declares — plan tier, organization policy, and repository visibility all affect what GitHub accepts — so a committed file that looks authoritative can silently stop matching what's actually enforced. Whichever way you apply these settings, verify what actually saved.

`npm run setup:github` ([step 5](#5-configure-github-environments-and-secrets)) does both. It creates or updates a ruleset named `protected-branches` holding exactly the table below, then reads it back and names every rule GitHub dropped, exiting non-zero if any did. That readback is the point: a `201` from the rulesets API means your request was accepted, not that every rule in it survived.

To do it by hand instead, go to **Settings > Rules > Rulesets > New branch ruleset** (classic **Settings > Branches** protection rules work too) and apply this to both `main` and `develop`:

| Setting | Value | Why |
| --- | --- | --- |
| Enforcement status | Active | "Evaluate" or "Disabled" protects nothing |
| Restrict deletions | On | The branch can't be deleted |
| Block force pushes | On | History can't be rewritten |
| Require a pull request before merging | On | No direct pushes |
| ↳ Required approvals | 1 | Minimum review gate |
| ↳ Dismiss stale approvals on push | On | A new commit needs a fresh look |
| ↳ Require conversation resolution | On | Open review threads can't be merged around |
| Require status checks to pass | On | CI must be green |
| ↳ Status check | `test` | Matches the job name in `.github/workflows/ci.yml` |
| ↳ Require branches to be up to date before merging | On | No merging around a stale base |

Do not add a `branch_name_pattern` rule. See [Gitflow and branching](gitflow-and-branching.md#our-approach-to-branches) for why: it requires GitHub Team or Enterprise and is rejected outright on Free and Pro. Branch naming stays enforced through code review.

Whatever you add beyond this table, do not commit a ruleset payload to the repository as though it were the applied state. A file that looks authoritative and has quietly stopped matching what GitHub enforces is worse than no file; the readback is the only honest record.

After saving, confirm it actually took effect — `gh api repos/OWNER/REPOSITORY/rulesets` — and check that the ruleset's `enforcement` is `"active"` and its `rules` array contains everything in the table above. `npm run setup:github` performs exactly this readback, prints the comparison, and fails if a rule is missing. Re-check after any change to organization policy or plan.

## 7. Verify the deployment path

Prove the whole path works before you rely on it. Create a small feature branch and open a pull request into `develop`:

```sh
git switch -c feature/verify-gitflow
npm run dev
npm test
git push -u origin feature/verify-gitflow
```

After merging into `develop`, check the non-production Worker. Then open a pull request from `develop` into `main`; after the production environment approval, check the production Worker.

Read the whole job log, not just its final status: the registration step runs after the deploy and prints the command names it registered. Non-production registration is guild-scoped, so the commands appear in your test server immediately — typing `/` there is the fastest confirmation that the deploy and the registration both worked.

Listed is not the same as working. Until [step 8](#8-point-each-discord-application-at-its-worker) gives the application an Interactions Endpoint URL, Discord has nowhere to send the interaction and invoking a command fails. Finish the deploy first anyway: the URL will not save before the Worker is live.

A deploy fails if that environment is missing any secret named in `secrets.required`, and names the missing ones. If the first non-production deploy fails that way, finish [step 3](#3-create-your-discord-applications) for `--env non-prod` and re-run the job.

The deploy workflow never runs for feature branches. Local work uses `npm run dev`; only merges to `develop` and `main` deploy.

## 8. Point each Discord application at its Worker

Now that both Workers are deployed, tell each Discord application where to send interactions. In the [Developer Portal](https://discord.com/developers/applications), open the application, and on **General Information** set **Interactions Endpoint URL** to that environment's Worker plus the `/interactions` path:

| Application | Interactions Endpoint URL |
| --- | --- |
| Non-production | `https://acme-weather-api-non-prod.<your-subdomain>.workers.dev/interactions` |
| Production | `https://acme-weather-api-production.<your-subdomain>.workers.dev/interactions` |

Use the hostname the deploy printed — `wrangler deploy` and the deploy job's log both report the deployed URL — or a custom route if you have configured one. Each application points at its **own** Worker; crossing them is how a `develop` deploy ends up answering production's users.

Saving is the test. Discord immediately sends a signed `PING` to the URL and refuses to save one that does not answer `{"type": 1}` with a JSON content type, so a successful save proves four things at once: the Worker is deployed, the route is right, `DISCORD_PUBLIC_KEY` is set on that environment, and it is the public key of *this* application. A save that fails is almost always the last of those — a public key from the other application.

Discord also re-sends invalid signatures as a routine check and removes the endpoint URL of an application that accepts one. That is not a scenario to guard against here; it is why [signature verification has no bypass](discord-bot.md#1-verify).

Once the URL is saved, the commands registered by the deploy start working. Try `/ping` in your test server.

## 9. Releases

Changesets is already configured. Keep the `.changeset/` directory and `.github/workflows/release.yml`. For a change that affects your project's contract, run `npm run changeset`, choose the SemVer increment, and commit the generated file with your pull request. Merging to `main` opens a release pull request; merging that versions the package and creates a tag. It does not publish to npm.

If your project makes the package public or wants npm publication, update the Changesets `access` and `privatePackages` settings, add registry authentication through CI secrets, and review the workflow before enabling publication. Do not put registry credentials in the repository.

Full details are in [Versioning and changesets](versioning-and-changesets.md).

## 10. Keeping up with upstream changes

Nothing merges upstream changes into your repository automatically, regardless of which path you chose in [Choosing how to start](#0-choosing-how-to-start). Adopt them deliberately instead.

`npm run setup` added this repository as a second remote named `upstream` — unless one already existed, in which case it said so and left it alone. Add it by hand if you need to:

```sh
git remote add upstream https://github.com/mbakaitis/cloudflare-workers-discord-template.git
git fetch upstream
```

`package.json`'s `template.commit` records the upstream commit your project started from, so everything after it in `git log upstream/main` is a candidate to adopt.

Then pick up individual changes. `git cherry-pick` works whether or not your repository shares history with this one:

```sh
git log --oneline upstream/main
git cherry-pick <commit>
```

Or review a single file before copying anything:

```sh
git diff HEAD upstream/main -- .github/workflows/ci.yml
```

Read this template's `CHANGELOG.md` for each release to see what changed and whether it requires migration.

Rollback is a reviewed revert or a deployment of the previous successful commit. Never hot-edit production code in the Cloudflare dashboard.

## Setup is complete when

- `npm run setup` has run once, `package.json` carries its `template` provenance record, and `scripts/setup.js` is gone.
- `main` and `develop` both exist on your remote.
- Branch rules prevent direct changes to `main` and `develop`, and `npm run setup:github` reports no divergence between what was requested and what GitHub saved.
- The `non-prod` and `production` GitHub environments have the correct branch restrictions, and `production` requires a reviewer.
- Your three Worker names are distinct, and any bindings are environment-specific and intentional.
- Two Discord applications exist, and each Worker environment has its own `DISCORD_PUBLIC_KEY`, `DISCORD_APPLICATION_ID`, and `DISCORD_TOKEN` set — no value shared between them.
- `npm run dev` starts from your own `.dev.vars`, which setup created, is untracked, and holds non-production values only.
- `npm test` passes, including the contract tests.
- A merge to `develop` deploys non-production, and an approved merge to `main` deploys production.
- Each Discord application's Interactions Endpoint URL points at its own deployed Worker and saved successfully, which means Discord's `PING` validation passed.
- `/ping` answers in your test server.
- Each GitHub environment holds its own `DISCORD_TOKEN` and `DISCORD_APPLICATION_ID` (plus `DISCORD_GUILD_ID` for `non-prod`), so a deploy registers commands against that environment's application and no other.
- The AI instruction files describe your project: setup renamed the `-for-users` files into `claude.md`, `AGENTS.md`, and `.github/copilot-instructions.md`, or removed all six if you ran it with `--ai delete`. Nothing here is left half-done — setup does all three or none.
- `LICENSE.md` and `package.json`'s `author` name you rather than the template's author. These are the two things setup deliberately did not change.

## Adding environment-specific bindings

As your project grows you will add Cloudflare resources — D1 databases, R2 buckets, KV namespaces, Queues, Durable Objects. One rule governs all of them: **a binding goes in the environment it serves, never at the top level.**

### The rule

All bindings, regardless of service type, belong inside `env.non-prod` or `env.production`. The contract tests verify this automatically.

When adding a resource:

1. Create it in your Cloudflare account.
2. Add it to the matching `env` section in `wrangler.jsonc`.
3. Give it a distinct, environment-aware name, such as `my-api-non-prod` versus `my-api-production`.

**Incorrect** — a binding at the top level, which fails the contract tests:

```jsonc
{
  "name": "my-worker",
  "d1_databases": [
    {
      "binding": "DB",
      "database_id": "abc123"
    }
  ]
}
```

**Correct** — environment sections ready for bindings:

```jsonc
{
  "name": "my-worker",
  "main": "src/index.js",
  "compatibility_date": "2026-08-18",
  "env": {
    "non-prod": {
      "name": "my-worker-non-prod"
      // Service bindings go here (d1_databases, r2_buckets, kv_namespaces, etc.)
    },
    "production": {
      "name": "my-worker-production"
      // Service bindings go here (d1_databases, r2_buckets, kv_namespaces, etc.)
    }
  }
}
```

**Correct** — the same binding name pointing at separate resources per environment:

```jsonc
{
  "name": "my-worker",
  "main": "src/index.js",
  "compatibility_date": "2026-08-18",
  "env": {
    "non-prod": {
      "name": "my-worker-non-prod",
      "d1_databases": [
        {
          "binding": "DB",
          "database_id": "abc123-non-prod"
        }
      ]
    },
    "production": {
      "name": "my-worker-production",
      "d1_databases": [
        {
          "binding": "DB",
          "database_id": "def456-production"
        }
      ]
    }
  }
}
```

Your Worker code reads `env.DB` in both cases; only the underlying resource differs. Document each binding you add with JSDoc in `src/index.js` — this project is plain JavaScript and deliberately does not generate TypeScript binding types. If you want editor autocomplete for bindings in your own project, `npx wrangler types` will generate them on demand, but nothing here requires it.

### Validating a binding change

1. **Run the contract tests** to catch structural mistakes:

   ```sh
   npm test
   ```

2. **Dry-run both environments** before merging:

   ```sh
   npx wrangler deploy --dry-run --env non-prod
   npx wrangler deploy --dry-run --env production
   ```

   Confirm each environment binds the resources you expect.

3. **Review in the pull request** to catch logical mistakes: resource IDs genuinely distinct between environments, no cross-environment references, consistent naming.

Never copy a resource ID from production into non-production or the reverse. The contract tests catch structural mistakes; naming discipline and human review catch logical ones.
