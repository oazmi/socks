/** Time synchronization utility plugin for {@link Sock | **Sock**}.
 * 
 * ## Requirements
 * 
 * The following names for {@link SockJsonMessage.kind | json message `kind`} are reserved for this plugin:
 * - `"timesync_init"`
 * - `"timesync_end"`
 * 
 * The following names for binary messages `kind` are reserved for this plugin:
 * - `"timesync_array"`
 * 
 * 
 * ## Algorithm Overview
 * 
 * ### Definitions
 * - Device 1 is called *server*.
 * - Device 2 is called *client*.
 * - Time is measured as a float/number in the same scale by the client and server (usually milliseconds).
 * 
 * 
 * ### Problem Statement
 * By the end, we wish for the *client* to inherit the *server's* time in the following sense:
 * - The *client* will hold a piece of information `serverUplinkOffsetTime`,
 *   such that when the *client* sends out a tiny piece of message at `clientTimeT0` (relative to *client's* internal clock),
 *   the *client* will expect the *server* to receive the message at `serverTimeT0 = clientTimeT0 + serverUplinkOffsetTime` (relative to the *server's* internal clock). <br>
 *   Note that `serverUplinkOffsetTime` is not equivalent to the time it takes for the message to go from the *client* to the *server* (i.e. uplink latency).
 *   This is because that would require the *client's* and the *server's* clocks to be precisely synchronized,
 *   so that the value of `serverUplinkOffsetTime` would equal to the time it takes for the message to go from the *client* to the *server* (i.e. uplink latency time).
 *   This is almost never the case, unless you are running the *server* and the *client* on the same device (localhost).
 * - The *client* will hold another piece of information `serverDownlinkOffsetTime`,
 *   such that when the *client* receives a tiny piece of message at `clientTimeT1` (relative to *client's* internal clock),
 *   the *client* will be able to assume that the *server* sent out the message at `serverTimeT1 = clientTimeT1 - serverDownlinkOffsetTime` (relative to the *server's* internal clock). <br>
 *   Once again, note that `serverDownlinkOffsetTime` is not equivalent to the time it takes for the message to go from the *server* to the *client* (i.e. downlink latency).
 * 
 * ### Algorithm/Technique
 * 
 * ```txt
 * |    C="client", S="server"
 * |    Real time increases along arrow path
 * |    
 * |    ┌─ct0            ┌─st0
 * |    C───────────────►S
 * |                     │
 * |                     ▼
 * |    C◄───────────────S
 * |    └─ct1            └─st1
 * ```
 * 
 * | Step | Action                                                                           | `timeArray`            |
 * |:----:|----------------------------------------------------------------------------------|------------------------|
 * |  1   | *C* prepares an binary `Float64Array` `timeArray` of size `4`                    | `[0  , 0  , 0  , 0  ]` |
 * |  2   | *C* pushes its own time, `ct0`, in `timeArray`, then immediately sends it to *S* | `[ct0, 0  , 0  , 0  ]` |
 * |  3   | *S* receives the `timeArray` and immediately pushes its own time `st0` into it   | `[ct0, st0, 0  , 0  ]` |
 * |  4   | *S* pushes its own time `st1` into `timeArray`, then immediately sends it to *C* | `[ct0, st0, st1, 0  ]` |
 * |  5   | *C* receives the `timeArray` and immediately pushes its own time `ct1` into it   | `[ct0, st0, st1, ct1]` |
 * 
 * Now that the *client* has 4 pieces of timing information: `ct0`, `st0`, `st1`, and `ct1`, it can compute 4 quantities:
 * - `serverUplinkOffsetTime = st0 - ct0`
 * - `serverDownlinkOffsetTime = ct1 - st1`
 * - `serverProcessTime = st1 - st0`
 * - `returnTripTime = (ct1 - ct0) - serverProcessTime`
 * 
 * Since just sampling once is not going to give us reliable results, it would be a good idea to sample this test `N` times,
 * discard the first `K` results (where network speed will probably be slower), then average the outcomes of the `N - K` tests. <br>
 * So to do that, our client will establish the `N` test requests by sending the following json packet to the server:
 * 
 * - `client -> server`: json: `{ kind: "timesync_init", amount: N }`
 * - `server`: `sock.expectBinaryKind("timesync_array")`
 * - Begin repeat `N` times:
 *   - Perform a single test, as specified in the table above.
 * - End repeat
 * - `client`: gather results, discard the first `K` results, then find average + standard-deviation of the results.
 * 
 * @module
*/

import { promise_outside } from "../deps.ts"
import { log } from "../funcdefs.ts"
import type { Sock } from "../sock.ts"
import type { SockJsonMessage } from "../typedefs.ts"
import { pow, sub, sum, transpose2D } from "./deps.ts"


const
	plugin_json_kind_init = "timesync_init" as const,
	plugin_json_kind_end = "timesync_end" as const,
	plugin_binary_kind = "timesync_array" as const

/** the time function of the device, to monitor its own time.
 * - `"date"` is equivalent to the built-in `Date.now` function
 * - `"perf"` is equivalent to the built-in `performance.now` function
 * - alternatively, you could provide your own time function
 * 
 * note that the *server* and *client* **must** use the same time scale (milliseconds for instance). <br>
 * for example, it is completely acceptable for the client to use `performance.now` (i.e. `"perf"`),
 * while the server uses `Date.now` (i.e. `"date"`).
 * this is because both functions return the time in milliseconds time scale, albeit being on a different offset.
*/
export type TimeFunction = "date" | "perf" | (() => number)

// sent by the client to the server
export interface InitTimesyncTests_JsonMessage extends SockJsonMessage {
	kind: typeof plugin_json_kind_init
	amount: number
}

// sent by the client to the server
export interface EndTimesyncTests_JsonMessage extends SockJsonMessage {
	kind: typeof plugin_json_kind_end
}

type TimesyncStat = [
	serverUplinkOffsetTime: number,
	serverDownlinkOffsetTime: number,
	serverProcessTime: number,
	returnTripTime: number,
]

export type TimesyncStats = [
	meanValues: TimesyncStat,
	standardDeviations: TimesyncStat,
]

/** a function that returns a server-time synchronized clock for the client, along with its uncertainty parameters.
 * 
 * the higher `amount` of tests that you perform the more precise results you will get, so long as it does not exceed a large quantity,
 * like `50`, which will probably cause your network adapters (whether internal, external, or on the server side) to throttle the speed
 * at which your messages are sent at.
 * `10` to `20` usually gives very precise and accurate results.
 * 
 * moreover, discarding the first few results is also a good idea, since network routing is initially slower,
 * but becomes faster the more the socket is utilized.
 * I recommend discarding the first `20%` to `30%` number of results.
 * so pick like `3` discards for `10` tests, and `5` discards for `20` tests.
*/
export type TimesyncFn = (amount: number, discard?: number) => Promise<TimesyncStats>

const time_array_to_stat = (time_array: [ct0: number, st0: number, st1: number, ct1: number] | Float64Array) => {
	const
		[ct0, st0, st1, ct1] = time_array,
		serverUplinkOffsetTime = st0 - ct0,
		serverDownlinkOffsetTime = ct1 - st1,
		serverProcessTime = st1 - st0,
		returnTripTime = (ct1 - ct0) - serverProcessTime
	return [serverUplinkOffsetTime, serverDownlinkOffsetTime, serverProcessTime, returnTripTime]
}

const time_arrays_to_stats = (time_arrays: Array<Float64Array>): TimesyncStats => {
	const
		samples = time_arrays.length,
		stats: Array<number[]> = transpose2D(time_arrays.map(time_array_to_stat)),
		mean_stats = stats.map((entry_samples: number[]) => (sum(entry_samples) / samples)),
		stdev_stats = stats.map((entry_samples, entry_index) => {
			const mean = mean_stats[entry_index]
			return (sum(pow(sub(entry_samples, mean), 2)) / (samples - 1)) ** (0.5)
		})
	return [mean_stats as any, stdev_stats as any]
}

export const parseTimeFn = (time_fn: TimeFunction): (() => number) => {
	return time_fn === "date"
		? Date.now
		: time_fn === "perf"
			? (() => performance.now())
			: time_fn
}

export const applyServerPlugin = (sock: Sock<ArrayBuffer>, time_fn: TimeFunction = "perf"): void => {
	const get_time = parseTimeFn(time_fn)
	let original_binary_kind: string

	sock.addJsonReceiver(plugin_json_kind_init, (websock, message: InitTimesyncTests_JsonMessage) => {
		log(`begin time synchronization with a client for: ${message.amount} number of tests`)
		original_binary_kind = websock.getBinaryKind()!
		websock.expectBinaryKind(plugin_binary_kind)
		// const { amount } = message
	})

	sock.addJsonReceiver(plugin_json_kind_end, (websock, message: EndTimesyncTests_JsonMessage) => {
		websock.expectBinaryKind(original_binary_kind)
	})

	sock.addBinaryReceiver(plugin_binary_kind, (websock, data) => {
		const
			st0 = get_time(),
			time_array = new Float64Array(data, 0, 4)
		// `time_array[0]` is `ct0`
		time_array[1] = st0
		time_array[2] = get_time() // this is `st1`
		websock.sendBinary(time_array)
	})
}

export const applyClientPlugin = (
	sock: Sock<ArrayBuffer>,
	time_fn: TimeFunction = "perf"
): TimesyncFn => {
	const
		get_time = parseTimeFn(time_fn),
		results: Array<Float64Array> = []
	let
		original_binary_kind: string,
		tests_remaining = 0,
		test_resolver: (value: Array<Float64Array> | PromiseLike<Array<Float64Array>>) => void

	const send_time_array = () => {
		const time_array = new Float64Array([0, 0, 0, 0])
		time_array[0] = get_time() // this is `ct0`
		sock.sendBinary(time_array)
	}

	sock.addBinaryReceiver(plugin_binary_kind, (websock, data) => {
		const
			ct1 = get_time(),
			time_array = new Float64Array(data, 0, 4)
		time_array[3] = ct1
		results.push(time_array)
		if ((tests_remaining -= 1) > 0) {
			send_time_array()
		} else {
			sock.sendJson({ kind: plugin_json_kind_end } satisfies EndTimesyncTests_JsonMessage)
			test_resolver(results.splice(0)) // we need to clone the results, so that we can clear up the local variable named `results` for future tests.
		}
	})

	return async (amount: number, discard: number = 0) => {
		const [test_promise, test_resolve, test_reject] = promise_outside<Array<Float64Array>>()
		test_resolver = test_resolve
		original_binary_kind = sock.getBinaryKind()!
		tests_remaining = amount
		sock.expectBinaryKind(plugin_binary_kind)
		sock.sendJson({ kind: plugin_json_kind_init, amount } satisfies InitTimesyncTests_JsonMessage)
		send_time_array()
		const test_results = await test_promise
		sock.expectBinaryKind(original_binary_kind)
		test_results.splice(0, discard)
		return time_arrays_to_stats(test_results)
	}
}

