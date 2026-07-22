import { type FetchOptions, $fetch as ohMyFetch } from "ofetch";

const configuredBaseURL = import.meta.env.VITE_BASE_API || "";

const getDevProxyBaseURL = (baseURL: string) => {
	try {
		const parsed = new URL(baseURL);
		return parsed.pathname && parsed.pathname !== "/" ? parsed.pathname : "/api";
	} catch {
		return baseURL;
	}
};

export const apiBaseURL =
	import.meta.env.DEV && /^https?:\/\//i.test(configuredBaseURL)
		? getDevProxyBaseURL(configuredBaseURL)
		: configuredBaseURL;

export const $fetch = ohMyFetch.create({
	baseURL: apiBaseURL,
	credentials: "include",
});

export const fetcher = <T = any>(
	url: string,
	ops: FetchOptions<"json"> = {},
) => {
	const method = String(ops.method || "GET").toUpperCase();
	ops.credentials = "include";
	if (method === "GET") {
		ops.cache = "no-store";
	}
	return $fetch<T>(url, ops);
};

export const fetch = fetcher;
