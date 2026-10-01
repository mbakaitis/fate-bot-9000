import { describe, expect, it } from "vitest";
import { deferred, ephemeral, pong, reply } from "../../src/discord/responses.js";

/**
 * Every helper must set a JSON content type: Discord rejects an interaction
 * response without a valid one, and the PING acknowledgement is the first
 * thing it checks when an Interactions Endpoint URL is saved.
 */
describe("interaction responses", () => {
  it("acknowledges a PING with type 1", async () => {
    const response = pong();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ type: 1 });
  });

  it("replies with a visible message", async () => {
    const response = reply("hello");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({
      type: 4,
      data: { content: "hello" },
    });
  });

  it("replies without parsing mentions when asked", async () => {
    // Interaction responses parse user mentions by default, so any helper that
    // sends content a user supplied needs a way to turn that off.
    const response = reply("hi <@123>", { suppressMentions: true });

    expect(await response.json()).toEqual({
      type: 4,
      data: { content: "hi <@123>", allowed_mentions: { parse: [] } },
    });
  });

  it("replies with a message only the caller can see", async () => {
    const response = ephemeral("just for you");

    expect(await response.json()).toEqual({
      type: 4,
      data: { content: "just for you", flags: 64 },
    });
  });

  it("defers so the response can be edited later", async () => {
    const response = deferred();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ type: 5 });
  });

  it("defers privately when asked", async () => {
    const response = deferred({ ephemeral: true });

    expect(await response.json()).toEqual({ type: 5, data: { flags: 64 } });
  });
});
