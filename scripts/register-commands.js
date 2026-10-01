#!/usr/bin/env node
/**
 * Register this repository's command definitions with one Discord application.
 *
 * ```sh
 * npm run register:non-prod    # guild-scoped, non-production application
 * npm run register:production  # global, production application
 * npm run register:dry-run     # prints the plan, contacts nothing
 * ```
 *
 * Run from plain Node, never from the Worker — which is why nothing under
 * `src/commands/` may import a `cloudflare:` module. Node 22's global `fetch`
 * is the whole HTTP client; this script has no dependencies.
 *
 * Everything worth testing lives in `scripts/lib/registration.js`. This file is
 * argument passing, printing, and an exit code.
 */
import { describeRegistrationPlan, runRegistration } from "./lib/registration.js";

try {
  const { plan, sent, registered } = await runRegistration({
    argv: process.argv.slice(2),
    env: process.env,
    fetchImpl: fetch,
  });

  if (sent) {
    console.log(`${plan.method} ${plan.url}`);
    console.log(`Registered ${registered.length} ${plan.scope} commands: ${registered.join(", ")}`);
  } else {
    console.log(describeRegistrationPlan(plan));
    console.log("Dry run: nothing was sent to Discord.");
  }
} catch (error) {
  // The message only. A stack trace adds nothing a maintainer can act on, and
  // printing the error object risks printing whatever it was carrying.
  console.error(error.message);
  process.exitCode = 1;
}
