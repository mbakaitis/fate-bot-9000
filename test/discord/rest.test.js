import { describe, expect, it } from "vitest";
import { createRest, editOriginalResponse } from "../../src/discord/rest.js";

/**
 * A recording stand-in for `fetch`. Every test in this file uses one: the REST
 * helper takes `fetch` as an argument so no test has a way to reach Discord
 * even by accident.
 *
 * @param {object} [response] What the fake should return.
 * @returns {{ calls: Array<object>, fetch: Function }}
 */
const recordingFetch = (response = { ok: true, status: 200 }) => {
  const calls = [];
  return {
    calls,
    fetch: (url, init) => {
      calls.push({ url, init });
      return Promise.resolve(response);
    },
  };
};

describe("editOriginalResponse", () => {
  it("PATCHes the documented original-response path", async () => {
    const fake = recordingFetch();

    await editOriginalResponse(
      {
        applicationId: "123",
        interactionToken: "an-interaction-token",
        message: { content: "done" },
      },
      fake.fetch,
    );

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].url).toBe(
      "https://discord.com/api/v10/webhooks/123/an-interaction-token/messages/@original",
    );
    expect(fake.calls[0].init.method).toBe("PATCH");
    expect(fake.calls[0].init.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(fake.calls[0].init.body)).toEqual({ content: "done" });
  });

  it("throws with the status when Discord refuses the edit", async () => {
    const fake = recordingFetch({ ok: false, status: 404 });

    await expect(
      editOriginalResponse(
        { applicationId: "123", interactionToken: "an-interaction-token", message: {} },
        fake.fetch,
      ),
    ).rejects.toThrow(/404/);
  });

  it("keeps the interaction token out of the error it throws", async () => {
    // The token is in the URL and it is a live credential that can post as the
    // bot. An error message tends to end up in a log, so it must not carry one.
    const fake = recordingFetch({ ok: false, status: 401 });

    await expect(
      editOriginalResponse(
        { applicationId: "123", interactionToken: "an-interaction-token", message: {} },
        fake.fetch,
      ),
    ).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining("an-interaction-token"),
      }),
    );
  });
});

describe("createRest", () => {
  it("binds a fetch implementation the handlers never have to know about", async () => {
    const fake = recordingFetch();
    const rest = createRest(fake.fetch);

    await rest.editOriginalResponse({
      applicationId: "123",
      interactionToken: "an-interaction-token",
      message: { content: "done" },
    });

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].init.method).toBe("PATCH");
  });
});
