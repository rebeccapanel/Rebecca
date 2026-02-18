import { ALPN_OPTION, UTLS_FINGERPRINT } from "utils/outbound";

export type Protocol =
	| "vmess"
	| "vless"
	| "trojan"
	| "shadowsocks"
	| "http"
	| "socks";
export type StreamNetwork =
	| "tcp"
	| "ws"
	| "grpc"
	| "kcp"
	| "quic"
	| "http"
	| "httpupgrade"
	| "splithttp"
	| "xhttp";
export type StreamSecurity = "none" | "tls" | "reality";

export type RawInbound = {
	tag: string;
	listen?: string;
	port: number | string;
	protocol: string;
	settings: Record<string, any>;
	streamSettings?: Record<string, any>;
	sniffing?: Record<string, any>;
};

type BuildInboundOptions = {
	initial?: RawInbound | null;
};

export type FallbackForm = {
	dest: string;
	path: string;
	type: string;
	alpn: string;
	xver: string;
};

export type TlsCertificateForm = {
	useFile: boolean;
	certFile: string;
	keyFile: string;
	cert: string;
	key: string;
	oneTimeLoading: boolean;
	usage: string;
	buildChain: boolean;
};

export type ProxyAccountForm = {
	user: string;
	pass: string;
};

export type HeaderForm = {
	name: string;
	value: string;
};

export type SockoptFormValues = {
	acceptProxyProtocol: boolean;
	tcpFastOpen: boolean;
	mark: string;
	tproxy: "" | "off" | "redirect" | "tproxy";
	tcpMptcp: boolean;
	penetrate: boolean;
	domainStrategy: string;
	tcpMaxSeg: string;
	dialerProxy: string;
	tcpKeepAliveInterval: string;
	tcpKeepAliveIdle: string;
	tcpUserTimeout: string;
	tcpcongestion: string;
	V6Only: boolean;
	tcpWindowClamp: string;
	interfaceName: string;
};

export type InboundFormValues = {
	tag: string;
	listen: string;
	port: string;
	protocol: Protocol;

	// proxy protocol
	tcpAcceptProxyProtocol: boolean;
	wsAcceptProxyProtocol: boolean;
	httpupgradeAcceptProxyProtocol: boolean;

	// vmess/vless
	disableInsecureEncryption: boolean;
	vlessDecryption: string;
	vlessEncryption: string;
	fallbacks: FallbackForm[];

	// shadowsocks
	shadowsocksNetwork: "tcp" | "udp" | "tcp,udp";
	shadowsocksMethod: string;
	shadowsocksPassword: string;
	shadowsocksIvCheck: boolean;

	// sniffing
	sniffingEnabled: boolean;
	sniffingDestinations: string[];
	sniffingRouteOnly: boolean;
	sniffingMetadataOnly: boolean;

	// stream
	streamNetwork: StreamNetwork;
	streamSecurity: StreamSecurity;

	// TLS
	tlsServerName: string;
	tlsMinVersion: string;
	tlsMaxVersion: string;
	tlsCipherSuites: string;
	tlsRejectUnknownSni: boolean;
	tlsVerifyPeerCertByName: string;
	tlsDisableSystemRoot: boolean;
	tlsEnableSessionResumption: boolean;
	tlsCertificates: TlsCertificateForm[];
	tlsAlpn: string[];
	tlsEchServerKeys: string;
	tlsEchForceQuery: string;
	tlsAllowInsecure: boolean;
	tlsFingerprint: string;
	tlsEchConfigList: string;
	tlsRawSettings: Record<string, any>;

	// REALITY
	realityShow: boolean;
	realityXver: string;
	realityFingerprint: string;
	realityTarget: string;
	realityPrivateKey: string;
	realityServerNames: string; // multi-line / comma-separated
	realityShortIds: string; // multi-line / comma-separated
	realityMaxTimediff: string;
	realityMinClientVer: string;
	realityMaxClientVer: string;
	realitySpiderX: string;
	realityServerName: string;
	realityPublicKey: string;
	realityMldsa65Seed: string;
	realityMldsa65Verify: string;
	realityRawSettings: Record<string, any>;

	// WS
	wsPath: string;
	wsHost: string; // mapped to wsSettings.host
	wsHeaders: HeaderForm[];

	// TCP header
	tcpHeaderType: "none" | "http";
	tcpHttpHosts: string;
	tcpHttpPath: string;

	// gRPC
	grpcServiceName: string;
	grpcAuthority: string;
	grpcMultiMode: boolean;

	// KCP
	kcpHeaderType: string;
	kcpSeed: string;

	// QUIC
	quicSecurity: string;
	quicKey: string;
	quicHeaderType: string;

	// HTTP (h2/h1.1 transport, نه پروتکل HTTP inbound)
	httpPath: string;
	httpHost: string;

	// HTTPUpgrade
	httpupgradePath: string;
	httpupgradeHost: string;
	httpupgradeHeaders: HeaderForm[];

	// SplitHTTP
	splithttpPath: string;
	splithttpHost: string;
	splithttpScMaxConcurrentPosts: string;
	splithttpScMaxEachPostBytes: string;
	splithttpScMinPostsIntervalMs: string;
	splithttpNoSSEHeader: boolean;
	splithttpXPaddingBytes: string;
	splithttpXmuxMaxConcurrency: string;
	splithttpXmuxMaxConnections: string;
	splithttpXmuxCMaxReuseTimes: string;
	splithttpXmuxCMaxLifetimeMs: string;
	splithttpMode: "auto" | "packet-up" | "stream-up";
	splithttpNoGRPCHeader: boolean;
	splithttpHeaders: HeaderForm[];

	// XHTTP
	xhttpHost: string;
	xhttpPath: string;
	xhttpHeaders: HeaderForm[];
	xhttpMode: "" | "auto" | "packet-up" | "stream-up" | "stream-one";
	xhttpScMaxBufferedPosts: string;
	xhttpScMaxEachPostBytes: string;
	xhttpScMinPostsIntervalMs: string;
	xhttpScStreamUpServerSecs: string;
	xhttpPaddingBytes: string;
	xhttpNoSSEHeader: boolean;
	xhttpNoGRPCHeader: boolean;

	// vless extras
	vlessSelectedAuth: string;

	// sockopt
	sockoptEnabled: boolean;
	sockopt: SockoptFormValues;

	// HTTP inbound
	httpAccounts: ProxyAccountForm[];
	httpAllowTransparent: boolean;

	// SOCKS inbound
	socksAuth: "password" | "noauth";
	socksAccounts: ProxyAccountForm[];
	socksUdpEnabled: boolean;
	socksUdpIp: string;
};

export const sniffingOptions = [
	{ value: "http", label: "HTTP" },
	{ value: "tls", label: "TLS" },
	{ value: "quic", label: "QUIC" },
	{ value: "fakedns", label: "FakeDNS" },
] as const;

export const tlsAlpnOptions = Object.values(ALPN_OPTION);
export const tlsFingerprintOptions = Object.values(UTLS_FINGERPRINT);
export const tlsVersionOptions = ["1.0", "1.1", "1.2", "1.3"];
export const tlsCipherOptions = [
	"TLS_AES_128_GCM_SHA256",
	"TLS_AES_256_GCM_SHA384",
	"TLS_CHACHA20_POLY1305_SHA256",
	"TLS_ECDHE_ECDSA_WITH_AES_128_CBC_SHA",
	"TLS_ECDHE_ECDSA_WITH_AES_256_CBC_SHA",
	"TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA",
	"TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA",
	"TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256",
	"TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384",
	"TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256",
	"TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384",
	"TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256",
	"TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256",
];
export const tlsUsageOptions = ["encipherment", "verify", "issue"];
export const tlsEchForceOptions = ["none", "half", "full"];

export const protocolOptions: Protocol[] = [
	"vmess",
	"vless",
	"trojan",
	"shadowsocks",
	"http",
	"socks",
];
export const shadowsocksNetworkOptions: InboundFormValues["shadowsocksNetwork"][] =
	["tcp,udp", "tcp", "udp"];
export const streamNetworks: StreamNetwork[] = [
	"tcp",
	"ws",
	"grpc",
	"kcp",
	"quic",
	"http",
	"httpupgrade",
	"splithttp",
	"xhttp",
];
export const streamSecurityOptions: StreamSecurity[] = [
	"none",
	"tls",
	"reality",
];

const splitLines = (value: string): string[] =>
	value
		.split(/[\n,]/)
		.map((entry) => entry.trim())
		.filter(Boolean);

const joinLines = (values: string[] | undefined): string =>
	values?.length ? values.join("\n") : "";

const joinComma = (values: string[] | undefined): string =>
	values?.length ? values.join(",") : "";

const parseStringList = (value: unknown): string[] => {
	if (Array.isArray(value)) {
		return value.map((entry) => String(entry).trim()).filter(Boolean);
	}
	if (typeof value === "string") {
		return splitLines(value);
	}
	return [];
};

const toInputValue = (value: unknown): string => {
	if (typeof value === "number" && Number.isFinite(value)) {
		return String(value);
	}
	if (typeof value === "string") {
		return value;
	}
	return "";
};

const createDefaultSockopt = (): SockoptFormValues => ({
	acceptProxyProtocol: false,
	tcpFastOpen: false,
	mark: "",
	tproxy: "off",
	tcpMptcp: false,
	penetrate: false,
	domainStrategy: "",
	tcpMaxSeg: "",
	dialerProxy: "",
	tcpKeepAliveInterval: "",
	tcpKeepAliveIdle: "",
	tcpUserTimeout: "",
	tcpcongestion: "",
	V6Only: false,
	tcpWindowClamp: "",
	interfaceName: "",
});

const parsePort = (value: string): number | string => {
	if (!value) return 0;
	const numeric = Number(value);
	if (!Number.isNaN(numeric) && numeric > 0) {
		return numeric;
	}
	return value.trim();
};

const cleanObject = (value: Record<string, any>) => {
	Object.keys(value).forEach((key) => {
		const current = value[key];
		if (
			current === undefined ||
			current === null ||
			(typeof current === "string" && current.trim() === "") ||
			(Array.isArray(current) && current.length === 0)
		) {
			delete value[key];
		}
	});
	return value;
};

const hasInitialField = (
	initial: RawInbound | null | undefined,
	path: Array<string>,
): boolean => {
	if (!initial || !path.length) return false;
	let current: any = initial;
	for (const key of path) {
		if (!current || typeof current !== "object") {
			return false;
		}
		if (!Object.hasOwn(current, key)) {
			return false;
		}
		current = current[key];
	}
	return true;
};

const normalizeComparable = (value: unknown): unknown => {
	if (value === null || typeof value === "undefined") {
		return null;
	}
	if (typeof value === "string") {
		return value.trim();
	}
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "boolean") {
		return value;
	}
	return value;
};

const shouldIncludeValue = (
	value: unknown,
	defaultValue: unknown,
	initial: RawInbound | null | undefined,
	path?: Array<string>,
): boolean => {
	if (path && hasInitialField(initial, path)) {
		return true;
	}
	const normalizedValue = normalizeComparable(value);
	if (normalizedValue === null || normalizedValue === "") {
		return false;
	}
	const normalizedDefault = normalizeComparable(defaultValue);
	if (
		typeof normalizedDefault !== "undefined" &&
		normalizedDefault !== null &&
		normalizedValue === normalizedDefault
	) {
		return false;
	}
	return true;
};

const createDefaultProxyAccount = (): ProxyAccountForm => ({
	user: "",
	pass: "",
});

export const createDefaultTlsCertificate = (): TlsCertificateForm => ({
	useFile: true,
	certFile: "",
	keyFile: "",
	cert: "",
	key: "",
	oneTimeLoading: false,
	usage: "encipherment",
	buildChain: false,
});

const createDefaultHeader = (): HeaderForm => ({
	name: "",
	value: "",
});

const accountToForm = (
	account: Record<string, any> | undefined,
): ProxyAccountForm => ({
	user: account?.user ?? "",
	pass: account?.pass ?? "",
});

const formToAccount = (account: ProxyAccountForm) =>
	cleanObject({
		user: account.user?.trim(),
		pass: account.pass?.trim(),
	});

const parseOptionalNumber = (value: unknown): number | undefined => {
	if (value === "" || value === null || typeof value === "undefined") {
		return undefined;
	}
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
};

const certificateToForm = (
	certificate: Record<string, any>,
): TlsCertificateForm => {
	const hasFile =
		typeof certificate?.certificateFile === "string" ||
		typeof certificate?.keyFile === "string";
	const certContent = Array.isArray(certificate?.certificate)
		? certificate.certificate.join("\n")
		: (certificate?.certificate ?? "");
	const keyContent = Array.isArray(certificate?.key)
		? certificate.key.join("\n")
		: (certificate?.key ?? "");
	return {
		useFile: hasFile || (!certContent && !keyContent),
		certFile: certificate?.certificateFile ?? "",
		keyFile: certificate?.keyFile ?? "",
		cert: certContent ?? "",
		key: keyContent ?? "",
		oneTimeLoading: Boolean(certificate?.oneTimeLoading),
		usage: certificate?.usage ?? "encipherment",
		buildChain: Boolean(certificate?.buildChain),
	};
};

const certificateFromForm = (
	certificate: TlsCertificateForm,
): Record<string, any> => {
	if (certificate.useFile) {
		return cleanObject({
			certificateFile: certificate.certFile?.trim(),
			keyFile: certificate.keyFile?.trim(),
			oneTimeLoading: certificate.oneTimeLoading,
			usage: certificate.usage || undefined,
			buildChain:
				certificate.usage === "issue" ? certificate.buildChain : undefined,
		});
	}
	return cleanObject({
		certificate: certificate.cert ? certificate.cert.split("\n") : [],
		key: certificate.key ? certificate.key.split("\n") : [],
		oneTimeLoading: certificate.oneTimeLoading,
		usage: certificate.usage || undefined,
		buildChain:
			certificate.usage === "issue" ? certificate.buildChain : undefined,
	});
};

const buildSockoptSettings = (values: InboundFormValues) => {
	if (!values.sockoptEnabled) {
		return undefined;
	}
	const sockopt = values.sockopt;
	const payload = {
		acceptProxyProtocol: sockopt.acceptProxyProtocol,
		tcpFastOpen: sockopt.tcpFastOpen,
		mark: parseOptionalNumber(sockopt.mark),
		tproxy: sockopt.tproxy || undefined,
		tcpMptcp: sockopt.tcpMptcp,
		penetrate: sockopt.penetrate,
		domainStrategy: sockopt.domainStrategy || undefined,
		tcpMaxSeg: parseOptionalNumber(sockopt.tcpMaxSeg),
		dialerProxy: sockopt.dialerProxy || undefined,
		tcpKeepAliveInterval: parseOptionalNumber(sockopt.tcpKeepAliveInterval),
		tcpKeepAliveIdle: parseOptionalNumber(sockopt.tcpKeepAliveIdle),
		tcpUserTimeout: parseOptionalNumber(sockopt.tcpUserTimeout),
		tcpcongestion: sockopt.tcpcongestion || undefined,
		V6Only: sockopt.V6Only,
		tcpWindowClamp: parseOptionalNumber(sockopt.tcpWindowClamp),
		interface: sockopt.interfaceName || undefined,
	};
	return cleanObject(payload);
};

export const createDefaultInboundForm = (
	protocol: Protocol = "vless",
): InboundFormValues => ({
	tag: "",
	listen: "",
	port: "",
	protocol,
	tcpAcceptProxyProtocol: false,
	wsAcceptProxyProtocol: false,
	httpupgradeAcceptProxyProtocol: false,
	disableInsecureEncryption: true,
	vlessDecryption: "none",
	vlessEncryption: "",
	fallbacks: [],
	shadowsocksNetwork: "tcp,udp",
	shadowsocksMethod: "chacha20-ietf-poly1305",
	shadowsocksPassword: "",
	shadowsocksIvCheck: false,
	sniffingEnabled: true,
	sniffingDestinations: ["http", "tls"],
	sniffingRouteOnly: false,
	sniffingMetadataOnly: false,
	streamNetwork: "tcp",
	streamSecurity: "none",
	tlsServerName: "",
	tlsMinVersion: "1.2",
	tlsMaxVersion: "1.3",
	tlsCipherSuites: "",
	tlsRejectUnknownSni: false,
	tlsVerifyPeerCertByName: "dns.google",
	tlsDisableSystemRoot: false,
	tlsEnableSessionResumption: false,
	tlsCertificates: [createDefaultTlsCertificate()],
	tlsAlpn: [ALPN_OPTION.H2, ALPN_OPTION.HTTP1],
	tlsEchServerKeys: "",
	tlsEchForceQuery: "none",
	tlsAllowInsecure: false,
	tlsFingerprint: UTLS_FINGERPRINT.UTLS_CHROME,
	tlsEchConfigList: "",
	tlsRawSettings: {},
	realityShow: false,
	realityXver: "0",
	realityFingerprint: UTLS_FINGERPRINT.UTLS_CHROME,
	realityTarget: "",
	realityPrivateKey: "",
	realityServerNames: "",
	realityShortIds: "",
	realityMaxTimediff: "0",
	realityMinClientVer: "",
	realityMaxClientVer: "",
	realitySpiderX: "/",
	realityServerName: "",
	realityPublicKey: "",
	realityMldsa65Seed: "",
	realityMldsa65Verify: "",
	realityRawSettings: {},
	wsPath: "/",
	wsHost: "",
	wsHeaders: [],
	tcpHeaderType: "none",
	tcpHttpHosts: "",
	tcpHttpPath: "/",
	grpcServiceName: "",
	grpcAuthority: "",
	grpcMultiMode: false,
	kcpHeaderType: "none",
	kcpSeed: "",
	quicSecurity: "",
	quicKey: "",
	quicHeaderType: "none",
	httpPath: "/",
	httpHost: "",
	httpupgradePath: "/",
	httpupgradeHost: "",
	httpupgradeHeaders: [createDefaultHeader()],
	splithttpPath: "/",
	splithttpHost: "",
	splithttpScMaxConcurrentPosts: "100-200",
	splithttpScMaxEachPostBytes: "1000000-2000000",
	splithttpScMinPostsIntervalMs: "10-50",
	splithttpNoSSEHeader: false,
	splithttpXPaddingBytes: "100-1000",
	splithttpXmuxMaxConcurrency: "16-32",
	splithttpXmuxMaxConnections: "0",
	splithttpXmuxCMaxReuseTimes: "64-128",
	splithttpXmuxCMaxLifetimeMs: "0",
	splithttpMode: "auto",
	splithttpNoGRPCHeader: false,
	splithttpHeaders: [createDefaultHeader()],
	xhttpHost: "",
	xhttpPath: "",
	xhttpHeaders: [],
	xhttpMode: "",
	xhttpScMaxBufferedPosts: "",
	xhttpScMaxEachPostBytes: "",
	xhttpScMinPostsIntervalMs: "",
	xhttpScStreamUpServerSecs: "",
	xhttpPaddingBytes: "",
	xhttpNoSSEHeader: false,
	xhttpNoGRPCHeader: false,
	vlessSelectedAuth: "",
	sockoptEnabled: false,
	sockopt: createDefaultSockopt(),
	httpAccounts: [createDefaultProxyAccount()],
	httpAllowTransparent: false,
	socksAuth: "noauth",
	socksAccounts: [createDefaultProxyAccount()],
	socksUdpEnabled: false,
	socksUdpIp: "",
});

const fallbackToForm = (fallback: Record<string, any>): FallbackForm => ({
	dest: fallback?.dest?.toString() ?? "",
	path: fallback?.path ?? "",
	type: fallback?.type ?? "",
	alpn: Array.isArray(fallback?.alpn)
		? fallback.alpn.join(",")
		: (fallback?.alpn ?? ""),
	xver: fallback?.xver?.toString() ?? "",
});

const formToFallback = (fallback: FallbackForm) => {
	const payload: Record<string, any> = {
		dest: fallback.dest?.trim(),
		path: fallback.path?.trim(),
		type: fallback.type?.trim(),
		xver: fallback.xver ? Number(fallback.xver) : undefined,
	};
	if (fallback.alpn) {
		payload.alpn = fallback.alpn
			.split(",")
			.map((item) => item.trim())
			.filter(Boolean);
	}
	return cleanObject(payload);
};

export const rawInboundToFormValues = (raw: RawInbound): InboundFormValues => {
	const protocol = protocolOptions.includes(raw.protocol as Protocol)
		? (raw.protocol as Protocol)
		: "vless";
	const base = createDefaultInboundForm(protocol);
	const settings = raw.settings ?? {};
	const sniffing = raw.sniffing ?? {};
	const stream = raw.streamSettings ?? {};
	const tlsSettings = stream.tlsSettings ?? {};
	const tlsSettingsMeta =
		tlsSettings && typeof tlsSettings.settings === "object"
			? tlsSettings.settings
			: {};
	const rawTlsSettings =
		stream.tlsSettings !== undefined && stream.tlsSettings !== null
			? JSON.parse(JSON.stringify(stream.tlsSettings))
			: {};
	const realitySettings = stream.realitySettings ?? {};
	const realitySettingsMeta =
		realitySettings && typeof realitySettings.settings === "object"
			? realitySettings.settings
			: {};
	const rawRealitySettings =
		stream.realitySettings !== undefined && stream.realitySettings !== null
			? JSON.parse(JSON.stringify(stream.realitySettings))
			: {};
	const tlsCertificates = Array.isArray(tlsSettings.certificates)
		? tlsSettings.certificates.map((cert: Record<string, any>) =>
				certificateToForm(cert),
			)
		: base.tlsCertificates;
	const tlsAlpn = parseStringList(tlsSettings.alpn);
	const realityServerNames = parseStringList(realitySettings.serverNames);
	const realityShortIds = parseStringList(realitySettings.shortIds);

	return {
		...base,
		tag: raw.tag ?? "",
		listen: raw.listen ?? "",
		port: raw.port?.toString() ?? "",
		disableInsecureEncryption: Boolean(
			settings.disableInsecureEncryption ?? base.disableInsecureEncryption,
		),
		vlessDecryption: settings.decryption ?? base.vlessDecryption,
		vlessEncryption: settings.encryption ?? base.vlessEncryption,
		fallbacks: Array.isArray(settings.fallbacks)
			? settings.fallbacks.map((item: Record<string, any>) =>
					fallbackToForm(item),
				)
			: base.fallbacks,
		shadowsocksNetwork:
			settings.network && ["tcp", "udp", "tcp,udp"].includes(settings.network)
				? (settings.network as InboundFormValues["shadowsocksNetwork"])
				: base.shadowsocksNetwork,
		shadowsocksMethod: settings.method ?? base.shadowsocksMethod,
		shadowsocksPassword: settings.password ?? base.shadowsocksPassword,
		shadowsocksIvCheck: Boolean(settings.ivCheck ?? base.shadowsocksIvCheck),
		sniffingEnabled: Boolean(sniffing.enabled ?? base.sniffingEnabled),
		sniffingDestinations:
			Array.isArray(sniffing.destOverride) && sniffing.destOverride.length
				? sniffing.destOverride
				: base.sniffingDestinations,
		sniffingRouteOnly: Boolean(sniffing.routeOnly ?? base.sniffingRouteOnly),
		sniffingMetadataOnly: Boolean(
			sniffing.metadataOnly ?? base.sniffingMetadataOnly,
		),
		streamNetwork: stream.network ?? base.streamNetwork,
		streamSecurity: stream.security ?? base.streamSecurity,
		tcpAcceptProxyProtocol: Boolean(
			stream?.tcpSettings?.acceptProxyProtocol ?? base.tcpAcceptProxyProtocol,
		),
		wsAcceptProxyProtocol: Boolean(
			stream?.wsSettings?.acceptProxyProtocol ?? base.wsAcceptProxyProtocol,
		),
		tlsServerName:
			tlsSettings.serverName ?? tlsSettings.sni ?? base.tlsServerName,
		tlsMinVersion: tlsSettings.minVersion ?? base.tlsMinVersion,
		tlsMaxVersion: tlsSettings.maxVersion ?? base.tlsMaxVersion,
		tlsCipherSuites: tlsSettings.cipherSuites ?? base.tlsCipherSuites,
		tlsRejectUnknownSni: Boolean(
			tlsSettings.rejectUnknownSni ?? base.tlsRejectUnknownSni,
		),
		tlsVerifyPeerCertByName: (() => {
			// Try new format first
			const newValue = tlsSettings.verifyPeerCertByName;
			if (newValue) {
				return newValue;
			}
			// Fall back to old format (array)
			const oldValue = tlsSettings.verifyPeerCertInNames;
			if (Array.isArray(oldValue) && oldValue.length > 0) {
				const firstDomain = String(oldValue[0]).trim();
				return firstDomain || base.tlsVerifyPeerCertByName;
			}
			return base.tlsVerifyPeerCertByName;
		})(),
		tlsDisableSystemRoot: Boolean(
			tlsSettings.disableSystemRoot ?? base.tlsDisableSystemRoot,
		),
		tlsEnableSessionResumption: Boolean(
			tlsSettings.enableSessionResumption ?? base.tlsEnableSessionResumption,
		),
		tlsCertificates: tlsCertificates,
		tlsAlpn: tlsAlpn.length ? tlsAlpn : base.tlsAlpn,
		tlsEchServerKeys: tlsSettings.echServerKeys ?? base.tlsEchServerKeys,
		tlsEchForceQuery: tlsSettings.echForceQuery ?? base.tlsEchForceQuery,
		tlsAllowInsecure: Boolean(
			tlsSettingsMeta.allowInsecure ??
				tlsSettings.allowInsecure ??
				base.tlsAllowInsecure,
		),
		tlsFingerprint:
			tlsSettingsMeta.fingerprint ??
			tlsSettings.fingerprint ??
			base.tlsFingerprint,
		tlsEchConfigList:
			tlsSettingsMeta.echConfigList ??
			tlsSettings.echConfigList ??
			base.tlsEchConfigList,
		tlsRawSettings: rawTlsSettings,
		realityShow: Boolean(realitySettings.show ?? base.realityShow),
		realityXver: toInputValue(realitySettings.xver ?? base.realityXver),
		realityFingerprint:
			realitySettingsMeta.fingerprint ?? base.realityFingerprint,
		realityTarget:
			realitySettings.target ?? realitySettings.dest ?? base.realityTarget,
		realityPrivateKey: realitySettings.privateKey ?? base.realityPrivateKey,
		realityServerNames: realityServerNames.length
			? joinComma(realityServerNames)
			: base.realityServerNames,
		realityShortIds: realityShortIds.length
			? joinComma(realityShortIds)
			: base.realityShortIds,
		realityMaxTimediff: toInputValue(
			realitySettings.maxTimediff ??
				realitySettings.maxTimeDiff ??
				base.realityMaxTimediff,
		),
		realityMinClientVer:
			realitySettings.minClientVer ?? base.realityMinClientVer,
		realityMaxClientVer:
			realitySettings.maxClientVer ?? base.realityMaxClientVer,
		realitySpiderX:
			realitySettingsMeta.spiderX ??
			realitySettings.spiderX ??
			base.realitySpiderX,
		realityServerName: realitySettingsMeta.serverName ?? base.realityServerName,
		realityPublicKey:
			realitySettingsMeta.publicKey ??
			realitySettings.publicKey ??
			base.realityPublicKey,
		realityMldsa65Seed: realitySettings.mldsa65Seed ?? base.realityMldsa65Seed,
		realityMldsa65Verify:
			realitySettingsMeta.mldsa65Verify ??
			realitySettings.mldsa65Verify ??
			base.realityMldsa65Verify,
		realityRawSettings: rawRealitySettings,
		wsPath: stream?.wsSettings?.path ?? base.wsPath,
		wsHost:
			(() => {
				const hostValue = stream?.wsSettings?.host;
				if (typeof hostValue === "string" && hostValue.trim().length) {
					return hostValue;
				}
				if (Array.isArray(hostValue) && hostValue.length) {
					return hostValue.join(",");
				}
				return getHeaderValue(stream?.wsSettings?.headers, "Host");
			})() ?? base.wsHost,
		wsHeaders: stream?.wsSettings?.headers
			? headersToForm(omitHeader(stream.wsSettings.headers, "Host"))
			: base.wsHeaders,
		tcpHeaderType: stream?.tcpSettings?.header?.type ?? base.tcpHeaderType,
		tcpHttpHosts: joinLines(
			stream?.tcpSettings?.header?.request?.headers?.Host,
		),
		tcpHttpPath: Array.isArray(stream?.tcpSettings?.header?.request?.path)
			? stream.tcpSettings.header.request.path[0]
			: base.tcpHttpPath,
		grpcServiceName: stream?.grpcSettings?.serviceName ?? base.grpcServiceName,
		grpcAuthority: stream?.grpcSettings?.authority ?? base.grpcAuthority,
		grpcMultiMode: Boolean(
			stream?.grpcSettings?.multiMode ?? base.grpcMultiMode,
		),
		kcpHeaderType: stream?.kcpSettings?.header?.type ?? base.kcpHeaderType,
		kcpSeed: stream?.kcpSettings?.seed ?? base.kcpSeed,
		quicSecurity: stream?.quicSettings?.security ?? base.quicSecurity,
		quicKey: stream?.quicSettings?.key ?? base.quicKey,
		quicHeaderType: stream?.quicSettings?.header?.type ?? base.quicHeaderType,
		httpPath: stream?.httpSettings?.path ?? base.httpPath,
		httpHost: joinLines(stream?.httpSettings?.host),
		httpupgradePath: stream?.httpupgradeSettings?.path ?? base.httpupgradePath,
		httpupgradeHost: stream?.httpupgradeSettings?.host ?? base.httpupgradeHost,
		httpupgradeHeaders: stream?.httpupgradeSettings?.headers
			? headersToForm(stream.httpupgradeSettings.headers)
			: base.httpupgradeHeaders,
		splithttpPath: stream?.splithttpSettings?.path ?? base.splithttpPath,
		splithttpHost: stream?.splithttpSettings?.host ?? base.splithttpHost,
		splithttpScMaxConcurrentPosts:
			stream?.splithttpSettings?.scMaxConcurrentPosts?.toString() ??
			base.splithttpScMaxConcurrentPosts,
		splithttpScMaxEachPostBytes:
			stream?.splithttpSettings?.scMaxEachPostBytes?.toString() ??
			base.splithttpScMaxEachPostBytes,
		splithttpScMinPostsIntervalMs:
			stream?.splithttpSettings?.scMinPostsIntervalMs?.toString() ??
			base.splithttpScMinPostsIntervalMs,
		splithttpNoSSEHeader: Boolean(
			stream?.splithttpSettings?.noSSEHeader ?? base.splithttpNoSSEHeader,
		),
		splithttpXPaddingBytes:
			stream?.splithttpSettings?.xPaddingBytes?.toString() ??
			base.splithttpXPaddingBytes,
		splithttpXmuxMaxConcurrency:
			stream?.splithttpSettings?.xmux?.maxConcurrency?.toString() ??
			base.splithttpXmuxMaxConcurrency,
		splithttpXmuxMaxConnections:
			stream?.splithttpSettings?.xmux?.maxConnections?.toString() ??
			base.splithttpXmuxMaxConnections,
		splithttpXmuxCMaxReuseTimes:
			stream?.splithttpSettings?.xmux?.cMaxReuseTimes?.toString() ??
			base.splithttpXmuxCMaxReuseTimes,
		splithttpXmuxCMaxLifetimeMs:
			stream?.splithttpSettings?.xmux?.cMaxLifetimeMs?.toString() ??
			base.splithttpXmuxCMaxLifetimeMs,
		splithttpMode: stream?.splithttpSettings?.mode ?? base.splithttpMode,
		splithttpNoGRPCHeader: Boolean(
			stream?.splithttpSettings?.noGRPCHeader ?? base.splithttpNoGRPCHeader,
		),
		splithttpHeaders: stream?.splithttpSettings?.headers
			? headersToForm(stream.splithttpSettings.headers)
			: base.splithttpHeaders,
		xhttpHost: stream?.xhttpSettings?.host ?? base.xhttpHost,
		xhttpPath: stream?.xhttpSettings?.path ?? base.xhttpPath,
		xhttpHeaders: stream?.xhttpSettings?.headers
			? headersToForm(stream.xhttpSettings.headers)
			: base.xhttpHeaders,
		xhttpMode: stream?.xhttpSettings?.mode ?? base.xhttpMode,
		xhttpScMaxBufferedPosts:
			stream?.xhttpSettings?.scMaxBufferedPosts?.toString() ??
			base.xhttpScMaxBufferedPosts,
		xhttpScMaxEachPostBytes:
			stream?.xhttpSettings?.scMaxEachPostBytes?.toString() ??
			base.xhttpScMaxEachPostBytes,
		xhttpScMinPostsIntervalMs:
			stream?.xhttpSettings?.scMinPostsIntervalMs?.toString() ??
			base.xhttpScMinPostsIntervalMs,
		xhttpScStreamUpServerSecs:
			stream?.xhttpSettings?.scStreamUpServerSecs?.toString() ??
			base.xhttpScStreamUpServerSecs,
		xhttpPaddingBytes:
			stream?.xhttpSettings?.xPaddingBytes ?? base.xhttpPaddingBytes,
		xhttpNoSSEHeader: Boolean(
			stream?.xhttpSettings?.noSSEHeader ?? base.xhttpNoSSEHeader,
		),
		xhttpNoGRPCHeader: Boolean(
			stream?.xhttpSettings?.noGRPCHeader ?? base.xhttpNoGRPCHeader,
		),
		vlessSelectedAuth: settings.selectedAuth ?? base.vlessSelectedAuth,
		sockoptEnabled: Boolean(stream?.sockopt),
		sockopt: (() => {
			const defaults = createDefaultSockopt();
			const sockopt = stream?.sockopt ?? {};
			defaults.acceptProxyProtocol = Boolean(sockopt.acceptProxyProtocol);
			defaults.tcpFastOpen = Boolean(sockopt.tcpFastOpen);
			defaults.mark = toInputValue(sockopt.mark);
			defaults.tproxy =
				(sockopt.tproxy as SockoptFormValues["tproxy"]) ?? defaults.tproxy;
			defaults.tcpMptcp = Boolean(sockopt.tcpMptcp);
			defaults.penetrate = Boolean(sockopt.penetrate);
			defaults.domainStrategy =
				sockopt.domainStrategy ?? defaults.domainStrategy;
			defaults.tcpMaxSeg = toInputValue(sockopt.tcpMaxSeg);
			defaults.dialerProxy = sockopt.dialerProxy ?? defaults.dialerProxy;
			defaults.tcpKeepAliveInterval = toInputValue(
				sockopt.tcpKeepAliveInterval,
			);
			defaults.tcpKeepAliveIdle = toInputValue(sockopt.tcpKeepAliveIdle);
			defaults.tcpUserTimeout = toInputValue(sockopt.tcpUserTimeout);
			defaults.tcpcongestion = sockopt.tcpcongestion ?? defaults.tcpcongestion;
			defaults.V6Only = Boolean(sockopt.V6Only);
			defaults.tcpWindowClamp = toInputValue(sockopt.tcpWindowClamp);
			defaults.interfaceName = sockopt.interface ?? defaults.interfaceName;
			return defaults;
		})(),
		httpAccounts:
			protocol === "http" && Array.isArray(settings.accounts)
				? settings.accounts.map((item: Record<string, any>) =>
						accountToForm(item),
					)
				: base.httpAccounts,
		httpAllowTransparent:
			protocol === "http" && typeof settings.allowTransparent === "boolean"
				? settings.allowTransparent
				: base.httpAllowTransparent,
		socksAuth:
			protocol === "socks" && settings.auth === "password"
				? "password"
				: base.socksAuth,
		socksAccounts:
			protocol === "socks" && Array.isArray(settings.accounts)
				? settings.accounts.map((item: Record<string, any>) =>
						accountToForm(item),
					)
				: base.socksAccounts,
		socksUdpEnabled:
			protocol === "socks" && typeof settings.udp === "boolean"
				? settings.udp
				: base.socksUdpEnabled,
		socksUdpIp:
			protocol === "socks" && settings.ip !== undefined && settings.ip !== null
				? String(settings.ip)
				: base.socksUdpIp,
	};
};

const normalizeHeaderMap = (
	headers: HeaderForm[],
): Record<string, string | string[]> | undefined => {
	const record: Record<string, string | string[]> = {};
	headers.forEach(({ name, value }) => {
		const trimmedName = name?.trim();
		const trimmedValue = value?.trim();
		if (!trimmedName || !trimmedValue) {
			return;
		}
		const parts = trimmedValue
			.split(",")
			.map((entry) => entry.trim())
			.filter(Boolean);
		record[trimmedName] = parts.length > 1 ? parts : trimmedValue;
	});
	return Object.keys(record).length ? record : undefined;
};

const headersToForm = (
	headers: Record<string, string | string[]> | undefined,
): HeaderForm[] => {
	if (!headers) {
		return [];
	}
	const result: HeaderForm[] = [];
	Object.entries(headers).forEach(([name, value]) => {
		if (Array.isArray(value)) {
			value.forEach((item) => {
				result.push({ name, value: item?.toString() ?? "" });
			});
		} else {
			result.push({ name, value: value?.toString() ?? "" });
		}
	});
	return result.length ? result : [];
};

const headersFromForm = (
	headers: HeaderForm[],
): Record<string, string | string[]> | undefined => normalizeHeaderMap(headers);

const headersFromFormSingleValue = (
	headers: HeaderForm[],
): Record<string, string> | undefined => {
	const record: Record<string, string> = {};
	headers.forEach(({ name, value }) => {
		const trimmedName = name?.trim();
		const trimmedValue = value?.trim();
		if (!trimmedName || !trimmedValue) {
			return;
		}
		record[trimmedName] = trimmedValue;
	});
	return Object.keys(record).length ? record : undefined;
};

const getHeaderValue = (
	headers: Record<string, string | string[]> | undefined,
	headerName: string,
): string | undefined => {
	if (!headers) return undefined;
	const target = headerName.toLowerCase();
	for (const [name, value] of Object.entries(headers)) {
		if (name.toLowerCase() !== target) continue;
		return Array.isArray(value) ? value.join(",") : String(value);
	}
	return undefined;
};

const omitHeader = (
	headers: Record<string, string | string[]> | undefined,
	headerName: string,
): Record<string, string | string[]> | undefined => {
	if (!headers) return undefined;
	const target = headerName.toLowerCase();
	const next: Record<string, string | string[]> = {};
	for (const [name, value] of Object.entries(headers)) {
		if (name.toLowerCase() === target) continue;
		next[name] = value;
	}
	return Object.keys(next).length ? next : undefined;
};

const buildStreamSettings = (
	values: InboundFormValues,
	options?: BuildInboundOptions,
): Record<string, any> => {
	const defaults = createDefaultInboundForm(values.protocol);
	const initial = options?.initial ?? null;
	const stream: Record<string, any> = {
		network: values.streamNetwork,
	};
	if (
		shouldIncludeValue(
			values.streamSecurity,
			defaults.streamSecurity,
			initial,
			["streamSettings", "security"],
		)
	) {
		stream.security = values.streamSecurity;
	}

	if (values.streamNetwork === "ws") {
		const headers = omitHeader(
			headersFromFormSingleValue(values.wsHeaders),
			"Host",
		);
		const wsHost = values.wsHost.trim();

		stream.wsSettings = cleanObject({
			acceptProxyProtocol: values.wsAcceptProxyProtocol || undefined,
			path: values.wsPath || undefined,
			host: wsHost || undefined,
			headers,
		});
	}

	if (values.streamNetwork === "tcp") {
		const tcpSettings: Record<string, any> = {
			acceptProxyProtocol: values.tcpAcceptProxyProtocol || undefined,
		};
		if (values.tcpHeaderType === "http") {
			tcpSettings.header = cleanObject({
				type: "http",
				request: {
					version: "1.1",
					method: "GET",
					path: splitLines(values.tcpHttpPath),
					headers: cleanObject({
						Host: splitLines(values.tcpHttpHosts),
					}),
				},
				response: {
					version: "1.1",
					status: "200",
					reason: "OK",
					headers: {},
				},
			});
		} else {
			tcpSettings.header = { type: "none" };
		}
		stream.tcpSettings = cleanObject(tcpSettings);
	}

	if (values.streamNetwork === "grpc") {
		stream.grpcSettings = cleanObject({
			serviceName: values.grpcServiceName,
			authority: values.grpcAuthority,
			multiMode: values.grpcMultiMode,
		});
	}

	if (values.streamNetwork === "kcp") {
		stream.kcpSettings = cleanObject({
			header: { type: values.kcpHeaderType },
			seed: values.kcpSeed,
		});
	}

	if (values.streamNetwork === "quic") {
		stream.quicSettings = cleanObject({
			security: values.quicSecurity,
			key: values.quicKey,
			header: { type: values.quicHeaderType },
		});
	}

	if (values.streamNetwork === "http") {
		stream.httpSettings = cleanObject({
			path: values.httpPath || undefined,
			host: splitLines(values.httpHost),
		});
	}

	if (values.streamNetwork === "httpupgrade") {
		stream.httpupgradeSettings = cleanObject({
			acceptProxyProtocol: values.httpupgradeAcceptProxyProtocol || undefined,
			path: values.httpupgradePath,
			host: values.httpupgradeHost,
			headers: headersFromForm(values.httpupgradeHeaders),
		});
	}

	if (values.streamNetwork === "splithttp") {
		const headers = headersFromForm(values.splithttpHeaders);
		const splithttpSettings = cleanObject({
			path: shouldIncludeValue(
				values.splithttpPath,
				defaults.splithttpPath,
				initial,
				["streamSettings", "splithttpSettings", "path"],
			)
				? values.splithttpPath
				: undefined,
			host: shouldIncludeValue(
				values.splithttpHost,
				defaults.splithttpHost,
				initial,
				["streamSettings", "splithttpSettings", "host"],
			)
				? values.splithttpHost
				: undefined,
			headers: headers || undefined,
			scMaxConcurrentPosts: shouldIncludeValue(
				values.splithttpScMaxConcurrentPosts,
				defaults.splithttpScMaxConcurrentPosts,
				initial,
				["streamSettings", "splithttpSettings", "scMaxConcurrentPosts"],
			)
				? values.splithttpScMaxConcurrentPosts?.trim() || undefined
				: undefined,
			scMaxEachPostBytes: shouldIncludeValue(
				values.splithttpScMaxEachPostBytes,
				defaults.splithttpScMaxEachPostBytes,
				initial,
				["streamSettings", "splithttpSettings", "scMaxEachPostBytes"],
			)
				? values.splithttpScMaxEachPostBytes?.trim() || undefined
				: undefined,
			scMinPostsIntervalMs: shouldIncludeValue(
				values.splithttpScMinPostsIntervalMs,
				defaults.splithttpScMinPostsIntervalMs,
				initial,
				["streamSettings", "splithttpSettings", "scMinPostsIntervalMs"],
			)
				? values.splithttpScMinPostsIntervalMs?.trim() || undefined
				: undefined,
			noSSEHeader: shouldIncludeValue(
				values.splithttpNoSSEHeader,
				defaults.splithttpNoSSEHeader,
				initial,
				["streamSettings", "splithttpSettings", "noSSEHeader"],
			)
				? values.splithttpNoSSEHeader || undefined
				: undefined,
			xPaddingBytes: shouldIncludeValue(
				values.splithttpXPaddingBytes,
				defaults.splithttpXPaddingBytes,
				initial,
				["streamSettings", "splithttpSettings", "xPaddingBytes"],
			)
				? values.splithttpXPaddingBytes?.trim() || undefined
				: undefined,
			xmux: cleanObject({
				maxConcurrency: shouldIncludeValue(
					values.splithttpXmuxMaxConcurrency,
					defaults.splithttpXmuxMaxConcurrency,
					initial,
					["streamSettings", "splithttpSettings", "xmux", "maxConcurrency"],
				)
					? values.splithttpXmuxMaxConcurrency?.trim() || undefined
					: undefined,
				maxConnections: shouldIncludeValue(
					values.splithttpXmuxMaxConnections,
					defaults.splithttpXmuxMaxConnections,
					initial,
					["streamSettings", "splithttpSettings", "xmux", "maxConnections"],
				)
					? parseOptionalNumber(values.splithttpXmuxMaxConnections)
					: undefined,
				cMaxReuseTimes: shouldIncludeValue(
					values.splithttpXmuxCMaxReuseTimes,
					defaults.splithttpXmuxCMaxReuseTimes,
					initial,
					["streamSettings", "splithttpSettings", "xmux", "cMaxReuseTimes"],
				)
					? values.splithttpXmuxCMaxReuseTimes?.trim() || undefined
					: undefined,
				cMaxLifetimeMs: shouldIncludeValue(
					values.splithttpXmuxCMaxLifetimeMs,
					defaults.splithttpXmuxCMaxLifetimeMs,
					initial,
					["streamSettings", "splithttpSettings", "xmux", "cMaxLifetimeMs"],
				)
					? parseOptionalNumber(values.splithttpXmuxCMaxLifetimeMs)
					: undefined,
			}),
			mode: shouldIncludeValue(
				values.splithttpMode,
				defaults.splithttpMode,
				initial,
				["streamSettings", "splithttpSettings", "mode"],
			)
				? values.splithttpMode
				: undefined,
			noGRPCHeader: shouldIncludeValue(
				values.splithttpNoGRPCHeader,
				defaults.splithttpNoGRPCHeader,
				initial,
				["streamSettings", "splithttpSettings", "noGRPCHeader"],
			)
				? values.splithttpNoGRPCHeader || undefined
				: undefined,
		});
		if (Object.keys(splithttpSettings).length) {
			stream.splithttpSettings = splithttpSettings;
		}
	}

	if (values.streamNetwork === "xhttp") {
		const mode = values.xhttpMode;
		const headers = headersFromForm(values.xhttpHeaders);
		const xhttpSettings = cleanObject({
			path: shouldIncludeValue(values.xhttpPath, defaults.xhttpPath, initial, [
				"streamSettings",
				"xhttpSettings",
				"path",
			])
				? values.xhttpPath
				: undefined,
			host: shouldIncludeValue(values.xhttpHost, defaults.xhttpHost, initial, [
				"streamSettings",
				"xhttpSettings",
				"host",
			])
				? values.xhttpHost
				: undefined,
			headers: headers || undefined,
			scMaxBufferedPosts:
				mode === "packet-up" &&
				shouldIncludeValue(
					values.xhttpScMaxBufferedPosts,
					defaults.xhttpScMaxBufferedPosts,
					initial,
					["streamSettings", "xhttpSettings", "scMaxBufferedPosts"],
				)
					? parseOptionalNumber(values.xhttpScMaxBufferedPosts)
					: undefined,
			scMaxEachPostBytes:
				mode === "packet-up" &&
				shouldIncludeValue(
					values.xhttpScMaxEachPostBytes,
					defaults.xhttpScMaxEachPostBytes,
					initial,
					["streamSettings", "xhttpSettings", "scMaxEachPostBytes"],
				)
					? values.xhttpScMaxEachPostBytes?.trim() || undefined
					: undefined,
			scMinPostsIntervalMs:
				mode === "packet-up" &&
				shouldIncludeValue(
					values.xhttpScMinPostsIntervalMs,
					defaults.xhttpScMinPostsIntervalMs,
					initial,
					["streamSettings", "xhttpSettings", "scMinPostsIntervalMs"],
				)
					? values.xhttpScMinPostsIntervalMs?.trim() || undefined
					: undefined,
			scStreamUpServerSecs: shouldIncludeValue(
				values.xhttpScStreamUpServerSecs,
				defaults.xhttpScStreamUpServerSecs,
				initial,
				["streamSettings", "xhttpSettings", "scStreamUpServerSecs"],
			)
				? values.xhttpScStreamUpServerSecs?.trim() || undefined
				: undefined,
			xPaddingBytes: shouldIncludeValue(
				values.xhttpPaddingBytes,
				defaults.xhttpPaddingBytes,
				initial,
				["streamSettings", "xhttpSettings", "xPaddingBytes"],
			)
				? values.xhttpPaddingBytes?.trim() || undefined
				: undefined,
			noSSEHeader: shouldIncludeValue(
				values.xhttpNoSSEHeader,
				defaults.xhttpNoSSEHeader,
				initial,
				["streamSettings", "xhttpSettings", "noSSEHeader"],
			)
				? values.xhttpNoSSEHeader || undefined
				: undefined,
			noGRPCHeader:
				["stream-up", "stream-one"].includes(mode) &&
				shouldIncludeValue(
					values.xhttpNoGRPCHeader,
					defaults.xhttpNoGRPCHeader,
					initial,
					["streamSettings", "xhttpSettings", "noGRPCHeader"],
				)
					? values.xhttpNoGRPCHeader || undefined
					: undefined,
			mode: shouldIncludeValue(mode, defaults.xhttpMode, initial, [
				"streamSettings",
				"xhttpSettings",
				"mode",
			])
				? mode
				: undefined,
		});
		if (Object.keys(xhttpSettings).length) {
			stream.xhttpSettings = xhttpSettings;
		}
	}

	if (values.streamSecurity === "tls") {
		const tlsPayload =
			values.tlsRawSettings && typeof values.tlsRawSettings === "object"
				? { ...values.tlsRawSettings }
				: {};
		tlsPayload.serverName = values.tlsServerName || undefined;
		tlsPayload.minVersion = values.tlsMinVersion || undefined;
		tlsPayload.maxVersion = values.tlsMaxVersion || undefined;
		tlsPayload.cipherSuites = values.tlsCipherSuites || undefined;
		tlsPayload.rejectUnknownSni = values.tlsRejectUnknownSni;
		tlsPayload.verifyPeerCertByName =
			values.tlsVerifyPeerCertByName || undefined;
		delete tlsPayload.verifyPeerCertInNames; // Remove old format
		tlsPayload.disableSystemRoot = values.tlsDisableSystemRoot;
		tlsPayload.enableSessionResumption = values.tlsEnableSessionResumption;
		tlsPayload.certificates = values.tlsCertificates.map((certificate) =>
			certificateFromForm(certificate),
		);
		tlsPayload.alpn = values.tlsAlpn?.length ? values.tlsAlpn : undefined;
		tlsPayload.echServerKeys = values.tlsEchServerKeys || undefined;
		tlsPayload.echForceQuery = values.tlsEchForceQuery || undefined;
		const settingsPayload =
			tlsPayload.settings && typeof tlsPayload.settings === "object"
				? { ...tlsPayload.settings }
				: {};
		settingsPayload.allowInsecure = values.tlsAllowInsecure;
		settingsPayload.fingerprint = values.tlsFingerprint || undefined;
		settingsPayload.echConfigList = values.tlsEchConfigList || undefined;
		tlsPayload.settings = cleanObject(settingsPayload);
		stream.tlsSettings = cleanObject(tlsPayload);
	}

	if (values.streamSecurity === "reality") {
		const realityPayload =
			values.realityRawSettings && typeof values.realityRawSettings === "object"
				? { ...values.realityRawSettings }
				: {};
		const serverNames = splitLines(values.realityServerNames);
		const shortIds = splitLines(values.realityShortIds);
		const target = values.realityTarget?.trim();
		realityPayload.show = values.realityShow;
		realityPayload.xver = parseOptionalNumber(values.realityXver);
		realityPayload.target = target || undefined;
		realityPayload.dest = target || undefined;
		realityPayload.serverNames = serverNames.length ? serverNames : undefined;
		realityPayload.privateKey = values.realityPrivateKey?.trim() || undefined;
		realityPayload.minClientVer =
			values.realityMinClientVer?.trim() || undefined;
		realityPayload.maxClientVer =
			values.realityMaxClientVer?.trim() || undefined;
		realityPayload.maxTimediff = parseOptionalNumber(values.realityMaxTimediff);
		realityPayload.shortIds = shortIds.length ? shortIds : undefined;
		realityPayload.mldsa65Seed = values.realityMldsa65Seed?.trim() || undefined;
		const realitySettings =
			realityPayload.settings && typeof realityPayload.settings === "object"
				? { ...realityPayload.settings }
				: {};
		realitySettings.publicKey = values.realityPublicKey?.trim() || undefined;
		realitySettings.fingerprint = values.realityFingerprint || undefined;
		realitySettings.serverName = values.realityServerName?.trim() || undefined;
		realitySettings.spiderX = values.realitySpiderX?.trim() || undefined;
		realitySettings.mldsa65Verify =
			values.realityMldsa65Verify?.trim() || undefined;
		realityPayload.settings = cleanObject(realitySettings);
		stream.realitySettings = cleanObject(realityPayload);
	}

	const sockoptPayload = buildSockoptSettings(values);
	if (sockoptPayload) {
		stream.sockopt = sockoptPayload;
	}

	return cleanObject(stream);
};

const buildSettings = (values: InboundFormValues): Record<string, any> => {
	const base: Record<string, any> = {};

	if (["vmess", "vless", "trojan", "shadowsocks"].includes(values.protocol)) {
		base.clients = [];
	}

	switch (values.protocol) {
		case "vmess":
			base.disableInsecureEncryption = values.disableInsecureEncryption;
			break;
		case "vless":
			base.decryption = values.vlessDecryption || "none";
			if (values.vlessEncryption) {
				base.encryption = values.vlessEncryption;
			}
			if (values.vlessSelectedAuth) {
				base.selectedAuth = values.vlessSelectedAuth;
			}
			if (values.fallbacks.length) {
				base.fallbacks = values.fallbacks
					.map(formToFallback)
					.filter((fallback) => Object.keys(fallback).length);
			}
			break;
		case "trojan":
			if (values.fallbacks.length) {
				base.fallbacks = values.fallbacks
					.map(formToFallback)
					.filter((fallback) => Object.keys(fallback).length);
			}
			break;
		case "shadowsocks":
			base.network = values.shadowsocksNetwork || "tcp,udp";
			base.method = values.shadowsocksMethod || undefined;
			base.password = values.shadowsocksPassword || undefined;
			base.ivCheck = values.shadowsocksIvCheck || undefined;
			break;
		case "http": {
			const accounts = values.httpAccounts
				.map(formToAccount)
				.filter((account) => Object.keys(account).length);
			if (accounts.length) {
				base.accounts = accounts;
			}
			if (values.httpAllowTransparent) {
				base.allowTransparent = true;
			}
			break;
		}
		case "socks": {
			base.auth = values.socksAuth;
			if (values.socksAuth === "password") {
				const accounts = values.socksAccounts
					.map(formToAccount)
					.filter((account) => Object.keys(account).length);
				if (accounts.length) {
					base.accounts = accounts;
				}
			}
			base.udp = values.socksUdpEnabled;
			if (values.socksUdpEnabled && values.socksUdpIp.trim()) {
				base.ip = values.socksUdpIp.trim();
			}
			break;
		}
	}

	return base;
};

export const buildInboundPayload = (
	values: InboundFormValues,
	options?: BuildInboundOptions,
): RawInbound => {
	const supportsStream =
		values.protocol !== "http" && values.protocol !== "socks";
	const streamSettings = supportsStream
		? buildStreamSettings(values, options)
		: undefined;
	const payload: RawInbound = {
		tag: values.tag.trim(),
		listen: values.listen.trim() || undefined,
		port: parsePort(values.port),
		protocol: values.protocol,
		settings: buildSettings(values),
	};

	if (streamSettings) {
		payload.streamSettings = streamSettings;
	}

	if (values.sniffingEnabled) {
		const initial = options?.initial ?? null;
		const sniffing = cleanObject({
			enabled: true,
			destOverride: values.sniffingDestinations,
			routeOnly:
				values.sniffingRouteOnly ||
				(hasInitialField(initial, ["sniffing", "routeOnly"])
					? values.sniffingRouteOnly
					: undefined),
			metadataOnly:
				values.sniffingMetadataOnly ||
				(hasInitialField(initial, ["sniffing", "metadataOnly"])
					? values.sniffingMetadataOnly
					: undefined),
		});
		payload.sniffing = sniffing;
	} else {
		payload.sniffing = { enabled: false };
	}

	return payload;
};
