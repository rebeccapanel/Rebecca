import { describe, expect, it } from "vitest";

import { cleanLeastLoadSettings } from "./xrayBalancer";

describe("leastLoad settings", () => {
	it("drops empty fields and blank cost rows", () => {
		expect(
			cleanLeastLoadSettings({
				expected: 2,
				maxRTT: " 1s ",
				tolerance: 0.01,
				baselines: [" 1s ", ""],
				costs: [
					{ match: " tag ", regexp: false, value: 0.5 },
					{ match: "  ", regexp: true, value: 2 },
				],
			}),
		).toEqual({
			expected: 2,
			maxRTT: "1s",
			tolerance: 0.01,
			baselines: ["1s"],
			costs: [{ match: "tag", regexp: false, value: 0.5 }],
		});
	});

	it("returns nothing when every field is empty", () => {
		expect(cleanLeastLoadSettings({ maxRTT: " ", baselines: [""] })).toBeUndefined();
		expect(cleanLeastLoadSettings(undefined)).toBeUndefined();
	});
});
