/**
 * Preloaded with `node --import` so that `globalThis.fetch` throws before the
 * module under test ever runs.
 *
 * This is how `test/contracts/registration.test.js` proves a dry run contacts
 * nothing. Asserting on what the command *printed* would only show that it
 * claimed not to call Discord; replacing `fetch` with a landmine means a dry
 * run that reached the network fails the test instead of passing quietly.
 *
 * @throws {Error} On any attempt to use `fetch`.
 */
globalThis.fetch = () => {
  throw new Error("forbid-fetch: the process under test attempted a network call");
};
