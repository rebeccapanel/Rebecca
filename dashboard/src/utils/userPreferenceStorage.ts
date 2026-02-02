const NUM_USERS_PER_PAGE_LOCAL_STORAGE_KEY = "rebecca-num-users-per-page";
const NUM_ADMINS_PER_PAGE_LOCAL_STORAGE_KEY = "rebecca-num-admins-per-page";
const NUM_PER_PAGE_DEFAULT = 10;

const readPerPage = (key: string) => {
	const value =
		localStorage.getItem(key) || NUM_PER_PAGE_DEFAULT.toString(); // catches `null`
	return parseInt(value, 10) || NUM_PER_PAGE_DEFAULT; // catches NaN
};

const writePerPage = (key: string, value: string) =>
	localStorage.setItem(key, value);

export const getUsersPerPageLimitSize = () =>
	readPerPage(NUM_USERS_PER_PAGE_LOCAL_STORAGE_KEY);
export const setUsersPerPageLimitSize = (value: string) =>
	writePerPage(NUM_USERS_PER_PAGE_LOCAL_STORAGE_KEY, value);

export const getAdminsPerPageLimitSize = () =>
	readPerPage(NUM_ADMINS_PER_PAGE_LOCAL_STORAGE_KEY);
export const setAdminsPerPageLimitSize = (value: string) =>
	writePerPage(NUM_ADMINS_PER_PAGE_LOCAL_STORAGE_KEY, value);
