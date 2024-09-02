/** dependencies of the client code. */

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
	}
