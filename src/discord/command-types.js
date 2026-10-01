/**
 * Constants for the shape of an application command definition — the object
 * sent to Discord's registration endpoint.
 *
 * These sit beside the rest of the protocol in `src/discord/` and are imported
 * by the command modules, so a definition reads as `CHAT_INPUT` rather than
 * `1`. Nothing here imports anything, which matters: the command registration
 * script loads these under plain Node.
 *
 * @see https://docs.discord.com/developers/interactions/application-commands#application-command-object-application-command-structure
 */

/**
 * Command types. This template serves slash commands only; user and message
 * context-menu commands would need their own dispatch branch.
 *
 * @see https://docs.discord.com/developers/interactions/application-commands#application-command-object-application-command-types
 */
export const ApplicationCommandType = {
  /** A slash command, shown when a user types `/`. */
  CHAT_INPUT: 1,
};

/**
 * Option types. Only the types this template's commands use are declared; add
 * one when a command needs it.
 *
 * @see https://docs.discord.com/developers/interactions/application-commands#application-command-object-application-command-option-type
 */
export const ApplicationCommandOptionType = {
  /** Free text. */
  STRING: 3,
};

/**
 * Installation contexts a command supports — where the app was installed. Both
 * are declared because choosing between them is the whole reason a definition
 * states `integration_types` instead of inheriting the application's default.
 *
 * A command's `integration_types` can only include contexts the Discord
 * application itself supports.
 *
 * @see https://docs.discord.com/developers/resources/application#application-object-application-integration-types
 */
export const ApplicationIntegrationType = {
  /** Installed to a server. */
  GUILD_INSTALL: 0,
  /** Installed to a user, who can then use the command anywhere. */
  USER_INSTALL: 1,
};

/**
 * Interaction contexts — where in the Discord client a command can be used.
 *
 * `PRIVATE_CHANNEL` is only meaningful for a command whose
 * `integration_types` includes `USER_INSTALL`, which is why this template's own
 * commands do not list it.
 *
 * @see https://docs.discord.com/developers/interactions/receiving-and-responding#interaction-object-interaction-context-types
 */
export const InteractionContextType = {
  /** In a server. */
  GUILD: 0,
  /** In a DM with the bot. */
  BOT_DM: 1,
  /** In a group DM or a DM with another user. */
  PRIVATE_CHANNEL: 2,
};
