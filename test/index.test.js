import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { signedInteraction } from "./helpers/interactions.js";

describe("Worker", () => {
  it("returns a healthy response", async () => {
    const response = await exports.default.fetch("https://example.com/");

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("OK");
  });
});

describe("POST /interactions", () => {
  it("rejects a request with no signature headers", async () => {
    const response = await exports.default.fetch("https://example.com/interactions", {
      method: "POST",
      body: JSON.stringify({ type: 1 }),
    });

    expect(response.status).toBe(401);
    expect(await response.text()).toBe("invalid request signature");
  });

  it("rejects a request whose signature header is not valid hex", async () => {
    const response = await exports.default.fetch("https://example.com/interactions", {
      method: "POST",
      headers: {
        "x-signature-ed25519": "not-a-signature",
        "x-signature-timestamp": "1700000000",
      },
      body: JSON.stringify({ type: 1 }),
    });

    expect(response.status).toBe(401);
  });

  it("rejects an unsigned request before parsing its body", async () => {
    // An unparseable body with missing headers must still fail as a signature
    // problem (401), never a body problem (400). A 400 here would prove the
    // Worker parsed attacker-controlled input before authenticating it.
    const response = await exports.default.fetch("https://example.com/interactions", {
      method: "POST",
      body: "}{ not json at all",
    });

    expect(response.status).toBe(401);
    expect(await response.text()).toBe("invalid request signature");
  });

  it("rejects a valid signature taken over a different body", async () => {
    const request = await signedInteraction(
      { type: 1, tampered: true },
      { signedBody: { type: 1 } },
    );

    const response = await exports.default.fetch(request);

    expect(response.status).toBe(401);
  });

  it("answers a signed PING with a PONG", async () => {
    const response = await exports.default.fetch(await signedInteraction({ type: 1 }));

    expect(response.status).toBe(200);
    // Discord requires a valid Content-Type on the PING acknowledgement.
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ type: 1 });
  });

  it("rejects a correctly signed body that is not valid JSON", async () => {
    const response = await exports.default.fetch(await signedInteraction("}{ not json at all"));

    expect(response.status).toBe(400);
  });

  it("dispatches a signed command interaction", async () => {
    // A name no command in the registry answers to, so the end-to-end path
    // through verification and dispatch lands on the unknown-command reply. It
    // is still a 200: the user gets told something rather than seeing Discord's
    // generic failure notice. Naming an unregistered command keeps this test
    // about routing rather than about whichever commands happen to ship.
    const response = await exports.default.fetch(
      await signedInteraction({ type: 2, data: { name: "nothing-registered" } }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect((await response.json()).data.content).toMatch(/unknown command/i);
  });

  it("rejects a signed interaction of a type it does not handle", async () => {
    // Type 3 is MESSAGE_COMPONENT. Components are out of scope for this
    // template, so an unhandled type gets a deliberate response rather than
    // falling through to a runtime error.
    const response = await exports.default.fetch(await signedInteraction({ type: 3 }));

    expect(response.status).toBe(400);
  });
});

describe("routing", () => {
  it("rejects a non-POST request to the interactions endpoint", async () => {
    const response = await exports.default.fetch("https://example.com/interactions");

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  it("returns 404 for an unknown path", async () => {
    const response = await exports.default.fetch("https://example.com/nope");

    expect(response.status).toBe(404);
  });
});
