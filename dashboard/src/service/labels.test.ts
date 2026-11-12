import { describe, expect, it } from "vitest";
import { matchesTagFilter } from "components/labels/LabelFilter";
import { normalizeTag, normalizeTags } from "service/labels";

describe("tag normalization", () => {
	it("trims, lowercases and collapses spaces", () => {
		expect(normalizeTag("  Gold   Plan ")).toBe("gold plan");
	});

	it("drops blanks and duplicates while keeping order", () => {
		expect(normalizeTags(["VIP", " vip ", "", "trial", "Trial"])).toEqual([
			"vip",
			"trial",
		]);
	});
});

describe("matchesTagFilter", () => {
	const none = { groups: [], tags: [], tagMatchAll: false };

	it("matches everything without selected tags", () => {
		expect(matchesTagFilter(undefined, none)).toBe(true);
	});

	it("matches any selected tag by default", () => {
		expect(matchesTagFilter(["a", "b"], { ...none, tags: ["b", "c"] })).toBe(
			true,
		);
		expect(matchesTagFilter(["a"], { ...none, tags: ["b", "c"] })).toBe(false);
		expect(matchesTagFilter(undefined, { ...none, tags: ["b"] })).toBe(false);
	});

	it("requires every selected tag in match-all mode", () => {
		expect(
			matchesTagFilter(["a", "b"], {
				...none,
				tags: ["a", "b"],
				tagMatchAll: true,
			}),
		).toBe(true);
		expect(
			matchesTagFilter(["a"], { ...none, tags: ["a", "b"], tagMatchAll: true }),
		).toBe(false);
	});
});
