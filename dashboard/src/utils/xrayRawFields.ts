export type XrayRawField = {
	path: string;
	hint: string;
	type?: "bool" | "int" | "list" | "json";
	options?: string[];
	placeholder?: string;
};

export const TLS_RAW_FIELDS: XrayRawField[] = [
	{ path: "masterKeyLog", hint: "masterKeyLog", placeholder: "/tmp/keys.log" },
	{ path: "useSystemCA", hint: "useSystemCA", type: "bool" },
	{
		path: "echSockopt",
		hint: "echSockopt",
		type: "json",
		placeholder: '{ "dialerProxy": "direct" }',
	},
];

export const REALITY_RAW_FIELDS: XrayRawField[] = [
	{ path: "masterKeyLog", hint: "masterKeyLog", placeholder: "/tmp/keys.log" },
];

export const SOCKOPT_RAW_FIELDS: XrayRawField[] = [
	{
		path: "customSockopt",
		hint: "customSockopt",
		type: "json",
		placeholder:
			'[{ "system": "linux", "type": "int", "level": "6", "opt": "18", "value": "30000" }]',
	},
	{
		path: "addressPortStrategy",
		hint: "addressPortStrategy",
		options: [
			"none",
			"SrvPortOnly",
			"SrvAddressOnly",
			"SrvPortAndAddress",
			"TxtPortOnly",
			"TxtAddressOnly",
			"TxtPortAndAddress",
		],
	},
	{
		path: "happyEyeballs.tryDelayMs",
		hint: "tryDelayMs",
		type: "int",
		placeholder: "250",
	},
	{
		path: "happyEyeballs.prioritizeIPv6",
		hint: "prioritizeIPv6",
		type: "bool",
	},
	{
		path: "happyEyeballs.interleave",
		hint: "interleave",
		type: "int",
		placeholder: "1",
	},
	{
		path: "happyEyeballs.maxConcurrentTry",
		hint: "maxConcurrentTry",
		type: "int",
		placeholder: "4",
	},
];

export const QUIC_RAW_FIELDS: XrayRawField[] = [
	{
		path: "brutalDisableLossCompensation",
		hint: "brutalDisableLossCompensation",
		type: "bool",
	},
	{ path: "disableChromeParrot", hint: "disableChromeParrot", type: "bool" },
	{ path: "disableGSO", hint: "disableGSO", type: "bool" },
	{
		path: "disableStatelessReset",
		hint: "disableStatelessReset",
		type: "bool",
	},
];

const xdrive = (
	key: string,
	extra: Partial<XrayRawField> = {},
): XrayRawField => ({
	path: `xdriveSettings.${key}`,
	hint: `xdrive_${key.replace(/\./g, "_")}`,
	...extra,
});

export const XDRIVE_RAW_FIELDS: XrayRawField[] = [
	xdrive("service", { options: ["google-drive", "s3", "template", "local"] }),
	xdrive("remoteFolder"),
	xdrive("secrets", { type: "list" }),
	xdrive("segmentBytes", { type: "int" }),
	xdrive("flushIntervalMs", { type: "int" }),
	xdrive("pollIntervalMs", { type: "int" }),
	xdrive("maxPollIntervalMs", { type: "int" }),
	xdrive("sessionTtlSeconds", { type: "int" }),
	xdrive("concurrency", { type: "int" }),
	xdrive("eagerWindowMs", { type: "int" }),
	xdrive("holeTimeoutMs", { type: "int" }),
	xdrive("s3.endpoint"),
	xdrive("s3.region"),
	xdrive("s3.bucket"),
	xdrive("s3.pathStyle", { options: ["true", "false"], type: "bool" }),
	xdrive("template", { type: "json" }),
	xdrive("xmux", {
		type: "json",
		placeholder: '{ "maxConnections": "1" }',
	}),
];

export const parseRawField = (
	spec: XrayRawField,
	text: string,
): { ok: boolean; value: unknown } => {
	const trimmed = text.trim();
	if (!trimmed) return { ok: true, value: null };
	if (spec.type === "int") {
		return /^\d+$/.test(trimmed)
			? { ok: true, value: Number(trimmed) }
			: { ok: false, value: null };
	}
	if (spec.type === "list") {
		const items = text
			.split("\n")
			.map((item) => item.trim())
			.filter(Boolean);
		return { ok: true, value: items.length ? items : null };
	}
	if (spec.type === "json") {
		try {
			const value = JSON.parse(trimmed);
			return value && typeof value === "object"
				? { ok: true, value }
				: { ok: false, value: null };
		} catch {
			return { ok: false, value: null };
		}
	}
	return { ok: true, value: trimmed };
};

export const formatRawField = (spec: XrayRawField, value: unknown): string => {
	if (value === null || value === undefined) return "";
	if (spec.type === "json") return JSON.stringify(value, null, 2);
	if (spec.type === "list" && Array.isArray(value)) return value.join("\n");
	return String(value);
};

export const randomSpiderX = () => {
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
	const bytes = crypto.getRandomValues(new Uint8Array(12));
	return `/${Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("")}`;
};

export const pruneNulls = (value: any): any => {
	if (Array.isArray(value)) return value.map(pruneNulls);
	if (!value || typeof value !== "object") return value;
	const entries = Object.entries(value)
		.filter(([, item]) => item !== null && item !== undefined)
		.map(([key, item]) => [key, pruneNulls(item)] as const)
		.filter(
			([, item]) =>
				!(
					item &&
					typeof item === "object" &&
					!Array.isArray(item) &&
					!Object.keys(item).length
				),
		);
	return Object.fromEntries(entries);
};
