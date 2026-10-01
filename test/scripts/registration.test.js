import { describe, expect, it } from "vitest";
import { commands } from "../../src/commands/index.js";
import {
  buildRegistrationPlan,
  describeRegistrationPlan,
  executeRegistration,
  parseRegistrationArguments,
  readRegistrationEnvironment,
  runRegistration,
} from "../../scripts/lib/registration.js";

/**
 * Placeholder credentials. Shaped like the real thing and valid for nothing:
 * every test in this file is offline, and the `fetch` the library is handed is
 * always a fake that records instead of calling.
 */
const PLACEHOLDER = {
  DISCORD_TOKEN: "placeholder-token-not-a-credential",
  DISCORD_APPLICATION_ID: "000000000000000000",
  DISCORD_GUILD_ID: "111111111111111111",
};

/**
 * A recording stand-in for `fetch`, the same pattern
 * `test/discord/rest.test.js` uses: the library takes `fetch` as an argument,
 * so no test here has a way to reach Discord even by accident.
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

describe("parseRegistrationArguments", () => {
  it("reads a guild-scoped dry run", () => {
    expect(parseRegistrationArguments(["--guild", "--dry-run"])).toEqual({
      scope: "guild",
      dryRun: true,
    });
  });

  it("reads a global registration, which is not a dry run unless asked", () => {
    expect(parseRegistrationArguments(["--global"])).toEqual({
      scope: "global",
      dryRun: false,
    });
  });

  it("refuses to guess the scope", () => {
    // Inferring the scope from whether DISCORD_GUILD_ID happens to be set is
    // how a production registration quietly lands in somebody's test guild.
    expect(() => parseRegistrationArguments(["--dry-run"])).toThrow(/--global|--guild/);
  });

  it("refuses both scopes at once", () => {
    expect(() => parseRegistrationArguments(["--global", "--guild"])).toThrow(/both/i);
  });

  it("refuses an argument it does not recognize", () => {
    expect(() => parseRegistrationArguments(["--globl"])).toThrow(/--globl/);
  });
});

describe("readRegistrationEnvironment", () => {
  it("reads the credentials a guild registration needs", () => {
    expect(readRegistrationEnvironment(PLACEHOLDER, "guild")).toEqual({
      scope: "guild",
      token: PLACEHOLDER.DISCORD_TOKEN,
      applicationId: PLACEHOLDER.DISCORD_APPLICATION_ID,
      guildId: PLACEHOLDER.DISCORD_GUILD_ID,
    });
  });

  it("drops the guild id for a global registration even when one is set", () => {
    // A shell that still has a test guild exported must not be able to turn a
    // global registration into a guild one.
    expect(readRegistrationEnvironment(PLACEHOLDER, "global")).toEqual({
      scope: "global",
      token: PLACEHOLDER.DISCORD_TOKEN,
      applicationId: PLACEHOLDER.DISCORD_APPLICATION_ID,
      guildId: undefined,
    });
  });

  it("names every missing variable at once", () => {
    expect(() => readRegistrationEnvironment({}, "global")).toThrow(
      /DISCORD_TOKEN[\s\S]*DISCORD_APPLICATION_ID|DISCORD_APPLICATION_ID[\s\S]*DISCORD_TOKEN/,
    );
  });

  it("requires a guild id for a guild registration", () => {
    const withoutGuild = {
      DISCORD_TOKEN: PLACEHOLDER.DISCORD_TOKEN,
      DISCORD_APPLICATION_ID: PLACEHOLDER.DISCORD_APPLICATION_ID,
    };

    expect(() => readRegistrationEnvironment(withoutGuild, "guild")).toThrow(/DISCORD_GUILD_ID/);
  });

  it("treats a blank value as missing", () => {
    expect(() => readRegistrationEnvironment({ ...PLACEHOLDER, DISCORD_TOKEN: "   " }, "guild"))
      .toThrow(/DISCORD_TOKEN/);
  });
});

describe("buildRegistrationPlan", () => {
  it("targets the documented global bulk-overwrite endpoint", () => {
    const plan = buildRegistrationPlan({
      scope: "global",
      applicationId: PLACEHOLDER.DISCORD_APPLICATION_ID,
      guildId: undefined,
    });

    expect(plan.method).toBe("PUT");
    expect(plan.url).toBe(
      `https://discord.com/api/v10/applications/${PLACEHOLDER.DISCORD_APPLICATION_ID}/commands`,
    );
  });

  it("targets the documented guild bulk-overwrite endpoint", () => {
    const plan = buildRegistrationPlan({
      scope: "guild",
      applicationId: PLACEHOLDER.DISCORD_APPLICATION_ID,
      guildId: PLACEHOLDER.DISCORD_GUILD_ID,
    });

    expect(plan.method).toBe("PUT");
    expect(plan.url).toBe(
      `https://discord.com/api/v10/applications/${PLACEHOLDER.DISCORD_APPLICATION_ID}` +
        `/guilds/${PLACEHOLDER.DISCORD_GUILD_ID}/commands`,
    );
  });

  it("sends the registry's definitions and nothing else", () => {
    // The registry is the default rather than something the caller supplies,
    // so there is no way to register a list the Worker does not dispatch.
    const plan = buildRegistrationPlan({
      scope: "global",
      applicationId: PLACEHOLDER.DISCORD_APPLICATION_ID,
      guildId: undefined,
    });

    expect(JSON.parse(plan.body)).toEqual(commands.map((command) => command.definition));
    expect(plan.commandNames).toEqual(commands.map((command) => command.definition.name));
  });

  it("accepts an explicit command list for testing", () => {
    const plan = buildRegistrationPlan(
      { scope: "global", applicationId: PLACEHOLDER.DISCORD_APPLICATION_ID, guildId: undefined },
      [{ definition: { name: "only", description: "Just the one." } }],
    );

    expect(JSON.parse(plan.body)).toEqual([{ name: "only", description: "Just the one." }]);
    expect(plan.commandNames).toEqual(["only"]);
  });

  it("carries a redacted authorization header, never the token", () => {
    // The plan is the printable half. It is built without the token so that no
    // code path — including an error path — can print one.
    const plan = buildRegistrationPlan({
      scope: "global",
      applicationId: PLACEHOLDER.DISCORD_APPLICATION_ID,
      guildId: undefined,
    });

    expect(plan.headers.authorization).toBe("Bot [redacted]");
    expect(plan.headers["content-type"]).toBe("application/json");
    expect(JSON.stringify(plan)).not.toContain(PLACEHOLDER.DISCORD_TOKEN);
  });
});

describe("describeRegistrationPlan", () => {
  it("prints the target, the redacted headers, and the body", () => {
    const plan = buildRegistrationPlan({
      scope: "guild",
      applicationId: PLACEHOLDER.DISCORD_APPLICATION_ID,
      guildId: PLACEHOLDER.DISCORD_GUILD_ID,
    });

    const description = describeRegistrationPlan(plan);

    expect(description).toContain(`PUT ${plan.url}`);
    expect(description).toContain("authorization: Bot [redacted]");
    expect(description).toContain("content-type: application/json");
    expect(description).toContain("\"name\": \"ping\"");
    expect(description).not.toContain(PLACEHOLDER.DISCORD_TOKEN);
  });
});

describe("executeRegistration", () => {
  const plan = buildRegistrationPlan({
    scope: "global",
    applicationId: PLACEHOLDER.DISCORD_APPLICATION_ID,
    guildId: undefined,
  });

  it("PUTs the plan with a bot-token authorization header", async () => {
    const fake = recordingFetch();

    const result = await executeRegistration({
      plan,
      token: PLACEHOLDER.DISCORD_TOKEN,
      fetchImpl: fake.fetch,
    });

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].url).toBe(plan.url);
    expect(fake.calls[0].init.method).toBe("PUT");
    expect(fake.calls[0].init.headers.authorization).toBe(`Bot ${PLACEHOLDER.DISCORD_TOKEN}`);
    expect(fake.calls[0].init.headers["content-type"]).toBe("application/json");
    expect(fake.calls[0].init.body).toBe(plan.body);
    expect(result).toEqual({ sent: true, registered: plan.commandNames });
  });

  it("contacts nothing on a dry run", async () => {
    const fake = recordingFetch();

    const result = await executeRegistration({
      plan,
      token: PLACEHOLDER.DISCORD_TOKEN,
      fetchImpl: fake.fetch,
      dryRun: true,
    });

    expect(fake.calls).toHaveLength(0);
    expect(result).toEqual({ sent: false, registered: plan.commandNames });
  });

  it("surfaces both the status and the response body when Discord refuses", async () => {
    const fake = recordingFetch({
      ok: false,
      status: 400,
      text: () => Promise.resolve("{\"code\":50035,\"message\":\"Invalid Form Body\"}"),
    });

    await expect(
      executeRegistration({ plan, token: PLACEHOLDER.DISCORD_TOKEN, fetchImpl: fake.fetch }),
    ).rejects.toThrow(/400[\s\S]*Invalid Form Body/);
  });

  it("keeps the token out of the error it throws", async () => {
    const fake = recordingFetch({
      ok: false,
      status: 401,
      text: () => Promise.resolve("{\"message\":\"401: Unauthorized\"}"),
    });

    await expect(
      executeRegistration({ plan, token: PLACEHOLDER.DISCORD_TOKEN, fetchImpl: fake.fetch }),
    ).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining(PLACEHOLDER.DISCORD_TOKEN),
      }),
    );
  });
});

describe("runRegistration", () => {
  it("parses, validates, and sends in one step", async () => {
    const fake = recordingFetch();

    const result = await runRegistration({
      argv: ["--guild"],
      env: PLACEHOLDER,
      fetchImpl: fake.fetch,
    });

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].url).toContain(`/guilds/${PLACEHOLDER.DISCORD_GUILD_ID}/commands`);
    expect(result.sent).toBe(true);
    expect(result.plan.scope).toBe("guild");
    expect(result.registered).toEqual(result.plan.commandNames);
  });

  it("makes no request when a required variable is missing", async () => {
    // Validation has to happen before the request, not alongside it: a
    // half-configured run that still contacts Discord is the failure mode.
    const fake = recordingFetch();

    await expect(
      runRegistration({ argv: ["--global"], env: {}, fetchImpl: fake.fetch }),
    ).rejects.toThrow(/DISCORD_TOKEN/);
    expect(fake.calls).toHaveLength(0);
  });

  it("makes no request on a dry run", async () => {
    const fake = recordingFetch();

    const result = await runRegistration({
      argv: ["--global", "--dry-run"],
      env: PLACEHOLDER,
      fetchImpl: fake.fetch,
    });

    expect(fake.calls).toHaveLength(0);
    expect(result.sent).toBe(false);
    expect(result.plan.url).not.toContain("/guilds/");
  });
});
