const STORAGE_KEY = "rb-admin-expire";

type AdminExpireMap = Record<string, number>;

const getStorage = (): Storage | null => {
	if (typeof window === "undefined") {
		return null;
	}
	try {
		return window.localStorage;
	} catch (error) {
		return null;
	}
};

const sanitizeExpireMap = (value: unknown): AdminExpireMap => {
	if (!value || typeof value !== "object") {
		return {};
	}
	const result: AdminExpireMap = {};
	for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
		if (!key || typeof entry !== "number" || !Number.isFinite(entry)) {
			continue;
		}
		result[key] = entry;
	}
	return result;
};

export const readAdminExpireMap = (): AdminExpireMap => {
	const storage = getStorage();
	if (!storage) {
		return {};
	}
	try {
		const raw = storage.getItem(STORAGE_KEY);
		if (!raw) {
			return {};
		}
		return sanitizeExpireMap(JSON.parse(raw));
	} catch (error) {
		return {};
	}
};

export const getAdminExpireMap = (): AdminExpireMap => readAdminExpireMap();

export const getAdminExpire = (username: string): number | null => {
	if (!username) {
		return null;
	}
	const map = readAdminExpireMap();
	const value = map[username];
	return typeof value === "number" ? value : null;
};

export const setAdminExpire = (username: string, expireAt: number | null) => {
	const storage = getStorage();
	if (!storage || !username) {
		return;
	}
	const map = readAdminExpireMap();
	if (expireAt === null || expireAt === undefined || !Number.isFinite(expireAt)) {
		delete map[username];
	} else {
		map[username] = expireAt;
	}
	try {
		storage.setItem(STORAGE_KEY, JSON.stringify(map));
	} catch (error) {
		// Ignore storage write errors.
	}
};
