import { applyClientPlugin as speedtest_applyClientPlugin } from "../../src/plugins/speedtest.ts"
import { applyClientPlugin as timesync_applyClientPlugin } from "../../src/plugins/timesync.ts"
import { Sock } from "../../src/sock.ts"
import { urlPathname } from "./deps.ts"
import { domainName, speedtestStatFormatter, timesyncStatFormatter } from "./deps_client.ts"

const
	socket_url = new URL(urlPathname, "ws://" + domainName!), // == "ws://${domainName}/speedtest"
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
	get_server_time = timesync_applyClientPlugin(client_sock, "perf"),
	get_speedtest = speedtest_applyClientPlugin(client_sock, "perf", get_server_time),
	run_get_server_time = () => {
		get_server_time(20, 5).then((stats) => {
			printJsonToWebpage(timesyncStatFormatter(stats))
		})
	},
	run_get_speedtest = () => {
		get_speedtest(4 * 1024 ** 2, 4 * 1024 ** 2).then((stats) => {
			printJsonToWebpage(speedtestStatFormatter(stats))
		})
	}

const
	dom_button_get_server_time = document.createElement("button"),
	dom_button_get_speedtest = document.createElement("button")
dom_button_get_server_time.textContent = "Get server timesync stats"
dom_button_get_server_time.addEventListener("click", run_get_server_time)
dom_button_get_speedtest.textContent = "Get speedtest stats"
dom_button_get_speedtest.addEventListener("click", run_get_speedtest)
document.body.append(dom_button_get_server_time, dom_button_get_speedtest, document.createElement("br"), dom_pre_results)
