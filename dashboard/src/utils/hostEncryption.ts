// Host-level client encryption override: VLESS "encryption", VMess "security" or
// Shadowsocks "method". Empty or "none" inherits the inbound value.

export const HOST_ENCRYPTION_MAX_LENGTH = 8192;

export const HOST_ENCRYPTION_PLACEHOLDERS: Record<string, string> = {
	vless: "mlkem768x25519plus.native.0rtt.…",
	vmess: "auto | aes-128-gcm | chacha20-poly1305 | zero",
	shadowsocks: "aes-128-gcm | chacha20-ietf-poly1305 | 2022-blake3-…",
};

export const normalizeHostEncryption = (
	value: string | null | undefined,
): string => {
	const trimmed = (value ?? "").trim();
	return trimmed.toLowerCase() === "none" ? "" : trimmed;
};

export const hostEncryptionValid = (
	value: string | null | undefined,
): boolean => {
	const normalized = normalizeHostEncryption(value);
	if (!normalized) return true;
	if (normalized.length > HOST_ENCRYPTION_MAX_LENGTH) return false;
	for (const char of normalized) {
		const code = char.charCodeAt(0);
		if (code <= 0x20 || code === 0x7f || char === "&" || char === "#" || char === "?") {
			return false;
		}
	}
	return true;
};
