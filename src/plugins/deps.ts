import { pow, sub } from "jsr:@oazmi/kitchensink@0.7.5/numericarray"
import { sum } from "jsr:@oazmi/kitchensink@0.7.5/numericmethods"

export { max } from "jsr:@oazmi/kitchensink@0.7.5/numericmethods"

export interface UncertainValue {
	value: number
	error: number
}

export const computeMean = (values: number[]): UncertainValue => {
	const
		samples = values.length,
		mean = sum(values) / samples,
		stdev = (sum(pow(sub(values, mean), 2)) / (samples - 1)) ** 0.5
	return { value: mean, error: stdev }
} 
