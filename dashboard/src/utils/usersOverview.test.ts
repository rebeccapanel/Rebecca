import { describe, expect, it } from "vitest";

import { nextUsersFiltersForOverview, usersOverviewSelection } from "./usersOverview";

describe("users overview links", () => {
	it("selects the status, online and usage links that match the table", () => {
		expect(
			usersOverviewSelection({ status: "limited", advancedFilters: ["online"], sort: "-used_traffic" }),
		).toEqual({ online: true, status: "limited", usage: true });
		expect(usersOverviewSelection({ sort: "-created_at" })).toEqual({
			online: false,
			status: undefined,
			usage: false,
		});
	});

	it("toggles a status filter on and off", () => {
		const on = nextUsersFiltersForOverview({ sort: "-created_at" }, { kind: "status", status: "expired" });
		expect(on).toEqual({ status: "expired", offset: 0 });
		const off = nextUsersFiltersForOverview({ status: "expired", sort: "-created_at" }, { kind: "status", status: "expired" });
		expect(off).toEqual({ status: undefined, offset: 0 });
	});

	it("moves the online filter away from offline and back off again", () => {
		const on = nextUsersFiltersForOverview({ advancedFilters: ["offline", "limit"], sort: "-created_at" }, { kind: "online" });
		expect(on).toEqual({ advancedFilters: ["limit", "online"], offset: 0 });
		const off = nextUsersFiltersForOverview({ advancedFilters: ["limit", "online"], sort: "-created_at" }, { kind: "online" });
		expect(off).toEqual({ advancedFilters: ["limit"], offset: 0 });
	});

	it("switches listed usage between descending and the default order", () => {
		expect(nextUsersFiltersForOverview({ sort: "-created_at" }, { kind: "usage" })).toEqual({
			sort: "-used_traffic",
			offset: 0,
		});
		expect(nextUsersFiltersForOverview({ sort: "-used_traffic" }, { kind: "usage" })).toEqual({
			sort: "-created_at",
			offset: 0,
		});
	});

	it("clears status and presence filters but keeps the other advanced filters", () => {
		expect(
			nextUsersFiltersForOverview(
				{ status: "active", advancedFilters: ["online", "limit"], sort: "-used_traffic" },
				{ kind: "all" },
			),
		).toEqual({ status: undefined, advancedFilters: ["limit"], offset: 0 });
	});
});
