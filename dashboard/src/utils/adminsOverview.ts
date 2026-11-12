export type AdminsOverviewStatus = "active" | "expired" | "limited" | "disabled";

export type AdminsOverviewRole = "full_access" | "sudo" | "reseller" | "standard";

export type AdminsOverviewTarget =
	| { kind: "all" }
	| { kind: "status"; status: AdminsOverviewStatus }
	| { kind: "role"; role: AdminsOverviewRole };

export type AdminsOverviewSelection = {
	status: string;
	role: string;
};

type AdminsOverviewFilters = {
	statusFilter?: string;
	roleFilter?: string;
};

export const adminsOverviewSelection = (filters: AdminsOverviewFilters): AdminsOverviewSelection => ({
	status: filters.statusFilter ?? "",
	role: filters.roleFilter ?? "",
});

export const nextAdminsFiltersForOverview = (
	filters: AdminsOverviewFilters,
	target: AdminsOverviewTarget,
) => {
	switch (target.kind) {
		case "all":
			return { statusFilter: "", roleFilter: "", offset: 0 };
		case "status":
			return {
				statusFilter: filters.statusFilter === target.status ? "" : target.status,
				offset: 0,
			};
		case "role":
			return {
				roleFilter: filters.roleFilter === target.role ? "" : target.role,
				offset: 0,
			};
	}
};
