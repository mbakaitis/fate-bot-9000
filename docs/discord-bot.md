# The Discord Bot

This document describes how the bot itself works: what happens to an interaction between Discord sending it and your code answering it, and which module owns which part of that. Project setup — Discord applications, secrets, deployment — lives in [Using this template](using-this-template.md).

This template receives interactions over **HTTP**, not the Gateway. Discord sends each interaction to your Worker as a signed POST request and expects a response on that same request. There is no persistent connection, no presence, and no message-event stream. That is what makes a Worker a good fit: nothing needs to stay running between interactions.

## The interaction lifecycle

Every request to `POST /interactions` goes through the same three steps, in this order.

### 1. Verify

`src/discord/verify.js` checks the Ed25519 signature on the request and rejects anything that fails with a `401`.

Two details are not negotiable:

- **The signature covers the raw request bytes.** So the raw body is read as text and handed back to the caller unparsed. Nothing may call `request.json()` before verification, because that means parsing input that has not been authenticated yet.
- **There is no bypass.** No development flag disables verification, and a Worker with no `DISCORD_PUBLIC_KEY` configured rejects interactions rather than accepting them unverified. Discord sends deliberately invalid signatures as a routine check and removes the Interactions Endpoint URL of an application that accepts one.

A verified request whose body is not valid JSON gets a `400`: the signature proved it came from Discord, so the problem is the payload's shape, not its origin.

### 2. PING and PONG

Discord sends a `PING` (interaction type `1`) when you save an Interactions Endpoint URL, and periodically afterwards. The answer is `{"type": 1}` with a JSON content type. `src/discord/responses.js` builds it.

This is the slice Discord validates before it will accept your URL at all. If this fails, nothing else about the bot matters yet.

### 3. Dispatch

`src/interactions.js` takes the verified, parsed interaction and returns a `Response`. For an `APPLICATION_COMMAND` (type `2`) it looks up the command by name in the registry and calls its handler.

A name that is not in the registry gets a `200` with an ephemeral message, not an error status. Discord renders a failed interaction as its own generic notice, which tells the user nothing; a reply only they can see tells them what actually happened — Discord and the Worker disagree about which commands exist, which means the commands need registering again.

Interaction types this template does not serve — components, modals, autocomplete — get a deliberate `400`.

## Module layout

| File | Responsibility |
| --- | --- |
| `src/index.js` | The Worker's `fetch` handler, and only routing: health check at `/`, interactions at `POST /interactions`, `405` for the wrong method, `404` for anything else. It builds the REST client and passes the registry in. |
| `src/discord/verify.js` | Ed25519 signature verification. Returns the raw body only when the signature checks out. |
| `src/discord/responses.js` | Builders for every interaction response — `pong()`, `reply()`, `ephemeral()`, `deferred()` — each setting the JSON content type Discord requires. |
| `src/discord/rest.js` | The outbound half: editing the original response to an interaction, for work that finishes after the acknowledgement. Takes `fetch` as an argument. |
| `src/discord/command-types.js` | Constants for the shape of a command definition — command type, option types, installation and interaction contexts. |
| `src/runtime.js` | Ambient runtime capabilities bound at the entry point — currently just `sleep`, the template's only timer. |
| `src/interactions.js` | The dispatcher. Pure: interaction in, `Response` out. |
| `src/commands/index.js` | The command registry. One list, read by both the Worker and the registration script. |
| `src/commands/ping.js` | `/ping` — worked example: an immediate reply. |
| `src/commands/echo.js` | `/echo` — worked example: reading and validating an option. |
| `src/commands/slow.js` | `/slow` — worked example: deferring, then editing the response from `waitUntil`. |

### Two rules the layout depends on

**The dispatcher is injected, not wired.** `dispatchInteraction(interaction, { env, ctx, registry, rest, sleep })` receives its bindings, execution context, command registry, REST client, and timer as arguments. So a test dispatches any interaction against a registry it invented, a REST client that records calls instead of making them, and a timer that never waits — no Worker to start, no network to reach, and no reason for a command's tests to be slower or less precise than a pure function's.

`src/index.js` is the only file that binds an ambient capability: `createRest(fetch)` and `sleep` from `src/runtime.js`. Anything a handler cannot be handed is something its tests cannot control, so add capabilities there and pass them down rather than importing a global inside a command.

**The registry stays importable from plain Node.** Nothing under `src/commands/` may import a `cloudflare:` module, because the command registration script runs under plain Node and imports the same file. This is the reason the definitions are data and handlers take their dependencies as arguments. `test/contracts/commands.test.js` enforces it, from outside the Workers pool.

That single registry is the point: two copies of a command definition drift, and the failure is invisible from either side. Discord advertises a command the Worker does not handle, or the Worker handles one Discord never registered.

## The commands that ship

Three, and all of them are examples rather than features. Delete them once you have your own — they are here to be copied from, not kept.

| Command | Shows |
| --- | --- |
| `/ping` | The shortest complete command: a definition, a handler, one reply. |
| `/echo <message>` | Reading an option out of the interaction, and treating it as untrusted input. |
| `/slow` | Deferring: acknowledging inside Discord's window, then editing the response from `waitUntil`. |

## Adding a command

Three steps, and the third is not optional.

**1. Create `src/commands/<name>.js`** exporting `definition` and `handler`. Keep them in the same file — they are two halves of one thing, and separating them is how a bot ends up advertising a command nobody implemented.

```js
import { ApplicationCommandType, ApplicationIntegrationType, InteractionContextType }
  from "../discord/command-types.js";
import { reply } from "../discord/responses.js";

export const definition = {
  name: "ping",
  description: "Check that the bot is responding.",
  type: ApplicationCommandType.CHAT_INPUT,
  integration_types: [ApplicationIntegrationType.GUILD_INSTALL],
  contexts: [InteractionContextType.GUILD, InteractionContextType.BOT_DM],
};

export const handler = () => reply("Pong!");
```

A handler receives `(interaction, { env, ctx, rest })` and returns a `Response` — or a promise of one. Everything it needs is in that second argument; reach for an import and the command stops being testable as a function.

**2. Add it to the registry** in `src/commands/index.js`:

```js
import * as ping from "./ping.js";

export const commands = [ping];
```

That is the only wiring. The Worker dispatches from this array and `npm run register:*` registers from the same array.

**3. Write the test.** `test/commands/<name>.test.js`, dispatching through `dispatchInteraction` against the real registry — not a registry the test invented. A command is only working when it is *in the registry* and its handler answers, and a test that supplies its own registry passes even when the command was never registered:

```js
const response = await dispatchInteraction(
  { type: 2, data: { name: "ping" } },
  { env: {}, ctx: { waitUntil: () => {} }, rest: {}, registry: commands },
);
```

`test/commands/registry.test.js` then checks your definition against Discord's rules — naming, description length, declared contexts, option ordering — without you extending it. Those failures land at `npm test` rather than as a generic `400` from the registration endpoint after a deploy.

### Habits worth copying

**Declare `type`, `integration_types`, and `contexts` explicitly.** All three have Discord-side defaults. Declaring them makes where a command can be used a property of this repository, reviewable in a diff, instead of a consequence of how the Discord application happens to be configured. Note that Discord applies `integration_types` and `contexts` only to globally-scoped commands; a guild-scoped registration is already confined to its guild.

The shipped definitions declare `BOT_DM` alongside `GUILD`, which assumes the application was installed with the optional `bot` scope — that context is the DM with the bot user, so there has to be one. Drop `BOT_DM` if you would rather install with `applications.commands` alone; see [Install the non-production application in your test server](using-this-template.md#install-the-non-production-application-in-your-test-server) for what each scope buys.

**Do not trust an option, even a required one.** Discord enforces `required`, but a handler that assumes so throws on the first payload that disagrees — and a thrown handler is a failed interaction, which shows the user Discord's generic error notice and explains nothing. `/echo` reads its option defensively and answers a missing or blank one with an ephemeral message. Options arrive as an array of `{ name, type, value }`, so reading one is a lookup, not a property access.

**Take a timer, a clock, or a network call as an argument.** A handler receives `sleep` for the same reason it receives `rest`: `/slow` needs to wait, and a handler that imports its own timer is a handler whose tests have to wait too. `/slow`'s tests inject a `sleep` they hold open and release by hand, so they assert ordering — acknowledged first, edited later — instead of racing it.

**Suppress mentions in anything a user typed.** `/echo` replies through `reply(content, { suppressMentions: true })`, which sets `allowed_mentions: { parse: [] }`. Interaction responses parse user mentions by default, so sending raw user input back means the bot can ping somebody on a stranger's behalf. Pass `suppressMentions` whenever the content came from a user.

## Registering commands

A command in the registry is a command the Worker will *answer*. Discord still has to be told it exists, and that is a separate act with its own timing: **registration and deployment roll back independently**. Redeploying an older Worker does not unregister a command, and re-registering an older list does not change the code serving it. Deploy first, register second — that way a command is never advertised before something can answer it.

```sh
npm run register:dry-run     # print the plan, contact nothing
npm run register:non-prod    # guild-scoped, against the non-production application
npm run register:production  # global, against the production application
```

In a configured project you rarely run these by hand: `deploy.yml` runs the matching one after every deploy, guild-scoped from `develop` and global from `main`. See [Commands register themselves on deploy](using-this-template.md#commands-register-themselves-on-deploy). Run them locally when you are working against a tunnel, or when a registration step failed and you want to see the error interactively.

### Two scopes, stated explicitly

Discord has one registration endpoint per scope, and both are bulk overwrites:

| Scope | Endpoint | Behavior |
| --- | --- | --- |
| Guild | `PUT /applications/{application.id}/guilds/{guild.id}/commands` | Available only in that one server. Updates **instantly**, which is what makes it the right scope for non-production. |
| Global | `PUT /applications/{application.id}/commands` | Available everywhere the app is installed. Discord version-checks a stale command and reloads it for the user. |

Three properties of that endpoint are worth knowing before you run it:

- **It overwrites everything.** `PUT` replaces *all* types of application commands in that scope — slash, user, and message commands — so the body has to be the complete list, never a delta. A command dropped from the registry disappears from Discord on the next registration, which is the intended behavior and also the whole reason the body is built from the registry rather than assembled by hand.
- **New commands count against a daily limit.** Commands that did not already exist count toward Discord's daily application-command create limits. Re-registering an unchanged list does not.
- **The scope is never inferred.** `--guild` and `--global` are required flags. The scope could have been derived from whether `DISCORD_GUILD_ID` was set, and that is exactly the design where an inherited shell variable sends a production registration into somebody's test guild. `--global` ignores `DISCORD_GUILD_ID` even when it is set.

### What it needs

Each environment registers against **its own Discord application**, so these are per-environment values, never shared between non-production and production. [Create your Discord applications](using-this-template.md#3-create-your-discord-applications) says where each one comes from.

| Variable | Needed for |
| --- | --- |
| `DISCORD_APPLICATION_ID` | Both scopes |
| `DISCORD_TOKEN` | Both scopes |
| `DISCORD_GUILD_ID` | `--guild` only |

A missing or blank variable fails before any request is made, and the error names every missing variable at once.

The script is plain Node, so it reads these from the shell environment — not from `.dev.vars`, which only `wrangler dev` loads. Export them for the length of the command, or source the file first (`set -a; source .dev.vars; set +a`). In CI they come from the GitHub Environment's secrets.

### The dry run

`npm run register:dry-run` prints the exact request — method, URL, headers, and body — and sends nothing:

```text
PUT https://discord.com/api/v10/applications/.../guilds/.../commands
  scope: guild
  headers:
    content-type: application/json
    authorization: Bot [redacted]
  commands: ping, echo, slow
  body:
[ ... ]
```

It still validates the environment, so it doubles as a pre-flight check. Swap in `--global --dry-run` to see the production plan instead.

The redaction is structural rather than careful. `buildRegistrationPlan` produces the plan with `authorization: Bot [redacted]` already in it; the real token is substituted inside `executeRegistration`, into an object that is never returned. So no code path has a token available to print, including the error paths — and the error Discord's refusal raises carries only the status and Discord's own response text.

### The two files

| File | Responsibility |
| --- | --- |
| `scripts/lib/registration.js` | All of the logic: argument parsing, environment validation, URL and body construction, and the request itself. Pure, apart from taking `fetch` as an argument, and measured by the same coverage ratchet as `src/`. |
| `scripts/register-commands.js` | The CLI: `process.argv` in, printed output and an exit code out. No dependencies — Node's global `fetch` is the whole HTTP client. |

The wrapper is thin because it is the part Vitest cannot measure: it is exercised instead by `test/contracts/registration.test.js`, which spawns the real file with `fetch` replaced by a landmine (`test/helpers/forbid-fetch.js`). A dry run that reached the network would fail that test rather than pass quietly.

## Deferring slow work

Discord requires an initial response within **3 seconds** of sending the interaction, and it invalidates the interaction token if one does not arrive. The token itself is then valid for **15 minutes**, so the way to serve work that will not finish in 3 seconds is to acknowledge inside the window and send the real answer afterwards. `/slow` in `src/commands/slow.js` is the worked example.

### When to defer

Defer when you cannot promise the work beats the window. That is a promise about the worst case, not the average: a call that usually takes 200 ms and occasionally takes 5 seconds needs to defer, because the slow case is the one that breaks and it breaks invisibly. Anything crossing the network — a database, an upstream API, an inference call — belongs in that category. `/ping` and `/echo` do not: they compute their answer from the payload and answer on the interaction request itself.

There is no cost to deferring beyond the loading state the user sees, and no way to recover from not deferring.

### How it works

```js
export const handler = (interaction, { env, ctx, rest, sleep }) => {
  ctx.waitUntil(followUp(interaction, { env, rest, sleep }));

  return deferred();
};
```

1. **Acknowledge.** `deferred()` returns `DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE` (type `5`). Discord shows the user a loading state.
2. **Schedule the rest on `ctx.waitUntil`.** Cloudflare cancels asynchronous work that is neither awaited nor handed to `waitUntil` once the response goes out, so without it the follow-up dies mid-flight and the loading state never resolves. `waitUntil` keeps the invocation alive for up to 30 seconds after the response — well inside the token's 15 minutes, but the reason work longer than that belongs in a [Queue](https://developers.cloudflare.com/queues/) rather than here.
3. **Edit the original response.** `rest.editOriginalResponse()` sends `PATCH /webhooks/{application.id}/{interaction.token}/messages/@original`, which replaces the loading state with the real message. This needs `env.DISCORD_APPLICATION_ID` and the interaction's own token.

Pass `ctx` around as an object. Destructuring `waitUntil` off it loses its binding and throws `Illegal invocation` at runtime.

The acknowledgement fixes the message's visibility: `deferred({ ephemeral: true })` makes the eventual message ephemeral, and the follow-up edit cannot change that either way. Decide at step 1.

### When the follow-up fails

`/slow` handles its two failures differently, deliberately:

- **The work throws.** There is still a live token and a user watching a spinner, so the edit goes out anyway carrying a short failure message. Leaving the loading state to time out tells the user nothing.
- **The edit throws.** It is swallowed. The only channel to the user is the call that just failed, and a rejection left unhandled inside `waitUntil` fails the invocation *after* a successful response was already sent — recording a Worker error nobody can act on while the user sees a command that worked.

Neither path logs. An interaction payload carries user content and an interaction token can post as the bot; observability is enabled on this Worker, so a log line is a durable record of both. `src/discord/rest.js` throws an error carrying the HTTP status and nothing else, which is the safe thing to surface if you add monitoring here.

## Testing the bot offline

The whole suite runs with no network, no Cloudflare account, and no Discord application:

- **Signatures are real.** `vitest.config.js` generates a throwaway Ed25519 keypair per test run, gives the Worker the public half through the test pool's bindings, and lets `test/helpers/interactions.js` sign fixtures with the private half. Verification runs real cryptography against a real signature — stubbing it would assert nothing, and this is the one security-critical behavior in the template.
- **Discord is never called.** `src/discord/rest.js` takes `fetch` as an argument and the dispatcher takes `rest` as an argument, so tests inject a fake that records calls.
- **No test holds a real credential.** Test keys come from the test-pool `env`, generated for that run.
- **Nothing waits.** The only timer in the template is `src/runtime.js`, tested directly at zero milliseconds. Every command test injects its own.
- **The registration CLI is spawned, not simulated.** `test/contracts/registration.test.js` runs `scripts/register-commands.js` as a real process with placeholder credentials and `--dry-run`, preloading `test/helpers/forbid-fetch.js` so any `fetch` throws. It asserts the printed plan, the exit codes, and that no path prints the token.
- **Deferred work is asserted, not assumed.** `test/commands/slow.test.js` uses `createExecutionContext()` and `waitOnExecutionContext()` from `cloudflare:test` to settle the `waitUntil` promise, then asserts against the recording `rest` fake that the `PATCH` happened and what it carried. A test that only checked the promise was scheduled would pass against a follow-up that never ran.

Run `npm test` for the full suite with coverage, or `npx vitest run test/interactions.test.js` for one file while you work.

## Developing against a local tunnel

`npm run dev` serves the Worker on `http://localhost:8787`, which is enough for `curl` and for every test above. It is not enough for Discord: interactions arrive as inbound HTTPS requests, so Discord has to be able to reach your machine before it will send one. Wrangler opens a [Cloudflare Tunnel](https://developers.cloudflare.com/workers/local-development/local-dev-tunnels/) for the dev session:

```sh
npm run dev
# then press [t] in the Wrangler session to open or close the tunnel
```

Wrangler prints a public `https://<random>.trycloudflare.com` URL that proxies to the local Worker. `npx wrangler dev --tunnel` opens one at startup instead, and `npx wrangler dev --tunnel-name=<name>` uses a [named tunnel](https://developers.cloudflare.com/tunnel/get-started/) with a stable hostname — worth setting up if you do this regularly, because a quick tunnel's hostname is new every session and Discord has to be told about each one.

Point your **non-production** application at it — never the production one:

1. Set **General Information > Interactions Endpoint URL** to `https://<random>.trycloudflare.com/interactions`. Saving sends Discord's `PING` straight to your laptop, so a successful save is a real test of the signature path.
2. Check that the `DISCORD_PUBLIC_KEY` in your `.dev.vars` is that same application's public key. If it is not, the `PING` gets a `401` and Discord refuses the URL — which is the system working.
3. Register the commands to your test guild. The script is plain Node and does not read `.dev.vars`, so export the values first:

   ```sh
   set -a; source .dev.vars; set +a
   npm run register:non-prod
   ```

An application has exactly one Interactions Endpoint URL. While your tunnel occupies the field, the deployed non-production Worker receives nothing — so put its URL back when you are done, or keep a third Discord application for tunnel work if you share the non-production one with anybody.

### A tunnel is local emulation, not a deployed environment

What is answering is `workerd` on your machine under Miniflare, with a public door propped open in front of it. It is not a Cloudflare environment, and the differences are the ones that bite:

- Secrets come from `.dev.vars`, not from Cloudflare's encrypted secret store — so this proves nothing about whether `wrangler secret put` was run for `--env non-prod`.
- No Worker is deployed. Nothing appears in the dashboard, and `observability` captures nothing, because there is no deployed Worker to observe.
- Any binding you add later (KV, D1, R2, Queues) runs against local simulated state by default, not the resource your environment is configured with.
- Quick tunnels are documented as testing-only: a 200-concurrent-request limit and no Server-Sent Events. Interactions fit comfortably; do not benchmark through one.

So a tunnel session proves the interaction contract — real signatures over a real network, real dispatch, a real deferred follow-up — and proves nothing about the deploy. Only an actual `--env non-prod` deploy does that; see [Verify the deployment path](using-this-template.md#7-verify-the-deployment-path).

## Where the rest would attach

This template serves HTTP interactions and stops. The obvious next features are deliberately absent, each because it needs its own documented purpose, local-development story, and test strategy before it belongs in a boilerplate. If you add one, here is where it lands — and check whether it also widens the scopes or bot permissions your application must be installed with, because most of them do:

| Feature | Where it attaches | What it drags in |
| --- | --- | --- |
| **Components and modals** | `src/interactions.js`, alongside the type-`2` branch: type `3` (`MESSAGE_COMPONENT`) and type `5` (`MODAL_SUBMIT`), which currently get the deliberate `400`. Route them on `data.custom_id` rather than a command name. | A second registry keyed by `custom_id`, and a convention for encoding state into that string — it is the only thing Discord hands back. |
| **Autocomplete** | The same dispatcher: type `4` (`APPLICATION_COMMAND_AUTOCOMPLETE`), answered with a type `8` response. Most naturally an optional `autocomplete` export next to a command's `handler`, so the definition, the handler, and its suggestions stay in one file. | Nothing structural, but it is latency-sensitive: autocomplete cannot defer, so the reply has to beat the same window. |
| **Storage (KV, D1, R2, Queues)** | `wrangler.jsonc`, inside `env.non-prod` and `env.production` only — see [Adding environment-specific bindings](using-this-template.md#adding-environment-specific-bindings). Handlers already receive `env`, so nothing in the dispatch path changes. | Per-environment resources, a local-development story, and contract tests that keep non-production off production data. A Queue is also the answer for work that outlives `waitUntil`'s ~30 seconds. |
| **OAuth2** | New routes in `src/index.js` beside `/interactions`, for the redirect and the callback. | A client secret as a fourth per-environment secret, somewhere to store tokens, and a threat model — this is the point where the Worker starts holding user credentials. |
| **The Gateway** | Nowhere. It needs a persistent WebSocket connection, which a Worker invocation cannot hold. | A long-running process somewhere else. If you need presence or message events, run a Gateway client separately and keep this Worker for interactions; the two can share nothing but a data store. |

## Reference

- [Receiving and responding to interactions](https://docs.discord.com/developers/interactions/receiving-and-responding) — interaction types, response types, and the follow-up endpoints
- [Interaction callback](https://docs.discord.com/developers/interactions/receiving-and-responding#interaction-callback) — the 3-second initial-response deadline and the 15-minute token lifetime
- [Edit original interaction response](https://docs.discord.com/developers/interactions/receiving-and-responding#edit-original-interaction-response) — the endpoint a deferred response is completed with
- [`ctx.waitUntil()`](https://developers.cloudflare.com/workers/runtime-apis/context/#waituntil) — how long Cloudflare keeps the invocation alive after the response
- [Validating security headers](https://docs.discord.com/developers/interactions/overview#validating-security-headers) — the signature scheme `src/discord/verify.js` implements
- [Application commands](https://docs.discord.com/developers/interactions/application-commands#application-command-object-application-command-structure) — the definition object, the naming rules, and the option structure
- [Contexts](https://docs.discord.com/developers/interactions/application-commands#contexts) — what `integration_types` and `contexts` control
- [Authorizing your application](https://docs.discord.com/developers/interactions/application-commands#authorizing-your-application) — why `applications.commands` alone is enough, and why no permission bitfield is needed
- [Bulk overwrite global application commands](https://docs.discord.com/developers/interactions/application-commands#bulk-overwrite-global-application-commands) — the endpoint `npm run register:production` calls, the overwrite-everything warning, and the daily create limit
- [Bulk overwrite guild application commands](https://docs.discord.com/developers/interactions/application-commands#bulk-overwrite-guild-application-commands) — the endpoint `npm run register:non-prod` calls
- [Making a guild command](https://docs.discord.com/developers/interactions/application-commands#making-a-guild-command) — why guild scope is the one to test with: guild commands update instantly
- [Authentication](https://docs.discord.com/developers/reference#authentication) — the `Authorization: Bot <token>` header registration sends
- [Allowed mentions](https://docs.discord.com/developers/resources/message#allowed-mentions-object) — which mentions an interaction response parses by default
