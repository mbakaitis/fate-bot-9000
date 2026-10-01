/**
 * `/echo` — the option-parsing example.
 *
 * Two things make this worth copying rather than `/ping`: it reads an option out
 * of the interaction, and it treats that option as untrusted. Discord enforces
 * `required` on its side, but a handler that assumes so throws on the first
 * payload that disagrees, and a thrown handler is a failed interaction — which
 * shows the user Discord's generic error notice and tells them nothing.
 */
import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
  ApplicationIntegrationType,
  InteractionContextType,
} from "../discord/command-types.js";
import { ephemeral, reply } from "../discord/responses.js";

/** The option name, used by both the definition and the handler. */
const MESSAGE_OPTION = "message";

/** Shown when the option is missing, empty, or only whitespace. */
const NOTHING_TO_ECHO = "Give me a message to echo back.";

/**
 * What gets registered with Discord. See `ping.js` for why `type`,
 * `integration_types`, and `contexts` are all declared explicitly.
 *
 * @type {import("./index.js").CommandDefinition}
 */
export const definition = {
  name: "echo",
  description: "Repeat a message back to the channel.",
  type: ApplicationCommandType.CHAT_INPUT,
  integration_types: [ApplicationIntegrationType.GUILD_INSTALL],
  contexts: [InteractionContextType.GUILD, InteractionContextType.BOT_DM],
  options: [
    {
      type: ApplicationCommandOptionType.STRING,
      name: MESSAGE_OPTION,
      description: "The message to repeat.",
      required: true,
    },
  ],
};

/**
 * Read a string option out of an interaction, defensively.
 *
 * Discord sends options as an array of `{ name, type, value }`, not a keyed
 * object, so reading one is a lookup. Anything that is not a string — absent,
 * wrong type, wrong name — reads as the empty string, which the handler then
 * treats as "nothing given" in one place instead of several.
 *
 * @see https://docs.discord.com/developers/interactions/receiving-and-responding#interaction-object-application-command-interaction-data-option-structure
 * @param {object} interaction The dispatched interaction.
 * @param {string} name Option name from the definition.
 * @returns {string} The trimmed value, or `""`.
 */
const readStringOption = (interaction, name) => {
  const option = interaction.data.options?.find((entry) => entry.name === name);

  return typeof option?.value === "string" ? option.value.trim() : "";
};

/**
 * Echo the submitted message, or explain what was missing.
 *
 * The reply suppresses mention parsing. Interaction responses parse user
 * mentions by default, so sending back raw user input means the bot can ping
 * somebody on a stranger's behalf — a small thing here, and a habit worth not
 * teaching in the file new commands get copied from.
 *
 * @see https://docs.discord.com/developers/resources/message#allowed-mentions-object
 * @param {object} interaction The dispatched interaction.
 * @returns {Response}
 */
export const handler = (interaction) => {
  const message = readStringOption(interaction, MESSAGE_OPTION);

  if (message === "") {
    // Ephemeral: a validation message is for the person who typed it, and the
    // rest of the channel does not need to watch someone get it wrong.
    return ephemeral(NOTHING_TO_ECHO);
  }

  return reply(message, { suppressMentions: true });
};
