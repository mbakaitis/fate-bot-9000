import { describe, expect, it } from "vitest";
import { dispatchInteraction } from "../src/interactions.js";

/**
 * A command registry built for the test, never the real one. The dispatcher
 * takes its registry as an argument precisely so a test can describe the
 * commands it cares about without the template's own registry changing what
 * these assertions mean.
 *
 * @param {(interaction: object, context: object) => Response} handler
 * @returns {Array<object>}
 */
const registryWith = (handler) => [
  { definition: { name: "known", description: "a command that exists" }, handler },
];

/** Context stand-ins. Nothing here reaches the network or the real runtime. */
const context = {
  env: { DISCORD_APPLICATION_ID: "test-application" },
  ctx: { waitUntil: () => {} },
  rest: { editOriginalResponse: () => {} },
  sleep: () => Promise.resolve(),
};

describe("interaction dispatch", () => {
  it("answers a PING with a PONG", async () => {
    // The seam sits between verification and the commands, so PING still has to
    // work: it is what Discord sends to validate an Interactions Endpoint URL.
    const response = await dispatchInteraction({ type: 1 }, { ...context, registry: [] });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ type: 1 });
  });

  it("routes a command to its handler with the injected context", async () => {
    /** @type {Array<object>} */
    const calls = [];
    const handler = (interaction, handlerContext) => {
      calls.push({ interaction, handlerContext });
      return new Response("handled");
    };
    const interaction = { type: 2, data: { name: "known" } };

    const response = await dispatchInteraction(interaction, {
      ...context,
      registry: registryWith(handler),
    });

    expect(await response.text()).toBe("handled");
    expect(calls).toHaveLength(1);
    expect(calls[0].interaction).toBe(interaction);
    expect(calls[0].handlerContext.env).toBe(context.env);
    expect(calls[0].handlerContext.ctx).toBe(context.ctx);
    expect(calls[0].handlerContext.rest).toBe(context.rest);
    // Ambient capabilities are injected for the same reason `rest` is: a
    // handler that reaches for a timer itself stops being testable as a
    // function, and `/slow` needs one.
    expect(calls[0].handlerContext.sleep).toBe(context.sleep);
  });

  it("replies ephemerally when the named command is not in the registry", async () => {
    // 200, not an error status: a 4xx leaves the user staring at Discord's
    // generic failure notice, and the mismatch is the bot's problem to explain.
    const response = await dispatchInteraction(
      { type: 2, data: { name: "absent" } },
      { ...context, registry: registryWith(() => new Response("handled")) },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.type).toBe(4);
    expect(body.data.flags).toBe(64);
    expect(body.data.content).toMatch(/unknown command/i);
  });

  it("treats a command interaction carrying no data as unknown", async () => {
    const response = await dispatchInteraction({ type: 2 }, { ...context, registry: [] });

    expect(response.status).toBe(200);
    expect((await response.json()).data.content).toMatch(/unknown command/i);
  });

  it("rejects an interaction type the template does not serve", async () => {
    // Type 3 is MESSAGE_COMPONENT, which is out of scope for this template.
    const response = await dispatchInteraction({ type: 3 }, { ...context, registry: [] });

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("unsupported interaction type");
  });

  it("says nothing about the payload when it rejects one", async () => {
    const response = await dispatchInteraction(
      { type: 3, token: "an-interaction-token", data: { custom_id: "secret-component" } },
      { ...context, registry: [] },
    );

    const body = await response.text();
    expect(body).not.toContain("an-interaction-token");
    expect(body).not.toContain("secret-component");
  });
});
