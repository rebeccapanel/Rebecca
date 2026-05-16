import { StatisticsQueryKey } from "components/Statistics";
import { fetch } from "service/http";
import type {
	AdvancedUserActionPayload,
	AdvancedUserActionResponse,
	User,
	UserCreate,
	UserCreateWithService,
	UserListItem,
	UsersListResponse,
} from "types/User";
import { getAuthToken } from "utils/authStorage";
import { queryClient } from "utils/react-query";
import { getUsersPerPageLimitSize } from "utils/userPreferenceStorage";
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

const DEFAULT_SORT = "-created_at";

export type FilterType = {
	search?: string;
	limit?: number;
	offset?: number;
	sort: string;
	status?: "active" | "disabled" | "limited" | "expired" | "on_hold";
	advancedFilters?: string[];
	owner?: string;
	serviceId?: number;
};
export type ProtocolType = "vmess" | "vless" | "trojan" | "shadowsocks";

export type FilterUsageType = {
	start?: string;
	end?: string;
};

const USERS_CACHE_WINDOW_MS = 60 * 60 * 1000;

const createEmptyUsersResponse = (): UsersListResponse => ({
	users: [],
	total: 0,
	active_total: 0,
	users_limit: null,
	status_breakdown: {},
	usage_total: null,
	online_total: null,
});

const createDefaultFilters = (): FilterType => ({
	limit: getUsersPerPageLimitSize(),
	sort: DEFAULT_SORT,
	advancedFilters: [],
	owner: undefined,
	serviceId: undefined,
});

const sanitizeFilterQuery = (query: FilterType): FilterType => {
	const normalized: FilterType = {
		sort: query.sort || DEFAULT_SORT,
	};
	(Object.keys(query) as (keyof FilterType)[]).forEach((key) => {
		if (key === "sort") {
			return;
		}
		const value = query[key];
		if (Array.isArray(value)) {
			if (value.length === 0) {
				return;
			}
			(normalized as any)[key] = value;
			return;
		}
		if (value === undefined || value === null || value === "") {
			return;
		}
		(normalized as any)[key] = value;
	});
	return normalized;
};

const buildUsersCacheKey = (query: FilterType): string => {
	return JSON.stringify(
		Object.keys(query)
			.sort()
			.map((key) => [key, query[key as keyof FilterType]]),
	);
};

const isAbortError = (error: unknown): boolean => {
	if (!error || typeof error !== "object") {
		return false;
	}
	const maybeError = error as { name?: string; message?: string };
	return (
		maybeError.name === "AbortError" || maybeError.message === "AbortError"
	);
};

const getUserSearchRank = (user: UserListItem, search: string): number => {
	const normalizedSearch = search.trim().toLowerCase();
	if (!normalizedSearch) {
		return Number.MAX_SAFE_INTEGER;
	}
	const username = user.username?.toLowerCase() ?? "";
	if (username === normalizedSearch) {
		return 0;
	}
	if (username.includes(normalizedSearch)) {
		return 1;
	}
	const searchableValues = [
		user.subscription_url,
		...(user.subscription_urls ? Object.values(user.subscription_urls) : []),
		...(user.links ?? []),
		user.service_name,
		user.admin_username,
	]
		.filter((value): value is string => Boolean(value))
		.map((value) => value.toLowerCase());
	return searchableValues.some((value) => value.includes(normalizedSearch))
		? 2
		: Number.MAX_SAFE_INTEGER;
};

const normalizeUsersListResponse = (
	response: UsersListResponse,
	query: FilterType,
): UsersListResponse => {
	const seen = new Set<string>();
	let users = (response.users ?? []).filter((user) => {
		const key = user.username || user.subscription_url;
		if (!key || seen.has(key)) {
			return false;
		}
		seen.add(key);
		return true;
	});
	const total = response.total ?? users.length;
	const search = query.search?.trim();
	if (search && users.length > total) {
		const rankedMatches = users
			.map((user, index) => ({
				user,
				index,
				rank: getUserSearchRank(user, search),
			}))
			.filter((entry) => entry.rank < Number.MAX_SAFE_INTEGER)
			.sort((a, b) => a.rank - b.rank || a.index - b.index)
			.map((entry) => entry.user);
		if (rankedMatches.length >= Math.max(total, 1)) {
			users = rankedMatches.slice(0, Math.max(total, 0));
		} else if (total >= 0) {
			users = users.slice(0, total);
		}
	}
	return {
		...response,
		users,
		total,
	};
};

export type InboundType = {
	tag: string;
	protocol: ProtocolType;
	network: string;
	tls: string;
	port?: number;
};
export type Inbounds = Map<ProtocolType, InboundType[]>;

type DashboardStateType = {
	isCreatingNewUser: boolean;
	editingUser: User | null | undefined;
	deletingUser: UserListItem | null;
	version: string | null;
	users: UsersListResponse;
	linkTemplates?: Record<string, string[]>; // Link templates for generating user links
	inbounds: Inbounds;
	loading: boolean;
	isUserLimitReached: boolean;
	filters: FilterType;
	subscribeUrl: string | null;
	QRcodeLinks: string[] | null;
	isEditingNodes: boolean;
	isResetingAllUsage: boolean;
	lastUsersFetchAt: number | null;
	usersCacheKey: string | null;
	usersCacheAuthToken: string | null;
	resetUsageUser: UserListItem | null;
	revokeSubscriptionUser: UserListItem | null;
	isEditingCore: boolean;
	onCreateUser: (isOpen: boolean) => void;
	onEditingUser: (user: User | UserListItem | null) => void;
	onDeletingUser: (user: UserListItem | null) => void;
	onResetAllUsage: (isResetingAllUsage: boolean) => void;
	refetchUsers: (force?: boolean) => void;
	resetAllUsage: () => Promise<void>;
	onFilterChange: (filters: Partial<FilterType>) => void;
	deleteUser: (user: UserListItem) => Promise<void>;
	createUser: (user: UserCreate) => Promise<void>;
	createUserWithService: (user: UserCreateWithService) => Promise<void>;
	editUser: (username: string, body: UserCreate) => Promise<void>;
	fetchUserUsage: (user: UserListItem, query: FilterUsageType) => Promise<void>;
	setQRCode: (links: string[] | null) => void;
	setSubLink: (subscribeURL: string | null) => void;
	onEditingNodes: (isEditingNodes: boolean) => void;
	resetDataUsage: (user: UserListItem) => Promise<void>;
	revokeSubscription: (user: UserListItem) => Promise<void>;
	performBulkUserAction: (
		payload: AdvancedUserActionPayload,
	) => Promise<AdvancedUserActionResponse>;
	onEditingCore: (isEditingCore: boolean) => void;
};

let usersFetchSequence = 0;
let usersAbortController: AbortController | null = null;

const fetchUsers = (
	query: FilterType,
	options: { force?: boolean } = {},
): Promise<UsersListResponse> => {
	const sanitizedQuery = sanitizeFilterQuery(query);
	const cacheKey = buildUsersCacheKey(sanitizedQuery);
	const currentAuthToken = getAuthToken();
	const { lastUsersFetchAt, usersCacheKey, usersCacheAuthToken, users } =
		useDashboard.getState();
	const now = Date.now();

	if (
		!options.force &&
		lastUsersFetchAt &&
		usersCacheKey === cacheKey &&
		usersCacheAuthToken === currentAuthToken &&
		now - lastUsersFetchAt < USERS_CACHE_WINDOW_MS
	) {
		return Promise.resolve(users);
	}

	const requestId = ++usersFetchSequence;
	usersAbortController?.abort();
	const abortController = new AbortController();
	usersAbortController = abortController;
	useDashboard.setState({ loading: true });
	const requestQuery: Record<string, unknown> = {
		...sanitizedQuery,
	};
	if (sanitizedQuery.advancedFilters?.length) {
		requestQuery.filter = sanitizedQuery.advancedFilters;
	}
	if (sanitizedQuery.owner) {
		requestQuery.admin = sanitizedQuery.owner;
	}
	if (sanitizedQuery.serviceId !== undefined) {
		requestQuery.service_id = sanitizedQuery.serviceId;
	}
	requestQuery.links = true;
	delete requestQuery.advancedFilters;
	delete requestQuery.owner;
	delete requestQuery.serviceId;

	return fetch<UsersListResponse>("/users", {
		query: requestQuery,
		signal: abortController.signal,
	})
		.then((usersResponse) => {
			if (requestId !== usersFetchSequence || abortController.signal.aborted) {
				return useDashboard.getState().users;
			}
			const normalizedResponse = normalizeUsersListResponse(
				usersResponse,
				sanitizedQuery,
			);
			const limit = normalizedResponse.users_limit ?? null;
			const activeTotal = normalizedResponse.active_total ?? null;
			const isUserLimitReached =
				limit !== null &&
				limit !== undefined &&
				limit > 0 &&
				activeTotal !== null
					? activeTotal >= limit
					: false;
			useDashboard.setState({
				users: normalizedResponse,
				linkTemplates: normalizedResponse.link_templates, // Store link_templates separately for easy access
				isUserLimitReached,
				lastUsersFetchAt: Date.now(),
				usersCacheKey: cacheKey,
				usersCacheAuthToken: currentAuthToken,
			});
			return normalizedResponse;
		})
		.catch((error) => {
			if (
				requestId !== usersFetchSequence ||
				abortController.signal.aborted ||
				isAbortError(error)
			) {
				return useDashboard.getState().users;
			}
			console.error("Failed to fetch users:", error);
			const emptyResponse = createEmptyUsersResponse();
			useDashboard.setState({
				users: emptyResponse,
				linkTemplates: undefined,
				isUserLimitReached: false,
				lastUsersFetchAt: null,
				usersCacheKey: null,
				usersCacheAuthToken: null,
			});
			return emptyResponse;
		})
		.finally(() => {
			if (requestId === usersFetchSequence) {
				if (usersAbortController === abortController) {
					usersAbortController = null;
				}
				useDashboard.setState({ loading: false });
			}
		});
};

export const fetchInbounds = () => {
	return fetch("/inbounds")
		.then((inbounds: Inbounds) => {
			useDashboard.setState({
				inbounds: new Map(Object.entries(inbounds)) as Inbounds,
			});
		})
		.finally(() => {
			useDashboard.setState({ loading: false });
		});
};

export const clearDashboardCache = () => {
	usersFetchSequence += 1;
	usersAbortController?.abort();
	usersAbortController = null;
	useDashboard.setState({
		users: createEmptyUsersResponse(),
		linkTemplates: undefined,
		loading: false,
		isUserLimitReached: false,
		lastUsersFetchAt: null,
		usersCacheKey: null,
		usersCacheAuthToken: null,
		editingUser: null,
		deletingUser: null,
		resetUsageUser: null,
		revokeSubscriptionUser: null,
		subscribeUrl: null,
		QRcodeLinks: null,
		filters: createDefaultFilters(),
	});
};

export const useDashboard = create(
	subscribeWithSelector<DashboardStateType>((set, get) => ({
		version: null,
		editingUser: null,
		deletingUser: null,
		isCreatingNewUser: false,
		QRcodeLinks: null,
		subscribeUrl: null,
		users: createEmptyUsersResponse(),
		loading: true,
		isUserLimitReached: false,
		isResetingAllUsage: false,
		lastUsersFetchAt: null,
		usersCacheKey: null,
		usersCacheAuthToken: null,
		isEditingNodes: false,
		resetUsageUser: null,
		revokeSubscriptionUser: null,
		filters: createDefaultFilters(),
		inbounds: new Map(),
		isEditingCore: false,
		refetchUsers: (force = false) => {
			fetchUsers(get().filters, { force });
		},
		resetAllUsage: () => {
			return fetch(`/users/reset`, { method: "POST" }).then(() => {
				get().onResetAllUsage(false);
				get().refetchUsers(true);
			});
		},
		onResetAllUsage: (isResetingAllUsage) => set({ isResetingAllUsage }),
		onCreateUser: (isCreatingNewUser) => set({ isCreatingNewUser }),
		onEditingUser: (editingUser) => {
			if (!editingUser) {
				set({ editingUser: null });
				return;
			}
			// Fetch full user detail before opening editor to keep list payload lightweight
			fetch(`/user/${editingUser.username}`)
				.then((fullUser: User) => {
					set({ editingUser: fullUser });
				})
				.catch(() => set({ editingUser: null }));
		},
		onDeletingUser: (deletingUser) => {
			set({ deletingUser });
		},
		onFilterChange: (filters) => {
			set({
				filters: {
					...get().filters,
					...filters,
				},
			});
			get().refetchUsers(true);
		},
		setQRCode: (QRcodeLinks) => {
			set({ QRcodeLinks });
		},
		deleteUser: (user: UserListItem) => {
			set({ editingUser: null });
			return fetch(`/user/${user.username}`, { method: "DELETE" }).then(() => {
				set({ deletingUser: null });
				get().refetchUsers(true);
				queryClient.invalidateQueries(StatisticsQueryKey);
			});
		},
		createUser: (body: UserCreate) => {
			return fetch(`/user`, { method: "POST", body }).then(() => {
				set({ editingUser: null });
				get().refetchUsers(true);
				queryClient.invalidateQueries(StatisticsQueryKey);
			});
		},
		createUserWithService: (body: UserCreateWithService) => {
			return fetch(`/v2/users`, { method: "POST", body }).then(() => {
				set({ editingUser: null });
				get().refetchUsers(true);
				queryClient.invalidateQueries(StatisticsQueryKey);
			});
		},
		editUser: (username: string, body: UserCreate) => {
			return fetch(`/v2/users/${username}`, { method: "PUT", body }).then(
				() => {
					get().onEditingUser(null);
					get().refetchUsers(true);
				},
			);
		},
		fetchUserUsage: (body: UserListItem, query: FilterUsageType) => {
			for (const key in query) {
				if (!query[key as keyof FilterUsageType])
					delete query[key as keyof FilterUsageType];
			}
			return fetch(`/user/${body.username}/usage`, { method: "GET", query });
		},
		onEditingNodes: (isEditingNodes: boolean) => {
			set({ isEditingNodes });
		},
		setSubLink: (subscribeUrl) => {
			set({ subscribeUrl });
		},
		resetDataUsage: (user) => {
			return fetch(`/user/${user.username}/reset`, { method: "POST" }).then(
				() => {
					set({ resetUsageUser: null });
					get().refetchUsers(true);
				},
			);
		},
		revokeSubscription: (user) => {
			return fetch(`/user/${user.username}/revoke_sub`, {
				method: "POST",
			}).then((user) => {
				set({ revokeSubscriptionUser: null, editingUser: user });
				get().refetchUsers(true);
			});
		},
		performBulkUserAction: (payload) => {
			return fetch(`/users/actions`, { method: "POST", body: payload }).then(
				(response) => {
					get().refetchUsers(true);
					queryClient.invalidateQueries(StatisticsQueryKey);
					return response;
				},
			);
		},
		onEditingCore: (isEditingCore) => set({ isEditingCore }),
	})),
);
