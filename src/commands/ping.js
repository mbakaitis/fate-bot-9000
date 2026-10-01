/**
 * `/ping` — the minimal command.
 *
 * It exists to be the shortest complete example: a definition, a handler, one
 * registry entry. Anything a command can do beyond replying is somebody else's
 * example, and this file is the one a new command gets copied from.
 *
 * The definition and the handler live in the same file on purpose. They are two
 * halves of one thing, and separating them is how a bot ends up advertising a
 * command nobody implemented.
 */
import {
  ApplicationCommandType,
  ApplicationIntegrationType,
  InteractionContextType,
} from "../discord/command-types.js";
import { reply } from "../discord/responses.js";

/**
 * What gets registered with Discord.
 *
 * `type`, `integration_types`, and `contexts` all have Discord-side defaults
 * and are all declared anyway: where a command can be used should be a property
 * of this repository, visible in a diff, not a consequence of how the Discord
 * application happens to be configured. Note that Discord only applies these
 * two fields to globally-scoped commands — a guild-scoped registration is
 * already limited to that guild.
 *
 * @type {import("./index.js").CommandDefinition}
 */
export const definition = {
  name: "ping",
  description: "Check that the bot is responding.",
  type: ApplicationCommandType.CHAT_INPUT,
  integration_types: [ApplicationIntegrationType.GUILD_INSTALL],
  contexts: [InteractionContextType.GUILD, InteractionContextType.BOT_DM],
};

/**
 * Answer immediately, on the interaction request itself.
 *
 * There is nothing slow here, so there is nothing to defer: the reply fits
 * inside Discord's acknowledgement window with room to spare. See
 * `docs/discord-bot.md` for when that stops being true.
 *
 * @returns {Response}
 */
export const handler = () => reply("Pong!");
