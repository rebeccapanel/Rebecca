import { fetch } from "service/http";
import { create } from "zustand";
import {
  ServiceCreatePayload,
  ServiceDetail,
  ServiceListResponse,
  ServiceModifyPayload,
  ServiceSummary,
} from "types/Service";

type QueryParams = {
  name?: string;
  offset?: number;
  limit?: number;
};

type ServicesStore = {
  services: ServiceSummary[];
  total: number;
  isLoading: boolean;
  isSaving: boolean;
  serviceDetail: ServiceDetail | null;
  fetchServices: (params?: QueryParams) => Promise<void>;
  fetchServiceDetail: (id: number) => Promise<ServiceDetail>;
  createService: (payload: ServiceCreatePayload) => Promise<ServiceDetail>;
  updateService: (id: number, payload: ServiceModifyPayload) => Promise<ServiceDetail>;
  deleteService: (id: number) => Promise<void>;
  resetServiceUsage: (id: number) => Promise<ServiceDetail>;
  setServiceDetail: (service: ServiceDetail | null) => void;
};

export const useServicesStore = create<ServicesStore>((set, get) => ({
  services: [],
  total: 0,
  isLoading: false,
  isSaving: false,
  serviceDetail: null,

  async fetchServices(params) {
    set({ isLoading: true });
    try {
      const response = await fetch<ServiceListResponse>("/v2/services", {
        query: params,
      });
      set({ services: response.services, total: response.total });
    } finally {
      set({ isLoading: false });
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
      return detail;
    } finally {
      set({ isSaving: false });
    }
  },

  async deleteService(id) {
    set({ isSaving: true });
    try {
      await fetch(`/v2/services/${id}`, { method: "DELETE" });
      set({ serviceDetail: null });
      await get().fetchServices();
    } finally {
      set({ isSaving: false });
    }
  },

  async resetServiceUsage(id) {
    set({ isSaving: true });
    try {
      const detail = await fetch<ServiceDetail>(`/v2/services/${id}/reset-usage`, {
        method: "POST",
      });
      set({ serviceDetail: detail });
      await get().fetchServices();
      return detail;
    } finally {
      set({ isSaving: false });
    }
  },

  setServiceDetail(service) {
    set({ serviceDetail: service });
  },
}));
