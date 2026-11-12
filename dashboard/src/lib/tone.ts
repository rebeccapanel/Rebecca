const TONES: Record<string, string> = {
	gray: "bg-panel-elevated text-panel-text-secondary",
	primary: "bg-panel-accent/15 text-panel-accent",
	red: "bg-red-500/15 text-red-600 dark:text-red-300",
	green: "bg-green-500/15 text-green-600 dark:text-green-300",
	blue: "bg-blue-500/15 text-blue-600 dark:text-blue-300",
	orange: "bg-orange-500/15 text-orange-600 dark:text-orange-300",
	yellow: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300",
	purple: "bg-purple-500/15 text-purple-600 dark:text-purple-300",
	teal: "bg-teal-500/15 text-teal-600 dark:text-teal-300",
};

export const toneClass = (tone?: string | null) => {
	const name = (tone ?? "gray").split(".")[0];
	return TONES[name] ?? TONES.gray;
};

const BARS: Record<string, string> = {
	gray: "bg-panel-text-muted",
	primary: "bg-panel-accent",
	red: "bg-red-500",
	green: "bg-green-500",
	blue: "bg-blue-500",
	orange: "bg-orange-500",
	yellow: "bg-yellow-500",
	purple: "bg-purple-500",
	teal: "bg-teal-500",
};

export const barClass = (tone?: string | null) => BARS[(tone ?? "primary").split(".")[0]] ?? BARS.primary;
