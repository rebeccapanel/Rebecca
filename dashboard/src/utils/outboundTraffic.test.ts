import { describe, expect, it } from "vitest";
import { sumOutboundTraffic } from "./outboundTraffic";

describe("sumOutboundTraffic", () => {
	it("aggregates matching default and custom-node outbounds by canonical id", () => {
		const records = [
			{
				target_id: "master",
				outbound_id: "same",
				tag: "direct",
				up: 1,
				down: 2,
			},
			{
				target_id: "node:1",
				outbound_id: "same",
				tag: "direct",
				up: 3,
				down: 4,
			},
			{
				target_id: "node:2",
				outbound_id: "same",
				tag: "custom",
				up: 5,
				down: 6,
			},
			{
				target_id: "node:3",
				outbound_id: "other",
				tag: "direct",
				up: 100,
				down: 100,
			},
		];

		expect(
			sumOutboundTraffic(records, "master", "same", "direct", true),
		).toEqual({
			up: 9,
			down: 12,
		});
		expect(
			sumOutboundTraffic(records, "node:1", "same", "direct", false),
		).toEqual({
			up: 3,
			down: 4,
		});
	});
});
