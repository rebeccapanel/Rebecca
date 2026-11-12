import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("service/http", () => ({ fetch: vi.fn() }));

import { fetch as apiFetch } from "service/http";

import { lastServicePageOffset, useServicesStore } from "./ServicesContext";

type PendingRequest = { resolve: (value: unknown) => void };

describe("fetchServiceDetail", () => {
	afterEach(() => {
		vi.clearAllMocks();
		useServicesStore.setState({ loading: false, serviceDetail: null });
	});

	it("keeps the newest service detail when requests finish out of order", async () => {
		const pending: PendingRequest[] = [];
		vi.mocked(apiFetch).mockImplementation(
			() =>
				new Promise((resolve) => {
					pending.push({ resolve });
				}),
		);

		const first = useServicesStore.getState().fetchServiceDetail(1);
		const second = useServicesStore.getState().fetchServiceDetail(2);

		pending[1].resolve({ id: 2, name: "new" });
		expect(await second).toMatchObject({ id: 2 });
		pending[0].resolve({ id: 1, name: "old" });
		expect(await first).toBeNull();

		expect(useServicesStore.getState().serviceDetail).toMatchObject({ id: 2 });
		expect(useServicesStore.getState().loading).toBe(false);
	});
});

describe("fetchServices", () => {
	afterEach(() => {
		vi.clearAllMocks();
		useServicesStore.setState({ services: [], summaryServices: [], total: 0, loading: false });
	});

	it("requests the page it is given with its search", async () => {
		vi.mocked(apiFetch).mockResolvedValue({ services: [], total: 0 });

		await useServicesStore.getState().fetchServices({ limit: 20, offset: 40, name: "vip" });
		expect(vi.mocked(apiFetch).mock.calls.at(-1)?.[1]).toMatchObject({
			query: { limit: 20, offset: 40, name: "vip" },
		});
	});

	it("keeps the current page when the list is refreshed after a change", async () => {
		vi.mocked(apiFetch).mockResolvedValue({ services: [], total: 0 });

		await useServicesStore.getState().fetchServices({ limit: 10, offset: 20 });
		vi.mocked(apiFetch).mockClear();
		await useServicesStore.getState().refreshServices();

		const calls = vi.mocked(apiFetch).mock.calls.map((call) => call[1]);
		expect(calls).toContainEqual(expect.objectContaining({ query: { limit: 10, offset: 20 } }));
		expect(calls).toContainEqual(expect.objectContaining({ query: { limit: "none", offset: 0 } }));
	});

	it("loads every service for the summary", async () => {
		const all = [{ id: 1, name: "VIP VPN1" }, { id: 2, name: "other" }];
		vi.mocked(apiFetch).mockResolvedValue({ services: all, total: 2 });

		await useServicesStore.getState().fetchServiceSummary();
		expect(useServicesStore.getState().summaryServices).toEqual(all);
	});

	it("moves a page that is past the end back to the last page", async () => {
		vi.mocked(apiFetch)
			.mockResolvedValueOnce({ services: [], total: 21 })
			.mockResolvedValueOnce({ services: [{ id: 1, name: "VIP VPN1" }], total: 21 });

		await useServicesStore.getState().fetchServices({ limit: 20, offset: 40 });

		expect(vi.mocked(apiFetch).mock.calls.at(-1)?.[1]).toMatchObject({
			query: { limit: 20, offset: 20 },
		});
		expect(useServicesStore.getState().services).toEqual([{ id: 1, name: "VIP VPN1" }]);
	});
});

describe("lastServicePageOffset", () => {
	it("returns the first offset of the last page", () => {
		expect(lastServicePageOffset(21, 20)).toBe(20);
		expect(lastServicePageOffset(20, 20)).toBe(0);
		expect(lastServicePageOffset(0, 20)).toBe(0);
	});
});
