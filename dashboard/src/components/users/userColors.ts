export type UsageTone = "unlimited" | "ok" | "warn" | "critical";

export const getUsageTone = (
	percent: number,
	isUnlimited: boolean,
): UsageTone => {
	if (isUnlimited) return "unlimited";
	if (percent >= 85) return "critical";
	if (percent >= 65) return "warn";
	return "ok";
};

export const usageToneGradients: Record<UsageTone, string> = {
	unlimited: "linear-gradient(90deg, #38bdf8, #818cf8)",
	ok: "linear-gradient(90deg, #10b981, #34d399)",
	warn: "linear-gradient(90deg, #f59e0b, #fbbf24)",
	critical: "linear-gradient(90deg, #ef4444, #f43f5e)",
};
