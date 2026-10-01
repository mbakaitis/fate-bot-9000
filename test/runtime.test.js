import { describe, expect, it } from "vitest";
import { sleep } from "../src/runtime.js";

/**
 * `sleep` exists as its own module for one reason: it is the only thing in the
 * template that touches a timer, so it is the only thing a test cannot fake.
 * Isolating it here means every command test injects a fake instead, and the
 * real implementation is still exercised — at zero milliseconds, so the suite
 * stays fast and nothing depends on the clock.
 */
describe("sleep", () => {
  it("resolves after the delay", async () => {
    await expect(sleep(0)).resolves.toBeUndefined();
  });
});
