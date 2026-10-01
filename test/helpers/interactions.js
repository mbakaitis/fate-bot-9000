/**
 * Test helpers for building Discord interaction requests.
 *
 * These sign fixtures with the test-run Ed25519 key supplied by the test pool
 * (see `vitest.config.js`), so the Worker's signature verification runs real
 * cryptography against a real signature. Nothing here reaches the network or
 * uses a credential from a real Discord application.
 */
import { env } from "cloudflare:test";

const encoder = new TextEncoder();

/**
 * @param {ArrayBuffer} buffer
 * @returns {string} lowercase hex
 */
const toHex = (buffer) =>
  [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/**
 * @param {string} hex
 * @returns {Uint8Array}
 */
const fromHex = (hex) =>
  new Uint8Array(hex.match(/.{2}/g).map((byte) => Number.parseInt(byte, 16)));

/** @type {Promise<CryptoKey> | undefined} */
let signingKey;

/**
 * Import the test run's Ed25519 private key, once per test file.
 *
 * @returns {Promise<CryptoKey>}
 */
const getSigningKey = () => {
  signingKey ??= crypto.subtle.importKey(
    "pkcs8",
    fromHex(env.TEST_SIGNING_KEY_PKCS8),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  return signingKey;
};

/**
 * Sign a message the way Discord does: over `timestamp + body`.
 *
 * @param {string} timestamp
 * @param {string} body
 * @returns {Promise<string>} hex signature for the `X-Signature-Ed25519` header
 */
export const signPayload = async (timestamp, body) =>
  toHex(
    await crypto.subtle.sign({ name: "Ed25519" }, await getSigningKey(), encoder.encode(timestamp + body)),
  );

/**
 * Build a POST request to the interactions endpoint carrying a valid signature.
 *
 * @param {object | string} body Interaction payload, or a raw body string.
 * @param {object} [options]
 * @param {string} [options.timestamp] Signature timestamp header value.
 * @param {object | string} [options.signedBody] Body to sign instead of the body
 *   sent, which is how a tampered-payload fixture is built.
 * @param {string} [options.url] Request URL.
 * @returns {Promise<Request>}
 */
export const signedInteraction = async (body, options = {}) => {
  const { timestamp = "1700000000", url = "https://example.com/interactions" } = options;
  const asText = (value) => (typeof value === "string" ? value : JSON.stringify(value));
  const sentBody = asText(body);
  const signedBody = asText(options.signedBody ?? body);

  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": await signPayload(timestamp, signedBody),
      "x-signature-timestamp": timestamp,
    },
    body: sentBody,
  });
};
