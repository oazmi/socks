/** utility functions.
 * 
 * @module
*/

import { console_assert, console_log, DEBUG, noop } from "./deps.ts"

/** a tree-shakable console logger.
 * it prints only when {@link DEBUG.LOG} is set to `1` (enabled).
*/
export const log = /* @__PURE__ */ DEBUG.LOG ? console_log : noop

/** a tree-shakable console asserter.
 * it asserts the condition only when {@link DEBUG.LOG} is set to `1` (enabled).
*/
export const assert = /* @__PURE__ */ DEBUG.LOG ? console_assert : noop

