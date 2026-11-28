export type XhttpDownloadForm = {
	enabled: boolean;
	headers: string;
	settings: Record<string, any>;
};

export type XhttpFieldSpec = {
	path: string;
	type?: "bool" | "int" | "list";
	options?: string[];
};

const PLACEMENTS = ["path", "cookie", "header", "query"];

export const XHTTP_SHARED_KEYS = [
	"xPaddingBytes",
	"xPaddingObfsMode",
	"xPaddingKey",
	"xPaddingHeader",
	"xPaddingPlacement",
	"xPaddingMethod",
	"sessionIDPlacement",
	"sessionIDKey",
	"sessionIDTable",
	"sessionIDLength",
	"seqPlacement",
	"seqKey",
];

const xhttp = (key: string, extra: Omit<XhttpFieldSpec, "path"> = {}) => ({
	path: `xhttpSettings.${key}`,
	...extra,
});

export const XHTTP_DOWNLOAD_GROUPS: Record<string, XhttpFieldSpec[]> = {
	xhttp: [
		xhttp("host"),
		xhttp("path"),
		xhttp("mode", { options: ["auto", "packet-up", "stream-up"] }),
		xhttp("noGRPCHeader", { type: "bool" }),
		xhttp("scMaxEachPostBytes"),
		xhttp("scMinPostsIntervalMs"),
		xhttp("uplinkHTTPMethod"),
		xhttp("uplinkDataPlacement", {
			options: ["auto", "body", "header", "cookie"],
		}),
		xhttp("uplinkDataKey"),
		xhttp("uplinkChunkSize"),
	],
	obfs: [
		xhttp("xPaddingBytes"),
		xhttp("xPaddingObfsMode", { type: "bool" }),
		xhttp("xPaddingKey"),
		xhttp("xPaddingHeader"),
		xhttp("xPaddingPlacement", {
			options: ["cookie", "header", "query", "queryInHeader"],
		}),
		xhttp("xPaddingMethod", { options: ["repeat-x", "tokenish"] }),
		xhttp("sessionIDPlacement", { options: PLACEMENTS }),
		xhttp("sessionIDKey"),
		xhttp("sessionIDTable"),
		xhttp("sessionIDLength"),
		xhttp("seqPlacement", { options: PLACEMENTS }),
		xhttp("seqKey"),
	],
	xmux: [
		xhttp("xmux.maxConcurrency"),
		xhttp("xmux.maxConnections"),
		xhttp("xmux.cMaxReuseTimes"),
		xhttp("xmux.hMaxRequestTimes"),
		xhttp("xmux.hMaxReusableSecs"),
		xhttp("xmux.hKeepAlivePeriod", { type: "int" }),
	],
	tls: [
		{ path: "tlsSettings.serverName" },
		{ path: "tlsSettings.fingerprint" },
		{ path: "tlsSettings.alpn", type: "list" },
		{ path: "tlsSettings.pinnedPeerCertSha256" },
		{ path: "tlsSettings.verifyPeerCertByName" },
		{ path: "tlsSettings.echConfigList" },
	],
	reality: [
		{ path: "realitySettings.serverName" },
		{ path: "realitySettings.fingerprint" },
		{ path: "realitySettings.publicKey" },
		{ path: "realitySettings.shortId" },
		{ path: "realitySettings.spiderX" },
		{ path: "realitySettings.mldsa65Verify" },
	],
	sockopt: [
		{ path: "sockopt.dialerProxy" },
		{ path: "sockopt.domainStrategy" },
		{ path: "sockopt.interface" },
		{ path: "sockopt.mark", type: "int" },
		{ path: "sockopt.tcpcongestion" },
		{ path: "sockopt.tcpFastOpen", type: "bool" },
		{ path: "sockopt.tcpMptcp", type: "bool" },
		{ path: "sockopt.penetrate", type: "bool" },
		{ path: "sockopt.tcpKeepAliveIdle", type: "int" },
		{ path: "sockopt.tcpKeepAliveInterval", type: "int" },
		{ path: "sockopt.tcpUserTimeout", type: "int" },
		{ path: "sockopt.tcpMaxSeg", type: "int" },
		{ path: "sockopt.tcpWindowClamp", type: "int" },
	],
};

export const createDefaultXhttpDownload = (): XhttpDownloadForm => ({
	enabled: false,
	headers: "",
	settings: { address: "", port: 443, security: "tls" },
});

const isObject = (value: unknown): value is Record<string, any> =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);

const prune = (value: unknown): any => {
	if (typeof value === "string") return value.trim() || undefined;
	if (Array.isArray(value)) return value.length ? value : undefined;
	if (!isObject(value)) return value ?? undefined;
	const entries = Object.entries(value)
		.map(([key, item]) => [key, prune(item)] as const)
		.filter(([, item]) => item !== undefined);
	return entries.length ? Object.fromEntries(entries) : undefined;
};

export const headersToLines = (headers: unknown): string =>
	isObject(headers)
		? Object.entries(headers)
				.map(([name, value]) => `${name}: ${value}`)
				.join("\n")
		: "";

const headersFromLines = (lines: string) =>
	Object.fromEntries(
		lines
			.split("\n")
			.map((line) => {
				const colon = line.indexOf(":");
				return colon > 0
					? [line.slice(0, colon).trim(), line.slice(colon + 1).trim()]
					: ["", ""];
			})
			.filter(([name]) => name),
	);

export const flattenXhttpExtra = (raw: unknown): Record<string, any> => {
	if (!isObject(raw)) return {};
	const copy = JSON.parse(JSON.stringify(raw));
	if (!isObject(copy.extra)) return copy;
	const { extra, host, path, mode } = copy;
	return JSON.parse(JSON.stringify({ ...extra, host, path, mode }));
};

export const xhttpDownloadFromRaw = (raw: unknown): XhttpDownloadForm => {
	if (!isObject(raw)) return createDefaultXhttpDownload();
	const settings = JSON.parse(JSON.stringify(raw));
	const nested = flattenXhttpExtra(
		settings.xhttpSettings ?? settings.splithttpSettings,
	);
	delete settings.splithttpSettings;
	const { headers, ...xhttpSettings } = nested;
	return {
		enabled: true,
		headers: headersToLines(headers),
		settings: { security: "none", ...settings, xhttpSettings },
	};
};

const toInt = (value: unknown) =>
	typeof value === "string" && /^-?\d+$/.test(value.trim())
		? Number(value)
		: value;

export const buildXhttpDownload = (
	form: XhttpDownloadForm,
	uploadPath: string,
): Record<string, any> | undefined => {
	if (!form.enabled) return undefined;
	const settings = JSON.parse(JSON.stringify(form.settings));
	for (const spec of Object.values(XHTTP_DOWNLOAD_GROUPS).flat()) {
		const keys = spec.path.split(".");
		const last = keys.pop() as string;
		const parent = keys.reduce((node, key) => node?.[key], settings);
		if (!parent) continue;
		if (spec.type === "int") parent[last] = toInt(parent[last]);
		if (spec.type === "bool" && parent[last] === false) delete parent[last];
	}
	if (settings.security !== "tls") delete settings.tlsSettings;
	if (settings.security !== "reality") delete settings.realitySettings;
	return prune({
		...settings,
		port: toInt(settings.port),
		network: "xhttp",
		xhttpSettings: {
			...settings.xhttpSettings,
			path: settings.xhttpSettings?.path?.trim() || uploadPath,
			headers: headersFromLines(form.headers),
		},
	});
};

export type XhttpDownloadErrorKey =
	| "xhttpDownload"
	| "xhttpDownloadAddress"
	| "xhttpDownloadPort"
	| "xhttpDownloadServerName"
	| "xhttpDownloadPublicKey";

export const validateXhttpDownload = (
	form: XhttpDownloadForm,
	uploadMode: string,
): Partial<Record<XhttpDownloadErrorKey, string>> => {
	const errors: Partial<Record<XhttpDownloadErrorKey, string>> = {};
	if (!form.enabled) return errors;
	const { settings } = form;
	if (uploadMode === "stream-one") {
		errors.xhttpDownload =
			"Download settings cannot be used with stream-one mode.";
	}
	if (!String(settings.address ?? "").trim()) {
		errors.xhttpDownloadAddress = "Download address is required.";
	}
	const port = Number(settings.port);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		errors.xhttpDownloadPort =
			"Download port must be a number between 1 and 65535.";
	}
	if (settings.security === "reality") {
		if (!settings.realitySettings?.serverName?.trim()) {
			errors.xhttpDownloadServerName = "REALITY requires a server name.";
		}
		if (
			!(
				settings.realitySettings?.publicKey ||
				settings.realitySettings?.password
			)
		) {
			errors.xhttpDownloadPublicKey = "REALITY requires a public key.";
		}
	}
	return errors;
};
