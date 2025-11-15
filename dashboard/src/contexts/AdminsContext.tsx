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
  total: number;
  loading: boolean;
  filters: AdminFilters;
  isAdminDialogOpen: boolean;
  adminInDialog: Admin | null;
  isAdminDetailsOpen: boolean;
  adminInDetails: Admin | null;
  fetchAdmins: (overrides?: Partial<AdminFilters>) => Promise<void>;
  setFilters: (filters: Partial<AdminFilters>) => void;
  onFilterChange: (filters: Partial<AdminFilters>) => void;
  createAdmin: (payload: AdminCreatePayload) => Promise<void>;
  updateAdmin: (username: string, payload: AdminUpdatePayload) => Promise<void>;
  deleteAdmin: (username: string) => Promise<void>;
  resetUsage: (username: string) => Promise<void>;
  disableAdmin: (username: string, reason: string) => Promise<void>;
  enableAdmin: (username: string) => Promise<void>;
  openAdminDialog: (admin?: Admin) => void;
  closeAdminDialog: () => void;
  openAdminDetails: (admin: Admin) => void;
  closeAdminDetails: () => void;
};

const defaultFilters: AdminFilters = {
  search: "",
  limit: 10,
  offset: 0,
  sort: "username",
};

export const useAdminsStore = create<AdminsStore>((set, get) => ({
  admins: [],
  total: 0,
  loading: false,
  filters: defaultFilters,
  isAdminDialogOpen: false,
  adminInDialog: null,
  isAdminDetailsOpen: false,
  adminInDetails: null,
  async fetchAdmins(overrides) {
    const { filters: stateFilters } = get();
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

    set({ loading: true });
    try {
      const data = await fetch<{ admins: Admin[]; total: number } | Admin[]>("/admins", { query });
      const { admins, total } = Array.isArray(data)
        ? { admins: data, total: data.length }
        : { admins: data.admins || [], total: data.total || 0 };

      set((state) => {
        const currentDetails = state.adminInDetails
          ? admins.find((admin) => admin.username === state.adminInDetails?.username) ||
            state.adminInDetails
          : null;
        return {
          admins,
          total,
          adminInDetails: currentDetails,
        };
      });
    } catch (error) {
      console.error("Failed to fetch admins:", error);
      set({ admins: [], total: 0, adminInDetails: null });
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
  onFilterChange(partial) {
    set((state) => ({
      filters: {
        ...state.filters,
        ...partial,
      },
    }));
    get().fetchAdmins();
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
  async disableAdmin(username, reason) {
    await fetch(`/admin/${encodeURIComponent(username)}/disable`, {
      method: "POST",
      body: { reason },
    });
    await get().fetchAdmins();
  },
  async enableAdmin(username) {
    await fetch(`/admin/${encodeURIComponent(username)}/enable`, {
      method: "POST",
    });
    await get().fetchAdmins();
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
