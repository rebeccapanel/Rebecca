import { StatisticsQueryKey } from "components/Statistics";
import { fetch } from "service/http";
import { User, UserCreate, UserCreateWithService, UsersListResponse } from "types/User";
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
};
export type ProtocolType = "vmess" | "vless" | "trojan" | "shadowsocks";

export type FilterUsageType = {
  start?: string;
  end?: string;
};

const USERS_CACHE_WINDOW_MS = 60 * 60 * 1000;

const sanitizeFilterQuery = (query: FilterType): FilterType => {
  const normalized: FilterType = {
    sort: query.sort || DEFAULT_SORT,
  };
  (Object.keys(query) as (keyof FilterType)[]).forEach((key) => {
    if (key === "sort") {
      return;
    }
    const value = query[key];
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
      .map((key) => [key, query[key as keyof FilterType]])
  );
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
  deletingUser: User | null;
  version: string | null;
  users: UsersListResponse;
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
  resetUsageUser: User | null;
  revokeSubscriptionUser: User | null;
  isEditingCore: boolean;
  onCreateUser: (isOpen: boolean) => void;
  onEditingUser: (user: User | null) => void;
  onDeletingUser: (user: User | null) => void;
  onResetAllUsage: (isResetingAllUsage: boolean) => void;
  refetchUsers: (force?: boolean) => void;
  resetAllUsage: () => Promise<void>;
  onFilterChange: (filters: Partial<FilterType>) => void;
  deleteUser: (user: User) => Promise<void>;
  createUser: (user: UserCreate) => Promise<void>;
  createUserWithService: (user: UserCreateWithService) => Promise<void>;
  editUser: (username: string, body: UserCreate) => Promise<void>;
  fetchUserUsage: (user: User, query: FilterUsageType) => Promise<void>;
  setQRCode: (links: string[] | null) => void;
  setSubLink: (subscribeURL: string | null) => void;
  onEditingNodes: (isEditingNodes: boolean) => void;
  resetDataUsage: (user: User) => Promise<void>;
  revokeSubscription: (user: User) => Promise<void>;
  onEditingCore: (isEditingCore: boolean) => void;
};

const fetchUsers = (query: FilterType, options: { force?: boolean } = {}): Promise<UsersListResponse> => {
  const sanitizedQuery = sanitizeFilterQuery(query);
  const cacheKey = buildUsersCacheKey(sanitizedQuery);
  const { lastUsersFetchAt, usersCacheKey, users } = useDashboard.getState();
  const now = Date.now();

  if (
    !options.force &&
    lastUsersFetchAt &&
    usersCacheKey === cacheKey &&
    now - lastUsersFetchAt < USERS_CACHE_WINDOW_MS
  ) {
    return Promise.resolve(users);
  }

  useDashboard.setState({ loading: true });
  return fetch<UsersListResponse>("/users", { query: sanitizedQuery })
    .then((usersResponse) => {
      const limit = usersResponse.users_limit ?? null;
      const activeTotal = usersResponse.active_total ?? null;
      const isUserLimitReached =
        limit !== null && limit !== undefined && limit > 0 && activeTotal !== null
          ? activeTotal >= limit
          : false;
      useDashboard.setState({
        users: usersResponse,
        isUserLimitReached,
        lastUsersFetchAt: Date.now(),
        usersCacheKey: cacheKey,
      });
      return usersResponse;
    })
    .finally(() => {
      useDashboard.setState({ loading: false });
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

export const useDashboard = create(
  subscribeWithSelector<DashboardStateType>((set, get) => ({
    version: null,
    editingUser: null,
    deletingUser: null,
    isCreatingNewUser: false,
    QRcodeLinks: null,
    subscribeUrl: null,
    users: {
      users: [],
      total: 0,
      active_total: 0,
      users_limit: null,
    },
    loading: true,
    isUserLimitReached: false,
    isResetingAllUsage: false,
    lastUsersFetchAt: null,
    usersCacheKey: null,
    isEditingNodes: false,
    resetUsageUser: null,
    revokeSubscriptionUser: null,
    filters: {
      username: "",
      limit: getUsersPerPageLimitSize(),
      sort: DEFAULT_SORT,
    },
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
      set({ editingUser });
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
      get().refetchUsers();
    },
    setQRCode: (QRcodeLinks) => {
      set({ QRcodeLinks });
    },
    deleteUser: (user: User) => {
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
        }
      );
    },
    fetchUserUsage: (body: User, query: FilterUsageType) => {
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
        }
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
    onEditingCore: (isEditingCore) => set({ isEditingCore }),
  }))
);
