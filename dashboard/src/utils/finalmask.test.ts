import { describe, expect, it } from "vitest";

import {
	finalMaskValidationError,
	getFinalMaskCapabilities,
	hostFinalMaskValue,
	sanitizeFinalMask,
} from "./finalmask";

describe("FinalMask host compatibility", () => {
	it.each([
		"openvpn",
		"wireguard",
		"pptp",
		"l2tp",
		"ikev2",
		"anyconnect",
		"http",
		"socks",
	])("hides FinalMask for %s inbounds", (protocol) => {
		expect(
			getFinalMaskCapabilities({ protocol, network: "tcp" }).supported,
		).toBe(false);
	});

	it("selects the socket family used by the inbound transport", () => {
		expect(
			getFinalMaskCapabilities({ protocol: "vless", network: "raw" }),
		).toMatchObject({
			tcp: true,
			udp: false,
			quic: false,
			mux: true,
		});
		expect(
			getFinalMaskCapabilities({ protocol: "vmess", network: "mkcp" }),
		).toMatchObject({
			tcp: false,
			udp: true,
			quic: false,
		});
		expect(
			getFinalMaskCapabilities({
				protocol: "hysteria",
				network: "hysteria",
			}),
		).toMatchObject({
			tcp: false,
			udp: true,
			quic: true,
			mux: true,
		});
	});

	it("uses UDP and QUIC only for TLS XHTTP with an exclusive h3 ALPN", () => {
		expect(
			getFinalMaskCapabilities({
				protocol: "vless",
				network: "xhttp",
				security: "tls",
				alpn: "h3",
			}),
		).toMatchObject({
			tcp: false,
			udp: true,
			quic: true,
			mux: true,
			allowNegotiatedBrutal: false,
		});
		expect(
			getFinalMaskCapabilities({
				protocol: "vless",
				network: "xhttp",
				security: "tls",
				alpn: "h3,h2",
			}),
		).toMatchObject({ tcp: true, udp: false, quic: false });
		expect(
			getFinalMaskCapabilities({
				protocol: "vless",
				network: "xhttp",
				security: "reality",
				alpn: "h3",
			}),
		).toMatchObject({ tcp: true, udp: false, quic: false });
	});

	it("offers mKCP legacy on UDP and hides XDNS only on QUIC", () => {
		const kcp = getFinalMaskCapabilities({
			protocol: "vless",
			network: "kcp",
		});
		const hysteria = getFinalMaskCapabilities({
			protocol: "hysteria",
			network: "hysteria",
		});
		expect(kcp.udpTypes).toEqual(
			expect.arrayContaining(["mkcp-legacy", "xdns"]),
		);
		expect(hysteria.udpTypes).toContain("mkcp-legacy");
		expect(hysteria.udpTypes).not.toContain("xdns");
		expect(hysteria.allowNegotiatedBrutal).toBe(true);
	});

	it("rejects removed transports and classic Mux conflicts", () => {
		expect(
			getFinalMaskCapabilities({ protocol: "vless", network: "quic" })
				.supported,
		).toBe(false);
		expect(
			getFinalMaskCapabilities({ protocol: "hysteria", network: "raw" })
				.supported,
		).toBe(false);
		expect(
			getFinalMaskCapabilities({
				protocol: "vless",
				network: "raw",
				flow: "xtls-rprx-vision",
			}).mux,
		).toBe(false);
	});

	it("shows both families for Shadowsocks native UDP plus TCP", () => {
		expect(
			getFinalMaskCapabilities({
				protocol: "shadowsocks",
				network: "raw",
			}),
		).toMatchObject({ tcp: true, udp: false, mux: true });
		expect(
			getFinalMaskCapabilities({
				protocol: "shadowsocks",
				network: "raw",
				proxyNetwork: "tcp,udp",
			}),
		).toMatchObject({ tcp: true, udp: true, mux: true });
		expect(
			getFinalMaskCapabilities({
				protocol: "shadowsocks",
				network: "raw",
				proxyNetwork: "udp",
			}),
		).toMatchObject({ tcp: false, udp: true, mux: false });
		expect(
			getFinalMaskCapabilities({
				protocol: "shadowsocks",
				network: "kcp",
				proxyNetwork: "udp",
			}),
		).toMatchObject({
			tcp: false,
			udp: true,
			quic: false,
			udpTypes: expect.arrayContaining(["mkcp-legacy", "xdns"]),
		});
	});
});

describe("FinalMask host values", () => {
	it("converts legacy Fragment and Noise settings once", () => {
		expect(
			hostFinalMaskValue(
				null,
				"3-5,10-20,tlshello,3-6",
				"rand:1-8,5-10&hex:deadbeef,0",
			),
		).toEqual({
			tcp: [
				{
					type: "fragment",
					settings: {
						packets: "tlshello",
						lengths: ["3-5"],
						delays: ["10-20"],
						maxSplit: "3-6",
					},
				},
			],
			udp: [
				{
					type: "noise",
					settings: {
						noise: [
							{ rand: "1-8", delay: "5-10" },
							{ type: "hex", packet: "deadbeef", delay: "0" },
						],
					},
				},
			],
		});
	});

	it("drops hidden layers while preserving compatible settings and order", () => {
		const value = {
			tcp: [{ type: "fragment", settings: { lengths: ["1-2"] } }],
			udp: [
				{ type: "noise", settings: { reset: "30-60", future: true } },
				{ type: "mkcp-legacy", settings: { header: "dns" } },
				{ type: "sudoku", settings: { password: "secret" } },
			],
			quicParams: { congestion: "bbr" },
		};
		expect(
			sanitizeFinalMask(
				value,
				getFinalMaskCapabilities({
					protocol: "hysteria",
					network: "hysteria",
				}),
			),
		).toEqual({
			udp: [
				{ type: "noise", settings: { reset: "30-60", future: true } },
				{ type: "mkcp-legacy", settings: { header: "dns" } },
				{ type: "sudoku", settings: { password: "secret" } },
			],
			quicParams: { congestion: "bbr" },
		});
	});

	it("normalizes Xray's constrained layer positions and UDP-hop conflict", () => {
		const capabilities = getFinalMaskCapabilities({
			protocol: "hysteria",
			network: "hysteria",
		});
		expect(
			sanitizeFinalMask(
				{
					udp: [
						{ type: "sudoku" },
						{ type: "realm" },
						{ type: "xicmp" },
						{ type: "noise" },
					],
					quicParams: {
						congestion: "bbr",
						udpHop: { ports: "20000-30000" },
					},
				},
				capabilities,
			),
		).toEqual({
			udp: [{ type: "realm" }, { type: "noise" }, { type: "sudoku" }],
			quicParams: { congestion: "bbr" },
		});
	});

	it("drops transport-specific fields when their transport is unavailable", () => {
		const value = {
			udp: [
				{
					type: "salamander",
					settings: { password: "mask", packetSize: 1200 },
				},
			],
			quicParams: { congestion: "brutal", brutalDown: "1 mbps" },
		};
		expect(
			sanitizeFinalMask(
				value,
				getFinalMaskCapabilities({
					protocol: "vless",
					network: "xhttp",
					security: "tls",
					alpn: "h3",
				}),
			),
		).toEqual({
			udp: [
				{
					type: "salamander",
					settings: { password: "mask", packetSize: 1200 },
				},
			],
			quicParams: { brutalDown: "1 mbps" },
		});
		expect(
			sanitizeFinalMask(
				value,
				getFinalMaskCapabilities({ protocol: "vless", network: "kcp" }),
			),
		).toEqual({
			udp: [{ type: "salamander", settings: { password: "mask" } }],
		});
	});

	it("keeps TCP Sudoku layers in their configured positions", () => {
		const value = {
			tcp: [{ type: "sudoku" }, { type: "header-custom" }, { type: "sudoku" }],
		};
		expect(
			sanitizeFinalMask(
				value,
				getFinalMaskCapabilities({ protocol: "vless", network: "raw" }),
			),
		).toEqual(value);
		expect(finalMaskValidationError(value)).toBeNull();
	});

	it("canonicalizes stored layer types without dropping settings", () => {
		expect(
			hostFinalMaskValue({
				tcp: [{ type: " SUDOKU ", settings: { future: true } }],
				udp: [{ type: "NoIsE", settings: { reset: 0 } }],
			}),
		).toEqual({
			tcp: [{ type: "sudoku", settings: { future: true } }],
			udp: [{ type: "noise", settings: { reset: 0 } }],
		});
	});

	it("matches server-side required-field validation", () => {
		expect(
			finalMaskValidationError({
				tcp: [{ type: "fragment", settings: {} }],
			}),
		).toContain("length");
		expect(
			finalMaskValidationError({ udp: [{ type: "xdns", settings: {} }] }),
		).toContain("resolvers");
		expect(
			finalMaskValidationError({
				udp: [
					{
						type: "realm",
						settings: {
							url: "realm://token@example.com/id",
							stunServers: ["stun.example.com:3478"],
						},
					},
				],
			}),
		).toBeNull();
	});
});

const layerError = (
	direction: "tcp" | "udp",
	type: string,
	settings: Record<string, unknown>,
) =>
	finalMaskValidationError(
		direction === "tcp"
			? { tcp: [{ type, settings }] }
			: { udp: [{ type, settings }] },
	);

describe("FinalMask structured validation", () => {
	it("accepts every documented packet encoding and Int32Range form", () => {
		expect(
			layerError("tcp", "header-custom", {
				clients: [
					[
						{ packet: [0, 255], delay: "10-0" },
						{ type: "STR", packet: "hello" },
						{ type: "hex", packet: "deadBEEF" },
						{ type: "base64", packet: "AQI=" },
						{ rand: 8, randRange: "255-0" },
					],
				],
				servers: [],
				errors: [],
			}),
		).toBeNull();
	});

	it.each([
		[{ type: "wat", packet: [] }, "type"],
		[{ packet: [256] }, "bytes"],
		[{ type: "hex", packet: "abc" }, "hex"],
		[{ type: "base64", packet: "###=" }, "Base64"],
		[{ packet: [], rand: 1 }, "mutually exclusive"],
		[{ rand: 1, randRange: "0-256" }, "randRange"],
		[{ rand: -1 }, "rand"],
		[{ packet: [], delay: -1 }, "delay"],
	])("rejects invalid TCP packet item %j", (item, message) => {
		expect(layerError("tcp", "header-custom", { clients: [[item]] })).toContain(
			message,
		);
	});

	it("validates Fragment and Sudoku ranges, aliases, tables, and padding", () => {
		expect(
			layerError("tcp", "fragment", {
				packets: "1-3",
				lengths: ["0-10", "5-1"],
				delays: ["10-0"],
				maxSplit: "3-1",
			}),
		).toBeNull();
		expect(
			layerError("tcp", "fragment", { packets: "3-1", lengths: [1] }),
		).toContain("ascending");
		expect(layerError("tcp", "fragment", { lengths: [1, 0] })).toContain(
			"greater than zero",
		);
		expect(
			layerError("udp", "sudoku", {
				ascii: "ENTROPY",
				custom_table: " XX PP VVVV ",
				customTables: ["xpvxvpvv"],
				padding_min: 10,
				padding_max: 20,
			}),
		).toBeNull();
		expect(layerError("udp", "sudoku", { customTable: "xxxpvvvv" })).toContain(
			"2 x",
		);
		expect(
			layerError("udp", "sudoku", { paddingMin: 50, paddingMax: 49 }),
		).toContain("maximum padding");
	});

	it("validates each UDP-specific structured format", () => {
		expect(
			layerError("udp", "mkcp-legacy", { header: "WIREGUARD", value: "x" }),
		).toBeNull();
		expect(
			layerError("udp", "noise", {
				reset: "60-30",
				noise: [{ rand: "1-8", randRange: "0-255", delay: "10-0" }],
			}),
		).toBeNull();
		expect(
			layerError("udp", "salamander", { password: "🔒", packetSize: "1-2048" }),
		).toBeNull();
		expect(
			layerError("udp", "xdns", {
				domains: ["mask.example:txt"],
				resolvers: ["mask.example:aaaa+udp://[2001:4860:4860::8888]:53"],
			}),
		).toBeNull();
		expect(
			layerError("udp", "xicmp", {
				dgram: true,
				ips: ["192.0.2.1", "2001:db8::1"],
			}),
		).toBeNull();
		expect(
			layerError("udp", "xdns", {
				resolvers: ["mask.example+udp://dns.example:53"],
			}),
		).toContain("resolver");
		expect(layerError("udp", "xicmp", { ips: ["example.com"] })).toContain(
			"literal",
		);
	});

	it("validates Realm URL, STUN, and current TLS fields", () => {
		expect(
			layerError("udp", "realm", {
				url: "realm+http://token@example.com:443/id",
				stunServers: ["stun.example.com:3478", "[2001:db8::1]:3478"],
				tlsConfig: {
					serverName: "example.com",
					fingerprint: "HelloChrome_106_Shuffle",
					minVersion: "1.2",
					maxVersion: "1.3",
					alpn: ["h2"],
					rejectUnknownSni: true,
				},
			}),
		).toBeNull();
		expect(
			layerError("udp", "realm", {
				url: "realm://token:password@example.com/id",
				stunServers: ["stun.example.com:3478"],
			}),
		).toBeNull();
		expect(
			layerError("udp", "realm", {
				url: "realm://token@example.com/",
				stunServers: ["x:1"],
			}),
		).toContain("URL");
		expect(
			layerError("udp", "realm", {
				url: "realm://token@example.com/id",
				stunServers: ["::1:3478"],
			}),
		).toContain("host:port");
		expect(
			layerError("udp", "realm", {
				url: "realm://token@example.com/id",
				stunServers: ["stun.example.com:3478"],
				tlsConfig: { allowInsecure: true },
			}),
		).toContain("removed");
		expect(
			layerError("udp", "realm", {
				url: "realm://token@example.com/id",
				stunServers: ["stun.example.com:3478"],
				tlsConfig: { fingerprint: "typo" },
			}),
		).toContain("fingerprint");
	});

	it("validates all QUIC parameters and transport-specific brutal mode", () => {
		const params = {
			congestion: "force-brutal",
			bbrProfile: "aggressive",
			debug: true,
			brutalUp: "512 kbps",
			brutalDown: "1 mbps",
			udpHop: { ports: "20000-30000,443", interval: "10-5" },
			initStreamReceiveWindow: 16384,
			maxStreamReceiveWindow: 0,
			initConnectionReceiveWindow: 32768,
			maxConnectionReceiveWindow: 65536,
			maxIdleTimeout: 120,
			keepAlivePeriod: 2,
			disablePathMTUDiscovery: false,
			maxIncomingStreams: 8,
		};
		expect(finalMaskValidationError({ quicParams: params })).toBeNull();
		expect(
			finalMaskValidationError({
				quicParams: { udpHop: { ports: "20000", interval: "0-10" } },
			}),
		).toBeNull();
		expect(
			finalMaskValidationError({ quicParams: { udpHop: { ports: 20000 } } }),
		).toBeNull();
		expect(
			finalMaskValidationError({ quicParams: { udpHop: { interval: 1 } } }),
		).toContain("interval");
		for (const [override, message] of [
			[{ congestion: "cubic" }, "congestion"],
			[{ bbrProfile: "fast" }, "profile"],
			[{ brutalUp: 0 }, "brutalUp"],
			[{ brutalUp: "511 kbps" }, "brutalUp"],
			[{ initStreamReceiveWindow: 16383 }, "initStreamReceiveWindow"],
			[{ maxIdleTimeout: 3 }, "maxIdleTimeout"],
			[{ keepAlivePeriod: 61 }, "keepAlivePeriod"],
			[{ maxIncomingStreams: 7 }, "maxIncomingStreams"],
			[{ debug: "yes" }, "debug"],
			[{ udpHop: { ports: "9-8" } }, "ports"],
			[{ udpHop: { ports: "80", interval: 4 } }, "interval"],
		] as Array<[Record<string, unknown>, string]>) {
			expect(
				finalMaskValidationError({ quicParams: { ...params, ...override } }),
			).toContain(message);
		}
		const h3 = getFinalMaskCapabilities({
			protocol: "vless",
			network: "xhttp",
			security: "tls",
			alpn: "h3",
		});
		expect(
			finalMaskValidationError({ quicParams: { congestion: "brutal" } }, h3),
		).toContain("XHTTP H3");
	});

	it("only conflicts Realm/XICMP with an active UDP hop", () => {
		const realm = {
			type: "realm",
			settings: {
				url: "realm://token@example.com/id",
				stunServers: ["stun.example.com:3478"],
			},
		};
		expect(
			finalMaskValidationError({ udp: [realm], quicParams: { udpHop: {} } }),
		).toBeNull();
		expect(
			finalMaskValidationError({
				udp: [realm],
				quicParams: { udpHop: { ports: "20000" } },
			}),
		).toContain("cannot be combined");
	});
});
