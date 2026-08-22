import { describe, expect, it } from "vitest";
import { sortByTraffic } from "./trafficSort";

describe("sortByTraffic", () => {
	const rows = [
		{ id: "medium", total: 20 },
		{ id: "lowest", total: 0 },
		{ id: "highest", total: 50 },
	];

	it("sorts lowest and highest traffic without mutating the source order", () => {
		expect(sortByTraffic(rows, "lowest", (row) => row.total)).toEqual([
			rows[1],
			rows[0],
			rows[2],
		]);
		expect(sortByTraffic(rows, "highest", (row) => row.total)).toEqual([
			rows[2],
			rows[0],
			rows[1],
		]);
		expect(rows.map((row) => row.id)).toEqual([
			"medium",
			"lowest",
			"highest",
		]);
	});
});
