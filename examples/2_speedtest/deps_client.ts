/** dependencies of the client code. */

import type { LinkStats } from "../../src/plugins/speedtest.ts"
import type { TimesyncStats } from "../../src/plugins/timesync.ts"

const number_formatter = (value: number) => {
	return value.toFixed(3)
}

export const
	domainName = globalThis.location?.host as string,
	timesyncStatFormatter = (stats: TimesyncStats) => {
		const
			[means, stdevs] = stats,
			means_str = means.map(number_formatter),
			stdevs_str = stdevs.map(number_formatter)
		return {
			serverUplinkOffsetTime: `${means_str[0]} ± ${stdevs_str[0]} ms`,
			serverDownlinkOffsetTime: `${means_str[1]} ± ${stdevs_str[1]} ms`,
			serverProcessTime: `${means_str[2]} ± ${stdevs_str[2]} ms`,
			returnTripTime: `${means_str[3]} ± ${stdevs_str[3]} ms`,
		}
	},
	speedtestStatFormatter = (stats: LinkStats) => {
		const [
			[downlink_size, downlink_delta_time],
			[uplink_size, uplink_delta_time],
		] = stats,
			downlink_mbps = (8 * downlink_size / (1024 ** 2)) / (downlink_delta_time * 10 ** (-3)),
			uplink_mbps = (8 * uplink_size / (1024 ** 2)) / (uplink_delta_time * 10 ** (-3))
		return {
			downlinkSpeed: `${number_formatter(downlink_mbps)} Mbps`,
			uplinkSpeed: `${number_formatter(uplink_mbps)} Mbps`,
		}
	}
