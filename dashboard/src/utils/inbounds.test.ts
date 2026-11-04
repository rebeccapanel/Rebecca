import { describe, expect, it } from "vitest";

import {
	buildInboundPayload,
	createDefaultInboundForm,
	getInboundTraffic,
	inboundTagAllowsEmoji,
	parseHeaderPairs,
	protocolLabel,
	protocolSupportsHosts,
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

describe("additional proxy inbounds", () => {
	it("builds SSH, MTProxy and WEB payloads with their runtime boundaries", () => {
		const ssh = createDefaultInboundForm("ssh");
		ssh.tag = "ssh";
		ssh.port = "2222";
		expect(buildInboundPayload(ssh)).not.toHaveProperty("streamSettings");

		const mt = createDefaultInboundForm("mtproto");
		Object.assign(mt, {
			tag: "telegram",
			port: "8443",
			mtPublicHost: "proxy.example.com",
		});
		expect(validateInboundFormFields(mt)).toEqual({});
		expect(buildInboundPayload(mt)).not.toHaveProperty("sniffing");

		const web = createDefaultInboundForm("web");
		Object.assign(web, {
			tag: "web",
			webHostname: "proxy.example.com",
			webACMEEmail: "admin@example.com",
		});
		expect(validateInboundFormFields(web)).toEqual({});
		expect(buildInboundPayload(web)).toMatchObject({
			protocol: "web",
			port: 443,
		});
	});
});

describe("extra VPN inbounds", () => {
	it("round-trips AmneziaWG, SSTP and GRE without Xray stream settings", () => {
		const awg = createDefaultInboundForm("amneziawg");
		Object.assign(awg, {
			tag: "awg",
			wgPrivateKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
			wgTunnelPort: "51821",
		});
		expect(validateInboundFormFields(awg)).toEqual({});
		expect(buildInboundPayload(awg)).toMatchObject({
			protocol: "amneziawg",
			settings: { jc: 4, jmin: 8, jmax: 80 },
		});

		const sstp = createDefaultInboundForm("sstp");
		Object.assign(sstp, {
			tag: "sstp",
			raServerCertificate: "cert",
			raServerKey: "key",
		});
		expect(validateInboundFormFields(sstp)).toEqual({});
		expect(buildInboundPayload(sstp)).not.toHaveProperty("streamSettings");

		const gre = createDefaultInboundForm("gre");
		gre.tag = "gre";
		expect(validateInboundFormFields(gre)).toEqual({});
		expect(buildInboundPayload(gre)).toMatchObject({
			port: 47,
			settings: { ipv4_pool_cidr: "10.74.0.0/16", ttl: 64 },
		});
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
		values.vlessFlow = "";
		expect(buildInboundPayload(values, { initial: raw }).settings.flow).toBe("");
	});
});

describe("TLS cipher suites", () => {
	it("round-trips current TLS, sniffing, certificate, and sockopt fields", () => {
		const raw: RawInbound = {
			tag: "tls-current",
			port: 443,
			protocol: "vless",
			settings: { decryption: "none" },
			sniffing: {
				enabled: true,
				destOverride: ["http", "tls"],
				ipsExcluded: ["geoip:private"],
				domainsExcluded: ["geosite:private"],
			},
			streamSettings: {
				network: "raw",
				security: "tls",
				tlsSettings: {
					curvePreferences: ["X25519MLKEM768", "X25519"],
					certificates: [
						{
							certificateFile: "/cert.pem",
							keyFile: "/key.pem",
							ocspStapling: 3600,
						},
					],
				},
				sockopt: {
					trustedXForwardedFor: ["X-Forwarded-For"],
					customSockopt: [{ level: "SOL_SOCKET", opt: "SO_KEEPALIVE" }],
				},
			},
		};

		const values = rawInboundToFormValues(raw);
		const payload = buildInboundPayload(values, { initial: raw });
		expect(payload.sniffing).toMatchObject({
			ipsExcluded: ["geoip:private"],
			domainsExcluded: ["geosite:private"],
		});
		expect(payload.streamSettings?.tlsSettings).toMatchObject({
			curvePreferences: ["X25519MLKEM768", "X25519"],
			certificates: [{ ocspStapling: 3600 }],
		});
		expect(payload.streamSettings?.sockopt).toMatchObject({
			trustedXForwardedFor: ["X-Forwarded-For"],
			customSockopt: [{ level: "SOL_SOCKET", opt: "SO_KEEPALIVE" }],
		});
	});

	it("round-trips peer name verification and certificate pins", () => {
		const pin = "ab".repeat(32);
		const values = rawInboundToFormValues({
			tag: "tls",
			port: 443,
			protocol: "vless",
			settings: { decryption: "none" },
			streamSettings: {
				network: "raw",
				security: "tls",
				tlsSettings: {
					verifyPeerCertByName: "cert.example.com",
					pinnedPeerCertSha256: pin,
				},
			},
		});
		expect(values.tlsVerifyPeerCertByName).toBe("cert.example.com");
		expect(values.tlsPinnedPeerCertSha256).toBe(pin);
		expect(
			buildInboundPayload(values).streamSettings?.tlsSettings,
		).toMatchObject({
			verifyPeerCertByName: "cert.example.com",
			pinnedPeerCertSha256: pin,
		});
		values.tlsPinnedPeerCertSha256 = "bad";
		expect(
			validateInboundFormFields(values).tlsPinnedPeerCertSha256,
		).toBeTruthy();
	});

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
					sessionIDTable: "base64",
					sessionIDLength: "16-16",
					xmux: {
						maxConcurrency: "16-32",
						maxConnections: "0",
						hKeepAlivePeriod: 30,
					},
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
			sessionIDTable: "base64",
			sessionIDLength: "16-16",
			xmux: {
				maxConcurrency: "16-32",
				maxConnections: "0",
				hKeepAlivePeriod: 30,
			},
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

	it.each(["auto", "packet-up", "stream-up"])(
		"keeps the server buffer limit and unmanaged keys in %s mode",
		(mode) => {
			const h2Params = { MaxConcurrentStreams: 512 };
			const raw: RawInbound = {
				tag: "xhttp",
				port: 80,
				protocol: "vless",
				settings: { decryption: "none" },
				streamSettings: {
					network: "xhttp",
					security: "none",
					xhttpSettings: {
						path: "/",
						mode,
						scMaxBufferedPosts: 30,
						h2Params,
						futureKey: "kept",
					},
				},
			};

			const payload = buildInboundPayload(rawInboundToFormValues(raw), {
				initial: raw,
			});
			expect(payload.streamSettings?.xhttpSettings).toMatchObject({
				scMaxBufferedPosts: 30,
				h2Params,
				futureKey: "kept",
			});
		},
	);

	it("round-trips WebSocket heartbeat and current mKCP tuning", () => {
		const ws = rawInboundToFormValues({
			tag: "ws",
			port: 443,
			protocol: "vless",
			settings: { decryption: "none" },
			streamSettings: {
				network: "ws",
				security: "none",
				wsSettings: {
					path: "/ws",
					heartbeatPeriod: 30,
					acceptProxyProtocol: true,
				},
			},
		});
		expect(buildInboundPayload(ws).streamSettings?.wsSettings).toMatchObject({
			heartbeatPeriod: 30,
			acceptProxyProtocol: true,
		});

		const kcp = rawInboundToFormValues({
			tag: "kcp",
			port: 443,
			protocol: "vless",
			settings: { decryption: "none" },
			streamSettings: {
				network: "kcp",
				security: "none",
				kcpSettings: {
					mtu: 1350,
					tti: 50,
					uplinkCapacity: 5,
					downlinkCapacity: 20,
					cwndMultiplier: 1,
					maxSendingWindow: 2097152,
					congestion: true,
					readBufferSize: 2,
					writeBufferSize: 2,
				},
			},
		});
		expect(buildInboundPayload(kcp).streamSettings?.kcpSettings).toMatchObject({
			mtu: 1350,
			tti: 50,
			uplinkCapacity: 5,
			downlinkCapacity: 20,
			cwndMultiplier: 1,
			maxSendingWindow: 2097152,
			congestion: true,
			readBufferSize: 2,
			writeBufferSize: 2,
		});
	});

	it("round-trips current gRPC and HTTPUpgrade transport fields", () => {
		const grpc = rawInboundToFormValues({
			tag: "grpc",
			port: 443,
			protocol: "vless",
			settings: { decryption: "none" },
			streamSettings: {
				network: "grpc",
				security: "none",
				grpcSettings: {
					serviceName: "service",
					authority: "example.com",
					multiMode: true,
					idle_timeout: 60,
					health_check_timeout: 20,
					permit_without_stream: true,
					initial_windows_size: 65535,
					user_agent: "grpc-go/1.0",
				},
			},
		});
		expect(
			buildInboundPayload(grpc).streamSettings?.grpcSettings,
		).toMatchObject({
			idle_timeout: 60,
			health_check_timeout: 20,
			permit_without_stream: true,
			initial_windows_size: 65535,
			user_agent: "grpc-go/1.0",
		});

		const upgrade = rawInboundToFormValues({
			tag: "upgrade",
			port: 443,
			protocol: "vless",
			settings: { decryption: "none" },
			streamSettings: {
				network: "httpupgrade",
				security: "none",
				httpupgradeSettings: {
					path: "/upgrade",
					host: "example.com",
					headers: { X_Test: "value" },
					acceptProxyProtocol: true,
				},
			},
		});
		expect(
			buildInboundPayload(upgrade).streamSettings?.httpupgradeSettings,
		).toMatchObject({
			headers: { X_Test: "value" },
			acceptProxyProtocol: true,
		});
	});

	it("round-trips REALITY fallback limits using the current field names", () => {
		const raw: RawInbound = {
			tag: "reality",
			port: 443,
			protocol: "vless",
			settings: { decryption: "none" },
			streamSettings: {
				network: "raw",
				security: "reality",
				realitySettings: {
					maxTimediff: 1000,
					limitFallbackUpload: {
						afterBytes: 1024,
						bytesPerSec: 2048,
						burstBytesPerSec: 4096,
					},
					limitFallbackDownload: {
						afterBytes: 8192,
						bytesPerSec: 16384,
						burstBytesPerSec: 32768,
					},
				},
			},
		};

		const settings = buildInboundPayload(rawInboundToFormValues(raw), {
			initial: raw,
		}).streamSettings?.realitySettings;
		expect(settings).toMatchObject({
			maxTimeDiff: 1000,
			limitFallbackUpload: {
				afterBytes: 1024,
				bytesPerSec: 2048,
				burstBytesPerSec: 4096,
			},
			limitFallbackDownload: {
				afterBytes: 8192,
				bytesPerSec: 16384,
				burstBytesPerSec: 32768,
			},
		});
		expect(settings).not.toHaveProperty("maxTimediff");
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
			xhttpXmuxMaxConcurrency: "16-32",
			xhttpXmuxMaxConnections: "2",
			xhttpXmuxHKeepAlivePeriod: "-2",
		});

		const errors = validateInboundFormFields(values);
		expect(errors.xhttpUplinkHTTPMethod).toContain("packet-up");
		expect(errors.xhttpSessionKey).toContain("HTTP token");
		expect(errors.xhttpUplinkDataPlacement).toContain("packet-up");
		expect(errors.xhttpUplinkChunkSize).toContain("range start");
		expect(errors.xhttpServerMaxHeaderBytes).toContain("non-negative");
		expect(errors.xhttpXmuxMaxConnections).toContain("cannot be combined");
		expect(errors.xhttpXmuxHKeepAlivePeriod).toContain("between -1");
		values.xhttpXmuxMaxConnections = "0";
		values.xhttpXmuxHKeepAlivePeriod = "-1";
		const corrected = validateInboundFormFields(values);
		expect(corrected.xhttpXmuxMaxConnections).toBeUndefined();
		expect(corrected.xhttpXmuxHKeepAlivePeriod).toBeUndefined();
	});
});

describe("unmodeled stream settings", () => {
	const roundTrip = (raw: RawInbound) =>
		buildInboundPayload(rawInboundToFormValues(raw), { initial: raw });

	it("keeps finalmask masks on networks whose form cannot edit them", () => {
		const finalmask = {
			tcp: [{ type: "fragment", settings: { packets: "tlshello", length: "100-200", delay: "10-20" } }],
			udp: [{ type: "header-custom", settings: { client: [{ type: "str", packet: "x" }] } }],
		};
		const raw: RawInbound = {
			tag: "vless-ws",
			port: 443,
			protocol: "vless",
			settings: { decryption: "none", clients: [] },
			streamSettings: { network: "ws", security: "none", wsSettings: { path: "/" }, finalmask },
		};
		expect(roundTrip(raw).streamSettings?.finalmask).toEqual(finalmask);
	});

	it("keeps Hysteria masks and QUIC flags the form does not model, in place", () => {
		const finalmask = {
			tcp: [{ type: "fragment", settings: { packets: "tlshello" } }],
			udp: [
				{ type: "realm", settings: { url: "https://realm.example.test" } },
				{ type: "salamander", settings: { password: "secret" } },
			],
			quicParams: { congestion: "bbr", disableGSO: true, disableChromeParrot: true },
		};
		const raw: RawInbound = {
			tag: "hy",
			port: 443,
			protocol: "hysteria",
			settings: { version: 2, clients: [] },
			streamSettings: {
				network: "hysteria",
				security: "tls",
				hysteriaSettings: { version: 2 },
				tlsSettings: { serverName: "x.test", certificates: [{ certificateFile: "/a", keyFile: "/b" }] },
				finalmask,
			},
		};
		const out = roundTrip(raw).streamSettings?.finalmask;
		expect(out?.tcp).toEqual(finalmask.tcp);
		expect(out?.udp).toEqual(finalmask.udp);
		expect(out?.quicParams).toMatchObject({ congestion: "bbr", disableGSO: true, disableChromeParrot: true });
	});

	it("keeps XDRIVE settings and its stream address", () => {
		const raw: RawInbound = {
			tag: "xd",
			port: 8443,
			protocol: "vless",
			settings: { decryption: "mlkem768x25519plus.native.600s.test", clients: [] },
			streamSettings: {
				network: "xdrive",
				security: "none",
				address: "www.googleapis.com",
				port: 443,
				xdriveSettings: { service: "google-drive", remoteFolder: "rb", secrets: ["a", "b", "c"], segmentBytes: 524288 },
			},
		};
		const stream = roundTrip(raw).streamSettings;
		expect(stream?.xdriveSettings).toEqual(raw.streamSettings?.xdriveSettings);
		expect(stream).toMatchObject({ address: "www.googleapis.com", port: 443 });
	});
});

describe("inbound port lists", () => {
	it("accepts several ports for Xray proxy inbounds and writes them as one value", () => {
		const vless = createDefaultInboundForm("vless");
		Object.assign(vless, { tag: "multi", port: "443, 8443" });
		expect(validateInboundFormFields(vless)).toEqual({});
		expect(buildInboundPayload(vless).port).toBe("443,8443");

		const single = createDefaultInboundForm("vless");
		Object.assign(single, { tag: "single", port: "443" });
		expect(buildInboundPayload(single).port).toBe(443);
	});

	it("rejects repeated, out-of-range or malformed lists", () => {
		const vless = createDefaultInboundForm("vless");
		Object.assign(vless, { tag: "bad" });
		for (const port of ["443,443", "443,70000", "443,", "443,abc"]) {
			vless.port = port;
			expect(validateInboundFormFields(vless).port).toBeTruthy();
		}
	});

	it("keeps single-port protocols to one port", () => {
		const openvpn = createDefaultInboundForm("openvpn");
		Object.assign(openvpn, { tag: "ov", port: "1194,1195" });
		expect(validateInboundFormFields(openvpn).port).toBeTruthy();
	});
});

describe("inbound tags", () => {
	it("allows emoji on Xray inbounds and keeps native VPN names ASCII", () => {
		expect(inboundTagAllowsEmoji("vless")).toBe(true);
		expect(inboundTagAllowsEmoji("socks")).toBe(true);
		expect(inboundTagAllowsEmoji("wireguard")).toBe(false);
		expect(inboundTagAllowsEmoji("openvpn")).toBe(false);
	});
});

describe("TCP header inbound settings", () => {
	it("opens and saves an HTTP header that was created with an empty path", () => {
		const raw: RawInbound = {
			tag: "tcp-empty-header",
			port: 443,
			protocol: "vless",
			settings: { decryption: "none" },
			streamSettings: {
				network: "tcp",
				security: "none",
				tcpSettings: {
					header: {
						type: "http",
						request: { version: "1.1", method: "GET", path: [], headers: {} },
					},
				},
			},
		};

		const values = rawInboundToFormValues(raw);
		expect(values.tcpHttpPath).toBe("");
		expect(
			buildInboundPayload(values, { initial: raw }).streamSettings?.tcpSettings,
		).toMatchObject({
			header: { type: "http", request: { path: [] } },
		});
	});
});

describe("xhttp custom headers", () => {
	it("keeps a comma-separated value as one header", () => {
		const values = createDefaultInboundForm();
		values.streamNetwork = "xhttp";
		values.xhttpHeaders = [
			{ name: "Accept-Language", value: "en-US,en;q=0.9,fa;q=0.8" },
		];
		expect(buildInboundPayload(values).streamSettings).toMatchObject({
			xhttpSettings: {
				headers: { "Accept-Language": "en-US,en;q=0.9,fa;q=0.8" },
			},
		});
	});

	it("parses pasted name=value pairs with quoted values", () => {
		expect(
			parseHeaderPairs(
				'Accept-Language="en-US,en;q=0.9,fa;q=0.8" Origin="https://offline.example.org" Sec-Fetch-Site="same-origin"',
			),
		).toEqual([
			{ name: "Accept-Language", value: "en-US,en;q=0.9,fa;q=0.8" },
			{ name: "Origin", value: "https://offline.example.org" },
			{ name: "Sec-Fetch-Site", value: "same-origin" },
		]);
		expect(parseHeaderPairs("X-Token=abc")).toEqual([
			{ name: "X-Token", value: "abc" },
		]);
		expect(parseHeaderPairs("Accept-Language")).toBeUndefined();
		expect(parseHeaderPairs("   ")).toBeUndefined();
	});
});

describe("Xray service inbounds", () => {
	const roundTrip = (raw: RawInbound) =>
		buildInboundPayload(rawInboundToFormValues(raw), { initial: raw });
	const WG_SECRET = "iJ2cBkrSGqRwIfYIDIxk7hr5RXfdR93MfJUL7yqkkH8=";
	const WG_PEER = "DGSYIcEKAUkA7HhzGSjxLZuV67BR3LeyU0BMLJzNVHQ=";

	it("emits the 3x-ui settings for http, mixed and tunnel", () => {
		const http = roundTrip({
			tag: "h",
			port: 8080,
			protocol: "http",
			settings: { accounts: [{ user: "proxyuser", pass: "proxypass" }], allowTransparent: false },
		});
		expect(http.settings.accounts).toEqual([{ user: "proxyuser", pass: "proxypass" }]);
		expect(http.streamSettings).toBeUndefined();

		const mixed = roundTrip({
			tag: "m",
			port: 1080,
			protocol: "mixed",
			settings: { auth: "password", accounts: [{ user: "socksuser", pass: "sockspass" }], udp: true, ip: "127.0.0.1" },
		});
		expect(mixed.settings).toEqual({
			auth: "password",
			accounts: [{ user: "socksuser", pass: "sockspass" }],
			udp: true,
			ip: "127.0.0.1",
		});

		const tunnel = roundTrip({
			tag: "t",
			port: 8443,
			protocol: "tunnel",
			settings: {
				rewriteAddress: "1.1.1.1",
				rewritePort: 53,
				portMap: { "8080": "10.0.0.5:80", "8443": "10.0.0.5:443" },
				allowedNetwork: "tcp,udp",
				followRedirect: false,
			},
		});
		expect(tunnel.settings).toMatchObject({
			rewriteAddress: "1.1.1.1",
			rewritePort: 53,
			portMap: { "8080": "10.0.0.5:80", "8443": "10.0.0.5:443" },
			allowedNetwork: "tcp,udp",
			followRedirect: false,
		});
	});

	it("round-trips a WireGuard (Xray) inbound with its peers and keeps tunnel sockopt", () => {
		const out = roundTrip({
			tag: "w",
			port: 51820,
			protocol: "wireguard-xray",
			settings: {
				mtu: 1420,
				secretKey: WG_SECRET,
				peers: [{ privateKey: WG_SECRET, publicKey: WG_PEER, allowedIPs: ["10.0.0.2/32"], keepAlive: 25 }],
				noKernelTun: false,
			},
			streamSettings: { sockopt: { tcpFastOpen: true } },
		});
		expect(out.settings).toMatchObject({
			mtu: 1420,
			secretKey: WG_SECRET,
			peers: [{ publicKey: WG_PEER, privateKey: WG_SECRET, allowedIPs: ["10.0.0.2/32"], keepAlive: 25 }],
			noKernelTun: false,
		});
		expect(out.streamSettings).toEqual({ sockopt: { tcpFastOpen: true } });
	});

	it("gives TUN no listener and the 3x-ui defaults", () => {
		const out = buildInboundPayload(createDefaultInboundForm("tun"));
		expect(out.port).toBe(0);
		expect(out.streamSettings).toBeUndefined();
		expect(out.settings).toMatchObject({ name: "xray0", mtu: 1500, userLevel: 0, autoOutboundsInterface: "auto" });
		expect(validateInboundFormFields({ ...createDefaultInboundForm("tun"), tag: "tun-1", port: "" }).port).toBeUndefined();
	});

	it("seeds new inbounds with random accounts and a fresh WireGuard key", () => {
		const http = createDefaultInboundForm("http");
		expect(http.httpAccounts[0].user).toHaveLength(8);
		expect(http.httpAccounts[0].pass).toHaveLength(12);
		const mixed = createDefaultInboundForm("mixed");
		expect(mixed.socksAuth).toBe("password");
		expect(mixed.socksUdpIp).toBe("127.0.0.1");
		const wg = createDefaultInboundForm("wireguard-xray");
		expect(atob(wg.wgxSecretKey)).toHaveLength(32);
		expect(createDefaultInboundForm("wireguard-xray").wgxSecretKey).not.toBe(wg.wgxSecretKey);
	});

	it("rejects incomplete service inbounds before they reach the server", () => {
		const base = { tag: "x", port: "8443" };
		expect(
			validateInboundFormFields({ ...createDefaultInboundForm("tunnel"), ...base }).tunnelRewriteAddress,
		).toBeDefined();
		expect(
			validateInboundFormFields({
				...createDefaultInboundForm("mixed"),
				...base,
				socksAuth: "password",
				socksAccounts: [{ user: "", pass: "" }],
			}).socksAccounts,
		).toBeDefined();
		expect(
			validateInboundFormFields({ ...createDefaultInboundForm("wireguard-xray"), ...base, wgxSecretKey: "short" }).wgxSecretKey,
		).toBeDefined();
	});

	it("labels the Xray WireGuard apart from Rebecca's and blocks hosts for service inbounds", () => {
		expect(protocolLabel("wireguard-xray")).toBe("WIREGUARD(XRAY)");
		expect(protocolLabel("wireguard")).toBe("WIREGUARD");
		for (const protocol of ["http", "mixed", "tunnel", "tun", "wireguard-xray"]) {
			expect(protocolSupportsHosts(protocol)).toBe(false);
		}
		expect(protocolSupportsHosts("wireguard")).toBe(true);
		expect(protocolSupportsHosts("vless")).toBe(true);
	});
});
