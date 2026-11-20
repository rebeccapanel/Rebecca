import { describe, expect, it } from "vitest";
import { getMobileDetailWideModes } from "./DataTable";
import { orderRowActions, type RowActionItem } from "./DataTableRowActions";

describe("getMobileDetailWideModes", () => {
	it("keeps even runs as standard half-width tiles", () => {
		expect(
			getMobileDetailWideModes([{}, {}, {}, {}]),
		).toEqual([undefined, undefined, undefined, undefined]);
	});

	it("expands a lone trailing tile at the end of an odd list", () => {
		// Mirrors privileged Users mobile card (11 detail tiles -> 5 pairs + trailing full-width).
		const usersColumns = Array.from({ length: 11 }, () => ({}));
		expect(getMobileDetailWideModes(usersColumns)).toEqual([
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			"auto",
		]);
	});

	it("marks explicit mobileWide columns and balances preceding odd runs", () => {
		// Mirrors Admins mobile card: 7 standard tiles, wide Traffic bar, 2 trailing tiles.
		const columns = [
			{},
			{},
			{},
			{},
			{},
			{},
			{},
			{ mobileWide: true },
			{},
			{},
		];
		expect(getMobileDetailWideModes(columns)).toEqual([
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			"auto",
			"true",
			undefined,
			undefined,
		]);
	});

	it("does not widen the tile before mobileWide when the preceding run is even", () => {
		const columns = [{}, {}, { mobileWide: true }, {}];
		expect(getMobileDetailWideModes(columns)).toEqual([
			undefined,
			undefined,
			"true",
			"auto",
		]);
	});

	it("handles leading, consecutive, and empty column lists cleanly", () => {
		expect(getMobileDetailWideModes([])).toEqual([]);
		expect(
			getMobileDetailWideModes([{ mobileWide: true }, { mobileWide: true }]),
		).toEqual(["true", "true"]);
	});
});

describe("orderRowActions pinned mobile user bar order", () => {
	it("places edit first, followed by pinned copy and quick-edit actions", () => {
		const actions: RowActionItem[] = [
			{ id: "copy-subscription", label: "Copy link", pinned: true },
			{ id: "copy-configs", label: "Copy configs", pinned: true },
			{ id: "qr", label: "QR Code" },
			{ id: "edit", label: "Edit user", pinned: true },
			{ id: "set-data-limit", label: "Update data limit", pinned: true },
			{ id: "set-expiry", label: "Update expiry", pinned: true },
			{ id: "delete", label: "Delete user", isDanger: true },
		];

		const ordered = orderRowActions(actions);
		const pinnedIds = ordered.filter((action) => action.pinned).map((action) => action.id);
		const overflowIds = ordered.filter((action) => !action.pinned).map((action) => action.id);

		expect(pinnedIds).toEqual([
			"edit",
			"copy-subscription",
			"copy-configs",
			"set-data-limit",
			"set-expiry",
		]);
		expect(overflowIds).toEqual(["qr", "delete"]);
	});
});
