/** dependencies of the server code. */

import { resolve as pathResolve } from "jsr:@std/path@1.0.2"

export const
	rootDir = pathResolve(Deno.cwd(), "./examples/2_speedtest/"),
	port = 8000

export { pathResolve }
