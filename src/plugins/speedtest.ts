/** Speed test utility plugin for {@link Sock | **Sock**}.
 * 
 * ## Requirements
 * 
 * The following sock plugins are dependencies of this plugin, and **MUST** be applied manually onto your instance of sock:
 * - {@link applyServerPlugin | timesync server}, and {@link applyClientPlugin | timesync client}
 * 
 * The following names for {@link SockJsonMessage.kind | json message `kind`} are reserved for this plugin:
 * - `"speedtest_downlink_init"`
 * - `"speedtest_downlink_end"`
 * - `"speedtest_uplink_init"`
 * - `"speedtest_uplink_end"`
 * 
 * The following names for binary messages `kind` are reserved for this plugin:
 * - `"speedtest_downlink_data"`
 * - `"speedtest_uplink_data"`
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
import { parseTimeFn, type TimeFunction, type TimesyncFn } from "./timesync.ts"


const
	plugin_json_kind_downlink_init = "speedtest_downlink_init" as const,
	// plugin_json_kind_downlink_end = "speedtest_downlink_end" as const, // not necessary for server, but maybe needed for client
	plugin_json_kind_uplink_init = "speedtest_uplink_init" as const,
	plugin_json_kind_uplink_end = "speedtest_uplink_end" as const,
	plugin_binary_kind_downlink = "speedtest_downlink_data" as const,
	plugin_binary_kind_uplink = "speedtest_uplink_data" as const

interface InitDownlinkTest_JsonMessage extends SockJsonMessage {
	kind: typeof plugin_json_kind_downlink_init
	/** the number of bytes that shall be sent from the server to the client on this test. */
	size: number
}

interface InitUplinkTest_JsonMessage extends SockJsonMessage {
	kind: typeof plugin_json_kind_uplink_init
	/** the number of bytes that shall be sent from the client to the server on this test. */
	size: number
}

/** this is the response sent from the server to the client to affirm that it has received the uplinked data. */
interface EndUplinkTest_JsonMessage extends SockJsonMessage {
	kind: typeof plugin_json_kind_uplink_end
	/** specifies the number of bytes which were received by the server from the client, during the uplink test. */
	size: number
	/** the time when the server received the client's uplink data. */
	time: number
}

type DownlinkStat = [byteSize: number, clientTime: number]
type UplinkStat = [byteSize: number, serverTime: number]

export type DownlinkStats = [
	byteSize: number,
	deltaTime: number,
	// TODO: implement multiple tests for mean value and standard deviation stats in the future.
	// meanValues: [
	// 	byteSize: number,
	// 	deltaTime: number,
	// ], standardDeviations: [
	// 	byteSize: number,
	// 	deltaTime: number,
	// ]
]

export type UplinkStats = DownlinkStats

export type LinkStats = [DownlinkStats, UplinkStats]

export const applyServerPlugin = (sock: Sock<ArrayBuffer>, time_fn: TimeFunction = "perf"): void => {
	const get_time = parseTimeFn(time_fn)
	let original_binary_kind: string

	sock.addJsonReceiver(plugin_json_kind_downlink_init, (websock, message: InitDownlinkTest_JsonMessage) => {
		const { size } = message
		log(`begin downlink test with a client for: ${size / 1024 ** 2} number of megabytes`)
		websock.sendBinary(new ArrayBuffer(size))
	})

	sock.addJsonReceiver(plugin_json_kind_uplink_init, (websock, message: InitUplinkTest_JsonMessage) => {
		const { size } = message
		original_binary_kind = websock.getBinaryKind()!
		websock.expectBinaryKind(plugin_binary_kind_uplink)
		log(`begin uplink test twith a client for: ${size / 1024 ** 2} number of megabytes`)
	})

	sock.addBinaryReceiver(plugin_binary_kind_uplink, (websock, data) => {
		const
			time = get_time(),
			size = data.byteLength
		websock.expectBinaryKind(original_binary_kind)
		websock.sendJson({ kind: plugin_json_kind_uplink_end, time, size } satisfies EndUplinkTest_JsonMessage)
	})
}

export const applyClientPlugin = (
	sock: Sock<ArrayBuffer>,
	time_fn: TimeFunction = "perf",
	timsync_fn: TimesyncFn,
): ((downlink_size: number, uplink_size: number) => Promise<LinkStats>) => {
	const get_time = parseTimeFn(time_fn)
	let
		original_binary_kind: string,
		downlink_resolver: (value: DownlinkStat | PromiseLike<DownlinkStat>) => void,
		uplink_resolver: (value: UplinkStat | PromiseLike<UplinkStat>) => void

	sock.addBinaryReceiver(plugin_binary_kind_downlink, (websock, data) => {
		const
			client_time = get_time(),
			size = data.byteLength
		websock.expectBinaryKind(original_binary_kind)
		downlink_resolver([size, client_time])
	})

	sock.addJsonReceiver(plugin_json_kind_uplink_end, (websock, message: EndUplinkTest_JsonMessage) => {
		const { time: server_receive_time, size } = message
		uplink_resolver([size, server_receive_time])
	})

	return async (downlink_size: number, uplink_size: number): Promise<LinkStats> => {
		const
			[downlink_promise, downlink_resolve, downlink_reject] = promise_outside<DownlinkStat>(),
			[uplink_promise, uplink_resolve, uplink_reject] = promise_outside<DownlinkStat>()
		downlink_resolver = downlink_resolve
		uplink_resolver = uplink_resolve

		// perform pings to attain a server synchronized clock
		const [[
			serverUplinkOffsetTime,
			serverDownlinkOffsetTime,
			serverProcessTime,
			returnTripTime
		], timesync_stats_stdev] = await timsync_fn(10, 3)

		// perform downlink test
		original_binary_kind = sock.getBinaryKind()!
		sock.expectBinaryKind(plugin_binary_kind_downlink)
		const downlink_ct0 = get_time()
		sock.sendJson({ kind: plugin_json_kind_downlink_init, size: downlink_size } satisfies InitDownlinkTest_JsonMessage)
		const
			[downlink_size_received, downlink_ct1] = await downlink_promise,
			downlink_st0 = downlink_ct0 + serverUplinkOffsetTime,
			downlink_st1 = downlink_ct1 - serverDownlinkOffsetTime,
			effective_downlink_delta_time = (downlink_st1 - downlink_st0) - serverProcessTime // if we wanted to negate the time for pinging, we should also subtract `returnTripTime` from this, but it may potentially turn it into negative.
		sock.expectBinaryKind(original_binary_kind)

		// perform uplink test
		sock.sendJson({ kind: plugin_json_kind_uplink_init, size: uplink_size } satisfies InitUplinkTest_JsonMessage)
		const uplink_ct0 = get_time()
		sock.sendBinary(new ArrayBuffer(uplink_size))
		const
			[uplink_size_received, uplink_st1] = await uplink_promise,
			uplink_st0 = uplink_ct0 + serverUplinkOffsetTime,
			effective_uplink_delta_time = uplink_st1 - uplink_st0

		// return test result
		return [
			[downlink_size_received, effective_downlink_delta_time],
			[uplink_size_received, effective_uplink_delta_time],
		]
	}
}

