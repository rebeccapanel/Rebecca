export type WireguardPeerJson = {
	publicKey: string;
	preSharedKey?: string;
	allowedIPs: string[];
	endpoint: string;
	keepAlive?: number;
};

export type WireguardOutboundJson = {
	tag: string;
	protocol: "wireguard";
	settings: {
		secretKey: string;
		address: string[];
		mtu?: number;
		reserved?: number[];
		remoteDNS?: string[];
		noKernelTun?: boolean;
		workers?: number;
		domainStrategy?: string;
		peers: WireguardPeerJson[];
	};
};

export type WireguardImport =
	| { ok: true; outbound: WireguardOutboundJson; warnings: string[] }
	| { ok: false; error: string };

const DEFAULT_ALLOWED = ["0.0.0.0/0", "::/0"];
const LABEL = /^\s*(privatekey|private-key|private_key|publickey|public-key|public_key|presharedkey|pre-shared-key|pre_shared_key|psk|endpoint)\s*[=:]\s*/i;

const clean = (value: unknown): string => {
	let text = String(value ?? "").replace(/^﻿/, "").trim();
	for (let i = 0; i < 3; i++) {
		const stripped = text.replace(LABEL, "").trim().replace(/^["'`]|["'`,;]$/g, "").trim();
		if (stripped === text) break;
		text = stripped;
	}
	return text;
};

const list = (value: unknown): string[] => {
	if (Array.isArray(value)) return value.flatMap((item) => list(item));
	return String(value ?? "")
		.replace(/^\[|\]$/g, "")
		.split(/[,\s]+/)
		.map((item) => item.replace(/^["']|["']$/g, "").trim())
		.filter(Boolean);
};

const decodeBase64 = (value: string): Uint8Array | null => {
	const normalized = value.replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
	if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length === 0) return null;
	const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
	try {
		const raw = atob(padded);
		return Uint8Array.from(raw, (char) => char.charCodeAt(0));
	} catch {
		return null;
	}
};

export const normalizeWireguardKey = (value: unknown): string => {
	const text = clean(value);
	const bytes = decodeBase64(text);
	if (!bytes || bytes.length !== 32) return text;
	let binary = "";
	bytes.forEach((byte) => {
		binary += String.fromCharCode(byte);
	});
	return btoa(binary);
};

const isKey = (value: string): boolean => decodeBase64(value)?.length === 32;

const parseEndpoint = (value: unknown, port?: unknown): string => {
	const text = clean(value);
	if (!text) return "";
	if (port !== undefined && port !== null && String(port).trim() !== "" && !/:\d+$/.test(text)) {
		return text.includes(":") && !text.startsWith("[") ? `[${text}]:${port}` : `${text}:${port}`;
	}
	return text;
};

const parseReserved = (value: unknown): number[] | undefined => {
	if (value === undefined || value === null || value === "") return undefined;
	if (Array.isArray(value)) {
		const numbers = value.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item >= 0 && item <= 255);
		return numbers.length === 3 ? numbers : undefined;
	}
	const text = String(value).trim();
	const numbers = list(text).map((item) => Number(item));
	if (numbers.length === 3 && numbers.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)) return numbers;
	const bytes = decodeBase64(text);
	if (bytes && bytes.length === 3) return Array.from(bytes);
	return undefined;
};

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6 = /^[0-9a-f:]*:[0-9a-f:.]*$/i;
const isIp = (value: string): boolean => IPV4.test(value) || (IPV6.test(value) && value.includes(":"));

const WG_DOMAIN_STRATEGIES = ["ForceIP", "ForceIPv4", "ForceIPv4v6", "ForceIPv6", "ForceIPv6v4"];

const toBool = (value: unknown): boolean | undefined => {
	if (typeof value === "boolean") return value;
	const text = String(value ?? "").trim().toLowerCase();
	if (text === "true" || text === "1" || text === "yes") return true;
	if (text === "false" || text === "0" || text === "no") return false;
	return undefined;
};

const toNumber = (value: unknown): number | undefined => {
	const parsed = Number(String(value ?? "").trim());
	return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : undefined;
};

type RawPeer = Record<string, unknown>;

type Raw = {
	tag?: string;
	secretKey: string;
	address: string[];
	mtu?: number;
	reserved?: number[];
	dns?: string[];
	noKernelTun?: boolean;
	workers?: number;
	domainStrategy?: string;
	peers: RawPeer[];
};

const finish = (raw: Raw): WireguardImport => {
	const warnings: string[] = [];
	const secretKey = normalizeWireguardKey(raw.secretKey);
	if (!secretKey) return { ok: false, error: "The private key is missing." };
	if (!isKey(secretKey)) return { ok: false, error: "The private key is not a valid WireGuard key (32 bytes in base64)." };
	const peers: WireguardPeerJson[] = [];
	for (const peer of raw.peers) {
		const publicKey = normalizeWireguardKey(peer.publicKey);
		if (!publicKey) continue;
		if (!isKey(publicKey)) return { ok: false, error: "A peer public key is not a valid WireGuard key (32 bytes in base64)." };
		const preSharedKey = peer.preSharedKey ? normalizeWireguardKey(peer.preSharedKey) : "";
		if (preSharedKey && !isKey(preSharedKey)) return { ok: false, error: "A peer pre-shared key is not a valid WireGuard key (32 bytes in base64)." };
		const endpoint = parseEndpoint(peer.endpoint, peer.port);
		if (!endpoint) warnings.push("A peer has no endpoint.");
		const allowed = list(peer.allowedIPs);
		const entry: WireguardPeerJson = {
			publicKey,
			allowedIPs: allowed.length ? allowed : [...DEFAULT_ALLOWED],
			endpoint,
		};
		if (preSharedKey) entry.preSharedKey = preSharedKey;
		const keepAlive = toNumber(peer.keepAlive);
		if (keepAlive) entry.keepAlive = keepAlive;
		peers.push(entry);
	}
	if (peers.length === 0) return { ok: false, error: "No peer public key was found." };
	if (raw.address.length === 0) warnings.push("The interface has no address.");
	const settings: WireguardOutboundJson["settings"] = { secretKey, address: raw.address, peers };
	if (raw.mtu) settings.mtu = raw.mtu;
	if (raw.reserved) settings.reserved = raw.reserved;
	if (raw.dns && raw.dns.length) {
		const ips = raw.dns.filter(isIp);
		if (ips.length) settings.remoteDNS = ips;
		if (ips.length < raw.dns.length) warnings.push("DNS entries that are not IP addresses were skipped (Xray remoteDNS accepts IPs only).");
	}
	if (raw.noKernelTun !== undefined) settings.noKernelTun = raw.noKernelTun;
	if (raw.workers) settings.workers = raw.workers;
	if (raw.domainStrategy && WG_DOMAIN_STRATEGIES.includes(raw.domainStrategy)) settings.domainStrategy = raw.domainStrategy;
	return { ok: true, outbound: { tag: raw.tag?.trim() || "wireguard-import", protocol: "wireguard", settings }, warnings };
};

const peerFromAny = (item: Record<string, unknown>): RawPeer => ({
	publicKey: item.publicKey ?? item.public_key ?? item["public-key"] ?? item.publickey,
	preSharedKey: item.preSharedKey ?? item.pre_shared_key ?? item["pre-shared-key"] ?? item.presharedkey ?? item.psk,
	allowedIPs: item.allowedIPs ?? item.allowed_ips ?? item["allowed-ips"] ?? item.allowedips,
	endpoint: item.endpoint,
	port: item.port ?? item.server_port,
	keepAlive: item.keepAlive ?? item.persistent_keepalive_interval ?? item.persistentkeepalive ?? item["persistent-keepalive"] ?? item.keepalive,
});

const fromObject = (obj: Record<string, unknown>): Raw | null => {
	const settings = (obj.settings && typeof obj.settings === "object" ? obj.settings : obj) as Record<string, unknown>;
	const protocol = String(obj.protocol ?? obj.type ?? "").toLowerCase();
	if (protocol && protocol !== "wireguard") return null;
	const privateKey = settings.secretKey ?? settings.private_key ?? settings["private-key"] ?? settings.privateKey ?? settings.privatekey;
	if (!privateKey) return null;
	const peersInput = Array.isArray(settings.peers) ? (settings.peers as Record<string, unknown>[]) : [];
	let peers: RawPeer[] = peersInput.map((item) => {
		const peer = peerFromAny(item);
		if (!peer.endpoint && item.address) peer.endpoint = item.address;
		return peer;
	});
	if (peers.length === 0 && (settings.publicKey || settings["public-key"] || settings.public_key)) {
		peers = [
			{
				publicKey: settings.publicKey ?? settings["public-key"] ?? settings.public_key,
				preSharedKey: settings["pre-shared-key"] ?? settings.preSharedKey,
				allowedIPs: settings["allowed-ips"] ?? settings.allowedIPs,
				endpoint: settings.server ?? settings.endpoint,
				port: settings.port,
				keepAlive: settings.keepalive ?? settings.keepAlive,
			},
		];
	}
	const address = list(settings.address ?? settings.addresses ?? []);
	for (const key of ["ip", "ipv6"]) {
		const value = settings[key];
		if (typeof value === "string" && value.trim()) address.push(...list(value).map((item) => (item.includes("/") ? item : `${item}/${item.includes(":") ? 128 : 32}`)));
	}
	return {
		tag: typeof obj.tag === "string" ? obj.tag : typeof obj.name === "string" ? obj.name : undefined,
		secretKey: String(privateKey),
		address,
		mtu: toNumber(settings.mtu),
		reserved: parseReserved(settings.reserved),
		dns: list(settings.remoteDNS ?? settings.remote_dns ?? settings["remote-dns"] ?? settings.dns ?? []),
		noKernelTun: toBool(settings.noKernelTun ?? settings.no_kernel_tun ?? settings["no-kernel-tun"]),
		workers: toNumber(settings.workers),
		domainStrategy: typeof settings.domainStrategy === "string" ? settings.domainStrategy : undefined,
		peers,
	};
};

const findWireguardObject = (value: unknown): Record<string, unknown> | null => {
	if (Array.isArray(value)) {
		for (const item of value) {
			const found = findWireguardObject(item);
			if (found) return found;
		}
		return null;
	}
	if (!value || typeof value !== "object") return null;
	const obj = value as Record<string, unknown>;
	const protocol = String(obj.protocol ?? obj.type ?? "").toLowerCase();
	if (protocol === "wireguard" && fromObject(obj)) return obj;
	for (const key of ["outbounds", "endpoints", "proxies", "outbound"]) {
		if (obj[key]) {
			const found = findWireguardObject(obj[key]);
			if (found) return found;
		}
	}
	return null;
};

const fromJsonText = (text: string): Raw | null => {
	if (!/^[[{]/.test(text)) return null;
	try {
		const found = findWireguardObject(JSON.parse(text));
		return found ? fromObject(found) : null;
	} catch {
		return null;
	}
};

const fromUri = (text: string): Raw | null => {
	if (!/^(wireguard|wg):\/\//i.test(text)) return null;
	const body = text.replace(/^(wireguard|wg):\/\//i, "");
	const [beforeFragment, fragment = ""] = body.split("#");
	const [authority, query = ""] = beforeFragment.split("?");
	const at = authority.lastIndexOf("@");
	const userinfo = at >= 0 ? authority.slice(0, at) : "";
	const hostPort = at >= 0 ? authority.slice(at + 1) : authority;
	const params = new Map<string, string>();
	for (const pair of query.split("&")) {
		if (!pair) continue;
		const index = pair.indexOf("=");
		const key = decodeURIComponentSafe(index >= 0 ? pair.slice(0, index) : pair).toLowerCase();
		const value = decodeURIComponentSafe(index >= 0 ? pair.slice(index + 1).replace(/\+/g, "%2B") : "");
		params.set(key, value);
	}
	const get = (...names: string[]) => names.map((name) => params.get(name)).find((value) => value !== undefined && value !== "") ?? "";
	return {
		tag: decodeURIComponentSafe(fragment) || undefined,
		secretKey: decodeURIComponentSafe(userinfo.replace(/\+/g, "%2B")) || get("privatekey", "secretkey", "private_key"),
		address: list(get("address", "ip", "addresses")),
		mtu: toNumber(get("mtu")),
		reserved: parseReserved(get("reserved")),
		dns: list(get("dns", "remotedns", "remote_dns")),
		noKernelTun: toBool(get("nokerneltun", "no_kernel_tun")),
		workers: toNumber(get("workers")),
		domainStrategy: get("domainstrategy", "domain_strategy") || undefined,
		peers: [
			{
				publicKey: get("publickey", "peer_public_key", "public_key"),
				preSharedKey: get("presharedkey", "psk", "pre_shared_key"),
				allowedIPs: get("allowedips", "allowed_ips") || DEFAULT_ALLOWED.join(","),
				endpoint: hostPort,
				keepAlive: get("keepalive", "persistentkeepalive"),
			},
		],
	};
};

const decodeURIComponentSafe = (value: string): string => {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
};

const KNOWN_KEYS = new Set([
	"privatekey", "private-key", "private_key", "address", "addresses", "dns", "mtu", "reserved", "listenport", "table", "postup", "postdown", "preup", "predown",
	"publickey", "public-key", "public_key", "presharedkey", "pre-shared-key", "pre_shared_key", "psk", "allowedips", "allowed-ips", "allowed_ips", "endpoint", "persistentkeepalive", "persistent-keepalive",
]);
const PEER_KEYS = new Set(["publickey", "public-key", "public_key", "presharedkey", "pre-shared-key", "pre_shared_key", "psk", "allowedips", "allowed-ips", "allowed_ips", "endpoint", "persistentkeepalive", "persistent-keepalive"]);

const fromIni = (text: string): Raw | null => {
	const iface: Record<string, string> = {};
	const peers: Record<string, string>[] = [];
	let section: "interface" | "peer" | null = null;
	let recognised = 0;
	for (const rawLine of text.replace(/^﻿/, "").split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#") || line.startsWith(";") || line.startsWith("```")) continue;
		const header = line.match(/^\[(.+)\]$/);
		if (header) {
			const name = header[1].trim().toLowerCase();
			if (name === "interface") section = "interface";
			else if (name === "peer") {
				section = "peer";
				peers.push({});
			}
			continue;
		}
		const match = line.match(/^([A-Za-z_-]+)\s*[=:]\s*(.*)$/);
		if (!match) continue;
		const key = match[1].toLowerCase();
		if (!KNOWN_KEYS.has(key)) continue;
		recognised++;
		const value = match[2].trim();
		const isPeerKey = PEER_KEYS.has(key);
		if (section === "peer" || (section === null && isPeerKey)) {
			if (section === null) {
				section = "peer";
				peers.push({});
			}
			if (peers.length === 0) peers.push({});
			const current = peers[peers.length - 1];
			if ((key === "publickey" || key === "public-key" || key === "public_key") && current.publickey) peers.push({});
			peers[peers.length - 1][key.replace(/[-_]/g, "")] = value;
		} else {
			iface[key.replace(/[-_]/g, "")] = value;
		}
	}
	if (recognised === 0 || !iface.privatekey) return null;
	return {
		secretKey: iface.privatekey,
		address: list(iface.address ?? iface.addresses ?? ""),
		mtu: toNumber(iface.mtu),
		reserved: parseReserved(iface.reserved),
		dns: list(iface.dns ?? ""),
		peers: peers.map((peer) => ({
			publicKey: peer.publickey,
			preSharedKey: peer.presharedkey || peer.psk,
			allowedIPs: peer.allowedips,
			endpoint: peer.endpoint,
			keepAlive: peer.persistentkeepalive,
		})),
	};
};

const fromYamlLike = (text: string): Raw | null => {
	if (!/^\s*-?\s*(name|type)\s*:/im.test(text) || !/type\s*:\s*["']?wireguard/i.test(text)) return null;
	const obj: Record<string, unknown> = {};
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.replace(/^\s*-\s*/, "").trim();
		if (!line || line.startsWith("#") || line === "proxies:") continue;
		const match = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
		if (!match) continue;
		const value = match[2].trim();
		if (value.startsWith("{") || value.startsWith("[")) {
			try {
				obj[match[1]] = JSON.parse(value);
				continue;
			} catch {
				obj[match[1]] = value.replace(/^[[{]|[\]}]$/g, "");
				continue;
			}
		}
		obj[match[1]] = value.replace(/^["']|["']$/g, "");
	}
	return fromObject({ ...obj, protocol: "wireguard" });
};

export const looksLikeWireguard = (input: string): boolean => {
	const text = input.trim();
	return (
		/^(wireguard|wg):\/\//i.test(text) ||
		/(^|\n)\s*\[interface\]/i.test(text) ||
		/(^|\n)\s*(private[-_]?key)\s*[=:]/i.test(text) ||
		(/^[[{]/.test(text) && /wireguard/i.test(text) && /(private[-_]?key|secretKey)/i.test(text)) ||
		/type\s*:\s*["']?wireguard/i.test(text)
	);
};

export const parseWireguardImport = (input: string): WireguardImport | null => {
	const text = input.replace(/^﻿/, "").trim();
	if (!text || !looksLikeWireguard(text)) return null;
	const raw = fromJsonText(text) ?? fromUri(text) ?? fromYamlLike(text) ?? fromIni(text);
	if (!raw) return { ok: false, error: "The WireGuard config could not be read. Expected a .conf, a wireguard:// link or an outbound JSON." };
	return finish(raw);
};

export const splitWireguardConfigs = (input: string): string[] => {
	const text = input.replace(/^﻿/, "").trim();
	const parts = text.split(/\r?\n(?=[ \t]*\[interface\][ \t]*(?:\r?\n|$))/i);
	if (parts.length < 2) return [text];
	const head = parts[0];
	if (/^\s*\[interface\]/i.test(head)) return parts.map((part) => part.trim()).filter(Boolean);
	return [`${head}\n${parts[1]}`.trim(), ...parts.slice(2).map((part) => part.trim())].filter(Boolean);
};
