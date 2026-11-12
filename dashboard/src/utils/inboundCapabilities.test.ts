import { describe, expect, it } from "vitest";

import {
	networksForProtocol,
	protocolSupportsReality,
	protocolSupportsTls,
	sniffingDestinationsFor,
	supportsSniffing,
} from "./inboundCapabilities";
import { buildInboundPayload, createDefaultInboundForm } from "./inbounds";

describe("inbound capabilities", () => {
	it("limits transports to the ones current Xray still accepts", () => {
		expect(networksForProtocol("vless")).toEqual([
			"tcp",
			"ws",
			"grpc",
			"kcp",
			"httpupgrade",
			"xhttp",
		]);
		expect(networksForProtocol("vless")).not.toContain("quic");
		expect(networksForProtocol("vless")).not.toContain("http");
		expect(networksForProtocol("hysteria")).toEqual(["hysteria"]);
		expect(networksForProtocol("masque")).toEqual(["masque"]);
		expect(networksForProtocol("mixed")).toEqual([]);
	});

	it("allows security only where the protocol and network support it", () => {
		expect(protocolSupportsTls("vless", "ws")).toBe(true);
		expect(protocolSupportsTls("vless", "kcp")).toBe(false);
		expect(protocolSupportsTls("mixed", "tcp")).toBe(false);
		expect(protocolSupportsReality("vless", "xhttp")).toBe(true);
		expect(protocolSupportsReality("vless", "ws")).toBe(false);
		expect(protocolSupportsReality("vmess", "tcp")).toBe(false);
	});

	it("offers QUIC sniffing only when the inbound can carry UDP", () => {
		const base = createDefaultInboundForm("mixed");
		expect(
			sniffingDestinationsFor({ ...base, socksUdpEnabled: false }),
		).toEqual(["http", "tls", "fakedns"]);
		expect(sniffingDestinationsFor({ ...base, socksUdpEnabled: true })).toEqual(
			["http", "tls", "quic", "fakedns"],
		);
		expect(
			sniffingDestinationsFor(createDefaultInboundForm("http")),
		).not.toContain("quic");
		expect(
			sniffingDestinationsFor({
				...createDefaultInboundForm("tunnel"),
				tunnelAllowedNetwork: "tcp",
			}),
		).not.toContain("quic");
		expect(sniffingDestinationsFor(createDefaultInboundForm("tun"))).toContain(
			"quic",
		);
		expect(
			sniffingDestinationsFor(createDefaultInboundForm("openvpn")),
		).toEqual([]);
	});

	it("keeps sniffing out of non Xray protocols and filters unusable destinations", () => {
		expect(supportsSniffing("mixed")).toBe(true);
		expect(supportsSniffing("openvpn")).toBe(false);
		const mixed = {
			...createDefaultInboundForm("mixed"),
			sniffingEnabled: true,
			sniffingDestinations: ["http", "tls", "quic"],
			socksUdpEnabled: false,
		};
		expect(buildInboundPayload(mixed)?.sniffing?.destOverride).toEqual([
			"http",
			"tls",
		]);
		const ovpn = createDefaultInboundForm("openvpn");
		expect(buildInboundPayload(ovpn)?.sniffing).toBeUndefined();
	});
});
