const NUM_USERS_PER_PAGE_LOCAL_STORAGE_KEY = "rebecca-num-users-per-page";
const NUM_ADMINS_PER_PAGE_LOCAL_STORAGE_KEY = "rebecca-num-admins-per-page";
const NUM_NODES_PER_PAGE_LOCAL_STORAGE_KEY = "rebecca-num-nodes-per-page";
const NUM_NODES_PER_PAGE_COOKIE_KEY = "rebecca-num-nodes-per-page";
const NUM_PER_PAGE_DEFAULT = 10;
const NUM_NODES_PER_PAGE_DEFAULT = 12;
const NODE_PAGE_SIZE_OPTIONS = new Set([12, 24, 48, 96, 100]);

const readPerPage = (key: string) => {
	const value = localStorage.getItem(key) || NUM_PER_PAGE_DEFAULT.toString(); // catches `null`
	return parseInt(value, 10) || NUM_PER_PAGE_DEFAULT; // catches NaN
};

const writePerPage = (key: string, value: string) =>
	localStorage.setItem(key, value);

const readCookie = (key: string) => {
	if (typeof document === "undefined") {
		return "";
	}
	const prefix = `${encodeURIComponent(key)}=`;
	const item = document.cookie
		.split(";")
		.map((part) => part.trim())
		.find((part) => part.startsWith(prefix));
	return item ? decodeURIComponent(item.slice(prefix.length)) : "";
};

const writeCookie = (key: string, value: string) => {
	if (typeof document === "undefined") {
		return;
	}
	document.cookie = `${encodeURIComponent(key)}=${encodeURIComponent(
		value,
	)}; Max-Age=31536000; Path=/; SameSite=Lax`;
};

export const getUsersPerPageLimitSize = () =>
	readPerPage(NUM_USERS_PER_PAGE_LOCAL_STORAGE_KEY);
export const setUsersPerPageLimitSize = (value: string) =>
	writePerPage(NUM_USERS_PER_PAGE_LOCAL_STORAGE_KEY, value);

export const getAdminsPerPageLimitSize = () =>
	readPerPage(NUM_ADMINS_PER_PAGE_LOCAL_STORAGE_KEY);
export const setAdminsPerPageLimitSize = (value: string) =>
	writePerPage(NUM_ADMINS_PER_PAGE_LOCAL_STORAGE_KEY, value);

export const getNodesPerPageLimitSize = () => {
	const value =
		parseInt(
			localStorage.getItem(NUM_NODES_PER_PAGE_LOCAL_STORAGE_KEY) ||
				readCookie(NUM_NODES_PER_PAGE_COOKIE_KEY) ||
				NUM_NODES_PER_PAGE_DEFAULT.toString(),
			10,
		) || NUM_NODES_PER_PAGE_DEFAULT;
	return NODE_PAGE_SIZE_OPTIONS.has(value) ? value : NUM_NODES_PER_PAGE_DEFAULT;
};

export const setNodesPerPageLimitSize = (value: string) => {
	writePerPage(NUM_NODES_PER_PAGE_LOCAL_STORAGE_KEY, value);
	writeCookie(NUM_NODES_PER_PAGE_COOKIE_KEY, value);
};
