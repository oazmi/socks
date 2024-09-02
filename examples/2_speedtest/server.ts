/** a file-based http server, with a time synchronization websocket.
 * to run the example:
 * - transpile and bundle `./client.ts` to `./client.js`
 * - make sure you are in the root of this repo. (current working directory = root of repo)
 * - run the server by executing the following on your terminal:
 *   ```shell
 *   deno run -A "./examples/2_speedtest/server.ts"
 *   ```
 * - now, identify your server's ip or domain name, then in the client browser navigate to `http://server_ip:8000/`.
*/

import { route, serveDir, serveFile, type Route } from "jsr:@std/http@1.0.3"
import { applyServerPlugin as timesync_applyServerPlugin} from "../../src/plugins/timesync.ts"
import { applyServerPlugin as speedtest_applyServerPlugin} from "../../src/plugins/speedtest.ts"
import { Sock } from "../../src/sock.ts"
import { urlPathname } from "./deps.ts"
import { pathResolve, port, rootDir } from "./deps_server.ts"


const routes: Route[] = [
	{
		pattern: new URLPattern({ pathname: urlPathname, protocol: "http" }),
		handler: async (request: Request) => {
			console.log(`[ws-get] "${urlPathname}"`)
			// the client must use the websocket protocol, which is "ws://".
			// if the client tries to connect with an invalid protocol, such as "http://",
			// then let the client know and refuse their request.
			if (request.headers.get("upgrade") != "websocket") {
				return new Response(`please use websocket protocol only! ("ws://example.com/${urlPathname}")`, { status: 400 })
			}
			const { socket, response } = Deno.upgradeWebSocket(request)

			socket.binaryType = "arraybuffer"
			socket.addEventListener("open", () => { console.log("[ws:speedtest] client connected") })
			socket.onclose = () => { console.log("[ws:speedtest] client disconnected") }
			socket.onerror = (event) => { console.log("[ws:speedtest] socket error:", event) }
			// we must NOT await for the creation/establishment of an open websocket first.
			// instead we MUST send our `response` to the client first so that the client THEN proceeds to wanting to establish a web socket connection.
			Sock.create<ArrayBuffer>(socket).then((server_sock) => {
				timesync_applyServerPlugin(server_sock, "perf")
				speedtest_applyServerPlugin(server_sock, "perf")
			})

			return response
		}
	},
	{
		pattern: new URLPattern({ pathname: "/" }),
		handler: (request: Request) => {
			console.log(`[http-get] "/index.html"`)
			return serveFile(request, pathResolve(rootDir, "./index.html"))
		}
	},
	{
		pattern: new URLPattern({ pathname: "/*" }),
		handler: (request: Request) => {
			console.log(`[http-get] "/${request.url}"`)
			return serveDir(request, { fsRoot: pathResolve(rootDir) })
		}
	},
]

const default_route = (_req: Request) => {
	return new Response("requested http not found", { status: 404 })
}

const webserver = Deno.serve({ port }, route(routes, default_route))
console.log(`WebServer is running on "https://localhost:${port}"`)
console.log(`WebSocket is running on "ws://localhost:${port}/speedtest"`)

