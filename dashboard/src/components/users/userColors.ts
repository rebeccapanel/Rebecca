import type { Status } from "types/User";

/**
 * Deterministic hue (0-359) for a name so the same admin/reseller always
 * renders with the same accent color across sessions and pages.
 */
export const hashNameToHue = (name: string): number => {
	let hash = 0;
	for (let index = 0; index < name.length; index += 1) {
		hash = (hash * 31 + name.charCodeAt(index)) | 0;
	}
	return Math.abs(hash) % 360;
};

export const avatarGradient = (username: string): string => {
	const hue = hashNameToHue(username);
	const secondHue = (hue + 42) % 360;
	return `linear-gradient(135deg, hsl(${hue} 70% 52%), hsl(${secondHue} 72% 40%))`;
};

const STATUS_RING_COLORS: Record<Status, string> = {
	active: "#22c55e",
	connected: "#22c55e",
	disabled: "#9ca3af",
	expired: "#f97316",
	on_hold: "#a855f7",
	connecting: "#f97316",
	limited: "#ef4444",
	error: "#ef4444",
};

export const statusRingColor = (status: Status): string =>
	STATUS_RING_COLORS[status] ?? "#9ca3af";

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
