import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

/**
 * Convert a buffer to lowercase hex, the encoding Discord uses for both the
 * application public key and the `X-Signature-Ed25519` header.
 *
 * @param {ArrayBuffer} buffer
 * @returns {string}
 */
const toHex = (buffer) =>
  [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

// A throwaway Ed25519 keypair, generated per test run rather than committed.
// Signature verification is the template's one security-critical behavior, so
// the tests sign real fixtures with a real key and let `verifyKey` do real
// cryptography — stubbing it would assert nothing. Generating the pair here
// keeps any key-shaped literal out of the repository entirely, and keeps test
// credentials unmistakably distinct from a real Discord application's.
const testKeyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);

export default defineConfig({
  test: {
    include: ["test/**/*.test.js"],
    exclude: ["test/contracts/**"],
    coverage: {
      // Istanbul, not v8: the Workers pool runs tests inside workerd, which does
      // not emit the V8 coverage profile the default provider reads.
      provider: "istanbul",
      // Template-owned logic only. `scripts/lib/` holds the pure half of the
      // command-registration CLI so it is covered by the same ratchet as `src/`.
      include: ["src/**/*.js", "scripts/lib/**/*.js"],
      reporter: ["text", "html"],
      // A ratchet, not an aspiration: these numbers are the level the suite
      // currently reaches. Raise them by hand when a change measures higher, so
      // the new promise appears in a reviewed diff; never lower them to make a
      // change pass. `thresholds.autoUpdate` is deliberately not used — a
      // threshold that moves on its own is not a reviewed promise.
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
  },
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: "./wrangler.jsonc",
      },
      miniflare: {
        bindings: {
          // The Worker reads its Discord application public key from `env`, so
          // the test pool supplies the public half here and the tests read the
          // same value from `cloudflare:test`'s `env`. No test takes a
          // credential from a real Discord application.
          DISCORD_PUBLIC_KEY: toHex(await crypto.subtle.exportKey("raw", testKeyPair.publicKey)),
          // The private half, used only by `test/helpers/interactions.js` to
          // sign fixtures. The Worker never reads it.
          TEST_SIGNING_KEY_PKCS8: toHex(
            await crypto.subtle.exportKey("pkcs8", testKeyPair.privateKey),
          ),
        },
      },
    }),
  ],
});
