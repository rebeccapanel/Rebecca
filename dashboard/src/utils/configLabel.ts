const decodeLabel = (value: string): string => {
	const normalized = value.replace(/\+/g, " ");
	try {
		return decodeURIComponent(normalized).trim();
	} catch {
		return normalized.trim();
	}
};

const extractFromHash = (link: string): string => {
	const hashIndex = link.indexOf("#");
	if (hashIndex >= 0 && hashIndex < link.length - 1) {
		return decodeLabel(link.slice(hashIndex + 1));
	}
	return "";
};

const extractFromQuery = (link: string): string => {
	const queryIndex = link.indexOf("?");
	if (queryIndex === -1) return "";
	const hashIndex = link.indexOf("#");
	const endIndex = hashIndex === -1 ? link.length : hashIndex;
	const query = link.slice(queryIndex + 1, endIndex);
	const params = new URLSearchParams(query);
	const keys = ["remark", "remarks", "ps", "name", "tag", "host"];
	for (const key of keys) {
		const value = params.get(key);
		if (value) {
			return decodeLabel(value);
		}
	}
	return "";
};

const decodeVmessName = (link: string): string => {
	if (!link.toLowerCase().startsWith("vmess://")) return "";
	let payload = link.slice(8);
	const hashIndex = payload.indexOf("#");
	if (hashIndex >= 0) {
		payload = payload.slice(0, hashIndex);
	}
	if (!payload) return "";
	let normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
	const padding = normalized.length % 4;
	if (padding) {
		normalized += "=".repeat(4 - padding);
	}
	if (typeof window === "undefined" || typeof window.atob !== "function") {
		return "";
	}
	try {
		const decoded = window.atob(normalized);
		const parsed = JSON.parse(decoded);
		const name =
			typeof parsed?.ps === "string"
				? parsed.ps
				: typeof parsed?.name === "string"
					? parsed.name
					: typeof parsed?.tag === "string"
						? parsed.tag
						: "";
		return name ? decodeLabel(name) : "";
	} catch {
		return "";
	}
};

export const getConfigLabelFromLink = (link: string): string => {
	return (
		extractFromHash(link) ||
		decodeVmessName(link) ||
		extractFromQuery(link) ||
		""
	);
};
