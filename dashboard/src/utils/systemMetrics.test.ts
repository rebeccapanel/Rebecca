import { describe, expect, it } from "vitest";
import type { SystemStats } from "types/System";
import {
	getTotalNetworkHistory,
	mergeLiveSystemStats,
	recordTotalNetworkSample,
	sampleSparklineValues,
} from "./systemMetrics";

const stats = (cpu: number): SystemStats =>
	({
		cpu_usage: cpu,
		memory: { percent: 20 },
		swap: { percent: 0 },
		disk: { percent: 30 },
		incoming_bandwidth_speed: 40,
		outgoing_bandwidth_speed: 50,
		panel_cpu_percent: 5,
		panel_memory_percent: 6,
	}) as SystemStats;

describe("system metric history", () => {
	it("updates one sample per 30-second window", () => {
		const first = mergeLiveSystemStats(undefined, stats(10), 100);
		const updated = mergeLiveSystemStats(first, stats(20), 105);
		const appended = mergeLiveSystemStats(updated, stats(30), 130);

		expect(updated.cpu_history).toEqual([{ timestamp: 100, value: 20 }]);
		expect(appended.cpu_history).toEqual([
			{ timestamp: 100, value: 20 },
			{ timestamp: 130, value: 30 },
		]);
	});

	it("keeps sparklines bounded while preserving both ends", () => {
		const values = Array.from({ length: 1000 }, (_, index) => index);
		const sampled = sampleSparklineValues(values, 80);
		expect(sampled).toHaveLength(80);
		expect(sampled[0]).toBe(0);
		expect(sampled.at(-1)).toBe(999);
	});

	it("records total network samples with 2-second cadence and reads cache", () => {
		const baseTs = Math.floor(Date.now() / 1000) - 10;
		const s1 = recordTotalNetworkSample(100, 200, baseTs);
		const s2 = recordTotalNetworkSample(150, 250, baseTs + 1);
		const s3 = recordTotalNetworkSample(300, 400, baseTs + 3);

		expect(s1.at(-1)).toEqual({ timestamp: baseTs, incoming: 100, outgoing: 200 });
		expect(s2.at(-1)).toEqual({ timestamp: baseTs, incoming: 150, outgoing: 250 });
		expect(s3.slice(-2)).toEqual([
			{ timestamp: baseTs, incoming: 150, outgoing: 250 },
			{ timestamp: baseTs + 3, incoming: 300, outgoing: 400 },
		]);
		expect(getTotalNetworkHistory()).toEqual(s3);
	});
});
