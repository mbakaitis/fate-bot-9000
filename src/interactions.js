/**
 * The dispatcher: one pure function from a verified interaction to a Response.
 *
 * Everything it needs arrives as an argument — bindings, the execution context,
 * the command registry, the Discord REST client, the runtime's timer. That is
 * not decoration. It is what lets a test dispatch any interaction against a
 * registry it made up, a REST client that records instead of calling, and a
 * timer that never waits — with no Worker to start and no network to reach —
 * and it is what keeps the coverage ratchet reachable as commands are added.
 *
 * Nothing here logs. Interaction payloads carry user content and an interaction
 * token can post as the bot, so neither one is written anywhere.
 *
 * @see https://docs.discord.com/developers/interactions/receiving-and-responding#interaction-object-interaction-type
 */
import { ephemeral, pong } from "./discord/responses.js";

/**
 * Interaction types, as documented by Discord. Only the types this template
 * serves are declared.
 *
 * @see https://docs.discord.com/developers/interactions/receiving-and-responding#interaction-object-interaction-type
 */
export const InteractionType = {
  /** Discord's endpoint-validation and keep-alive probe. */
  PING: 1,
  /** A slash command invocation. */
  APPLICATION_COMMAND: 2,
};

/**
 * What the user sees when Discord offers a command the Worker cannot serve.
 *
 * It names no part of the payload on purpose, and it points at the actual cause
 * rather than blaming the user: the two sides of the contract have diverged,
 * which is a registration problem.
 */
const UNKNOWN_COMMAND_MESSAGE =
  "Unknown command. This bot's commands may need to be registered again.";

/**
 * Route a verified interaction to its response.
 *
 * A command Discord knows about but the registry does not gets a `200` with an
 * ephemeral explanation, not an error status. Discord renders a failed
 * interaction as its own generic notice, which tells the user nothing; a real
 * reply that only they can see tells them what happened.
 *
 * @param {object} interaction The parsed, signature-verified interaction.
 * @param {object} context
 * @param {object} context.env Worker bindings for this environment.
 * @param {ExecutionContext} context.ctx Worker execution context, for
 *   `waitUntil`.
 * @param {import("./commands/index.js").Command[]} context.registry Commands
 *   available to this dispatch.
 * @param {{ editOriginalResponse: Function }} context.rest Discord REST client.
 * @param {(milliseconds: number) => Promise<void>} [context.sleep] The
 *   runtime's timer, passed through to handlers that defer.
 * @returns {Promise<Response>}
 */
export const dispatchInteraction = async (interaction, { env, ctx, registry, rest, sleep }) => {
  if (interaction.type === InteractionType.PING) {
    return pong();
  }

  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    const command = registry.find((entry) => entry.definition.name === interaction.data?.name);

    if (!command) {
      return ephemeral(UNKNOWN_COMMAND_MESSAGE);
    }

    return command.handler(interaction, { env, ctx, rest, sleep });
  }

  // Components, modals, and autocomplete are out of scope for this template.
  // Answer deliberately rather than falling through, and say nothing about the
  // payload that arrived.
  return new Response("unsupported interaction type", { status: 400 });
};
