import { fetch } from "service/http";
import { Admin, AdminCreatePayload, AdminUpdatePayload } from "types/Admin";
import { create } from "zustand";

export type AdminFilters = {
  search: string;
  limit: number;
  offset: number;
  sort: string;
};

type AdminsStore = {
  admins: Admin[];
  loading: boolean;
  filters: AdminFilters;
  fetchAdmins: () => Promise<void>;
  setFilters: (filters: Partial<AdminFilters>) => void;
  createAdmin: (payload: AdminCreatePayload) => Promise<void>;
  updateAdmin: (username: string, payload: AdminUpdatePayload) => Promise<void>;
  deleteAdmin: (username: string) => Promise<void>;
  resetUsage: (username: string) => Promise<void>;
  disableUsers: (username: string) => Promise<void>;
  activateUsers: (username: string) => Promise<void>;
};

const defaultFilters: AdminFilters = {
  search: "",
  limit: 50,
  offset: 0,
  sort: "username",
};

export const useAdminsStore = create<AdminsStore>((set, get) => ({
  admins: [],
  loading: false,
  filters: defaultFilters,
  async fetchAdmins() {
    const { filters } = get();
    const query: Record<string, string | number> = {};
    if (filters.search) {
      query.username = filters.search;
    }
    if (filters.offset) {
      query.offset = filters.offset;
    }
    if (filters.limit) {
      query.limit = filters.limit;
    }
    if (filters.sort) {
      query.sort = filters.sort;
    }

    set({ loading: true });
    try {
      const data = await fetch<Admin[]>("/admins", { query });
      set({ admins: Array.isArray(data) ? data : [] });
    } finally {
      set({ loading: false });
    }
  },
  setFilters(partial) {
    set((state) => ({
      filters: {
        ...state.filters,
        ...partial,
      },
    }));
  },
  async createAdmin(payload) {
    await fetch("/admin", { method: "POST", body: payload });
    await get().fetchAdmins();
  },
  async updateAdmin(username, payload) {
    await fetch(`/admin/${encodeURIComponent(username)}`, {
      method: "PUT",
      body: payload,
    });
    await get().fetchAdmins();
  },
  async deleteAdmin(username) {
    await fetch(`/admin/${encodeURIComponent(username)}`, {
      method: "DELETE",
    });
    await get().fetchAdmins();
  },
  async resetUsage(username) {
    await fetch(`/admin/usage/reset/${encodeURIComponent(username)}`, {
      method: "POST",
    });
    await get().fetchAdmins();
  },
  async disableUsers(username) {
    await fetch(`/admin/${encodeURIComponent(username)}/users/disable`, {
      method: "POST",
    });
  },
  async activateUsers(username) {
    await fetch(`/admin/${encodeURIComponent(username)}/users/activate`, {
      method: "POST",
    });
  },
}));
