export const updateThemeColor = (themeName: string, fallback?: string) => {
	const el = document.querySelector('meta[name="theme-color"]');
	const map: Record<string, string> = {
		dark: "#101010",
		light: "#f4f5f7",
		custom: fallback || "#101010",
	};
	const color = fallback || map[themeName] || map.dark;
	el?.setAttribute("content", color);
};
