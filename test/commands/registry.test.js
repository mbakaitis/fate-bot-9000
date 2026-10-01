import { describe, expect, it } from "vitest";
import { commands } from "../../src/commands/index.js";

/**
 * Registry-wide invariants, deliberately written against `commands` rather than
 * against `ping` and `echo` by name. Every command added later is checked by
 * these tests without anyone remembering to extend them, and the failure lands
 * here — at `npm test` — instead of as a `400` from Discord's bulk-overwrite
 * endpoint, where the message is generic and the deploy has already run.
 *
 * @see https://docs.discord.com/developers/interactions/application-commands#application-command-object-application-command-structure
 */

/**
 * Discord's naming rule for `CHAT_INPUT` command and option names, verbatim.
 *
 * @see https://docs.discord.com/developers/interactions/application-commands#application-command-object-application-command-naming
 */
const DISCORD_NAME_PATTERN = /^[-_ʼ\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$/u;

describe("the command registry", () => {
  it("carries at least one command", () => {
    // Without this, every loop below passes vacuously.
    expect(commands.length).toBeGreaterThan(0);
  });

  it("names every command the way Discord requires", () => {
    for (const { definition } of commands) {
      expect(definition.name).toMatch(DISCORD_NAME_PATTERN);
      // Discord: "If there is a lowercase variant of any letters used, you must
      // use those."
      expect(definition.name).toBe(definition.name.toLowerCase());
    }
  });

  it("gives every command a description Discord will accept", () => {
    for (const { definition } of commands) {
      expect(definition.description.trim()).not.toBe("");
      expect(definition.description.length).toBeLessThanOrEqual(100);
    }
  });

  it("declares type, integration_types, and contexts on every command", () => {
    // Each of these has a Discord-side default. Declaring them makes where a
    // command can be used a property of this repository, reviewable in a diff,
    // rather than a consequence of whatever the Discord application happens to
    // be configured for.
    for (const { definition } of commands) {
      expect(definition.type).toBe(1);
      expect(definition.integration_types).toBeInstanceOf(Array);
      expect(definition.integration_types.length).toBeGreaterThan(0);
      expect(definition.contexts).toBeInstanceOf(Array);
      expect(definition.contexts.length).toBeGreaterThan(0);
    }
  });

  it("declares valid options, required ones first", () => {
    for (const { definition } of commands) {
      const options = definition.options ?? [];
      const lastRequired = options.findLastIndex((option) => option.required === true);
      const firstOptional = options.findIndex((option) => option.required !== true);

      for (const option of options) {
        expect(option.name).toMatch(DISCORD_NAME_PATTERN);
        expect(option.name).toBe(option.name.toLowerCase());
        expect(option.description.trim()).not.toBe("");
        expect(typeof option.type).toBe("number");
      }

      // Discord rejects a definition that lists an optional option before a
      // required one.
      if (lastRequired !== -1 && firstOptional !== -1) {
        expect(firstOptional).toBeGreaterThan(lastRequired);
      }
    }
  });

  it("gives every command a unique name and a handler", () => {
    const names = commands.map(({ definition }) => definition.name);

    expect(new Set(names).size).toBe(names.length);

    for (const command of commands) {
      expect(typeof command.handler).toBe("function");
    }
  });
});
