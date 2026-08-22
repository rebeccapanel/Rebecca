export type FinalMaskSettings = Record<string, unknown>;

export type FinalMaskLayer = {
	type: string;
	settings?: FinalMaskSettings;
	[key: string]: unknown;
};

export type FinalMaskObject = {
	tcp?: FinalMaskLayer[];
	udp?: FinalMaskLayer[];
	quicParams?: FinalMaskSettings;
	[key: string]: unknown;
};

export type FinalMaskCapabilities = {
	supported: boolean;
	tcp: boolean;
	udp: boolean;
	quic: boolean;
	allowNegotiatedBrutal: boolean;
	mux: boolean;
	tcpTypes: string[];
	udpTypes: string[];
};

export type FinalMaskInbound = {
	protocol?: string;
	network?: string;
	alpn?: string;
	security?: string;
	flow?: string;
	proxyNetwork?: string;
};

const TCP_TYPES = ["header-custom", "fragment", "sudoku"];
const UDP_TYPES = [
	"header-custom",
	"mkcp-legacy",
	"noise",
	"salamander",
	"sudoku",
	"xdns",
	"xicmp",
	"realm",
];
const STREAM_PROTOCOLS = new Set([
	"vmess",
	"vless",
	"trojan",
	"shadowsocks",
	"hysteria",
]);

export const REALM_TLS_FINGERPRINTS = [
	"chrome",
	"firefox",
	"safari",
	"ios",
	"android",
	"edge",
	"360",
	"qq",
	"random",
	"randomized",
	"randomizednoalpn",
	"unsafe",
	"hellofirefox_120",
	"hellofirefox_148",
	"hellochrome_120",
	"hellochrome_131",
	"hellochrome_133",
	"helloios_13",
	"helloios_14",
	"helloedge_106",
	"hellosafari_26_3",
	"hello360_11_0",
	"helloqq_11_1",
	"hellogolang",
	"hellorandomized",
	"hellorandomizedalpn",
	"hellorandomizednoalpn",
	"hellofirefox_auto",
	"hellofirefox_55",
	"hellofirefox_56",
	"hellofirefox_63",
	"hellofirefox_65",
	"hellofirefox_99",
	"hellofirefox_102",
	"hellofirefox_105",
	"hellochrome_auto",
	"hellochrome_58",
	"hellochrome_62",
	"hellochrome_70",
	"hellochrome_72",
	"hellochrome_83",
	"hellochrome_87",
	"hellochrome_96",
	"hellochrome_100",
	"hellochrome_102",
	"hellochrome_106_shuffle",
	"helloios_auto",
	"helloios_11_1",
	"helloios_12_1",
	"helloandroid_11_okhttp",
	"helloedge_85",
	"helloedge_auto",
	"hellosafari_16_0",
	"hellosafari_auto",
	"hello360_auto",
	"hello360_7_5",
	"helloqq_auto",
	"hellochrome_100_psk",
	"hellochrome_112_psk_shuf",
	"hellochrome_114_padding_psk_shuf",
	"hellochrome_115_pq",
	"hellochrome_115_pq_psk",
	"hellochrome_120_pq",
] as const;

export const isFinalMaskObject = (value: unknown): value is FinalMaskObject =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const maskType = (layer: unknown) =>
	String(isFinalMaskObject(layer) ? (layer.type ?? "") : "")
		.trim()
		.toLowerCase();

export const cloneFinalMask = (
	value: FinalMaskObject | null | undefined,
): FinalMaskObject | null =>
	value && Object.keys(value).length
		? (JSON.parse(JSON.stringify(value)) as FinalMaskObject)
		: null;

const alpnValues = (value?: string) =>
	(value ?? "")
		.split(/[\s,]+/)
		.map((item) => item.trim().toLowerCase())
		.filter(Boolean);

const normalizedTransport = (network?: string) => {
	switch ((network || "tcp").trim().toLowerCase()) {
		case "tcp":
		case "raw":
		case "ws":
		case "websocket":
		case "grpc":
		case "gun":
		case "httpupgrade":
			return "tcp";
		case "kcp":
		case "mkcp":
			return "kcp";
		case "xhttp":
		case "splithttp":
			return "xhttp";
		case "hysteria":
			return "hysteria";
		default:
			return null;
	}
};

export const getFinalMaskCapabilities = ({
	protocol,
	network,
	alpn,
	security,
	flow,
	proxyNetwork,
}: FinalMaskInbound): FinalMaskCapabilities => {
	const normalizedProtocol = (protocol ?? "").trim().toLowerCase();
	const transport = normalizedTransport(network);
	const supported =
		STREAM_PROTOCOLS.has(normalizedProtocol) &&
		transport !== null &&
		(normalizedProtocol !== "hysteria" || transport === "hysteria");
	const normalizedAlpn = alpnValues(alpn);
	const xhttpH3 =
		transport === "xhttp" &&
		(security ?? "").trim().toLowerCase() === "tls" &&
		normalizedAlpn.length === 1 &&
		normalizedAlpn[0] === "h3";
	const proxyNetworks = (proxyNetwork ?? "tcp")
		.toLowerCase()
		.split(",")
		.map((item) => item.trim());
	const shadowsocksUDPOnly =
		normalizedProtocol === "shadowsocks" &&
		proxyNetworks.includes("udp") &&
		!proxyNetworks.includes("tcp");
	const transportUsesUDP =
		!shadowsocksUDPOnly &&
		(transport === "kcp" || transport === "hysteria" || xhttpH3);
	const shadowsocksNativeUDP =
		normalizedProtocol === "shadowsocks" && proxyNetworks.includes("udp");
	const shadowsocksAllowsTCP =
		normalizedProtocol !== "shadowsocks" || proxyNetworks.includes("tcp");
	const udp = supported && (transportUsesUDP || shadowsocksNativeUDP);
	const tcp = supported && !transportUsesUDP && shadowsocksAllowsTCP;
	const quic =
		supported && !shadowsocksUDPOnly && (transport === "hysteria" || xhttpH3);
	const udpTypes = udp
		? UDP_TYPES.filter((type) => type !== "xdns" || !quic)
		: [];
	const visionTCP =
		normalizedProtocol === "vless" &&
		tcp &&
		(flow ?? "").trim().toLowerCase() === "xtls-rprx-vision";
	return {
		supported,
		tcp,
		udp,
		quic,
		allowNegotiatedBrutal: quic && transport === "hysteria",
		mux: supported && !visionTCP && !shadowsocksUDPOnly,
		tcpTypes: tcp ? [...TCP_TYPES] : [],
		udpTypes,
	};
};

const legacyFragmentMask = (value: string): FinalMaskLayer | null => {
	const [length = "", delay = "", packets = "", maxSplit = ""] = value
		.split(",")
		.map((item) => item.trim());
	if (!length || !delay || !packets) return null;
	const settings: FinalMaskSettings = {
		packets,
		lengths: [length],
		delays: [delay],
	};
	if (maxSplit) settings.maxSplit = maxSplit;
	return { type: "fragment", settings };
};

const legacyNoiseMask = (value: string): FinalMaskLayer | null => {
	const noise = value
		.split("&")
		.map((raw) => raw.trim())
		.filter(Boolean)
		.flatMap((raw) => {
			const separator = raw.indexOf(":");
			const type = separator > 0 ? raw.slice(0, separator).trim() : "rand";
			const body = separator > 0 ? raw.slice(separator + 1) : raw;
			const [packet = "", delay = ""] = body
				.split(",")
				.map((item) => item.trim());
			if (!packet || !["rand", "str", "hex", "base64"].includes(type)) {
				return [];
			}
			const item: FinalMaskSettings =
				type === "rand" ? { rand: packet } : { type, packet };
			if (delay) item.delay = delay;
			return [item];
		});
	return noise.length ? { type: "noise", settings: { noise } } : null;
};

export const mergeLegacyFinalMask = (
	base: FinalMaskObject | null,
	fragment: string,
	noise: string,
): FinalMaskObject | null => {
	const result = cloneFinalMask(base) ?? {};
	for (const [key, mask] of [
		["tcp", legacyFragmentMask(fragment)],
		["udp", legacyNoiseMask(noise)],
	] as const) {
		if (!mask) continue;
		const current = Array.isArray(result[key]) ? [...result[key]] : [];
		result[key] = [...current, mask];
	}
	return Object.keys(result).length ? result : null;
};

export const hostFinalMaskValue = (
	value: unknown,
	fragment = "",
	noise = "",
): FinalMaskObject | null => {
	if (isFinalMaskObject(value) && Object.keys(value).length) {
		const cloned = cloneFinalMask(value);
		for (const key of ["tcp", "udp"] as const) {
			if (!Array.isArray(cloned?.[key])) continue;
			cloned[key] = cloned[key].map((layer) =>
				isFinalMaskObject(layer)
					? ({
							...layer,
							type: maskType(layer as FinalMaskLayer),
						} as FinalMaskLayer)
					: layer,
			);
		}
		return cloned;
	}
	return mergeLegacyFinalMask(null, fragment, noise);
};

export const sanitizeFinalMask = (
	value: FinalMaskObject | null,
	capabilities: FinalMaskCapabilities,
): FinalMaskObject | null => {
	if (!value || !capabilities.supported) return null;
	const next: FinalMaskObject = {};
	if (capabilities.tcp && Array.isArray(value.tcp)) {
		next.tcp = value.tcp
			.filter(
				(layer) =>
					isFinalMaskObject(layer) &&
					capabilities.tcpTypes.includes(maskType(layer)),
			)
			.map((layer) => ({ ...layer, type: maskType(layer) }));
		if (!next.tcp.length) delete next.tcp;
	}
	if (capabilities.udp && Array.isArray(value.udp)) {
		const layers = value.udp
			.filter(
				(layer) =>
					isFinalMaskObject(layer) &&
					capabilities.udpTypes.includes(maskType(layer)),
			)
			.map((layer) => ({ ...layer, type: maskType(layer) }));
		const socket = layers.find((layer) =>
			["realm", "xicmp"].includes(maskType(layer)),
		);
		const sudoku = layers.find((layer) => maskType(layer) === "sudoku");
		next.udp = [
			...(socket ? [socket] : []),
			...layers.filter(
				(layer) => !["realm", "xicmp", "sudoku"].includes(maskType(layer)),
			),
			...(sudoku ? [sudoku] : []),
		];
		next.udp = next.udp.map((layer) => {
			if (!isFinalMaskObject(layer.settings)) {
				return layer;
			}
			const settings = { ...layer.settings };
			if (maskType(layer) === "salamander" && !capabilities.quic) {
				delete settings.packetSize;
			}
			if (
				maskType(layer) === "realm" &&
				isFinalMaskObject(settings.tlsConfig)
			) {
				const tlsConfig = { ...settings.tlsConfig };
				delete tlsConfig.allowInsecure;
				settings.tlsConfig = tlsConfig;
			}
			return { ...layer, settings };
		});
		if (!next.udp.length) delete next.udp;
	}
	if (capabilities.quic && isFinalMaskObject(value.quicParams)) {
		next.quicParams = { ...value.quicParams };
		if (
			!capabilities.allowNegotiatedBrutal &&
			typeof next.quicParams.congestion === "string" &&
			next.quicParams.congestion.toLowerCase() === "brutal"
		) {
			delete next.quicParams.congestion;
		}
		if (
			next.udp?.some((layer) => ["realm", "xicmp"].includes(maskType(layer))) &&
			hasActiveUdpHop(next.quicParams)
		) {
			delete next.quicParams.udpHop;
		}
	}
	return Object.keys(next).length ? next : null;
};

// Validation helpers live here so Hosts and their tests use one Xray-compatible
// boundary without coupling validation to the form components.
const hasOwn = (value: object, key: string) => Object.hasOwn(value, key);
const INT32_MIN = -2_147_483_648;
const INT32_MAX = 2_147_483_647;

type ParsedRange = { from: number; to: number };

const parseInt32Range = (value: unknown): ParsedRange | null => {
	if (typeof value === "number") {
		return Number.isInteger(value) && value >= INT32_MIN && value <= INT32_MAX
			? { from: value, to: value }
			: null;
	}
	if (typeof value !== "string" || !value) return null;
	const match = /^(-?\d+)(?:-(-?\d+))?$/.exec(value);
	if (!match) return null;
	const first = Number(match[1]);
	const second = match[2] === undefined ? first : Number(match[2]);
	if (
		!Number.isInteger(first) ||
		!Number.isInteger(second) ||
		first < INT32_MIN ||
		first > INT32_MAX ||
		second < INT32_MIN ||
		second > INT32_MAX
	) {
		return null;
	}
	return { from: Math.min(first, second), to: Math.max(first, second) };
};

const validateRange = (
	value: unknown,
	label: string,
	minimum = INT32_MIN,
	maximum = INT32_MAX,
): string | null => {
	const range = parseInt32Range(value);
	if (!range) return `${label} must be an Int32 integer or range.`;
	if (range.from < minimum || range.to > maximum) {
		return `${label} must be between ${minimum} and ${maximum}.`;
	}
	return null;
};

const validateStringArray = (
	value: unknown,
	label: string,
	required = false,
): string | null => {
	if (!Array.isArray(value) || (required && value.length === 0)) {
		return `${label} must be ${required ? "a non-empty" : "an"} array of strings.`;
	}
	if (value.some((item) => typeof item !== "string" || !item.trim())) {
		return `${label} must contain only non-empty strings.`;
	}
	return null;
};

const validatePacketItem = (
	value: unknown,
	label: string,
	randKind: "integer" | "range",
	allowDelay: boolean,
): string | null => {
	if (!isFinalMaskObject(value)) return `${label} must be an object.`;
	const type = hasOwn(value, "type") ? value.type : "";
	if (typeof type !== "string") return `${label} type must be a string.`;
	const packetType = type.toLowerCase();
	if (!["", "array", "str", "hex", "base64"].includes(packetType)) {
		return `${label} packet type is invalid.`;
	}

	let rand: ParsedRange | null = null;
	if (hasOwn(value, "rand")) {
		if (randKind === "integer") {
			if (
				typeof value.rand !== "number" ||
				!Number.isInteger(value.rand) ||
				value.rand < 0 ||
				value.rand > INT32_MAX
			) {
				return `${label} rand must be a non-negative Int32 integer.`;
			}
			rand = { from: value.rand, to: value.rand };
		} else {
			const error = validateRange(value.rand, `${label} rand`, 0);
			if (error) return error;
			rand = parseInt32Range(value.rand);
		}
	}
	if (hasOwn(value, "randRange")) {
		const error = validateRange(value.randRange, `${label} randRange`, 0, 255);
		if (error) return error;
	}
	if (hasOwn(value, "delay")) {
		if (!allowDelay) return `${label} delay is not supported.`;
		const error = validateRange(value.delay, `${label} delay`, 0);
		if (error) return error;
	}

	const hasPacket = hasOwn(value, "packet") && value.packet !== undefined;
	if (hasPacket && (rand?.to ?? 0) > 0) {
		return `${label} packet and positive rand are mutually exclusive.`;
	}
	if (packetType && !hasPacket)
		return `${label} packet is required for its type.`;
	if (!hasPacket) return null;
	if (packetType === "" || packetType === "array") {
		if (
			!Array.isArray(value.packet) ||
			value.packet.some(
				(item) =>
					typeof item !== "number" ||
					!Number.isInteger(item) ||
					item < 0 ||
					item > 255,
			)
		) {
			return `${label} array packet must contain only bytes from 0 to 255.`;
		}
		return null;
	}
	if (typeof value.packet !== "string") {
		return `${label} ${packetType} packet must be a string.`;
	}
	if (
		packetType === "hex" &&
		(value.packet.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(value.packet))
	) {
		return `${label} hex packet is invalid.`;
	}
	if (
		packetType === "base64" &&
		(value.packet.length % 4 !== 0 ||
			!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
				value.packet,
			))
	) {
		return `${label} Base64 packet is invalid.`;
	}
	return null;
};

const validateHeaderCustom = (
	settings: FinalMaskSettings,
	direction: "tcp" | "udp",
): string | null => {
	const fields =
		direction === "tcp"
			? ["clients", "servers", "errors"]
			: ["client", "server"];
	for (const field of fields) {
		if (!hasOwn(settings, field)) continue;
		const variants = settings[field];
		if (!Array.isArray(variants)) return `${field} must be an array.`;
		if (direction === "tcp") {
			for (const [variantIndex, variant] of variants.entries()) {
				if (!Array.isArray(variant)) {
					return `${field} variant ${variantIndex + 1} must be an array.`;
				}
				for (const [itemIndex, item] of variant.entries()) {
					const error = validatePacketItem(
						item,
						`${field} variant ${variantIndex + 1} item ${itemIndex + 1}`,
						"integer",
						true,
					);
					if (error) return error;
				}
			}
		} else {
			for (const [itemIndex, item] of variants.entries()) {
				const error = validatePacketItem(
					item,
					`${field} item ${itemIndex + 1}`,
					"integer",
					false,
				);
				if (error) return error;
			}
		}
	}
	return null;
};

const validateFragment = (settings: FinalMaskSettings): string | null => {
	if (hasOwn(settings, "packets")) {
		if (typeof settings.packets !== "string") {
			return "Fragment packets must be a string.";
		}
		if (settings.packets && settings.packets.toLowerCase() !== "tlshello") {
			const match = /^(\d+)(?:-(\d+))?$/.exec(settings.packets);
			if (!match) {
				return "Fragment packets must be tlshello or a positive integer range.";
			}
			const from = Number(match[1]);
			const to = Number(match[2] ?? match[1]);
			if (from < 1 || to < from || to > INT32_MAX) {
				return "Fragment packet range must be ascending and start at 1 or greater.";
			}
		}
	}

	let lengths: unknown[];
	if (hasOwn(settings, "lengths")) {
		if (!Array.isArray(settings.lengths)) {
			return "Fragment lengths must be an array.";
		}
		if (settings.lengths.length > 0) {
			lengths = settings.lengths;
		} else if (hasOwn(settings, "length")) {
			lengths = [settings.length];
		} else {
			return "Fragment requires at least one length.";
		}
	} else if (hasOwn(settings, "length")) {
		lengths = [settings.length];
	} else {
		return "Fragment requires at least one length.";
	}
	for (const [index, length] of lengths.entries()) {
		const error = validateRange(length, `Fragment length ${index + 1}`, 0);
		if (error) return error;
	}
	const lastLength = parseInt32Range(lengths[lengths.length - 1]);
	if (!lastLength || lastLength.from === 0) {
		return "The final Fragment length must be greater than zero.";
	}
	if (hasOwn(settings, "delays")) {
		if (!Array.isArray(settings.delays))
			return "Fragment delays must be an array.";
		for (const [index, delay] of settings.delays.entries()) {
			const error = validateRange(delay, `Fragment delay ${index + 1}`, 0);
			if (error) return error;
		}
	}
	if (hasOwn(settings, "delay")) {
		const error = validateRange(settings.delay, "Fragment delay", 0);
		if (error) return error;
	}
	if (hasOwn(settings, "maxSplit")) {
		const error = validateRange(settings.maxSplit, "Fragment maxSplit", 0);
		if (error) return error;
	}
	return null;
};

const validateSudokuTable = (value: string) => {
	if (!value) return true;
	const normalized = value.trim().toLowerCase().replaceAll(" ", "");
	return (
		normalized.length === 8 &&
		[...normalized].every((character) => ["x", "p", "v"].includes(character)) &&
		[...normalized].filter((character) => character === "x").length === 2 &&
		[...normalized].filter((character) => character === "p").length === 2 &&
		[...normalized].filter((character) => character === "v").length === 4
	);
};

const validateSudoku = (settings: FinalMaskSettings): string | null => {
	if (hasOwn(settings, "password") && typeof settings.password !== "string") {
		return "Sudoku password must be a string.";
	}
	if (
		hasOwn(settings, "ascii") &&
		(typeof settings.ascii !== "string" ||
			!["", "entropy", "prefer_entropy", "ascii", "prefer_ascii"].includes(
				settings.ascii.toLowerCase(),
			))
	) {
		return "Sudoku ASCII mode is invalid.";
	}
	for (const field of ["customTable", "custom_table"] as const) {
		if (!hasOwn(settings, field)) continue;
		if (
			typeof settings[field] !== "string" ||
			!validateSudokuTable(settings[field] as string)
		) {
			return `Sudoku ${field} must contain exactly 2 x, 2 p, and 4 v characters.`;
		}
	}
	for (const field of ["customTables", "custom_tables"] as const) {
		if (!hasOwn(settings, field)) continue;
		if (
			!Array.isArray(settings[field]) ||
			(settings[field] as unknown[]).some(
				(item) => typeof item !== "string" || !validateSudokuTable(item),
			)
		) {
			return `Sudoku ${field} must contain valid table strings.`;
		}
	}
	const paddingValues = new Map<string, number>();
	for (const field of [
		"paddingMin",
		"padding_min",
		"paddingMax",
		"padding_max",
	] as const) {
		if (!hasOwn(settings, field)) continue;
		const value = settings[field];
		if (
			typeof value !== "number" ||
			!Number.isInteger(value) ||
			value < 0 ||
			value > 100
		) {
			return `Sudoku ${field} must be an integer from 0 to 100.`;
		}
		paddingValues.set(field, value);
	}
	const minimum =
		paddingValues.get("paddingMin") ?? paddingValues.get("padding_min");
	const maximum =
		paddingValues.get("paddingMax") ?? paddingValues.get("padding_max");
	if (minimum !== undefined && maximum !== undefined && maximum < minimum) {
		return "Sudoku maximum padding must be greater than or equal to minimum padding.";
	}
	return null;
};

// Network validation.
const isIPv4 = (value: string) => {
	const parts = value.split(".");
	return (
		parts.length === 4 &&
		parts.every(
			(part) =>
				/^(?:0|[1-9]\d*)$/.test(part) &&
				Number(part) >= 0 &&
				Number(part) <= 255,
		)
	);
};

const isIPv6 = (value: string) => {
	if (!value.includes(":") || /[[\]%]/.test(value)) return false;
	try {
		const parsed = new URL(`http://[${value}]/`);
		return parsed.hostname.length > 2;
	} catch {
		return false;
	}
};

const isIPAddress = (value: string) => isIPv4(value) || isIPv6(value);

const splitDnsEntry = (value: string): string | null => {
	const separator = value.lastIndexOf(":");
	if (separator < 0) return value;
	const method = value.slice(separator + 1).toLowerCase();
	return ["txt", "a", "aaaa"].includes(method)
		? value.slice(0, separator)
		: null;
};

const isDnsName = (value: string) => {
	if (!value) return false;
	const normalized = value.endsWith(".") ? value.slice(0, -1) : value;
	if (!normalized) return false;
	const encoder = new TextEncoder();
	const labels = normalized.split(".");
	if (labels.some((label) => !label || encoder.encode(label).length > 63)) {
		return false;
	}
	return (
		labels.reduce(
			(total, label) => total + encoder.encode(label).length + 1,
			1,
		) <= 255
	);
};

const splitHostPort = (
	value: string,
): { host: string; port: number } | null => {
	let host = "";
	let portText = "";
	if (value.startsWith("[")) {
		const close = value.indexOf("]");
		if (close < 2 || value[close + 1] !== ":") return null;
		host = value.slice(1, close);
		portText = value.slice(close + 2);
		if (!isIPv6(host)) return null;
	} else {
		const separator = value.lastIndexOf(":");
		if (separator <= 0 || value.slice(0, separator).includes(":")) return null;
		host = value.slice(0, separator);
		portText = value.slice(separator + 1);
	}
	if (!/^[1-9]\d*$/.test(portText)) return null;
	const port = Number(portText);
	return host && port <= 65_535 ? { host, port } : null;
};

const validateXdns = (settings: FinalMaskSettings): string | null => {
	if (hasOwn(settings, "domains")) {
		const error = validateStringArray(settings.domains, "XDNS domains");
		if (error) return error;
		for (const entry of settings.domains as string[]) {
			const domain = splitDnsEntry(entry);
			if (!domain || !isDnsName(domain))
				return `Invalid XDNS domain: ${entry}.`;
		}
	}
	const resolversError = validateStringArray(
		settings.resolvers,
		"XDNS resolvers",
		true,
	);
	if (resolversError) return resolversError;
	for (const entry of settings.resolvers as string[]) {
		const marker = "+udp://";
		const separator = entry.indexOf(marker);
		if (
			separator <= 0 ||
			entry.indexOf(marker, separator + marker.length) !== -1
		) {
			return `Invalid XDNS resolver: ${entry}.`;
		}
		const domain = splitDnsEntry(entry.slice(0, separator));
		const server = splitHostPort(entry.slice(separator + marker.length));
		if (!domain || !isDnsName(domain) || !server || !isIPAddress(server.host)) {
			return `Invalid XDNS resolver: ${entry}.`;
		}
	}
	return null;
};

const validateRealmUrl = (value: unknown) => {
	if (typeof value !== "string" || !value) return false;
	try {
		const parsed = new URL(value);
		const token = decodeURIComponent(parsed.username);
		const id = decodeURIComponent(parsed.pathname).replace(/^\/+|\/+$/g, "");
		return (
			["realm:", "realm+http:"].includes(parsed.protocol) &&
			Boolean(token) &&
			Boolean(parsed.hostname) &&
			Boolean(id) &&
			(!parsed.port || Number(parsed.port) >= 1)
		);
	} catch {
		return false;
	}
};

const isStandardBase64 = (value: string) =>
	value.length % 4 === 0 &&
	/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
		value,
	);

const validateRealmTls = (value: unknown): string | null => {
	if (!isFinalMaskObject(value)) return "Realm TLS config must be an object.";
	for (const field of [
		"serverName",
		"verifyPeerCertByName",
		"minVersion",
		"maxVersion",
		"cipherSuites",
		"fingerprint",
		"pinnedPeerCertSha256",
		"masterKeyLog",
		"echServerKeys",
		"echConfigList",
	] as const) {
		if (hasOwn(value, field) && typeof value[field] !== "string") {
			return `Realm TLS ${field} must be a string.`;
		}
	}
	if (
		typeof value.fingerprint === "string" &&
		value.fingerprint &&
		!REALM_TLS_FINGERPRINTS.includes(
			value.fingerprint.toLowerCase() as (typeof REALM_TLS_FINGERPRINTS)[number],
		)
	) {
		return "Realm TLS fingerprint is not supported by Xray.";
	}
	for (const field of [
		"rejectUnknownSni",
		"allowInsecure",
		"disableSystemRoot",
		"enableSessionResumption",
	] as const) {
		if (hasOwn(value, field) && typeof value[field] !== "boolean") {
			return `Realm TLS ${field} must be a boolean.`;
		}
	}
	if (value.allowInsecure === true) {
		return "Realm TLS allowInsecure has been removed by Xray.";
	}
	for (const field of ["alpn", "curvePreferences"] as const) {
		if (hasOwn(value, field)) {
			const error = validateStringArray(value[field], `Realm TLS ${field}`);
			if (error) return error;
		}
	}
	if (
		Array.isArray(value.alpn) &&
		value.alpn.some((item) => item.toLowerCase() === "frommitm") &&
		(value.alpn.length !== 1 || value.alpn[0].toLowerCase() !== "frommitm")
	) {
		return "Realm TLS FromMitM must be the only ALPN value.";
	}
	const versions = ["", "1.0", "1.1", "1.2", "1.3"];
	for (const field of ["minVersion", "maxVersion"] as const) {
		if (hasOwn(value, field) && !versions.includes(value[field] as string)) {
			return `Realm TLS ${field} is invalid.`;
		}
	}
	const minimum = versions.indexOf(
		(value.minVersion as string | undefined) ?? "",
	);
	const maximum = versions.indexOf(
		(value.maxVersion as string | undefined) ?? "",
	);
	if (minimum > 0 && maximum > 0 && minimum > maximum) {
		return "Realm TLS minimum version cannot exceed maximum version.";
	}
	if (
		typeof value.pinnedPeerCertSha256 === "string" &&
		value.pinnedPeerCertSha256 &&
		value.pinnedPeerCertSha256
			.split(",")
			.some((hash) => !/^[0-9a-f]{64}$/i.test(hash.trim().replaceAll(":", "")))
	) {
		return "Realm TLS pinned peer certificate SHA-256 list is invalid.";
	}
	if (
		typeof value.echServerKeys === "string" &&
		value.echServerKeys &&
		!isStandardBase64(value.echServerKeys)
	) {
		return "Realm TLS ECH server keys must be standard Base64.";
	}
	if (!hasOwn(value, "certificates")) return null;
	if (!Array.isArray(value.certificates)) {
		return "Realm TLS certificates must be an array.";
	}
	for (const [index, certificate] of value.certificates.entries()) {
		if (!isFinalMaskObject(certificate)) {
			return `Realm TLS certificate ${index + 1} must be an object.`;
		}
		for (const field of ["certificateFile", "keyFile", "usage"] as const) {
			if (
				hasOwn(certificate, field) &&
				typeof certificate[field] !== "string"
			) {
				return `Realm TLS certificate ${index + 1} ${field} must be a string.`;
			}
		}
		for (const field of ["oneTimeLoading", "buildChain"] as const) {
			if (
				hasOwn(certificate, field) &&
				typeof certificate[field] !== "boolean"
			) {
				return `Realm TLS certificate ${index + 1} ${field} must be a boolean.`;
			}
		}
		for (const field of ["certificate", "key"] as const) {
			if (hasOwn(certificate, field)) {
				const error = validateStringArray(
					certificate[field],
					`Realm TLS certificate ${index + 1} ${field}`,
				);
				if (error) return error;
			}
		}
		if (
			!(
				typeof certificate.certificateFile === "string" &&
				certificate.certificateFile
			) &&
			!(
				Array.isArray(certificate.certificate) && certificate.certificate.length
			)
		) {
			return `Realm TLS certificate ${index + 1} requires certificate content or a file.`;
		}
		if (
			hasOwn(certificate, "usage") &&
			!["", "encipherment", "verify", "issue"].includes(
				(certificate.usage as string).toLowerCase(),
			)
		) {
			return `Realm TLS certificate ${index + 1} usage is invalid.`;
		}
		if (
			hasOwn(certificate, "ocspStapling") &&
			(typeof certificate.ocspStapling !== "number" ||
				!Number.isInteger(certificate.ocspStapling) ||
				certificate.ocspStapling < 0)
		) {
			return `Realm TLS certificate ${index + 1} OCSP stapling must be a non-negative integer.`;
		}
	}
	return null;
};

// QUIC validation.
const parseBandwidth = (value: unknown): number | null => {
	if (typeof value !== "string") return null;
	const match =
		/^(\d+(?:\.\d*)?)\s*(b|bps|k|kb|kbps|m|mb|mbps|g|gb|gbps|t|tb|tbps)?$/i.exec(
			value.trim(),
		);
	if (!match) return null;
	const unit = (match[2] ?? "").toLowerCase();
	const exponent = unit.startsWith("k")
		? 1
		: unit.startsWith("m")
			? 2
			: unit.startsWith("g")
				? 3
				: unit.startsWith("t")
					? 4
					: 0;
	const bytesPerSecond = (Number(match[1]) * 1024 ** exponent) / 8;
	return Number.isFinite(bytesPerSecond) ? bytesPerSecond : null;
};

const hasActiveUdpHop = (quicParams: unknown) =>
	isFinalMaskObject(quicParams) &&
	isFinalMaskObject(quicParams.udpHop) &&
	((typeof quicParams.udpHop.ports === "string" &&
		Boolean(quicParams.udpHop.ports.trim())) ||
		(typeof quicParams.udpHop.ports === "number" &&
			Number.isSafeInteger(quicParams.udpHop.ports) &&
			quicParams.udpHop.ports > 0));

const validateQuicParams = (
	value: FinalMaskSettings,
	capabilities?: FinalMaskCapabilities,
): string | null => {
	if (hasOwn(value, "congestion")) {
		if (
			typeof value.congestion !== "string" ||
			!["", "reno", "bbr", "brutal", "force-brutal"].includes(
				value.congestion.toLowerCase(),
			)
		) {
			return "QUIC congestion is invalid.";
		}
		if (
			value.congestion.toLowerCase() === "brutal" &&
			capabilities?.quic &&
			!capabilities.allowNegotiatedBrutal
		) {
			return "Negotiated brutal congestion is not supported by XHTTP H3.";
		}
	}
	if (
		hasOwn(value, "bbrProfile") &&
		(typeof value.bbrProfile !== "string" ||
			!["", "conservative", "standard", "aggressive"].includes(
				value.bbrProfile.toLowerCase(),
			))
	) {
		return "QUIC BBR profile is invalid.";
	}
	for (const field of ["debug", "disablePathMTUDiscovery"] as const) {
		if (hasOwn(value, field) && typeof value[field] !== "boolean") {
			return `QUIC ${field} must be a boolean.`;
		}
	}
	for (const field of ["brutalUp", "brutalDown"] as const) {
		if (!hasOwn(value, field)) continue;
		const bandwidth = parseBandwidth(value[field]);
		if (bandwidth === null || (bandwidth > 0 && bandwidth < 65_536)) {
			return `QUIC ${field} must be 0 or at least 65536 bytes per second.`;
		}
	}
	if (
		typeof value.congestion === "string" &&
		value.congestion.toLowerCase() === "force-brutal" &&
		(parseBandwidth(value.brutalUp) ?? 0) <= 0
	) {
		return "QUIC force-brutal requires a non-zero brutalUp bandwidth.";
	}
	for (const field of [
		"initStreamReceiveWindow",
		"maxStreamReceiveWindow",
		"initConnectionReceiveWindow",
		"maxConnectionReceiveWindow",
	] as const) {
		if (!hasOwn(value, field)) continue;
		const number = value[field];
		if (
			typeof number !== "number" ||
			!Number.isSafeInteger(number) ||
			number < 0 ||
			(number !== 0 && number < 16_384)
		) {
			return `QUIC ${field} must be 0 or an unsigned integer of at least 16384.`;
		}
	}
	for (const [field, minimum, maximum] of [
		["maxIdleTimeout", 4, 120],
		["keepAlivePeriod", 2, 60],
	] as const) {
		if (!hasOwn(value, field)) continue;
		const number = value[field];
		if (
			typeof number !== "number" ||
			!Number.isSafeInteger(number) ||
			(number !== 0 && (number < minimum || number > maximum))
		) {
			return `QUIC ${field} must be 0 or an integer from ${minimum} to ${maximum}.`;
		}
	}
	if (hasOwn(value, "maxIncomingStreams")) {
		const number = value.maxIncomingStreams;
		if (
			typeof number !== "number" ||
			!Number.isSafeInteger(number) ||
			(number !== 0 && number < 8)
		) {
			return "QUIC maxIncomingStreams must be 0 or an integer of at least 8.";
		}
	}
	if (!hasOwn(value, "udpHop")) return null;
	if (!isFinalMaskObject(value.udpHop)) return "QUIC udpHop must be an object.";
	const hop = value.udpHop;
	let active = false;
	if (hasOwn(hop, "ports")) {
		if (typeof hop.ports === "number") {
			if (
				!Number.isSafeInteger(hop.ports) ||
				hop.ports < 1 ||
				hop.ports > 65_535
			) {
				return "QUIC UDP-hop port must be an integer from 1 to 65535.";
			}
			active = true;
		} else if (typeof hop.ports === "string") {
			active = Boolean(hop.ports.trim());
		} else {
			return "QUIC UDP-hop ports must be a string or integer.";
		}
		if (active && typeof hop.ports === "string") {
			for (const token of hop.ports.split(",")) {
				const match = /^(\d+)(?:-(\d+))?$/.exec(token);
				const from = Number(match?.[1]);
				const to = Number(match?.[2] ?? match?.[1]);
				if (!match || from < 1 || to < from || to > 65_535) {
					return "QUIC UDP-hop ports must be ascending ports from 1 to 65535.";
				}
			}
		}
	}
	if (hasOwn(hop, "interval")) {
		const error = validateRange(hop.interval, "QUIC UDP-hop interval", 0);
		if (error) return error;
		const interval = parseInt32Range(hop.interval);
		if (
			interval &&
			((interval.from !== 0 && interval.from < 5) ||
				(interval.to !== 0 && interval.to < 5))
		) {
			return "QUIC UDP-hop interval must be at least 5 seconds.";
		}
	}
	return null;
};

const validateLayerSettings = (
	direction: "tcp" | "udp",
	typeName: string,
	settings: FinalMaskSettings,
): string | null => {
	if (typeName === "header-custom")
		return validateHeaderCustom(settings, direction);
	if (typeName === "sudoku") return validateSudoku(settings);
	if (direction === "tcp") return validateFragment(settings);
	if (typeName === "mkcp-legacy") {
		if (
			hasOwn(settings, "header") &&
			(typeof settings.header !== "string" ||
				!["", "dns", "dtls", "srtp", "utp", "wechat", "wireguard"].includes(
					settings.header.toLowerCase(),
				))
		) {
			return "mKCP legacy header is invalid.";
		}
		return hasOwn(settings, "value") && typeof settings.value !== "string"
			? "mKCP legacy value must be a string."
			: null;
	}
	if (typeName === "noise") {
		if (hasOwn(settings, "reset")) {
			const error = validateRange(settings.reset, "Noise reset", 0);
			if (error) return error;
		}
		if (!hasOwn(settings, "noise")) return null;
		if (!Array.isArray(settings.noise))
			return "Noise packets must be an array.";
		for (const [index, item] of settings.noise.entries()) {
			const error = validatePacketItem(
				item,
				`Noise item ${index + 1}`,
				"range",
				true,
			);
			if (error) return error;
		}
		return null;
	}
	if (typeName === "salamander") {
		if (
			typeof settings.password !== "string" ||
			new TextEncoder().encode(settings.password).length < 4
		) {
			return "Salamander password must be at least 4 bytes.";
		}
		if (!hasOwn(settings, "packetSize")) return null;
		const packetSize = parseInt32Range(settings.packetSize);
		return !packetSize ||
			packetSize.from < 0 ||
			(packetSize.to !== 0 && (packetSize.from === 0 || packetSize.to > 2048))
			? "Salamander packetSize must be 0 or a range from 1 to 2048."
			: null;
	}
	if (typeName === "xdns") return validateXdns(settings);
	if (typeName === "xicmp") {
		if (hasOwn(settings, "dgram") && typeof settings.dgram !== "boolean") {
			return "XICMP dgram must be a boolean.";
		}
		if (
			hasOwn(settings, "ips") &&
			(!Array.isArray(settings.ips) ||
				settings.ips.some((ip) => typeof ip !== "string" || !isIPAddress(ip)))
		) {
			return "XICMP IPs must contain only literal IPv4 or IPv6 addresses.";
		}
		return null;
	}
	if (!validateRealmUrl(settings.url)) {
		return "Realm requires a valid realm[+http]://token@host[:port]/id URL.";
	}
	const stunError = validateStringArray(
		settings.stunServers,
		"Realm STUN servers",
		true,
	);
	if (stunError) return stunError;
	if (
		(settings.stunServers as string[]).some((server) => !splitHostPort(server))
	) {
		return "Realm STUN servers must use strict host:port format.";
	}
	return hasOwn(settings, "tlsConfig")
		? validateRealmTls(settings.tlsConfig)
		: null;
};

export const finalMaskValidationError = (
	value: FinalMaskObject | null,
	capabilities?: FinalMaskCapabilities,
): string | null => {
	if (!value || !Object.keys(value).length) return null;
	if (JSON.stringify(value).length > 64 * 1024) {
		return "FinalMask must not exceed 64 KiB.";
	}
	for (const key of Object.keys(value)) {
		if (!["tcp", "udp", "quicParams"].includes(key)) {
			return `Unsupported FinalMask field: ${key}.`;
		}
		if (key === "quicParams") {
			if (!isFinalMaskObject(value[key]))
				return "QUIC params must be an object.";
			const error = validateQuicParams(
				value[key] as FinalMaskSettings,
				capabilities,
			);
			if (error) return error;
			continue;
		}
		const direction = key as "tcp" | "udp";
		const layers = value[direction];
		if (!Array.isArray(layers)) {
			return `${direction.toUpperCase()} masks must be a list.`;
		}
		const allowed = direction === "tcp" ? TCP_TYPES : UDP_TYPES;
		for (const [index, layer] of layers.entries()) {
			const typeName = isFinalMaskObject(layer)
				? String(layer.type).trim().toLowerCase()
				: "";
			if (!isFinalMaskObject(layer) || !allowed.includes(typeName)) {
				return `Unsupported ${direction.toUpperCase()} mask at layer ${index + 1}.`;
			}
			if (hasOwn(layer, "settings") && !isFinalMaskObject(layer.settings)) {
				return `${direction.toUpperCase()} layer ${index + 1} settings must be an object.`;
			}
			if (
				direction === "udp" &&
				typeName === "sudoku" &&
				index !== layers.length - 1
			) {
				return "Sudoku must be the last UDP layer.";
			}
			if (
				direction === "udp" &&
				["realm", "xicmp"].includes(typeName) &&
				index !== 0
			) {
				return "Realm or XICMP must be the first UDP layer.";
			}
			const error = validateLayerSettings(
				direction,
				typeName,
				isFinalMaskObject(layer.settings) ? layer.settings : {},
			);
			if (error)
				return `${direction.toUpperCase()} layer ${index + 1}: ${error}`;
		}
		if (
			direction === "udp" &&
			layers.filter((layer) => maskType(layer) === "sudoku").length > 1
		) {
			return "Only one Sudoku UDP layer is allowed.";
		}
		if (
			direction === "udp" &&
			layers.filter((layer) => ["realm", "xicmp"].includes(maskType(layer)))
				.length > 1
		) {
			return "Realm and XICMP are mutually exclusive.";
		}
	}
	if (
		Array.isArray(value.udp) &&
		value.udp.some((layer) => ["realm", "xicmp"].includes(maskType(layer))) &&
		hasActiveUdpHop(value.quicParams)
	) {
		return "Realm and XICMP cannot be combined with QUIC UDP hopping.";
	}
	return null;
};

export const FINAL_MASK_TCP_TYPES = TCP_TYPES;
export const FINAL_MASK_UDP_TYPES = UDP_TYPES;
