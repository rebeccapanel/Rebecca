import type { InboundFormValues, Protocol, StreamNetwork } from "./inbounds";

const XRAY_PROTOCOLS: Protocol[] = [
	"vmess",
	"vless",
	"trojan",
	"shadowsocks",
	"hysteria",
	"masque",
	"http",
	"mixed",
	"tunnel",
	"tun",
	"wireguard-xray",
];

const TRANSPORT_PROTOCOLS: Protocol[] = [
	"vmess",
	"vless",
	"trojan",
	"shadowsocks",
];

const TRANSPORT_NETWORKS: StreamNetwork[] = [
	"tcp",
	"ws",
	"grpc",
	"kcp",
	"httpupgrade",
	"xhttp",
];

const TLS_NETWORKS: StreamNetwork[] = [
	"tcp",
	"ws",
	"grpc",
	"httpupgrade",
	"xhttp",
	"splithttp",
	"hysteria",
	"masque",
];

const REALITY_PROTOCOLS: Protocol[] = ["vless", "trojan"];

const REALITY_NETWORKS: StreamNetwork[] = ["tcp", "grpc", "xhttp", "splithttp"];

export const supportsSniffing = (protocol: string): boolean =>
	XRAY_PROTOCOLS.includes(protocol as Protocol);

export const networksForProtocol = (protocol: string): StreamNetwork[] => {
	if (protocol === "hysteria") return ["hysteria"];
	if (protocol === "masque") return ["masque"];
	if (TRANSPORT_PROTOCOLS.includes(protocol as Protocol)) {
		return TRANSPORT_NETWORKS;
	}
	return [];
};

export const protocolSupportsTls = (
	protocol: string,
	network: string,
): boolean =>
	(TRANSPORT_PROTOCOLS.includes(protocol as Protocol) ||
		protocol === "hysteria" ||
		protocol === "masque") &&
	TLS_NETWORKS.includes(network as StreamNetwork);

export const protocolSupportsReality = (
	protocol: string,
	network: string,
): boolean =>
	REALITY_PROTOCOLS.includes(protocol as Protocol) &&
	REALITY_NETWORKS.includes(network as StreamNetwork);

type SniffingScope = Pick<
	InboundFormValues,
	"protocol" | "shadowsocksNetwork" | "tunnelAllowedNetwork" | "socksUdpEnabled"
>;

const carriesUdp = (values: SniffingScope): boolean => {
	switch (values.protocol) {
		case "http":
			return false;
		case "mixed":
			return values.socksUdpEnabled;
		case "tunnel":
			return values.tunnelAllowedNetwork.includes("udp");
		case "shadowsocks":
			return values.shadowsocksNetwork.includes("udp");
		default:
			return true;
	}
};

export const sniffingDestinationsFor = (values: SniffingScope): string[] => {
	if (!supportsSniffing(values.protocol)) return [];
	const destinations = ["http", "tls"];
	if (carriesUdp(values)) destinations.push("quic");
	destinations.push("fakedns");
	return destinations;
};
