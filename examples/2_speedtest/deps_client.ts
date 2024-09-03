/** dependencies of the client code. */

import type { SpeedtestStats } from "../../src/plugins/speedtest.ts"
import type { TimesyncStats } from "../../src/plugins/timesync.ts"

const
	number_formatter = (value: number) => (value.toFixed(3)),
	bytes_per_sec_to_mbps = (value: number) => (8 * value / (1024 ** 2))

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
	speedtestStatFormatter = (stats: SpeedtestStats) => {
		const {
			downlinkSpeed: { value: dl, error: dl_stdev },
			uplinkSpeed: { value: ul, error: ul_stdev },
		} = stats
		const
			dl_mbps = number_formatter(bytes_per_sec_to_mbps(dl)),
			dl_stdev_mbps = number_formatter(bytes_per_sec_to_mbps(dl_stdev)),
			ul_mbps = number_formatter(bytes_per_sec_to_mbps(ul)),
			ul_stdev_mbps = number_formatter(bytes_per_sec_to_mbps(ul_stdev))
		return {
			downlinkSpeed: `${dl_mbps} ± ${dl_stdev_mbps} Mbps`,
			uplinkSpeed: `${ul_mbps} ± ${ul_stdev_mbps} Mbps`,
		}
	}
