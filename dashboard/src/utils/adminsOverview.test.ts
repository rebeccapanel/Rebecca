import { describe, expect, it } from "vitest";

import { adminsOverviewSelection, nextAdminsFiltersForOverview } from "./adminsOverview";

describe("admins overview links", () => {
	it("reports the status and role the table is filtered by", () => {
		expect(adminsOverviewSelection({ statusFilter: "expired", roleFilter: "sudo" })).toEqual({
			status: "expired",
			role: "sudo",
		});
	});

	it("toggles a status and a role filter on and off", () => {
		expect(nextAdminsFiltersForOverview({ statusFilter: "" }, { kind: "status", status: "limited" })).toEqual({
			statusFilter: "limited",
			offset: 0,
		});
		expect(nextAdminsFiltersForOverview({ statusFilter: "limited" }, { kind: "status", status: "limited" })).toEqual({
			statusFilter: "",
			offset: 0,
		});
		expect(nextAdminsFiltersForOverview({ roleFilter: "" }, { kind: "role", role: "reseller" })).toEqual({
			roleFilter: "reseller",
			offset: 0,
		});
	});

	it("clears both filters from the total", () => {
		expect(nextAdminsFiltersForOverview({ statusFilter: "active", roleFilter: "sudo" }, { kind: "all" })).toEqual({
			statusFilter: "",
			roleFilter: "",
			offset: 0,
		});
	});
});
