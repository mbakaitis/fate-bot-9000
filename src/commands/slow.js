/**
 * `/slow` — the deferred-response example.
 *
 * Discord invalidates an interaction token if no initial response arrives
 * within 3 seconds, so any work that cannot promise to beat that clock has to
 * acknowledge first and send the real answer afterwards. This is the only shape
 * that works, and it is the one thing a bot template has to demonstrate,
 * because a command that gets it wrong looks fine in development and fails
 * under load.
 *
 * The work here is a wait. What matters is the structure around it:
 * acknowledge, schedule the follow-up on `ctx.waitUntil` so the Worker is not
 * torn down mid-flight, and let the follow-up own its own failures.
 *
 * @see https://docs.discord.com/developers/interactions/receiving-and-responding#interaction-callback
 * @see https://docs.discord.com/developers/interactions/receiving-and-responding#followup-messages
 */
import {
  ApplicationCommandType,
  ApplicationIntegrationType,
  InteractionContextType,
} from "../discord/command-types.js";
import { deferred } from "../discord/responses.js";

/**
 * How long the placeholder work takes.
 *
 * Deliberately past Discord's 3-second acknowledgement window: a value inside
 * the window would make the command answerable without deferring at all, and
 * the example would then demonstrate nothing. Keep it well under the 30 seconds
 * `waitUntil` allows after the response, and well under the 15 minutes an
 * interaction token stays valid.
 *
 * @see https://developers.cloudflare.com/workers/runtime-apis/context/#waituntil
 */
export const SLOW_WORK_DELAY_MS = 4000;

/** Sent once the work finishes. Derived from the constant, not from a clock. */
const FINISHED = `Done — that took ${SLOW_WORK_DELAY_MS / 1000} seconds of pretend work.`;

/** Sent when the work throws. Says what happened and quotes nothing. */
const FAILED = "Something went wrong finishing that. Please try again.";

/**
 * What gets registered with Discord. See `ping.js` for why `type`,
 * `integration_types`, and `contexts` are all declared explicitly.
 *
 * @type {import("./index.js").CommandDefinition}
 */
export const definition = {
  name: "slow",
  description: "Take longer than Discord will wait, then answer anyway.",
  type: ApplicationCommandType.CHAT_INPUT,
  integration_types: [ApplicationIntegrationType.GUILD_INSTALL],
  contexts: [InteractionContextType.GUILD, InteractionContextType.BOT_DM],
};

/**
 * The work being deferred — the part a real command replaces.
 *
 * It takes its delay as an argument rather than importing a timer, which is how
 * every test of this command runs without waiting. Replace the body with a
 * database read, a slow upstream API, an inference call: anything whose
 * duration you do not control.
 *
 * @param {(milliseconds: number) => Promise<void>} sleep Injected delay, from
 *   `src/runtime.js` in the Worker.
 * @returns {Promise<string>} The message content to send.
 */
export const performSlowWork = async (sleep) => {
  await sleep(SLOW_WORK_DELAY_MS);

  return FINISHED;
};

/**
 * Do the work, then replace the loading state with the result.
 *
 * Two failures are handled separately because they are different failures. If
 * the work throws, there is still a live interaction token and a user watching
 * a spinner, so the loading state is replaced with a message saying so. If the
 * *edit* throws, there is nothing left to tell them with — the only channel to
 * the user is the call that just failed — so it is swallowed deliberately.
 *
 * Swallowing is the point, not an oversight: a rejection left unhandled inside
 * `waitUntil` fails the invocation after the response has already been sent,
 * which records a Worker error nobody can act on while the user sees a command
 * that worked. Neither `catch` logs. Observability is enabled on this Worker,
 * and an interaction payload and an interaction token are exactly the two
 * things that must never become a durable record.
 *
 * @param {object} interaction The dispatched interaction.
 * @param {import("./index.js").CommandContext} context
 * @returns {Promise<void>}
 */
const followUp = async (interaction, { env, rest, sleep }) => {
  let content;

  try {
    content = await performSlowWork(sleep);
  } catch {
    content = FAILED;
  }

  try {
    await rest.editOriginalResponse({
      applicationId: env.DISCORD_APPLICATION_ID,
      interactionToken: interaction.token,
      message: { content },
    });
  } catch {
    // Deliberately terminal. See above, and `docs/discord-bot.md`.
  }
};

/**
 * Acknowledge now, answer later.
 *
 * The follow-up is handed to `ctx.waitUntil` so the runtime keeps the
 * invocation alive after the acknowledgement has been returned. Without it the
 * work is cancelled the moment the response goes out and the user is left with
 * a loading state forever. Note that `ctx` is passed as an object rather than
 * destructured into a bare `waitUntil` function, which would lose its binding.
 *
 * The deferred acknowledgement is public, so the eventual message is public
 * too: Discord fixes a response's ephemeral state at acknowledgement and the
 * follow-up edit cannot change it.
 *
 * @see https://developers.cloudflare.com/workers/runtime-apis/context/#waituntil
 * @param {object} interaction The dispatched interaction.
 * @param {import("./index.js").CommandContext} context
 * @returns {Response}
 */
export const handler = (interaction, { env, ctx, rest, sleep }) => {
  ctx.waitUntil(followUp(interaction, { env, rest, sleep }));

  return deferred();
};
