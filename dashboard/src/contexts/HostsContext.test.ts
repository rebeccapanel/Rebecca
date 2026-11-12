import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("service/http", () => ({ fetch: vi.fn() }));

import { fetch as apiFetch } from "service/http";

import { useHosts } from "./HostsContext";

type PendingRequest = { resolve: (value: unknown) => void };

describe("fetchHosts", () => {
	afterEach(() => {
		vi.clearAllMocks();
		useHosts.setState({ loading: false, hosts: {} });
	});

	it("keeps the newest hosts response when requests finish out of order", async () => {
		const pending: PendingRequest[] = [];
		vi.mocked(apiFetch).mockImplementation(
			() =>
				new Promise((resolve) => {
					pending.push({ resolve });
				}),
		);

		const first = useHosts.getState().fetchHosts();
		const second = useHosts.getState().fetchHosts();

		pending[1].resolve({ fresh: [] });
		await second;
		pending[0].resolve({ stale: [] });
		await first;

		expect(useHosts.getState().hosts).toEqual({ fresh: [] });
		expect(useHosts.getState().loading).toBe(false);
	});
});
