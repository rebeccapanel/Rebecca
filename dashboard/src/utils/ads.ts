import type { AdsResponse } from "types/Ads";

export type AdPlacement = "header" | "sidebar";

const normalizeLocale = (locale?: string) =>
	(locale || "en").split(/[-_]/)[0].toLowerCase();

export const pickLocalizedAd = (
	ads: AdsResponse | undefined,
	placement: AdPlacement,
	locale?: string,
) => {
	if (!ads) {
		return undefined;
	}

	const normalized = normalizeLocale(locale);
	const localizedPlacement = ads.locales?.[normalized]?.[placement];
	if (localizedPlacement?.length) {
		return localizedPlacement[0];
	}

	const defaultPlacement = ads.default?.[placement];
	return defaultPlacement?.[0];
};
