type AnyRecord = Record<string, unknown>;

const isObject = (value: unknown): value is AnyRecord =>
	value !== null && typeof value === "object" && !Array.isArray(value);

const normalizeOutboundConfig = (outbound: unknown): AnyRecord => {
	if (!isObject(outbound)) return {};
	const cloned: AnyRecord = { ...outbound };
	delete cloned.tag;
	return cloned;
};

const sortDeep = (value: unknown): unknown => {
	if (Array.isArray(value)) {
		return value.map(sortDeep);
	}
	if (isObject(value)) {
		const sorted: AnyRecord = {};
		for (const key of Object.keys(value).sort()) {
			sorted[key] = sortDeep(value[key]);
		}
		return sorted;
	}
	return value;
};

const stableStringify = (value: unknown): string =>
	JSON.stringify(sortDeep(value));

const bufferToHex = (buffer: ArrayBuffer): string =>
	Array.from(new Uint8Array(buffer))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");

const fallbackHash = (input: string): string => {
	// Lightweight deterministic hash (FNV-1a 32-bit) as a safety net.
	let hash = 0x811c9dc5;
	for (let i = 0; i < input.length; i += 1) {
		hash ^= input.charCodeAt(i);
		hash = (hash * 0x01000193) >>> 0;
	}
	return hash.toString(16).padStart(8, "0").slice(0, 16);
};

export const computeOutboundId = async (outbound: unknown): Promise<string> => {
	const normalized = normalizeOutboundConfig(outbound);
	const serialized = stableStringify(normalized);

	try {
		if (globalThis.crypto?.subtle?.digest) {
			const encoded = new TextEncoder().encode(serialized);
			const digest = await globalThis.crypto.subtle.digest("SHA-256", encoded);
			return bufferToHex(digest).slice(0, 16);
		}
	} catch {
		// Fall through to fallback hash.
	}

	return fallbackHash(serialized);
};

export const computeOutboundIds = async (
	outbounds: unknown[],
): Promise<string[]> => Promise.all(outbounds.map(computeOutboundId));
