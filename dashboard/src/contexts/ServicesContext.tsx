import { fetch } from "service/http";
import type {
	ServiceCreatePayload,
	ServiceDeletePayload,
	ServiceDetail,
	ServiceListResponse,
	ServiceModifyPayload,
	ServiceSummary,
	ServiceAdmin,
} from "types/Service";
import type { AdminServiceTrafficLimitPayload } from "types/Admin";
import { create } from "zustand";

type QueryParams = {
	name?: string;
	offset?: number;
	limit?: number;
};

type ServicesStore = {
	services: ServiceSummary[];
	serviceOptions: ServiceSummary[];
	total: number;
	isLoading: boolean;
	isOptionsLoading: boolean;
	isSaving: boolean;
	serviceDetail: ServiceDetail | null;
	fetchServices: (params?: QueryParams) => Promise<void>;
	fetchServiceOptions: (params?: QueryParams) => Promise<ServiceSummary[]>;
	fetchServiceDetail: (id: number) => Promise<ServiceDetail>;
	createService: (payload: ServiceCreatePayload) => Promise<ServiceDetail>;
	updateService: (
		id: number,
		payload: ServiceModifyPayload,
	) => Promise<ServiceDetail>;
	deleteService: (id: number, payload?: ServiceDeletePayload) => Promise<void>;
	resetServiceUsage: (id: number) => Promise<ServiceDetail>;
	updateServiceAdminLimits: (
		serviceId: number,
		adminId: number,
		payload: Omit<AdminServiceTrafficLimitPayload, "service_id">,
	) => Promise<ServiceAdmin>;
	setServiceDetail: (service: ServiceDetail | null) => void;
	performServiceUserAction: (
		id: number,
		payload: Record<string, unknown>,
	) => Promise<{ detail: string; count?: number }>;
};

let servicesFetchSequence = 0;
let serviceOptionsFetchSequence = 0;

export const useServicesStore = create<ServicesStore>((set, get) => ({
	services: [],
	serviceOptions: [],
	total: 0,
	isLoading: false,
	isOptionsLoading: false,
	isSaving: false,
	serviceDetail: null,

	async fetchServices(params) {
		const requestId = ++servicesFetchSequence;
		set({ isLoading: true });
		try {
			const response = await fetch<ServiceListResponse>("/v2/services", {
				query: params,
			});
			if (requestId !== servicesFetchSequence) {
				return;
			}
			set({ services: response.services, total: response.total });
		} finally {
			if (requestId === servicesFetchSequence) {
				set({ isLoading: false });
			}
		}
	},

	async fetchServiceOptions(params) {
		const requestId = ++serviceOptionsFetchSequence;
		set({ isOptionsLoading: true });
		try {
			const response = await fetch<ServiceListResponse>("/v2/services", {
				query: { limit: 1000, offset: 0, ...params },
			});
			if (requestId !== serviceOptionsFetchSequence) {
				return get().serviceOptions;
			}
			set({ serviceOptions: response.services });
			return response.services;
		} finally {
			if (requestId === serviceOptionsFetchSequence) {
				set({ isOptionsLoading: false });
			}
		}
	},

	async fetchServiceDetail(id) {
		set({ isLoading: true });
		try {
			const detail = await fetch<ServiceDetail>(`/v2/services/${id}`);
			set({ serviceDetail: detail });
			return detail;
		} finally {
			set({ isLoading: false });
		}
	},

	async createService(payload) {
		set({ isSaving: true });
		try {
			const detail = await fetch<ServiceDetail>("/v2/services", {
				method: "POST",
				body: payload,
			});
			set({ serviceDetail: detail });
			await get().fetchServices();
			await get().fetchServiceOptions();
			return detail;
		} finally {
			set({ isSaving: false });
		}
	},

	async updateService(id, payload) {
		set({ isSaving: true });
		try {
			const detail = await fetch<ServiceDetail>(`/v2/services/${id}`, {
				method: "PUT",
				body: payload,
			});
			set({ serviceDetail: detail });
			await get().fetchServices();
			await get().fetchServiceOptions();
			return detail;
		} finally {
			set({ isSaving: false });
		}
	},

	async deleteService(id, payload) {
		set({ isSaving: true });
		try {
			await fetch(`/v2/services/${id}`, { method: "DELETE", body: payload });
			set({ serviceDetail: null });
			await get().fetchServices();
			await get().fetchServiceOptions();
		} finally {
			set({ isSaving: false });
		}
	},

	async resetServiceUsage(id) {
		set({ isSaving: true });
		try {
			const detail = await fetch<ServiceDetail>(
				`/v2/services/${id}/reset-usage`,
				{
					method: "POST",
				},
			);
			set({ serviceDetail: detail });
			await get().fetchServices();
			await get().fetchServiceOptions();
			return detail;
		} finally {
			set({ isSaving: false });
		}
	},

	async updateServiceAdminLimits(serviceId, adminId, payload) {
		const updated = await fetch<ServiceAdmin>(
			`/v2/services/${serviceId}/admins/${adminId}/limits`,
			{
				method: "PUT",
				body: payload,
			},
		);
		const current = get().serviceDetail;
		if (current?.id === serviceId) {
			set({
				serviceDetail: {
					...current,
					admins: current.admins.map((item) =>
						item.id === adminId ? updated : item,
					),
				},
			});
		}
		return updated;
	},

	setServiceDetail(service) {
		set({ serviceDetail: service });
	},

	async performServiceUserAction(id, payload) {
		return fetch<{ detail: string; count?: number }>(
			`/v2/services/${id}/users/actions`,
			{
				method: "POST",
				body: payload,
			},
		);
	},
}));

export const clearServicesCache = () => {
	servicesFetchSequence += 1;
	serviceOptionsFetchSequence += 1;
	useServicesStore.setState({
		services: [],
		serviceOptions: [],
		total: 0,
		isLoading: false,
		isOptionsLoading: false,
		isSaving: false,
		serviceDetail: null,
	});
};
