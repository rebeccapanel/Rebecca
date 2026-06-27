import { getAuthToken } from "./authStorage";

export const getAPIWebSocketURL = (
	path: string,
	query: Record<string, string | number | boolean | null | undefined> = {},
) => {
	try {
		const baseAPI = import.meta.env.VITE_BASE_API;
		const baseURL = new URL(
			baseAPI.startsWith("/") ? window.location.origin + baseAPI : baseAPI,
		);
		const protocol = baseURL.protocol === "https:" ? "wss:" : "ws:";
		const basePath = baseURL.pathname.replace(/\/+$/, "");
		const apiPath = path.startsWith("/") ? path : `/${path}`;
		const params = new URLSearchParams();
		const token = getAuthToken();
		if (token) {
			params.set("token", token);
		}
		Object.entries(query).forEach(([key, value]) => {
			if (value !== null && value !== undefined && value !== "") {
				params.set(key, String(value));
			}
		});
		const qs = params.toString();
		return `${protocol}//${baseURL.host}${basePath}${apiPath}${qs ? `?${qs}` : ""}`;
	} catch (error) {
		console.error("Unable to generate websocket URL", error);
		return null;
	}
};
