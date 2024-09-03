/** Speed test utility plugin for {@link Sock | **Sock**}.
 * 
 * ## Requirements
 * 
 * The following sock plugins are dependencies of this plugin, and **MUST** be applied manually onto your instance of sock:
 * - {@link timesync_applyServerPlugin | timesync server}, and {@link timesync_applyClientPlugin | timesync client}
 * 
 * The following names for {@link SockJsonMessage.kind | json message `kind`} are reserved for this plugin:
 * - `"speedtest_init"`
 * - `"speedtest_init_ready"`
 * - `"speedtest_next_down"`
 * - `"speedtest_stat_up"`
 * - `"speedtest_end"`
 * 
 * The following names for binary messages `kind` are reserved for this plugin:
 * - `"speedtest_binary_data_down"`
 * - `"speedtest_binary_data_up"`
 * 
 * ## Algorithm
 * // TODO: it's really nothing sophisticated, besides ping-pongging messages,
 *          and then computing delta-time in terms of server-synchronized time, so as to compute the predicted
 *          delta-time of a single package, instead of relying on client time, which would give you the delta-time
 *          for two or more meassages (one large (binary data), and the other being tiny (small json packet)).
 * 
 * @module
*/

import { promise_outside } from "../deps.ts"
import { log } from "../funcdefs.ts"
import type { Sock } from "../sock.ts"
import type { SockJsonMessage } from "../typedefs.ts"
import { computeMean, max, type UncertainValue } from "./deps.ts"
import {
	parseTimeFn,
	type TimeFunction,
	type applyClientPlugin as timesync_applyClientPlugin,
	type applyServerPlugin as timesync_applyServerPlugin,
	type TimesyncFn
} from "./timesync.ts"


const
	/** the message sent by the client to the server to initiate a speedtest session. see {@link CS_Init} for the message interface. */
	CS_json_init = "speedtest_init" as const,
	/** the response message sent from the server to the client specifying that it is ready for the speedtest session. see {@link SC_InitReady} for the message interface. */
	SC_json_init_ready = "speedtest_init_ready" as const,
	/** the request sent by the client to the server for beginning a downlink test next. see {@link CS_NextDown} for the message interface. */
	CS_json_next_down = "speedtest_next_down" as const,
	/** the downlink binary data sent from the server to the client for the speedtest.
	 * interface of the binary data: `[sent_time: number, ...payload]`, where `sent_time` is a 64-bit float, specifying when the server had sent its data (in its own clock time).
	*/
	SC_binary_data_down = "speedtest_binary_data_down" as const,
	/** the request sent by the client to the server to get ready for an uplink test next.
	 * TODO: no need for `CS_json_next_up`, since the server can only expect one kind of binary kind in this plugin.
	 * since we are assuimg that the same client will not be talking to the server via some other binary information during this test,
	 * it would be safe to leave the server's expected binary kind to `CS_binary_data_up` throughout the test.
	*/
	// CS_json_next_up = "speedtest_next_up" as const,
	/** the uplink binary data sent from the client to the server for the speedtest.
	 * interface of the binary data: `[sent_time: number, ...payload]`, where `sent_time` is a 64-bit float, specifying when the client had sent its data (in its own clock time).
	*/
	CS_binary_data_up = "speedtest_binary_data_up" as const,
	/** the timing stats of the uplink test are sent by the server to the client. see {@link CS_StatUp} for the message interface. */
	SC_json_stat_up = "speedtest_stat_up" as const,
	/** the message sent by the client to the server to specify end of speedtesting. see {@link SC_InitReady} for the message interface. */
	CS_json_end = "speedtest_end" as const


// TODO: in the future, if the server accepts the speedtest, and while conducting it,
// it realizes that the client lied about the amount of data that will be transferred,
// then it should negate the test gracefully and send a "bad client" response, before terminating the websocket.
interface CS_Init extends SockJsonMessage {
	kind: typeof CS_json_init
	numberOfTests: number
	totalDownlinkSize: number
	totalUplinkSize: number
}

interface SC_InitReady extends SockJsonMessage {
	kind: typeof SC_json_init_ready
}

interface CS_NextDown extends SockJsonMessage {
	kind: typeof CS_json_next_down
	/** the number of bytes that shall be sent from the server to the client in this test. */
	size: number
}

interface SC_StatUp extends SockJsonMessage {
	kind: typeof SC_json_stat_up
	/** the amount of bytes received by the server. */
	size: number
	/** timing information, will be used by the client to figure out how much time had passed for the upload to complete. */
	time: [client_sent_time: number, server_receive_time: number]
}

interface CS_End extends SockJsonMessage {
	kind: typeof CS_json_end
}

export type SpeedtestSingleTest = [mode: "down" | "up", size: number, pattern?: undefined | null | {}]
export type SpeedtestPattern = Array<SpeedtestSingleTest>
export interface SpeedtestSingleResult {
	mode: "down" | "up"
	size: number
	time: number
}
export type SpeedtestResults = Array<SpeedtestSingleResult>

export interface SpeedtestStats {
	uplinkSpeed: UncertainValue
	downlinkSpeed: UncertainValue
}

export const applyServerPlugin = (sock: Sock<ArrayBuffer>, time_fn: TimeFunction = "perf"): void => {
	const get_time = parseTimeFn(time_fn)
	let original_binary_kind: string

	sock.addJsonReceiver(CS_json_init, (websock, message: CS_Init) => {
		const { numberOfTests, totalDownlinkSize, totalUplinkSize } = message
		log(`client wishes to initiate "${numberOfTests}" speedtests\n\ttotal downlink size requested: ${totalDownlinkSize / 1024 ** 2} mb\n\ttotal uplink size requested: ${totalUplinkSize / 1024 ** 2} mb`)
		original_binary_kind = websock.getBinaryKind()!
		websock.expectBinaryKind(CS_binary_data_up)
		websock.sendJson({ kind: SC_json_init_ready } satisfies SC_InitReady)
	})

	sock.addJsonReceiver(CS_json_next_down, (websock, message: CS_NextDown) => {
		const size = max(8, message.size) // there should be at least 8 bytes for us to timestamp the binary message
		log(`begin downlink test with a client for: ${size / 1024 ** 2} mb`)
		const
			buf = new Uint8Array(size),
			timestamp_buf = new Uint8Array(new Float64Array([get_time(),]).buffer) // unfortunately, `timestamp_buf` has to be converted into a `Uint8Array`, because setting the buffer alone will fill a single byte instead of filling 8 bytes.
		buf.set(timestamp_buf, 0)
		websock.sendBinary(buf)
	})

	sock.addJsonReceiver(CS_json_end, (websock, message: CS_End) => {
		websock.expectBinaryKind(original_binary_kind)
		log(`end of speedtest with client`)
	})

	sock.addBinaryReceiver(CS_binary_data_up, (websock, data) => {
		const
			server_receive_time = get_time(),
			size = data.byteLength,
			client_sent_time = (new Float64Array(data, 0, 1))[0] // convert the first 8 bytes to a 64-bit float to get the client's timestamp.
		websock.sendJson({ kind: SC_json_stat_up, size, time: [client_sent_time, server_receive_time] } satisfies SC_StatUp)
	})
}

// TODO: implement the ability to stream results as they come, by providing the user with an optional callback parameter to have the results streamed/sent there as they come.
// TODO: remove the discard parameter used in `timsync_fn`, and discard from the full results yourself.
export const applyClientPlugin = (
	sock: Sock<ArrayBuffer>,
	time_fn: TimeFunction = "perf",
	timsync_fn: TimesyncFn,
): ((test_pattern: SpeedtestPattern) => Promise<SpeedtestResults>) => {
	const get_time = parseTimeFn(time_fn)
	let
		original_binary_kind: string,
		executeNextTest: Generator<void, void, void>,
		serverUplinkOffsetTime: number,
		serverDownlinkOffsetTime: number,
		results: SpeedtestResults = []

	sock.addJsonReceiver(SC_json_init_ready, (websock, message: SC_InitReady) => {
		executeNextTest.next()
	})

	sock.addJsonReceiver(SC_json_stat_up, (websock, message: SC_StatUp) => {
		const
			{ size, time: [client_sent_time, server_receive_time] } = message,
			sent_time_wrt_server = client_sent_time + serverUplinkOffsetTime,
			delta_time = server_receive_time - sent_time_wrt_server
		results.push({ mode: "up", size, time: delta_time })
		executeNextTest.next()
	})

	sock.addBinaryReceiver(SC_binary_data_down, (websock, data) => {
		const
			client_receive_time = get_time(),
			size = data.byteLength,
			server_sent_time = (new Float64Array(data, 0, 1))[0], // convert the first 8 bytes to a 64-bit float to get the server's timestamp.
			receive_time_wrt_server = client_receive_time - serverDownlinkOffsetTime,
			delta_time = receive_time_wrt_server - server_sent_time
		results.push({ mode: "down", size, time: delta_time })
		executeNextTest.next()
	})

	return async (test_pattern: SpeedtestPattern): Promise<SpeedtestResults> => {
		// perform pings to attain a server synchronized clock
		[[serverUplinkOffsetTime, serverDownlinkOffsetTime]] = await timsync_fn(10, 3)

		results = []
		const [results_promise, results_resolver, results_rejector] = promise_outside<SpeedtestResults>()
		sock.expectBinaryKind(SC_binary_data_down)

		executeNextTest = (function* () {
			// perform the test based on the user's specified `test_pattern`
			for (const [mode, size, config = {}] of test_pattern) {
				if (mode === "down") {
					yield sock.sendJson({ kind: CS_json_next_down, size } satisfies CS_NextDown)
				} else if (mode === "up") {
					const
						buf = new Uint8Array(size),
						timestamp_buf = new Uint8Array(new Float64Array([get_time(),]).buffer) // unfortunately, `timestamp_buf` has to be converted into a `Uint8Array`, because setting the buffer alone will fill a single byte instead of filling 8 bytes.
					buf.set(timestamp_buf, 0)
					yield sock.sendBinary(buf)
				}
			}
			sock.expectBinaryKind(original_binary_kind)
			results_resolver(results)
			return
		})()

		sock.sendJson({
			kind: CS_json_init,
			numberOfTests: test_pattern.length,
			totalDownlinkSize: 9000, // TODO: will implement later. right now it's a random number.
			totalUplinkSize: 123, // TODO: will implement later. right now it's a random number.
		} satisfies CS_Init)

		return results_promise
	}
}

export const summarizeSpeedtestStats = (results: SpeedtestResults): SpeedtestStats => {
	const
		downlink_speeds = results
			.filter((single_result) => single_result.mode === "down")
			.map(({ size, time }) => size / (time * 10 ** (-3))),
		uplink_results = results
			.filter((single_result) => single_result.mode === "up")
			.map(({ size, time }) => size / (time * 10 ** (-3)))
	return {
		downlinkSpeed: computeMean(downlink_speeds),
		uplinkSpeed: computeMean(uplink_results),
	}
}
