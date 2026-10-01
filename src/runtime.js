/**
 * Ambient runtime capabilities, bound once at the composition root.
 *
 * `src/index.js` binds these and passes them down, so nothing under
 * `src/commands/` reaches for a global. That is the same rule `rest` follows:
 * anything a handler cannot fake is something a test cannot control, and a
 * command whose timing is a global is a command whose tests have to wait.
 */

/**
 * Resolve after a delay.
 *
 * This is the only timer in the template, which is why it is one line in its
 * own module: every command test injects a fake in its place, and this function
 * is exercised directly at zero milliseconds.
 *
 * @param {number} milliseconds How long to wait.
 * @returns {Promise<void>}
 */
export const sleep = (milliseconds) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
