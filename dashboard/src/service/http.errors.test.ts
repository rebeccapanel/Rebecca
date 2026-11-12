import { $fetch } from "ofetch";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The request mock is hoisted so the tests never depend on call history:
// vitest 5 clears mock state between tests, which emptied mock.results.
const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock("ofetch", () => ({ $fetch: { create: vi.fn(() => requestMock) } }));

import { fetch, reportAPIError, getAPIErrorMessage, useAPIRequestErrors } from "./http";

describe("shared request error reporting", () => {
	beforeEach(() => useAPIRequestErrors.getState().clear());
	it("keeps backend details even when a caller swallows the error and clears a recovered request", async () => {
		requestMock.mockReset();
		requestMock.mockRejectedValueOnce({ message: "FetchError", response: { status: 502, _data: { detail: "node configuration failed" } } });
		await fetch("/inbounds").catch(() => undefined);
		expect(useAPIRequestErrors.getState().errors).toEqual([{ key: "GET /inbounds", message: "node configuration failed" }]);
		requestMock.mockResolvedValueOnce([]);
		await fetch("/inbounds");
		expect(useAPIRequestErrors.getState().errors).toEqual([]);
	});
	it("reports real stream errors and retains a bounded deduplicated history", () => {
		reportAPIError("STREAM /nodes/metrics", { type: "nodes.metrics", error: "Tor service is missing" });
		expect(useAPIRequestErrors.getState().errors[0].message).toBe("Tor service is missing");
		reportAPIError("STREAM /nodes/metrics", { error: "Tor credentials are missing" });
		expect(useAPIRequestErrors.getState().errors).toHaveLength(1);
		for (let index = 0; index < 30; index++) reportAPIError(`GET /request-${index}`, new Error("failed"));
		expect(useAPIRequestErrors.getState().errors).toHaveLength(20);
		expect(useAPIRequestErrors.getState().errors[0].key).toBe("GET /request-29");
	});
	it("does not retain expired-login errors and decodes backend JSON for text responses", () => {
		reportAPIError("GET /nodes", { response: { status: 401, _data: { detail: "expired session" } } });
		expect(useAPIRequestErrors.getState().errors).toEqual([]);
		expect(getAPIErrorMessage({ response: { _data: '{"detail":"PHP runtime failed"}' } })).toBe("PHP runtime failed");
	});
	it("reports backend details for failed file downloads", async () => {
		requestMock.mockReset();
		requestMock.mockRejectedValueOnce({ response: { status: 500, _data: new Blob(['{"detail":"database backup failed"}'], { type: "application/json" }) } });
		await fetch("/settings/backup/export", { responseType: "blob" } as any).catch(() => undefined);
		expect(useAPIRequestErrors.getState().errors[0].message).toBe("database backup failed");
	});
	it("does not replace a read-only native error with a reporting failure", () => {
		expect(() => reportAPIError("GET /native", Object.freeze({ message: "connection failed" }))).not.toThrow();
		expect(useAPIRequestErrors.getState().errors[0].message).toBe("connection failed");
	});
	it("keeps the selected node when an outbound error is later opened from ERROR", () => {
		vi.stubGlobal("window", { location: { pathname: "/dashboard/xray-settings", search: "?target=node%3A7" } });
		try {
			reportAPIError("POST /panel/xray/testOutbound", new Error("outbound failed"));
			expect(useAPIRequestErrors.getState().errors[0].href).toBe("/xray-settings?target=node%3A7#outbounds");
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
