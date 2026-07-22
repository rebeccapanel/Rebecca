// Frontend-only display window for online badges.
const configuredWindow = Number(import.meta.env.VITE_ONLINE_ACTIVE_WINDOW_SECONDS);

export const ONLINE_ACTIVE_WINDOW_SECONDS =
	Number.isFinite(configuredWindow) && configuredWindow > 0
		? configuredWindow
		: 20;
