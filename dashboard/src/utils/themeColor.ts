// Accept simple color-mode names ("dark"/"light"), named palettes
// ("ultra-dark", "moontone", "purple", "green", ...), or custom themes.
// Optionally pass a fallback color to override default mapping.
// The function updates meta[name="theme-color"] so mobile browsers pick a
// fitting status bar color.
export const updateThemeColor = (themeName: string, fallback?: string) => {
	const el = document.querySelector('meta[name="theme-color"]');
	const map: Record<string, string> = {
		dark: "#0f172a",
		light: "#f6f8ff",
		"ultra-dark": "#091212",
		moontone: "#0f1930",
		purple: "#1a1031",
		green: "#071c10",
		custom: fallback || "#f6f8ff",
	};
	const color = fallback || map[themeName] || map.light;
	el?.setAttribute("content", color);
};
