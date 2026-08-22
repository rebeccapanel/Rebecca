import { describe, expect, it, vi } from "vitest";
import { isChunkLoadError, recoverFromStaleChunk } from "./chunkRecovery";

const createStorage = () => {
	const values = new Map<string, string>();
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
	};
};

describe("stale chunk recovery", () => {
	it("recognizes browser chunk-load errors without matching unrelated failures", () => {
		expect(
			isChunkLoadError(
				new TypeError(
					"Failed to fetch dynamically imported module: /statics/Page.old.js",
				),
			),
		).toBe(true);
		expect(isChunkLoadError(new Error("API request failed"))).toBe(false);
	});

	it("reloads once for the same stale chunk within the cooldown", () => {
		const storage = createStorage();
		const reload = vi.fn();
		const error = new TypeError(
			"Failed to fetch dynamically imported module: /statics/Page.old.js",
		);

		expect(recoverFromStaleChunk(error, { storage, reload, now: 1_000 })).toBe(
			true,
		);
		expect(recoverFromStaleChunk(error, { storage, reload, now: 2_000 })).toBe(
			false,
		);
		expect(reload).toHaveBeenCalledTimes(1);
	});

	it("allows a later deployment failure to recover again", () => {
		const storage = createStorage();
		const reload = vi.fn();
		const first = new Error(
			"Failed to fetch dynamically imported module: /statics/Page.old.js",
		);
		const next = new Error(
			"Failed to fetch dynamically imported module: /statics/Page.new.js",
		);

		recoverFromStaleChunk(first, { storage, reload, now: 1_000 });
		expect(recoverFromStaleChunk(next, { storage, reload, now: 2_000 })).toBe(
			true,
		);
		expect(reload).toHaveBeenCalledTimes(2);
	});
});
