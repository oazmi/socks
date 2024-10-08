import { applyClientPlugin, summarizeTimesyncStats } from "../../src/plugins/timesync.ts"
import { Sock } from "../../src/sock.ts"
import { urlPathname } from "./deps.ts"
import { domainName, timesyncStatFormatter } from "./deps_client.ts"

const
	socket_url = new URL(urlPathname, "ws://" + domainName!), // == "ws://${domainName}/timesync"
	client_sock = await Sock.create<ArrayBuffer>(new WebSocket(socket_url))
client_sock.socket.binaryType = "arraybuffer"

const
	dom_pre_results = document.createElement("pre"),
	printJsonToWebpage = (obj: Object) => {
		dom_pre_results.append(
			JSON.stringify(obj, undefined, "\t"),
			document.createElement("br")
		)
	}

const
	get_server_time = applyClientPlugin(client_sock, "perf"),
	run_get_server_time = () => {
		get_server_time(20).then((results) => {
			results.splice(0, 5)
			const stats = summarizeTimesyncStats(results)
			printJsonToWebpage(timesyncStatFormatter(stats))
		})
	}

const dom_button_get_server_time = document.createElement("button")
dom_button_get_server_time.textContent = "Get server timesync stats"
dom_button_get_server_time.addEventListener("click", run_get_server_time)
document.body.append(dom_button_get_server_time, document.createElement("br"), dom_pre_results)
