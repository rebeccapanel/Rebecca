import type { FilterType } from "contexts/DashboardContext";

export type UsersOverviewStatus = "active" | "expired" | "limited" | "on_hold" | "disabled";

export type UsersOverviewTarget =
	| { kind: "all" }
	| { kind: "online" }
	| { kind: "status"; status: UsersOverviewStatus }
	| { kind: "usage" };

export type UsersOverviewSelection = {
	online: boolean;
	status?: UsersOverviewStatus;
	usage: boolean;
};

type OverviewFilters = Pick<FilterType, "status" | "advancedFilters" | "sort">;

const DEFAULT_SORT = "-created_at";
const USAGE_SORT = "-used_traffic";
const PRESENCE_FILTERS = ["online", "offline"];

export const usersOverviewSelection = (filters: OverviewFilters): UsersOverviewSelection => ({
	online: (filters.advancedFilters ?? []).includes("online"),
	status: filters.status,
	usage: filters.sort === USAGE_SORT,
});

export const nextUsersFiltersForOverview = (
	filters: OverviewFilters,
	target: UsersOverviewTarget,
): Partial<FilterType> => {
	const advanced = filters.advancedFilters ?? [];
	const otherFilters = advanced.filter((item) => !PRESENCE_FILTERS.includes(item));
	switch (target.kind) {
		case "all":
			return { status: undefined, advancedFilters: otherFilters, offset: 0 };
		case "online":
			return {
				advancedFilters: advanced.includes("online") ? otherFilters : [...otherFilters, "online"],
				offset: 0,
			};
		case "status":
			return {
				status: filters.status === target.status ? undefined : target.status,
				offset: 0,
			};
		case "usage":
			return {
				sort: filters.sort === USAGE_SORT ? DEFAULT_SORT : USAGE_SORT,
				offset: 0,
			};
	}
};
