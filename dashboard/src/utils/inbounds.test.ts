import { describe, expect, it } from "vitest";

import {
	buildInboundPayload,
	createDefaultInboundForm,
	getInboundTraffic,
	rawInboundToFormValues,
	type RawInbound,
	validateInboundFormFields,
} from "./inbounds";

describe("inbound traffic", () => {
	it("maps uplink to upload, downlink to download, and tolerates old responses", () => {
		const base = { tag: "in", port: 443, protocol: "vless", settings: {} };
		expect(
			getInboundTraffic({ ...base, uplink: 1024, downlink: 2048 }),
		).toEqual({
			upload: 1024,
			download: 2048,
			total: 3072,
		});
		expect(getInboundTraffic(base)).toEqual({
			upload: 0,
			download: 0,
			total: 0,
		});
	});
});

describe("inbound usage coefficient", () => {
	it("round-trips as panel metadata and defaults to one", () => {
		const raw: RawInbound = {
			tag: "weighted",
			port: 443,
			protocol: "vless",
			settings: { decryption: "none" },
			usage_coefficient: 1.5,
		};
		const values = rawInboundToFormValues(raw);
		expect(values.usageCoefficient).toBe("1.5");
		expect(buildInboundPayload(values).usage_coefficient).toBe(1.5);
		expect(createDefaultInboundForm().usageCoefficient).toBe("1");
	});

	it("rejects coefficients outside the supported range", () => {
		const values = createDefaultInboundForm();
		values.usageCoefficient = "0";
		expect(validateInboundFormFields(values).usageCoefficient).toBeTruthy();
		values.usageCoefficient = "101";
		expect(validateInboundFormFields(values).usageCoefficient).toBeTruthy();
	});
});

describe("VLESS inbound default flow", () => {
	it("round-trips the supported inbound value and drops outbound-only values", () => {
		const raw: RawInbound = {
			tag: "vless-flow",
			port: 443,
			protocol: "vless",
			settings: { decryption: "none", flow: "xtls-rprx-vision" },
			streamSettings: {
				network: "raw",
				security: "tls",
			},
		};

		const values = rawInboundToFormValues(raw);
		expect(values.vlessFlow).toBe("xtls-rprx-vision");
		expect(
			buildInboundPayload(values, { initial: raw }).settings,
		).toMatchObject({
			flow: "xtls-rprx-vision",
		});

		const invalid = rawInboundToFormValues({
			...raw,
			settings: {
				...raw.settings,
				flow: "xtls-rprx-vision-udp443",
			},
		});
		expect(invalid.vlessFlow).toBe("");
	});
});

describe("TLS cipher suites", () => {
	it("preserves TLS 1.2 suites and requires native Go TLS", () => {
		const values = createDefaultInboundForm("vless");
		values.streamSecurity = "tls";
		values.tlsCipherSuites =
			"TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256:TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256";
		expect(validateInboundFormFields(values).tlsFingerprint).toBeTruthy();
		values.tlsFingerprint = "unsafe";
		expect(validateInboundFormFields(values).tlsFingerprint).toBeUndefined();
		expect(
			buildInboundPayload(values).streamSettings?.tlsSettings?.cipherSuites,
		).toBe(values.tlsCipherSuites);
	});

	it("omits cipher suites for Hysteria QUIC", () => {
		const values = createDefaultInboundForm("hysteria");
		values.tlsCipherSuites = "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256";
		expect(
			buildInboundPayload(values).streamSettings?.tlsSettings,
		).not.toHaveProperty("cipherSuites");
	});
});

describe("XHTTP inbound settings", () => {
	it.each([
		["current", { sessionIDPlacement: "header", sessionIDKey: "X-Session" }],
		["legacy", { sessionPlacement: "header", sessionKey: "X-Session" }],
	])("round-trips %s session ID fields through the current schema", (_, session) => {
		const raw: RawInbound = {
			tag: "xhttp",
			port: 443,
			protocol: "vless",
			settings: { decryption: "none" },
			streamSettings: {
				network: "xhttp",
				security: "none",
				xhttpSettings: {
					path: "/x",
					mode: "packet-up",
					...session,
					seqPlacement: "query",
					seqKey: "x_seq",
					uplinkHTTPMethod: "GET",
					uplinkDataPlacement: "header",
					uplinkDataKey: "X-Data",
					uplinkChunkSize: "3000-4000",
					serverMaxHeaderBytes: 8192,
				},
			},
		};

		const values = rawInboundToFormValues(raw);
		expect(values.xhttpSessionPlacement).toBe("header");
		expect(values.xhttpSessionKey).toBe("X-Session");

		const payload = buildInboundPayload(values, { initial: raw });
		const settings = payload.streamSettings?.xhttpSettings;
		expect(settings).toMatchObject({
			sessionIDPlacement: "header",
			sessionIDKey: "X-Session",
			seqPlacement: "query",
			seqKey: "x_seq",
			uplinkHTTPMethod: "GET",
			uplinkDataPlacement: "header",
			uplinkDataKey: "X-Data",
			uplinkChunkSize: "3000-4000",
			serverMaxHeaderBytes: 8192,
		});
		expect(settings).not.toHaveProperty("sessionPlacement");
		expect(settings).not.toHaveProperty("sessionKey");
	});

	it("rejects unsafe tokens, invalid mode combinations, and invalid ranges", () => {
		const values = createDefaultInboundForm("vless");
		Object.assign(values, {
			tag: "xhttp",
			streamNetwork: "xhttp",
			xhttpMode: "auto",
			xhttpUplinkHTTPMethod: "GET",
			xhttpSessionKey: "X-Session\r\nInjected",
			xhttpUplinkDataPlacement: "header",
			xhttpUplinkChunkSize: "4000-3000",
			xhttpServerMaxHeaderBytes: "-1",
		});

		const errors = validateInboundFormFields(values);
		expect(errors.xhttpUplinkHTTPMethod).toContain("packet-up");
		expect(errors.xhttpSessionKey).toContain("HTTP token");
		expect(errors.xhttpUplinkDataPlacement).toContain("packet-up");
		expect(errors.xhttpUplinkChunkSize).toContain("range start");
		expect(errors.xhttpServerMaxHeaderBytes).toContain("non-negative");
	});
});
