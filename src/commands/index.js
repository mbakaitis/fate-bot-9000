/**
 * The command registry: one list of commands, read by both halves of the
 * template.
 *
 * The Worker dispatches interactions against this list and the command
 * registration script registers the same list with Discord. That is the whole
 * point of it being one module — two copies of a command definition drift, and
 * the failure is invisible from either side: Discord advertises a command the
 * Worker does not handle, or the Worker handles one Discord never registered.
 *
 * Because the registration script runs under plain Node, nothing in
 * `src/commands/` may import a `cloudflare:` module. A command handler receives
 * everything it needs — bindings, the execution context, the Discord REST
 * client — as arguments instead. `test/contracts/commands.test.js` enforces it.
 */
import * as echo from "./echo.js";
import * as ping from "./ping.js";
import * as slow from "./slow.js";

/**
 * A Discord application command definition, as sent to Discord's
 * bulk-overwrite registration endpoint.
 *
 * @see https://docs.discord.com/developers/interactions/application-commands#application-command-object
 * @typedef {object} CommandDefinition
 * @property {string} name Lowercase command name, as typed after the slash.
 * @property {string} description Shown in Discord's command picker.
 * @property {number} type One of `ApplicationCommandType`. Declared rather than
 *   defaulted; see `ping.js`.
 * @property {number[]} integration_types Installation contexts the command
 *   supports, from `ApplicationIntegrationType`.
 * @property {number[]} contexts Where the command can be used, from
 *   `InteractionContextType`.
 * @property {object[]} [options] Command parameters. Required options must be
 *   listed before optional ones.
 */

/**
 * Context handed to every command handler. Each field is injected rather than
 * imported so handlers stay testable without a network or a live Worker.
 *
 * @typedef {object} CommandContext
 * @property {object} env Worker bindings for the current environment.
 * @property {ExecutionContext} ctx The Worker execution context, for
 *   `waitUntil`.
 * @property {{ editOriginalResponse: Function }} rest Discord REST client from
 *   `src/discord/rest.js`.
 * @property {(milliseconds: number) => Promise<void>} sleep The runtime's
 *   timer, from `src/runtime.js`. Injected for the same reason `rest` is: a
 *   handler that reaches for a timer itself cannot be tested without waiting.
 */

/**
 * A command: its definition and the handler that answers it.
 *
 * @typedef {object} Command
 * @property {CommandDefinition} definition What gets registered with Discord.
 * @property {(interaction: object, context: CommandContext) => Response | Promise<Response>} handler
 *   Returns the interaction response.
 */

/**
 * Every command this bot serves.
 *
 * Add a command by creating `src/commands/<name>.js` exporting `definition` and
 * `handler`, then adding it to this list. That is the only wiring: the Worker
 * dispatches from this array and `npm run register:*` registers from the same
 * array, so there is no third place to update and no way for the two to
 * disagree. `docs/discord-bot.md` walks through it.
 *
 * The three commands here are worked examples, not features. A downstream
 * project is expected to delete them once it has its own — `/ping` shows an
 * immediate reply, `/echo` shows reading and validating an option, and `/slow`
 * shows deferring work that outlasts Discord's acknowledgement window.
 *
 * @type {Command[]}
 */
export const commands = [ping, echo, slow];
