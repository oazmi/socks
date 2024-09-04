/** dependencies of the client code. */

import type { UncertainValue } from "../../src/plugins/deps.ts"
import type { SpeedtestStats } from "../../src/plugins/speedtest.ts"
import type { TimesyncStats } from "../../src/plugins/timesync.ts"

const
	number_formatter = (value: number) => (value.toFixed(3)),
	time_formatter = (value: number, error: number) => (`${number_formatter(value)} ± ${number_formatter(error)} ms`),
	uncertain_stats_formatter = (
		stats: Record<string, UncertainValue> | Object,
		formatter: (value: UncertainValue["value"], error: UncertainValue["error"]) => string,
	) => {
		return Object.fromEntries(
			Object.entries(stats).map(([entry, uncertain_value]) => {
				const { value, error } = uncertain_value
				return [entry, formatter(value, error)]
			})
		)
	},
	bytes_per_sec_to_mbps = (value: number) => (8 * value / (1024 ** 2)),
	speed_formatter = (value: number, error: number) => (
		`${number_formatter(bytes_per_sec_to_mbps(value))} ± ${number_formatter(bytes_per_sec_to_mbps(error))} Mbps`
	)

export const
	domainName = globalThis.location?.host as string,
	timesyncStatFormatter = (stats: TimesyncStats) => {
		return uncertain_stats_formatter(stats, time_formatter)
	},
	speedtestStatFormatter = (stats: SpeedtestStats) => {
		return uncertain_stats_formatter(stats, speed_formatter)
	}
