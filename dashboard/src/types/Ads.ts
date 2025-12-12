export type AdType = "text" | "image";

export interface AdItem {
	id: string;
	type: AdType;
	title?: string;
	text?: string;
	image_url?: string;
	link?: string;
	cta?: string;
	metadata?: Record<string, unknown>;
}

export interface PlacementAds {
	header: AdItem[];
	sidebar: AdItem[];
}

export interface AdsResponse {
	default: PlacementAds;
	locales?: Record<string, PlacementAds>;
}
