const ALPHANUMERIC =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

const randomBytes = (length: number) =>
	crypto.getRandomValues(new Uint8Array(length));

export const randomPassword = (length = 24): string => {
	let result = "";
	while (result.length < length) {
		for (const byte of randomBytes(length)) {
			if (byte < 248 && result.length < length) {
				result += ALPHANUMERIC[byte % ALPHANUMERIC.length];
			}
		}
	}
	return result;
};

export const randomBase64 = (length: number): string =>
	btoa(String.fromCharCode(...randomBytes(length)));

const shadowsocksKeyBytes = (method: string): number => {
	if (!method.startsWith("2022-")) return 0;
	return method === "2022-blake3-aes-128-gcm" ? 16 : 32;
};

export const randomShadowsocksPassword = (method: string): string => {
	const length = shadowsocksKeyBytes(method);
	return length ? randomBase64(length) : randomPassword();
};

export const shadowsocksPasswordFor = (
	method: string,
	current: string,
): string => {
	const length = shadowsocksKeyBytes(method);
	if (!length) return current.trim() || randomPassword();
	try {
		if (atob(current.trim()).length === length) return current;
	} catch {}
	return randomShadowsocksPassword(method);
};

export const openvpnStaticKey = (): string => {
	const hex = Array.from(randomBytes(256), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
	return [
		"-----BEGIN OpenVPN Static key V1-----",
		...(hex.match(/.{32}/g) ?? []),
		"-----END OpenVPN Static key V1-----",
	].join("\n");
};

const VLESS_ENC_PREFIX = "mlkem768x25519plus";
export const VLESS_ENC_MODES = ["native", "xorpub", "random"];
const MAX_PADDING_BLOCK = 19;

export type VlessEnc = {
	mode: string;
	ticket: string;
	padding: string;
	keys: string;
};

export const parseVlessEnc = (value: string): VlessEnc | null => {
	const [prefix, mode, ticket, ...rest] = value.trim().split(".");
	if (prefix !== VLESS_ENC_PREFIX || !rest.length) return null;
	const keyStart = rest.findIndex((part) => part.length > MAX_PADDING_BLOCK);
	if (keyStart < 0) return null;
	return {
		mode,
		ticket,
		padding: rest.slice(0, keyStart).join("."),
		keys: rest.slice(keyStart).join("."),
	};
};

export const formatVlessEnc = ({ mode, ticket, padding, keys }: VlessEnc) =>
	[VLESS_ENC_PREFIX, mode, ticket, padding, keys].filter(Boolean).join(".");

export const keepVlessEncOptions = (next: string, current: string): string => {
	const parsedNext = parseVlessEnc(next);
	const parsedCurrent = parseVlessEnc(current);
	if (!parsedNext || !parsedCurrent) return next;
	return formatVlessEnc({
		...parsedNext,
		ticket: parsedCurrent.ticket,
		padding: parsedCurrent.padding,
	});
};

export const isVlessServerTicket = (value: string): boolean =>
	/^\d+(-\d+)?s$/.test(value);

export const isVlessPadding = (value: string): boolean => {
	if (!value) return true;
	let total = 0;
	const blocks = value.split(".");
	for (const [index, block] of blocks.entries()) {
		if (block.length > MAX_PADDING_BLOCK || !/^\d+-\d+-\d+$/.test(block)) {
			return false;
		}
		const [chance, min, max] = block.split("-").map(Number);
		if (index === 0 && (chance < 100 || min < 35 || max < 35)) return false;
		if (index % 2 === 0) total += Math.max(min, max);
	}
	return total <= 65_553;
};

export const vlessAuthLabelForMode = (label: string, mode: string): string => {
	if (!label) return label;
	const base = label.replace(/ \((xorpub|random)\)$/, "");
	return mode === "native" ? base : `${base} (${mode})`;
};
