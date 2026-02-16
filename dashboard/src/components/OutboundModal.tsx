import {
	Box,
	Button,
	chakra,
	FormControl,
	FormLabel,
	HStack,
	IconButton,
	Input,
	Modal,
	ModalBody,
	ModalCloseButton,
	ModalContent,
	ModalFooter,
	ModalHeader,
	ModalOverlay,
	Select,
	Switch,
	Tab,
	TabList,
	TabPanel,
	TabPanels,
	Tabs,
	Text,
	Textarea,
	useColorModeValue,
	useToast,
	VStack,
} from "@chakra-ui/react";
import {
	MinusIcon as MinusIconOutline,
	PlusIcon,
} from "@heroicons/react/24/outline";
import {
	type FC,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import {
	ALPN_OPTION,
	GrpcStreamSettings,
	HttpUpgradeStreamSettings,
	KcpStreamSettings,
	MODE_OPTION,
	Mux,
	Outbound,
	Protocols,
	RealityStreamSettings,
	SSMethods,
	StreamSettings,
	TcpStreamSettings,
	TlsStreamSettings,
	UTLS_FINGERPRINT,
	WireguardDomainStrategy,
	WsStreamSettings,
	XHTTPStreamSettings,
} from "../utils/outbound";
import { JsonEditor } from "./JsonEditor";

const AddIcon = chakra(PlusIcon);
const MinusIcon = chakra(MinusIconOutline);

type ProtocolValue = (typeof Protocols)[keyof typeof Protocols];
type StreamNetworkValue =
	| "tcp"
	| "kcp"
	| "ws"
	| "grpc"
	| "httpupgrade"
	| "xhttp";
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
	password: string;
	user: string;
	pass: string;
	method: string;
	ssIvCheck: boolean;
	tlsEnabled: boolean;
	tlsServerName: string;
	tlsFingerprint: string;
	tlsAlpn: string;
	tlsAllowInsecure: boolean;
	tlsEchConfigList: string;
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
	vnextEncryption: string;
	dnsNetwork: string;
	dnsAddress: string;
	dnsPort: number;
	freedomStrategy: string;
	blackholeResponse: string;
	wireguardSecret: string;
	wireguardAddress: string;
	wireguardMtu: number;
	wireguardWorkers: number;
	wireguardDomainStrategy: string;
	wireguardReserved: string;
	wireguardNoKernelTun: boolean;
	wireguardPeers: WireguardPeerForm[];
}

interface OutboundModalProps {
	isOpen: boolean;
	onClose: () => void;
	mode: "create" | "edit";
	initialOutbound?: Record<string, unknown> | null;
	onSubmitOutbound: (outboundJson: unknown) => Promise<void> | void;
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
	password: "",
	user: "",
	pass: "",
	method: SSMethods.AES_128_GCM,
	ssIvCheck: false,
	tlsEnabled: false,
	tlsServerName: "",
	tlsFingerprint: "",
	tlsAlpn: "",
	tlsAllowInsecure: false,
	tlsEchConfigList: "",
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
	vnextEncryption: "auto",
	dnsNetwork: "udp",
	dnsAddress: "",
	dnsPort: 53,
	freedomStrategy: "",
	blackholeResponse: "",
	wireguardSecret: "",
	wireguardAddress: "",
	wireguardMtu: 1420,
	wireguardWorkers: 2,
	wireguardDomainStrategy: "",
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
				? { type: values.blackholeResponse }
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

	const security: OutboundSecurityValue = values.realityEnabled
		? "reality"
		: values.tlsEnabled
			? "tls"
			: "none";
	const streamSettings = new StreamSettings(values.network, security);

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

	if (values.tlsEnabled) {
		streamSettings.tls = new TlsStreamSettings(
			values.tlsServerName,
			splitComma(values.tlsAlpn),
			values.tlsFingerprint,
			values.tlsAllowInsecure,
			values.tlsEchConfigList,
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
	isOpen,
	onClose,
	mode,
	initialOutbound,
	onSubmitOutbound,
}) => {
	const { t } = useTranslation();
	const toast = useToast();
	const bgSubtle = useColorModeValue("gray.50", "whiteAlpha.100");
	const {
		control,
		register,
		reset,
		handleSubmit,
		watch,
		getValues,
		setValue,
		formState: { isValid },
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
	const network = watch("network");
	const tlsEnabled = watch("tlsEnabled");
	const realityEnabled = watch("realityEnabled");
	const tcpType = watch("tcpType");

	const muxEnabled = watch("muxEnabled");
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
		const stream = new StreamSettings(network ?? "tcp");
		const security: OutboundSecurityValue = realityEnabled
			? "reality"
			: tlsEnabled
				? "tls"
				: "none";
		stream.security = security;
		stream.network = network ?? "tcp";
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
		};

		const stream =
			outbound?.stream ?? json?.streamSettings ?? json?.stream ?? {};
		const streamRaw: any = stream;
		const streamSecurity =
			(streamRaw?.security as OutboundSecurityValue | undefined) ?? "none";
		mapped.network =
			(streamRaw?.network as OutboundFormValues["network"]) ??
			defaultValues.network;
		mapped.tlsEnabled = streamSecurity === "tls";
		mapped.realityEnabled = streamSecurity === "reality";
		const tlsSettings = streamRaw?.tls ?? streamRaw?.tlsSettings ?? {};
		mapped.tlsServerName = tlsSettings?.serverName ?? "";
		mapped.tlsFingerprint = tlsSettings?.fingerprint ?? "";
		mapped.tlsAlpn = Array.isArray(tlsSettings?.alpn)
			? tlsSettings.alpn.join(",")
			: "";
		mapped.tlsAllowInsecure = Boolean(tlsSettings?.allowInsecure);
		mapped.tlsEchConfigList = tlsSettings?.echConfigList ?? "";

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
			setValue("tlsAllowInsecure", false);
			setValue("tlsEchConfigList", "");
		}
	}, [canTls, setValue, tlsEnabled]);

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
			setJsonError(
				t("pages.outbound.configEmpty", "Please paste a config link"),
			);
			return;
		}
		const wg = parseWireguardIni(trimmed);
		if (wg) {
			const formatted = JSON.stringify(wg, null, 2);
			setConfigInput("");
			handleJsonEditorChange(formatted);
			toast({
				status: "success",
				duration: 2000,
				position: "top",
				title: t("pages.outbound.configConvertedTitle", "Config converted"),
				description: t(
					"pages.outbound.configConvertedDesc",
					"Configuration applied to the form.",
				),
			});
			return;
		}
		const outboundFromLink = Outbound.fromLink(trimmed);
		if (!outboundFromLink) {
			setJsonError(
				t("pages.outbound.invalidConfig", "Unsupported or invalid config link"),
			);
			toast({
				status: "error",
				duration: 2500,
				position: "top",
				title: t("pages.outbound.configParseFailedTitle", "Conversion failed"),
				description: t(
					"pages.outbound.configParseFailedDesc",
					"Could not parse the provided config link.",
				),
			});
			return;
		}
		const json = outboundFromLink.toJson();
		const formatted = JSON.stringify(json, null, 2);
		setConfigInput("");
		handleJsonEditorChange(formatted);
		toast({
			status: "success",
			duration: 2000,
			position: "top",
			title: t("pages.outbound.configConvertedTitle", "Config converted"),
			description: t(
				"pages.outbound.configConvertedDesc",
				"Configuration applied to the form.",
			),
		});
	};

	const onSubmit = handleSubmit(async (values) => {
		const outboundJson = buildOutboundJson(values);
		try {
			await onSubmitOutbound(outboundJson);
			toast({
				title:
					mode === "edit"
						? t("pages.xray.outbound.updated", "Outbound updated")
						: t("pages.xray.outbound.addOutbound"),
				status: "success",
				duration: 2000,
				position: "top",
			});
			onClose();
		} catch (error: any) {
			toast({
				title:
					error?.data?.detail ||
					error?.message ||
					t("pages.xray.outbound.saveFailed", "Unable to save outbound"),
				status: "error",
				duration: 3000,
				position: "top",
			});
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

	return (
		<Modal
			size="4xl"
			isOpen={isOpen}
			onClose={handleClose}
			scrollBehavior="inside"
		>
			<ModalOverlay bg="blackAlpha.400" backdropFilter="blur(8px)" />
			<ModalContent as="form" onSubmit={onSubmit}>
				<ModalHeader>
					{mode === "edit"
						? t("pages.xray.outbound.editOutbound", "Edit Outbound")
						: t("pages.xray.outbound.addOutbound")}
				</ModalHeader>
				<ModalCloseButton />
				<ModalBody>
					<Tabs
						variant="enclosed"
						colorScheme="primary"
						index={activeTab}
						onChange={handleTabChange}
					>
						<TabList>
							<Tab>{t("form")}</Tab>
							<Tab>{t("json")}</Tab>
						</TabList>
						<TabPanels>
							<TabPanel>
								<VStack spacing={6} align="stretch">
									<Box>
										<Text fontWeight="semibold" mb={3}>
											{t("pages.outbound.basicSettings", "Basic settings")}
										</Text>
										<VStack spacing={3} align="stretch">
											<FormControl isRequired>
												<FormLabel>{t("pages.xray.outbound.tag")}</FormLabel>
												<Input
													size="sm"
													placeholder="outbound-tag"
													{...register("tag", { required: requiredMessage })}
												/>
											</FormControl>
											<HStack>
												<FormControl isRequired>
													<FormLabel>{t("protocol")}</FormLabel>
													<Select size="sm" {...register("protocol")}>
														{protocolOptions.map((item) => (
															<option key={item} value={item}>
																{item}
															</option>
														))}
													</Select>
												</FormControl>
												<FormControl>
													<FormLabel>
														{t("pages.xray.outbound.sendThrough")}
													</FormLabel>
													<Input
														size="sm"
														placeholder="0.0.0.0"
														{...register("sendThrough")}
													/>
												</FormControl>
											</HStack>
										</VStack>
									</Box>

									{requiresEndpoint && (
										<Box>
											<Text fontWeight="semibold" mb={3}>
												{t("pages.outbound.endpoint", "Endpoint")}
											</Text>
											<VStack spacing={3} align="stretch">
												<FormControl isRequired={requiresEndpoint}>
													<FormLabel>
														{t("pages.outbound.address", "Address")}
													</FormLabel>
													<Input
														size="sm"
														placeholder="example.com"
														{...register("address", {
															required: requiresEndpoint
																? requiredMessage
																: false,
														})}
													/>
												</FormControl>
												<HStack
													flexWrap="wrap"
													spacing={3}
													alignItems="flex-end"
												>
													<FormControl isRequired={requiresEndpoint}>
														<FormLabel>
															{t("pages.outbound.port", "Port")}
														</FormLabel>
														<Input
															size="sm"
															type="number"
															min={1}
															max={65535}
															{...register("port", {
																required: requiresEndpoint
																	? requiredMessage
																	: false,
																valueAsNumber: true,
																min: { value: 1, message: invalidPortMessage },
																max: {
																	value: 65535,
																	message: invalidPortMessage,
																},
															})}
														/>
													</FormControl>
													{requiresId ? (
														<FormControl isRequired={requiresId}>
															<FormLabel>ID</FormLabel>
															<Input
																size="sm"
																placeholder="UUID"
																{...register("id", {
																	required: requiresId
																		? requiredMessage
																		: false,
																})}
															/>
														</FormControl>
													) : requiresPassword ? (
														<FormControl isRequired={requiresPassword}>
															<FormLabel>{t("password")}</FormLabel>
															<Input
																size="sm"
																placeholder="password"
																{...register("password", {
																	required: requiresPassword
																		? requiredMessage
																		: false,
																})}
															/>
														</FormControl>
													) : supportsUserPass ? (
														<HStack flex="1" spacing={3} flexWrap="wrap">
															<FormControl minW="180px">
																<FormLabel>{t("username")}</FormLabel>
																<Input
																	size="sm"
																	placeholder="username"
																	{...register("user")}
																/>
															</FormControl>
															<FormControl minW="180px">
																<FormLabel>{t("password")}</FormLabel>
																<Input
																	size="sm"
																	placeholder="password"
																	{...register("pass")}
																/>
															</FormControl>
														</HStack>
													) : (
														<FormControl>
															<FormLabel>{t("username")}</FormLabel>
															<Input
																size="sm"
																placeholder="username"
																{...register("user")}
															/>
														</FormControl>
													)}
												</HStack>
												{typedProtocol === Protocols.Shadowsocks && (
													<>
														<FormControl isRequired={requiresMethod}>
															<FormLabel>
																{t("pages.outbound.method", "Method")}
															</FormLabel>
															<Select
																size="sm"
																{...register("method", {
																	required: requiresMethod
																		? requiredMessage
																		: false,
																})}
															>
																{Object.values(SSMethods).map((method) => (
																	<option key={method} value={method}>
																		{method}
																	</option>
																))}
															</Select>
														</FormControl>
														<FormControl
															display="flex"
															alignItems="center"
															gap={2}
														>
															<Switch size="sm" {...register("ssIvCheck")} />
															<FormLabel mb="0">
																{t("pages.outbound.ivCheck", "Enable IV Check")}
															</FormLabel>
														</FormControl>
													</>
												)}
												{typedProtocol === Protocols.VLESS && (
													<>
														<FormControl>
															<FormLabel>
																{t("pages.outbound.encryption", "Encryption")}
															</FormLabel>
															<Input
																size="sm"
																placeholder="none"
																{...register("encryption")}
															/>
														</FormControl>
														{canTlsFlow && (
															<FormControl>
																<FormLabel>Flow</FormLabel>
																<Input
																	size="sm"
																	placeholder="xtls-rprx-vision"
																	{...register("flow")}
																/>
															</FormControl>
														)}
													</>
												)}
												{typedProtocol === Protocols.VMess && (
													<FormControl>
														<FormLabel>
															{t("pages.outbound.security", "User security")}
														</FormLabel>
														<Input
															size="sm"
															placeholder="auto"
															{...register("vnextEncryption")}
														/>
													</FormControl>
												)}
											</VStack>
										</Box>
									)}

									{typedProtocol === Protocols.DNS && (
										<Box>
											<Text fontWeight="semibold" mb={3}>
												{t("pages.outbound.dnsSettings", "DNS settings")}
											</Text>
											<HStack>
												<FormControl>
													<FormLabel>{t("pages.outbound.network")}</FormLabel>
													<Select size="sm" {...register("dnsNetwork")}>
														<option value="udp">udp</option>
														<option value="tcp">tcp</option>
													</Select>
												</FormControl>
												<FormControl isRequired={requiresDnsServer}>
													<FormLabel>{t("pages.outbound.port")}</FormLabel>
													<Input
														size="sm"
														type="number"
														min={1}
														max={65535}
														{...register("dnsPort", {
															required: requiresDnsServer
																? requiredMessage
																: false,
															valueAsNumber: true,
															min: { value: 1, message: invalidPortMessage },
															max: {
																value: 65535,
																message: invalidPortMessage,
															},
														})}
													/>
												</FormControl>
											</HStack>
											<FormControl mt={3} isRequired={requiresDnsServer}>
												<FormLabel>{t("pages.outbound.address")}</FormLabel>
												<Input
													size="sm"
													placeholder="8.8.8.8"
													{...register("dnsAddress", {
														required: requiresDnsServer
															? requiredMessage
															: false,
													})}
												/>
											</FormControl>
										</Box>
									)}

									{typedProtocol === Protocols.Freedom && (
										<Box>
											<Text fontWeight="semibold" mb={3}>
												{t("pages.outbound.freedom", "Freedom options")}
											</Text>
											<FormControl>
												<FormLabel>
													{t("pages.outbound.strategy", "Strategy")}
												</FormLabel>
												<Input
													size="sm"
													placeholder="UseIP"
													{...register("freedomStrategy")}
												/>
											</FormControl>
										</Box>
									)}

									{typedProtocol === Protocols.Blackhole && (
										<Box>
											<Text fontWeight="semibold" mb={3}>
												{t("pages.outbound.blackhole", "Blackhole options")}
											</Text>
											<FormControl>
												<FormLabel>{t("pages.outbound.response")}</FormLabel>
												<Input
													size="sm"
													placeholder="none"
													{...register("blackholeResponse")}
												/>
											</FormControl>
										</Box>
									)}

									{typedProtocol === Protocols.Wireguard && (
										<Box>
											<Text fontWeight="semibold" mb={3}>
												{t("pages.outbound.wireguard", "Wireguard")}
											</Text>
											<VStack spacing={3} align="stretch">
												<FormControl>
													<FormLabel>
														{t("pages.outbound.secretKey", "Secret key")}
													</FormLabel>
													<Input size="sm" {...register("wireguardSecret")} />
												</FormControl>
												<FormControl>
													<FormLabel>{t("pages.outbound.address")}</FormLabel>
													<Input
														size="sm"
														placeholder="10.0.0.1/32"
														{...register("wireguardAddress")}
													/>
												</FormControl>
												<HStack align="flex-end">
													<FormControl>
														<FormLabel>MTU</FormLabel>
														<Input
															size="sm"
															type="number"
															{...register("wireguardMtu", {
																valueAsNumber: true,
															})}
														/>
													</FormControl>
													<FormControl>
														<FormLabel>Workers</FormLabel>
														<Input
															size="sm"
															type="number"
															{...register("wireguardWorkers", {
																valueAsNumber: true,
															})}
														/>
													</FormControl>
												</HStack>
												<FormControl>
													<FormLabel>Domain Strategy</FormLabel>
													<Select
														size="sm"
														{...register("wireguardDomainStrategy")}
													>
														<option value="">{t("common.none", "None")}</option>
														{WireguardDomainStrategy.map((strategy) => (
															<option key={strategy} value={strategy}>
																{strategy}
															</option>
														))}
													</Select>
												</FormControl>
												<FormControl>
													<FormLabel>Reserved</FormLabel>
													<Input
														size="sm"
														placeholder="1,2,3"
														{...register("wireguardReserved")}
													/>
												</FormControl>
												<FormControl display="flex" alignItems="center" gap={2}>
													<Switch
														size="sm"
														{...register("wireguardNoKernelTun")}
													/>
													<FormLabel mb="0">No Kernel Tun</FormLabel>
												</FormControl>
												<VStack spacing={3} align="stretch">
													<HStack justify="space-between">
														<Text fontWeight="semibold">
															{t("pages.outbound.peer", "Peers")}
														</Text>
														<IconButton
															size="sm"
															aria-label={t("add")}
															icon={<AddIcon boxSize={3} />}
															onClick={() =>
																append({
																	publicKey: "",
																	allowedIPs: "0.0.0.0/0,::/0",
																	endpoint: "",
																	keepAlive: 0,
																	presharedKey: "",
																})
															}
														/>
													</HStack>
													{fields.map((field, index) => (
														<Box
															key={field.id}
															borderWidth="1px"
															borderRadius="md"
															p={3}
															bg={bgSubtle}
														>
															<HStack>
																<FormControl>
																	<FormLabel>
																		{t(
																			"pages.outbound.publicKey",
																			"Public key",
																		)}
																	</FormLabel>
																	<Input
																		size="sm"
																		{...register(
																			`wireguardPeers.${index}.publicKey` as const,
																		)}
																	/>
																</FormControl>
																{fields.length > 1 && (
																	<IconButton
																		mt={6}
																		size="sm"
																		aria-label={t("delete")}
																		icon={<MinusIcon boxSize={3} />}
																		onClick={() => remove(index)}
																	/>
																)}
															</HStack>
															<HStack mt={2}>
																<FormControl>
																	<FormLabel>
																		{t(
																			"pages.outbound.allowedIPs",
																			"Allowed IPs",
																		)}
																	</FormLabel>
																	<Input
																		size="sm"
																		{...register(
																			`wireguardPeers.${index}.allowedIPs` as const,
																		)}
																	/>
																</FormControl>
																<FormControl>
																	<FormLabel>
																		{t("pages.outbound.endpoint", "Endpoint")}
																	</FormLabel>
																	<Input
																		size="sm"
																		{...register(
																			`wireguardPeers.${index}.endpoint` as const,
																		)}
																	/>
																</FormControl>
															</HStack>
															<FormControl mt={2}>
																<FormLabel>
																	{t("pages.outbound.keepAlive", "Keep alive")}
																</FormLabel>
																<Input
																	size="sm"
																	type="number"
																	{...register(
																		`wireguardPeers.${index}.keepAlive` as const,
																		{ valueAsNumber: true },
																	)}
																/>
															</FormControl>
															<FormControl mt={2}>
																<FormLabel>
																	{t(
																		"pages.outbound.presharedKey",
																		"Preshared key",
																	)}
																</FormLabel>
																<Input
																	size="sm"
																	{...register(
																		`wireguardPeers.${index}.presharedKey` as const,
																	)}
																/>
															</FormControl>
														</Box>
													))}
												</VStack>
											</VStack>
										</Box>
									)}

									{canStream && (
										<Box>
											<Text fontWeight="semibold" mb={3}>
												{t("pages.outbound.transport", "Transport")}
											</Text>
											<VStack spacing={3} align="stretch">
												<FormControl>
													<FormLabel>{t("pages.outbound.network")}</FormLabel>
													<Select size="sm" {...register("network")}>
														{streamNetworkOptions.map((networkOption) => (
															<option key={networkOption} value={networkOption}>
																{networkOption}
															</option>
														))}
													</Select>
												</FormControl>
												{network === "tcp" && (
													<HStack>
														<FormControl>
															<FormLabel>
																{t("pages.outbound.tcpHeader", "Header")}
															</FormLabel>
															<Select size="sm" {...register("tcpType")}>
																<option value="none">none</option>
																<option value="http">http</option>
															</Select>
														</FormControl>
														{tcpType === "http" && (
															<>
																<FormControl>
																	<FormLabel>{t("host")}</FormLabel>
																	<Input size="sm" {...register("tcpHost")} />
																</FormControl>
																<FormControl>
																	<FormLabel>{t("path")}</FormLabel>
																	<Input size="sm" {...register("tcpPath")} />
																</FormControl>
															</>
														)}
													</HStack>
												)}
												{network === "kcp" && (
													<HStack>
														<FormControl>
															<FormLabel>
																{t("pages.outbound.kcpHeader", "mKCP header")}
															</FormLabel>
															<Select size="sm" {...register("kcpType")}>
																{KCP_HEADER_TYPE_OPTIONS.map((headerType) => (
																	<option key={headerType} value={headerType}>
																		{headerType}
																	</option>
																))}
															</Select>
														</FormControl>
														<FormControl>
															<FormLabel>
																{t("pages.outbound.kcpSeed", "mKCP seed")}
															</FormLabel>
															<Input size="sm" {...register("kcpSeed")} />
														</FormControl>
													</HStack>
												)}
												{network === "ws" && (
													<HStack>
														<FormControl>
															<FormLabel>{t("host")}</FormLabel>
															<Input size="sm" {...register("wsHost")} />
														</FormControl>
														<FormControl>
															<FormLabel>{t("path")}</FormLabel>
															<Input size="sm" {...register("wsPath")} />
														</FormControl>
													</HStack>
												)}
												{network === "grpc" && (
													<>
														<HStack>
															<FormControl>
																<FormLabel>{t("serviceName")}</FormLabel>
																<Input
																	size="sm"
																	{...register("grpcServiceName")}
																/>
															</FormControl>
															<FormControl>
																<FormLabel>Authority</FormLabel>
																<Input
																	size="sm"
																	{...register("grpcAuthority")}
																/>
															</FormControl>
														</HStack>
														<FormControl
															display="flex"
															alignItems="center"
															gap={2}
														>
															<Switch
																size="sm"
																{...register("grpcMultiMode")}
															/>
															<FormLabel mb="0">
																{t("pages.outbound.multiMode", "Multi mode")}
															</FormLabel>
														</FormControl>
													</>
												)}
												{network === "httpupgrade" && (
													<HStack>
														<FormControl>
															<FormLabel>{t("host")}</FormLabel>
															<Input
																size="sm"
																{...register("httpupgradeHost")}
															/>
														</FormControl>
														<FormControl>
															<FormLabel>{t("path")}</FormLabel>
															<Input
																size="sm"
																{...register("httpupgradePath")}
															/>
														</FormControl>
													</HStack>
												)}
												{network === "xhttp" && (
													<VStack spacing={3} align="stretch">
														<HStack>
															<FormControl>
																<FormLabel>{t("host")}</FormLabel>
																<Input size="sm" {...register("xhttpHost")} />
															</FormControl>
															<FormControl>
																<FormLabel>{t("path")}</FormLabel>
																<Input size="sm" {...register("xhttpPath")} />
															</FormControl>
														</HStack>
														<FormControl>
															<FormLabel>Mode</FormLabel>
															<Select size="sm" {...register("xhttpMode")}>
																<option value="">
																	{t("common.none", "None")}
																</option>
																{XHTTP_MODE_OPTIONS.map((modeOption) => (
																	<option key={modeOption} value={modeOption}>
																		{modeOption}
																	</option>
																))}
															</Select>
														</FormControl>
														{(formValues?.xhttpMode === "stream-up" ||
															formValues?.xhttpMode === "stream-one") && (
															<FormControl
																display="flex"
																alignItems="center"
																gap={2}
															>
																<Switch
																	size="sm"
																	{...register("xhttpNoGRPCHeader")}
																/>
																<FormLabel mb="0">No gRPC Header</FormLabel>
															</FormControl>
														)}
														{formValues?.xhttpMode === "packet-up" && (
															<FormControl>
																<FormLabel>Min Upload Interval (Ms)</FormLabel>
																<Input
																	size="sm"
																	{...register("xhttpScMinPostsIntervalMs")}
																/>
															</FormControl>
														)}
														<HStack>
															<FormControl>
																<FormLabel>Max Concurrency</FormLabel>
																<Input
																	size="sm"
																	{...register("xhttpXmuxMaxConcurrency")}
																/>
															</FormControl>
															<FormControl>
																<FormLabel>Max Connections</FormLabel>
																<Input
																	size="sm"
																	type="number"
																	{...register("xhttpXmuxMaxConnections", {
																		valueAsNumber: true,
																	})}
																/>
															</FormControl>
														</HStack>
														<HStack>
															<FormControl>
																<FormLabel>Max Reuse Times</FormLabel>
																<Input
																	size="sm"
																	type="number"
																	{...register("xhttpXmuxCMaxReuseTimes", {
																		valueAsNumber: true,
																	})}
																/>
															</FormControl>
															<FormControl>
																<FormLabel>Max Request Times</FormLabel>
																<Input
																	size="sm"
																	{...register("xhttpXmuxHMaxRequestTimes")}
																/>
															</FormControl>
														</HStack>
														<HStack>
															<FormControl>
																<FormLabel>Max Reusable Secs</FormLabel>
																<Input
																	size="sm"
																	{...register("xhttpXmuxHMaxReusableSecs")}
																/>
															</FormControl>
															<FormControl>
																<FormLabel>Keep Alive Period</FormLabel>
																<Input
																	size="sm"
																	type="number"
																	{...register("xhttpXmuxHKeepAlivePeriod", {
																		valueAsNumber: true,
																	})}
																/>
															</FormControl>
														</HStack>
													</VStack>
												)}
											</VStack>
										</Box>
									)}

									{canAnySecurity && (
										<Box>
											<Text fontWeight="semibold" mb={3}>
												{t("pages.outbound.security")}
											</Text>
											<FormControl maxW="260px">
												<FormLabel mb={1}>
													{t("pages.outbound.security")}
												</FormLabel>
												<Select
													size="sm"
													value={
														realityEnabled && canReality
															? "reality"
															: tlsEnabled && canTls
																? "tls"
																: "none"
													}
													onChange={(event) => {
														const next = event.target
															.value as OutboundSecurityValue;
														setValue("tlsEnabled", next === "tls");
														setValue("realityEnabled", next === "reality");
														if (next !== "tls") {
															setValue("tlsServerName", "");
															setValue("tlsFingerprint", "");
															setValue("tlsAlpn", "");
															setValue("tlsAllowInsecure", false);
															setValue("tlsEchConfigList", "");
														}
														if (next !== "reality") {
															setValue("realityServerName", "");
															setValue("realityFingerprint", "");
															setValue("realityPublicKey", "");
															setValue("realityShortId", "");
															setValue("realitySpiderX", "");
															setValue("realityMldsa65Verify", "");
														}
													}}
												>
													<option value="none">
														{t("common.none", "None")}
													</option>
													<option value="tls" disabled={!canTls}>
														TLS
													</option>
													<option value="reality" disabled={!canReality}>
														Reality
													</option>
												</Select>
											</FormControl>
											{tlsEnabled && canTls && (
												<VStack spacing={3} align="stretch" mt={3}>
													<FormControl>
														<FormLabel>SNI</FormLabel>
														<Input
															size="sm"
															placeholder="example.com"
															{...register("tlsServerName")}
														/>
													</FormControl>
													<FormControl>
														<FormLabel>uTLS</FormLabel>
														<Select size="sm" {...register("tlsFingerprint")}>
															<option value="">
																{t("common.none", "None")}
															</option>
															{TLS_FINGERPRINT_OPTIONS.map(
																(fingerprintOption) => (
																	<option
																		key={fingerprintOption}
																		value={fingerprintOption}
																	>
																		{fingerprintOption}
																	</option>
																),
															)}
														</Select>
													</FormControl>
													<FormControl>
														<FormLabel>ALPN</FormLabel>
														<Input
															size="sm"
															placeholder={TLS_ALPN_OPTIONS.join(",")}
															{...register("tlsAlpn")}
														/>
													</FormControl>
													<FormControl>
														<FormLabel>ECH Config List</FormLabel>
														<Input
															size="sm"
															{...register("tlsEchConfigList")}
														/>
													</FormControl>
													<FormControl
														display="flex"
														alignItems="center"
														gap={2}
													>
														<Switch
															size="sm"
															{...register("tlsAllowInsecure")}
														/>
														<FormLabel mb="0">Allow Insecure</FormLabel>
													</FormControl>
												</VStack>
											)}
											{realityEnabled && canReality && (
												<VStack spacing={3} align="stretch" mt={3}>
													<FormControl>
														<FormLabel>SNI</FormLabel>
														<Input
															size="sm"
															{...register("realityServerName")}
														/>
													</FormControl>
													<FormControl>
														<FormLabel>uTLS</FormLabel>
														<Select
															size="sm"
															{...register("realityFingerprint")}
														>
															<option value="">
																{t("common.none", "None")}
															</option>
															{TLS_FINGERPRINT_OPTIONS.map(
																(fingerprintOption) => (
																	<option
																		key={fingerprintOption}
																		value={fingerprintOption}
																	>
																		{fingerprintOption}
																	</option>
																),
															)}
														</Select>
													</FormControl>
													<FormControl>
														<FormLabel>
															{t("pages.outbound.publicKey")}
														</FormLabel>
														<Input
															size="sm"
															{...register("realityPublicKey")}
														/>
													</FormControl>
													<FormControl>
														<FormLabel>{t("pages.outbound.shortId")}</FormLabel>
														<Input size="sm" {...register("realityShortId")} />
													</FormControl>
													<FormControl>
														<FormLabel>SpiderX</FormLabel>
														<Input size="sm" {...register("realitySpiderX")} />
													</FormControl>
													<FormControl>
														<FormLabel>mldsa65 Verify</FormLabel>
														<Textarea
															size="sm"
															rows={3}
															{...register("realityMldsa65Verify")}
														/>
													</FormControl>
												</VStack>
											)}
										</Box>
									)}

									{canMux && (
										<Box>
											<Text fontWeight="semibold" mb={3}>
												{t("pages.outbound.mux")}
											</Text>
											<FormControl display="flex" alignItems="center">
												<FormLabel mb="0">
													{t("pages.outbound.enableMux")}
												</FormLabel>
												<Switch size="sm" {...register("muxEnabled")} />
											</FormControl>
											{muxEnabled && (
												<VStack align="stretch" spacing={3} mt={3}>
													<FormControl>
														<FormLabel>
															{t("pages.outbound.concurrency")}
														</FormLabel>
														<Input
															size="sm"
															type="number"
															{...register("muxConcurrency", {
																valueAsNumber: true,
															})}
														/>
													</FormControl>
													<FormControl>
														<FormLabel>xudp Concurrency</FormLabel>
														<Input
															size="sm"
															type="number"
															{...register("muxXudpConcurrency", {
																valueAsNumber: true,
															})}
														/>
													</FormControl>
													<FormControl>
														<FormLabel>xudp UDP 443</FormLabel>
														<Select
															size="sm"
															{...register("muxXudpProxyUdp443")}
														>
															<option value="reject">reject</option>
															<option value="allow">allow</option>
															<option value="skip">skip</option>
														</Select>
													</FormControl>
												</VStack>
											)}
										</Box>
									)}
								</VStack>
							</TabPanel>
							<TabPanel>
								<VStack align="stretch" spacing={3}>
									<FormControl>
										<FormLabel>
											{t("pages.outbound.configToJson", "Config to JSON")}
										</FormLabel>
										<HStack align="start" spacing={3}>
											<Textarea
												value={configInput}
												onChange={(e) => setConfigInput(e.target.value)}
												placeholder={t(
													"pages.outbound.configPlaceholder",
													"Paste vmess/vless/trojan/ss link here",
												)}
												rows={3}
												fontFamily="mono"
												fontSize="sm"
												spellCheck={false}
												flex="1"
											/>
											<Button
												size="sm"
												colorScheme="primary"
												onClick={handleConfigToJson}
											>
												{t("pages.outbound.convertConfig", "Convert")}
											</Button>
										</HStack>
									</FormControl>
									<Box height="420px">
										<JsonEditor
											json={jsonData}
											onChange={handleJsonEditorChange}
										/>
									</Box>
									{jsonError && (
										<Text fontSize="sm" color="red.500">
											{jsonError}
										</Text>
									)}
								</VStack>
							</TabPanel>
						</TabPanels>
					</Tabs>
				</ModalBody>
				<ModalFooter gap={3}>
					<Button variant="outline" onClick={handleClose}>
						{t("cancel")}
					</Button>
					<Button colorScheme="primary" type="submit" isDisabled={!isValid}>
						{mode === "edit" ? t("save") : t("add")}
					</Button>
				</ModalFooter>
			</ModalContent>
		</Modal>
	);
};
