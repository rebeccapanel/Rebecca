import { describe, expect, it } from "vitest";
import {
	buildInboundPayload,
	rawInboundToFormValues,
	validateInboundFormFields,
} from "./inbounds";

const raw = {
	tag: "split",
	port: 2087,
	protocol: "vless",
	settings: { clients: [], decryption: "none" },
	streamSettings: {
		network: "xhttp",
		security: "none",
		xhttpSettings: {
			mode: "stream-up",
			path: "/split",
			futureOption: 5,
			downloadSettings: {
				address: "down.example.com",
				port: 8445,
				network: "xhttp",
				security: "tls",
				sockopt: { mark: 1 },
				tlsSettings: {
					serverName: "down.example.com",
					fingerprint: "firefox",
					alpn: ["h2"],
				},
				xhttpSettings: { mode: "auto", path: "/split" },
			},
		},
	},
};

describe("XHTTP download settings", () => {
	it("keeps them and unknown keys when creating from JSON", () => {
		const payload = buildInboundPayload(rawInboundToFormValues(raw));
		expect(payload.streamSettings?.xhttpSettings).toMatchObject({
			futureOption: 5,
			downloadSettings: raw.streamSettings.xhttpSettings.downloadSettings,
		});
	});

	it("removes them when disabled, even when editing", () => {
		const values = rawInboundToFormValues(raw);
		values.xhttpDownload = { ...values.xhttpDownload, enabled: false };
		const payload = buildInboundPayload(values, { initial: raw });
		expect(payload.streamSettings?.xhttpSettings).not.toHaveProperty(
			"downloadSettings",
		);
	});

	it("defaults the download path to the upload path", () => {
		const values = rawInboundToFormValues(raw);
		values.xhttpDownload.settings.xhttpSettings.path = "";
		const download =
			buildInboundPayload(values).streamSettings?.xhttpSettings
				?.downloadSettings;
		expect(download.xhttpSettings.path).toBe("/split");
	});

	it("requires an address and rejects stream-one", () => {
		const values = rawInboundToFormValues(raw);
		values.xhttpMode = "stream-one";
		values.xhttpDownload.settings.address = "";
		const errors = validateInboundFormFields(values);
		expect(errors.xhttpDownload).toBeTruthy();
		expect(errors.xhttpDownloadAddress).toBeTruthy();
	});

	it("keeps every download option typed in the form", () => {
		const values = rawInboundToFormValues(raw);
		values.xhttpDownload.headers = "X-A: 1";
		values.xhttpDownload.settings.xhttpSettings.xmux = {
			maxConcurrency: "16-32",
			hKeepAlivePeriod: "30",
		};
		const download =
			buildInboundPayload(values).streamSettings?.xhttpSettings
				?.downloadSettings;
		expect(download.xhttpSettings).toMatchObject({
			headers: { "X-A": "1" },
			xmux: { maxConcurrency: "16-32", hKeepAlivePeriod: 30 },
		});
	});

	it("keeps packet and stream options when the mode is default", () => {
		const values = rawInboundToFormValues(raw);
		values.xhttpMode = "";
		values.xhttpScMaxEachPostBytes = "500000";
		values.xhttpNoGRPCHeader = true;
		values.xhttpH2Params = '{"MaxConcurrentStreams":100}';
		expect(
			buildInboundPayload(values).streamSettings?.xhttpSettings,
		).toMatchObject({
			scMaxEachPostBytes: "500000",
			noGRPCHeader: true,
			h2Params: { MaxConcurrentStreams: 100 },
		});
	});

	it("flattens extra the way Xray reads it", () => {
		const values = rawInboundToFormValues({
			...raw,
			streamSettings: {
				network: "xhttp",
				xhttpSettings: {
					path: "/p",
					xPaddingBytes: "1-2",
					extra: { xPaddingBytes: "100-200" },
				},
			},
		});
		const result = buildInboundPayload(values).streamSettings?.xhttpSettings;
		expect(result.xPaddingBytes).toBe("100-200");
		expect(result).not.toHaveProperty("extra");
	});
});
