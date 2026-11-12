import { afterEach, describe, expect, it, vi } from "vitest";

import {
	type BackupExportProgress,
	exportRebeccaBackup,
	importRebeccaBackup,
} from "./settings";
import { useAPIRequestErrors } from "./http";

class UploadRequest {
	static current: UploadRequest;
	status = 200;
	response = {
		scope: "database",
		tables_restored: 1,
		rows_restored: 2,
		files_restored: [],
		warnings: [],
	};
	responseType = "";
	withCredentials = false;
	url = "";
	onload: (() => void) | null = null;
	onerror: (() => void) | null = null;
	upload = {
		onprogress: null as ((event: ProgressEvent) => void) | null,
		onload: null as (() => void) | null,
	};

	constructor() {
		UploadRequest.current = this;
	}

	open(_method: string, url: string) {
		this.url = url;
	}

	send() {
		this.upload.onprogress?.({
			lengthComputable: true,
			loaded: 5,
			total: 10,
		} as ProgressEvent);
		this.upload.onload?.();
		this.onload?.();
	}
}

describe("importRebeccaBackup", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		useAPIRequestErrors.getState().clear();
	});

	it("reports upload progress before resolving the restore response", async () => {
		vi.stubGlobal("XMLHttpRequest", UploadRequest);
		const progress: number[] = [];

		const result = await importRebeccaBackup(
			new File(["backup"], "test.rbbackup"),
			(percent) => progress.push(percent),
		);

		expect(progress).toEqual([0, 50, 100]);
		expect(UploadRequest.current.url).toBe("/api/settings/backup/import");
		expect(UploadRequest.current.withCredentials).toBe(true);
		expect(result.rows_restored).toBe(2);
		expect(useAPIRequestErrors.getState().errors).toEqual([]);
	});

	it("surfaces the API error detail when restore fails", async () => {
		class FailedUploadRequest extends UploadRequest {
			status = 408;
			response = {
				detail: "backup upload timed out",
			} as unknown as UploadRequest["response"];
		}
		vi.stubGlobal("XMLHttpRequest", FailedUploadRequest);

		await expect(
			importRebeccaBackup(new File(["backup"], "test.rbbackup")),
		).rejects.toMatchObject({
			message: "backup upload timed out",
			response: { status: 408, _data: { detail: "backup upload timed out" } },
		});
		expect(useAPIRequestErrors.getState().errors).toEqual([{ key: "POST /settings/backup/import", message: "backup upload timed out" }]);
		vi.stubGlobal("XMLHttpRequest", UploadRequest);
		await importRebeccaBackup(new File(["backup"], "test.rbbackup"));
		expect(useAPIRequestErrors.getState().errors).toEqual([]);
	});
});

class ExportRequest {
	static current: ExportRequest;
	status = 200;
	response: Blob = new Blob(["archive-bytes"], { type: "application/octet-stream" });
	responseType = "";
	withCredentials = false;
	url = "";
	onprogress: ((event: ProgressEvent) => void) | null = null;
	onload: (() => void) | null = null;
	onerror: (() => void) | null = null;
	ontimeout: (() => void) | null = null;
	onabort: (() => void) | null = null;

	constructor() {
		ExportRequest.current = this;
	}

	open(_method: string, url: string) {
		this.url = url;
	}

	send() {
		this.onprogress?.({
			lengthComputable: true,
			loaded: 6,
			total: 12,
		} as ProgressEvent);
		void this.onload?.();
	}
}

describe("exportRebeccaBackup", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		useAPIRequestErrors.getState().clear();
	});

	it("reports preparing, downloading, and completed phases", async () => {
		vi.stubGlobal("XMLHttpRequest", ExportRequest);
		const events: BackupExportProgress[] = [];

		const blob = await exportRebeccaBackup("full", (event) => events.push(event));

		expect(ExportRequest.current.url).toBe("/api/settings/backup/export?scope=full");
		expect(ExportRequest.current.withCredentials).toBe(true);
		expect(ExportRequest.current.responseType).toBe("blob");
		expect(events.map((e) => e.phase)).toEqual(["preparing", "downloading", "completed"]);
		expect(events[1]?.percent).toBeGreaterThanOrEqual(50);
		expect(events[2]?.percent).toBe(100);
		expect(blob.size).toBe("archive-bytes".length);
		expect(useAPIRequestErrors.getState().errors).toEqual([]);
	});

	it("surfaces API error detail when export fails", async () => {
		class FailedExportRequest extends ExportRequest {
			status = 500;
			response = new Blob([JSON.stringify({ detail: "backup export failed" })], {
				type: "application/json",
			});
		}
		vi.stubGlobal("XMLHttpRequest", FailedExportRequest);

		await expect(exportRebeccaBackup("database")).rejects.toMatchObject({
			message: "backup export failed",
			response: { status: 500 },
		});
		expect(useAPIRequestErrors.getState().errors).toEqual([
			{ key: "GET /settings/backup/export", message: "backup export failed" },
		]);
	});
});
