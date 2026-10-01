/**
 * The logic half of command registration.
 *
 * Everything here is pure or takes `fetch` as an argument, so the whole path
 * from arguments to request body is unit-tested offline and
 * `scripts/register-commands.js` stays a thin wrapper around it. The split is
 * deliberate: registration is the one template-owned script that holds a bot
 * token, and a token belongs in code that tests can reach.
 *
 * Two rules shape the design:
 *
 * - **The plan never holds the token.** `buildRegistrationPlan` produces the
 *   printable description of the request with the authorization header already
 *   redacted. The real credential is substituted inside `executeRegistration`
 *   and into an object that is never returned, so no code path — including an
 *   error path — has a token available to print.
 * - **The scope is stated, never inferred.** Guild versus global comes from an
 *   explicit flag rather than from whether `DISCORD_GUILD_ID` happens to be
 *   set, because an inherited shell variable is not a good reason for a
 *   production registration to land in somebody's test guild.
 *
 * @see https://docs.discord.com/developers/interactions/application-commands#bulk-overwrite-global-application-commands
 * @see https://docs.discord.com/developers/interactions/application-commands#bulk-overwrite-guild-application-commands
 */
import { commands as registry } from "../../src/commands/index.js";
import { DISCORD_API_BASE } from "../../src/discord/rest.js";

/** What stands in for the bot token everywhere the plan is printed. */
export const REDACTED = "[redacted]";

/** How the command is invoked, quoted back in every argument error. */
const USAGE = "usage: node scripts/register-commands.js (--global | --guild) [--dry-run]";

/** The scope flags, as a `Map` so no `Object.prototype` key can pose as one. */
const SCOPE_FLAGS = new Map([
  ["--global", "global"],
  ["--guild", "guild"],
]);

const DRY_RUN_FLAG = "--dry-run";

/**
 * Parse the CLI arguments.
 *
 * @param {string[]} argv Arguments without the node binary or script path.
 * @returns {{ scope: "global" | "guild", dryRun: boolean }}
 * @throws {Error} When the scope is missing, doubled, or an argument is
 *   unrecognized. A typo must fail rather than fall back to a default, because
 *   the default would be a registration against the wrong scope.
 */
export const parseRegistrationArguments = (argv) => {
  const scopes = [];
  let dryRun = false;

  for (const argument of argv) {
    if (argument === DRY_RUN_FLAG) {
      dryRun = true;
      continue;
    }

    const scope = SCOPE_FLAGS.get(argument);

    if (scope === undefined) {
      throw new Error(`Unrecognized argument ${argument} — ${USAGE}`);
    }

    scopes.push(scope);
  }

  if (scopes.length > 1) {
    throw new Error(`Pass --global or --guild, not both — ${USAGE}`);
  }

  if (scopes.length === 0) {
    throw new Error(
      "A registration scope is required: --guild for a non-production guild, "
        + `--global for production — ${USAGE}`,
    );
  }

  return { scope: scopes[0], dryRun };
};

/**
 * Read and validate the environment a registration needs.
 *
 * Validation happens here, before anything is built or sent: a half-configured
 * run that still contacts Discord is the failure mode worth preventing.
 *
 * @param {Record<string, string | undefined>} env Usually `process.env`.
 * @param {"global" | "guild"} scope From `parseRegistrationArguments`.
 * @returns {{ scope: string, token: string, applicationId: string, guildId: string | undefined }}
 *   `guildId` is `undefined` for a global registration even when the
 *   environment supplies one — the flag decides the scope, not the shell.
 * @throws {Error} Naming every missing variable at once, so one run fixes the
 *   whole configuration rather than revealing it one variable at a time.
 */
export const readRegistrationEnvironment = (env, scope) => {
  const required = ["DISCORD_TOKEN", "DISCORD_APPLICATION_ID"];

  if (scope === "guild") {
    required.push("DISCORD_GUILD_ID");
  }

  const missing = required.filter((name) => (env[name] ?? "").trim() === "");

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable${missing.length === 1 ? "" : "s"}: `
        + `${missing.join(", ")}. See docs/discord-bot.md for where each value comes from.`,
    );
  }

  return {
    scope,
    token: env.DISCORD_TOKEN.trim(),
    applicationId: env.DISCORD_APPLICATION_ID.trim(),
    guildId: scope === "guild" ? env.DISCORD_GUILD_ID.trim() : undefined,
  };
};

/**
 * Build the request that will be sent — minus the credential.
 *
 * The body is Discord's bulk-overwrite payload: the full list of definitions
 * from `src/commands/index.js`. That registry is the default rather than
 * something a caller supplies, so there is no way to register a command list
 * the Worker does not dispatch. It is pretty-printed because the same string is
 * both what gets sent and what `--dry-run` shows a human; Discord does not care
 * about the whitespace.
 *
 * @param {{ scope: string, applicationId: string, guildId?: string }} environment
 * @param {Array<{ definition: object }>} [commands] Override for tests only.
 * @returns {{
 *   scope: string,
 *   url: string,
 *   method: string,
 *   headers: Record<string, string>,
 *   body: string,
 *   commandNames: string[],
 * }}
 */
export const buildRegistrationPlan = ({ scope, applicationId, guildId }, commands = registry) => {
  const definitions = commands.map((command) => command.definition);

  return {
    scope,
    url: scope === "guild"
      ? `${DISCORD_API_BASE}/applications/${applicationId}/guilds/${guildId}/commands`
      : `${DISCORD_API_BASE}/applications/${applicationId}/commands`,
    method: "PUT",
    headers: {
      "content-type": "application/json",
      // Redacted at construction. The plan is the printable object, so the
      // safe value is the only value it ever carries.
      authorization: `Bot ${REDACTED}`,
    },
    body: JSON.stringify(definitions, null, 2),
    commandNames: definitions.map((definition) => definition.name),
  };
};

/**
 * Render a plan for a human to read.
 *
 * @param {ReturnType<typeof buildRegistrationPlan>} plan
 * @returns {string}
 */
export const describeRegistrationPlan = (plan) => [
  `${plan.method} ${plan.url}`,
  `  scope: ${plan.scope}`,
  "  headers:",
  ...Object.entries(plan.headers).map(([name, value]) => `    ${name}: ${value}`),
  `  commands: ${plan.commandNames.join(", ")}`,
  "  body:",
  plan.body,
].join("\n");

/**
 * Send the plan to Discord, or don't.
 *
 * `PUT` to the bulk-overwrite endpoint replaces **all** of the application's
 * commands for that scope — including user and message commands this template
 * never defines — so the body has to be the complete list, not a delta.
 * Commands that did not already exist count toward Discord's daily
 * application-command create limits.
 *
 * @see https://docs.discord.com/developers/interactions/application-commands#bulk-overwrite-global-application-commands
 * @param {object} request
 * @param {ReturnType<typeof buildRegistrationPlan>} request.plan
 * @param {string} request.token The bot token, for `Authorization: Bot <token>`.
 * @param {typeof fetch} request.fetchImpl Injected so tests stay offline.
 * @param {boolean} [request.dryRun] When true, returns without any request.
 * @returns {Promise<{ sent: boolean, registered: string[] }>} The command names
 *   the plan carried. A `200` from bulk overwrite means the scope now holds
 *   exactly that list, so there is no response body worth reading back.
 * @throws {Error} Carrying Discord's status and response text. Neither can
 *   contain the token, which is why both are safe to surface.
 */
export const executeRegistration = async ({ plan, token, fetchImpl, dryRun = false }) => {
  if (dryRun) {
    return { sent: false, registered: plan.commandNames };
  }

  const response = await fetchImpl(plan.url, {
    method: plan.method,
    // The only object in this module that holds the real credential, and it
    // does not outlive the call.
    headers: { ...plan.headers, authorization: `Bot ${token}` },
    body: plan.body,
  });

  if (!response.ok) {
    throw new Error(
      `Discord rejected the registration with status ${response.status}: ${await response.text()}`,
    );
  }

  return { sent: true, registered: plan.commandNames };
};

/**
 * Arguments in, registration out — the whole path in one call.
 *
 * This exists so the ordering is testable: parse, then validate, then build,
 * then send. `scripts/register-commands.js` calls only this and prints what it
 * returns.
 *
 * @param {object} request
 * @param {string[]} request.argv Arguments without the node binary or script path.
 * @param {Record<string, string | undefined>} request.env Usually `process.env`.
 * @param {typeof fetch} request.fetchImpl
 * @returns {Promise<{ plan: object, sent: boolean, registered: string[] }>}
 */
export const runRegistration = async ({ argv, env, fetchImpl }) => {
  const { scope, dryRun } = parseRegistrationArguments(argv);
  const environment = readRegistrationEnvironment(env, scope);
  const plan = buildRegistrationPlan(environment);
  const result = await executeRegistration({
    plan,
    token: environment.token,
    fetchImpl,
    dryRun,
  });

  return { plan, ...result };
};
