import { describe, expect, it } from "vitest";

import { emojiShortcodes } from "./emojiShortcodes";
import {
	emojiShortcodeInsertion,
	emojiShortcodeLabel,
	replaceShortcodeToken,
	searchEmojiShortcodes,
	shortcodeTokenAt,
} from "./emojiShortcode";

describe("shortcode token", () => {
	it("finds the shortcode under the caret after whitespace", () => {
		const text = "Server 2 :us";
		expect(shortcodeTokenAt(text, text.length)).toEqual({ start: 9, end: 12, query: "us" });
	});

	it("ignores text that is not a shortcode in progress", () => {
		expect(shortcodeTokenAt("http://a.com", 12)).toBeNull();
		expect(shortcodeTokenAt("10:30", 5)).toBeNull();
		expect(shortcodeTokenAt(":", 1)).toBeNull();
		expect(shortcodeTokenAt(":us:", 4)).toBeNull();
	});
});

describe("shortcode search", () => {
	it("lists prefix matches before substring matches", () => {
		const names = searchEmojiShortcodes(emojiShortcodes, "us").map((entry) => entry[0]);
		expect(names.slice(0, 3)).toEqual(["us", "us_outlying_islands", "us_virgin_islands"]);
		expect(names.every((name) => name.includes("us"))).toBe(true);
	});

	it("caps the number of results", () => {
		expect(searchEmojiShortcodes(emojiShortcodes, "a", 5)).toHaveLength(5);
	});
});

describe("shortcode insertion", () => {
	it("writes a country flag with its country name", () => {
		const poland = emojiShortcodes.find((entry) => entry[0] === "poland");
		expect(poland).toBeDefined();
		expect(emojiShortcodeInsertion(poland!)).toBe("🇵🇱 Poland");
		const us = emojiShortcodes.find((entry) => entry[0] === "us");
		expect(emojiShortcodeLabel(us!)).toBe("United States");
	});

	it("writes other emoji with a capitalised description", () => {
		const blush = emojiShortcodes.find((entry) => entry[0] === "blush");
		expect(emojiShortcodeInsertion(blush!)).toBe("😊 Smiling face with smiling eyes");
	});

	it("replaces only the shortcode and leaves the rest of the remark intact", () => {
		const text = "Germany :de - Server";
		const token = shortcodeTokenAt(text, 11);
		expect(token).not.toBeNull();
		expect(replaceShortcodeToken(text, token!, "🇩🇪 Germany")).toEqual({
			text: "Germany 🇩🇪 Germany - Server",
			caret: 20,
		});
	});
});
