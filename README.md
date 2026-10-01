# OH NO! DID YOU FORGET WHERE THE REST OF THE DIRECTIONS WENT? LOOK IN [using-this-template](docs/using-this-template.md) AND THEN YOU CAN DELETE THIS PARAGRAPH.

# fatebot-9000

Fate RPG tools

A Discord bot running on a Cloudflare Worker: HTTP interactions with mandatory Ed25519 signature verification, slash commands the Worker and the registration script read from one source, and separate non-production and production environments that each own their own Discord application.

## Getting started

```sh
npm install
npm run dev
npm test
```

`npm run dev` serves the Worker locally with Wrangler. It reads `.dev.vars`, which is untracked and holds your **non-production** Discord application's public key, application ID, and bot token. Wrangler warns about any that are missing and starts anyway: `GET /` answers `OK`, and `POST /interactions` answers `401` for anything it cannot verify.

Discord cannot reach `localhost`, so answering a real `/ping` from your machine needs a tunnel — see [Developing against a local tunnel](docs/discord-bot.md#developing-against-a-local-tunnel).

## Everyday commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Run the Worker locally with Wrangler |
| `npm test` | Run the unit tests with coverage thresholds, then the configuration contract tests |
| `npm run test:watch` | Re-run unit tests as you edit |
| `npm run lint` | Check JavaScript style |
| `npm run lint:fix` | Apply safe automatic style fixes, then review the diff |
| `npm run changeset` | Record the release impact of a change |
| `npm run deploy:non-prod` | Deploy the non-production Worker |
| `npm run deploy:production` | Deploy the production Worker |
| `npm run register:dry-run` | Print the command-registration plan without contacting Discord |
| `npm run register:non-prod` | Register the commands with the non-production Discord application, scoped to one guild |
| `npm run register:production` | Register the commands globally with the production Discord application |
| `npm run setup:github` | Apply and verify the GitHub environments, deployment variable, and branch ruleset |

The `register:*` scripts need `DISCORD_TOKEN`, `DISCORD_APPLICATION_ID`, and — for the guild-scoped one — `DISCORD_GUILD_ID`, each belonging to that environment's own Discord application. [The Discord bot](docs/discord-bot.md#registering-commands) covers where each value comes from, why registering is a separate act from deploying, and what the bulk-overwrite endpoint replaces.

Node.js 22 is the supported version. `.nvmrc` is the single source of truth — run `nvm use` if you manage Node with nvm — and `engines.node` plus every GitHub Actions workflow read from it.

## Deployment

There are two paths to Cloudflare:

- **Preferred** — the included GitHub Actions workflow deploys on merges to `develop` and `main`, then registers the commands: guild-scoped from `develop`, global from `main`.
- By hand, with `npm run deploy:non-prod` or `npm run deploy:production`, followed by the matching `register:*` script.

Both are skipped until the GitHub Actions repository **variable** `DEPLOY_ENABLED` is set to `true`. That flag is not a secret; it is the explicit opt-in that keeps an unconfigured project from ever contacting Cloudflare. The Cloudflare API token and account ID always remain GitHub secrets.

`npm run setup:github` applies the two environments, their branch restrictions, and the branch ruleset, then reads back what GitHub actually saved and names any difference. Add `--enable-deploy` to set `DEPLOY_ENABLED` at the same time. It never sets a secret value — it reports which secret names are missing.

Do **not** also connect this repository to a Worker through the Cloudflare dashboard's **Settings > Builds** ("Workers Builds" Git integration). That is a separate auto-deploy mechanism, and it bypasses this workflow's environment approvals and test gates.

Keep credentials out of the repository. Secrets belong in `wrangler secret put` for the Workers and in GitHub environment secrets for CI — never in a tracked file.

## Documentation

| Document | Read it when |
| --- | --- |
| [The Discord bot](docs/discord-bot.md) | Understanding the interaction lifecycle, the module layout, and how the bot is tested offline |
| [Gitflow and branching](docs/gitflow-and-branching.md) | Day-to-day branching, pull requests, promotion, and rollback |
| [Versioning and changesets](docs/versioning-and-changesets.md) | Cutting a version, understanding the release pull request and tags |
| [Using AI with this project](docs/using-ai.md) | Working with AI assistants: instruction files, MCP servers, and the guardrails |
| [CHANGELOG.md](CHANGELOG.md) | Checking what changed between releases |

This project was created from [https://github.com/mbakaitis/cloudflare-workers-discord-template](https://github.com/mbakaitis/cloudflare-workers-discord-template); [Project provenance](docs/using-this-template.md) records the version it started from and how to adopt a later upstream change.

## License

See [LICENSE.md](LICENSE.md).
