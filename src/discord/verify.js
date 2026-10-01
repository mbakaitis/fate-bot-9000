/**
 * Ed25519 signature verification for Discord interaction requests.
 *
 * This is the template's one security-critical module. Discord requires every
 * interaction to be verified, sends deliberately invalid signatures as a
 * routine check, and removes the Interactions Endpoint URL of an app that
 * accepts one. There is deliberately no bypass and no development flag here.
 *
 * @see https://docs.discord.com/developers/interactions/overview#validating-security-headers
 */
import { verifyKey } from "discord-interactions";

/** Header carrying the hex-encoded Ed25519 signature. */
const SIGNATURE_HEADER = "x-signature-ed25519";

/** Header carrying the timestamp the signature is computed over. */
const TIMESTAMP_HEADER = "x-signature-timestamp";

/**
 * Verify that a request genuinely came from Discord.
 *
 * The signature covers the raw request bytes, so this returns the body as text
 * and leaves parsing to the caller. Reading it any other way would mean parsing
 * attacker-controlled input before authenticating it.
 *
 * Two things fail closed. A missing public key rejects the request, so an
 * unconfigured Worker refuses interactions rather than accepting them
 * unverified. And `rawBody` is empty whenever `valid` is `false`, so a rejected
 * request never hands the caller a body to parse by accident.
 *
 * @param {Request} request The incoming interaction request.
 * @param {string | undefined} publicKey Hex-encoded Discord application public
 *   key, from the environment's `DISCORD_PUBLIC_KEY` secret.
 * @returns {Promise<{ valid: boolean, rawBody: string }>} The verified body, or
 *   `{ valid: false, rawBody: "" }`.
 */
export const verifyInteractionRequest = async (request, publicKey) => {
  const signature = request.headers.get(SIGNATURE_HEADER);
  const timestamp = request.headers.get(TIMESTAMP_HEADER);

  if (!signature || !timestamp || !publicKey) {
    return { valid: false, rawBody: "" };
  }

  const rawBody = await request.text();

  if (!(await verifyKey(rawBody, signature, timestamp, publicKey))) {
    return { valid: false, rawBody: "" };
  }

  return { valid: true, rawBody };
};
