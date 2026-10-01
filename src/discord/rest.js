/**
 * The slice of Discord's REST API this template calls.
 *
 * Exactly one call lives here: editing the original response to an interaction,
 * which is how a deferred acknowledgement eventually becomes a message. Every
 * function takes `fetch` as an argument, so a test injects a recording fake and
 * nothing in the suite can reach Discord.
 *
 * @see https://docs.discord.com/developers/interactions/receiving-and-responding#followup-messages
 */

/**
 * Discord's versioned API base. Pinning the version is deliberate: an
 * unversioned base URL redirects to Discord's oldest supported version, which
 * changes without notice.
 *
 * @see https://docs.discord.com/developers/reference#api-versioning
 */
export const DISCORD_API_BASE = "https://discord.com/api/v10";

/**
 * Edit the original response to an interaction.
 *
 * `PATCH /webhooks/{application.id}/{interaction.token}/messages/@original`,
 * the endpoint Discord documents for editing an initial interaction response.
 * The interaction token in the path is the authorization — this call carries no
 * bot token — and it stays valid for 15 minutes after the interaction.
 *
 * @see https://docs.discord.com/developers/interactions/receiving-and-responding#edit-original-interaction-response
 * @param {object} request
 * @param {string} request.applicationId The Discord application ID for this
 *   environment, from `env.DISCORD_APPLICATION_ID`.
 * @param {string} request.interactionToken The token from the interaction being
 *   answered. Treat it as a credential: it can post as the bot.
 * @param {object} request.message Message fields to set, such as `content`.
 * @param {typeof fetch} fetchImpl The `fetch` to use. Injected so tests stay
 *   offline.
 * @returns {Promise<Response>} Discord's response.
 * @throws {Error} When Discord answers with a non-2xx status.
 */
export const editOriginalResponse = async (
  { applicationId, interactionToken, message },
  fetchImpl,
) => {
  const response = await fetchImpl(
    `${DISCORD_API_BASE}/webhooks/${applicationId}/${interactionToken}/messages/@original`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(message),
    },
  );

  if (!response.ok) {
    // Status only. The request URL carries the interaction token and the
    // response body can quote the content that was sent, and an error message
    // is the single most likely thing to end up in a log line.
    throw new Error(`Discord rejected the original-response edit with status ${response.status}`);
  }

  return response;
};

/**
 * Bind a `fetch` implementation into a REST client.
 *
 * This is the object the dispatcher passes to command handlers, so a handler
 * never touches `fetch` directly and a test can hand it a fake that records
 * calls instead.
 *
 * @param {typeof fetch} fetchImpl
 * @returns {{ editOriginalResponse: (request: object) => Promise<Response> }}
 */
export const createRest = (fetchImpl) => ({
  editOriginalResponse: (request) => editOriginalResponse(request, fetchImpl),
});
