/**
 * Shapes a pasted Discord credential would have.
 *
 * A bot token is three dot-separated base64url segments; an application public
 * key is 64 lowercase hex characters. Neither shape occurs naturally in this
 * repository, so a match means a real credential — or something close enough to
 * a real one to be worth deleting — reached a tracked file.
 *
 * Shared rather than repeated: `test/contracts/discord.test.js` scans every
 * tracked file with these, and anything else that needs to make the same
 * assertion about a narrower set of files imports them from here, so there is
 * one definition of what a credential looks like.
 *
 * @type {ReadonlyArray<{ name: string, pattern: RegExp }>}
 */
export const credentialShapes = [
  {
    name: "Discord bot token",
    pattern: /\b[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}\b/,
  },
  {
    name: "Discord application public key",
    pattern: /\b[0-9a-fA-F]{64}\b/,
  },
];
