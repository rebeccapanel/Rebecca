export type LeastLoadCost = {
	match: string;
	regexp: boolean;
	value: number;
};

export type LeastLoadSettings = {
	expected?: number;
	maxRTT?: string;
	tolerance?: number;
	baselines?: string[];
	costs?: LeastLoadCost[];
};

export const cleanLeastLoadSettings = (
	settings?: LeastLoadSettings,
): LeastLoadSettings | undefined => {
	if (!settings) return undefined;
	const cleaned: LeastLoadSettings = {};
	if (typeof settings.expected === "number" && Number.isFinite(settings.expected)) {
		cleaned.expected = settings.expected;
	}
	if (settings.maxRTT?.trim()) cleaned.maxRTT = settings.maxRTT.trim();
	if (typeof settings.tolerance === "number" && Number.isFinite(settings.tolerance)) {
		cleaned.tolerance = settings.tolerance;
	}
	const baselines = (settings.baselines ?? []).map((item) => item.trim()).filter(Boolean);
	if (baselines.length) cleaned.baselines = baselines;
	const costs = (settings.costs ?? [])
		.map((cost) => ({ ...cost, match: cost.match.trim() }))
		.filter((cost) => cost.match && Number.isFinite(cost.value));
	if (costs.length) cleaned.costs = costs;
	return Object.keys(cleaned).length ? cleaned : undefined;
};
