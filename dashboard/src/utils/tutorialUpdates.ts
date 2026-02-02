const STORAGE_PREFIX = "rb-tutorials";
export const TUTORIALS_UPDATED_EVENT = "rb-tutorials-updated";

export const normalizeTutorialLang = (lang?: string | null) => {
	const normalized = (lang || "en").toLowerCase();
	return normalized.startsWith("fa") ? "fa" : "en";
};

export const getTutorialAssetUrl = (lang?: string | null) => {
	const normalized = normalizeTutorialLang(lang);
	const file = normalized === "fa" ? "totfa.json" : "toten.json";
	const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
	return `${base}/statics/locles/${file}`;
};

const getStorageKeys = (lang: string) => ({
	updated: `${STORAGE_PREFIX}-last-updated-${lang}`,
	menuIds: `${STORAGE_PREFIX}-menu-ids-${lang}`,
	unseen: `${STORAGE_PREFIX}-unseen-ids-${lang}`,
});

export const readTutorialStorage = (lang: string) => {
	if (typeof window === "undefined") {
		return {
			updated: null as string | null,
			ids: [] as string[],
			unseen: [] as string[],
		};
	}
	const keys = getStorageKeys(lang);
	const updated = window.localStorage.getItem(keys.updated);
	const rawIds = window.localStorage.getItem(keys.menuIds);
	const rawUnseen = window.localStorage.getItem(keys.unseen);
	let ids: string[] = [];
	if (rawIds) {
		try {
			const parsed = JSON.parse(rawIds);
			if (Array.isArray(parsed)) {
				ids = parsed.filter((id) => typeof id === "string");
			}
		} catch {
			ids = [];
		}
	}
	let unseen: string[] = [];
	if (rawUnseen) {
		try {
			const parsed = JSON.parse(rawUnseen);
			if (Array.isArray(parsed)) {
				unseen = parsed.filter((id) => typeof id === "string");
			}
		} catch {
			unseen = [];
		}
	}
	return { updated, ids, unseen };
};

export const writeTutorialStorage = (
	lang: string,
	updated: string,
	ids: string[],
	unseen: string[],
) => {
	if (typeof window === "undefined") return;
	const keys = getStorageKeys(lang);
	window.localStorage.setItem(keys.updated, updated);
	window.localStorage.setItem(keys.menuIds, JSON.stringify(ids));
	window.localStorage.setItem(keys.unseen, JSON.stringify(unseen));
	window.dispatchEvent(new CustomEvent(TUTORIALS_UPDATED_EVENT));
};

export const isTutorialUpdated = (
	currentUpdated?: string | null,
	storedUpdated?: string | null,
) => Boolean(currentUpdated && storedUpdated && currentUpdated !== storedUpdated);

export const acknowledgeTutorialIds = (
	lang: string,
	idsToAcknowledge: string | string[],
) => {
	if (typeof window === "undefined") return;
	const ids = Array.isArray(idsToAcknowledge)
		? idsToAcknowledge
		: [idsToAcknowledge];
	const stored = readTutorialStorage(lang);
	if (!stored.unseen.length) return;
	const nextUnseen = stored.unseen.filter((id) => !ids.includes(id));
	if (nextUnseen.length === stored.unseen.length) return;
	if (!stored.updated) return;
	writeTutorialStorage(lang, stored.updated, stored.ids, nextUnseen);
};
