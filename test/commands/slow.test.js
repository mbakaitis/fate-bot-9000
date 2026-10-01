import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { commands } from "../../src/commands/index.js";
import { SLOW_WORK_DELAY_MS } from "../../src/commands/slow.js";
import { dispatchInteraction } from "../../src/interactions.js";

/**
 * `/slow` is the one command whose interesting half runs *after* the response,
 * so its tests are the only ones that need a real execution context:
 * `waitOnExecutionContext` is what settles the `ctx.waitUntil` promise, and
 * without it a test could only prove the follow-up was scheduled — not that it
 * happened, and not what it sent.
 *
 * Nothing here waits on a real timer. The delay is injected as `sleep`, held
 * open until the test releases it, which is also how the ordering assertion
 * below is made deterministic rather than a race with the microtask queue.
 */

/**
 * A `sleep` the test controls: it records the delay it was asked for and stays
 * pending until `release()` or `fail()` is called.
 *
 * @returns {{ delays: number[], release: Function, fail: Function, sleep: Function }}
 */
const controllableSleep = () => {
  /** @type {number[]} */
  const delays = [];
  let settle = { resolve: () => {}, reject: () => {} };

  return {
    delays,
    release: () => settle.resolve(),
    fail: () => settle.reject(new Error("the slow work broke")),
    sleep: (milliseconds) => {
      delays.push(milliseconds);
      return new Promise((resolve, reject) => {
        settle = { resolve, reject };
      });
    },
  };
};

/**
 * A recording stand-in for the Discord REST client. The dispatcher takes `rest`
 * as an argument so no test has a way to reach Discord even by accident.
 *
 * @param {object} [options]
 * @param {boolean} [options.failing] Reject the edit, as Discord would on an
 *   expired interaction token or a rate limit.
 * @returns {{ calls: Array<object>, editOriginalResponse: Function }}
 */
const recordingRest = ({ failing = false } = {}) => {
  /** @type {Array<object>} */
  const calls = [];

  return {
    calls,
    editOriginalResponse: (request) => {
      calls.push(request);
      return failing
        ? Promise.reject(new Error("Discord rejected the original-response edit with status 404"))
        : Promise.resolve(new Response(null, { status: 200 }));
    },
  };
};

/**
 * Invoke `/slow` through the real registry, the way the Worker does.
 *
 * @param {object} parts
 * @param {object} parts.ctx Execution context.
 * @param {Function} parts.sleep Injected delay.
 * @param {object} parts.rest Injected REST client.
 * @returns {Promise<Response>}
 */
const slow = ({ ctx, sleep, rest }) =>
  dispatchInteraction(
    { type: 2, token: "an-interaction-token", data: { name: "slow" } },
    {
      env: { DISCORD_APPLICATION_ID: "test-application-id" },
      ctx,
      rest,
      sleep,
      registry: commands,
    },
  );

describe("/slow", () => {
  it("acknowledges immediately, before the work has finished", async () => {
    const ctx = createExecutionContext();
    const timer = controllableSleep();
    const rest = recordingRest();

    const response = await slow({ ctx, sleep: timer.sleep, rest });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");

    const body = await response.json();
    // Type 5 is DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: acknowledged now, edited
    // later, and the user sees a loading state in the meantime.
    expect(body.type).toBe(5);
    // Public, so the eventual message is public too — a deferred response fixes
    // the message's ephemeral state at acknowledgement.
    expect(body.data).toBeUndefined();
    // The acknowledgement did not wait for the work: the sleep is still pending
    // and nothing has been sent to Discord yet.
    expect(rest.calls).toHaveLength(0);

    timer.release();
    await waitOnExecutionContext(ctx);
  });

  it("waits longer than Discord's acknowledgement window, which is why it defers", async () => {
    const ctx = createExecutionContext();
    const timer = controllableSleep();

    await slow({ ctx, sleep: timer.sleep, rest: recordingRest() });

    expect(timer.delays).toEqual([SLOW_WORK_DELAY_MS]);
    // Discord invalidates the interaction token if no initial response arrives
    // within 3 seconds. Work that cannot promise to beat that has to defer.
    expect(SLOW_WORK_DELAY_MS).toBeGreaterThan(3000);

    timer.release();
    await waitOnExecutionContext(ctx);
  });

  it("edits the original response once the work completes", async () => {
    const ctx = createExecutionContext();
    const timer = controllableSleep();
    const rest = recordingRest();

    await slow({ ctx, sleep: timer.sleep, rest });
    timer.release();
    await waitOnExecutionContext(ctx);

    expect(rest.calls).toHaveLength(1);
    expect(rest.calls[0].applicationId).toBe("test-application-id");
    expect(rest.calls[0].interactionToken).toBe("an-interaction-token");
    expect(rest.calls[0].message.content).toMatch(/\S/);
  });

  it("tells the user when the work itself failed, rather than leaving it loading", async () => {
    const ctx = createExecutionContext();
    const timer = controllableSleep();
    const rest = recordingRest();

    const response = await slow({ ctx, sleep: timer.sleep, rest });
    timer.fail();
    await waitOnExecutionContext(ctx);

    // The acknowledgement already went out, so the only way to report a failure
    // is the edit. Leaving the loading state to time out tells the user nothing.
    expect((await response.json()).type).toBe(5);
    expect(rest.calls).toHaveLength(1);
    expect(rest.calls[0].message.content).toMatch(/wrong|fail/i);
  });

  it("says nothing about the interaction when the work fails", async () => {
    const ctx = createExecutionContext();
    const timer = controllableSleep();
    const rest = recordingRest();

    await slow({ ctx, sleep: timer.sleep, rest });
    timer.fail();
    await waitOnExecutionContext(ctx);

    // The failure message is a channel message. It must not quote the error, the
    // token, or anything else out of the payload.
    expect(rest.calls[0].message.content).not.toContain("an-interaction-token");
    expect(rest.calls[0].message.content).not.toContain("the slow work broke");
  });

  it("survives a follow-up edit that Discord refuses", async () => {
    const ctx = createExecutionContext();
    const timer = controllableSleep();
    const rest = recordingRest({ failing: true });

    const response = await slow({ ctx, sleep: timer.sleep, rest });
    timer.release();

    // A rejection left unhandled inside `waitUntil` fails the invocation after
    // the response has already gone out: the user sees a working command and the
    // Worker records an error it can do nothing about. So the follow-up owns its
    // own failure, and the acknowledgement stands.
    await expect(waitOnExecutionContext(ctx)).resolves.toBeUndefined();
    expect((await response.json()).type).toBe(5);
    expect(rest.calls).toHaveLength(1);
  });
});
