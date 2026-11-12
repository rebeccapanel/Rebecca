import { Button } from "components/ui/button";
import { Textarea } from "components/ui/textarea";
import { toast } from "components/ui/sonner";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { withClass } from "lib/withClass";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "components/ui/dialog";
import { FormField } from "components/ui/form-field";
import { Input as UiInput } from "components/ui/input";
import { NumberField } from "components/ui/number-field";
import { SegmentedControl } from "components/ui/segmented-control";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "components/ui/tabs";
import { ToggleRow } from "./ui/toggle-row";
import { FormSection } from "components/ui/form-section";
import { Send, SquarePen, Minus as MinusIconOutline, Plus } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "lib/cn";
import { PanelInput as Input } from "components/common/PanelInput";
import {
	type FC,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { EmojiShortcodeInput } from "components/common/EmojiShortcodeInput";
import { useTranslation } from "react-i18next";
import {
	ALPN_OPTION,
	Address_Port_Strategy,
	GrpcStreamSettings,
	HttpUpgradeStreamSettings,
	KcpStreamSettings,
	MODE_OPTION,
	Mux,
	Outbound,
	Protocols,
	RealityStreamSettings,
	SSMethods,
	SockoptStreamSettings,
	StreamSettings,
	TcpStreamSettings,
	TlsStreamSettings,
	UTLS_FINGERPRINT,
	WireguardDomainStrategy,
	WsStreamSettings,
	XHTTPStreamSettings,
} from "../utils/outbound";
import { JsonEditor } from "./JsonEditor";
import { SearchableTagSelect } from "./common/SearchableTagSelect";
import { PropagationTargets } from "./xray/PropagationTargets";

const outboundShell =
	"flex max-h-[min(860px,calc(100dvh-4rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl max-md:inset-x-3 max-md:w-auto max-md:top-[4.5rem] max-md:bottom-24 max-md:max-h-none max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0";

const AddIcon = withClass(Plus, "");
const MinusIcon = withClass(MinusIconOutline, "");

type ProtocolValue = (typeof Protocols)[keyof typeof Protocols];
type StreamNetworkValue =
	| "tcp"
	| "kcp"
	| "ws"
	| "grpc"
	| "httpupgrade"
	| "xhttp"
	| "hysteria";
type OutboundSecurityValue = "none" | "tls" | "reality";
type XhttpModeValue = (typeof MODE_OPTION)[keyof typeof MODE_OPTION];

interface WireguardPeerForm {
	publicKey: string;
	allowedIPs: string;
	endpoint: string;
	keepAlive: number;
	presharedKey: string;
}

interface OutboundFormValues {
	tag: string;
	protocol: string;
	sendThrough: string;
	address: string;
	port: number;
	id: string;
	encryption: string;
	flow: string;
	reverseTag: string;
	password: string;
	user: string;
	pass: string;
	method: string;
	ssIvCheck: boolean;
	hysteriaVersion: number;
	hysteriaAuth: string;
	hysteriaUdpIdleTimeout: number;
	tlsEnabled: boolean;
	tlsServerName: string;
	tlsFingerprint: string;
	tlsAlpn: string;
	tlsEchConfigList: string;
	tlsPinnedPeerCertSha256: string;
	tlsVerifyPeerCertByName: string;
	realityEnabled: boolean;
	realityServerName: string;
	realityFingerprint: string;
	realityPublicKey: string;
	realityShortId: string;
	realitySpiderX: string;
	realityMldsa65Verify: string;
	network: StreamNetworkValue;
	tcpType: "none" | "http";
	tcpHost: string;
	tcpPath: string;
	kcpType: string;
	kcpSeed: string;
	wsHost: string;
	wsPath: string;
	grpcServiceName: string;
	grpcAuthority: string;
	grpcMultiMode: boolean;
	httpupgradeHost: string;
	httpupgradePath: string;
	xhttpHost: string;
	xhttpPath: string;
	xhttpMode: XhttpModeValue | "";
	xhttpNoGRPCHeader: boolean;
	xhttpScMinPostsIntervalMs: string;
	xhttpXmuxMaxConcurrency: string;
	xhttpXmuxMaxConnections: number;
	xhttpXmuxCMaxReuseTimes: number;
	xhttpXmuxHMaxRequestTimes: string;
	xhttpXmuxHMaxReusableSecs: string;
	xhttpXmuxHKeepAlivePeriod: number;
	muxEnabled: boolean;
	muxConcurrency: number;
	muxXudpConcurrency: number;
	muxXudpProxyUdp443: "reject" | "allow" | "skip";
	sockoptEnabled: boolean;
	sockoptTcpFastOpen: boolean;
	sockoptTcpMptcp: boolean;
	sockoptPenetrate: boolean;
	sockoptDialerProxy: string;
	sockoptTcpKeepAliveInterval: number;
	sockoptAddressPortStrategy: string;
	vnextEncryption: string;
	dnsNetwork: string;
	dnsAddress: string;
	dnsPort: number;
	freedomStrategy: string;
	blackholeResponse: string;
	blackholeCustomResponseData: string;
	wireguardSecret: string;
	wireguardAddress: string;
	wireguardMtu: number;
	wireguardWorkers: number;
	wireguardDomainStrategy: string;
	wireguardRemoteDNS: string;
	wireguardReserved: string;
	wireguardNoKernelTun: boolean;
	wireguardPeers: WireguardPeerForm[];
}

interface OutboundModalProps {
	open: boolean;
	onClose: () => void;
	mode: "create" | "edit";
	initialOutbound?: Record<string, unknown> | null;
	existingTags: string[];
	sourceTarget: string;
	propagationBase: Record<string, unknown> | null;
	onSubmitOutbound: (
		outboundJson: unknown,
		targetIds: string[],
	) => Promise<void> | void;
}

const defaultValues: OutboundFormValues = {
	tag: "",
	protocol: Protocols.VLESS,
	sendThrough: "",
	address: "",
	port: 443,
	id: "",
	encryption: "none",
	flow: "",
	reverseTag: "",
	password: "",
	user: "",
	pass: "",
	method: SSMethods.AES_128_GCM,
	ssIvCheck: false,
	hysteriaVersion: 2,
	hysteriaAuth: "",
	hysteriaUdpIdleTimeout: 60,
	tlsEnabled: false,
	tlsServerName: "",
	tlsFingerprint: "",
	tlsAlpn: "",
	tlsEchConfigList: "",
	tlsPinnedPeerCertSha256: "",
	tlsVerifyPeerCertByName: "",
	realityEnabled: false,
	realityServerName: "",
	realityFingerprint: "",
	realityPublicKey: "",
	realityShortId: "",
	realitySpiderX: "",
	realityMldsa65Verify: "",
	network: "tcp",
	tcpType: "none",
	tcpHost: "",
	tcpPath: "",
	kcpType: "none",
	kcpSeed: "",
	wsHost: "",
	wsPath: "",
	grpcServiceName: "",
	grpcAuthority: "",
	grpcMultiMode: false,
	httpupgradeHost: "",
	httpupgradePath: "/",
	xhttpHost: "",
	xhttpPath: "/",
	xhttpMode: "",
	xhttpNoGRPCHeader: false,
	xhttpScMinPostsIntervalMs: "30",
	xhttpXmuxMaxConcurrency: "16-32",
	xhttpXmuxMaxConnections: 0,
	xhttpXmuxCMaxReuseTimes: 0,
	xhttpXmuxHMaxRequestTimes: "600-900",
	xhttpXmuxHMaxReusableSecs: "1800-3000",
	xhttpXmuxHKeepAlivePeriod: 0,
	muxEnabled: false,
	muxConcurrency: 8,
	muxXudpConcurrency: 16,
	muxXudpProxyUdp443: "reject",
	sockoptEnabled: false,
	sockoptTcpFastOpen: false,
	sockoptTcpMptcp: false,
	sockoptPenetrate: false,
	sockoptDialerProxy: "",
	sockoptTcpKeepAliveInterval: 0,
	sockoptAddressPortStrategy: Address_Port_Strategy.NONE,
	vnextEncryption: "auto",
	dnsNetwork: "udp",
	dnsAddress: "",
	dnsPort: 53,
	freedomStrategy: "",
	blackholeResponse: "",
	blackholeCustomResponseData: "",
	wireguardSecret: "",
	wireguardAddress: "",
	wireguardMtu: 1420,
	wireguardWorkers: 2,
	wireguardDomainStrategy: "",
	wireguardRemoteDNS: "",
	wireguardReserved: "",
	wireguardNoKernelTun: false,
	wireguardPeers: [
		{
			publicKey: "",
			allowedIPs: "0.0.0.0/0,::/0",
			endpoint: "",
			keepAlive: 0,
			presharedKey: "",
		},
	],
};

const STREAM_NETWORK_OPTIONS_BY_PROTOCOL: Record<
	ProtocolValue,
	StreamNetworkValue[]
> = {
	[Protocols.VMess]: ["tcp", "kcp", "ws", "grpc", "httpupgrade", "xhttp"],
	[Protocols.VLESS]: ["tcp", "kcp", "ws", "grpc", "httpupgrade", "xhttp"],
	[Protocols.Trojan]: ["tcp", "kcp", "ws", "grpc", "httpupgrade", "xhttp"],
	[Protocols.Shadowsocks]: ["tcp", "kcp", "ws", "grpc", "httpupgrade", "xhttp"],
	[Protocols.Hysteria]: ["hysteria"],
	[Protocols.Freedom]: [],
	[Protocols.Blackhole]: [],
	[Protocols.DNS]: [],
	[Protocols.Socks]: [],
	[Protocols.HTTP]: [],
	[Protocols.Wireguard]: [],
};

const KCP_HEADER_TYPE_OPTIONS = [
	"none",
	"srtp",
	"utp",
	"wechat-video",
	"dtls",
	"wireguard",
	"dns",
] as const;

const XHTTP_MODE_OPTIONS = Object.values(MODE_OPTION);
const TLS_FINGERPRINT_OPTIONS = Object.values(UTLS_FINGERPRINT);
const TLS_ALPN_OPTIONS = Object.values(ALPN_OPTION);

const splitComma = (value: string): string[] =>
	value
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);

const buildOutboundJson = (values: OutboundFormValues) => {
	const settings: Record<string, unknown> = {};
	const baseAddress = values.address || undefined;
	const basePort = Number(values.port) || undefined;

	switch (values.protocol) {
		case Protocols.VMess:
			settings.vnext = [
				{
					address: baseAddress,
					port: basePort,
					users: [
						{
							id: values.id || undefined,
							security: values.vnextEncryption || undefined,
						},
					],
				},
			];
			break;
		case Protocols.VLESS:
			if (values.reverseTag) {
				settings.address = baseAddress;
				settings.port = basePort;
				settings.id = values.id || undefined;
				settings.encryption = values.encryption || "none";
				settings.flow = values.flow || undefined;
				settings.reverse = { tag: values.reverseTag };
			} else {
				settings.vnext = [
					{
						address: baseAddress,
						port: basePort,
						users: [
							{
								id: values.id || undefined,
								encryption: values.encryption || undefined,
								flow: values.flow || undefined,
							},
						],
					},
				];
			}
			break;
		case Protocols.Trojan:
			settings.servers = [
				{
					address: baseAddress,
					port: basePort,
					password: values.password || undefined,
				},
			];
			break;
		case Protocols.Shadowsocks:
			settings.servers = [
				{
					address: baseAddress,
					port: basePort,
					password: values.password || undefined,
					method: values.method || undefined,
					ivCheck: values.ssIvCheck || undefined,
				},
			];
			break;
		case Protocols.Hysteria:
			settings.address = baseAddress;
			settings.port = basePort || 443;
			settings.version = Number(values.hysteriaVersion) || 2;
			break;
		case Protocols.Socks:
		case Protocols.HTTP:
			settings.servers = [
				{
					address: baseAddress,
					port: basePort,
					users:
						values.user || values.pass
							? [
									{
										user: values.user || undefined,
										pass: values.pass || undefined,
									},
								]
							: [],
				},
			];
			break;
		case Protocols.Freedom:
			settings.domainStrategy = values.freedomStrategy || undefined;
			break;
		case Protocols.Blackhole:
			settings.response = values.blackholeResponse
				? {
						type: values.blackholeResponse,
						customResponseData:
							values.blackholeResponse.toLowerCase() === "custom"
								? values.blackholeCustomResponseData.trim()
								: undefined,
					}
				: undefined;
			break;
		case Protocols.DNS:
			settings.network = values.dnsNetwork;
			settings.address = values.dnsAddress || undefined;
			settings.port = Number(values.dnsPort) || undefined;
			break;
		case Protocols.Wireguard:
			settings.mtu = Number(values.wireguardMtu) || undefined;
			settings.secretKey = values.wireguardSecret || undefined;
			settings.address = values.wireguardAddress
				? splitComma(values.wireguardAddress)
				: undefined;
			settings.workers = Number(values.wireguardWorkers) || undefined;
			settings.domainStrategy = WireguardDomainStrategy.includes(
				values.wireguardDomainStrategy as never,
			)
				? values.wireguardDomainStrategy
				: undefined;
			settings.remoteDNS = values.wireguardRemoteDNS
				? splitComma(values.wireguardRemoteDNS)
				: undefined;
			settings.reserved = values.wireguardReserved
				? splitComma(values.wireguardReserved)
						.map((value) => Number(value))
						.filter((value) => !Number.isNaN(value))
				: undefined;
			settings.noKernelTun = values.wireguardNoKernelTun;
			settings.peers = values.wireguardPeers.map((peer: WireguardPeerForm) => ({
				publicKey: peer.publicKey || undefined,
				allowedIPs: peer.allowedIPs ? splitComma(peer.allowedIPs) : undefined,
				endpoint: peer.endpoint || undefined,
				keepAlive: Number(peer.keepAlive) || undefined,
				preSharedKey: peer.presharedKey || undefined,
			}));
			break;
		default:
			break;
	}

	const security: OutboundSecurityValue =
		values.protocol === Protocols.Hysteria
			? "tls"
			: values.realityEnabled
				? "reality"
				: values.tlsEnabled
					? "tls"
					: "none";
	const streamSettings = new StreamSettings(
		values.protocol === Protocols.Hysteria ? "hysteria" : values.network,
		security,
	);

	if (values.network === "tcp") {
		streamSettings.tcp = new TcpStreamSettings(
			values.tcpType,
			values.tcpHost,
			values.tcpPath,
		);
	} else if (values.network === "kcp") {
		streamSettings.kcp = new KcpStreamSettings();
		streamSettings.kcp.type = values.kcpType || "none";
		streamSettings.kcp.seed = values.kcpSeed || "";
	} else if (values.network === "ws") {
		streamSettings.ws = new WsStreamSettings(values.wsPath, values.wsHost, 0);
	} else if (values.network === "grpc") {
		streamSettings.grpc = new GrpcStreamSettings(
			values.grpcServiceName,
			values.grpcAuthority,
			values.grpcMultiMode,
		);
	} else if (values.network === "httpupgrade") {
		streamSettings.httpupgrade = new HttpUpgradeStreamSettings(
			values.httpupgradePath,
			values.httpupgradeHost,
		);
	} else if (values.network === "xhttp") {
		streamSettings.xhttp = new XHTTPStreamSettings(
			values.xhttpPath,
			values.xhttpHost,
			values.xhttpMode,
			values.xhttpNoGRPCHeader,
			values.xhttpScMinPostsIntervalMs,
			{
				maxConcurrency: values.xhttpXmuxMaxConcurrency,
				maxConnections: Number(values.xhttpXmuxMaxConnections) || 0,
				cMaxReuseTimes: Number(values.xhttpXmuxCMaxReuseTimes) || 0,
				hMaxRequestTimes: values.xhttpXmuxHMaxRequestTimes,
				hMaxReusableSecs: values.xhttpXmuxHMaxReusableSecs,
				hKeepAlivePeriod: Number(values.xhttpXmuxHKeepAlivePeriod) || 0,
			},
		);
	}
	if (values.protocol === Protocols.Hysteria) {
		streamSettings.hysteria.auth = values.hysteriaAuth || "";
		streamSettings.hysteria.version = Number(values.hysteriaVersion) || 2;
		streamSettings.hysteria.udpIdleTimeout =
			Number(values.hysteriaUdpIdleTimeout) || 60;
	}

	if (values.tlsEnabled) {
		streamSettings.tls = new TlsStreamSettings(
			values.tlsServerName,
			splitComma(values.tlsAlpn),
			values.tlsFingerprint,
			values.tlsEchConfigList,
			values.tlsPinnedPeerCertSha256,
			values.tlsVerifyPeerCertByName,
		);
	}

	if (values.realityEnabled) {
		streamSettings.reality = new RealityStreamSettings(
			values.realityPublicKey,
			values.realityFingerprint,
			values.realityServerName,
			values.realityShortId,
			values.realitySpiderX,
			values.realityMldsa65Verify,
		);
	}

	if (values.sockoptEnabled) {
		streamSettings.sockopt = new SockoptStreamSettings(
			values.sockoptDialerProxy,
			values.sockoptTcpFastOpen,
			Number(values.sockoptTcpKeepAliveInterval) || 0,
			values.sockoptTcpMptcp,
			values.sockoptPenetrate,
			values.sockoptAddressPortStrategy || Address_Port_Strategy.NONE,
		);
	}

	const mux = values.muxEnabled
		? new Mux(
				true,
				Number(values.muxConcurrency) || defaultValues.muxConcurrency,
				Number(values.muxXudpConcurrency) || defaultValues.muxXudpConcurrency,
				values.muxXudpProxyUdp443 || defaultValues.muxXudpProxyUdp443,
			)
		: undefined;
	const outbound = new Outbound(
		values.tag,
		values.protocol,
		settings,
		streamSettings,
		values.sendThrough || undefined,
		mux,
	);
	return outbound.toJson();
};

export const OutboundModal: FC<OutboundModalProps> = ({
	open: isOpen,
	onClose,
	mode,
	initialOutbound,
	existingTags,
	sourceTarget,
	propagationBase,
	onSubmitOutbound,
}) => {
	const { t } = useTranslation();
	
	const [targetIds, setTargetIds] = useState<string[]>([]);
	const bgSubtle = "bg-gray-50 dark:bg-whiteAlpha-100";
	const {
		control,
		register,
		reset,
		handleSubmit,
		watch,
		getValues,
		setValue,
		formState: { errors, isValid },
	} = useForm<OutboundFormValues>({
		defaultValues,
		mode: "onChange",
		reValidateMode: "onChange",
		criteriaMode: "all",
	});
	useEffect(() => {
		register("tlsEnabled");
		register("realityEnabled");
	}, [register]);

	const { fields, append, remove } = useFieldArray({
		control,
		name: "wireguardPeers",
	});
	const protocol = watch("protocol");
	const currentTag = watch("tag");
	const network = watch("network");
	const tlsEnabled = watch("tlsEnabled");
	const realityEnabled = watch("realityEnabled");
	const tcpType = watch("tcpType");

	const muxEnabled = watch("muxEnabled");
	const sockoptEnabled = watch("sockoptEnabled");
	const requiredMessage = t("validation.required");
	const invalidPortMessage = t("validation.invalidPort");
	const typedProtocol = (protocol as ProtocolValue) || Protocols.VLESS;
	const isWireguard = typedProtocol === Protocols.Wireguard;
	const requiresEndpoint = !(
		[
			Protocols.Freedom,
			Protocols.Blackhole,
			Protocols.DNS,
			Protocols.Wireguard,
		] as ProtocolValue[]
	).includes(typedProtocol);
	const requiresId = (
		[Protocols.VMess, Protocols.VLESS] as ProtocolValue[]
	).includes(typedProtocol);
	const requiresPassword = (
		[Protocols.Trojan, Protocols.Shadowsocks] as ProtocolValue[]
	).includes(typedProtocol);
	const supportsUserPass = (
		[Protocols.Socks, Protocols.HTTP] as ProtocolValue[]
	).includes(typedProtocol);
	const requiresMethod = typedProtocol === Protocols.Shadowsocks;
	const requiresDnsServer = typedProtocol === Protocols.DNS;
	const formValues = useWatch({ control }) as OutboundFormValues;
	const [activeTab, setActiveTab] = useState(0);
	const [jsonData, setJsonData] = useState(() =>
		buildOutboundJson(defaultValues),
	);
	const [_jsonText, setJsonText] = useState(() =>
		JSON.stringify(buildOutboundJson(defaultValues), null, 2),
	);
	const [jsonError, setJsonError] = useState<string | null>(null);
	const [configInput, setConfigInput] = useState("");
	const updatingFromJsonRef = useRef(false);

	const streamNetworkOptions = useMemo(
		() => STREAM_NETWORK_OPTIONS_BY_PROTOCOL[typedProtocol] ?? [],
		[typedProtocol],
	);

	const capabilityProbe = useMemo(() => {
		const stream = new StreamSettings(
			typedProtocol === Protocols.Hysteria ? "hysteria" : (network ?? "tcp"),
		);
		const security: OutboundSecurityValue =
			typedProtocol === Protocols.Hysteria
				? "tls"
				: realityEnabled
					? "reality"
					: tlsEnabled
						? "tls"
						: "none";
		stream.security = security;
		stream.network =
			typedProtocol === Protocols.Hysteria ? "hysteria" : (network ?? "tcp");
		const settings = Outbound.Settings.getSettings(typedProtocol) ?? {};
		if (
			typedProtocol === Protocols.VLESS &&
			settings &&
			typeof settings === "object" &&
			"flow" in settings
		) {
			(settings as { flow: string }).flow = formValues?.flow ?? "";
		}
		return new Outbound("probe", typedProtocol, settings, stream, undefined);
	}, [formValues?.flow, network, realityEnabled, tlsEnabled, typedProtocol]);

	const canStream = capabilityProbe.canEnableStream();
	const canTls = capabilityProbe.canEnableTls();
	const canReality = capabilityProbe.canEnableReality();
	const canMux = capabilityProbe.canEnableMux();
	const canTlsFlow = capabilityProbe.canEnableTlsFlow();
	const canAnySecurity = canTls || canReality;

	const mapJsonToFormValues = useCallback((json: any): OutboundFormValues => {
		const outbound = Outbound.fromJson(json);
		const sockopt = json?.streamSettings?.sockopt;
		const mapped: OutboundFormValues = {
			...defaultValues,
			tag: json?.tag ?? "",
			protocol: ((outbound?.protocol as ProtocolValue) ||
				defaultValues.protocol) as ProtocolValue,
			sendThrough: json?.sendThrough ?? "",
			muxEnabled: Boolean(json?.mux?.enabled),
			muxConcurrency: Number(
				json?.mux?.concurrency ?? defaultValues.muxConcurrency,
			),
			muxXudpConcurrency: Number(
				json?.mux?.xudpConcurrency ?? defaultValues.muxXudpConcurrency,
			),
			muxXudpProxyUdp443:
				json?.mux?.xudpProxyUDP443 === "allow" ||
				json?.mux?.xudpProxyUDP443 === "skip" ||
				json?.mux?.xudpProxyUDP443 === "reject"
					? json.mux.xudpProxyUDP443
					: defaultValues.muxXudpProxyUdp443,
			sockoptEnabled: Boolean(sockopt),
			sockoptTcpFastOpen: Boolean(sockopt?.tcpFastOpen),
			sockoptTcpMptcp: Boolean(sockopt?.tcpMptcp),
			sockoptPenetrate: Boolean(sockopt?.penetrate),
			sockoptDialerProxy: sockopt?.dialerProxy ?? "",
			sockoptTcpKeepAliveInterval: Number(sockopt?.tcpKeepAliveInterval) || 0,
			sockoptAddressPortStrategy:
				sockopt?.addressPortStrategy ?? Address_Port_Strategy.NONE,
		};

		const stream =
			outbound?.stream ?? json?.streamSettings ?? json?.stream ?? {};
		const streamRaw: any = stream;
		const streamSecurity =
			(streamRaw?.security as OutboundSecurityValue | undefined) ?? "none";
		mapped.network =
			((streamRaw?.method ??
				streamRaw?.network) as OutboundFormValues["network"]) ??
			defaultValues.network;
		mapped.tlsEnabled = streamSecurity === "tls";
		mapped.realityEnabled = streamSecurity === "reality";
		const tlsSettings = streamRaw?.tls ?? streamRaw?.tlsSettings ?? {};
		mapped.tlsServerName = tlsSettings?.serverName ?? "";
		mapped.tlsFingerprint = tlsSettings?.fingerprint ?? "";
		mapped.tlsAlpn = Array.isArray(tlsSettings?.alpn)
			? tlsSettings.alpn.join(",")
			: "";
		mapped.tlsEchConfigList = tlsSettings?.echConfigList ?? "";
		mapped.tlsPinnedPeerCertSha256 = tlsSettings?.pinnedPeerCertSha256 ?? "";
		mapped.tlsVerifyPeerCertByName = tlsSettings?.verifyPeerCertByName ?? "";

		const realitySettings =
			streamRaw?.reality ?? streamRaw?.realitySettings ?? {};
		mapped.realityServerName = realitySettings?.serverName ?? "";
		mapped.realityFingerprint = realitySettings?.fingerprint ?? "";
		mapped.realityPublicKey = realitySettings?.publicKey ?? "";
		mapped.realityShortId = realitySettings?.shortId ?? "";
		mapped.realitySpiderX = realitySettings?.spiderX ?? "";
		mapped.realityMldsa65Verify = realitySettings?.mldsa65Verify ?? "";

		if (mapped.network === "tcp" && streamRaw?.tcp) {
			mapped.tcpType = streamRaw.tcp.type as OutboundFormValues["tcpType"];
			mapped.tcpHost = streamRaw.tcp.host ?? "";
			mapped.tcpPath = streamRaw.tcp.path ?? "";
		}
		if (mapped.network === "kcp" && streamRaw?.kcp) {
			mapped.kcpType = streamRaw.kcp.type ?? "none";
			mapped.kcpSeed = streamRaw.kcp.seed ?? "";
		}
		if (mapped.network === "ws" && streamRaw?.ws) {
			mapped.wsHost = streamRaw.ws.host ?? "";
			mapped.wsPath = streamRaw.ws.path ?? "";
		}
		if (mapped.network === "grpc" && streamRaw?.grpc) {
			mapped.grpcServiceName = streamRaw.grpc.serviceName ?? "";
			mapped.grpcAuthority = streamRaw.grpc.authority ?? "";
			mapped.grpcMultiMode = Boolean(streamRaw.grpc.multiMode);
		}
		if (mapped.network === "httpupgrade" && streamRaw?.httpupgrade) {
			mapped.httpupgradeHost = streamRaw.httpupgrade.host ?? "";
			mapped.httpupgradePath = streamRaw.httpupgrade.path ?? "/";
		}
		if (mapped.network === "xhttp" && streamRaw?.xhttp) {
			mapped.xhttpHost = streamRaw.xhttp.host ?? "";
			mapped.xhttpPath = streamRaw.xhttp.path ?? "/";
			mapped.xhttpMode = streamRaw.xhttp.mode ?? "";
			mapped.xhttpNoGRPCHeader = Boolean(streamRaw.xhttp.noGRPCHeader);
			mapped.xhttpScMinPostsIntervalMs =
				streamRaw.xhttp.scMinPostsIntervalMs ??
				defaultValues.xhttpScMinPostsIntervalMs;
			mapped.xhttpXmuxMaxConcurrency =
				streamRaw.xhttp?.xmux?.maxConcurrency ??
				defaultValues.xhttpXmuxMaxConcurrency;
			mapped.xhttpXmuxMaxConnections = Number(
				streamRaw.xhttp?.xmux?.maxConnections ??
					defaultValues.xhttpXmuxMaxConnections,
			);
			mapped.xhttpXmuxCMaxReuseTimes = Number(
				streamRaw.xhttp?.xmux?.cMaxReuseTimes ??
					defaultValues.xhttpXmuxCMaxReuseTimes,
			);
			mapped.xhttpXmuxHMaxRequestTimes =
				streamRaw.xhttp?.xmux?.hMaxRequestTimes ??
				defaultValues.xhttpXmuxHMaxRequestTimes;
			mapped.xhttpXmuxHMaxReusableSecs =
				streamRaw.xhttp?.xmux?.hMaxReusableSecs ??
				defaultValues.xhttpXmuxHMaxReusableSecs;
			mapped.xhttpXmuxHKeepAlivePeriod = Number(
				streamRaw.xhttp?.xmux?.hKeepAlivePeriod ??
					defaultValues.xhttpXmuxHKeepAlivePeriod,
			);
		}
		if (mapped.network === "hysteria") {
			const hysteriaSettings =
				streamRaw?.hysteria ?? streamRaw?.hysteriaSettings ?? {};
			mapped.hysteriaVersion = Number(
				hysteriaSettings?.version ?? defaultValues.hysteriaVersion,
			);
			mapped.hysteriaAuth = hysteriaSettings?.auth ?? "";
			mapped.hysteriaUdpIdleTimeout = Number(
				hysteriaSettings?.udpIdleTimeout ??
					defaultValues.hysteriaUdpIdleTimeout,
			);
			mapped.tlsEnabled = true;
			mapped.realityEnabled = false;
		}

		if (outbound?.hasAddressPort()) {
			mapped.address =
				outbound.settings?.address ?? json?.settings?.address ?? "";
			mapped.port = Number(
				outbound.settings?.port ?? json?.settings?.port ?? defaultValues.port,
			);
		}

		switch (mapped.protocol) {
			case Protocols.VMess: {
				const settings = outbound.settings as Outbound.VmessSettings;
				mapped.id = settings?.id ?? "";
				mapped.vnextEncryption =
					settings?.security ?? defaultValues.vnextEncryption;
				mapped.address = settings?.address ?? mapped.address;
				mapped.port = Number(settings?.port ?? mapped.port);
				break;
			}
			case Protocols.VLESS: {
				const settings = outbound.settings as Outbound.VLESSSettings;
				mapped.reverseTag = json?.settings?.reverse?.tag ?? "";
				mapped.id = settings?.id ?? "";
				mapped.flow = settings?.flow ?? "";
				mapped.encryption = settings?.encryption ?? mapped.encryption;
				mapped.address = settings?.address ?? mapped.address;
				mapped.port = Number(settings?.port ?? mapped.port);
				break;
			}
			case Protocols.Trojan: {
				const settings = outbound.settings as Outbound.TrojanSettings;
				mapped.password = settings?.password ?? "";
				mapped.address = settings?.address ?? mapped.address;
				mapped.port = Number(settings?.port ?? mapped.port);
				break;
			}
			case Protocols.Shadowsocks: {
				const settings = outbound.settings as Outbound.ShadowsocksSettings;
				mapped.password = settings?.password ?? "";
				mapped.method = settings?.method ?? defaultValues.method;
				mapped.address = settings?.address ?? mapped.address;
				mapped.port = Number(settings?.port ?? mapped.port);
				mapped.ssIvCheck = (settings as any)?.ivCheck ?? false;
				break;
			}
			case Protocols.Hysteria: {
				const settings = outbound.settings as Outbound.HysteriaSettings;
				mapped.address = settings?.address ?? mapped.address;
				mapped.port = Number(settings?.port ?? mapped.port);
				mapped.hysteriaVersion = Number(
					settings?.version ?? mapped.hysteriaVersion,
				);
				mapped.network = "hysteria";
				mapped.tlsEnabled = true;
				mapped.realityEnabled = false;
				break;
			}
			case Protocols.Socks:
			case Protocols.HTTP: {
				const settings =
					mapped.protocol === Protocols.Socks
						? (outbound.settings as Outbound.SocksSettings)
						: (outbound.settings as Outbound.HttpSettings);
				mapped.user = settings?.user ?? "";
				mapped.pass = settings?.pass ?? "";
				mapped.address = settings?.address ?? mapped.address;
				mapped.port = Number(settings?.port ?? mapped.port);
				break;
			}
			case Protocols.DNS: {
				const settings = outbound.settings as Outbound.DNSSettings;
				mapped.dnsNetwork = settings?.network ?? defaultValues.dnsNetwork;
				mapped.dnsAddress = settings?.address ?? "";
				mapped.dnsPort = Number(settings?.port ?? defaultValues.dnsPort);
				break;
			}
			case Protocols.Freedom: {
				const settings = outbound.settings as Outbound.FreedomSettings;
				mapped.freedomStrategy = settings?.domainStrategy ?? "";
				break;
			}
			case Protocols.Blackhole: {
				const settings = outbound.settings as Outbound.BlackholeSettings;
				mapped.blackholeResponse = settings?.type ?? "";
				mapped.blackholeCustomResponseData = settings?.customResponseData ?? "";
				break;
			}
			case Protocols.Wireguard: {
				const settings = outbound.settings as Outbound.WireguardSettings;
				mapped.wireguardSecret = settings?.secretKey ?? "";
				mapped.wireguardAddress = Array.isArray((settings as any)?.address)
					? (settings as any).address.join(",")
					: (settings?.address ?? "");
				mapped.wireguardMtu = Number(
					(settings as any)?.mtu ?? defaultValues.wireguardMtu,
				);
				mapped.wireguardWorkers = Number(
					(settings as any)?.workers ?? defaultValues.wireguardWorkers,
				);
				mapped.wireguardDomainStrategy =
					(settings as any)?.domainStrategy ?? "";
				mapped.wireguardRemoteDNS = Array.isArray(settings?.remoteDNS)
					? settings.remoteDNS.join(",")
					: "";
				mapped.wireguardReserved = Array.isArray((settings as any)?.reserved)
					? (settings as any).reserved.join(",")
					: ((settings as any)?.reserved ?? "");
				mapped.wireguardNoKernelTun = Boolean((settings as any)?.noKernelTun);
				const peers =
					settings?.peers?.map((peer: Outbound.WireguardPeer) => ({
						publicKey: peer.publicKey ?? "",
						allowedIPs: Array.isArray(peer.allowedIPs)
							? peer.allowedIPs.join(",")
							: "",
						endpoint: peer.endpoint ?? "",
						keepAlive: Number(peer.keepAlive ?? 0),
						presharedKey: (peer as any).psk ?? (peer as any).preSharedKey ?? "",
					})) ?? [];
				mapped.wireguardPeers =
					peers.length > 0 ? peers : defaultValues.wireguardPeers;
				break;
			}
			default:
				break;
		}

		if (mapped.protocol === Protocols.Wireguard) {
			mapped.tlsEnabled = false;
			mapped.realityEnabled = false;
			mapped.network = "tcp";
		}

		const protocolNetworks =
			STREAM_NETWORK_OPTIONS_BY_PROTOCOL[
				(mapped.protocol as ProtocolValue) ?? defaultValues.protocol
			] ?? [];
		if (
			protocolNetworks.length > 0 &&
			!protocolNetworks.includes(mapped.network)
		) {
			mapped.network = protocolNetworks[0];
		}

		if (!mapped.wireguardPeers || mapped.wireguardPeers.length === 0) {
			mapped.wireguardPeers = defaultValues.wireguardPeers;
		}

		return mapped;
	}, []);

	useEffect(() => {
		if (!isOpen) {
			return;
		}
		setActiveTab(0);
		setTargetIds([]);
		setJsonError(null);
		setConfigInput("");
		const baseValues = initialOutbound
			? mapJsonToFormValues(initialOutbound)
			: defaultValues;
		updatingFromJsonRef.current = true;
		reset(baseValues);
		const freshJson = buildOutboundJson(baseValues);
		setJsonData(freshJson);
		setJsonText(JSON.stringify(freshJson, null, 2));
	}, [initialOutbound, isOpen, reset, mapJsonToFormValues]);

	useEffect(() => {
		if (!formValues) return;
		if (updatingFromJsonRef.current) {
			updatingFromJsonRef.current = false;
			return;
		}
		const updatedJson = buildOutboundJson(formValues);
		setJsonData(updatedJson);
		const formatted = JSON.stringify(updatedJson, null, 2);
		setJsonText((prev) => (prev === formatted ? prev : formatted));
		setJsonError(null);
	}, [formValues]);

	useEffect(() => {
		if (!isOpen) {
			return;
		}
		if (!canStream) {
			if (network !== defaultValues.network) {
				setValue("network", defaultValues.network);
			}
			setValue("tcpType", defaultValues.tcpType);
			setValue("tcpHost", "");
			setValue("tcpPath", "");
			setValue("kcpType", defaultValues.kcpType);
			setValue("kcpSeed", "");
			setValue("wsHost", "");
			setValue("wsPath", "");
			setValue("grpcServiceName", "");
			setValue("grpcAuthority", "");
			setValue("grpcMultiMode", false);
			setValue("httpupgradeHost", "");
			setValue("httpupgradePath", defaultValues.httpupgradePath);
			setValue("xhttpHost", "");
			setValue("xhttpPath", defaultValues.xhttpPath);
			setValue("xhttpMode", defaultValues.xhttpMode);
			setValue("xhttpNoGRPCHeader", false);
			setValue(
				"xhttpScMinPostsIntervalMs",
				defaultValues.xhttpScMinPostsIntervalMs,
			);
			setValue(
				"xhttpXmuxMaxConcurrency",
				defaultValues.xhttpXmuxMaxConcurrency,
			);
			setValue(
				"xhttpXmuxMaxConnections",
				defaultValues.xhttpXmuxMaxConnections,
			);
			setValue(
				"xhttpXmuxCMaxReuseTimes",
				defaultValues.xhttpXmuxCMaxReuseTimes,
			);
			setValue(
				"xhttpXmuxHMaxRequestTimes",
				defaultValues.xhttpXmuxHMaxRequestTimes,
			);
			setValue(
				"xhttpXmuxHMaxReusableSecs",
				defaultValues.xhttpXmuxHMaxReusableSecs,
			);
			setValue(
				"xhttpXmuxHKeepAlivePeriod",
				defaultValues.xhttpXmuxHKeepAlivePeriod,
			);
			if (tlsEnabled) {
				setValue("tlsEnabled", false);
			}
			if (realityEnabled) {
				setValue("realityEnabled", false);
			}
			return;
		}
		if (
			streamNetworkOptions.length > 0 &&
			!streamNetworkOptions.includes(network)
		) {
			setValue("network", streamNetworkOptions[0]);
		}
	}, [
		canStream,
		isOpen,
		network,
		realityEnabled,
		setValue,
		streamNetworkOptions,
		tlsEnabled,
	]);

	useEffect(() => {
		if (!canTls && tlsEnabled) {
			setValue("tlsEnabled", false);
			setValue("tlsServerName", "");
			setValue("tlsFingerprint", "");
			setValue("tlsAlpn", "");
			setValue("tlsEchConfigList", "");
			setValue("tlsPinnedPeerCertSha256", "");
			setValue("tlsVerifyPeerCertByName", "");
		}
	}, [canTls, setValue, tlsEnabled]);

	useEffect(() => {
		if (typedProtocol !== Protocols.Hysteria) {
			return;
		}
		if (network !== "hysteria") {
			setValue("network", "hysteria");
		}
		if (!tlsEnabled) {
			setValue("tlsEnabled", true);
		}
		if (realityEnabled) {
			setValue("realityEnabled", false);
		}
	}, [network, realityEnabled, setValue, tlsEnabled, typedProtocol]);

	useEffect(() => {
		if (!canReality && realityEnabled) {
			setValue("realityEnabled", false);
			setValue("realityServerName", "");
			setValue("realityFingerprint", "");
			setValue("realityPublicKey", "");
			setValue("realityShortId", "");
			setValue("realitySpiderX", "");
			setValue("realityMldsa65Verify", "");
		}
	}, [canReality, realityEnabled, setValue]);

	useEffect(() => {
		if (
			(typedProtocol !== Protocols.VLESS || network !== "tcp") &&
			(formValues?.flow ?? "").trim().length > 0
		) {
			setValue("flow", "");
		}
	}, [formValues?.flow, network, setValue, typedProtocol]);

	useEffect(() => {
		if (!canMux && muxEnabled) {
			setValue("muxEnabled", false);
		}
	}, [canMux, muxEnabled, setValue]);

	useEffect(() => {
		if (isWireguard) {
			if (tlsEnabled) {
				setValue("tlsEnabled", false);
			}
			if (realityEnabled) {
				setValue("realityEnabled", false);
			}
		}
	}, [isWireguard, realityEnabled, setValue, tlsEnabled]);

	const protocolOptions = useMemo(
		() => [
			Protocols.VLESS,
			Protocols.VMess,
			Protocols.Trojan,
			Protocols.Shadowsocks,
			Protocols.Hysteria,
			Protocols.Socks,
			Protocols.HTTP,
			Protocols.Freedom,
			Protocols.Blackhole,
			Protocols.DNS,
			Protocols.Wireguard,
		],
		[],
	);

	const handleJsonEditorChange = (value: string) => {
		setJsonText(value);
		try {
			const parsed = JSON.parse(value);
			setJsonError(null);
			setJsonData(parsed);
			updatingFromJsonRef.current = true;
			const mapped = mapJsonToFormValues(parsed);
			reset(mapped);
		} catch (error: any) {
			setJsonError(error.message);
		}
	};

	const parseWireguardIni = (text: string) => {
		if (!text.toLowerCase().includes("[interface]")) return null;
		const lines = text.split(/\r?\n/);
		let current: "interface" | "peer" | null = null;
		const iface: Record<string, string> = {};
		const peersRaw: Array<Record<string, string>> = [];

		lines.forEach((raw) => {
			const line = raw.trim();
			if (!line || line.startsWith("#") || line.startsWith(";")) return;
			const lower = line.toLowerCase();
			if (lower === "[interface]") {
				current = "interface";
				return;
			}
			if (lower === "[peer]") {
				current = "peer";
				peersRaw.push({});
				return;
			}
			const [key, ...rest] = line.split("=");
			if (!key || rest.length === 0) return;
			const value = rest.join("=").trim();
			if (current === "interface") {
				iface[key.trim().toLowerCase()] = value;
			} else if (current === "peer") {
				const target = peersRaw[peersRaw.length - 1];
				if (target) {
					target[key.trim().toLowerCase()] = value;
				}
			}
		});

		if (!iface.privatekey) return null;
		const addresses = iface.address
			? iface.address
					.split(",")
					.map((item) => item.trim())
					.filter(Boolean)
			: [];
		const peers = peersRaw.map((peer) => ({
			publicKey: peer.publickey || "",
			preSharedKey: peer.presharedkey || peer.psk || "",
			allowedIPs: (peer.allowedips || "")
				.split(",")
				.map((item) => item.trim())
				.filter(Boolean),
			endpoint: peer.endpoint || "",
			keepAlive: peer.persistentkeepalive
				? Number(peer.persistentkeepalive) || 0
				: 0,
		}));

		return {
			tag: "wireguard-import",
			protocol: Protocols.Wireguard,
			settings: {
				secretKey: iface.privatekey,
				address: addresses,
				peers,
			},
		};
	};

	const handleConfigToJson = () => {
		const trimmed = configInput.trim();
		if (!trimmed) {
			setJsonError(t("pages.outbound.configEmpty"));
			return;
		}
		const wg = parseWireguardIni(trimmed);
		if (wg) {
			const formatted = JSON.stringify(wg, null, 2);
			setConfigInput("");
			handleJsonEditorChange(formatted);
			toast.success(t("pages.outbound.configConvertedTitle"), { description: t("pages.outbound.configConvertedDesc"), duration: 2000 });
			return;
		}
		const outboundFromLink = Outbound.fromLink(trimmed);
		if (!outboundFromLink) {
			setJsonError(t("pages.outbound.invalidConfig"));
			toast.error(t("pages.outbound.configParseFailedTitle"), { description: t("pages.outbound.configParseFailedDesc"), duration: 2500 });
			return;
		}
		const json = outboundFromLink.toJson();
		const formatted = JSON.stringify(json, null, 2);
		setConfigInput("");
		handleJsonEditorChange(formatted);
		toast.success(t("pages.outbound.configConvertedTitle"), { description: t("pages.outbound.configConvertedDesc"), duration: 2000 });
	};

	const onSubmit = handleSubmit(async (values) => {
		const outboundJson = buildOutboundJson(values);
		try {
			await onSubmitOutbound(outboundJson, targetIds);
			toast.success(mode === "edit"
						? t("pages.xray.outbound.updated")
						: t("pages.xray.outbound.addOutbound"), { duration: 2000 });
			onClose();
		} catch (error: any) {
			toast.error(error?.data?.detail ||
					error?.message ||
					t("pages.xray.outbound.saveFailed"), { duration: 3000 });
		}
	});

	const handleClose = () => {
		onClose();
	};

	const handleTabChange = (index: number) => {
		setActiveTab(index);
		if (index === 1) {
			const currentJson = buildOutboundJson(getValues());
			setJsonData(currentJson);
			const formatted = JSON.stringify(currentJson, null, 2);
			setJsonText((prev) => (prev === formatted ? prev : formatted));
			setJsonError(null);
		}
	};

	const fieldError = (name: keyof OutboundFormValues) =>
		(errors as unknown as Record<string, { message?: string } | undefined>)[name]?.message;
	const textField = (
		name: keyof OutboundFormValues,
		label: ReactNode,
		placeholder?: string,
		rules?: Parameters<typeof register>[1],
	) => (
		<FormField label={label} error={fieldError(name)}>
			<UiInput placeholder={placeholder} {...register(name, rules as never)} />
		</FormField>
	);
	const shortcodeTextField = (
		name: keyof OutboundFormValues,
		label: ReactNode,
		placeholder?: string,
		rules?: Parameters<typeof register>[1],
	) => (
		<FormField label={label} error={fieldError(name)}>
			<Controller
				control={control}
				name={name}
				rules={rules as never}
				render={({ field }) => (
					<EmojiShortcodeInput
						ref={field.ref}
						value={String(field.value ?? "")}
						onChange={field.onChange}
						onBlur={field.onBlur}
						placeholder={placeholder}
					/>
				)}
			/>
		</FormField>
	);
	const numberField = (
		name: keyof OutboundFormValues,
		label: ReactNode,
		options: { min?: number; max?: number; placeholder?: string; required?: boolean } = {},
	) => (
		<FormField label={label} error={fieldError(name)}>
			<Controller
				control={control}
				name={name}
				rules={{
					required: options.required ? requiredMessage : false,
					min: options.min === undefined ? undefined : { value: options.min, message: invalidPortMessage },
					max: options.max === undefined ? undefined : { value: options.max, message: invalidPortMessage },
				}}
				render={({ field }) => (
					<NumberField
						inputMode="numeric"
						min={options.min}
						max={options.max}
						placeholder={options.placeholder}
						doneLabel={t("common.done")}
						value={field.value === undefined || field.value === null || Number.isNaN(field.value) ? "" : String(field.value)}
						onChange={(raw) => field.onChange(raw.trim() === "" ? undefined : Number(raw))}
						invalid={Boolean(fieldError(name))}
					/>
				)}
			/>
		</FormField>
	);
	const switchRow = (name: keyof OutboundFormValues, title: ReactNode, hint?: ReactNode) => (
		<Controller
			control={control}
			name={name}
			render={({ field }) => (
				<ToggleRow title={title} hint={hint} checked={Boolean(field.value)} onChange={(next) => field.onChange(next)} />
			)}
		/>
	);
	const selectField = (
		name: keyof OutboundFormValues,
		label: ReactNode,
		options: (string | { value: string; label?: string; disabled?: boolean })[],
		placeholder?: string,
	) => (
		<FormField label={label} error={fieldError(name)}>
			<Controller
				control={control}
				name={name}
				render={({ field }) => (
					<SearchableTagSelect
						mode="single"
						options={options}
						value={(field.value as string | undefined) ?? ""}
						onChange={(value) => field.onChange(value as string)}
						placeholder={placeholder ?? ""}
						searchPlaceholder={t("search")}
					/>
				)}
			/>
		</FormField>
	);

	return (
		<Dialog open={isOpen} onOpenChange={(next) => { if (!next) handleClose(); }}>
			<DialogContent className={outboundShell}>
				<form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
					<DialogHeader className="flex-row items-center gap-3 border-b px-5 py-3.5 pe-12 text-start sm:text-start">
						<div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
							<Send className="size-4" />
						</div>
						<div className="min-w-0">
							<DialogTitle className="truncate text-base">
								{mode === "edit" ? t("pages.xray.outbound.editOutbound") : t("pages.xray.outbound.addOutbound")}
							</DialogTitle>
							<DialogDescription className="truncate">{String(typedProtocol ?? "").toUpperCase() || t("protocol")}</DialogDescription>
						</div>
					</DialogHeader>

					<Tabs value={String(activeTab)} onValueChange={(value) => handleTabChange(Number(value))} className="flex min-h-0 flex-1 flex-col">
						<div className="border-b px-5 pt-2.5 pb-2.5">
							<TabsList className="w-full">
								<TabsTrigger value="0">
									{t("form")}
								</TabsTrigger>
								<TabsTrigger value="1">
									{t("json")}
								</TabsTrigger>
								<TabsTrigger value="2">
									{t("pages.xray.propagate.tab")}
								</TabsTrigger>
							</TabsList>
						</div>

						<div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
							<TabsContent value="0" className="mt-0">
								<div className="flex flex-col gap-5">
									<FormSection title={t("pages.outbound.basicSettings")}>
										<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
											{shortcodeTextField("tag", t("pages.xray.outbound.tag"), "outbound-tag", {
												validate: (value: string) => {
													const tag = value.trim();
													if (!tag) return requiredMessage;
													const originalTag = String(initialOutbound?.tag ?? "");
													return (
														!existingTags.includes(tag) ||
														(mode === "edit" && tag === originalTag) ||
														t("pages.xray.outbound.tagExists")
													);
												},
											} as never)}
											{selectField("protocol", t("protocol"), protocolOptions, t("protocol"))}
											{textField("sendThrough", t("pages.xray.outbound.sendThrough"), "0.0.0.0")}
										</div>
									</FormSection>

									{requiresEndpoint ? (
										<FormSection title={t("pages.outbound.endpoint")}>
											{textField("address", t("pages.outbound.address"), "example.com", {
												required: requiresEndpoint ? requiredMessage : false,
											})}
											<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
												{numberField("port", t("port"), { min: 1, max: 65535, required: requiresEndpoint })}
												{requiresId
													? textField("id", "ID", "UUID", { required: requiresId ? requiredMessage : false })
													: requiresPassword
														? textField("password", t("password"), "password", { required: requiresPassword ? requiredMessage : false })
														: typedProtocol === Protocols.Hysteria
															? textField("hysteriaAuth", t("pages.outbound.hysteriaAuth"), "auth")
															: supportsUserPass
																? textField("user", t("username"), "username")
																: textField("user", t("username"), "username")}
											</div>
											{supportsUserPass && !requiresId && !requiresPassword && typedProtocol !== Protocols.Hysteria ? (
												<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
													{textField("pass", t("password"), "password")}
												</div>
											) : null}
											{typedProtocol === Protocols.Shadowsocks ? (
												<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
													<FormField label={t("pages.outbound.method")} error={fieldError("method")}>
														<Controller
															control={control}
															name="method"
															rules={{ required: requiresMethod ? requiredMessage : false }}
															render={({ field }) => (
																<SearchableTagSelect
																	mode="single"
																	options={Object.values(SSMethods)}
																	value={field.value ?? ""}
																	onChange={(value) => field.onChange(value as string)}
																	placeholder={t("pages.outbound.method")}
																	searchPlaceholder={t("search")}
																/>
															)}
														/>
													</FormField>
													{switchRow("ssIvCheck", t("pages.outbound.ivCheck"))}
												</div>
											) : null}
											{typedProtocol === Protocols.Hysteria ? (
												<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
													{numberField("hysteriaVersion", t("redisVersion"), { min: 1, max: 2 })}
													{numberField("hysteriaUdpIdleTimeout", t("inbounds.hysteria.udpIdleTimeout"), { min: 2, max: 600 })}
												</div>
											) : null}
											{typedProtocol === Protocols.VLESS ? (
												<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
													{textField("encryption", t("pages.outbound.encryption"), "none")}
													{canTlsFlow ? textField("flow", "Flow", "xtls-rprx-vision") : null}
												</div>
											) : null}
											{typedProtocol === Protocols.VMess ? textField("vnextEncryption", t("pages.outbound.security"), "auto") : null}
										</FormSection>
									) : null}

									{typedProtocol === Protocols.DNS ? (
										<FormSection title={t("pages.outbound.dnsSettings")}>
											<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
												{selectField("dnsNetwork", t("pages.outbound.network"), ["udp", "tcp"], t("pages.outbound.network"))}
												{numberField("dnsPort", t("port"), { min: 1, max: 65535, required: requiresDnsServer })}
												{textField("dnsAddress", t("pages.outbound.address"), "8.8.8.8", { required: requiresDnsServer ? requiredMessage : false })}
											</div>
										</FormSection>
									) : null}

									{typedProtocol === Protocols.Freedom ? (
										<FormSection title={t("pages.outbound.freedom")}>
											{textField("freedomStrategy", t("pages.outbound.strategy"), "UseIP")}
										</FormSection>
									) : null}

									{typedProtocol === Protocols.Blackhole ? (
										<FormSection title={t("pages.outbound.blackhole")}>
											<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
												{textField("blackholeResponse", t("pages.outbound.response"), "none")}
												{(watch("blackholeResponse") || "").toLowerCase() === "custom"
													? textField("blackholeCustomResponseData", "Custom response data (Base64, Xray 26.9.8+)", undefined, {
															validate: (value) =>
																/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(String(value ?? "")) || "Use standard Base64.",
														})
													: null}
											</div>
										</FormSection>
									) : null}

									{typedProtocol === Protocols.Wireguard ? (
										<FormSection title={t("pages.outbound.wireguard")}>
											<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
												{textField("wireguardSecret", t("pages.outbound.secretKey"))}
												{textField("wireguardAddress", t("pages.outbound.address"), "10.0.0.1/32")}
												{numberField("wireguardMtu", "MTU")}
												{numberField("wireguardWorkers", "Workers")}
												<FormField label="Domain Strategy">
													<Controller
														control={control}
														name="wireguardDomainStrategy"
														render={({ field }) => (
															<SearchableTagSelect
																mode="single"
																options={[{ value: "", label: t("userDialog.flow.none") }, ...WireguardDomainStrategy]}
																value={field.value ?? ""}
																onChange={(value) => field.onChange(value as string)}
																placeholder={t("userDialog.flow.none")}
																searchPlaceholder={t("search")}
															/>
														)}
													/>
												</FormField>
												{textField("wireguardRemoteDNS", "Remote DNS (Xray 26.9.8+)", "1.1.1.1,8.8.8.8")}
												{textField("wireguardReserved", "Reserved", "1,2,3")}
											</div>
											{switchRow("wireguardNoKernelTun", "No Kernel Tun")}
											<div className="flex flex-col gap-3">
												<div className="flex flex-row items-center justify-between gap-2">
													<p className="text-sm font-semibold">{t("pages.outbound.peer")}</p>
													<Button aria-label={t("add")} onClick={() => append({ publicKey: "", allowedIPs: "0.0.0.0/0,::/0", endpoint: "", keepAlive: 0, presharedKey: "" })} variant="outline" size="sm" className="size-8 p-0">
														<AddIcon className="size-3" />
													</Button>
												</div>
												{fields.map((field, index) => (
													<div key={field.id} className={cn("flex flex-col gap-3 rounded-lg border border-panel-border! bg-card/40 p-3", bgSubtle)}>
														<div className="flex flex-row items-end gap-2">
															<div className="min-w-0 flex-1">
																<FormField label={t("pages.outbound.publicKey")}>
																	<UiInput {...register(`wireguardPeers.${index}.publicKey` as const)} />
																</FormField>
															</div>
															{fields.length > 1 ? (
																<Button aria-label={t("delete")} onClick={() => remove(index)} variant="ghost" size="sm" className="size-8 p-0">
																	<MinusIcon className="size-3" />
																</Button>
															) : null}
														</div>
														<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
															<FormField label={t("pages.outbound.allowedIPs")}>
																<UiInput {...register(`wireguardPeers.${index}.allowedIPs` as const)} />
															</FormField>
															<FormField label={t("pages.outbound.endpoint")}>
																<UiInput {...register(`wireguardPeers.${index}.endpoint` as const)} />
															</FormField>
															<FormField label={t("pages.outbound.keepAlive")}>
																<UiInput type="number" {...register(`wireguardPeers.${index}.keepAlive` as const, { valueAsNumber: true })} />
															</FormField>
															<FormField label={t("pages.outbound.presharedKey")}>
																<UiInput {...register(`wireguardPeers.${index}.presharedKey` as const)} />
															</FormField>
														</div>
													</div>
												))}
											</div>
										</FormSection>
									) : null}

									{canStream ? (
										<FormSection title={t("pages.outbound.transport")}>
											<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
												{selectField("network", t("pages.outbound.network"), streamNetworkOptions, t("pages.outbound.network"))}
												{network === "tcp" ? selectField("tcpType", t("pages.outbound.tcpHeader"), ["none", "http"], t("pages.outbound.tcpHeader")) : null}
												{network === "kcp" ? selectField("kcpType", t("pages.outbound.kcpHeader"), [...KCP_HEADER_TYPE_OPTIONS], t("pages.outbound.kcpHeader")) : null}
												{network === "xhttp"
													? selectField("xhttpMode", "Mode", [{ value: "", label: t("userDialog.flow.none") }, ...XHTTP_MODE_OPTIONS], t("userDialog.flow.none"))
													: null}
											</div>
											{network === "tcp" && tcpType === "http" ? (
												<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
													{textField("tcpHost", t("host"))}
													{textField("tcpPath", t("path"))}
												</div>
											) : null}
											{network === "kcp" ? (
												<div className="grid grid-cols-1 gap-4 md:grid-cols-2">{textField("kcpSeed", t("inbounds.kcp.seed"))}</div>
											) : null}
											{network === "ws" ? (
												<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
													{textField("wsHost", t("host"))}
													{textField("wsPath", t("path"))}
												</div>
											) : null}
											{network === "grpc" ? (
												<>
													<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
														{textField("grpcServiceName", t("serviceName"))}
														{textField("grpcAuthority", "Authority")}
													</div>
													{switchRow("grpcMultiMode", t("inbounds.grpc.multiMode"))}
												</>
											) : null}
											{network === "httpupgrade" ? (
												<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
													{textField("httpupgradeHost", t("host"))}
													{textField("httpupgradePath", t("path"))}
												</div>
											) : null}
											{network === "xhttp" ? (
												<div className="flex flex-col gap-4">
													<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
														{textField("xhttpHost", t("host"))}
														{textField("xhttpPath", t("path"))}
													</div>
													{formValues?.xhttpMode === "stream-up" || formValues?.xhttpMode === "stream-one"
														? switchRow("xhttpNoGRPCHeader", "No gRPC Header")
														: null}
													{formValues?.xhttpMode === "packet-up"
														? textField("xhttpScMinPostsIntervalMs", "Min Upload Interval (Ms)")
														: null}
													<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
														{textField("xhttpXmuxMaxConcurrency", "Max Concurrency")}
														{numberField("xhttpXmuxMaxConnections", "Max Connections")}
														{numberField("xhttpXmuxCMaxReuseTimes", "Max Reuse Times")}
														{textField("xhttpXmuxHMaxRequestTimes", "Max Request Times")}
														{textField("xhttpXmuxHMaxReusableSecs", "Max Reusable Secs")}
														{numberField("xhttpXmuxHKeepAlivePeriod", "Keep Alive Period")}
													</div>
												</div>
											) : null}
										</FormSection>
									) : null}

									{canAnySecurity ? (
										<FormSection title={t("pages.outbound.security")}>
											<FormField label={t("pages.outbound.security")}>
												<SegmentedControl<string>
													label={t("pages.outbound.security")}
													value={realityEnabled && canReality ? "reality" : tlsEnabled && canTls ? "tls" : "none"}
													options={[
														{ value: "none", label: t("userDialog.flow.none") },
														{ value: "tls", label: "TLS", disabled: !canTls },
														{ value: "reality", label: "Reality", disabled: !canReality },
													]}
													onChange={(next) => {
														const security = next as OutboundSecurityValue;
														setValue("tlsEnabled", security === "tls");
														setValue("realityEnabled", security === "reality");
														if (security !== "tls") {
															setValue("tlsServerName", "");
															setValue("tlsFingerprint", "");
															setValue("tlsAlpn", "");
															setValue("tlsEchConfigList", "");
															setValue("tlsPinnedPeerCertSha256", "");
															setValue("tlsVerifyPeerCertByName", "");
														}
														if (security !== "reality") {
															setValue("realityServerName", "");
															setValue("realityFingerprint", "");
															setValue("realityPublicKey", "");
															setValue("realityShortId", "");
															setValue("realitySpiderX", "");
															setValue("realityMldsa65Verify", "");
														}
													}}
												/>
											</FormField>
											{tlsEnabled && canTls ? (
												<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
													{textField("tlsServerName", "SNI", "example.com")}
													{selectField("tlsFingerprint", "uTLS", [{ value: "", label: t("userDialog.flow.none") }, ...TLS_FINGERPRINT_OPTIONS], t("userDialog.flow.none"))}
													{textField("tlsAlpn", "ALPN", TLS_ALPN_OPTIONS.join(","))}
													{textField("tlsEchConfigList", "ECH Config List")}
													{textField("tlsPinnedPeerCertSha256", "Certificate SHA-256 pin")}
													{textField("tlsVerifyPeerCertByName", "Verify certificate name", "example.com")}
												</div>
											) : null}
											{realityEnabled && canReality ? (
												<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
													{textField("realityServerName", "SNI")}
													{selectField("realityFingerprint", "uTLS", [{ value: "", label: t("userDialog.flow.none") }, ...TLS_FINGERPRINT_OPTIONS], t("userDialog.flow.none"))}
													{textField("realityPublicKey", t("pages.outbound.publicKey"))}
													{textField("realityShortId", t("pages.outbound.shortId"))}
													{textField("realitySpiderX", "SpiderX")}
													<FormField label="mldsa65 Verify" error={fieldError("realityMldsa65Verify")}>
														<Textarea rows={3} {...register("realityMldsa65Verify")} />
													</FormField>
												</div>
											) : null}
										</FormSection>
									) : null}

									{canMux ? (
										<FormSection title={t("pages.outbound.mux")}>
											{switchRow("muxEnabled", t("pages.outbound.enableMux"))}
											{muxEnabled ? (
												<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
													{numberField("muxConcurrency", t("pages.outbound.concurrency"))}
													{numberField("muxXudpConcurrency", "xudp Concurrency")}
													{selectField("muxXudpProxyUdp443", "xudp UDP 443", ["reject", "allow", "skip"], "reject")}
												</div>
											) : null}
										</FormSection>
									) : null}

									<FormSection title="Sockopt">
										{switchRow("sockoptEnabled", t("inbounds.sockopt.enable"))}
										{sockoptEnabled ? (
											<div className="flex flex-col gap-3">
												<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
													{switchRow("sockoptTcpFastOpen", t("inbounds.sockopt.tcpFastOpen"))}
													{switchRow("sockoptTcpMptcp", t("inbounds.sockopt.tcpMptcp"))}
													{switchRow("sockoptPenetrate", t("inbounds.sockopt.penetrate"))}
												</div>
												<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
													{textField("sockoptDialerProxy", t("inbounds.sockopt.dialerProxy"))}
													{numberField("sockoptTcpKeepAliveInterval", t("inbounds.sockopt.tcpKeepAliveInterval"))}
													{selectField("sockoptAddressPortStrategy", "Address Port Strategy", Object.values(Address_Port_Strategy), Address_Port_Strategy.NONE)}
												</div>
											</div>
										) : null}
									</FormSection>
								</div>
							</TabsContent>

							<TabsContent value="1" className="mt-0">
								<div className="flex flex-col gap-4">
									<div className="flex h-11 items-center overflow-hidden rounded-lg border bg-card/40">
										<span className="shrink-0 border-e px-3 text-sm font-medium text-muted-foreground">Link</span>
										<UiInput
											value={configInput}
											onChange={(event) => setConfigInput(event.target.value)}
											placeholder={t("pages.outbound.configPlaceholder")}
											spellCheck={false}
											className="h-full min-w-0 flex-1 border-0 bg-transparent px-3 font-mono text-sm shadow-none focus-visible:ring-0"
										/>
										<Button aria-label={t("pages.outbound.convertConfig")} onClick={handleConfigToJson} variant="ghost" size="sm" className={cn("size-8 p-0", "me-1")}>
											<SquarePen className="w-[17px]" />
										</Button>
									</div>
									<div className="h-[420px] overflow-hidden rounded-lg border">
										<JsonEditor json={jsonData} canonicalContext="outbound" onChange={handleJsonEditorChange} />
									</div>
									{jsonError ? <p className="text-sm text-red-500">{jsonError}</p> : null}
								</div>
							</TabsContent>

							<TabsContent value="2" className="mt-0">
								<PropagationTargets
									source={sourceTarget}
									section="outbounds"
									before={propagationBase}
									after={{ tag: currentTag }}
									selectedIds={targetIds}
									onChange={setTargetIds}
								/>
							</TabsContent>
						</div>
					</Tabs>

					<DialogFooter className="flex-row flex-wrap items-center justify-end gap-2 border-t px-5 py-3">
						<Button onClick={handleClose} variant="outline" size="sm">
							{t("cancel")}
						</Button>
						<Button type="submit" disabled={!isValid} size="sm">
							{mode === "edit" ? t("save") : t("add")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
};
