import { describe, expect, it } from "vitest";

import { isMatcherPrefix, matcherOptions } from "./xrayRouting";

const values = (kind: Parameters<typeof matcherOptions>[0]) =>
	matcherOptions(kind).map((option) => option.value);

describe("matcher options", () => {
	it("offers the documented domain prefixes and geosite categories", () => {
		expect(values("domain")).toEqual(
			expect.arrayContaining([
				"domain:",
				"full:",
				"keyword:",
				"regexp:",
				"geosite:",
				"ext:",
				"geosite:google",
				"geosite:category-ads",
			]),
		);
	});

	it("offers geoip codes with their inverse form in the ip field", () => {
		expect(values("ip")).toEqual(
			expect.arrayContaining(["geoip:", "!geoip:", "ext:", "0.0.0.0/0", "::/0", "geoip:cn", "!geoip:private"]),
		);
		expect(values("ip")).not.toContain("geosite:google");
	});

	it("offers the process selectors", () => {
		expect(values("process")).toEqual(["self/", "xray/"]);
	});

	it("detects prefixes so picking one keeps the input open", () => {
		expect(isMatcherPrefix("geosite:")).toBe(true);
		expect(isMatcherPrefix("domain:")).toBe(true);
		expect(isMatcherPrefix("geosite:google")).toBe(false);
		expect(isMatcherPrefix("self/")).toBe(false);
		expect(isMatcherPrefix("0.0.0.0/0")).toBe(false);
	});
});
