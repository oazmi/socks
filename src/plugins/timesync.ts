/** Time synchronization utility plugin for {@link Sock | **Sock**}.
 * 
 * ## Requirements
 * 
 * The following names for {@link SockJsonMessage.kind | json message `kind`} are reserved for this plugin:
 * - `"timesync_init"`
 * - `"timesync_init_ready"`
 * - `"timesync_end"`
 * 
 * The following names for binary messages `kind` are reserved for this plugin:
 * - `"timesync_array_ct0"`
 * - `"timesync_array_ct0st0st1"`
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
 * - The *client* will hold a piece of information {@link TimesyncSingleResult.serverUplinkOffsetTime},
 *   such that when the *client* sends out a tiny piece of message at `clientTimeT0` (relative to *client's* internal clock),
 *   the *client* will expect the *server* to receive the message at `serverTimeT0 = clientTimeT0 + serverUplinkOffsetTime` (relative to the *server's* internal clock). <br>
 *   Note that {@link TimesyncSingleResult.serverUplinkOffsetTime} is not equivalent to the time it takes for the message to go from the *client* to the *server* (i.e. uplink latency).
 *   This is because that would require the *client's* and the *server's* clocks to be precisely synchronized,
 *   so that the value of {@link TimesyncSingleResult.serverUplinkOffsetTime} would equal to the time it takes for the message to go from the *client* to the *server* (i.e. uplink latency time).
 *   This is almost never the case, unless you are running the *server* and the *client* on the same device (localhost).
 * - The *client* will hold another piece of information {@link TimesyncSingleResult.serverDownlinkOffsetTime},
 *   such that when the *client* receives a tiny piece of message at `clientTimeT1` (relative to *client's* internal clock),
 *   the *client* will be able to assume that the *server* sent out the message at `serverTimeT1 = clientTimeT1 - serverDownlinkOffsetTime` (relative to the *server's* internal clock). <br>
 *   Once again, note that {@link TimesyncSingleResult.serverDownlinkOffsetTime} is not equivalent to the time it takes for the message to go from the *server* to the *client* (i.e. downlink latency).
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
import { computeMean, UncertainValue } from "./deps.ts"


const
	/** the message sent by the client to the server to initiate a timesync session. see {@link CS_Init} for the message interface. */
	CS_json_init = "timesync_init" as const,
	/** the response message sent from the server to the client specifying that it is ready for the timesync session. see {@link SC_InitReady} for the message interface. */
	SC_json_init_ready = "timesync_init_ready" as const,
	/** the uplink timestamped binary payload sent from the client to the server for the timesync.
	 * the 4x64-bit-float data it holds is: `[client_send_time: number, 0, 0, 0]`, where `client_send_time` is a 64-bit float, specifying when the client had sent its data (in its own clock time).
	*/
	CS_binary_ct0 = "timesync_array_ct0" as const,
	/** the downlink timestamped binary payload sent from the server to the client for the timesync.
	 * the 4x64-bit-float data it holds is: `[client_send_time: number, server_receive_time, server_send_time, 0]`, where:
	 * - `client_send_time` specifies when the client had initially sent its data (in its own clock time).
	 * - `server_receive_time` specifies when the server had initially received the client's package data (in its own clock time).
	 * - `server_send_time` specifies when the server sent this package back to the client (in its own clock time).
	*/
	SC_binary_ct0st0st1 = "timesync_array_ct0st0st1" as const,
	/** the message sent by the client to the server to specify end of timesync. see {@link CS_End} for the message interface. */
	CS_json_end = "timesync_end" as const

// sent by the client to the server
interface CS_Init extends SockJsonMessage {
	kind: typeof CS_json_init
	amount: number
}

interface SC_InitReady extends SockJsonMessage {
	kind: typeof SC_json_init_ready
}

// sent by the client to the server
export interface CS_End extends SockJsonMessage {
	kind: typeof CS_json_end
}

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

/** a piece of result acquired from a single time-synchronization test with the server.
 * read the docs on each field for details.
*/
export interface TimesyncSingleResult {
	/** this piece of information allows the *client* to predict the server's time when a tiny message sent out to the server. <br>
	 * if the *client* sends out a tiny message at `clientTimeT0` (relative to *client's* internal clock),
	 * then the *client* can expect its message to be received by the *server* at:
	 * `serverTimeT0 = clientTimeT0 + serverUplinkOffsetTime` (relative to the *server's* internal clock).
	*/
	serverUplinkOffsetTime: number,
	/** this piece of information allows the *client* to predict the server's time a tiny message is received from it. <br>
	 * if the *client* had received a tiny message from the server at `clientTimeT1` (relative to *client's* internal clock),
	 * then the *client* can predict that the message had been sent out by the *server* at:
	 * `serverTimeT0 = clientTimeT0 - serverDownlinkOffsetTime` (relative to the *server's* internal clock).
	*/
	serverDownlinkOffsetTime: number,
	/** this time predicsts how long it takes for the *server* to process a very tiny message after it has received it, and prepare a tiny response. */
	serverProcessTime: number,
	/** this time predicsts how long it takes for a tiny message to be sent by the *client* to the *server*,
	 * and then return back from the *server* to the *client*, skipping the {@link serverProcessTime | server processing time} in-between.
	 * this is effectively the network *ping* latency of tiny packets (which is about twice the one-way latency).
	*/
	returnTripTime: number,
}

/** a collection results acquired from multiple time-synchronization tests with the server. */
export type TimesyncResults = Array<TimesyncSingleResult>

/** the summary prepared by {@link summarizeTimesyncStats} of multiple time-synchronization tests.
 * see {@link TimesyncSingleResult} for details on what each field specifies.
*/
export interface TimesyncStats {
	serverUplinkOffsetTime: UncertainValue
	serverDownlinkOffsetTime: UncertainValue
	serverProcessTime: UncertainValue
	returnTripTime: UncertainValue
}

// TODO: DONE: remove discarding of results
// TODO: DONE: use a generator/iterator pattern to perform the next test
// TODO: DONE: the client function should return the full report rather than the average
// TODO: DONE: use an object interface for the stats instead of an array
// TODO: DONE: use the `UncertainValue` interface for summarized outputs
// TODO: DONE: use the `computeMean` function for computing means, instead of your transpose bullshietery
// TODO: DONE: update example client code and speedtest code.
// TODO: publish this library to JSR

/** TODO: update docs, since I removed the discard quantity
 * a function that returns a server-time synchronized clock for the client, along with its uncertainty parameters.
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
export type TimesyncFn = (amount: number) => Promise<TimesyncResults>

const time_array_to_timesync_result = (time_array: [ct0: number, st0: number, st1: number, ct1: number] | Float64Array): TimesyncSingleResult => {
	const
		[ct0, st0, st1, ct1] = time_array,
		serverUplinkOffsetTime = st0 - ct0,
		serverDownlinkOffsetTime = ct1 - st1,
		serverProcessTime = st1 - st0,
		returnTripTime = (ct1 - ct0) - serverProcessTime
	return { serverUplinkOffsetTime, serverDownlinkOffsetTime, serverProcessTime, returnTripTime }
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

	sock.addJsonReceiver(CS_json_init, (websock, message: CS_Init) => {
		original_binary_kind = websock.getBinaryKind()!
		websock.expectBinaryKind(CS_binary_ct0)
		log(`begin time synchronization with a client for: ${message.amount} number of tests`)
		websock.sendJson({ kind: SC_json_init_ready } satisfies SC_InitReady)
	})

	sock.addJsonReceiver(CS_json_end, (websock, message: CS_End) => {
		websock.expectBinaryKind(original_binary_kind)
	})

	sock.addBinaryReceiver(CS_binary_ct0, (websock, data) => {
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
		results: TimesyncResults = []
	let
		original_binary_kind: string,
		executeNextTest: Generator<void, void, void>

	sock.addJsonReceiver(SC_json_init_ready, (websock, message: SC_InitReady) => {
		executeNextTest.next()
	})

	sock.addBinaryReceiver(SC_binary_ct0st0st1, (websock, data) => {
		const
			ct1 = get_time(),
			time_array = new Float64Array(data, 0, 4)
		time_array[3] = ct1
		results.push(time_array_to_timesync_result(time_array))
		executeNextTest.next()
	})

	return async (amount: number): Promise<TimesyncResults> => {
		const [results_promise, results_resolve, results_reject] = promise_outside<TimesyncResults>()
		original_binary_kind = sock.getBinaryKind()!
		sock.expectBinaryKind(SC_binary_ct0st0st1)

		executeNextTest = (function* () {
			// perform the test based on the user's specified `amount` of tests
			for (let i = 0; i < amount; i++) {
				const time_array = new Float64Array([0, 0, 0, 0])
				time_array[0] = get_time() // this is `ct0`
				yield sock.sendBinary(time_array)
			}
			sock.sendJson({ kind: CS_json_end } satisfies CS_End)
			sock.expectBinaryKind(original_binary_kind)
			results_resolve(results.splice(0)) // we need to clone the results, so that we can clear up the local variable named `results` for future tests.
			return
		})()

		sock.sendJson({ kind: CS_json_init, amount } satisfies CS_Init)

		return results_promise
	}
}

export const summarizeTimesyncStats = (results: TimesyncResults): TimesyncStats => {
	const
		serverUplinkOffsetTime = computeMean(results.map((single_result) => single_result.serverUplinkOffsetTime)),
		serverDownlinkOffsetTime = computeMean(results.map((single_result) => single_result.serverDownlinkOffsetTime)),
		serverProcessTime = computeMean(results.map((single_result) => single_result.serverProcessTime)),
		returnTripTime = computeMean(results.map((single_result) => single_result.returnTripTime))
	return { serverUplinkOffsetTime, serverDownlinkOffsetTime, serverProcessTime, returnTripTime }
}
