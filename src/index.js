/**
 * Worker entry point: a router and nothing else.
 *
 * Keeping this file free of interaction logic is deliberate. It routes, and the
 * modules under `src/discord/` decide what a response looks like, so the one
 * security-critical decision — verify before parsing — lives in exactly one
 * place and is tested there.
 */
import { commands } from "./commands/index.js";
import { createRest } from "./discord/rest.js";
import { verifyInteractionRequest } from "./discord/verify.js";
import { dispatchInteraction } from "./interactions.js";
import { sleep } from "./runtime.js";

/**
 * The Discord REST client the dispatcher hands to command handlers, bound to
 * the runtime's `fetch`. Tests build their own instead, which is why no module
 * below this one reaches for `fetch` itself. The same applies to `sleep`, the
 * runtime's timer: this file is the only place ambient capabilities are bound,
 * and everything below it receives them as arguments.
 */
const rest = createRest(fetch);

/**
 * Serve a Discord interaction.
 *
 * Verification comes first and fails closed: a request without a valid
 * signature gets a `401` and its body is never parsed, because the body of an
 * unverified request is attacker-controlled input. Only once both of those hold
 * does the payload reach the dispatcher.
 *
 * Nothing here logs the interaction payload. Payloads carry user content and
 * interaction tokens are short-lived credentials that can post as the bot, and
 * observability is enabled on this Worker, so a log line would be a durable
 * record of both.
 *
 * @param {Request} request
 * @param {object} env Worker bindings.
 * @param {string} [env.DISCORD_PUBLIC_KEY] Hex-encoded Discord application
 *   public key for this environment.
 * @param {ExecutionContext} ctx Worker execution context, passed through to
 *   command handlers for `waitUntil`.
 * @returns {Promise<Response>}
 */
const handleInteraction = async (request, env, ctx) => {
  const { valid, rawBody } = await verifyInteractionRequest(request, env.DISCORD_PUBLIC_KEY);

  if (!valid) {
    return new Response("invalid request signature", { status: 401 });
  }

  let interaction;
  try {
    interaction = JSON.parse(rawBody);
  } catch {
    // The signature checked out, so this is a malformed payload rather than a
    // forgery. Report the shape problem without echoing the body back.
    return new Response("invalid interaction payload", { status: 400 });
  }

  return dispatchInteraction(interaction, { env, ctx, registry: commands, rest, sleep });
};

export default {
  /**
   * Route incoming requests.
   *
   * @param {Request} request
   * @param {object} env Worker bindings. Document each binding you add here:
   *   this project is plain JavaScript with JSDoc and generates no TypeScript
   *   binding types.
   * @param {ExecutionContext} ctx Worker execution context.
   * @returns {Promise<Response>}
   */
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);

    if (pathname === "/") {
      return new Response("OK");
    }

    if (pathname === "/interactions") {
      if (request.method !== "POST") {
        return new Response("method not allowed", {
          status: 405,
          headers: { allow: "POST" },
        });
      }

      return handleInteraction(request, env, ctx);
    }

    return new Response("not found", { status: 404 });
  },
};
