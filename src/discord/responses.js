/**
 * Builders for Discord interaction responses.
 *
 * Discord requires a valid `Content-Type` on every interaction response,
 * including the PING acknowledgement it sends when an Interactions Endpoint URL
 * is saved. Routing every response through these helpers is what keeps that
 * from being forgotten in one branch.
 *
 * @see https://docs.discord.com/developers/interactions/receiving-and-responding#interaction-response-object-interaction-callback-type
 * @see https://docs.discord.com/developers/reference#content-type
 */

/**
 * Interaction callback types, as documented by Discord. Only the types this
 * template uses are declared; add one when a command needs it.
 *
 * @see https://docs.discord.com/developers/interactions/receiving-and-responding#interaction-response-object-interaction-callback-type
 */
export const InteractionResponseType = {
  /** ACK a `PING`. */
  PONG: 1,
  /** Respond to an interaction with a message. */
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  /** ACK now and edit the response later; the user sees a loading state. */
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
};

/**
 * Message flags used by interaction responses.
 *
 * @see https://docs.discord.com/developers/resources/message#message-object-message-flags
 */
export const MessageFlags = {
  /** `1 << 6` — visible only to the user who invoked the interaction. */
  EPHEMERAL: 64,
};

/**
 * Serialize an interaction response payload with the required content type.
 *
 * @param {object} payload The interaction response body.
 * @returns {Response}
 */
const json = (payload) =>
  new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
  });

/**
 * Acknowledge Discord's `PING` with a `PONG`.
 *
 * @returns {Response}
 */
export const pong = () => json({ type: InteractionResponseType.PONG });

/**
 * Reply immediately with a message everyone in the channel can see.
 *
 * Interaction responses parse user mentions by default, so pass
 * `suppressMentions` whenever the content came from a user. `allowed_mentions:
 * { parse: [] }` allows none of them.
 *
 * @see https://docs.discord.com/developers/resources/message#allowed-mentions-object
 * @param {string} content Message content.
 * @param {object} [options]
 * @param {boolean} [options.suppressMentions] Send the content without letting
 *   it notify anyone.
 * @returns {Response}
 */
export const reply = (content, { suppressMentions = false } = {}) =>
  json({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content,
      ...(suppressMentions ? { allowed_mentions: { parse: [] } } : {}),
    },
  });

/**
 * Reply immediately with a message only the invoking user can see. Use this for
 * validation errors and anything else the rest of the channel should not see.
 *
 * @param {string} content Message content.
 * @returns {Response}
 */
export const ephemeral = (content) =>
  json({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content, flags: MessageFlags.EPHEMERAL },
  });

/**
 * Acknowledge an interaction now and edit the response later, for work that
 * will not finish inside Discord's acknowledgement window.
 *
 * @param {object} [options]
 * @param {boolean} [options.ephemeral] Show the eventual message only to the
 *   invoking user.
 * @returns {Response}
 */
export const deferred = ({ ephemeral: isEphemeral = false } = {}) =>
  json({
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    ...(isEphemeral ? { data: { flags: MessageFlags.EPHEMERAL } } : {}),
  });
