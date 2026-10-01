import { describe, expect, it } from "vitest";
import { commands } from "../../src/commands/index.js";
import { dispatchInteraction } from "../../src/interactions.js";

/**
 * These tests dispatch against the template's own registry rather than a
 * made-up one. That is the point: a command is only working when it is *in the
 * registry* and its handler answers, and a test that supplies its own registry
 * would pass even if the command were never registered.
 */
const context = {
  env: {},
  ctx: { waitUntil: () => {} },
  rest: { editOriginalResponse: () => {} },
  registry: commands,
};

describe("/ping", () => {
  it("replies immediately, in the channel", async () => {
    const response = await dispatchInteraction({ type: 2, data: { name: "ping" } }, context);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");

    const body = await response.json();
    // Type 4 is CHANNEL_MESSAGE_WITH_SOURCE: answered on the interaction
    // request itself, inside Discord's acknowledgement window, with no
    // follow-up. No flags, so the whole channel sees it.
    expect(body.type).toBe(4);
    expect(body.data.content).toBe("Pong!");
    expect(body.data.flags).toBeUndefined();
  });
});
