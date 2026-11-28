import { describe, expect, it } from "vitest";
import {
	formatVlessEnc,
	isVlessPadding,
	isVlessServerTicket,
	keepVlessEncOptions,
	openvpnStaticKey,
	parseVlessEnc,
	randomPassword,
	shadowsocksPasswordFor,
	vlessAuthLabelForMode,
} from "./generators";

const key = "a".repeat(43);

describe("generators", () => {
	it("builds Shadowsocks passwords that fit the method", () => {
		const aes128 = shadowsocksPasswordFor("2022-blake3-aes-128-gcm", "plain");
		expect(atob(aes128)).toHaveLength(16);
		expect(shadowsocksPasswordFor("2022-blake3-aes-128-gcm", aes128)).toBe(
			aes128,
		);
		const aes256 = shadowsocksPasswordFor("2022-blake3-aes-256-gcm", aes128);
		expect(atob(aes256)).toHaveLength(32);
		expect(shadowsocksPasswordFor("aes-256-gcm", "mine")).toBe("mine");
		expect(shadowsocksPasswordFor("aes-256-gcm", "")).toHaveLength(24);
		expect(randomPassword(40)).toMatch(/^[A-Za-z0-9]{40}$/);
	});

	it("writes a 2048 bit OpenVPN static key", () => {
		const lines = openvpnStaticKey().split("\n");
		expect(lines).toHaveLength(18);
		expect(lines.slice(1, 17).join("")).toMatch(/^[0-9a-f]{512}$/);
	});

	it("edits VLESS encryption options without touching keys", () => {
		const parsed = parseVlessEnc(`mlkem768x25519plus.native.600s.${key}`);
		expect(parsed).toEqual({
			mode: "native",
			ticket: "600s",
			padding: "",
			keys: key,
		});
		const custom = formatVlessEnc({
			mode: "xorpub",
			ticket: "100-500s",
			padding: "100-111-1111.75-0-111",
			keys: key,
		});
		expect(custom).toBe(
			`mlkem768x25519plus.xorpub.100-500s.100-111-1111.75-0-111.${key}`,
		);
		expect(parseVlessEnc(custom)?.padding).toBe("100-111-1111.75-0-111");
		expect(
			keepVlessEncOptions(`mlkem768x25519plus.random.600s.${key}`, custom),
		).toBe(`mlkem768x25519plus.random.100-500s.100-111-1111.75-0-111.${key}`);
		expect(parseVlessEnc("none")).toBeNull();
	});

	it("checks ticket and padding the way Xray does", () => {
		expect(isVlessServerTicket("600s")).toBe(true);
		expect(isVlessServerTicket("100-500s")).toBe(true);
		expect(isVlessServerTicket("600")).toBe(false);
		expect(isVlessPadding("100-111-1111.75-0-111.50-0-3333")).toBe(true);
		expect(isVlessPadding("50-111-1111")).toBe(false);
		expect(isVlessPadding("100-1-2")).toBe(false);
		expect(isVlessPadding("100-35-70000")).toBe(false);
		expect(vlessAuthLabelForMode("X (xorpub)", "random")).toBe("X (random)");
		expect(vlessAuthLabelForMode("X (random)", "native")).toBe("X");
	});
});
