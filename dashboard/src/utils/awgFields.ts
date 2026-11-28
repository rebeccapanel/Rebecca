export type AwgExtraField = {
	key: string;
	label: string;
	type?: "int" | "bool";
	placeholder?: string;
};

export const AWG_EXTRA_FIELDS: AwgExtraField[] = [
	{ key: "s3", label: "S3", type: "int", placeholder: "20" },
	{ key: "s4", label: "S4", type: "int", placeholder: "16" },
	{ key: "i1", label: "I1", placeholder: "<r 128>" },
	{ key: "i2", label: "I2" },
	{ key: "i3", label: "I3" },
	{ key: "i4", label: "I4" },
	{ key: "i5", label: "I5" },
	{ key: "header_protection_key", label: "HeaderProtectionKey" },
	{
		key: "content_padding_addition",
		label: "ContentPaddingAddition",
		placeholder: "8-24",
	},
	{ key: "rekey_after_time", label: "RekeyAfterTime", placeholder: "100-120" },
	{ key: "rekey_timeout", label: "RekeyTimeout", placeholder: "3-7" },
	{
		key: "reject_after_time",
		label: "RejectAfterTime",
		placeholder: "170-200",
	},
	{ key: "keepalive_timeout", label: "KeepaliveTimeout", placeholder: "8-15" },
	{
		key: "max_handshake_attempts",
		label: "MaxHandshakeAttempts",
		placeholder: "18-30",
	},
	{ key: "random_trailers", label: "RandomTrailers", type: "bool" },
	{ key: "disable_cookies", label: "DisableCookies", type: "bool" },
];

export const awgExtraFromSettings = (
	settings: Record<string, any>,
): Record<string, any> =>
	Object.fromEntries(
		AWG_EXTRA_FIELDS.map(({ key, type }) => [
			key,
			type === "bool" ? Boolean(settings[key]) : String(settings[key] ?? ""),
		]),
	);

export const awgExtraToSettings = (
	extra: Record<string, any>,
): Record<string, any> => {
	const settings: Record<string, any> = {};
	for (const { key, type } of AWG_EXTRA_FIELDS) {
		if (type === "bool") {
			if (extra[key]) settings[key] = true;
			continue;
		}
		const text = String(extra[key] ?? "").trim();
		if (!text) continue;
		settings[key] = type === "int" && /^\d+$/.test(text) ? Number(text) : text;
	}
	return settings;
};

export const awgHeaderValue = (value: string): number | string | undefined => {
	const text = value.replace(/\s/g, "");
	if (!text) return undefined;
	return /^\d+$/.test(text) ? Number(text) : text;
};

export const isAwgHeader = (value: string) => {
	const match = /^(\d+)(?:-(\d+))?$/.exec(value.replace(/\s/g, ""));
	if (!match) return false;
	const low = Number(match[1]);
	const high = Number(match[2] ?? match[1]);
	return low <= high && high <= 4294967295;
};

const randomInt = (min: number, max: number) => {
	const [value] = crypto.getRandomValues(new Uint32Array(1));
	return min + (value % (max - min + 1));
};

export const generateAwgParameters = () => {
	const range = (low: number, width: number) =>
		`${low}-${low + randomInt(2, width)}`;
	const s1 = randomInt(15, 150);
	let s2 = randomInt(15, 150);
	while (s1 + 56 === s2) s2 = randomInt(15, 150);
	const band = 500_000_000;
	const [h1, h2, h3, h4] = [0, 1, 2, 3].map((index) =>
		String(randomInt(index * band + 5, (index + 1) * band)),
	);
	const jmin = randomInt(40, 89);
	const rekey = randomInt(100, 115);
	return {
		jc: String(randomInt(3, 6)),
		jmin: String(jmin),
		jmax: String(jmin + randomInt(50, 250)),
		s1: String(s1),
		s2: String(s2),
		h1,
		h2,
		h3,
		h4,
		extra: {
			s3: String(randomInt(12, 55)),
			s4: String(randomInt(12, 27)),
			i1: `<r ${randomInt(32, 256)}>`,
			i2: "",
			i3: "",
			i4: "",
			i5: "",
			header_protection_key: btoa(
				String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
			),
			content_padding_addition: range(randomInt(8, 20), 30),
			rekey_after_time: range(rekey, 20),
			rekey_timeout: range(randomInt(3, 5), 4),
			reject_after_time: range(rekey + randomInt(60, 80), 60),
			keepalive_timeout: range(randomInt(8, 10), 8),
			max_handshake_attempts: range(randomInt(15, 22), 20),
			random_trailers: true,
			disable_cookies: false,
		} as Record<string, any>,
	};
};
