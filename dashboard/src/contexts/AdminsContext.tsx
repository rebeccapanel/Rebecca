import { fetch } from "service/http";
import type {
	Admin,
	AdminCreatePayload,
	AdminUpdatePayload,
	StandardAdminPermissionsBulkPayload,
	StandardAdminPermissionsBulkResponse,
} from "types/Admin";
import { getAuthToken } from "utils/authStorage";
import { getAdminsPerPageLimitSize } from "utils/userPreferenceStorage";
import { create } from "zustand";

export type AdminFilters = {
	search: string;
	limit: number;
	offset: number;
	sort: string;
};

type AdminsStore = {
	admins: Admin[];
	total: number;
	loading: boolean;
	lastFetchedAt: number | null;
	cacheAuthToken: string | null;
	currentRequestKey: string | null;
	inflight: Promise<void> | null;
	filters: AdminFilters;
	isAdminDialogOpen: boolean;
	adminInDialog: Admin | null;
	isAdminDetailsOpen: boolean;
	adminInDetails: Admin | null;
	fetchAdmins: (
		overrides?: Partial<AdminFilters>,
		options?: { force?: boolean },
	) => Promise<void>;
	setFilters: (filters: Partial<AdminFilters>) => void;
	onFilterChange: (filters: Partial<AdminFilters>) => void;
	createAdmin: (payload: AdminCreatePayload) => Promise<Admin>;
	updateAdmin: (username: string, payload: AdminUpdatePayload) => Promise<void>;
	deleteAdmin: (username: string) => Promise<void>;
	resetUsage: (username: string) => Promise<void>;
	resetDeletedUsersUsage: (
		username: string,
		serviceId?: number | null,
	) => Promise<void>;
	disableAdmin: (username: string, reason: string) => Promise<void>;
	enableAdmin: (username: string) => Promise<void>;
	bulkUpdateStandardPermissions: (
		payload: StandardAdminPermissionsBulkPayload,
	) => Promise<StandardAdminPermissionsBulkResponse>;
	openAdminDialog: (admin?: Admin) => void;
	closeAdminDialog: () => void;
	openAdminDetails: (admin: Admin) => void;
	closeAdminDetails: () => void;
};

const createDefaultFilters = (): AdminFilters => ({
	search: "",
	limit: getAdminsPerPageLimitSize(),
	offset: 0,
	sort: "username",
});

const isAbortError = (error: unknown): boolean => {
	if (!error || typeof error !== "object") {
		return false;
	}
	const maybeError = error as { name?: string; message?: string };
	return (
		maybeError.name === "AbortError" || maybeError.message === "AbortError"
	);
};

const normalizeAdminsResponse = (
	admins: Admin[],
	total: number,
	filters: AdminFilters,
): { admins: Admin[]; total: number } => {
	const seen = new Set<string>();
	let normalizedAdmins = admins.filter((admin) => {
		const key = admin.username || String(admin.id);
		if (!key || seen.has(key)) {
			return false;
		}
		seen.add(key);
		return true;
	});
	const search = filters.search?.trim().toLowerCase();
	if (search && normalizedAdmins.length > total) {
		const matching = normalizedAdmins.filter((admin) =>
			admin.username.toLowerCase().includes(search),
		);
		if (matching.length >= Math.max(total, 1)) {
			normalizedAdmins = matching.slice(0, Math.max(total, 0));
		} else if (total >= 0) {
			normalizedAdmins = normalizedAdmins.slice(0, total);
		}
	}
	return {
		admins: normalizedAdmins,
		total,
	};
};

let adminsFetchSequence = 0;
let adminsAbortController: AbortController | null = null;

export const clearAdminsCache = () => {
	adminsFetchSequence += 1;
	adminsAbortController?.abort();
	adminsAbortController = null;
	useAdminsStore.setState({
		admins: [],
		total: 0,
		loading: false,
		lastFetchedAt: null,
		cacheAuthToken: null,
		currentRequestKey: null,
		inflight: null,
		filters: createDefaultFilters(),
		isAdminDialogOpen: false,
		adminInDialog: null,
		isAdminDetailsOpen: false,
		adminInDetails: null,
	});
};

export const useAdminsStore = create<AdminsStore>((set, get) => ({
	admins: [],
	total: 0,
	loading: false,
	lastFetchedAt: null,
	cacheAuthToken: null,
	currentRequestKey: null,
	inflight: null,
	filters: createDefaultFilters(),
	isAdminDialogOpen: false,
	adminInDialog: null,
	isAdminDetailsOpen: false,
	adminInDetails: null,
	async fetchAdmins(overrides, options) {
		const {
			filters: stateFilters,
			lastFetchedAt,
			cacheAuthToken,
			loading,
			currentRequestKey,
			inflight,
		} = get();
		const now = Date.now();
		const force = options?.force === true;
		const currentAuthToken = getAuthToken();

		const filters = {
			...stateFilters,
			...overrides,
		};
		const query: Record<string, string | number> = {};
		if (filters.search) {
			query.username = filters.search;
		}
		if (filters.offset !== undefined) {
			query.offset = filters.offset;
		}
		if (filters.limit !== undefined) {
			query.limit = filters.limit;
		}
		if (filters.sort) {
			if (filters.sort === "data_usage") {
				query.sort = "users_usage";
			} else if (filters.sort === "data_limit") {
				query.sort = "data_limit";
			} else {
				query.sort = filters.sort;
			}
		}

		const requestKey = JSON.stringify(query);
		if (loading && currentRequestKey === requestKey && inflight) {
			return inflight;
		}
		if (
			!force &&
			lastFetchedAt &&
			now - lastFetchedAt < 60_000 &&
			cacheAuthToken === currentAuthToken &&
			currentRequestKey === requestKey
		) {
			return;
		}

		const requestId = ++adminsFetchSequence;
		adminsAbortController?.abort();
		const abortController = new AbortController();
		adminsAbortController = abortController;
		set({ loading: true });
		const promise = (async () => {
			try {
				const data = await fetch<{ admins: Admin[]; total: number } | Admin[]>(
					"/admins",
					{ query, signal: abortController.signal },
				);
				if (
					requestId !== adminsFetchSequence ||
					abortController.signal.aborted
				) {
					return;
				}
				const parsed = Array.isArray(data)
					? { admins: data, total: data.length }
					: { admins: data.admins || [], total: data.total || 0 };
				const { admins, total } = normalizeAdminsResponse(
					parsed.admins,
					parsed.total,
					filters,
				);

				set((state) => {
					const currentDetails = state.adminInDetails
						? admins.find(
								(admin) => admin.username === state.adminInDetails?.username,
							) || state.adminInDetails
						: null;
					return {
						admins,
						total,
						adminInDetails: currentDetails,
						lastFetchedAt: now,
						cacheAuthToken: currentAuthToken,
						currentRequestKey: requestKey,
					};
				});
			} catch (error) {
				if (
					requestId !== adminsFetchSequence ||
					abortController.signal.aborted ||
					isAbortError(error)
				) {
					return;
				}
				console.error("Failed to fetch admins:", error);
				set({
					admins: [],
					total: 0,
					adminInDetails: null,
					lastFetchedAt: null,
					cacheAuthToken: null,
					currentRequestKey: null,
				});
			} finally {
				if (requestId === adminsFetchSequence) {
					if (adminsAbortController === abortController) {
						adminsAbortController = null;
					}
					set({ loading: false, inflight: null });
				}
			}
		})();

		set({ inflight: promise, currentRequestKey: requestKey });
		return promise;
	},
	setFilters(partial) {
		set((state) => ({
			filters: {
				...state.filters,
				...partial,
			},
		}));
	},
	onFilterChange(partial) {
		const filters = {
			...get().filters,
			...partial,
		};
		set({ filters });
		get().fetchAdmins(undefined, { force: true });
	},
	async createAdmin(payload) {
		const created = await fetch<Admin>("/admin", {
			method: "POST",
			body: payload,
		});
		return created;
	},
	async updateAdmin(username, payload) {
		await fetch(`/admin/${encodeURIComponent(username)}`, {
			method: "PUT",
			body: payload,
		});
		await get().fetchAdmins(undefined, { force: true });
	},
	async deleteAdmin(username) {
		await fetch(`/admin/${encodeURIComponent(username)}`, {
			method: "DELETE",
		});
		await get().fetchAdmins(undefined, { force: true });
	},
	async resetUsage(username) {
		await fetch(`/admin/usage/reset/${encodeURIComponent(username)}`, {
			method: "POST",
		});
		await get().fetchAdmins(undefined, { force: true });
	},
	async resetDeletedUsersUsage(username, serviceId) {
		await fetch(
			`/admin/${encodeURIComponent(username)}/deleted-users-usage/reset`,
			{
				method: "POST",
				body: { service_id: serviceId ?? null },
			},
		);
		await get().fetchAdmins(undefined, { force: true });
	},
	async disableAdmin(username, reason) {
		await fetch(`/admin/${encodeURIComponent(username)}/disable`, {
			method: "POST",
			body: { reason },
		});
		await get().fetchAdmins(undefined, { force: true });
	},
	async enableAdmin(username) {
		await fetch(`/admin/${encodeURIComponent(username)}/enable`, {
			method: "POST",
		});
		await get().fetchAdmins(undefined, { force: true });
	},
	async bulkUpdateStandardPermissions(payload) {
		const response = await fetch<StandardAdminPermissionsBulkResponse>(
			"/admin/permissions/standard/bulk",
			{
				method: "POST",
				body: payload,
			},
		);
		await get().fetchAdmins(undefined, { force: true });
		return response;
	},
	openAdminDialog(admin) {
		set({ isAdminDialogOpen: true, adminInDialog: admin || null });
	},
	closeAdminDialog() {
		set({ isAdminDialogOpen: false, adminInDialog: null });
	},
	openAdminDetails(admin) {
		set({ isAdminDetailsOpen: true, adminInDetails: admin });
	},
	closeAdminDetails() {
		set({ isAdminDetailsOpen: false, adminInDetails: null });
	},
}));
