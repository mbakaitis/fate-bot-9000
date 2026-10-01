import { describe, expect, it } from "vitest";
import { commands } from "../../src/commands/index.js";
import { dispatchInteraction } from "../../src/interactions.js";

const context = {
  env: {},
  ctx: { waitUntil: () => {} },
  rest: { editOriginalResponse: () => {} },
  registry: commands,
};

/**
 * Invoke `/echo` the way Discord would, with the option list it sends.
 *
 * @param {Array<object> | undefined} options Command options as Discord sends
 *   them, or `undefined` for a payload carrying none.
 * @returns {Promise<Response>}
 */
const echo = (options) =>
  dispatchInteraction({ type: 2, data: { name: "echo", options } }, context);

describe("/echo", () => {
  it("replies with the submitted string", async () => {
    const response = await echo([{ name: "message", type: 3, value: "hello world" }]);

    const body = await response.json();
    expect(body.type).toBe(4);
    expect(body.data.content).toBe("hello world");
    expect(body.data.flags).toBeUndefined();
  });

  it("echoes user content without letting it mention anyone", async () => {
    // Interaction responses parse user mentions by default, so echoing raw
    // input back means the bot can ping someone on a stranger's behalf. This is
    // the option-parsing worked example, so it does not teach that habit.
    const response = await echo([{ name: "message", type: 3, value: "hi <@123> <@&456>" }]);

    const body = await response.json();
    expect(body.data.content).toBe("hi <@123> <@&456>");
    expect(body.data.allowed_mentions).toEqual({ parse: [] });
  });

  it("asks for a message when the option is absent", async () => {
    // Discord enforces `required` itself, but a handler that assumes so throws
    // on the first payload that disagrees — and a thrown handler is a failed
    // interaction, which tells the user nothing.
    const response = await echo(undefined);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.type).toBe(4);
    expect(body.data.flags).toBe(64);
    expect(body.data.content).toMatch(/message/i);
  });

  it("asks for a message when the option holds only whitespace", async () => {
    const response = await echo([{ name: "message", type: 3, value: "   \t\n " }]);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.flags).toBe(64);
    expect(body.data.content).toMatch(/message/i);
  });

  it("asks for a message when the options carry a different name", async () => {
    const response = await echo([{ name: "something-else", type: 3, value: "hello" }]);

    const body = await response.json();
    expect(body.data.flags).toBe(64);
    expect(body.data.content).toMatch(/message/i);
    // Not the dispatcher's unknown-command reply: `/echo` is registered, it
    // just did not get the option it needs.
    expect(body.data.content).not.toMatch(/unknown command/i);
  });
});
