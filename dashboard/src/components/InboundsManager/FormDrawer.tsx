import { Field, FieldDescription, FieldError, FieldLabel } from "components/ui/field";
import { Input } from "components/ui/input";
import { Textarea } from "components/ui/textarea";
import { Switch } from "components/ui/switch";
import { Button } from "components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "components/ui/alert";
import { Checkbox } from "components/ui/checkbox";
import { Collapsible, CollapsibleContent } from "components/ui/collapsible";
import { RadioGroup, RadioGroupItem } from "components/ui/radio-group";
import { NativeSelect } from "components/ui/native-select";
import { Tooltip, TooltipContent, TooltipTrigger } from "components/ui/tooltip";
import { Badge } from "components/ui/badge";
import { toast } from "components/ui/sonner";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";


import { FieldHint } from "components/ui/field-hint";
import { NumberField } from "components/ui/number-field";
import { SegmentedControl } from "components/ui/segmented-control";
import { InboundSectionNav } from "./InboundSectionNav";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "components/ui/dialog";
import { inboundEntityPage } from "components/entityPage/EntityOverviews";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "components/ui/tabs";
import { buttonVariants } from "components/ui/button";
import { Loader2, Network, Plus, RefreshCw, Sparkles } from "lucide-react";
import type { ComponentProps, ComponentPropsWithoutRef } from "react";
import { cn } from "lib/cn";

import { JsonEditor } from "components/JsonEditor";
import { SearchableTagSelect } from "components/common/SearchableTagSelect";
import { shadowsocksMethods } from "constants/Proxies";
import type { CoreConfigTarget } from "contexts/CoreSettingsContext";
import {
	type FC,
	forwardRef,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { type Control, Controller, type Path, useFieldArray, useForm, useWatch } from "react-hook-form";
import { EmojiShortcodeInput } from "components/common/EmojiShortcodeInput";
import { useTranslation } from "react-i18next";
import { canViewEntityNotes, type EntityNote } from "components/EntityNotePanel";
import useGetUser from "hooks/useGetUser";
import { fetch as apiFetch } from "service/http";
import {
	generateAnyConnectSelfSigned,
	generateEchCert,
	generateOVSelfSigned,
	generateWGKeypair,
	generateMldsa65,
	generateRealityKeypair,
	generateRealityShortId,
	getVlessEncAuthBlocks,
	type VlessEncAuthBlock,
} from "service/xray";
import { useQuery } from "@tanstack/react-query";
import {
	getSubscriptionSettings,
	type SubscriptionSettingsBundle,
} from "service/settings";
import {
	buildInboundPayload,
	createDefaultHysteriaUdpMask,
	createDefaultInboundForm,
	createDefaultTlsCertificate,
	type InboundFormValues,
	protocolOptions,
	type RawInbound,
	rawInboundToFormValues,
	type SockoptFormValues,
	shadowsocksNetworkOptions,
	sniffingOptions,
	streamNetworks,
	streamSecurityOptions,
	tlsAlpnOptions,
	tlsCipherOptions,
	tlsFingerprintOptions,
	tlsUsageOptions,
	tlsVersionOptions,
	inboundPortNumbers,
	inboundTagAllowsEmoji,
	supportsMultiplePorts,
	parseHeaderPairs,
	validateInboundFormFields,
	validateInboundFormValues,
} from "utils/inbounds";
import {
	getCustomNodeTargetIds,
	sortInboundTargets,
} from "utils/inboundTargets";
import { DeleteConfirmDialog } from "../dialogs/ConfirmDialog";

const FormLabel = ({ helpKey, className, children, ...props }: ComponentPropsWithoutRef<typeof FieldLabel> & { helpKey?: string }) => {
	const { t } = useTranslation();
	return (
		<FieldLabel {...props} className={cn("font-semibold after:content-none", className)}>
			<span className="inline-flex items-center gap-1.5">
				{children}
				{helpKey ? <FieldHint>{t(helpKey)}</FieldHint> : null}
			</span>
		</FieldLabel>
	);
};

const FormControl = ({ className, isInvalid, isRequired, required, ...props }: ComponentPropsWithoutRef<typeof Field> & { isInvalid?: boolean; isRequired?: boolean; required?: boolean }) => {
	const classes = (className ?? "").split(/\s+/);
	const isToggleRow = classes.includes("flex") && classes.includes("items-center");
	return (
		<Field {...props} onClick={(event) => { props.onClick?.(event); const target = event.target as HTMLElement; if (isToggleRow && target.closest("label") && !target.closest("button, input")) event.currentTarget.querySelector<HTMLElement>("[role='switch']")?.click(); }} data-invalid={isInvalid || undefined} className={cn(isToggleRow && "flex flex-row items-center justify-between gap-4 rounded-lg border bg-card/40 px-3 py-2.5", className)} />
	);
};

const FormNumberField = ({
	control,
	name,
	rules,
	...props
}: Omit<ComponentProps<typeof NumberField>, "value" | "onChange" | "doneLabel"> & {
	control: Control<InboundFormValues>;
	name: Path<InboundFormValues>;
	rules?: { required?: boolean };
}) => {
	const { t } = useTranslation();
	return (
		<Controller
			control={control}
			name={name}
			rules={rules}
			render={({ field }) => (
				<NumberField
					{...props}
					value={field.value === undefined || field.value === null ? "" : String(field.value)}
					onChange={field.onChange}
					doneLabel={t("common.done")}
				/>
			)}
		/>
	);
};

type Props = {
	open: boolean;
	mode: "create" | "edit" | "clone";
	initialValue: RawInbound | null;
	isSubmitting: boolean;
	existingInbounds: RawInbound[];
	configTargets: CoreConfigTarget[];
	onClose: () => void;
	onSubmit: (values: InboundFormValues) => Promise<void>;
	onDelete?: () => void;
	onClone?: () => void;
	isDeleting?: boolean;
};

const formatRealityKeyForDisplay = (value?: string | null) =>
	(value ?? "").replace(/\s+/g, "").replace(/=+$/, "");

const DOMAIN_STRATEGY_OPTIONS = [
	"AsIs",
	"UseIP",
	"UseIPv6v4",
	"UseIPv6",
	"UseIPv4v6",
	"UseIPv4",
	"ForceIP",
	"ForceIPv6v4",
	"ForceIPv6",
	"ForceIPv4v6",
	"ForceIPv4",
];
const VLESS_FLOW_OPTIONS = ["xtls-rprx-vision"];
const TCP_CONGESTION_OPTIONS = ["bbr", "cubic", "reno"];
const TPROXY_OPTIONS: Array<"" | "off" | "redirect" | "tproxy"> = [
	"off",
	"redirect",
	"tproxy",
];
const TLS_COMPATIBLE_PROTOCOLS: Array<InboundFormValues["protocol"]> = [
	"vmess",
	"vless",
	"trojan",
	"shadowsocks",
	"hysteria",
];
const TLS_COMPATIBLE_NETWORKS: Array<InboundFormValues["streamNetwork"]> = [
	"tcp",
	"ws",
	"http",
	"grpc",
	"httpupgrade",
	"xhttp",
	"hysteria",
];
const REALITY_COMPATIBLE_PROTOCOLS: Array<InboundFormValues["protocol"]> = [
	"vless",
	"trojan",
];
const REALITY_COMPATIBLE_NETWORKS: Array<InboundFormValues["streamNetwork"]> = [
	"tcp",
	"http",
	"grpc",
	"xhttp",
];
const XHTTP_MODE_OPTIONS: Array<InboundFormValues["xhttpMode"]> = [
	"auto",
	"packet-up",
	"stream-up",
	"stream-one",
];
const XHTTP_PADDING_PLACEMENT_OPTIONS = [
	"queryInHeader",
	"query",
	"header",
	"cookie",
];
const XHTTP_PADDING_METHOD_OPTIONS = ["repeat-x", "tokenish"];
const XHTTP_SESSION_PLACEMENT_OPTIONS = ["path", "query", "header", "cookie"];
const XHTTP_SEQ_PLACEMENT_OPTIONS = ["path", "query", "header", "cookie"];
const XHTTP_UPLINK_DATA_PLACEMENT_OPTIONS = [
	"auto",
	"body",
	"header",
	"cookie",
];
const HYSTERIA_QUIC_INPUT_FIELDS = [
	{
		name: "maxIdleTimeout",
		label: "Max idle timeout",
		placeholder: "30",
	},
	{
		name: "keepAlivePeriod",
		label: "Keep alive period",
		placeholder: "10",
	},
	{
		name: "maxIncomingStreams",
		label: "Max incoming streams",
		placeholder: "1024",
	},
	{
		name: "initStreamReceiveWindow",
		label: "Initial stream receive window",
		placeholder: "8388608",
	},
	{
		name: "maxStreamReceiveWindow",
		label: "Max stream receive window",
		placeholder: "8388608",
	},
	{
		name: "initConnectionReceiveWindow",
		label: "Initial connection receive window",
		placeholder: "20971520",
	},
	{
		name: "maxConnectionReceiveWindow",
		label: "Max connection receive window",
		placeholder: "20971520",
	},
] as const;
const REALITY_TARGETS = [
	{ target: "www.icloud.com:443", sni: "www.icloud.com,icloud.com" },
	{ target: "www.apple.com:443", sni: "www.apple.com,apple.com" },
	{ target: "www.tesla.com:443", sni: "www.tesla.com,tesla.com" },
	{ target: "www.sony.com:443", sni: "www.sony.com,sony.com" },
	{ target: "www.nvidia.com:443", sni: "www.nvidia.com,nvidia.com" },
	{ target: "www.amd.com:443", sni: "www.amd.com,amd.com" },
	{
		target: "azure.microsoft.com:443",
		sni: "azure.microsoft.com,www.azure.com",
	},
	{ target: "aws.amazon.com:443", sni: "aws.amazon.com,amazon.com" },
	{ target: "www.bing.com:443", sni: "www.bing.com,bing.com" },
	{ target: "www.oracle.com:443", sni: "www.oracle.com,oracle.com" },
	{ target: "www.intel.com:443", sni: "www.intel.com,intel.com" },
	{ target: "www.microsoft.com:443", sni: "www.microsoft.com,microsoft.com" },
	{ target: "www.amazon.com:443", sni: "www.amazon.com,amazon.com" },
];
const REALITY_SHORT_ID_LENGTHS = [2, 4, 6, 8, 10, 12, 14, 16];

// TS 7 (lib.dom) wants an ArrayBuffer-backed view for getRandomValues.
const fillRandomValues = (buffer: Uint8Array<ArrayBuffer>) => {
	if (globalThis.crypto?.getRandomValues) {
		globalThis.crypto.getRandomValues(buffer);
		return;
	}
	for (let i = 0; i < buffer.length; i += 1) {
		buffer[i] = Math.floor(Math.random() * 256);
	}
};

const randomHex = (length: number): string => {
	const bytes = new Uint8Array(Math.ceil(length / 2));
	fillRandomValues(bytes);
	const hex = Array.from(bytes, (value) =>
		value.toString(16).padStart(2, "0"),
	).join("");
	return hex.slice(0, length);
};

const randomLowerAndNum = (length: number): string => {
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
	const bytes = new Uint8Array(length);
	fillRandomValues(bytes);
	return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
};

const utf8ToHex = (value: string): string =>
	Array.from(new TextEncoder().encode(value), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");

const shuffleArray = <T,>(values: T[]): T[] => {
	const array = [...values];
	for (let i = array.length - 1; i > 0; i -= 1) {
		const j = Math.floor(Math.random() * (i + 1));
		[array[i], array[j]] = [array[j], array[i]];
	}
	return array;
};

const generateRandomShortIds = (): string =>
	shuffleArray(REALITY_SHORT_ID_LENGTHS)
		.map((length) => randomHex(length))
		.join(",");

const getRandomRealityTarget = () => {
	if (!REALITY_TARGETS.length) {
		return null;
	}
	const index = Math.floor(Math.random() * REALITY_TARGETS.length);
	return REALITY_TARGETS[index];
};

export const InboundFormModal: FC<Props> = ({
	open: isOpen,
	mode,
	initialValue,
	isSubmitting,
	existingInbounds,
	configTargets,
	onClose,
	onSubmit,
	onDelete,
	onClone,
	isDeleting,
}) => {
	const { t } = useTranslation();
	
	const ovLabel = (
		labelKey: string,
		labelFallback: string,
		helpKey: string,
		helpFallback: string,
		labelProps: ComponentPropsWithoutRef<"label"> = {},
	) => (
		<FormLabel {...labelProps}>
			<div className="flex flex-row gap-1.5 items-center">
				<span>{t(labelKey, labelFallback)}</span>
				<FieldHint>{t(helpKey, helpFallback)}</FieldHint>
			</div>
		</FormLabel>
	);
	const [vlessAuthOptions, setVlessAuthOptions] = useState<VlessEncAuthBlock[]>(
		[],
	);
	const [vlessAuthLoading, setVlessAuthLoading] = useState(false);
	const [ovCertLoading, setOVCertLoading] = useState(false);
	const [anyConnectCertLoading, setAnyConnectCertLoading] = useState(false);
	const [wgKeyLoading, setWGKeyLoading] = useState(false);
	const [activeTab, setActiveTab] = useState(0);
	const formBodyRef = useRef<HTMLDivElement | null>(null);
	const [jsonText, setJsonText] = useState<string>("");
	const [jsonError, setJsonError] = useState<string | null>(null);
	const updatingFromJsonRef = useRef(false);

	const form = useForm<InboundFormValues>({
		defaultValues: createDefaultInboundForm(),
	});
	const { control, register, handleSubmit, reset, watch, formState } = form;
	const { errors } = formState;
	const [portWarning, setPortWarning] = useState<string | null>(null);
	const [tagError, setTagError] = useState<string | null>(null);
	const [portError, setPortError] = useState<string | null>(null);
	const {
		fields: fallbackFields,
		append: appendFallback,
		remove: removeFallback,
	} = useFieldArray({
		control,
		name: "fallbacks",
	});
	const {
		fields: httpAccountFields,
		append: appendHttpAccount,
		remove: removeHttpAccount,
	} = useFieldArray({
		control,
		name: "httpAccounts",
	});
	const {
		fields: socksAccountFields,
		append: appendSocksAccount,
		remove: removeSocksAccount,
	} = useFieldArray({
		control,
		name: "socksAccounts",
	});
	const {
		fields: wsHeaderFields,
		append: appendWsHeader,
		remove: removeWsHeader,
	} = useFieldArray({
		control,
		name: "wsHeaders",
	});
	const {
		fields: httpupgradeHeaderFields,
		append: appendHttpupgradeHeader,
		remove: removeHttpupgradeHeader,
	} = useFieldArray({
		control,
		name: "httpupgradeHeaders",
	});
	const {
		fields: xhttpHeaderFields,
		append: appendXhttpHeader,
		insert: insertXhttpHeader,
		remove: removeXhttpHeader,
	} = useFieldArray({
		control,
		name: "xhttpHeaders",
	});
	const {
		fields: hysteriaMasqueradeHeaderFields,
		append: appendHysteriaMasqueradeHeader,
		remove: removeHysteriaMasqueradeHeader,
	} = useFieldArray({
		control,
		name: "hysteriaMasqueradeHeaders",
	});
	const {
		fields: hysteriaUdpMaskFields,
		append: appendHysteriaUdpMask,
		remove: removeHysteriaUdpMask,
	} = useFieldArray({
		control,
		name: "hysteriaUdpMasks",
	});
	const {
		fields: tlsCertificateFields,
		append: appendTlsCertificate,
		remove: removeTlsCertificate,
	} = useFieldArray({
		control,
		name: "tlsCertificates",
	});

	const currentProtocol =
		useWatch({ control, name: "protocol" }) || watch("protocol");
	const streamNetwork =
		useWatch({ control, name: "streamNetwork" }) || watch("streamNetwork");
	const streamSecurity =
		useWatch({ control, name: "streamSecurity" }) || watch("streamSecurity");
	const sniffingEnabled =
		useWatch({ control, name: "sniffingEnabled" }) ?? watch("sniffingEnabled");
	const { data: subscriptionBundle } = useQuery<SubscriptionSettingsBundle>({ queryKey: ["subscription-settings"], queryFn: getSubscriptionSettings, refetchOnWindowFocus: false });
	const tlsCertificates =
		useWatch({ control, name: "tlsCertificates" }) ||
		watch("tlsCertificates") ||
		[];
	const tcpHeaderType =
		useWatch({ control, name: "tcpHeaderType" }) || watch("tcpHeaderType");
	const sockoptEnabled = useWatch({ control, name: "sockoptEnabled" }) ?? false;
	const vlessSelectedAuth =
		useWatch({ control, name: "vlessSelectedAuth" }) || "";
	const formValues = useWatch({ control }) as InboundFormValues;
	const targetIds =
		useWatch({ control, name: "targetIds" }) || watch("targetIds") || [];
	const isCloneMode = mode === "clone";
	const isEditMode = mode === "edit";

	useEffect(() => {
		if (updatingFromJsonRef.current) {
			updatingFromJsonRef.current = false;
			return;
		}
		const updatedJson = buildInboundPayload(formValues, {
			initial: initialValue,
		});
		const formatted = JSON.stringify(updatedJson ?? {}, null, 2);
		setJsonText((prev) => (prev === formatted ? prev : formatted));
		setJsonError(null);
	}, [formValues, initialValue]);
	const socksAuth =
		useWatch({ control, name: "socksAuth" }) || watch("socksAuth") || "noauth";
	const socksUdpEnabled =
		useWatch({ control, name: "socksUdpEnabled" }) ??
		watch("socksUdpEnabled") ??
		false;
	const xhttpMode =
		useWatch({ control, name: "xhttpMode" }) || watch("xhttpMode") || "auto";
	const hysteriaMasqueradeEnabled =
		useWatch({ control, name: "hysteriaMasqueradeEnabled" }) ??
		watch("hysteriaMasqueradeEnabled") ??
		false;
	const hysteriaMasqueradeType =
		useWatch({ control, name: "hysteriaMasqueradeType" }) ||
		watch("hysteriaMasqueradeType") ||
		"";
	const tagValue = useWatch({ control, name: "tag" }) || watch("tag") || "";
	const portValue = useWatch({ control, name: "port" }) || watch("port") || "";
	const ovTunnelPortValue =
		useWatch({ control, name: "ovTunnelPort" }) || watch("ovTunnelPort") || "";
	const ovTproxyEnabled =
		useWatch({ control, name: "ovTproxyEnabled" }) ??
		watch("ovTproxyEnabled") ??
		true;
	const wgTunnelPortValue =
		useWatch({ control, name: "wgTunnelPort" }) || watch("wgTunnelPort") || "";
	const wgTproxyEnabled =
		useWatch({ control, name: "wgTproxyEnabled" }) ??
		watch("wgTproxyEnabled") ??
		true;
	const l2tpTunnelPortValue =
		useWatch({ control, name: "l2tpTunnelPort" }) ||
		watch("l2tpTunnelPort") ||
		"";
	const l2tpTproxyEnabled =
		useWatch({ control, name: "l2tpTproxyEnabled" }) ??
		watch("l2tpTproxyEnabled") ??
		true;
	const acUDPPortValue =
		useWatch({ control, name: "acUDPPort" }) || watch("acUDPPort") || "";
	const raTproxyEnabled =
		useWatch({ control, name: "raTproxyEnabled" }) ??
		watch("raTproxyEnabled") ??
		true;
	const autoOVTunnelPortRef = useRef("");
	const autoWGTunnelPortRef = useRef("");
	const autoL2TPTunnelPortRef = useRef("");
	const autoAnyConnectUDPPortRef = useRef("");
	const supportsStreamSettings =
		currentProtocol !== "http" &&
		currentProtocol !== "socks" &&
		currentProtocol !== "openvpn" &&
		currentProtocol !== "wireguard" &&
		currentProtocol !== "amneziawg" &&
		currentProtocol !== "sstp" &&
		currentProtocol !== "gre" &&
		currentProtocol !== "l2tp" &&
		currentProtocol !== "pptp" &&
		currentProtocol !== "ikev2" &&
		currentProtocol !== "anyconnect" &&
		currentProtocol !== "ssh" &&
		currentProtocol !== "mtproto" &&
		currentProtocol !== "web";
	const defaultVlessAuthLabels = useMemo(
		() => ["X25519, not Post-Quantum", "ML-KEM-768, Post-Quantum"],
		[],
	);
	const ALL_NETWORK_OPTIONS =
		currentProtocol === "hysteria" ? ["hysteria"] : streamNetworks;
	const canEnableTls = useMemo(
		() =>
			TLS_COMPATIBLE_PROTOCOLS.includes(currentProtocol) &&
			TLS_COMPATIBLE_NETWORKS.includes(streamNetwork),
		[currentProtocol, streamNetwork],
	);
	const canEnableReality = useMemo(
		() =>
			REALITY_COMPATIBLE_PROTOCOLS.includes(currentProtocol) &&
			REALITY_COMPATIBLE_NETWORKS.includes(streamNetwork),
		[currentProtocol, streamNetwork],
	);
	const streamCompatibilityError = useMemo(() => {
		if (!supportsStreamSettings) {
			return null;
		}
		if (streamSecurity === "tls" && !canEnableTls) {
			return t("inbounds.error.tlsUnsupported");
		}
		if (streamSecurity === "reality" && !canEnableReality) {
			return t("inbounds.error.realityUnsupported");
		}
		return null;
	}, [
		canEnableReality,
		canEnableTls,
		streamSecurity,
		supportsStreamSettings,
		t,
	]);
	const fieldValidationErrors = useMemo(
		() => validateInboundFormFields(formValues),
		[formValues],
	);
	const fieldValidationMessages = useMemo(
		() => Object.values(fieldValidationErrors).filter(Boolean),
		[fieldValidationErrors],
	);
	const hasBlockingErrorsWithJson = Boolean(
		tagError ||
			portError ||
			jsonError ||
			streamCompatibilityError ||
			fieldValidationMessages.length,
	);
	const computedVlessAuthOptions = useMemo(() => {
		const labels = [
			...defaultVlessAuthLabels,
			...vlessAuthOptions.map((option) => option.label),
		].filter(Boolean);
		const unique = Array.from(new Set(labels));
		return unique.map((label) => ({ label, value: label }));
	}, [defaultVlessAuthLabels, vlessAuthOptions]);
	const visibleProtocolOptions = useMemo(() => {
		const l2tpExists = existingInbounds.some(
			(inbound) =>
				String(inbound.protocol || "").toLowerCase() === "l2tp" &&
				String(inbound.tag || "") !== String(initialValue?.tag || ""),
		);
		const ikev2Exists = existingInbounds.some(
			(inbound) =>
				String(inbound.protocol || "").toLowerCase() === "ikev2" &&
				String(inbound.tag || "") !== String(initialValue?.tag || ""),
		);
		if (isEditMode) {
			return protocolOptions;
		}
		return protocolOptions.filter(
			(option) =>
				option !== "http" &&
				option !== "socks" &&
				!(option === "l2tp" && l2tpExists) &&
				!(option === "ikev2" && ikev2Exists),
		);
	}, [existingInbounds, initialValue?.tag, isEditMode]);
	const availableTargets = useMemo<CoreConfigTarget[]>(
		() =>
			configTargets.length
				? sortInboundTargets(configTargets)
				: [
						{
							id: "master",
							type: "master",
							name: t("default"),
							node_id: null,
							mode: "custom",
						},
					],
		[configTargets, t],
	);
	const customTargetIds = useMemo(
		() => getCustomNodeTargetIds(availableTargets),
		[availableTargets],
	);

	useEffect(() => {
		if (!isOpen) return;
		const formValues = initialValue
			? rawInboundToFormValues(initialValue)
			: createDefaultInboundForm();
		reset(formValues);
		const json = buildInboundPayload(formValues, { initial: initialValue });
		setJsonText(JSON.stringify(json ?? {}, null, 2));
		setJsonError(null);
		updatingFromJsonRef.current = false;
		setPortWarning(null);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [initialValue, isOpen, reset]);

	useEffect(() => {
		if (currentProtocol !== "hysteria") {
			return;
		}
		if (streamNetwork !== "hysteria") {
			form.setValue("streamNetwork", "hysteria", {
				shouldDirty: true,
				shouldValidate: true,
			});
		}
		if (streamSecurity !== "tls") {
			form.setValue("streamSecurity", "tls", {
				shouldDirty: true,
				shouldValidate: true,
			});
		}
	}, [currentProtocol, form, streamNetwork, streamSecurity]);

	useEffect(() => {
		if (currentProtocol !== "openvpn") {
			autoOVTunnelPortRef.current = "";
			return;
		}
		const port = Number(portValue);
		if (!Number.isInteger(port) || port < 1 || port >= 65535) {
			return;
		}
		const nextTunnelPort = String(port + 1);
		const currentTunnelPort = String(ovTunnelPortValue || "").trim();
		if (
			currentTunnelPort &&
			currentTunnelPort !== autoOVTunnelPortRef.current
		) {
			return;
		}
		if (currentTunnelPort !== nextTunnelPort) {
			autoOVTunnelPortRef.current = nextTunnelPort;
			form.setValue("ovTunnelPort", nextTunnelPort, {
				shouldDirty: true,
				shouldValidate: true,
			});
		}
		if (streamSecurity !== "none") {
			form.setValue("streamSecurity", "none", {
				shouldDirty: true,
				shouldValidate: true,
			});
		}
		if (streamNetwork !== "tcp") {
			form.setValue("streamNetwork", "tcp", {
				shouldDirty: true,
				shouldValidate: true,
			});
		}
		if (sniffingEnabled) {
			form.setValue("sniffingEnabled", false, {
				shouldDirty: true,
				shouldValidate: true,
			});
		}
	}, [
		currentProtocol,
		form,
		ovTunnelPortValue,
		portValue,
		sniffingEnabled,
		streamNetwork,
		streamSecurity,
	]);

	useEffect(() => {
		if (currentProtocol !== "wireguard" && currentProtocol !== "amneziawg") {
			autoWGTunnelPortRef.current = "";
			return;
		}
		const port = Number(portValue);
		if (Number.isInteger(port) && port >= 1 && port < 65535) {
			const nextTunnelPort = String(port + 1);
			const currentTunnelPort = String(wgTunnelPortValue || "").trim();
			if (
				!currentTunnelPort ||
				currentTunnelPort === autoWGTunnelPortRef.current
			) {
				if (currentTunnelPort !== nextTunnelPort) {
					autoWGTunnelPortRef.current = nextTunnelPort;
					form.setValue("wgTunnelPort", nextTunnelPort, {
						shouldDirty: true,
						shouldValidate: true,
					});
				}
			}
		}
		if (!String(form.getValues("wgServerAddress") || "").trim()) {
			form.setValue(
				"wgServerAddress",
				currentProtocol === "amneziawg" ? "10.73.0.1/16" : "10.69.0.1/16",
				{
				shouldDirty: true,
				shouldValidate: true,
				},
			);
		}
		if (streamSecurity !== "none") {
			form.setValue("streamSecurity", "none", {
				shouldDirty: true,
				shouldValidate: true,
			});
		}
		if (streamNetwork !== "tcp") {
			form.setValue("streamNetwork", "tcp", {
				shouldDirty: true,
				shouldValidate: true,
			});
		}
		if (sniffingEnabled) {
			form.setValue("sniffingEnabled", false, {
				shouldDirty: true,
				shouldValidate: true,
			});
		}
	}, [
		currentProtocol,
		form,
		portValue,
		sniffingEnabled,
		streamNetwork,
		streamSecurity,
		wgTunnelPortValue,
	]);

	useEffect(() => {
		if (currentProtocol !== "l2tp") {
			autoL2TPTunnelPortRef.current = "";
			return;
		}
		if (portValue !== "1701") {
			form.setValue("port", "1701", {
				shouldDirty: true,
				shouldValidate: true,
			});
		}
		const currentTunnelPort = String(l2tpTunnelPortValue || "").trim();
		if (currentTunnelPort !== "1702") {
			autoL2TPTunnelPortRef.current = "1702";
			form.setValue("l2tpTunnelPort", "1702", {
				shouldDirty: true,
				shouldValidate: true,
			});
		}
		if (!String(form.getValues("l2tpIPSecPSK") || "").trim()) {
			form.setValue("l2tpIPSecPSK", `rb-l2tp-${randomLowerAndNum(24)}`, {
				shouldDirty: true,
				shouldValidate: true,
			});
		}
		if (streamSecurity !== "none") {
			form.setValue("streamSecurity", "none", {
				shouldDirty: true,
				shouldValidate: true,
			});
		}
		if (streamNetwork !== "tcp") {
			form.setValue("streamNetwork", "tcp", {
				shouldDirty: true,
				shouldValidate: true,
			});
		}
		if (sniffingEnabled) {
			form.setValue("sniffingEnabled", false, {
				shouldDirty: true,
				shouldValidate: true,
			});
		}
	}, [
		currentProtocol,
		form,
		l2tpTunnelPortValue,
		portValue,
		sniffingEnabled,
		streamNetwork,
		streamSecurity,
	]);

	useEffect(() => {
		if (currentProtocol !== "anyconnect") {
			autoAnyConnectUDPPortRef.current = "";
			return;
		}
		const port = Number(portValue);
		if (!Number.isInteger(port) || port < 1 || port > 65535) {
			return;
		}
		const nextUDPPort = String(port);
		const currentUDPPort = String(acUDPPortValue).trim();
		if (currentUDPPort && currentUDPPort !== autoAnyConnectUDPPortRef.current) {
			return;
		}
		if (currentUDPPort !== nextUDPPort) {
			autoAnyConnectUDPPortRef.current = nextUDPPort;
			form.setValue("acUDPPort", nextUDPPort, {
				shouldDirty: true,
				shouldValidate: true,
			});
		}
	}, [acUDPPortValue, currentProtocol, form, portValue]);

	const BLOCKED_PORTS = useMemo(
		() =>
			new Set([
				21, // FTP
				22, // SSH
				23, // Telnet
				25, // SMTP
				53, // DNS
				67, // DHCP
				68, // DHCP
				110, // POP3
				111, // Portmapper
				123, // NTP
				137, // NetBIOS
				143, // IMAP
				161, // SNMP
				162, // SNMP Trap
				993, // IMAP over SSL
			]),
		[],
	);

	const generateRandomPort = useCallback(() => {
		if (
			currentProtocol === "l2tp" ||
			currentProtocol === "ikev2" ||
			currentProtocol === "gre"
		) {
			if (currentProtocol === "gre") {
				form.setValue("port", "47", {
					shouldDirty: true,
					shouldValidate: true,
				});
				return "47";
			}
			form.setValue("port", "1701", {
				shouldDirty: true,
				shouldValidate: true,
			});
			if (currentProtocol === "ikev2") {
				form.setValue("port", "500", {
					shouldDirty: true,
					shouldValidate: true,
				});
				return "500";
			}
			return "1701";
		}
		let candidate = 0;
		for (let i = 0; i < 10; i += 1) {
			const randomPort = Math.floor(Math.random() * 9000) + 1000; // 4-digit
			if (!BLOCKED_PORTS.has(randomPort)) {
				candidate = randomPort;
				break;
			}
		}
		if (!candidate) {
			candidate = 4443;
		}
		form.setValue("port", candidate.toString(), { shouldDirty: true });
		return candidate.toString();
	}, [BLOCKED_PORTS, currentProtocol, form]);

	useEffect(() => {
		if (!portValue) {
			setPortWarning(null);
			return;
		}
		if (inboundPortNumbers(portValue).some((port) => BLOCKED_PORTS.has(port))) {
			setPortWarning(t("inbounds.portWarningBlocked"));
		} else {
			setPortWarning(null);
		}
	}, [BLOCKED_PORTS, portValue, t]);

	// Validation against existing inbounds
	useEffect(() => {
		const trimmedTag = (tagValue || "").trim();
		if (isEditMode) {
			setTagError(null);
		}
		if (
			!isEditMode &&
			trimmedTag &&
			existingInbounds.some(
				(inb) =>
					(inb.tag || "").trim().toLowerCase() === trimmedTag.toLowerCase(),
			)
		) {
			setTagError(t("inbounds.error.tagExists"));
		} else {
			setTagError(null);
		}
		const selectedTargets = new Set(targetIds?.length ? targetIds : ["master"]);
		if (
			portValue &&
			existingInbounds.some((inb) => {
				if (isEditMode && inb.tag === initialValue?.tag) {
					return false;
				}
				const inboundTargets = inb.effective_targets?.length
					? inb.effective_targets
					: inb.targets?.length
						? inb.targets
						: ["master"];
				return (
					inboundPortNumbers(portValue).some((port) =>
						inboundPortNumbers(String(inb.port ?? "")).includes(port),
					) &&
					inboundTargets.some((targetId) => selectedTargets.has(targetId))
				);
			})
		) {
			setPortError(t("inbounds.error.portExists"));
		} else {
			setPortError(null);
		}
	}, [
		existingInbounds,
		portValue,
		tagValue,
		t,
		isEditMode,
		targetIds,
		initialValue,
	]);

	const renderSockoptNumberInput = useCallback(
		(name: keyof SockoptFormValues, label: string) => (
			<FormControl>
				<FormLabel>{label}</FormLabel>
				<Controller
					control={control}
					name={`sockopt.${name}` as const}
					render={({ field }) => {
						const numberInputValue: string | number | undefined =
							typeof field.value === "number" || typeof field.value === "string"
								? field.value
								: undefined;
						return (
							<NumberField doneLabel={t("common.done")} inputMode="numeric"
								min={0}
								value={numberInputValue ?? ""}
								onChange={(valueString) => field.onChange(valueString)}
							/>
						);
					}}
				/>
			</FormControl>
		),
		[control],
	);

	const renderSockoptSwitch = useCallback(
		(name: keyof SockoptFormValues, label: string) => (
			<FormControl className="flex items-center">
				<FormLabel className="mb-0">{label}</FormLabel>
				<Controller
					control={control}
					name={`sockopt.${name}` as const}
					render={({ field }) => (
						<Switch checked={
								typeof field.value === "boolean"
									? field.value
									: Boolean(field.value)
							} onCheckedChange={(checked: boolean) => field.onChange(checked)} />
					)}
				/>
			</FormControl>
		),
		[control],
	);

	const renderSockoptTextInput = useCallback(
		(name: keyof SockoptFormValues, label: string, placeholder?: string) => (
			<FormControl>
				<FormLabel>{label}</FormLabel>
				<Input {...register(`sockopt.${name}` as const)}
					placeholder={placeholder}
				/>
			</FormControl>
		),
		[register],
	);

	const supportsFallback =
		currentProtocol === "vless" || currentProtocol === "trojan";

	const sectionBorder = "border-gray-200! dark:border-gray-700!";

	const { userData } = useGetUser();
	const canViewNote = canViewEntityNotes(userData);
	const noteTag = initialValue?.tag ?? "";
	const noteQuery = useQuery<EntityNote>({
		queryKey: ["entity-note", "inbound", noteTag],
		queryFn: () => apiFetch<EntityNote>(`/notes/inbound/${encodeURIComponent(noteTag)}`),
		enabled: isOpen && isEditMode && canViewNote && Boolean(noteTag),
	});
	const [noteDraft, setNoteDraft] = useState("");
	useEffect(() => {
		setNoteDraft(noteQuery.data?.note ?? "");
	}, [noteQuery.data]);
	useEffect(() => {
		if (isOpen && !isEditMode) setNoteDraft("");
	}, [isOpen, isEditMode]);

	const submitForm = async (values: InboundFormValues) => {
		const errors = validateInboundFormValues(values);
		if (errors.length) {
			setActiveTab(0);
			toast.error(t("inbounds.error.invalidConfig"), { description: errors[0] });
			return;
		}
		const nextNote = noteDraft.trim();
		const originalNote = isEditMode ? (noteQuery.data?.note ?? "") : "";
		await onSubmit({ ...values, note: canViewNote && nextNote !== originalNote ? nextNote : undefined });
	};

	const handleGenerateRealityKeypair = useCallback(async () => {
		try {
			const { privateKey, publicKey } = await generateRealityKeypair();
			form.setValue(
				"realityPrivateKey",
				formatRealityKeyForDisplay(privateKey),
				{
					shouldDirty: true,
				},
			);
			form.setValue("realityPublicKey", formatRealityKeyForDisplay(publicKey), {
				shouldDirty: true,
			});
			toast.success(t("inbounds.reality.generateKeys"), { description: "Key pair generated successfully using Xray", duration: 2000 });
		} catch (error) {
			toast.error(t("inbounds.reality.generateError"), { description: error instanceof Error ? error.message : undefined });
		}
	}, [form, toast, t]);

	const handleClearRealityKeypair = useCallback(() => {
		form.setValue("realityPrivateKey", "", { shouldDirty: true });
		form.setValue("realityPublicKey", "", { shouldDirty: true });
	}, [form]);

	const handleGenerateEchCert = useCallback(async () => {
		const sni = form.getValues("tlsServerName")?.trim();
		if (!sni) {
			toast.warning(t("inbounds.tls.echMissingSni"));
			return;
		}
		try {
			const { echServerKeys, echConfigList } = await generateEchCert(sni);
			form.setValue("tlsEchServerKeys", echServerKeys ?? "", {
				shouldDirty: true,
			});
			form.setValue("tlsEchConfigList", echConfigList ?? "", {
				shouldDirty: true,
			});
			toast.success(t("inbounds.tls.echGenerated"), { duration: 2000 });
		} catch (error) {
			toast.error(t("inbounds.tls.echError"), { description: error instanceof Error ? error.message : undefined });
		}
	}, [form, t, toast]);

	const handleClearEchCert = useCallback(() => {
		form.setValue("tlsEchServerKeys", "", { shouldDirty: true });
		form.setValue("tlsEchConfigList", "", { shouldDirty: true });
	}, [form]);

	const handleGenerateOVSelfSigned = useCallback(async () => {
		setOVCertLoading(true);
		try {
			const certs = await generateOVSelfSigned();
			form.setValue("ovCA", certs.ca ?? "", {
				shouldDirty: true,
				shouldValidate: true,
			});
			form.setValue("ovServerCertificate", certs.serverCertificate ?? "", {
				shouldDirty: true,
				shouldValidate: true,
			});
			form.setValue("ovServerKey", certs.serverKey ?? "", {
				shouldDirty: true,
				shouldValidate: true,
			});
			toast.success(t("inbounds.openvpn.generateSelfSignedSuccess"), { duration: 2500 });
		} catch (error) {
			toast.error(t("inbounds.openvpn.generateSelfSignedError"), { description: error instanceof Error ? error.message : undefined });
		} finally {
			setOVCertLoading(false);
		}
	}, [form, t, toast]);

	const handleGenerateAnyConnectSelfSigned = useCallback(async () => {
		const names = form
			.getValues("raCertificateNames")
			.split(/[\n,]/)
			.map((value) => value.trim())
			.filter(Boolean);
		if (names.length === 0) {
			form.setError("raCertificateNames", {
				type: "required",
				message: t("inbounds.anyconnect.certificateNamesRequired"),
			});
			return;
		}
		setAnyConnectCertLoading(true);
		try {
			const certs = await generateAnyConnectSelfSigned(names);
			form.clearErrors("raCertificateNames");
			form.setValue("raCA", certs.ca ?? "", {
				shouldDirty: true,
				shouldValidate: true,
			});
			form.setValue("raServerCertificate", certs.serverCertificate ?? "", {
				shouldDirty: true,
				shouldValidate: true,
			});
			form.setValue("raServerKey", certs.serverKey ?? "", {
				shouldDirty: true,
				shouldValidate: true,
			});
			toast.success(t("inbounds.anyconnect.generateSelfSignedSuccess"), { duration: 2500 });
		} catch (error) {
			toast.error(t("inbounds.anyconnect.generateSelfSignedError"), { description: error instanceof Error ? error.message : undefined });
		} finally {
			setAnyConnectCertLoading(false);
		}
	}, [form, t, toast]);

	const handleGenerateWGKeypair = useCallback(async () => {
		setWGKeyLoading(true);
		try {
			const keys = await generateWGKeypair();
			form.setValue("wgPrivateKey", keys.privateKey ?? "", {
				shouldDirty: true,
				shouldValidate: true,
			});
			form.setValue("wgPublicKey", keys.publicKey ?? "", {
				shouldDirty: true,
				shouldValidate: true,
			});
			toast.success(t("inbounds.wireguard.generateKeysSuccess"), { duration: 2500 });
		} catch (error) {
			toast.error(t("inbounds.wireguard.generateKeysError"), { description: error instanceof Error ? error.message : undefined });
		} finally {
			setWGKeyLoading(false);
		}
	}, [form, t, toast]);

	const handleGenerateMldsa65 = useCallback(async () => {
		try {
			const { seed, verify } = await generateMldsa65();
			form.setValue("realityMldsa65Seed", seed ?? "", { shouldDirty: true });
			form.setValue("realityMldsa65Verify", verify ?? "", {
				shouldDirty: true,
			});
			toast.success(t("inbounds.reality.mldsaGenerated"), { duration: 2000 });
		} catch (error) {
			toast.error(t("inbounds.reality.mldsaError"), { description: error instanceof Error ? error.message : undefined });
		}
	}, [form, t, toast]);

	const handleClearMldsa65 = useCallback(() => {
		form.setValue("realityMldsa65Seed", "", { shouldDirty: true });
		form.setValue("realityMldsa65Verify", "", { shouldDirty: true });
	}, [form]);

	const handleJsonEditorChange = useCallback(
		(value: string) => {
			setJsonText(value);
			try {
				const parsed = JSON.parse(value);
				if (!parsed || typeof parsed !== "object") {
					throw new Error("Invalid JSON payload");
				}
				const mapped = rawInboundToFormValues(parsed as RawInbound);
				const currentTargets = form.getValues("targetIds");
				if (currentTargets?.length) {
					mapped.targetIds = currentTargets;
				}
				updatingFromJsonRef.current = true;
				reset(mapped);
				setJsonError(null);
			} catch (error) {
				setJsonError(error instanceof Error ? error.message : "Invalid JSON");
			}
		},
		[form, reset],
	);

	const handleGenerateShortId = useCallback(async () => {
		try {
			const { shortId } = await generateRealityShortId();
			const currentValue = form.getValues("realityShortIds") || "";
			const entries = currentValue
				.split(/[\s,]+/)
				.map((entry) => entry.trim())
				.filter(Boolean);
			entries.push(shortId);
			form.setValue("realityShortIds", entries.join(","), {
				shouldDirty: true,
			});
			toast.success(t("inbounds.reality.generateShortId"), { description: "Short ID generated successfully", duration: 2000 });
		} catch (error) {
			toast.error(t("inbounds.reality.shortIdError"), { description: error instanceof Error ? error.message : undefined });
		}
	}, [form, toast, t]);

	const handleRandomizeRealityTarget = useCallback(() => {
		const randomTarget = getRandomRealityTarget();
		if (!randomTarget) {
			return;
		}
		form.setValue("realityTarget", randomTarget.target, { shouldDirty: true });
		form.setValue("realityServerNames", randomTarget.sni, {
			shouldDirty: true,
		});
	}, [form]);

	const handleRandomizeRealityShortIds = useCallback(() => {
		form.setValue("realityShortIds", generateRandomShortIds(), {
			shouldDirty: true,
		});
	}, [form]);

	const handleAddFallback = () =>
		appendFallback({ dest: "", path: "", type: "", alpn: "", xver: "" });
	const handleAddTlsCertificate = () =>
		appendTlsCertificate(createDefaultTlsCertificate());

	const fetchVlessAuthBlocks = useCallback(async () => {
		setVlessAuthLoading(true);
		try {
			const response = await getVlessEncAuthBlocks();
			const blocks = response?.auths ?? [];
			setVlessAuthOptions(blocks);
			return blocks;
		} catch (error) {
			console.error(error);
			toast.error(t("inbounds.vless.getKeysError"));
			return [];
		} finally {
			setVlessAuthLoading(false);
		}
	}, [toast, t]);

	const ensureVlessAuthBlocks = useCallback(async () => {
		if (vlessAuthOptions.length) {
			return vlessAuthOptions;
		}
		return fetchVlessAuthBlocks();
	}, [fetchVlessAuthBlocks, vlessAuthOptions]);

	const applyVlessAuthBlock = useCallback(
		(label: string, blocks: VlessEncAuthBlock[]) => {
			const match = blocks.find((block) => block.label === label);
			if (!match) {
				toast.warning(t("inbounds.vless.authNotFound"));
				return;
			}
			form.setValue("vlessDecryption", match.decryption ?? "", {
				shouldDirty: true,
			});
			form.setValue("vlessEncryption", match.encryption ?? "", {
				shouldDirty: true,
			});
		},
		[form, t, toast],
	);

	const handleAuthSelection = useCallback(
		async (label: string) => {
			if (!label) {
				form.setValue("vlessDecryption", "", { shouldDirty: true });
				form.setValue("vlessEncryption", "", { shouldDirty: true });
				return;
			}
			const blocks = await ensureVlessAuthBlocks();
			if (blocks.length) {
				applyVlessAuthBlock(label, blocks);
			}
		},
		[applyVlessAuthBlock, ensureVlessAuthBlocks, form],
	);

	const handleFetchAuthClick = useCallback(async () => {
		const label = form.getValues("vlessSelectedAuth");
		if (!label) {
			toast.info(t("inbounds.vless.selectAuthFirst"));
			return;
		}
		const blocks = await fetchVlessAuthBlocks();
		if (blocks.length) {
			applyVlessAuthBlock(label, blocks);
		}
	}, [applyVlessAuthBlock, fetchVlessAuthBlocks, form, t, toast]);

	const handleClearAuth = useCallback(() => {
		form.setValue("vlessSelectedAuth", "", { shouldDirty: true });
		form.setValue("vlessDecryption", "", { shouldDirty: true });
		form.setValue("vlessEncryption", "", { shouldDirty: true });
	}, [form]);

	const vlessAuthRequestedRef = useRef(false);
	useEffect(() => {
		if (!isOpen) {
			vlessAuthRequestedRef.current = false;
			return;
		}
		if (currentProtocol === "vless" && !vlessAuthRequestedRef.current) {
			vlessAuthRequestedRef.current = true;
			void fetchVlessAuthBlocks();
		}
	}, [currentProtocol, fetchVlessAuthBlocks, isOpen]);

	const vlessDecryptionValue = useWatch({ control, name: "vlessDecryption" }) || "";
	const showVlessAuthDetails =
		Boolean(vlessSelectedAuth) || (vlessDecryptionValue !== "" && vlessDecryptionValue !== "none");
	const vlessAuthenticationSection =
		currentProtocol === "vless" ? (
			<div className="flex flex-col gap-4 xray-dialog-section">
				<Controller
					control={control}
					name="vlessSelectedAuth"
					render={({ field }) => (
						<FormControl>
							<FormLabel helpKey="inbounds.vless.authenticationHelp">{t("inbounds.vless.authentication")}</FormLabel>
							<SearchableTagSelect
								value={field.value || ""}
								options={[
									{ value: "", label: t("userDialog.flow.none") },
									...computedVlessAuthOptions.map((option) => ({
										value: option.value,
										label: option.label,
									})),
								]}
								placeholder={t("inbounds.vless.authPlaceholder")}
								onChange={async (selected) => {
									const value = String(selected);
									field.onChange(value);
									await handleAuthSelection(value);
								}}
							/>
						</FormControl>
					)}
				/>
				{showVlessAuthDetails ? (
					<>
						<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
							<FormControl>
								<FormLabel helpKey="inbounds.vless.decryptionHelp">{t("inbounds.vless.decryption")}</FormLabel>
								<Input {...register("vlessDecryption")} />
							</FormControl>
							<FormControl>
								<FormLabel helpKey="inbounds.vless.encryptionHelp">{t("inbounds.vless.encryption")}</FormLabel>
								<Input {...register("vlessEncryption")} />
							</FormControl>
						</div>
						<div className="flex flex-row flex-wrap items-center gap-2">
							<button
								type="button"
								onClick={handleFetchAuthClick}
								disabled={!vlessSelectedAuth || vlessAuthLoading}
								className={buttonVariants({ variant: "outline", size: "sm" })}
							>
								{vlessAuthLoading ? <Loader2 className="size-4 animate-spin" /> : null}
								{t("inbounds.vless.getKeys")}
							</button>
							<button type="button" onClick={handleClearAuth} className={buttonVariants({ variant: "ghost", size: "sm" })}>
								{t("clear")}
							</button>
						</div>
					</>
				) : null}
			</div>
		) : null;

	return (
		<Dialog
			section="inbounds"
			page={mode === "edit" && initialValue ? inboundEntityPage(initialValue) : undefined}
			open={isOpen}
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
		>
			<DialogContent className="flex max-h-[min(860px,calc(100dvh-8rem))] flex-col gap-0 overflow-clip p-0 sm:max-w-4xl max-md:inset-x-3 max-md:top-3 max-md:bottom-3 max-md:max-h-none max-md:w-auto max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0 inbound-form-modal">
				<Tabs value={String(activeTab)} onValueChange={(value) => setActiveTab(Number(value))} className="flex min-h-0 flex-1 flex-col">
					<div className="flex flex-col gap-2 border-b bg-background px-4 pb-2 pt-3 pe-12 md:gap-3 md:px-5 md:pb-3 md:pt-4">
						<div className="flex min-w-0 items-center gap-3">
							<div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
								<Network className="size-4" />
							</div>
							<div className="min-w-0">
								<DialogTitle className="truncate text-base font-semibold">
									{mode === "create" ? t("inbounds.add") : mode === "clone" ? t("inbounds.cloneTitle") : t("inbounds.edit")}
								</DialogTitle>
								<DialogDescription className="truncate text-xs text-muted-foreground">
									{String(currentProtocol).toUpperCase()}
								</DialogDescription>
							</div>
						</div>
						<TabsList className="grid w-full grid-cols-3">
							<TabsTrigger value="0">{t("form")}</TabsTrigger>
							<TabsTrigger value="1">{t("json")}</TabsTrigger>
							<TabsTrigger value="2">{t("inbounds.targets")}</TabsTrigger>
						</TabsList>
						{activeTab === 0 ? <InboundSectionNav containerRef={formBodyRef} resetKey={activeTab} /> : null}
					</div>
					<div ref={formBodyRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3 md:px-5 md:py-4">
							<TabsContent value="0" forceMount className="mt-0 data-[state=inactive]:hidden">
								<div className="flex flex-col items-stretch gap-6">
									<div className="flex flex-col gap-3 xray-dialog-section" data-form-section="basic" data-form-section-title={t("pages.outbound.basicSettings")}>
										<p className="text-[0.875rem] font-semibold">
											{t("pages.outbound.basicSettings")}
										</p>
										<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
											<FormControl required isInvalid={!!tagError || !!fieldValidationErrors.tag}>
												<FormLabel helpKey="inbounds.tagHelp">{t("inbounds.tag")}</FormLabel>
												<Controller
													control={control}
													name="tag"
													rules={{ required: true }}
													render={({ field }) => (
														<EmojiShortcodeInput
															ref={field.ref}
															value={field.value ?? ""}
															onChange={field.onChange}
															onBlur={field.onBlur}
															disabled={isEditMode}
															enabled={inboundTagAllowsEmoji(currentProtocol)}
														/>
													)}
												/>
												{(tagError || fieldValidationErrors.tag) && (
													<p className="text-[0.75rem] text-red-500 mt-1">
														{tagError || fieldValidationErrors.tag}
													</p>
												)}
											</FormControl>
											<FormControl>
												<FormLabel helpKey="inbounds.listenHelp">{t("inbounds.listen")}</FormLabel>
												<Input placeholder="::" {...register("listen")} />
											</FormControl>
											
										</div>
										<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
											<FormControl required isInvalid={!!portError || !!fieldValidationErrors.port}>
												<FormLabel helpKey="portHelp">{t("port")}</FormLabel>
												<Input
													{...register("port", { required: true })}
													placeholder={supportsMultiplePorts(currentProtocol) ? "443,8443" : "443"}
													disabled={currentProtocol === "l2tp" || currentProtocol === "ikev2" || currentProtocol === "gre" || currentProtocol === "web"}
													aria-invalid={!!portError || !!fieldValidationErrors.port}
												/>
												<div className="flex flex-row items-center gap-2 justify-between mt-1">
													<Button onClick={() => generateRandomPort()} disabled={
															currentProtocol === "l2tp" ||
															currentProtocol === "ikev2" ||
															currentProtocol === "gre" ||
															currentProtocol === "web"
														} variant="ghost" size="xs">{<Sparkles className="w-[16px] h-[16px]" />}
														{t("inbounds.randomPort")}
													</Button>
												</div>
												{supportsMultiplePorts(currentProtocol) && (
													<p className="text-[0.75rem] text-muted-foreground mt-1">
														{t("inbounds.portListHint")}
													</p>
												)}
												{portWarning && (
													<p className="text-[0.75rem] text-yellow-600 mt-1">
														{portWarning}
													</p>
												)}
												{(portError || fieldValidationErrors.port) && (
													<p className="text-[0.75rem] text-red-500 mt-1">
														{portError || fieldValidationErrors.port}
													</p>
												)}
											</FormControl>
											<FormControl required>
												<FormLabel helpKey="protocolHelp">{t("protocol")}</FormLabel>
												<SearchableTagSelect
													value={currentProtocol}
													disabled={mode === "edit"}
													options={visibleProtocolOptions.map((option) => ({
														value: option,
														label: option.toUpperCase(),
													}))}
													placeholder={t("protocol")}
													onChange={(value) => {
														const nextProtocol = String(
															value,
														) as InboundFormValues["protocol"];
														form.setValue("protocol", nextProtocol, {
															shouldDirty: true,
															shouldValidate: true,
														});
														if (nextProtocol === "hysteria") {
															form.setValue("streamNetwork", "hysteria", {
																shouldDirty: true,
																shouldValidate: true,
															});
															form.setValue("streamSecurity", "tls", {
																shouldDirty: true,
																shouldValidate: true,
															});
															form.setValue("hysteriaVersion", "2", {
																shouldDirty: true,
															});
															form.setValue("hysteriaUdpIdleTimeout", "60", {
																shouldDirty: true,
															});
															form.setValue(
																"hysteriaUdpMasks",
																[createDefaultHysteriaUdpMask()],
																{
																	shouldDirty: true,
																},
															);
															form.setValue(
																"hysteriaQuicParams.enabled",
																false,
																{
																	shouldDirty: true,
																},
															);
															form.setValue("tlsAlpn", ["h3"], {
																shouldDirty: true,
															});
															form.setValue("tlsFingerprint", "", {
																shouldDirty: true,
															});
														}
														if (
															["ssh", "mtproto", "web"].includes(nextProtocol)
														) {
															form.setValue("streamNetwork", "tcp", {
																shouldDirty: true,
															});
															form.setValue("streamSecurity", "none", {
																shouldDirty: true,
															});
															form.setValue("sniffingEnabled", false, {
																shouldDirty: true,
															});
														}
														if (nextProtocol === "web") {
															form.setValue("port", "443", {
																shouldDirty: true,
																shouldValidate: true,
															});
														}
														if (
															nextProtocol === "openvpn" ||
															nextProtocol === "wireguard" ||
															nextProtocol === "amneziawg" ||
															nextProtocol === "sstp" ||
															nextProtocol === "gre" ||
															nextProtocol === "l2tp" ||
															nextProtocol === "pptp" ||
															nextProtocol === "ikev2" ||
															nextProtocol === "anyconnect"
														) {
															if (nextProtocol === "l2tp") {
																form.setValue("port", "1701", {
																	shouldDirty: true,
																	shouldValidate: true,
																});
																form.setValue("l2tpTunnelPort", "1702", {
																	shouldDirty: true,
																	shouldValidate: true,
																});
																if (!form.getValues("l2tpIPSecPSK")) {
																	form.setValue(
																		"l2tpIPSecPSK",
																		`rb-l2tp-${randomLowerAndNum(24)}`,
																		{
																			shouldDirty: true,
																			shouldValidate: true,
																		},
																	);
																}
															}
															if (nextProtocol === "pptp") {
																form.setValue("port", "1723", {
																	shouldDirty: true,
																	shouldValidate: true,
																});
																form.setValue("l2tpTunnelPort", "41942", {
																	shouldDirty: true,
																	shouldValidate: true,
																});
															}
															if (nextProtocol === "ikev2") {
																form.setValue("port", "500", {
																	shouldDirty: true,
																	shouldValidate: true,
																});
																form.setValue("raIPv4Pool", "10.70.0.0/16", {
																	shouldDirty: true,
																});
																if (!form.getValues("raTunnelPort"))
																	form.setValue("raTunnelPort", "41943", {
																		shouldDirty: true,
																	});
															}
															if (nextProtocol === "anyconnect") {
																form.setValue("port", "443", {
																	shouldDirty: true,
																	shouldValidate: true,
																});
																form.setValue("raIPv4Pool", "10.71.0.0/16", {
																	shouldDirty: true,
																});
																autoAnyConnectUDPPortRef.current = "443";
																form.setValue("acUDPPort", "443", {
																	shouldDirty: true,
																});
																if (!form.getValues("raTunnelPort"))
																	form.setValue("raTunnelPort", "41944", {
																		shouldDirty: true,
																	});
															}
															if (nextProtocol === "wireguard") {
																if (!form.getValues("wgIPv4Pool")) {
																	form.setValue("wgIPv4Pool", "10.69.0.0/16", {
																		shouldDirty: true,
																		shouldValidate: true,
																	});
																}
																if (!form.getValues("wgServerAddress")) {
																	form.setValue(
																		"wgServerAddress",
																		"10.69.0.1/16",
																		{
																			shouldDirty: true,
																			shouldValidate: true,
																		},
																	);
																}
															}
															if (nextProtocol === "amneziawg") {
																form.setValue("port", "51820", {
																	shouldDirty: true,
																	shouldValidate: true,
																});
																form.setValue("wgIPv4Pool", "10.73.0.0/16", {
																	shouldDirty: true,
																});
																form.setValue(
																	"wgServerAddress",
																	"10.73.0.1/16",
																	{ shouldDirty: true },
																);
																if (!form.getValues("wgTunnelPort"))
																	form.setValue("wgTunnelPort", "51821", {
																		shouldDirty: true,
																	});
															}
															if (nextProtocol === "sstp") {
																form.setValue("port", "443", {
																	shouldDirty: true,
																	shouldValidate: true,
																});
																form.setValue("raIPv4Pool", "10.72.0.0/16", {
																	shouldDirty: true,
																});
																form.setValue("raTunnelPort", "41945", {
																	shouldDirty: true,
																});
															}
															if (nextProtocol === "gre") {
																form.setValue("port", "47", {
																	shouldDirty: true,
																	shouldValidate: true,
																});
																form.setValue("raIPv4Pool", "10.74.0.0/16", {
																	shouldDirty: true,
																});
																form.setValue("raTunnelPort", "41946", {
																	shouldDirty: true,
																});
															}
															form.setValue("streamNetwork", "tcp", {
																shouldDirty: true,
																shouldValidate: true,
															});
															form.setValue("streamSecurity", "none", {
																shouldDirty: true,
																shouldValidate: true,
															});
															form.setValue("sniffingEnabled", false, {
																shouldDirty: true,
																shouldValidate: true,
															});
														}
													}}
												/>
											</FormControl>
											<FormControl required isInvalid={Boolean(
													fieldValidationErrors.usageCoefficient,
												)}>
												<div className="mb-1 flex min-w-0 items-center gap-1.5"><FormLabel className="mb-0">{t("inbounds.usageCoefficient")}</FormLabel><FieldHint>{t("inbounds.usageCoefficientHelp")}</FieldHint></div>
												<Controller
													control={control}
													name="usageCoefficient"
													render={({ field }) => (
														<NumberField doneLabel={t("common.done")} inputMode="decimal"
															value={field.value ?? "1"}
															onChange={(value) => field.onChange(value)}
															min={0.01}
															max={100}
															step={0.01}
														/>
													)}
												/>
												{Number(formValues.usageCoefficient) !== 1 && (
													<Alert className="mt-2 rounded-md">
														<TriangleAlert className="size-4" aria-hidden="true" />
														<AlertDescription className="text-[0.75rem]">
															{t("inbounds.usageCoefficientNodeWarning")}
														</AlertDescription>
													</Alert>
												)}
												{fieldValidationErrors.usageCoefficient && (
													<p className="text-[0.75rem] text-red-500 mt-1">
														{fieldValidationErrors.usageCoefficient}
													</p>
												)}
											</FormControl>
											{currentProtocol === "vless" && (
											<FormControl>
												<FormLabel helpKey="inbounds.vless.flowHelp">{t("inbounds.vless.flow")}</FormLabel>
												<SearchableTagSelect
													value={formValues.vlessFlow || ""}
													options={[
														{
															value: "",
															label: t("common.default"),
														},
														...VLESS_FLOW_OPTIONS,
													]}
													placeholder={t("inbounds.vless.flow")}
													onChange={(value) =>
														form.setValue(
															"vlessFlow",
															String(value) as InboundFormValues["vlessFlow"],
															{
																shouldDirty: true,
																shouldValidate: true,
															},
														)
													}
												/>
											</FormControl>
										)}
										</div>
										{currentProtocol === "vmess" && (
											<FormControl className="flex items-center">
												<FormLabel className="mb-0" helpKey="inbounds.vmess.disableInsecureHelp">{t("inbounds.vmess.disableInsecure")}</FormLabel>
												<Controller control={control} name={"disableInsecureEncryption"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
											</FormControl>
										)}
										
										{currentProtocol === "shadowsocks" && (
											<div className="flex flex-col gap-3">
												<FormControl>
													<FormLabel helpKey="passwordHelp">{t("password")}</FormLabel>
													<Input
														type="text"
														autoComplete="off"
														{...register("shadowsocksPassword")}
													/>
												</FormControl>
												<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
													<FormControl>
														<FormLabel helpKey="inbounds.shadowsocks.methodHelp">{t("inbounds.shadowsocks.method")}</FormLabel>
														<SearchableTagSelect
															value={formValues.shadowsocksMethod || ""}
															options={shadowsocksMethods}
															placeholder={t("inbounds.shadowsocks.method")}
															onChange={(value) =>
																form.setValue(
																	"shadowsocksMethod",
																	String(value),
																	{
																		shouldDirty: true,
																		shouldValidate: true,
																	},
																)
															}
														/>
													</FormControl>
													<FormControl>
														<FormLabel helpKey="inbounds.shadowsocks.networkHelp">{t("inbounds.shadowsocks.network")}</FormLabel>
														<SearchableTagSelect
															value={formValues.shadowsocksNetwork || ""}
															options={shadowsocksNetworkOptions}
															placeholder={t("inbounds.shadowsocks.network")}
															onChange={(value) =>
																form.setValue(
																	"shadowsocksNetwork",
																	String(
																		value,
																	) as InboundFormValues["shadowsocksNetwork"],
																	{
																		shouldDirty: true,
																		shouldValidate: true,
																	},
																)
															}
														/>
													</FormControl>
												</div>
												<FormControl className="flex items-center">
													<FormLabel className="mb-0" helpKey="inbounds.shadowsocks.ivCheckHelp">{t("inbounds.shadowsocks.ivCheck")}</FormLabel>
													<Controller control={control} name={"shadowsocksIvCheck"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
												</FormControl>
											</div>
										)}
										{currentProtocol === "http" && (
											<div className="flex flex-col gap-3">
												<div className="flex justify-between items-center">
													<p className="font-medium">
														{t("inbounds.http.accounts")}
													</p>
													<Button onClick={() =>
															appendHttpAccount({ user: "", pass: "" })
														} size="xs">
														{t("inbounds.accounts.add")}
													</Button>
												</div>
												<div className="flex flex-col gap-3">
													{httpAccountFields.map((field, index) => (
														<div key={field.id} className={cn("border rounded-md p-3", sectionBorder)}>
															<div className="flex justify-between items-center mb-3">
																<p className="font-semibold">
																	{t("inbounds.accounts.label")} #{index + 1}
																</p>
																<Button onClick={() => removeHttpAccount(index)} variant="ghost" size="xs" className="text-destructive hover:bg-destructive/10">
																	{t("delete")}
																</Button>
															</div>
															<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
																<FormControl>
																	<FormLabel helpKey="usernameHelp">{t("username")}</FormLabel>
																	<Input
																		{...register(
																			`httpAccounts.${index}.user` as const,
																		)}
																	/>
																</FormControl>
																<FormControl>
																	<FormLabel helpKey="passwordHelp">{t("password")}</FormLabel>
																	<Input
																		{...register(
																			`httpAccounts.${index}.pass` as const,
																		)}
																	/>
																</FormControl>
															</div>
														</div>
													))}
													{!httpAccountFields.length && (
														<p className="text-[0.875rem] text-gray-500">
															{t("inbounds.http.noAccountsHint")}
														</p>
													)}
												</div>
												<FormControl className="flex items-center">
													<FormLabel className="mb-0" helpKey="inbounds.http.allowTransparentHelp">{t("inbounds.http.allowTransparent")}</FormLabel>
													<Controller control={control} name={"httpAllowTransparent"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
												</FormControl>
											</div>
										)}
										{currentProtocol === "socks" && (
											<div className="flex flex-col gap-3">
												<FormControl className="flex items-center">
													<FormLabel className="mb-0" helpKey="inbounds.socks.udpHelp">{t("inbounds.socks.udp")}</FormLabel>
													<Controller control={control} name={"socksUdpEnabled"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
												</FormControl>
												{socksUdpEnabled && (
													<FormControl>
														<FormLabel helpKey="inbounds.socks.udpIpHelp">{t("inbounds.socks.udpIp")}</FormLabel>
														<Input
															{...register("socksUdpIp")}
															placeholder="127.0.0.1"
														/>
													</FormControl>
												)}
												<FormControl className="flex items-center">
													<FormLabel className="mb-0" helpKey="inbounds.socks.authHelp">{t("inbounds.socks.auth")}</FormLabel>
													<Controller
														control={control}
														name="socksAuth"
														render={({ field }) => (
															<Switch checked={field.value === "password"} onCheckedChange={(checked: boolean) => field.onChange(
																		checked
																			? "password"
																			: "noauth",
																	)} />
														)}
													/>
												</FormControl>
												{socksAuth === "password" && (
													<div className="flex flex-col gap-3">
														<div className="flex justify-between items-center">
															<p className="font-medium">
																{t("inbounds.socks.accounts")}
															</p>
															<Button onClick={() =>
																	appendSocksAccount({ user: "", pass: "" })
																} size="xs">
																{t("inbounds.accounts.add")}
															</Button>
														</div>
														{socksAccountFields.map((field, index) => (
															<div key={field.id} className={cn("border rounded-md p-3", sectionBorder)}>
																<div className="flex justify-between items-center mb-3">
																	<p className="font-semibold">
																		{t("inbounds.accounts.label")} #{index + 1}
																	</p>
																	<Button onClick={() => removeSocksAccount(index)} variant="ghost" size="xs" className="text-destructive hover:bg-destructive/10">
																		{t("delete")}
																	</Button>
																</div>
																<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
																	<FormControl>
																		<FormLabel helpKey="usernameHelp">{t("username")}</FormLabel>
																		<Input
																			{...register(
																				`socksAccounts.${index}.user` as const,
																			)}
																		/>
																	</FormControl>
																	<FormControl>
																		<FormLabel helpKey="passwordHelp">{t("password")}</FormLabel>
																		<Input
																			{...register(
																				`socksAccounts.${index}.pass` as const,
																			)}
																		/>
																	</FormControl>
																</div>
															</div>
														))}
														{!socksAccountFields.length && (
															<p className="text-[0.875rem] text-gray-500">
																{t("inbounds.socks.noAccountsHint")}
															</p>
														)}
													</div>
												)}
											</div>
										)}
										{currentProtocol === "ssh" && (
											<div className="flex flex-col gap-4">
												<Alert className="rounded-md">
													<TriangleAlert className="size-4" aria-hidden="true" />
													<AlertDescription className="text-[0.875rem]">
														{t("inbounds.ssh.securityHelp")}
													</AlertDescription>
												</Alert>
												<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
													<FormControl isInvalid={Boolean(
															fieldValidationErrors.sshUserLimit,
														)}>
														<FormLabel helpKey="inbounds.ssh.userLimitHelp">{t("inbounds.ssh.userLimit")}</FormLabel>
														<FormNumberField control={control} name="sshUserLimit" inputMode="numeric"
															min={0}
															max={64}
															/>
														<FieldError>
															{fieldValidationErrors.sshUserLimit}
														</FieldError>
													</FormControl>
													<FormControl isInvalid={Boolean(
															fieldValidationErrors.sshIdleTimeout,
														)}>
														<FormLabel helpKey="inbounds.ssh.idleTimeoutHelp">{t("inbounds.ssh.idleTimeout")}</FormLabel>
														<FormNumberField control={control} name="sshIdleTimeout" inputMode="numeric"
															min={30}
															max={86400}
															/>
														<FieldError>
															{fieldValidationErrors.sshIdleTimeout}
														</FieldError>
													</FormControl>
												</div>
											</div>
										)}
										{currentProtocol === "mtproto" && (
											<div className="flex flex-col gap-4">
												<Alert className="rounded-md">
													<Info className="size-4" aria-hidden="true" />
													<AlertDescription className="text-[0.875rem]">
														{t("inbounds.mtproto.inboundOnlyHelp")}
													</AlertDescription>
												</Alert>
												<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
													<FormControl required isInvalid={Boolean(
															fieldValidationErrors.mtPublicHost,
														)}>
														<FormLabel helpKey="inbounds.mtproto.publicHostHelp">{t("inbounds.mtproto.publicHost")}</FormLabel>
														<Input {...register("mtPublicHost")}
															placeholder="proxy.example.com"
														/>
														<FieldError>
															{fieldValidationErrors.mtPublicHost}
														</FieldError>
													</FormControl>
													<FormControl required isInvalid={Boolean(fieldValidationErrors.mtSecret)}>
														<FormLabel helpKey="inbounds.mtproto.secretHelp">{t("inbounds.mtproto.secret")}</FormLabel>
														<div className="flex flex-row items-center gap-2">
															<Input {...register("mtSecret")} className="font-mono" />
															<Button aria-label={t("inbounds.generateSecret")} onClick={() =>
																	form.setValue("mtSecret", randomHex(32), {
																		shouldDirty: true,
																		shouldValidate: true,
																	})
																} size="sm" className="size-8 p-0">{<Sparkles className="w-[16px]" />}</Button>
														</div>
														<FieldError>
															{fieldValidationErrors.mtSecret}
														</FieldError>
													</FormControl>
													<FormControl isInvalid={Boolean(
															fieldValidationErrors.mtSponsorTag,
														)}>
														<FormLabel helpKey="inbounds.mtproto.sponsorTagHelp">{t("inbounds.mtproto.sponsorTag")}</FormLabel>
														<Input {...register("mtSponsorTag")} className="font-mono" />
														<FieldError>
															{fieldValidationErrors.mtSponsorTag}
														</FieldError>
													</FormControl>
													<FormControl isInvalid={Boolean(
															fieldValidationErrors.mtTLSDomain,
														)}>
														<FormLabel helpKey="inbounds.mtproto.tlsDomainHelp">{t("inbounds.mtproto.tlsDomain")}</FormLabel>
														<Input
															{...register("mtTLSDomain")}
															disabled={!formValues.mtModeTLS}
															placeholder="www.google.com"
														/>
														<FieldError>
															{fieldValidationErrors.mtTLSDomain}
														</FieldError>
													</FormControl>
													<FormControl isInvalid={Boolean(
															fieldValidationErrors.mtUserLimit,
														)}>
														<FormLabel helpKey="inbounds.mtproto.userLimitHelp">{t("inbounds.mtproto.userLimit")}</FormLabel>
														<FormNumberField control={control} name="mtUserLimit" inputMode="numeric"
															min={0}
															max={64}
															/>
														<FieldError>
															{fieldValidationErrors.mtUserLimit}
														</FieldError>
													</FormControl>
													<FormControl isInvalid={Boolean(
															fieldValidationErrors.mtMaxConnections,
														)}>
														<FormLabel helpKey="inbounds.mtproto.maxConnectionsHelp">{t("inbounds.mtproto.maxConnections")}</FormLabel>
														<FormNumberField control={control} name="mtMaxConnections" inputMode="numeric"
															min={0}
															/>
														<FieldError>
															{fieldValidationErrors.mtMaxConnections}
														</FieldError>
													</FormControl>
												</div>
												<FormControl isInvalid={Boolean(
														fieldValidationErrors.mtModeClassic,
													)}>
													<FormLabel helpKey="inbounds.mtproto.connectionModesHelp">{t("inbounds.mtproto.connectionModes")}</FormLabel>
													<div className="flex flex-row items-center gap-6 flex-wrap">
														<label htmlFor="mt-mode-classic" className="flex cursor-pointer items-center gap-2 text-sm"><Controller control={control} name={"mtModeClassic"} render={({ field }) => <Checkbox id="mt-mode-classic" checked={Boolean(field.value)} onCheckedChange={field.onChange} />} /><span>{t("inbounds.mtproto.modeClassic")}</span></label>
														<label htmlFor="mt-mode-secure" className="flex cursor-pointer items-center gap-2 text-sm"><Controller control={control} name={"mtModeSecure"} render={({ field }) => <Checkbox id="mt-mode-secure" checked={Boolean(field.value)} onCheckedChange={field.onChange} />} /><span>{t("inbounds.mtproto.modeSecure")}</span></label>
														<label htmlFor="mt-mode-tls" className="flex cursor-pointer items-center gap-2 text-sm"><Controller control={control} name={"mtModeTLS"} render={({ field }) => <Checkbox id="mt-mode-tls" checked={Boolean(field.value)} onCheckedChange={field.onChange} />} /><span>{t("inbounds.mtproto.modeTLS")}</span></label>
													</div>
													<FieldError>
														{fieldValidationErrors.mtModeClassic}
													</FieldError>
												</FormControl>
												{formValues.mtPublicHost && (
													<div className="flex flex-col gap-1">
														{[
															[formValues.mtModeClassic, formValues.mtSecret],
															[
																formValues.mtModeSecure,
																`dd${formValues.mtSecret}`,
															],
															[
																formValues.mtModeTLS,
																`ee${formValues.mtSecret}${utf8ToHex(
																	formValues.mtTLSDomain,
																)}`,
															],
														]
															.filter(([enabled]) => enabled)
															.map(([, secret]) => (
																<p key={String(secret)} className="text-[0.75rem] font-mono break-all">
																	{`https://t.me/proxy?server=${formValues.mtPublicHost}&port=${formValues.port}&secret=${secret}`}
																</p>
															))}
													</div>
												)}
											</div>
										)}
										{currentProtocol === "web" && (
											<div className="flex flex-col gap-4">
												<Alert className="rounded-md">
													<TriangleAlert className="size-4" aria-hidden="true" />
													<AlertDescription className="text-[0.875rem]">
														{t("inbounds.web.dedicatedNodeHelp")}
													</AlertDescription>
												</Alert>
												<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
													<FormControl required isInvalid={Boolean(
															fieldValidationErrors.webHostname,
														)}>
														<FormLabel helpKey="inbounds.web.hostnameHelp">{t("inbounds.web.hostname")}</FormLabel>
														<Input {...register("webHostname")}
															placeholder="proxy.example.com"
														/>
														<FieldError>
															{fieldValidationErrors.webHostname}
														</FieldError>
													</FormControl>
													<FormControl required isInvalid={Boolean(
															fieldValidationErrors.webACMEEmail,
														)}>
														<FormLabel helpKey="inbounds.web.acmeEmailHelp">{t("inbounds.web.acmeEmail")}</FormLabel>
														<Input type="email" {...register("webACMEEmail")} />
														<FieldError>
															{fieldValidationErrors.webACMEEmail}
														</FieldError>
													</FormControl>
													<FormControl required isInvalid={Boolean(fieldValidationErrors.webSecret)}>
														<FormLabel helpKey="inbounds.web.secretHelp">{t("inbounds.web.secret")}</FormLabel>
														<div className="flex flex-row items-center gap-2">
															<Input {...register("webSecret")} className="font-mono" />
															<Button aria-label={t("inbounds.generateSecret")} onClick={() =>
																	form.setValue("webSecret", randomHex(32), {
																		shouldDirty: true,
																		shouldValidate: true,
																	})
																} size="sm" className="size-8 p-0">{<Sparkles className="w-[16px]" />}</Button>
														</div>
														<FieldError>
															{fieldValidationErrors.webSecret}
														</FieldError>
													</FormControl>
													<FormControl isInvalid={Boolean(
															fieldValidationErrors.webSiteUpstream,
														)}>
														<div className="mb-1 flex min-w-0 items-center gap-1.5"><FormLabel className="mb-0">{t("inbounds.web.siteUpstream")}</FormLabel><FieldHint>{t("inbounds.web.siteUpstreamHelp")}</FieldHint></div>
														<Input
															{...register("webSiteUpstream")}
															placeholder="http://127.0.0.1:3000"
														/>
														<FieldError>
															{fieldValidationErrors.webSiteUpstream}
														</FieldError>
													</FormControl>
												</div>
												{formValues.webHostname && (
													<p className="text-[0.75rem] font-mono break-all">{`https://t.me/webproxy?server=${formValues.webHostname}&secret=${formValues.webSecret}`}</p>
												)}
											</div>
										)}
										{currentProtocol === "openvpn" && (
											<div className="flex flex-col gap-3">
												<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
													<FormControl>
														{ovLabel(
															"inbounds.openvpn.transport",
															"Transport",
															"inbounds.openvpn.help.transport",
															"Select UDP for the usual OpenVPN mode, or TCP when UDP is blocked by the network.",
														)}
														<SearchableTagSelect
															value={formValues.ovTransport || "udp"}
															options={["udp", "tcp"]}
															placeholder={t("inbounds.openvpn.transport")}
															onChange={(value) =>
																form.setValue(
																	"ovTransport",
																	String(
																		value,
																	) as InboundFormValues["ovTransport"],
																	{
																		shouldDirty: true,
																		shouldValidate: true,
																	},
																)
															}
														/>
													</FormControl>
													<FormControl required={ovTproxyEnabled} isInvalid={Boolean(
															fieldValidationErrors.ovTunnelPort,
														)}>
														{ovLabel(
															"inbounds.openvpn.tunnelPort",
															"Tunnel port",
															"inbounds.openvpn.help.tunnelPort",
															"Internal Xray tunnel port used by nftables/TProxy. It must be unique and different from the public OpenVPN port.",
														)}
														<Input
															{...register("ovTunnelPort")}
															placeholder="41940"
															disabled={!ovTproxyEnabled}
														/>
														{fieldValidationErrors.ovTunnelPort && (
															<p className="text-[0.75rem] text-red-500 mt-1">
																{fieldValidationErrors.ovTunnelPort}
															</p>
														)}
													</FormControl>
												</div>
												<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
													<FormControl required isInvalid={Boolean(
															fieldValidationErrors.ovIPv4Pool,
														)}>
														{ovLabel(
															"inbounds.openvpn.ipv4Pool",
															"IPv4 pool CIDR",
															"inbounds.openvpn.help.ipv4Pool",
															"Private IPv4 range assigned to OpenVPN users. Each user receives a deterministic address from this pool.",
														)}
														<Input
															{...register("ovIPv4Pool")}
															placeholder="10.66.0.0/16"
														/>
														{fieldValidationErrors.ovIPv4Pool && (
															<p className="text-[0.75rem] text-red-500 mt-1">
																{fieldValidationErrors.ovIPv4Pool}
															</p>
														)}
													</FormControl>
													<FormControl>
														{ovLabel(
															"inbounds.openvpn.dns",
															"DNS servers",
															"inbounds.openvpn.help.dns",
															"DNS resolvers pushed to OpenVPN clients, one IPv4 address per line.",
														)}
														<Textarea
															rows={3}
															{...register("ovDNSServers")}
															placeholder={"1.1.1.1\n8.8.8.8"}
														/>
													</FormControl>
												</div>
												<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
													<FormControl isInvalid={Boolean(fieldValidationErrors.ovCipher)}>
														{ovLabel(
															"inbounds.openvpn.cipher",
															"Cipher",
															"inbounds.openvpn.help.cipher",
															"Optional OpenVPN data cipher. Leave empty to use the OpenVPN default for your installed version.",
														)}
														<Input
															{...register("ovCipher")}
															placeholder="AES-256-GCM"
														/>
														{fieldValidationErrors.ovCipher && (
															<p className="text-[0.75rem] text-red-500 mt-1">
																{fieldValidationErrors.ovCipher}
															</p>
														)}
													</FormControl>
													<FormControl>
														{ovLabel(
															"inbounds.openvpn.auth",
															"Auth digest",
															"inbounds.openvpn.help.auth",
															"Optional packet authentication digest such as SHA256. Leave empty to use OpenVPN defaults.",
														)}
														<Input
															{...register("ovAuth")}
															placeholder="SHA256"
														/>
													</FormControl>
												</div>
												<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
													<FormControl className="flex items-center">
														{ovLabel(
															"inbounds.openvpn.redirectGateway",
															"Redirect gateway",
															"inbounds.openvpn.help.redirectGateway",
															"Push the default route to clients so all client traffic enters the VPN.",
															{ className: "mb-0" },
														)}
														<Controller control={control} name={"ovRedirectGateway"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
													</FormControl>
													<FormControl className="flex items-center">
														{ovLabel(
															"inbounds.openvpn.tproxy",
															"Route through Xray",
															"inbounds.openvpn.help.tproxy",
															"Forward OpenVPN client traffic into Xray so routing rules and Xray outbounds apply. Disable for direct NAT egress from the node.",
															{ className: "mb-0" },
														)}
														<Controller control={control} name={"ovTproxyEnabled"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
													</FormControl>
													<FormControl className="flex items-center">
														{ovLabel(
															"inbounds.openvpn.requireDco",
															"Require DCO",
															"inbounds.openvpn.help.requireDco",
															"Require OpenVPN data channel offload on the node. If the kernel or OpenVPN build cannot use DCO, this inbound is rejected instead of falling back.",
															{ className: "mb-0" },
														)}
														<Controller control={control} name={"ovRequireDCO"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
													</FormControl>
													<FormControl className="flex items-center">
														{ovLabel(
															"inbounds.openvpn.accounting",
															"Enable accounting",
															"inbounds.openvpn.help.accounting",
															"Record OpenVPN session traffic and report it to the same Rebecca user quota/accounting pipeline.",
															{ className: "mb-0" },
														)}
														<Controller control={control} name={"ovAccountingEnabled"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
													</FormControl>
												</div>
												<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
													<FormControl className="flex items-center">
														{ovLabel(
															"inbounds.openvpn.inlineCa",
															"Embed CA in profile",
															"inbounds.openvpn.help.inlineCa",
															"Include the CA certificate inside generated .ovpn files. Disable only if clients will receive the CA by another secure method.",
															{ className: "mb-0" },
														)}
														<Controller control={control} name={"ovInlineCA"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
													</FormControl>
													<FormControl className="flex items-center">
														{ovLabel(
															"inbounds.openvpn.setClientCertNone",
															"Disable external certificate prompt",
															"inbounds.openvpn.help.setClientCertNone",
															"Add setenv CLIENT_CERT 0 so OpenVPN Connect does not ask for a separate client certificate.",
															{ className: "mb-0" },
														)}
														<Controller control={control} name={"ovSetClientCertNone"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
													</FormControl>
													<FormControl className="flex items-center">
														{ovLabel(
															"inbounds.openvpn.authNoCache",
															"Do not cache password",
															"inbounds.openvpn.help.authNoCache",
															"Add auth-nocache so the client does not keep the VPN password in memory after authentication.",
															{ className: "mb-0" },
														)}
														<Controller control={control} name={"ovAuthNoCache"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
													</FormControl>
													<FormControl className="flex items-center">
														{ovLabel(
															"inbounds.openvpn.embedCredentials",
															"Embed user credentials",
															"inbounds.openvpn.help.embedCredentials",
															"Include username and generated password inside the .ovpn profile. Disable to make clients ask for credentials.",
															{ className: "mb-0" },
														)}
														<Controller control={control} name={"ovEmbedCredentials"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
													</FormControl>
													<FormControl className="flex items-center">
														{ovLabel(
															"inbounds.openvpn.routeNoPull",
															"Ignore pushed routes",
															"inbounds.openvpn.help.routeNoPull",
															"Add route-nopull so clients connect but ignore routes pushed by the server.",
															{ className: "mb-0" },
														)}
														<Controller control={control} name={"ovRouteNoPull"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
													</FormControl>
													<FormControl className="flex items-center">
														{ovLabel(
															"inbounds.openvpn.blockOutsideDns",
															"Block outside DNS",
															"inbounds.openvpn.help.blockOutsideDns",
															"Add block-outside-dns for Windows clients to reduce DNS leaks outside the VPN.",
															{ className: "mb-0" },
														)}
														<Controller control={control} name={"ovBlockOutsideDNS"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
													</FormControl>
												</div>
												<FormControl isInvalid={Boolean(
														fieldValidationErrors.ovManagementPort,
													)}>
													{ovLabel(
														"inbounds.openvpn.managementPort",
														"Management port",
														"inbounds.openvpn.help.managementPort",
														"Optional local OpenVPN management port used by the node process. Leave empty unless you need explicit control.",
													)}
													<Input
														{...register("ovManagementPort")}
														placeholder="7505"
													/>
													{fieldValidationErrors.ovManagementPort && (
														<p className="text-[0.75rem] text-red-500 mt-1">
															{fieldValidationErrors.ovManagementPort}
														</p>
													)}
												</FormControl>
												<div>
													<Button onClick={handleGenerateOVSelfSigned} size="sm" loading={ovCertLoading}>{<Sparkles className="w-[16px]" />}
														{t("inbounds.openvpn.generateSelfSigned")}
													</Button>
												</div>
												<FormControl required isInvalid={Boolean(fieldValidationErrors.ovCA)}>
													{ovLabel(
														"inbounds.openvpn.ca",
														"CA certificate",
														"inbounds.openvpn.help.ca",
														"Certificate authority used to sign the OpenVPN server certificate. A self-signed CA is fine for personal use.",
													)}
													<Textarea rows={4} {...register("ovCA")} />
													{fieldValidationErrors.ovCA && (
														<p className="text-[0.75rem] text-red-500 mt-1">
															{fieldValidationErrors.ovCA}
														</p>
													)}
												</FormControl>
												<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
													<FormControl required isInvalid={Boolean(
															fieldValidationErrors.ovServerCertificate,
														)}>
														{ovLabel(
															"inbounds.openvpn.serverCertificate",
															"Server certificate",
															"inbounds.openvpn.help.serverCertificate",
															"OpenVPN server certificate signed by the CA above. Clients verify the server with this trust chain.",
														)}
														<Textarea
															rows={4}
															{...register("ovServerCertificate")}
														/>
														{fieldValidationErrors.ovServerCertificate && (
															<p className="text-[0.75rem] text-red-500 mt-1">
																{fieldValidationErrors.ovServerCertificate}
															</p>
														)}
													</FormControl>
													<FormControl required isInvalid={Boolean(
															fieldValidationErrors.ovServerKey,
														)}>
														{ovLabel(
															"inbounds.openvpn.serverKey",
															"Server key",
															"inbounds.openvpn.help.serverKey",
															"Private key for the OpenVPN server certificate. Keep it private; it is written only to the node's OpenVPN config.",
														)}
														<Textarea rows={4} {...register("ovServerKey")} />
														{fieldValidationErrors.ovServerKey && (
															<p className="text-[0.75rem] text-red-500 mt-1">
																{fieldValidationErrors.ovServerKey}
															</p>
														)}
													</FormControl>
												</div>
												<FormControl>
													{ovLabel(
														"inbounds.openvpn.dh",
														"DH parameters",
														"inbounds.openvpn.help.dh",
														"Optional Diffie-Hellman parameters for older TLS modes. Usually not needed with modern ECDHE/OpenVPN setups.",
													)}
													<Textarea rows={4} {...register("ovDH")} />
												</FormControl>
												<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
													<FormControl>
														{ovLabel(
															"inbounds.openvpn.tlsCrypt",
															"tls-crypt",
															"inbounds.openvpn.help.tlsCrypt",
															"Optional static key that encrypts and authenticates the OpenVPN control channel.",
														)}
														<Textarea rows={4} {...register("ovTlsCrypt")} />
													</FormControl>
													<FormControl>
														{ovLabel(
															"inbounds.openvpn.tlsAuth",
															"tls-auth",
															"inbounds.openvpn.help.tlsAuth",
															"Optional static HMAC key for authenticating the OpenVPN control channel.",
														)}
														<Textarea rows={4} {...register("ovTlsAuth")} />
													</FormControl>
												</div>
												<FormControl>
													{ovLabel(
														"inbounds.openvpn.extraClient",
														"Extra client config",
														"inbounds.openvpn.help.extraClient",
														"Extra directives appended to generated client profiles. Use only valid OpenVPN client options.",
													)}
													<Textarea
														rows={4}
														{...register("ovExtraClientConfig")}
													/>
												</FormControl>
											</div>
										)}
										{(currentProtocol === "wireguard" ||
											currentProtocol === "amneziawg") && (
											<div className="flex flex-col gap-3">
												<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
													<FormControl required={wgTproxyEnabled} isInvalid={Boolean(
															fieldValidationErrors.wgTunnelPort,
														)}>
														{ovLabel(
															"inbounds.wireguard.tunnelPort",
															"Tunnel port",
															"inbounds.wireguard.help.tunnelPort",
															"Internal Xray tunnel port used by nftables/TProxy. It must be unique and different from the public WireGuard port.",
														)}
														<Input
															{...register("wgTunnelPort")}
															placeholder="51821"
															disabled={!wgTproxyEnabled}
														/>
														{fieldValidationErrors.wgTunnelPort && (
															<p className="text-[0.75rem] text-red-500 mt-1">
																{fieldValidationErrors.wgTunnelPort}
															</p>
														)}
													</FormControl>
													<FormControl required isInvalid={Boolean(
															fieldValidationErrors.wgIPv4Pool,
														)}>
														{ovLabel(
															"inbounds.wireguard.ipv4Pool",
															"IPv4 pool CIDR",
															"inbounds.wireguard.help.ipv4Pool",
															"Private IPv4 range assigned to WireGuard users. Each user receives a deterministic address from this pool.",
														)}
														<Input
															{...register("wgIPv4Pool")}
															placeholder="10.69.0.0/16"
														/>
														{fieldValidationErrors.wgIPv4Pool && (
															<p className="text-[0.75rem] text-red-500 mt-1">
																{fieldValidationErrors.wgIPv4Pool}
															</p>
														)}
													</FormControl>
												</div>
												<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
													<FormControl required isInvalid={Boolean(
															fieldValidationErrors.wgServerAddress,
														)}>
														{ovLabel(
															"inbounds.wireguard.serverAddress",
															"Server address",
															"inbounds.wireguard.help.serverAddress",
															"WireGuard address assigned to the server interface. Keep it inside the selected IPv4 pool.",
														)}
														<Input
															{...register("wgServerAddress")}
															placeholder="10.69.0.1/16"
														/>
														{fieldValidationErrors.wgServerAddress && (
															<p className="text-[0.75rem] text-red-500 mt-1">
																{fieldValidationErrors.wgServerAddress}
															</p>
														)}
													</FormControl>
													<FormControl isInvalid={Boolean(fieldValidationErrors.wgMTU)}>
														{ovLabel(
															"inbounds.wireguard.mtu",
															"MTU",
															"inbounds.wireguard.help.mtu",
															"WireGuard interface MTU. 1420 is the common default; lower it only for path-specific fragmentation issues.",
														)}
														<FormNumberField control={control} name="wgMTU" inputMode="numeric" placeholder="1420" />
														{fieldValidationErrors.wgMTU && (
															<p className="text-[0.75rem] text-red-500 mt-1">
																{fieldValidationErrors.wgMTU}
															</p>
														)}
													</FormControl>
												</div>
												<FormControl isInvalid={Boolean(
														fieldValidationErrors.wgPersistentKeepalive,
													)}>
													{ovLabel(
														"inbounds.wireguard.persistentKeepalive",
														"Persistent keepalive",
														"inbounds.wireguard.help.persistentKeepalive",
														"Seconds between client keepalive packets. 25 helps clients behind NAT stay reachable; 0 disables it.",
													)}
													<Input
														{...register("wgPersistentKeepalive")}
														placeholder="25"
													/>
													{fieldValidationErrors.wgPersistentKeepalive && (
														<p className="text-[0.75rem] text-red-500 mt-1">
															{fieldValidationErrors.wgPersistentKeepalive}
														</p>
													)}
												</FormControl>
												{currentProtocol === "amneziawg" && (
													<div className="flex flex-col gap-3">
														<Alert className="rounded-md">
															<Info className="size-4" aria-hidden="true" />
															<AlertDescription className="text-[0.875rem]">
																{t("inbounds.amneziawg.help")}
															</AlertDescription>
														</Alert>
														<div className="grid grid-cols-2 md:grid-cols-3 gap-3">
															{(
																[
																	"awgJc",
																	"awgJmin",
																	"awgJmax",
																	"awgS1",
																	"awgS2",
																	"awgH1",
																	"awgH2",
																	"awgH3",
																	"awgH4",
																] as const
															).map((name) => (
																<FormControl key={name} isInvalid={Boolean(
																		fieldValidationErrors[name],
																	)}>
																	<FormLabel>
																		{t(`inbounds.amneziawg.${name}`)}
																	</FormLabel>
																	<Input {...register(name)} />
																	{fieldValidationErrors[name] && (
																		<p className="text-[0.75rem] text-red-500 mt-1">
																			{fieldValidationErrors[name]}
																		</p>
																	)}
																</FormControl>
															))}
														</div>
													</div>
												)}
												<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
													<FormControl className="flex items-center">
														{ovLabel(
															"inbounds.wireguard.tproxy",
															"Route through Xray",
															"inbounds.wireguard.help.tproxy",
															"Forward WireGuard client traffic into Xray so routing rules and Xray outbounds apply. Disable for direct NAT egress from the node.",
															{ className: "mb-0" },
														)}
														<Controller control={control} name={"wgTproxyEnabled"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
													</FormControl>
													<FormControl className="flex items-center">
														{ovLabel(
															"inbounds.wireguard.accounting",
															"Enable accounting",
															"inbounds.wireguard.help.accounting",
															"Record WireGuard peer traffic and report it to the same Rebecca user quota/accounting pipeline.",
															{ className: "mb-0" },
														)}
														<Controller control={control} name={"wgAccountingEnabled"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
													</FormControl>
												</div>
												<div>
													<Button onClick={handleGenerateWGKeypair} size="sm" loading={wgKeyLoading}>{<Sparkles className="w-[16px]" />}
														{t("inbounds.wireguard.generateKeys")}
													</Button>
												</div>
												<FormControl required isInvalid={Boolean(
														fieldValidationErrors.wgPrivateKey,
													)}>
													{ovLabel(
														"inbounds.wireguard.privateKey",
														"Private key",
														"inbounds.wireguard.help.privateKey",
														"Private key used by the WireGuard server interface. Generate a key pair here unless you already have one.",
													)}
													<Textarea rows={2} {...register("wgPrivateKey")} />
													{fieldValidationErrors.wgPrivateKey && (
														<p className="text-[0.75rem] text-red-500 mt-1">
															{fieldValidationErrors.wgPrivateKey}
														</p>
													)}
												</FormControl>
												<FormControl>
													{ovLabel(
														"inbounds.wireguard.publicKey",
														"Public key",
														"inbounds.wireguard.help.publicKey",
														"Server public key shown for reference and future profile generation. The node derives the runtime key from the private key.",
													)}
													<Input {...register("wgPublicKey")} readOnly />
												</FormControl>
											</div>
										)}
										{currentProtocol === "sstp" && (
											<div className="flex flex-col gap-4">
												<Alert className="rounded-md">
													<Info className="size-4" aria-hidden="true" />
													<AlertDescription className="text-[0.875rem]">
														{t("inbounds.sstp.help")}
													</AlertDescription>
												</Alert>
												<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
													<FormControl isInvalid={Boolean(
															fieldValidationErrors.raIPv4Pool,
														)}>
														<FormLabel helpKey="inbounds.sstp.ipv4PoolHelp">{t("inbounds.sstp.ipv4Pool")}</FormLabel>
														<Input
															{...register("raIPv4Pool")}
															placeholder="10.72.0.0/16"
														/>
														<FieldError>
															{fieldValidationErrors.raIPv4Pool}
														</FieldError>
													</FormControl>
													<FormControl isInvalid={Boolean(
															fieldValidationErrors.raTunnelPort,
														)}>
														<FormLabel helpKey="inbounds.sstp.tunnelPortHelp">{t("inbounds.sstp.tunnelPort")}</FormLabel>
														<Input
															{...register("raTunnelPort")}
															disabled={!raTproxyEnabled}
														/>
														<FieldError>
															{fieldValidationErrors.raTunnelPort}
														</FieldError>
													</FormControl>
													<FormControl>
														<FormLabel helpKey="inbounds.sstp.mtuHelp">{t("inbounds.sstp.mtu")}</FormLabel>
														<FormNumberField control={control} name="raMTU" inputMode="numeric" placeholder="1400" />
													</FormControl>
												</div>
												<FormControl>
													<FormLabel helpKey="inbounds.sstp.dnsHelp">{t("inbounds.sstp.dns")}</FormLabel>
													<Textarea
														{...register("raDNSServers")}
														rows={2}
														placeholder={"1.1.1.1\n8.8.8.8"}
													/>
												</FormControl>
												<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
													<FormControl className="flex items-center">
														<FormLabel className="mb-0" helpKey="inbounds.routeThroughXrayHelp">{t("inbounds.routeThroughXray")}</FormLabel>
														<Controller control={control} name={"raTproxyEnabled"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
													</FormControl>
													<FormControl className="flex items-center">
														<FormLabel className="mb-0" helpKey="inbounds.enableAccountingHelp">{t("inbounds.enableAccounting")}</FormLabel>
														<Controller control={control} name={"raAccountingEnabled"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
													</FormControl>
												</div>
												<FormControl required isInvalid={Boolean(
														fieldValidationErrors.raServerCertificate,
													)}>
													<FormLabel helpKey="inbounds.sstp.serverCertificateHelp">{t("inbounds.sstp.serverCertificate")}</FormLabel>
													<Textarea
														{...register("raServerCertificate")}
														rows={4}
													/>
													<FieldError>
														{fieldValidationErrors.raServerCertificate}
													</FieldError>
												</FormControl>
												<FormControl required isInvalid={Boolean(fieldValidationErrors.raServerKey)}>
													<FormLabel helpKey="inbounds.sstp.serverKeyHelp">{t("inbounds.sstp.serverKey")}</FormLabel>
													<Textarea {...register("raServerKey")} rows={4} />
													<FieldError>
														{fieldValidationErrors.raServerKey}
													</FieldError>
												</FormControl>
											</div>
										)}
										{currentProtocol === "gre" && (
											<div className="flex flex-col gap-4">
												<Alert className="rounded-md">
													<TriangleAlert className="size-4" aria-hidden="true" />
													<AlertDescription className="text-[0.875rem]">
														{t("inbounds.gre.help")}
													</AlertDescription>
												</Alert>
												<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
													<FormControl isInvalid={Boolean(
															fieldValidationErrors.raIPv4Pool,
														)}>
														<FormLabel helpKey="inbounds.gre.ipv4PoolHelp">{t("inbounds.gre.ipv4Pool")}</FormLabel>
														<Input
															{...register("raIPv4Pool")}
															placeholder="10.74.0.0/16"
														/>
														<FieldError>
															{fieldValidationErrors.raIPv4Pool}
														</FieldError>
													</FormControl>
													<FormControl isInvalid={Boolean(
															fieldValidationErrors.raTunnelPort,
														)}>
														<FormLabel helpKey="inbounds.gre.tunnelPortHelp">{t("inbounds.gre.tunnelPort")}</FormLabel>
														<Input
															{...register("raTunnelPort")}
															disabled={!raTproxyEnabled}
														/>
														<FieldError>
															{fieldValidationErrors.raTunnelPort}
														</FieldError>
													</FormControl>
													<FormControl isInvalid={Boolean(
															fieldValidationErrors.greLocalAddress,
													)}>
														<FormLabel helpKey="inbounds.gre.localAddressHelp">{t("inbounds.gre.localAddress")}</FormLabel>
														<Input
															{...register("greLocalAddress")}
															placeholder="203.0.113.10"
														/>
														<FieldError>
															{fieldValidationErrors.greLocalAddress}
														</FieldError>
												</FormControl>
													<div className="grid grid-cols-2 gap-3">
														<FormControl isInvalid={Boolean(fieldValidationErrors.greMTU)}>
															<FormLabel helpKey="inbounds.gre.mtuHelp">{t("inbounds.gre.mtu")}</FormLabel>
															<FormNumberField control={control} name="greMTU" inputMode="numeric" />
														</FormControl>
														<FormControl isInvalid={Boolean(fieldValidationErrors.greTTL)}>
															<FormLabel helpKey="inbounds.gre.ttlHelp">{t("inbounds.gre.ttl")}</FormLabel>
															<FormNumberField control={control} name="greTTL" inputMode="numeric" />
														</FormControl>
													</div>
												</div>
												<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
													<FormControl className="flex items-center">
														<FormLabel className="mb-0" helpKey="inbounds.routeThroughXrayHelp">{t("inbounds.routeThroughXray")}</FormLabel>
														<Controller control={control} name={"raTproxyEnabled"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
													</FormControl>
													<FormControl className="flex items-center">
														<FormLabel className="mb-0" helpKey="inbounds.enableAccountingHelp">{t("inbounds.enableAccounting")}</FormLabel>
														<Controller control={control} name={"raAccountingEnabled"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
												</FormControl>
												</div>
											</div>
										)}
										{(currentProtocol === "ikev2" ||
											currentProtocol === "anyconnect") && (
											<div className="flex flex-col gap-3">
												<Alert className="rounded-md">
													<Info className="size-4" aria-hidden="true" />
													<AlertDescription className="text-[0.875rem]">
														{currentProtocol === "ikev2"
															? t("inbounds.ikev2.ports")
															: t("inbounds.anyconnect.ports")}
													</AlertDescription>
												</Alert>
												<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
													<FormControl required>
														{ovLabel(
															"inbounds.remoteAccess.authMode",
															"Authentication",
															"inbounds.remoteAccess.help.authMode",
															"Authenticate users with a password, a client certificate, or both.",
														)}
														<Controller
															control={control}
															name="raAuthMode"
															render={({ field }) => (
																<SearchableTagSelect
																	value={field.value}
																	onChange={field.onChange}
																	placeholder={t(
																		"inbounds.remoteAccess.authMode",
																	)}
																	options={[
																		{
																			value: "password",
																			label: t(
																				"inbounds.remoteAccess.password",
																			),
																		},
																		{
																			value: "certificate",
																			label: t(
																				"inbounds.remoteAccess.certificate",
																			),
																		},
																		{
																			value: "password+certificate",
																			label: t(
																				"inbounds.remoteAccess.passwordCertificate",
																			),
																		},
																	]}
																/>
															)}
														/>
													</FormControl>
													<FormControl required isInvalid={Boolean(
															fieldValidationErrors.raIPv4Pool,
														)}>
														{ovLabel(
															"inbounds.remoteAccess.ipv4Pool",
															"IPv4 pool CIDR",
															"inbounds.remoteAccess.help.ipv4Pool",
															"Private addresses assigned to connected users.",
														)}
														<Input
															{...register("raIPv4Pool")}
															placeholder={
																currentProtocol === "ikev2"
																	? "10.70.0.0/16"
																	: "10.71.0.0/16"
															}
														/>
														{fieldValidationErrors.raIPv4Pool && (
															<p className="text-[0.75rem] text-red-500">
																{fieldValidationErrors.raIPv4Pool}
															</p>
														)}
													</FormControl>
													<FormControl required={raTproxyEnabled} isInvalid={Boolean(
															fieldValidationErrors.raTunnelPort,
														)}>
														{ovLabel(
															"inbounds.remoteAccess.tunnelPort",
															"Xray tunnel port",
															"inbounds.remoteAccess.help.tunnelPort",
															"Local TProxy port used only when Route through Xray is enabled.",
														)}
														<Input
															{...register("raTunnelPort")}
															disabled={!raTproxyEnabled}
															placeholder="41943"
														/>
														{fieldValidationErrors.raTunnelPort && (
															<p className="text-[0.75rem] text-red-500">
																{fieldValidationErrors.raTunnelPort}
															</p>
														)}
													</FormControl>
													{currentProtocol === "anyconnect" && (
														<FormControl>
															{ovLabel(
																"inbounds.remoteAccess.mtu",
																"MTU",
																"inbounds.remoteAccess.help.mtu",
																"Tunnel MTU. 1400 is a compatible default for Internet paths.",
															)}
															<FormNumberField control={control} name="raMTU" inputMode="numeric" placeholder="1400" />
														</FormControl>
													)}
												</div>
												<FormControl>
													{ovLabel(
														"inbounds.remoteAccess.dns",
														"DNS servers",
														"inbounds.remoteAccess.help.dns",
														"DNS resolvers pushed to clients, one address per line.",
													)}
													<Textarea
														rows={2}
														{...register("raDNSServers")}
														placeholder={"1.1.1.1\n8.8.8.8"}
													/>
												</FormControl>
												<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
													<FormControl className="flex items-center">
														{ovLabel(
															"inbounds.remoteAccess.tproxy",
															"Route through Xray",
															"inbounds.remoteAccess.help.tproxy",
															"Apply Xray routing and outbounds to this inbound.",
															{ className: "mb-0" },
														)}
														<Controller control={control} name={"raTproxyEnabled"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
													</FormControl>
													<FormControl className="flex items-center">
														{ovLabel(
															"inbounds.remoteAccess.accounting",
															"Enable accounting",
															"inbounds.remoteAccess.help.accounting",
															"Report live usage to Rebecca quota accounting.",
															{ className: "mb-0" },
														)}
														<Controller control={control} name={"raAccountingEnabled"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
													</FormControl>
													<FormControl className="flex items-center">
														{ovLabel(
															"inbounds.remoteAccess.redirectGateway",
															"Redirect gateway",
															"inbounds.remoteAccess.help.redirectGateway",
															"Route all client traffic through the tunnel.",
															{ className: "mb-0" },
														)}
														<Controller control={control} name={"raRedirectGateway"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
													</FormControl>
												</div>
												{currentProtocol === "anyconnect" && (
													<div className="flex flex-col gap-2">
														<FormControl isInvalid={Boolean(errors.raCertificateNames)}>
															{ovLabel(
																"inbounds.anyconnect.certificateNames",
																"Certificate domains / IPs",
																"inbounds.anyconnect.help.certificateNames",
																"Domains and IPs stored in the generated certificate SAN, one per line.",
															)}
															<Textarea
																rows={2}
																{...register("raCertificateNames")}
																placeholder={"vpn.example.com\n203.0.113.10"}
															/>
															{errors.raCertificateNames?.message && (
																<p className="text-[0.75rem] text-red-500 mt-1">
																	{String(errors.raCertificateNames.message)}
																</p>
															)}
														</FormControl>
														<div>
															<Button onClick={handleGenerateAnyConnectSelfSigned} size="sm" loading={anyConnectCertLoading}>{<Sparkles className="w-[16px]" />}
																{t("inbounds.anyconnect.generateSelfSigned")}
															</Button>
														</div>
													</div>
												)}
												<FormControl required={
														currentProtocol === "ikev2" ||
														watch("raAuthMode") !== "password"
													} isInvalid={Boolean(fieldValidationErrors.raCA)}>
													{ovLabel(
														"inbounds.remoteAccess.ca",
														"CA certificate",
														"inbounds.remoteAccess.help.ca",
														"CA certificate used to verify client certificates and establish trust.",
													)}
													<Textarea rows={4} {...register("raCA")} />
													{fieldValidationErrors.raCA && (
														<p className="text-[0.75rem] text-red-500">
															{fieldValidationErrors.raCA}
														</p>
													)}
												</FormControl>
												<FormControl required isInvalid={Boolean(
														fieldValidationErrors.raServerCertificate,
													)}>
													{ovLabel(
														"inbounds.remoteAccess.serverCertificate",
														"Server certificate",
														"inbounds.remoteAccess.help.serverCertificate",
														"PEM certificate presented by the server. Its SAN must match the host address.",
													)}
													<Textarea
														rows={4}
														{...register("raServerCertificate")}
													/>
													{fieldValidationErrors.raServerCertificate && (
														<p className="text-[0.75rem] text-red-500">
															{fieldValidationErrors.raServerCertificate}
														</p>
													)}
												</FormControl>
												<FormControl required isInvalid={Boolean(fieldValidationErrors.raServerKey)}>
													{ovLabel(
														"inbounds.remoteAccess.serverKey",
														"Server key",
														"inbounds.remoteAccess.help.serverKey",
														"Unencrypted PEM private key matching the server certificate.",
													)}
													<Textarea rows={4} {...register("raServerKey")} />
													{fieldValidationErrors.raServerKey && (
														<p className="text-[0.75rem] text-red-500">
															{fieldValidationErrors.raServerKey}
														</p>
													)}
												</FormControl>
												{currentProtocol === "ikev2" ? (
													<div className="flex flex-col gap-3">
														<FormControl required isInvalid={Boolean(
																fieldValidationErrors.raServerIdentity,
															)}>
															{ovLabel(
																"inbounds.ikev2.serverIdentity",
																"Server identity",
																"inbounds.ikev2.help.serverIdentity",
																"IKE identity and certificate SAN clients validate, usually vpn.example.com.",
															)}
															<Input
																{...register("raServerIdentity")}
																placeholder="vpn.example.com"
															/>
															{fieldValidationErrors.raServerIdentity && (
																<p className="text-[0.75rem] text-red-500">
																	{fieldValidationErrors.raServerIdentity}
																</p>
															)}
														</FormControl>
														<FormControl>
															{ovLabel(
																"inbounds.ikev2.ikeProposals",
																"IKE proposals",
																"inbounds.ikev2.help.ikeProposals",
																"Comma-separated strongSwan IKE proposals.",
															)}
															<Input {...register("ikeProposals")} />
														</FormControl>
														<FormControl>
															{ovLabel(
																"inbounds.ikev2.espProposals",
																"ESP proposals",
																"inbounds.ikev2.help.espProposals",
																"Comma-separated CHILD_SA encryption/integrity proposals.",
															)}
															<Input {...register("ikeEspProposals")} />
														</FormControl>
														<FormControl required={!watch("raRedirectGateway")} isInvalid={Boolean(
																fieldValidationErrors.ikeRoutes,
															)}>
															{ovLabel(
																"inbounds.ikev2.routes",
																"Split-tunnel routes",
																"inbounds.ikev2.help.routes",
																"CIDRs routed through IKEv2 when Redirect gateway is disabled, one per line.",
															)}
															<Textarea rows={2} {...register("ikeRoutes")} />
															{fieldValidationErrors.ikeRoutes && (
																<p className="text-[0.75rem] text-red-500">
																	{fieldValidationErrors.ikeRoutes}
																</p>
															)}
														</FormControl>
														<div className="grid grid-cols-1 md:grid-cols-4 gap-3">
															<FormControl>
																{ovLabel(
																	"inbounds.ikev2.ikeLifetime",
																	"IKE lifetime",
																	"inbounds.ikev2.help.ikeLifetime",
																	"IKE SA lifetime in seconds.",
																)}
																<Input {...register("ikeLifetime")} />
															</FormControl>
															<FormControl>
																{ovLabel(
																	"inbounds.ikev2.childLifetime",
																	"Child lifetime",
																	"inbounds.ikev2.help.childLifetime",
																	"CHILD SA lifetime in seconds.",
																)}
																<Input {...register("ikeChildLifetime")} />
															</FormControl>
															<FormControl>
																{ovLabel(
																	"inbounds.ikev2.rekeyTime",
																	"Rekey time",
																	"inbounds.ikev2.help.rekeyTime",
																	"Seconds before CHILD SA rekey.",
																)}
																<Input {...register("ikeRekeyTime")} />
															</FormControl>
															<FormControl>
																{ovLabel(
																	"inbounds.ikev2.dpdDelay",
																	"DPD delay",
																	"inbounds.ikev2.help.dpdDelay",
																	"Idle seconds before a liveness probe.",
																)}
																<Input {...register("ikeDpdDelay")} />
															</FormControl>
														</div>
														<div className="grid grid-cols-1 md:grid-cols-3 gap-3">
															<FormControl className="flex items-center">
																{ovLabel(
																	"inbounds.ikev2.mobike",
																	"MOBIKE",
																	"inbounds.ikev2.help.mobike",
																	"Allow clients to change networks without reconnecting.",
																	{ className: "mb-0" },
																)}
																<Controller control={control} name={"ikeMobike"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
															</FormControl>
															<FormControl className="flex items-center">
																{ovLabel(
																	"inbounds.ikev2.reauth",
																	"Reauthenticate",
																	"inbounds.ikev2.help.reauth",
																	"Require full authentication when the IKE SA lifetime expires.",
																	{ className: "mb-0" },
																)}
																<Controller control={control} name={"ikeReauth"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
															</FormControl>
															<FormControl className="flex items-center">
																{ovLabel(
																	"inbounds.ikev2.sendCert",
																	"Send certificate",
																	"inbounds.ikev2.help.sendCert",
																	"Send the server certificate during authentication.",
																	{ className: "mb-0" },
																)}
																<Controller control={control} name={"ikeSendCert"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
															</FormControl>
														</div>
														<FormControl>
															{ovLabel(
																"inbounds.ikev2.fragmentation",
																"Fragmentation",
																"inbounds.ikev2.help.fragmentation",
																"Enable IKE fragmentation, accept peer fragments only, or disable it.",
															)}
															<Controller
																control={control}
																name="ikeFragmentation"
																render={({ field }) => (
																	<SearchableTagSelect
																		value={field.value}
																		onChange={field.onChange}
																		placeholder={t(
																			"inbounds.ikev2.fragmentation",
																		)}
																		options={[
																			{
																				value: "yes",
																				label: t("nodes.enabled"),
																			},
																			{
																				value: "accept",
																				label: t(
																					"inbounds.ikev2.acceptFragments",
																				),
																			},
																			{
																				value: "no",
																				label: t("nodes.disabled"),
																			},
																		]}
																	/>
																)}
															/>
														</FormControl>
													</div>
												) : (
													<div className="flex flex-col gap-3">
														<p className="text-[0.875rem] font-semibold">
															{t("inbounds.anyconnect.connection")}
														</p>
														<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
															<FormControl>
																{ovLabel(
																	"inbounds.anyconnect.transport",
																	"Transport",
																	"inbounds.anyconnect.help.transport",
																	"AnyConnect always uses TCP/TLS; DTLS adds a faster UDP data channel.",
																)}
																<Controller
																	control={control}
																	name="acUDPEnabled"
																	render={({ field }) => (
																		<SearchableTagSelect
																			value={field.value ? "tcp-udp" : "tcp"}
																			placeholder={t(
																				"inbounds.anyconnect.transport",
																			)}
																			onChange={(value) =>
																				field.onChange(value === "tcp-udp")
																			}
																			options={[
																				{
																					value: "tcp-udp",
																					label: t(
																						"inbounds.anyconnect.tcpUdp",
																					),
																				},
																				{
																					value: "tcp",
																					label: t(
																						"inbounds.anyconnect.tcpOnly",
																					),
																				},
																			]}
																		/>
																	)}
																/>
															</FormControl>
															<FormControl required={watch("acUDPEnabled")} isInvalid={Boolean(
																	fieldValidationErrors.acUDPPort,
																)}>
																{ovLabel(
																	"inbounds.anyconnect.udpPort",
																	"UDP/DTLS port",
																	"inbounds.anyconnect.help.udpPort",
																	"UDP data-channel port; normally the same as the public TCP port.",
																)}
																<Input
																	{...register("acUDPPort")}
																	disabled={!watch("acUDPEnabled")}
																/>
																{fieldValidationErrors.acUDPPort && (
																	<p className="text-[0.75rem] text-red-500 mt-1">
																		{fieldValidationErrors.acUDPPort}
																	</p>
																)}
															</FormControl>
															<FormControl>
																{ovLabel(
																	"inbounds.anyconnect.listenHost",
																	"TCP listen host",
																	"inbounds.anyconnect.help.listenHost",
																	"Optional local IP or hostname to bind; empty listens on all addresses.",
																)}
																<Input {...register("acListenHost")} />
															</FormControl>
															<FormControl>
																{ovLabel(
																	"inbounds.anyconnect.udpListenHost",
																	"UDP listen host",
																	"inbounds.anyconnect.help.udpListenHost",
																	"Optional UDP bind address; empty reuses the TCP listen host.",
																)}
																<Input
																	{...register("acUDPListenHost")}
																	disabled={!watch("acUDPEnabled")}
																/>
															</FormControl>
														</div>
														<FormControl className="flex items-center">
															{ovLabel(
																"inbounds.anyconnect.listenHostIsDynDNS",
																"Dynamic listen hostname",
																"inbounds.anyconnect.help.listenHostIsDynDNS",
																"Resolve the listen hostname again when reconnecting.",
																{ className: "mb-0" },
															)}
															<Controller control={control} name={"acListenHostIsDynDNS"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
														</FormControl>
														<hr className="w-full border-0 border-b border-panel-border! opacity-60" />
														<p className="text-[0.875rem] font-semibold">
															{t("inbounds.anyconnect.sessions")}
														</p>
														<div className="grid grid-cols-1 md:grid-cols-3 gap-3">
															{(
																[
																	[
																		"acMaxClients",
																		"Max clients",
																		"Maximum simultaneous clients for this inbound.",
																	],
																	[
																		"acMaxSameClients",
																		"Max same user",
																		"Maximum simultaneous sessions using one username; zero defers to the user device limit.",
																	],
																	[
																		"acCookieTimeout",
																		"Cookie timeout",
																		"Seconds an authentication cookie remains valid.",
																	],
																	[
																		"acIdleTimeout",
																		"Idle timeout",
																		"Seconds before an inactive desktop session is disconnected.",
																	],
																	[
																		"acMobileIdleTimeout",
																		"Mobile idle timeout",
																		"Seconds before an inactive mobile session is disconnected.",
																	],
																	[
																		"acSessionTimeout",
																		"Session timeout",
																		"Maximum session duration in seconds; zero means unlimited.",
																	],
																	[
																		"acKeepalive",
																		"Keepalive",
																		"Seconds between server keepalive messages.",
																	],
																	[
																		"acDPD",
																		"DPD",
																		"Seconds before checking an unresponsive desktop client.",
																	],
																	[
																		"acMobileDPD",
																		"Mobile DPD",
																		"Seconds before checking an unresponsive mobile client.",
																	],
																] as const
															).map(([name, label, help]) => (
																<FormControl key={name} isInvalid={Boolean(
																		fieldValidationErrors[name],
																	)}>
																	{ovLabel(
																		`inbounds.anyconnect.${name}`,
																		label,
																		`inbounds.anyconnect.help.${name}`,
																		help,
																	)}
																	<Input {...register(name)} />
																	{fieldValidationErrors[name] && (
																		<p className="text-[0.75rem] text-red-500 mt-1">
																			{fieldValidationErrors[name]}
																		</p>
																	)}
																</FormControl>
															))}
														</div>
														<div className="grid grid-cols-1 md:grid-cols-3 gap-3">
															{(
																[
																	[
																		"acAuthTimeout",
																		"Auth timeout",
																		"Seconds allowed to finish authentication.",
																	],
																	[
																		"acMinReauthTime",
																		"Min reauth time",
																		"Delay after failed authentication attempts.",
																	],
																	[
																		"acMaxBanScore",
																		"Max ban score",
																		"Authentication score that temporarily bans an address; zero disables bans.",
																	],
																	[
																		"acBanResetTime",
																		"Ban reset time",
																		"Seconds before accumulated ban points reset.",
																	],
																	[
																		"acRekeyTime",
																		"Rekey time",
																		"Seconds between key refreshes; zero disables rekeying.",
																	],
																	[
																		"acSwitchToTCPTimeout",
																		"UDP fallback timeout",
																		"Seconds without UDP traffic before falling back to TCP.",
																	],
																	[
																		"acStatsReportTime",
																		"Stats report interval",
																		"Worker accounting report interval; zero uses live occtl polling only.",
																	],
																	[
																		"acRateLimitMs",
																		"Connection rate limit",
																		"Minimum milliseconds between queued incoming connections; zero disables it.",
																	],
																] as const
															).map(([name, label, help]) => (
																<FormControl key={name} isInvalid={Boolean(
																		fieldValidationErrors[name],
																	)}>
																	{ovLabel(
																		`inbounds.anyconnect.${name}`,
																		label,
																		`inbounds.anyconnect.help.${name}`,
																		help,
																	)}
																	<Input {...register(name)} />
																	{fieldValidationErrors[name] && (
																		<p className="text-[0.75rem] text-red-500 mt-1">
																			{fieldValidationErrors[name]}
																		</p>
																	)}
																</FormControl>
															))}
														</div>
														<FormControl>
															{ovLabel(
																"inbounds.anyconnect.rekeyMethod",
																"Rekey method",
																"inbounds.anyconnect.help.rekeyMethod",
																"SSL rekeys seamlessly; new tunnel reconnects the data channel for legacy clients.",
															)}
															<Controller
																control={control}
																name="acRekeyMethod"
																render={({ field }) => (
																	<SearchableTagSelect
																		value={field.value}
																		placeholder={t(
																			"inbounds.anyconnect.rekeyMethod",
																		)}
																		onChange={field.onChange}
																		options={[
																			{ value: "ssl", label: "SSL" },
																			{
																				value: "new-tunnel",
																				label: t(
																					"inbounds.anyconnect.newTunnel",
																				),
																			},
																		]}
																	/>
																)}
															/>
														</FormControl>
														<hr className="w-full border-0 border-b border-panel-border! opacity-60" />
														<p className="text-[0.875rem] font-semibold">
															{t("inbounds.anyconnect.networking")}
														</p>
														<FormControl>
															{ovLabel(
																"inbounds.anyconnect.routes",
																"Routes",
																"inbounds.anyconnect.help.routes",
																"Routes pushed to clients, one CIDR per line. Empty with Redirect gateway enabled means full tunnel.",
															)}
															<Textarea rows={2} {...register("acRoutes")} />
														</FormControl>
														<FormControl>
															{ovLabel(
																"inbounds.anyconnect.noRoutes",
																"Excluded routes",
																"inbounds.anyconnect.help.noRoutes",
																"CIDRs excluded from the VPN, one per line.",
															)}
															<Textarea rows={2} {...register("acNoRoutes")} />
														</FormControl>
														<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
															<FormControl isInvalid={Boolean(
																	fieldValidationErrors.acNBNS,
																)}>
																{ovLabel(
																	"inbounds.anyconnect.nbns",
																	"NBNS servers",
																	"inbounds.anyconnect.help.nbns",
																	"Optional IPv4 WINS/NBNS servers, one per line.",
																)}
																<Textarea rows={2} {...register("acNBNS")} />
																{fieldValidationErrors.acNBNS && (
																	<p className="text-[0.75rem] text-red-500 mt-1">
																		{fieldValidationErrors.acNBNS}
																	</p>
																)}
															</FormControl>
															<FormControl isInvalid={Boolean(
																	fieldValidationErrors.acSplitDNS,
																)}>
																{ovLabel(
																	"inbounds.anyconnect.splitDNS",
																	"Split DNS domains",
																	"inbounds.anyconnect.help.splitDNS",
																	"Domains resolved through the tunnel, one per line.",
																)}
																<Textarea
																	rows={2}
																	{...register("acSplitDNS")}
																/>
																{fieldValidationErrors.acSplitDNS && (
																	<p className="text-[0.75rem] text-red-500 mt-1">
																		{fieldValidationErrors.acSplitDNS}
																	</p>
																)}
															</FormControl>
														</div>
														<FormControl isInvalid={Boolean(
																fieldValidationErrors.acRestrictToPorts,
															)}>
															{ovLabel(
																"inbounds.anyconnect.restrictToPorts",
																"Allowed destination ports",
																"inbounds.anyconnect.help.restrictToPorts",
																"Optional ocserv port policy, for example: tcp(80,443), udp(53).",
															)}
															<Input
																{...register("acRestrictToPorts")}
																placeholder="tcp(80,443), udp(53)"
															/>
															{fieldValidationErrors.acRestrictToPorts && (
																<p className="text-[0.75rem] text-red-500 mt-1">
																	{fieldValidationErrors.acRestrictToPorts}
																</p>
															)}
														</FormControl>
														<div className="grid grid-cols-1 md:grid-cols-3 gap-3">
															{(
																[
																	[
																		"acRXDataPerSec",
																		"Download limit",
																		"Maximum receive bytes per second per user; zero is unlimited.",
																	],
																	[
																		"acTXDataPerSec",
																		"Upload limit",
																		"Maximum transmit bytes per second per user; zero is unlimited.",
																	],
																	[
																		"acOutputBuffer",
																		"Output buffer",
																		"Per-client output buffer size; zero uses the ocserv default.",
																	],
																	[
																		"acNetPriority",
																		"Network priority",
																		"Linux socket priority from 0 to 6.",
																	],
																	[
																		"acNoCompressLimit",
																		"Compression threshold",
																		"Do not compress packets smaller than this byte count.",
																	],
																] as const
															).map(([name, label, help]) => (
																<FormControl key={name} isInvalid={Boolean(
																		fieldValidationErrors[name],
																	)}>
																	{ovLabel(
																		`inbounds.anyconnect.${name}`,
																		label,
																		`inbounds.anyconnect.help.${name}`,
																		help,
																	)}
																	<Input {...register(name)} />
																	{fieldValidationErrors[name] && (
																		<p className="text-[0.75rem] text-red-500 mt-1">
																			{fieldValidationErrors[name]}
																		</p>
																	)}
																</FormControl>
															))}
														</div>
														<hr className="w-full border-0 border-b border-panel-border! opacity-60" />
														<p className="text-[0.875rem] font-semibold">
															{t("inbounds.anyconnect.tlsCompatibility")}
														</p>
														<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
															<FormControl>
																{ovLabel(
																	"inbounds.anyconnect.banner",
																	"Banner",
																	"inbounds.anyconnect.help.banner",
																	"Optional login banner shown by compatible clients.",
																)}
																<Input {...register("acBanner")} />
															</FormControl>
															<FormControl>
																{ovLabel(
																	"inbounds.anyconnect.preLoginBanner",
																	"Pre-login banner",
																	"inbounds.anyconnect.help.preLoginBanner",
																	"Message shown before authentication by compatible clients.",
																)}
																<Input {...register("acPreLoginBanner")} />
															</FormControl>
															<FormControl>
																{ovLabel(
																	"inbounds.anyconnect.defaultDomain",
																	"Default domain",
																	"inbounds.anyconnect.help.defaultDomain",
																	"DNS search domain pushed to clients.",
																)}
																<Input {...register("acDefaultDomain")} />
															</FormControl>
															<FormControl isInvalid={Boolean(
																	fieldValidationErrors.acCertUserOID,
																)}>
																{ovLabel(
																	"inbounds.anyconnect.certUserOID",
																	"Certificate username OID",
																	"inbounds.anyconnect.help.certUserOID",
																	"Certificate field used as the username; 2.5.4.3 is Common Name.",
																)}
																<Input {...register("acCertUserOID")} />
																{fieldValidationErrors.acCertUserOID && (
																	<p className="text-[0.75rem] text-red-500 mt-1">
																		{fieldValidationErrors.acCertUserOID}
																	</p>
																)}
															</FormControl>
														</div>
														<FormControl isInvalid={Boolean(
																fieldValidationErrors.acTLSPriorities,
															)}>
															{ovLabel(
																"inbounds.anyconnect.tlsPriorities",
																"TLS priorities",
																"inbounds.anyconnect.help.tlsPriorities",
																"Advanced GnuTLS priority string. Keep the secure default unless a client requires a change.",
															)}
															<Input {...register("acTLSPriorities")} />
															{fieldValidationErrors.acTLSPriorities && (
																<p className="text-[0.75rem] text-red-500 mt-1">
																	{fieldValidationErrors.acTLSPriorities}
																</p>
															)}
														</FormControl>
														<div className="grid grid-cols-1 md:grid-cols-3 gap-3">
															{(
																[
																	[
																		"acCompression",
																		"Compression",
																		"Allow negotiated compression; leave disabled unless a client requires it.",
																	],
																	[
																		"acCiscoCompat",
																		"Cisco compatibility",
																		"Enable compatibility behavior for Cisco AnyConnect clients.",
																	],
																	[
																		"acDenyRoaming",
																		"Deny roaming",
																		"Disconnect a session when its public client address changes.",
																	],
																	[
																		"acTunnelAllDNS",
																		"Tunnel all DNS",
																		"Force client DNS requests through the tunnel.",
																	],
																	[
																		"acRestrictToRoutes",
																		"Restrict to routes",
																		"Prevent users from reaching addresses outside configured routes.",
																	],
																	[
																		"acPersistentCookies",
																		"Persistent cookies",
																		"Keep authentication cookies valid across reconnects until they expire.",
																	],
																	[
																		"acTryMTUDiscovery",
																		"MTU discovery",
																		"Let the server discover a suitable path MTU.",
																	],
																	[
																		"acPingLeases",
																		"Ping leases",
																		"Probe an address before leasing it to a client.",
																	],
																	[
																		"acDTLSPSK",
																		"DTLS PSK",
																		"Enable the modern pre-shared-key DTLS channel.",
																	],
																	[
																		"acDTLSLegacy",
																		"Legacy DTLS",
																		"Permit the legacy DTLS channel used by older clients.",
																	],
																	[
																		"acCiscoSVCCompat",
																		"Legacy Cisco SVC",
																		"Enable compatibility for older Cisco SVC clients. Requires ocserv 1.2 or newer.",
																	],
																	[
																		"acClientBypassProtocol",
																		"Client bypass protocol",
																		"Allow compatible clients to bypass unsupported IP protocols.",
																	],
																	[
																		"acMatchTLSDTLSCiphers",
																		"Match TLS/DTLS ciphers",
																		"Use matching cipher policy for TLS and DTLS.",
																	],
																] as const
															).map(([name, label, help]) => (
																<FormControl key={name} className="flex items-center">
																	{ovLabel(
																		`inbounds.anyconnect.${name}`,
																		label,
																		`inbounds.anyconnect.help.${name}`,
																		help,
																		{ className: "mb-0" },
																	)}
																	<Controller control={control} name={name} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
																</FormControl>
															))}
														</div>
													</div>
												)}
											</div>
										)}
										{(currentProtocol === "l2tp" ||
											currentProtocol === "pptp") && (
											<div className="flex flex-col gap-3">
												{currentProtocol === "l2tp" && (
													<Alert className="rounded-md">
														<Info className="size-4" aria-hidden="true" />
														<div>
															<AlertTitle className="text-[0.875rem]">
																{t("inbounds.l2tp.fixedPortsTitle")}
															</AlertTitle>
															<AlertDescription className="text-[0.875rem]">
																{t("inbounds.l2tp.fixedPortsDescription")}
															</AlertDescription>
														</div>
													</Alert>
												)}
												<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
													<FormControl required={l2tpTproxyEnabled} isInvalid={Boolean(
															fieldValidationErrors.l2tpTunnelPort,
														)}>
														{ovLabel(
															"inbounds.l2tp.tunnelPort",
															"Tunnel port",
															"inbounds.l2tp.help.tunnelPort",
															"Internal Xray tunnel port used by nftables/TProxy. It must be unique and different from the public L2TP port.",
														)}
														<Input
															{...register("l2tpTunnelPort")}
															placeholder={
																currentProtocol === "l2tp" ? "1702" : "51200"
															}
															disabled={
																!l2tpTproxyEnabled || currentProtocol === "l2tp"
															}
														/>
														{fieldValidationErrors.l2tpTunnelPort && (
															<p className="text-[0.75rem] text-red-500 mt-1">
																{fieldValidationErrors.l2tpTunnelPort}
															</p>
														)}
													</FormControl>
													<FormControl required isInvalid={Boolean(
															fieldValidationErrors.l2tpIPv4Pool,
														)}>
														{ovLabel(
															"inbounds.l2tp.ipv4Pool",
															"IPv4 pool CIDR",
															"inbounds.l2tp.help.ipv4Pool",
															"Private IPv4 range assigned to L2TP users. Each user receives a deterministic address from this pool.",
														)}
														<Input
															{...register("l2tpIPv4Pool")}
															placeholder="10.67.0.0/16"
														/>
														{fieldValidationErrors.l2tpIPv4Pool && (
															<p className="text-[0.75rem] text-red-500 mt-1">
																{fieldValidationErrors.l2tpIPv4Pool}
															</p>
														)}
													</FormControl>
												</div>
												{currentProtocol === "l2tp" && (
													<FormControl required isInvalid={Boolean(
															fieldValidationErrors.l2tpIPSecPSK,
														)}>
														{ovLabel(
															"inbounds.l2tp.ipsecPsk",
															"IPsec pre-shared key",
															"inbounds.l2tp.help.ipsecPsk",
															"Shared IPsec secret used by clients before L2TP username/password authentication.",
														)}
														<Input
															{...register("l2tpIPSecPSK")}
															placeholder="change-this-secret"
														/>
														{fieldValidationErrors.l2tpIPSecPSK && (
															<p className="text-[0.75rem] text-red-500 mt-1">
																{fieldValidationErrors.l2tpIPSecPSK}
															</p>
														)}
													</FormControl>
												)}
												<FormControl>
													{ovLabel(
														"inbounds.l2tp.dns",
														"DNS servers",
														"inbounds.l2tp.help.dns",
														"DNS resolvers pushed to L2TP clients, one IPv4 address per line.",
													)}
													<Textarea
														rows={3}
														{...register("l2tpDNSServers")}
														placeholder={"1.1.1.1\n8.8.8.8"}
													/>
												</FormControl>
												<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
													<FormControl isInvalid={Boolean(fieldValidationErrors.l2tpMTU)}>
														{ovLabel(
															"inbounds.l2tp.mtu",
															"MTU",
															"inbounds.l2tp.help.mtu",
															"PPP MTU for L2TP clients. 1410 is a conservative default for IPsec/NAT paths.",
														)}
														<Input
															{...register("l2tpMTU")}
															placeholder="1410"
														/>
														{fieldValidationErrors.l2tpMTU && (
															<p className="text-[0.75rem] text-red-500 mt-1">
																{fieldValidationErrors.l2tpMTU}
															</p>
														)}
													</FormControl>
													<FormControl isInvalid={Boolean(fieldValidationErrors.l2tpMRU)}>
														{ovLabel(
															"inbounds.l2tp.mru",
															"MRU",
															"inbounds.l2tp.help.mru",
															"PPP MRU for L2TP clients. Keep it close to MTU unless you have a path-specific reason.",
														)}
														<Input
															{...register("l2tpMRU")}
															placeholder="1410"
														/>
														{fieldValidationErrors.l2tpMRU && (
															<p className="text-[0.75rem] text-red-500 mt-1">
																{fieldValidationErrors.l2tpMRU}
															</p>
														)}
													</FormControl>
													<FormControl isInvalid={Boolean(
															fieldValidationErrors.l2tpLcpEchoInterval,
														)}>
														{ovLabel(
															"inbounds.l2tp.lcpEchoInterval",
															"LCP echo interval",
															"inbounds.l2tp.help.lcpEchoInterval",
															"Seconds between PPP keepalive probes used to detect dead L2TP sessions.",
														)}
														<Input
															{...register("l2tpLcpEchoInterval")}
															placeholder="30"
														/>
														{fieldValidationErrors.l2tpLcpEchoInterval && (
															<p className="text-[0.75rem] text-red-500 mt-1">
																{fieldValidationErrors.l2tpLcpEchoInterval}
															</p>
														)}
													</FormControl>
													<FormControl isInvalid={Boolean(
															fieldValidationErrors.l2tpLcpEchoFailure,
														)}>
														{ovLabel(
															"inbounds.l2tp.lcpEchoFailure",
															"LCP echo failure",
															"inbounds.l2tp.help.lcpEchoFailure",
															"How many missed PPP keepalive probes are allowed before the L2TP session is considered dead.",
														)}
														<Input
															{...register("l2tpLcpEchoFailure")}
															placeholder="4"
														/>
														{fieldValidationErrors.l2tpLcpEchoFailure && (
															<p className="text-[0.75rem] text-red-500 mt-1">
																{fieldValidationErrors.l2tpLcpEchoFailure}
															</p>
														)}
													</FormControl>
												</div>
												<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
													<FormControl className="flex items-center">
														{ovLabel(
															"inbounds.l2tp.redirectGateway",
															"Redirect gateway",
															"inbounds.l2tp.help.redirectGateway",
															"Route all client traffic through the L2TP/IPsec VPN.",
															{ className: "mb-0" },
														)}
														<Controller control={control} name={"l2tpRedirectGateway"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
													</FormControl>
													<FormControl className="flex items-center">
														{ovLabel(
															"inbounds.l2tp.tproxy",
															"Route through Xray",
															"inbounds.l2tp.help.tproxy",
															"Forward VPN client traffic into Xray so routing rules and Xray outbounds apply. Disable for direct NAT egress from the node.",
															{ className: "mb-0" },
														)}
														<Controller control={control} name={"l2tpTproxyEnabled"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
													</FormControl>
													<FormControl className="flex items-center">
														{ovLabel(
															"inbounds.l2tp.accounting",
															"Enable accounting",
															"inbounds.l2tp.help.accounting",
															"Record L2TP session traffic and report it to the same Rebecca user quota/accounting pipeline.",
															{ className: "mb-0" },
														)}
														<Controller control={control} name={"l2tpAccountingEnabled"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
													</FormControl>
												</div>
											</div>
										)}
									</div>

									{supportsStreamSettings && (
										<div className="flex flex-col gap-3 xray-dialog-section" data-form-section="stream" data-form-section-title={t("inbounds.streamSettings")}>
											<p className="text-[0.875rem] font-semibold">
												{t("inbounds.streamSettings")}
											</p>
											{currentProtocol === "hysteria" ? (
												<Alert className="rounded-md">
													<Info className="size-4" aria-hidden="true" />
													<AlertDescription className="text-[0.875rem]">
														{t("inbounds.hysteria.fixedTransport")}
													</AlertDescription>
												</Alert>
											) : (
												<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
													<FormControl>
														<FormLabel helpKey="inbounds.networkHelp">{t("inbounds.network")}</FormLabel>
														<SearchableTagSelect
															value={streamNetwork}
															options={ALL_NETWORK_OPTIONS}
															placeholder={t("inbounds.network")}
															onChange={(value) =>
																form.setValue(
																	"streamNetwork",
																	String(
																		value,
																	) as InboundFormValues["streamNetwork"],
																	{
																		shouldDirty: true,
																		shouldValidate: true,
																	},
																)
															}
														/>
													</FormControl>
													<FormControl>
														<FormLabel helpKey="inbounds.securityHelp">{t("inbounds.security")}</FormLabel>
														<Controller
															control={control}
															name="streamSecurity"
															render={({ field }) => (
																<SegmentedControl
	label={t("inbounds.security")}
	value={field.value}
	options={streamSecurityOptions.map((security) => ({
		value: security,
		label: security === "none" ? t("userDialog.flow.none") : security === "tls" ? "TLS" : security === "reality" ? "Reality" : security,
		disabled: security === "tls" ? !TLS_COMPATIBLE_PROTOCOLS.includes(currentProtocol) : security === "reality" ? !REALITY_COMPATIBLE_PROTOCOLS.includes(currentProtocol) : false,
	}))}
	onChange={(value) => field.onChange(value)}
/>
															)}
														/>
													</FormControl>
												</div>
											)}
											{streamCompatibilityError && (
												<Alert variant="destructive" className="rounded-md">
													<CircleAlert className="size-4" aria-hidden="true" />
													<AlertDescription className="text-[0.875rem]">
														{streamCompatibilityError}
													</AlertDescription>
												</Alert>
											)}

											{streamNetwork === "ws" && (
												<Alert className="rounded-md mt-2">
													<TriangleAlert className="size-4" aria-hidden="true" />
													<div>
														<AlertTitle className="text-[0.875rem]">
															{t("inbounds.wsDeprecatedTitle")}
														</AlertTitle>
														<AlertDescription className="text-[0.75rem]">
															{t("inbounds.wsDeprecatedDescription")}
														</AlertDescription>
													</div>
												</Alert>
											)}

											{streamNetwork === "ws" && (
												<div className="flex flex-col gap-3">
													<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
														<FormControl isInvalid={!!fieldValidationErrors.wsPath}>
															<FormLabel helpKey="inbounds.ws.pathHelp">{t("inbounds.ws.path")}</FormLabel>
															<Input
																{...register("wsPath")}
																placeholder="/ws"
															/>
															{fieldValidationErrors.wsPath && (
																<p className="text-[0.75rem] text-red-500 mt-1">
																	{fieldValidationErrors.wsPath}
																</p>
															)}
														</FormControl>
														<FormControl>
															<FormLabel helpKey="inbounds.ws.hostHelp">{t("inbounds.ws.host")}</FormLabel>
															<Input
																{...register("wsHost")}
																placeholder="example.com"
															/>
														</FormControl>
														<FormControl isInvalid={
																!!fieldValidationErrors.wsHeartbeatPeriod
															}>
															<FormLabel>Heartbeat period (seconds)</FormLabel>
															<FormNumberField control={control} name={"wsHeartbeatPeriod"} inputMode="numeric"
																placeholder="0"
															/>
															{fieldValidationErrors.wsHeartbeatPeriod && (
																<FieldError>
																	{fieldValidationErrors.wsHeartbeatPeriod}
																</FieldError>
															)}
														</FormControl>
														<FormControl className="flex items-center">
															<FormLabel className="mb-0">
																Accept PROXY protocol
															</FormLabel>
															<Controller control={control} name={"wsAcceptProxyProtocol"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
														</FormControl>
													</div>
													<div className="flex flex-col gap-2">
														<div className="flex justify-between items-center">
															<p className="font-medium">
																{t("inbounds.ws.headers")}
															</p>
															<Button onClick={() =>
																	appendWsHeader({ name: "", value: "" })
																} size="xs">
																{t("inbounds.accounts.add")}
															</Button>
														</div>
														{wsHeaderFields.map((field, index) => (
															<div key={field.id} className="flex flex-row gap-2 items-start">
																<FormControl>
																	<Input {...register(`wsHeaders.${index}.name` as const,
																		)}
																		placeholder={t("inbounds.ws.headerName")}
																	/>
																</FormControl>
																<FormControl>
																	<Input
																		{...register(
																			`wsHeaders.${index}.value` as const,
																		)}
																		placeholder={t("inbounds.ws.headerValue")}
																	/>
																</FormControl>
																<Button onClick={() => removeWsHeader(index)} variant="ghost" size="xs" className="text-destructive hover:bg-destructive/10">
																	{t("delete")}
																</Button>
															</div>
														))}
													</div>
												</div>
											)}

											{streamNetwork === "tcp" && (
												<div className="flex flex-col gap-3">
													<FormControl>
														<FormLabel helpKey="inbounds.tcp.headerTypeHelp">{t("inbounds.tcp.headerType")}</FormLabel>
														<SearchableTagSelect
															value={tcpHeaderType}
															options={["none", "http"]}
															placeholder={t("inbounds.tcp.headerType")}
															onChange={(value) =>
																form.setValue(
																	"tcpHeaderType",
																	String(
																		value,
																	) as InboundFormValues["tcpHeaderType"],
																	{
																		shouldDirty: true,
																		shouldValidate: true,
																	},
																)
															}
														/>
													</FormControl>
													{tcpHeaderType === "http" && (
														<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
															<FormControl>
																<FormLabel helpKey="inbounds.tcp.hostHelp">{t("inbounds.tcp.host")}</FormLabel>
																<Textarea
																	{...register("tcpHttpHosts")}
																	placeholder="example.com"
																/>
															</FormControl>
															<FormControl>
																<FormLabel helpKey="inbounds.tcp.pathHelp">{t("inbounds.tcp.path")}</FormLabel>
																<Input {...register("tcpHttpPath")} />
															</FormControl>
														</div>
													)}
												</div>
											)}

										{streamNetwork === "grpc" && (
											<div className="flex flex-col gap-3">
												<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
												<FormControl>
															<FormLabel helpKey="serviceNameHelp">{t("serviceName")}</FormLabel>
														<Input {...register("grpcServiceName")} />
													</FormControl>
													<FormControl>
														<FormLabel helpKey="inbounds.grpc.authorityHelp">{t("inbounds.grpc.authority")}</FormLabel>
														<Input {...register("grpcAuthority")} />
													</FormControl>
													<FormControl className="flex items-center">
														<FormLabel className="mb-0" helpKey="inbounds.grpc.multiModeHelp">{t("inbounds.grpc.multiMode")}</FormLabel>
													<Controller control={control} name={"grpcMultiMode"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
												</FormControl>
													<FormControl className="flex items-center">
															<FormLabel className="mb-0">
																Permit without stream
															</FormLabel>
															<Controller control={control} name={"grpcPermitWithoutStream"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
													</FormControl>
												</div>
												<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
													{(
														[
															["grpcIdleTimeout", "Idle timeout (seconds)"],
																[
																	"grpcHealthCheckTimeout",
																	"Health-check timeout (seconds)",
																],
																[
																	"grpcInitialWindowsSize",
																	"Initial window size",
																],
														] as const
													).map(([name, label]) => (
														<FormControl key={name} isInvalid={!!fieldValidationErrors[name]}>
															<FormLabel>{label}</FormLabel>
																<FormNumberField control={control} name={name} inputMode="numeric"
																/>
															{fieldValidationErrors[name] && (
																	<FieldError>
																		{fieldValidationErrors[name]}
																	</FieldError>
															)}
														</FormControl>
													))}
													<FormControl>
														<FormLabel>User-Agent</FormLabel>
														<Input {...register("grpcUserAgent")} />
													</FormControl>
												</div>
											</div>
										)}

										{streamNetwork === "kcp" && (
											<div className="flex flex-col gap-3">
												<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
													<FormControl>
														<FormLabel>
															{t("inbounds.kcp.headerType")} (legacy)
														</FormLabel>
														<Input {...register("kcpHeaderType")} />
													</FormControl>
													<FormControl>
														<FormLabel>
															{t("inbounds.kcp.seed")} (legacy)
														</FormLabel>
														<Input {...register("kcpSeed")} />
													</FormControl>
												</div>
												<div className="grid grid-cols-1 md:grid-cols-3 gap-3">
													{(
														[
															["kcpMtu", "MTU", "1350"],
															["kcpTti", "TTI (ms)", "50"],
																[
																	"kcpUplinkCapacity",
																	"Uplink capacity (MB/s)",
																	"5",
																],
																[
																	"kcpDownlinkCapacity",
																	"Downlink capacity (MB/s)",
																	"20",
																],
																[
																	"kcpCwndMultiplier",
																	"Congestion window multiplier",
																	"1",
																],
																[
																	"kcpMaxSendingWindow",
																	"Maximum sending window",
																	"2097152",
																],
																[
																	"kcpReadBufferSize",
																	"Read buffer (MB, legacy)",
																	"2",
																],
																[
																	"kcpWriteBufferSize",
																	"Write buffer (MB, legacy)",
																	"2",
																],
														] as const
													).map(([name, label, placeholder]) => (
														<FormControl key={name} isInvalid={!!fieldValidationErrors[name]}>
															<FormLabel>{label}</FormLabel>
															<FormNumberField control={control} name={name as keyof InboundFormValues} inputMode="numeric"
																placeholder={placeholder}
															/>
															{fieldValidationErrors[name] && (
																<FieldError>
																	{fieldValidationErrors[name]}
																</FieldError>
															)}
														</FormControl>
													))}
												</div>
												<FormControl className="flex items-center">
														<FormLabel className="mb-0">
															Congestion control (legacy)
														</FormLabel>
													<Controller control={control} name={"kcpCongestion"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
												</FormControl>
											</div>
										)}

											{streamNetwork === "quic" && (
												<div className="grid grid-cols-1 md:grid-cols-3 gap-3">
													<FormControl>
														<FormLabel helpKey="inbounds.quic.securityHelp">{t("inbounds.quic.security")}</FormLabel>
														<Input {...register("quicSecurity")} />
													</FormControl>
													<FormControl>
														<FormLabel helpKey="inbounds.quic.keyHelp">{t("inbounds.quic.key")}</FormLabel>
														<Input {...register("quicKey")} />
													</FormControl>
													<FormControl>
														<FormLabel helpKey="inbounds.quic.headerTypeHelp">{t("inbounds.quic.headerType")}</FormLabel>
														<Input {...register("quicHeaderType")} />
													</FormControl>
												</div>
											)}

										{streamNetwork === "httpupgrade" && (
											<div className="flex flex-col gap-3">
												<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
													<FormControl isInvalid={
																!!fieldValidationErrors.httpupgradePath
															}>
														<FormLabel helpKey="inbounds.httpUpgrade.pathHelp">{t("inbounds.httpUpgrade.path")}</FormLabel>
														<Input {...register("httpupgradePath")} />
														{fieldValidationErrors.httpupgradePath && (
															<p className="text-[0.75rem] text-red-500 mt-1">
																{fieldValidationErrors.httpupgradePath}
															</p>
														)}
													</FormControl>
													<FormControl>
														<FormLabel helpKey="inbounds.httpUpgrade.hostHelp">{t("inbounds.httpUpgrade.host")}</FormLabel>
													<Input {...register("httpupgradeHost")} />
												</FormControl>
													<FormControl className="flex items-center">
															<FormLabel className="mb-0">
																Accept PROXY protocol
															</FormLabel>
															<Controller control={control} name={"httpupgradeAcceptProxyProtocol"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
													</FormControl>
												</div>
												<div className="flex flex-col gap-2">
													<div className="flex justify-between items-center">
														<p className="font-medium">Headers</p>
															<Button onClick={() =>
																	appendHttpupgradeHeader({
																		name: "",
																		value: "",
																	})
																} size="xs">
															{t("inbounds.accounts.add")}
														</Button>
													</div>
													{httpupgradeHeaderFields.map((field, index) => (
															<div key={field.id} className="flex flex-row gap-2 items-start">
																<Input
																	{...register(
																		`httpupgradeHeaders.${index}.name` as const,
																	)}
																	placeholder={t("inbounds.ws.headerName")}
																/>
																<Input
																	{...register(
																		`httpupgradeHeaders.${index}.value` as const,
																	)}
																	placeholder={t("inbounds.ws.headerValue")}
																/>
																<Button onClick={() => removeHttpupgradeHeader(index)} variant="ghost" size="xs" className="text-destructive hover:bg-destructive/10">
																{t("delete")}
															</Button>
														</div>
													))}
												</div>
											</div>
										)}

											{streamNetwork === "splithttp" && (
												<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
													<FormControl isInvalid={!!fieldValidationErrors.splithttpPath}>
														<FormLabel helpKey="inbounds.splitHttp.pathHelp">{t("inbounds.splitHttp.path")}</FormLabel>
														<Input {...register("splithttpPath")} />
														{fieldValidationErrors.splithttpPath && (
															<p className="text-[0.75rem] text-red-500 mt-1">
																{fieldValidationErrors.splithttpPath}
															</p>
														)}
													</FormControl>
													<FormControl>
														<FormLabel helpKey="inbounds.splitHttp.hostHelp">{t("inbounds.splitHttp.host")}</FormLabel>
														<Input {...register("splithttpHost")} />
													</FormControl>
												</div>
											)}

											{streamNetwork === "xhttp" && (
												<div className="flex flex-col gap-3">
													<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
														<FormControl>
															<FormLabel helpKey="hostsPage.hostHelp">{t("hostsPage.host")}</FormLabel>
															<Input
																{...register("xhttpHost")}
																placeholder="example.com"
															/>
														</FormControl>
														<FormControl isInvalid={!!fieldValidationErrors.xhttpPath}>
															<FormLabel helpKey="pathHelp">{t("path")}</FormLabel>
															<Input
																{...register("xhttpPath")}
																placeholder="/"
															/>
															{fieldValidationErrors.xhttpPath && (
																<p className="text-[0.75rem] text-red-500 mt-1">
																	{fieldValidationErrors.xhttpPath}
																</p>
															)}
														</FormControl>
													</div>
													<div className="flex flex-col gap-2">
														<div className="flex justify-between items-center">
															<p className="font-medium">
																{t("inbounds.ws.headers")}
															</p>
															<Button onClick={() =>
																	appendXhttpHeader({ name: "", value: "" })
																} size="xs">
																{t("inbounds.accounts.add")}
															</Button>
														</div>
														{xhttpHeaderFields.map((field, index) => (
															<div key={field.id} className="flex flex-row gap-2 items-start">
																<FormControl>
																	<Input
																		{...register(
																			`xhttpHeaders.${index}.name` as const,
																		)}
																		placeholder={t("inbounds.ws.headerName")}
																		onPaste={(event) => {
																			const headers = parseHeaderPairs(event.clipboardData.getData("text"));
																			if (!headers) return;
																			event.preventDefault();
																			removeXhttpHeader(index);
																			insertXhttpHeader(index, headers);
																		}}
																	/>
																</FormControl>
																<FormControl>
																	<Input
																		{...register(
																			`xhttpHeaders.${index}.value` as const,
																		)}
																		placeholder={t("inbounds.ws.headerValue")}
																	/>
																</FormControl>
																<Button onClick={() => removeXhttpHeader(index)} variant="ghost" size="xs" className="text-destructive hover:bg-destructive/10">
																	{t("delete")}
																</Button>
															</div>
														))}
													</div>
													<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
														<FormControl>
															<FormLabel helpKey="inbounds.xhttp.modeHelp">{t("inbounds.xhttp.mode")}</FormLabel>
															<SearchableTagSelect
																value={formValues.xhttpMode || ""}
																options={[
																	{
																		value: "",
																		label: t("common.default"),
																	},
																	...XHTTP_MODE_OPTIONS,
																]}
																placeholder={t("inbounds.xhttp.mode")}
																onChange={(value) =>
																	form.setValue(
																		"xhttpMode",
																		String(
																			value,
																		) as InboundFormValues["xhttpMode"],
																		{
																			shouldDirty: true,
																			shouldValidate: true,
																		},
																	)
																}
															/>
														</FormControl>
														<FormControl isInvalid={
																!!fieldValidationErrors.xhttpPaddingBytes
															}>
															<FormLabel helpKey="inbounds.xhttp.paddingBytesHelp">{t("inbounds.xhttp.paddingBytes")}</FormLabel>
															<Input
																{...register("xhttpPaddingBytes")}
																placeholder="100-1000"
															/>
															{fieldValidationErrors.xhttpPaddingBytes && (
																<p className="text-[0.75rem] text-red-500 mt-1">
																	{fieldValidationErrors.xhttpPaddingBytes}
																</p>
															)}
														</FormControl>
													</div>
													<div className="flex flex-col gap-3 xray-dialog-section" data-form-section="xhttp-session" data-form-section-title={"Session and XMUX"}>
														<p className="text-[0.875rem] font-semibold">
															Session and XMUX
														</p>
														<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
															<FormControl isInvalid={
																	!!fieldValidationErrors.xhttpSessionIDTable
																}>
																<FormLabel>Session ID table</FormLabel>
																<Input
																	{...register("xhttpSessionIDTable")}
																	placeholder="base64"
																/>
																{fieldValidationErrors.xhttpSessionIDTable && (
																	<FieldError>
																		{fieldValidationErrors.xhttpSessionIDTable}
																	</FieldError>
																)}
															</FormControl>
															<FormControl isInvalid={
																	!!fieldValidationErrors.xhttpSessionIDLength
																}>
																<FormLabel>Session ID length</FormLabel>
																<Input
																	{...register("xhttpSessionIDLength")}
																	placeholder="16-16"
																/>
																{fieldValidationErrors.xhttpSessionIDLength && (
																	<FieldError>
																		{fieldValidationErrors.xhttpSessionIDLength}
																	</FieldError>
																)}
															</FormControl>
															{(
																[
																	[
																		"xhttpXmuxMaxConcurrency",
																		"Max concurrency",
																		"16-32",
																	],
																	[
																		"xhttpXmuxMaxConnections",
																		"Max connections",
																		"0",
																	],
																	[
																		"xhttpXmuxCMaxReuseTimes",
																		"Connection reuse times",
																		"0",
																	],
																	[
																		"xhttpXmuxHMaxRequestTimes",
																		"HTTP request times",
																		"0",
																	],
																	[
																		"xhttpXmuxHMaxReusableSecs",
																		"HTTP reusable seconds",
																		"0",
																	],
																	[
																		"xhttpXmuxHKeepAlivePeriod",
																		"HTTP keep-alive period",
																		"0",
																	],
																] as const
															).map(([name, label, placeholder]) => (
																<FormControl key={name} isInvalid={!!fieldValidationErrors[name]}>
																	<FormLabel>{label}</FormLabel>
																	<Input
																		{...register(
																			name as keyof InboundFormValues,
																		)}
																		placeholder={placeholder}
																	/>
																	{fieldValidationErrors[name] && (
																		<FieldError>
																			{fieldValidationErrors[name]}
																		</FieldError>
																	)}
																</FormControl>
															))}
														</div>
													</div>
													{(xhttpMode === "packet-up" || xhttpMode === "auto") && (
														<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
															<FormControl>
																<FormLabel helpKey="inbounds.xhttp.maxBufferedHelp">{t("inbounds.xhttp.maxBuffered")}</FormLabel>
																<Input
																	{...register("xhttpScMaxBufferedPosts")}
																	placeholder="30"
																/>
															</FormControl>
															<FormControl>
																<FormLabel helpKey="inbounds.xhttp.maxUploadBytesHelp">{t("inbounds.xhttp.maxUploadBytes")}</FormLabel>
																<Input
																	{...register("xhttpScMaxEachPostBytes")}
																	placeholder="1000000"
																/>
															</FormControl>
															<FormControl>
																<FormLabel helpKey="inbounds.xhttp.minPostsIntervalHelp">{t("inbounds.xhttp.minPostsInterval")}</FormLabel>
																<Input
																	{...register("xhttpScMinPostsIntervalMs")}
																	placeholder="30"
																/>
															</FormControl>
														</div>
													)}
													{xhttpMode === "stream-up" && (
														<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
															<FormControl>
																<FormLabel helpKey="inbounds.xhttp.maxBufferedHelp">{t("inbounds.xhttp.maxBuffered")}</FormLabel>
																<Input
																	{...register("xhttpScMaxBufferedPosts")}
																	placeholder="30"
																/>
															</FormControl>
															<FormControl>
																<FormLabel helpKey="inbounds.xhttp.streamUpHelp">{t("inbounds.xhttp.streamUp")}</FormLabel>
																<Input
																	{...register("xhttpScStreamUpServerSecs")}
																	placeholder="20-80"
																/>
															</FormControl>
														</div>
													)}
													<FormControl className="flex items-center">
														<FormLabel className="mb-0" helpKey="inbounds.xhttp.noSSEHelp">{t("inbounds.xhttp.noSSE")}</FormLabel>
														<Controller control={control} name={"xhttpNoSSEHeader"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
													</FormControl>
													<FormControl className="flex items-center">
														<FormLabel className="mb-0" helpKey="inbounds.xhttp.paddingObfsModeHelp">{t("inbounds.xhttp.paddingObfsMode")}</FormLabel>
														<Controller control={control} name={"xhttpPaddingObfsMode"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
													</FormControl>
														<div className="flex flex-col gap-3 mt-2 xray-dialog-section" data-form-section="xhttp-obfs" data-form-section-title={t("inbounds.xhttp.obfsOptions")}>
															<p className="text-[0.875rem] font-semibold">
																{t("inbounds.xhttp.obfsOptions")}
															</p>
														<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
																<FormControl isInvalid={
																		!!fieldValidationErrors.xhttpPaddingKey
																	}>
																	<FormLabel helpKey="inbounds.xhttp.paddingKeyHelp">{t("inbounds.xhttp.paddingKey")}</FormLabel>
																	<Input
																		{...register("xhttpPaddingKey")}
																		placeholder="_dc"
																	/>
																	{fieldValidationErrors.xhttpPaddingKey && (
																		<p className="text-[0.75rem] text-red-500 mt-1">
																			{fieldValidationErrors.xhttpPaddingKey}
																		</p>
																	)}
																</FormControl>

																<FormControl isInvalid={
																		!!fieldValidationErrors.xhttpPaddingHeader
																	}>
																	<FormLabel helpKey="inbounds.xhttp.paddingHeaderHelp">{t("inbounds.xhttp.paddingHeader")}</FormLabel>
																	<Input
																		{...register("xhttpPaddingHeader")}
																		placeholder="Referer"
																	/>
																	{fieldValidationErrors.xhttpPaddingHeader && (
																		<p className="text-[0.75rem] text-red-500 mt-1">
																			{fieldValidationErrors.xhttpPaddingHeader}
																		</p>
																	)}
																</FormControl>

																<FormControl isInvalid={
																		!!fieldValidationErrors.xhttpPaddingPlacement
																	}>
																	<FormLabel helpKey="inbounds.xhttp.paddingPlacementHelp">{t("inbounds.xhttp.paddingPlacement")}</FormLabel>
																	<Controller
																		control={control}
																		name="xhttpPaddingPlacement"
																		render={({ field }) => (
																			<SearchableTagSelect
																				value={field.value || ""}
																				options={[
																					{
																						value: "",
																						label: t("common.default"),
																					},
																					...XHTTP_PADDING_PLACEMENT_OPTIONS,
																				]}
																			placeholder={t(
																				"inbounds.xhttp.paddingPlacement",
																			)}
																				onChange={(value) =>
																					form.setValue(
																						"xhttpPaddingPlacement",
																						String(
																							value,
																						) as InboundFormValues["xhttpPaddingPlacement"],
																						{
																							shouldDirty: true,
																							shouldValidate: true,
																						},
																					)
																				}
																			/>
																		)}
																	/>
																	{fieldValidationErrors.xhttpPaddingPlacement && (
																		<p className="text-[0.75rem] text-red-500 mt-1">
																		{
																			fieldValidationErrors.xhttpPaddingPlacement
																		}
																		</p>
																	)}
																</FormControl>

																<FormControl isInvalid={
																		!!fieldValidationErrors.xhttpPaddingMethod
																	}>
																	<FormLabel helpKey="inbounds.xhttp.paddingMethodHelp">{t("inbounds.xhttp.paddingMethod")}</FormLabel>
																	<Controller
																		control={control}
																		name="xhttpPaddingMethod"
																		render={({ field }) => (
																			<SearchableTagSelect
																				value={field.value || ""}
																				options={[
																					{
																						value: "",
																						label: t("common.default"),
																					},
																					...XHTTP_PADDING_METHOD_OPTIONS,
																				]}
																			placeholder={t(
																				"inbounds.xhttp.paddingMethod",
																			)}
																				onChange={(value) =>
																					form.setValue(
																						"xhttpPaddingMethod",
																						String(
																							value,
																						) as InboundFormValues["xhttpPaddingMethod"],
																						{
																							shouldDirty: true,
																							shouldValidate: true,
																						},
																					)
																				}
																			/>
																		)}
																	/>
																	{fieldValidationErrors.xhttpPaddingMethod && (
																		<p className="text-[0.75rem] text-red-500 mt-1">
																			{fieldValidationErrors.xhttpPaddingMethod}
																		</p>
																	)}
																</FormControl>

																<FormControl isInvalid={
																		!!fieldValidationErrors.xhttpUplinkHTTPMethod
																	}>
																	<FormLabel helpKey="inbounds.xhttp.uplinkHTTPMethodHelp">{t("inbounds.xhttp.uplinkHTTPMethod")}</FormLabel>
																	<Input
																		{...register("xhttpUplinkHTTPMethod")}
																		placeholder="POST"
																	/>
																	{fieldValidationErrors.xhttpUplinkHTTPMethod && (
																		<p className="text-[0.75rem] text-red-500 mt-1">
																		{
																			fieldValidationErrors.xhttpUplinkHTTPMethod
																		}
																		</p>
																	)}
																</FormControl>

																<FormControl isInvalid={
																		!!fieldValidationErrors.xhttpSessionPlacement
																	}>
																	<FormLabel helpKey="inbounds.xhttp.sessionPlacementHelp">{t("inbounds.xhttp.sessionPlacement")}</FormLabel>
																	<Controller
																		control={control}
																		name="xhttpSessionPlacement"
																		render={({ field }) => (
																			<SearchableTagSelect
																				value={field.value || ""}
																				options={[
																					{
																						value: "",
																						label: t("common.default"),
																					},
																					...XHTTP_SESSION_PLACEMENT_OPTIONS,
																				]}
																			placeholder={t(
																				"inbounds.xhttp.sessionPlacement",
																			)}
																				onChange={(value) =>
																					form.setValue(
																						"xhttpSessionPlacement",
																						String(
																							value,
																						) as InboundFormValues["xhttpSessionPlacement"],
																						{
																							shouldDirty: true,
																							shouldValidate: true,
																						},
																					)
																				}
																			/>
																		)}
																	/>
																	{fieldValidationErrors.xhttpSessionPlacement && (
																		<p className="text-[0.75rem] text-red-500 mt-1">
																		{
																			fieldValidationErrors.xhttpSessionPlacement
																		}
																		</p>
																	)}
																</FormControl>

																<FormControl isInvalid={
																		!!fieldValidationErrors.xhttpSessionKey
																	}>
																	<FormLabel helpKey="inbounds.xhttp.sessionKeyHelp">{t("inbounds.xhttp.sessionKey")}</FormLabel>
																	<Input {...register("xhttpSessionKey")} />
																	{fieldValidationErrors.xhttpSessionKey && (
																		<p className="text-[0.75rem] text-red-500 mt-1">
																			{fieldValidationErrors.xhttpSessionKey}
																		</p>
																	)}
																</FormControl>

																<FormControl isInvalid={
																		!!fieldValidationErrors.xhttpSeqPlacement
																	}>
																	<FormLabel helpKey="inbounds.xhttp.seqPlacementHelp">{t("inbounds.xhttp.seqPlacement")}</FormLabel>
																	<Controller
																		control={control}
																		name="xhttpSeqPlacement"
																		render={({ field }) => (
																			<SearchableTagSelect
																				value={field.value || ""}
																				options={[
																					{
																						value: "",
																						label: t("common.default"),
																					},
																					...XHTTP_SEQ_PLACEMENT_OPTIONS,
																				]}
																			placeholder={t(
																				"inbounds.xhttp.seqPlacement",
																			)}
																				onChange={(value) =>
																					form.setValue(
																						"xhttpSeqPlacement",
																						String(
																							value,
																						) as InboundFormValues["xhttpSeqPlacement"],
																						{
																							shouldDirty: true,
																							shouldValidate: true,
																						},
																					)
																				}
																			/>
																		)}
																	/>
																	{fieldValidationErrors.xhttpSeqPlacement && (
																		<p className="text-[0.75rem] text-red-500 mt-1">
																			{fieldValidationErrors.xhttpSeqPlacement}
																		</p>
																	)}
																</FormControl>

																<FormControl isInvalid={!!fieldValidationErrors.xhttpSeqKey}>
																	<FormLabel helpKey="inbounds.xhttp.seqKeyHelp">{t("inbounds.xhttp.seqKey")}</FormLabel>
																	<Input {...register("xhttpSeqKey")} />
																	{fieldValidationErrors.xhttpSeqKey && (
																		<p className="text-[0.75rem] text-red-500 mt-1">
																			{fieldValidationErrors.xhttpSeqKey}
																		</p>
																	)}
																</FormControl>

																<FormControl isInvalid={
																		!!fieldValidationErrors.xhttpUplinkDataPlacement
																	}>
																	<FormLabel helpKey="inbounds.xhttp.uplinkDataPlacementHelp">{t("inbounds.xhttp.uplinkDataPlacement")}</FormLabel>
																	<Controller
																		control={control}
																		name="xhttpUplinkDataPlacement"
																		render={({ field }) => (
																			<SearchableTagSelect
																				value={field.value || ""}
																				options={[
																					{
																						value: "",
																						label: t("common.default"),
																					},
																					...XHTTP_UPLINK_DATA_PLACEMENT_OPTIONS,
																				]}
																			placeholder={t(
																				"inbounds.xhttp.uplinkDataPlacement",
																			)}
																				onChange={(value) =>
																					form.setValue(
																						"xhttpUplinkDataPlacement",
																						String(
																							value,
																						) as InboundFormValues["xhttpUplinkDataPlacement"],
																						{
																							shouldDirty: true,
																							shouldValidate: true,
																						},
																					)
																				}
																			/>
																		)}
																	/>
																	{fieldValidationErrors.xhttpUplinkDataPlacement && (
																		<p className="text-[0.75rem] text-red-500 mt-1">
																		{
																			fieldValidationErrors.xhttpUplinkDataPlacement
																		}
																		</p>
																	)}
																</FormControl>

																<FormControl isInvalid={
																		!!fieldValidationErrors.xhttpUplinkDataKey
																	}>
																	<FormLabel helpKey="inbounds.xhttp.uplinkDataKeyHelp">{t("inbounds.xhttp.uplinkDataKey")}</FormLabel>
																	<Input
																		{...register("xhttpUplinkDataKey")}
																		placeholder="X-Data"
																	/>
																	{fieldValidationErrors.xhttpUplinkDataKey && (
																		<p className="text-[0.75rem] text-red-500 mt-1">
																			{fieldValidationErrors.xhttpUplinkDataKey}
																		</p>
																	)}
																</FormControl>

																<FormControl isInvalid={
																		!!fieldValidationErrors.xhttpUplinkChunkSize
																	}>
																	<FormLabel helpKey="inbounds.xhttp.uplinkChunkSizeHelp">{t("inbounds.xhttp.uplinkChunkSize")}</FormLabel>
																	<Input
																		{...register("xhttpUplinkChunkSize")}
																		placeholder="3000-4000"
																	/>
																	{fieldValidationErrors.xhttpUplinkChunkSize && (
																		<p className="text-[0.75rem] text-red-500 mt-1">
																			{fieldValidationErrors.xhttpUplinkChunkSize}
																		</p>
																	)}
																</FormControl>

																<FormControl isInvalid={
																		!!fieldValidationErrors.xhttpServerMaxHeaderBytes
																	}>
																	<FormLabel helpKey="inbounds.xhttp.serverMaxHeaderBytesHelp">{t("inbounds.xhttp.serverMaxHeaderBytes")}</FormLabel>
																	<Input
																		{...register("xhttpServerMaxHeaderBytes")}
																		placeholder="0"
																	/>
																	{fieldValidationErrors.xhttpServerMaxHeaderBytes && (
																		<p className="text-[0.75rem] text-red-500 mt-1">
																		{
																			fieldValidationErrors.xhttpServerMaxHeaderBytes
																		}
																		</p>
																	)}
																</FormControl>
															</div>
														</div>
												</div>
											)}

											{streamNetwork === "hysteria" && (
												<div className="flex flex-col gap-3">
													<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
														<FormControl>
															<FormLabel helpKey="inbounds.hysteria.versionHelp">{t("inbounds.hysteria.version")}</FormLabel>
															<Input
																{...register("hysteriaVersion")}
																placeholder="2"
																disabled
															/>
														</FormControl>
														<FormControl isInvalid={
																!!fieldValidationErrors.hysteriaUdpIdleTimeout
															}>
															<FormLabel helpKey="inbounds.hysteria.udpIdleTimeoutHelp">{t("inbounds.hysteria.udpIdleTimeout")}</FormLabel>
															<Input
																{...register("hysteriaUdpIdleTimeout")}
																placeholder="60"
															/>
															{fieldValidationErrors.hysteriaUdpIdleTimeout && (
																<p className="text-[0.75rem] text-red-500 mt-1">
																	{fieldValidationErrors.hysteriaUdpIdleTimeout}
																</p>
															)}
														</FormControl>
													</div>

													<FormControl className="flex items-center">
														<FormLabel className="mb-0" helpKey="inbounds.hysteria.enableMasqueradeHelp">{t("inbounds.hysteria.enableMasquerade")}</FormLabel>
														<Controller control={control} name={"hysteriaMasqueradeEnabled"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
													</FormControl>
													<Collapsible open={Boolean(hysteriaMasqueradeEnabled)}><CollapsibleContent forceMount className="data-[state=closed]:hidden">
														<div className="flex flex-col gap-3 mt-2">
															<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
																<FormControl isInvalid={
																		!!fieldValidationErrors.hysteriaMasqueradeType
																	}>
																	<FormLabel helpKey="inbounds.hysteria.masqueradeTypeHelp">{t("inbounds.hysteria.masqueradeType")}</FormLabel>
																	<SearchableTagSelect
																		value={hysteriaMasqueradeType}
																		options={[
																			{
																				value: "",
																				label: t(
																					"inbounds.hysteria.defaultMasquerade",
																				),
																			},
																			{
																				value: "proxy",
																				label: "proxy (reverse proxy)",
																			},
																			{
																				value: "file",
																				label: "file (serve directory)",
																			},
																			{
																				value: "string",
																				label: "string (fixed body)",
																			},
																		]}
																		placeholder={t(
																			"inbounds.hysteria.masqueradeType",
																		)}
																		onChange={(value) =>
																			form.setValue(
																				"hysteriaMasqueradeType",
																				String(
																					value,
																				) as InboundFormValues["hysteriaMasqueradeType"],
																				{
																					shouldDirty: true,
																					shouldValidate: true,
																				},
																			)
																		}
																	/>
																	{fieldValidationErrors.hysteriaMasqueradeType && (
																		<p className="text-[0.75rem] text-red-500 mt-1">
																			{
																				fieldValidationErrors.hysteriaMasqueradeType
																			}
																		</p>
																	)}
																</FormControl>
																{hysteriaMasqueradeType === "string" && (
																	<FormControl>
																		<FormLabel helpKey="inbounds.hysteria.statusCodeHelp">{t("inbounds.hysteria.statusCode")}</FormLabel>
																		<Input
																			{...register(
																				"hysteriaMasqueradeStatusCode",
																			)}
																			placeholder="200"
																		/>
																	</FormControl>
																)}
															</div>

															{hysteriaMasqueradeType === "proxy" && (
																<div className="flex flex-col gap-3">
																	<FormControl isInvalid={
																			!!fieldValidationErrors.hysteriaMasqueradeUrl
																		}>
																		<FormLabel helpKey="settings.telegram.proxyUrlHelp">{t("settings.telegram.proxyUrl")}</FormLabel>
																		<Input
																			{...register("hysteriaMasqueradeUrl")}
																			placeholder="https://example.com"
																		/>
																		{fieldValidationErrors.hysteriaMasqueradeUrl && (
																			<p className="text-[0.75rem] text-red-500 mt-1">
																				{
																					fieldValidationErrors.hysteriaMasqueradeUrl
																				}
																			</p>
																		)}
																	</FormControl>
																	<div className="flex flex-row items-center gap-6 flex-wrap">
																		<FormControl className="flex items-center w-auto">
																			<FormLabel className="mb-0" helpKey="inbounds.hysteria.rewriteHostHelp">{t("inbounds.hysteria.rewriteHost")}</FormLabel>
																			<Controller control={control} name={"hysteriaMasqueradeRewriteHost"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
																		</FormControl>
																		<FormControl className="flex items-center w-auto">
																			<FormLabel className="mb-0" helpKey="inbounds.hysteria.insecureHelp">{t("inbounds.hysteria.insecure")}</FormLabel>
																			<Controller control={control} name={"hysteriaMasqueradeInsecure"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
																		</FormControl>
																	</div>
																</div>
															)}

															{hysteriaMasqueradeType === "file" && (
																<FormControl isInvalid={
																		!!fieldValidationErrors.hysteriaMasqueradeDir
																	}>
																	<FormLabel helpKey="inbounds.hysteria.fileDirHelp">{t("inbounds.hysteria.fileDir")}</FormLabel>
																	<Input
																		{...register("hysteriaMasqueradeDir")}
																		placeholder="/var/www/html"
																	/>
																	{fieldValidationErrors.hysteriaMasqueradeDir && (
																		<p className="text-[0.75rem] text-red-500 mt-1">
																			{
																				fieldValidationErrors.hysteriaMasqueradeDir
																			}
																		</p>
																	)}
																</FormControl>
															)}

															{hysteriaMasqueradeType === "string" && (
																<FormControl>
																	<FormLabel helpKey="inbounds.hysteria.contentHelp">{t("inbounds.hysteria.content")}</FormLabel>
																	<Textarea
																		{...register("hysteriaMasqueradeContent")}
																		placeholder="ok"
																	/>
																</FormControl>
															)}

															<div className="flex flex-col gap-2">
																<div className="flex justify-between items-center">
																	<p className="font-medium">
																		{t("inbounds.hysteria.headers")}
																	</p>
																	<Button onClick={() =>
																			appendHysteriaMasqueradeHeader({
																				name: "",
																				value: "",
																			})
																		} size="xs">
																		{t("inbounds.accounts.add")}
																	</Button>
																</div>
																{hysteriaMasqueradeHeaderFields.map(
																	(field, index) => (
																		<div key={field.id} className="flex flex-row gap-2 items-start">
																			<FormControl>
																				<Input
																					{...register(
																						`hysteriaMasqueradeHeaders.${index}.name` as const,
																					)}
																					placeholder={t(
																						"inbounds.ws.headerName",
																					)}
																				/>
																			</FormControl>
																			<FormControl>
																				<Input
																					{...register(
																						`hysteriaMasqueradeHeaders.${index}.value` as const,
																					)}
																					placeholder={t(
																						"inbounds.ws.headerValue",
																					)}
																				/>
																			</FormControl>
																			<Button onClick={() =>
																					removeHysteriaMasqueradeHeader(index)
																				} variant="ghost" size="xs" className="text-destructive hover:bg-destructive/10">
																				{t("delete")}
																			</Button>
																		</div>
																	),
																)}
															</div>
														</div>
													</CollapsibleContent></Collapsible>

													<div className="flex flex-col gap-3 xray-dialog-section" data-form-section="hysteria-udp-masks" data-form-section-title={t("inbounds.hysteria.udpMasks")}>
														<div className="flex justify-between items-center gap-3">
															<div>
																<div className="flex min-w-0 items-center gap-1.5"><p className="text-[0.875rem] font-semibold">{t("inbounds.hysteria.udpMasks")}</p><FieldHint>{t("inbounds.hysteria.udpMasksHint")}</FieldHint></div>
															</div>
															<Button onClick={() =>
																	appendHysteriaUdpMask(
																		createDefaultHysteriaUdpMask(),
																	)
																} size="xs">{<Sparkles className="w-[14px] h-[14px]" />}
																{t("inbounds.hysteria.addUdpMask")}
															</Button>
														</div>
														{fieldValidationErrors.hysteriaUdpMasks && (
															<p className="text-[0.75rem] text-red-500">
																{fieldValidationErrors.hysteriaUdpMasks}
															</p>
														)}
														{hysteriaUdpMaskFields.length === 0 && (
															<p className="text-[0.75rem] text-gray-500">
																{t("inbounds.hysteria.noUdpMasks")}
															</p>
														)}
														{hysteriaUdpMaskFields.map((field, index) => {
															const maskMode =
																formValues.hysteriaUdpMasks?.[index]?.mode ||
																"salamander";
															return (
																<div key={field.id} className="flex flex-col gap-3 border border-whiteAlpha-200! rounded-md p-3">
																	<div className="flex justify-between items-center">
																		<p className="text-[0.875rem] font-semibold">
																			{t("inbounds.hysteria.udpMaskTitle", {
																				index: index + 1,
																			})}
																		</p>
																		<Button onClick={() =>
																				removeHysteriaUdpMask(index)
																			} variant="ghost" size="xs" className="text-destructive hover:bg-destructive/10">
																			{t("delete")}
																		</Button>
																	</div>
																	<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
																		<FormControl>
																			<FormLabel helpKey="inbounds.fallbacks.typeHelp">{t("inbounds.fallbacks.type")}</FormLabel>
																			<SearchableTagSelect
																				value="salamander"
																				disabled
																				options={[
																					{
																						value: "salamander",
																						label: "Salamander (Hysteria2)",
																					},
																				]}
																				placeholder="Salamander (Hysteria2)"
																				onChange={() => undefined}
																			/>
																		</FormControl>
																		<FormControl>
																			<div className="mb-1 flex min-w-0 items-center gap-1.5"><FormLabel className="mb-0">{t("inbounds.xhttp.mode")}</FormLabel><FieldHint>{maskMode === "gecko" ? t("inbounds.hysteria.geckoHint") : t("inbounds.hysteria.salamanderHint")}</FieldHint></div>
																			<Controller
																				control={control}
																				name={
																					`hysteriaUdpMasks.${index}.mode` as const
																				}
																				render={({ field: modeField }) => (
																					<SearchableTagSelect
																						value={
																							modeField.value || "salamander"
																						}
																						options={[
																							{
																								value: "salamander",
																								label: "Salamander",
																							},
																							{
																								value: "gecko",
																								label: "Gecko experimental",
																							},
																						]}
																						placeholder={t(
																							"inbounds.xhttp.mode",
																						)}
																						onChange={(value) =>
																							modeField.onChange(String(value))
																						}
																					/>
																				)}
																			/>
																			
																		</FormControl>
																		<FormControl>
																			<FormLabel helpKey="passwordHelp">{t("password")}</FormLabel>
																			<div className="flex flex-row items-center gap-2">
																				<Input
																					{...register(
																						`hysteriaUdpMasks.${index}.password` as const,
																					)}
																					placeholder="Obfuscation password"
																				/>
																				<Button aria-label={t(
																						"inbounds.hysteria.generatePassword",
																					)} onClick={() =>
																						form.setValue(
																							`hysteriaUdpMasks.${index}.password`,
																							randomLowerAndNum(16),
																							{
																								shouldDirty: true,
																								shouldValidate: true,
																							},
																						)
																					} variant="outline" size="sm" className="size-8 p-0">{<RefreshCw className="w-[16px] h-[16px]" />}</Button>
																			</div>
																		</FormControl>
																		{maskMode === "gecko" && (
																			<FormControl>
																				<div className="mb-1 flex min-w-0 items-center gap-1.5"><FormLabel className="mb-0">{t("inbounds.hysteria.packetSize")}</FormLabel><FieldHint>{t("inbounds.hysteria.packetSizeHint")}</FieldHint></div>
																				<Input
																					{...register(
																						`hysteriaUdpMasks.${index}.packetSize` as const,
																					)}
																					placeholder="512-1200"
																				/>
																			</FormControl>
																		)}
																	</div>
																</div>
															);
														})}
													</div>

													<div className="flex flex-col gap-3 xray-dialog-section" data-form-section="hysteria-quic" data-form-section-title={t("inbounds.hysteria.quicParams")}>
														<FormControl className="flex items-center">
															<FormLabel className="mb-0" helpKey="inbounds.hysteria.quicParamsHelp">{t("inbounds.hysteria.quicParams")}</FormLabel>
															<Controller control={control} name={"hysteriaQuicParams.enabled"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
														</FormControl>
														<Collapsible open={Boolean(
																formValues.hysteriaQuicParams?.enabled,
															)}><CollapsibleContent forceMount className="data-[state=closed]:hidden">
															<div className="flex flex-col gap-3 mt-2">
																<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
																	<FormControl>
																		<FormLabel helpKey="inbounds.hysteria.congestionHelp">{t("inbounds.hysteria.congestion")}</FormLabel>
																		<Controller
																			control={control}
																			name="hysteriaQuicParams.congestion"
																			render={({ field }) => (
																				<SearchableTagSelect
																					value={field.value || "bbr"}
																					options={[
																						"reno",
																						"bbr",
																						"brutal",
																						"force-brutal",
																					]}
																					placeholder={t(
																						"inbounds.hysteria.congestion",
																					)}
																					onChange={(value) =>
																						field.onChange(String(value))
																					}
																				/>
																			)}
																		/>
																	</FormControl>
																	{formValues.hysteriaQuicParams?.congestion ===
																		"bbr" && (
																		<FormControl>
																			<FormLabel helpKey="inbounds.hysteria.bbrProfileHelp">{t("inbounds.hysteria.bbrProfile")}</FormLabel>
																			<Controller
																				control={control}
																				name="hysteriaQuicParams.bbrProfile"
																				render={({ field }) => (
																					<SearchableTagSelect
																						value={field.value || ""}
																						options={[
																							{
																								value: "",
																								label: t("common.auto"),
																							},
																							"conservative",
																							"standard",
																							"aggressive",
																						]}
																						placeholder="standard"
																						onChange={(value) =>
																							field.onChange(String(value))
																						}
																					/>
																				)}
																			/>
																		</FormControl>
																	)}
																</div>
																{["brutal", "force-brutal"].includes(
																	formValues.hysteriaQuicParams?.congestion ||
																		"",
																) && (
																	<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
																		<FormControl>
																			<FormLabel>Brutal Up</FormLabel>
																			<Input
																				{...register(
																					"hysteriaQuicParams.brutalUp",
																				)}
																				placeholder="60 mbps"
																			/>
																		</FormControl>
																		<FormControl>
																			<FormLabel>Brutal Down</FormLabel>
																			<Input
																				{...register(
																					"hysteriaQuicParams.brutalDown",
																				)}
																				placeholder="100 mbps"
																			/>
																		</FormControl>
																	</div>
																)}
																<div className="flex flex-row items-center gap-6 flex-wrap">
																	<FormControl className="flex items-center w-auto">
																		<FormLabel className="mb-0" helpKey="common.debugHelp">{t("common.debug")}</FormLabel>
																		<Controller control={control} name={"hysteriaQuicParams.debug"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
																	</FormControl>
																	<FormControl className="flex items-center w-auto">
																		<FormLabel className="mb-0" helpKey="inbounds.hysteria.udpHopHelp">{t("inbounds.hysteria.udpHop")}</FormLabel>
																		<Controller control={control} name={"hysteriaQuicParams.udpHopEnabled"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
																	</FormControl>
																</div>
																{formValues.hysteriaQuicParams
																	?.udpHopEnabled && (
																	<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
																		<FormControl>
																			<FormLabel helpKey="inbounds.hysteria.hopPortsHelp">{t("inbounds.hysteria.hopPorts")}</FormLabel>
																			<Input
																				{...register(
																					"hysteriaQuicParams.udpHopPorts",
																				)}
																				placeholder="20000-50000"
																			/>
																		</FormControl>
																		<FormControl>
																			<FormLabel helpKey="inbounds.hysteria.hopIntervalHelp">{t("inbounds.hysteria.hopInterval")}</FormLabel>
																			<Input
																				{...register(
																					"hysteriaQuicParams.udpHopInterval",
																				)}
																				placeholder="5-10"
																			/>
																		</FormControl>
																	</div>
																)}
																<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
																	{HYSTERIA_QUIC_INPUT_FIELDS.map(
																		({ name, label, placeholder }) => (
																			<FormControl key={name}>
																				<FormLabel>{label}</FormLabel>
																				<Input
																					{...register(
																						`hysteriaQuicParams.${name}` as const,
																					)}
																					placeholder={placeholder}
																				/>
																			</FormControl>
																		),
																	)}
																</div>
																<FormControl className="flex items-center">
																	<FormLabel className="mb-0" helpKey="inbounds.hysteria.disablePathMtuHelp">{t("inbounds.hysteria.disablePathMtu")}</FormLabel>
																	<Controller control={control} name={"hysteriaQuicParams.disablePathMTUDiscovery"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
																</FormControl>
															</div>
														</CollapsibleContent></Collapsible>
													</div>
												</div>
											)}
											<div className="col-span-full flex flex-col xray-dialog-section" data-form-section="sockopt" data-form-section-title={t("hostsDialog.sockopt")}><FormControl className="flex items-center">
												<FormLabel className="mb-0" helpKey="inbounds.sockopt.enableHelp">{t("inbounds.sockopt.enable")}</FormLabel>
												<Controller
													control={control}
													name="sockoptEnabled"
													render={({ field }) => (
														<Switch checked={Boolean(field.value)} onCheckedChange={(checked: boolean) => field.onChange(checked)} />
													)}
												/>
											</FormControl>
											<Collapsible open={Boolean(sockoptEnabled)}><CollapsibleContent forceMount className="data-[state=closed]:hidden">
												<div className="flex flex-col gap-3 mt-2 xray-dialog-section">
													<p className="text-[0.875rem] font-semibold">
														{t("hostsDialog.sockopt")}
													</p>
													<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
														{renderSockoptNumberInput(
															"mark",
															t("inbounds.sockopt.routeMark"),
														)}
														{renderSockoptNumberInput(
															"tcpKeepAliveInterval",
															t("inbounds.sockopt.tcpKeepAliveInterval"),
														)}
														{renderSockoptNumberInput(
															"tcpKeepAliveIdle",
															t("inbounds.sockopt.tcpKeepAliveIdle"),
														)}
														{renderSockoptNumberInput(
															"tcpMaxSeg",
															t("inbounds.sockopt.tcpMaxSeg"),
														)}
														{renderSockoptNumberInput(
															"tcpUserTimeout",
															t("inbounds.sockopt.tcpUserTimeout"),
														)}
														{renderSockoptNumberInput(
															"tcpWindowClamp",
															t("inbounds.sockopt.tcpWindowClamp"),
														)}
													</div>
													<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
														{renderSockoptTextInput(
															"dialerProxy",
															t("inbounds.sockopt.dialerProxy"),
															"proxy",
														)}
														{renderSockoptTextInput(
															"interfaceName",
															t("inbounds.sockopt.interfaceName"),
														)}
													</div>
													<FormControl>
														<div className="mb-1 flex min-w-0 items-center gap-1.5"><FormLabel>Trusted forwarded IP headers</FormLabel><FieldHint>{t("inbounds.sockopt.trustedHeadersHint")}</FieldHint></div>
														<Textarea
															{...register("sockopt.trustedXForwardedFor")}
															rows={2}
															placeholder="X-Forwarded-For"
														/>
													</FormControl>
													<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
														<FormControl>
															<FormLabel helpKey="inbounds.sockopt.domainStrategyHelp">{t("inbounds.sockopt.domainStrategy")}</FormLabel>
															<Controller
																control={control}
																name="sockopt.domainStrategy"
																render={({ field }) => (
																	<SearchableTagSelect
																		value={field.value || ""}
																		options={[
																			{
																				value: "",
																				label: t("userDialog.flow.none"),
																			},
																			...DOMAIN_STRATEGY_OPTIONS,
																		]}
																		placeholder={t(
																			"inbounds.sockopt.domainStrategy",
																		)}
																		onChange={(value) =>
																			field.onChange(String(value))
																		}
																	/>
																)}
															/>
														</FormControl>
														<FormControl>
															<FormLabel helpKey="inbounds.sockopt.tcpCongestionHelp">{t("inbounds.sockopt.tcpCongestion")}</FormLabel>
															<Controller
																control={control}
																name="sockopt.tcpcongestion"
																render={({ field }) => (
																	<SearchableTagSelect
																		value={field.value || ""}
																		options={[
																			{
																				value: "",
																				label: t("userDialog.flow.none"),
																			},
																			...TCP_CONGESTION_OPTIONS,
																		]}
																		placeholder={t(
																			"inbounds.sockopt.tcpCongestion",
																		)}
																		onChange={(value) =>
																			field.onChange(String(value))
																		}
																	/>
																)}
															/>
														</FormControl>
														<FormControl>
															<FormLabel helpKey="inbounds.sockopt.tproxyHelp">{t("inbounds.sockopt.tproxy")}</FormLabel>
															<Controller
																control={control}
																name="sockopt.tproxy"
																render={({ field }) => (
																	<SearchableTagSelect
																		value={field.value || ""}
																		options={TPROXY_OPTIONS.map((option) => ({
																			value: option,
																			label:
																				option || t("userDialog.flow.none"),
																		}))}
																		placeholder={t("inbounds.sockopt.tproxy")}
																		onChange={(value) =>
																			field.onChange(String(value))
																		}
																	/>
																)}
															/>
														</FormControl>
													</div>
													<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
														{renderSockoptSwitch(
															"acceptProxyProtocol",
															t("inbounds.sockopt.acceptProxyProtocol"),
														)}
														{renderSockoptSwitch(
															"tcpFastOpen",
															t("inbounds.sockopt.tcpFastOpen"),
														)}
														{renderSockoptSwitch(
															"tcpMptcp",
															t("inbounds.sockopt.tcpMptcp"),
														)}
														{renderSockoptSwitch(
															"penetrate",
															t("inbounds.sockopt.penetrate"),
														)}
														{renderSockoptSwitch(
															"V6Only",
															t("inbounds.sockopt.v6Only"),
														)}
													</div>
												</div>
											</CollapsibleContent></Collapsible></div>
										</div>
									)}

									{streamSecurity !== "tls" &&
										streamSecurity !== "reality" &&
										vlessAuthenticationSection}

									{streamSecurity === "tls" && (
										<div className="flex flex-col gap-3 xray-dialog-section" data-form-section="tls" data-form-section-title={t("inbounds.tls.title")}>
											<p className="text-[0.875rem] font-semibold">
												{t("inbounds.tls.title")}
											</p>
											<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
												<FormControl>
													<FormLabel helpKey="inbounds.tls.serverNameHelp">{t("inbounds.tls.serverName")}</FormLabel>
													<Input
														{...register("tlsServerName")}
														placeholder="example.com"
													/>
												</FormControl>
												{currentProtocol !== "hysteria" && (
													<FormControl>
														<FormLabel helpKey="inbounds.tls.cipherSuitesHelp">{t("inbounds.tls.cipherSuites")}</FormLabel>
														<SearchableTagSelect
															mode="multiple"
															value={
																formValues.tlsCipherSuites
																	?.split(":")
																	.filter(Boolean) ?? []
															}
															options={tlsCipherOptions}
															placeholder={t("inbounds.tls.cipherSuites")}
															onChange={(value) => {
																const suites = (
																	Array.isArray(value) ? value : [value]
																).filter(Boolean);
																form.setValue(
																	"tlsCipherSuites",
																	suites.join(":"),
																	{
																		shouldDirty: true,
																		shouldValidate: true,
																	},
																);
																if (suites.length) {
																	form.setValue("tlsFingerprint", "unsafe", {
																		shouldDirty: true,
																		shouldValidate: true,
																	});
																}
															}}
														/>
													</FormControl>
												)}
											</div>
											<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
												<FormControl>
													<FormLabel helpKey="inbounds.tls.minVersionHelp">{t("inbounds.tls.minVersion")}</FormLabel>
													<SearchableTagSelect
														value={formValues.tlsMinVersion || ""}
														options={tlsVersionOptions}
														placeholder={t("inbounds.tls.minVersion")}
														onChange={(value) =>
															form.setValue("tlsMinVersion", String(value), {
																shouldDirty: true,
																shouldValidate: true,
															})
														}
													/>
												</FormControl>
												<FormControl>
													<FormLabel helpKey="inbounds.tls.maxVersionHelp">{t("inbounds.tls.maxVersion")}</FormLabel>
													<SearchableTagSelect
														value={formValues.tlsMaxVersion || ""}
														options={tlsVersionOptions}
														placeholder={t("inbounds.tls.maxVersion")}
														onChange={(value) =>
															form.setValue("tlsMaxVersion", String(value), {
																shouldDirty: true,
																shouldValidate: true,
															})
														}
													/>
												</FormControl>
											</div>
											<FormControl isInvalid={Boolean(
													fieldValidationErrors.tlsFingerprint,
												)}>
												<FormLabel helpKey="inbounds.tls.fingerprintHelp">{t("inbounds.tls.fingerprint")}</FormLabel>
												<SearchableTagSelect
													value={formValues.tlsFingerprint || ""}
													options={[
														{ value: "", label: t("userDialog.flow.none") },
														...tlsFingerprintOptions,
													]}
													placeholder={t("inbounds.tls.fingerprint")}
													onChange={(value) =>
														form.setValue("tlsFingerprint", String(value), {
															shouldDirty: true,
															shouldValidate: true,
														})
													}
												/>
												{fieldValidationErrors.tlsFingerprint && (
													<FieldError>
														{fieldValidationErrors.tlsFingerprint}
													</FieldError>
												)}
											</FormControl>
											<FormControl>
												<FormLabel helpKey="inbounds.tls.alpnHelp">{t("inbounds.tls.alpn")}</FormLabel>
												<Controller
													control={control}
													name="tlsAlpn"
													render={({ field }) => (
														<SearchableTagSelect
															mode="multiple"
															value={field.value ?? []}
															options={tlsAlpnOptions}
															placeholder={t("inbounds.tls.selectAlpn")}
															searchPlaceholder={t("inbounds.tls.searchAlpn")}
															onChange={(value) =>
																field.onChange(
																	Array.isArray(value)
																		? value
																		: value
																			? [value]
																			: [],
																)
															}
														/>
													)}
												/>
											</FormControl>
											<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
												<FormControl className="flex items-center">
													<FormLabel className="mb-0" helpKey="inbounds.tls.allowInsecureHelp">{t("inbounds.tls.allowInsecure")}</FormLabel>
													<Controller control={control} name={"tlsAllowInsecure"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
												</FormControl>
												<FormControl className="flex items-center">
													<FormLabel className="mb-0" helpKey="inbounds.tls.rejectUnknownSniHelp">{t("inbounds.tls.rejectUnknownSni")}</FormLabel>
													<Controller control={control} name={"tlsRejectUnknownSni"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
												</FormControl>
												<FormControl className="flex items-center">
													<FormLabel className="mb-0" helpKey="inbounds.tls.disableSystemRootHelp">{t("inbounds.tls.disableSystemRoot")}</FormLabel>
													<Controller control={control} name={"tlsDisableSystemRoot"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
												</FormControl>
												<FormControl className="flex items-center">
													<FormLabel className="mb-0" helpKey="inbounds.tls.enableSessionResumptionHelp">{t("inbounds.tls.enableSessionResumption")}</FormLabel>
													<Controller control={control} name={"tlsEnableSessionResumption"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
												</FormControl>
											</div>
											<FormControl>
												<FormLabel helpKey="inbounds.tls.verifyPeerCertByNameHelp">{t("inbounds.tls.verifyPeerCertByName")}</FormLabel>
												<Input {...register("tlsVerifyPeerCertByName")} />
											</FormControl>
											<FormControl>
												<div className="mb-1 flex min-w-0 items-center gap-1.5"><FormLabel>TLS curve preferences</FormLabel><FieldHint>{t("inbounds.tls.curvePreferencesHint")}</FieldHint></div>
												<Textarea
													{...register("tlsCurvePreferences")}
													rows={2}
													placeholder="X25519MLKEM768&#10;X25519"
												/>
											</FormControl>
											<FormControl isInvalid={Boolean(
													fieldValidationErrors.tlsPinnedPeerCertSha256,
												)}>
												<FormLabel helpKey="inbounds.tls.pinnedPeerCertSha256Help">{t("inbounds.tls.pinnedPeerCertSha256")}</FormLabel>
												<Input
													{...register("tlsPinnedPeerCertSha256")}
													placeholder={t(
														"inbounds.tls.pinnedPeerCertSha256Hint",
													)}
												/>
												{fieldValidationErrors.tlsPinnedPeerCertSha256 && (
													<FieldError>
														{fieldValidationErrors.tlsPinnedPeerCertSha256}
													</FieldError>
												)}
											</FormControl>
											<div data-form-section="certificates" data-form-section-title={t("settings.subscriptions.certificateTitle")} className="flex flex-col gap-3">
												<div className="flex items-center justify-between">
													<div className="font-medium">
														{t("settings.subscriptions.certificateTitle")}
													</div>
													<Button onClick={handleAddTlsCertificate} size="xs">
														{t("inbounds.tls.addCertificate")}
													</Button>
												</div>
												{tlsCertificateFields.map((field, index) => {
													const certConfig = tlsCertificates[index] || {
														useFile: true,
														usage: "encipherment",
													};
													const usage = certConfig.usage || "encipherment";
													return (
														<div key={field.id} className={cn("flex flex-col gap-3 border rounded-md p-3", sectionBorder)}>
															<div className="flex justify-between items-center mb-3">
																<p className="font-semibold">
																	{t("nodes.certificate")} #{index + 1}
																</p>
																{tlsCertificateFields.length > 1 && (
																	<Button onClick={() => removeTlsCertificate(index)} variant="ghost" size="xs" className="text-destructive hover:bg-destructive/10">
																		{t("delete")}
																	</Button>
																)}
															</div>
															<FormControl>
																<FormLabel helpKey="inbounds.tls.certificateSourceHelp">{t("inbounds.tls.certificateSource")}</FormLabel>
																<Controller
																	control={control}
																	name={
																		`tlsCertificates.${index}.useFile` as const
																	}
																	render={({ field }) => (
																		<RadioGroup value={field.value ? "file" : "content"} onValueChange={(value) =>
																				field.onChange(value === "file")
																			}>
																			<div className="flex flex-row items-center gap-4">
																				<label className="flex cursor-pointer items-center gap-2 text-sm"><RadioGroupItem value="file" /><span>{t("path")}</span></label>
																				<label className="flex cursor-pointer items-center gap-2 text-sm"><RadioGroupItem value="content" /><span>{t("inbounds.tls.certificateContent")}</span></label>
																			</div>
																		</RadioGroup>
																	)}
																/>
															</FormControl>
															{certConfig.useFile ? (
																<FormControl>
																	<FormLabel helpKey="inbounds.tls.existingCertificateHelp">{t("inbounds.tls.existingCertificate")}</FormLabel>
																	<NativeSelect onChange={(event) => {
																			const certificate = subscriptionBundle?.certificates.find(
																				(item) => item.path === event.target.value,
																			);
																			if (!certificate) {
																				return;
																			}
																			form.setValue(
																				`tlsCertificates.${index}.certFile` as const,
																				`${certificate.path}fullchain.pem`,
																				{ shouldDirty: true },
																			);
																			form.setValue(
																				`tlsCertificates.${index}.keyFile` as const,
																				`${certificate.path}privkey.pem`,
																				{ shouldDirty: true },
																			);
																		}}>
																		{(subscriptionBundle?.certificates ?? [])
																			.filter(
																				(item) =>
																					Boolean(item.path) &&
																					item.status !== "missing" &&
																					item.status !== "invalid" &&
																					item.status !== "revoked",
																			)
																			.map((item) => (
																				<option key={item.domain} value={item.path}>
																					{item.domain}
																				</option>
																			))}
																	</NativeSelect>
																</FormControl>
															) : null}
															{certConfig.useFile ? (
																<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
																	<FormControl>
																		<FormLabel helpKey="inbounds.tls.certFileHelp">{t("inbounds.tls.certFile")}</FormLabel>
																		<Input
																			{...register(
																				`tlsCertificates.${index}.certFile` as const,
																			)}
																		/>
																	</FormControl>
																	<FormControl>
																		<FormLabel helpKey="inbounds.tls.keyFileHelp">{t("inbounds.tls.keyFile")}</FormLabel>
																		<Input
																			{...register(
																				`tlsCertificates.${index}.keyFile` as const,
																			)}
																		/>
																	</FormControl>
																</div>
															) : (
																<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
																	<FormControl>
																		<FormLabel helpKey="nodes.certificateHelp">{t("nodes.certificate")}</FormLabel>
																		<Textarea
																			rows={3}
																			{...register(
																				`tlsCertificates.${index}.cert` as const,
																			)}
																		/>
																	</FormControl>
																	<FormControl>
																		<FormLabel helpKey="myaccount.apiKeyMaskedHelp">{t("myaccount.apiKeyMasked")}</FormLabel>
																		<Textarea
																			rows={3}
																			{...register(
																				`tlsCertificates.${index}.key` as const,
																			)}
																		/>
																	</FormControl>
																</div>
															)}
															<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
<FormControl>
																	<FormLabel helpKey="inbounds.tls.usageHelp">{t("inbounds.tls.usage")}</FormLabel>
																	<SearchableTagSelect
																		value={usage}
																		options={tlsUsageOptions}
																		placeholder={t("inbounds.tls.usage")}
																		onChange={(value) =>
																			form.setValue(
																				`tlsCertificates.${index}.usage` as const,
																				String(value),
																				{
																					shouldDirty: true,
																					shouldValidate: true,
																				},
																			)
																		}
																	/>
																</FormControl>
<FormControl>
	<FormLabel helpKey="inbounds.tls.ocspStaplingHelp">{t("inbounds.tls.ocspStapling")}</FormLabel>
	<FormNumberField control={control} name={`tlsCertificates.${index}.ocspStapling` as const} inputMode="numeric" placeholder="0" />
</FormControl>
</div>
<div className="flex flex-col gap-3">
<FormControl className="flex items-center">
																	<FormLabel className="mb-0" helpKey="inbounds.tls.oneTimeLoadingHelp">{t("inbounds.tls.oneTimeLoading")}</FormLabel>
																	<Controller control={control} name={`tlsCertificates.${index}.oneTimeLoading` as const} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
																</FormControl>
{usage === "issue" && (
<FormControl className="flex items-center">
																	<FormLabel className="mb-0" helpKey="inbounds.tls.buildChainHelp">{t("inbounds.tls.buildChain")}</FormLabel>
																	<Controller control={control} name={`tlsCertificates.${index}.buildChain` as const} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
																</FormControl>
)}
</div>
														</div>
													);
												})}
											</div>
											<hr className="w-full border-0 border-b border-panel-border! opacity-60" />
											<div className="flex flex-col gap-3">
												<FormControl>
													<FormLabel helpKey="inbounds.tls.echKeyHelp">{t("inbounds.tls.echKey")}</FormLabel>
													<Input {...register("tlsEchServerKeys")} />
												</FormControl>
												<FormControl>
													<FormLabel helpKey="inbounds.tls.echConfigHelp">{t("inbounds.tls.echConfig")}</FormLabel>
													<Input {...register("tlsEchConfigList")} />
												</FormControl>
												<div className="flex flex-row items-center gap-3">
													<Button onClick={handleGenerateEchCert} size="xs">
														{t("inbounds.tls.echGenerate")}
													</Button>
													<Button onClick={handleClearEchCert} variant="ghost" size="xs">
														{t("clear")}
													</Button>
												</div>
											</div>
										</div>
									)}

									{streamSecurity === "tls" && vlessAuthenticationSection}

									{streamSecurity === "reality" && (
										<div className="flex flex-col gap-3 xray-dialog-section" data-form-section="reality" data-form-section-title={t("inbounds.reality.title")}>
											<p className="text-[0.875rem] font-semibold">
												{t("inbounds.reality.title")}
											</p>
											<FormControl className="flex items-center">
												<FormLabel className="mb-0" helpKey="showHelp">{t("show")}</FormLabel>
												<Controller control={control} name={"realityShow"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
											</FormControl>
											<FormControl>
												<FormLabel helpKey="inbounds.reality.xverHelp">{t("inbounds.reality.xver")}</FormLabel>
												<Controller
													control={control}
													name="realityXver"
													render={({ field }) => (
														<NumberField doneLabel={t("common.done")}
																	inputMode="numeric"
															value={field.value ?? ""}
															onChange={(value) => field.onChange(value)}
															min={0}
														/>
													)}
												/>
											</FormControl>
											<FormControl>
												<FormLabel helpKey="inbounds.tls.fingerprintHelp">{t("inbounds.tls.fingerprint")}</FormLabel>
												<SearchableTagSelect
													value={formValues.realityFingerprint || ""}
													options={tlsFingerprintOptions}
													placeholder={t("inbounds.tls.fingerprint")}
													onChange={(value) =>
														form.setValue("realityFingerprint", String(value), {
															shouldDirty: true,
															shouldValidate: true,
														})
													}
												/>
											</FormControl>
											<FormControl required isInvalid={Boolean(
													errors.realityTarget ||
														fieldValidationErrors.realityTarget,
												)}>
												<FormLabel>
													<div className="flex flex-row items-center gap-2">
														<p>{t("pages.xray.routeTester.target")}</p>
														<Tooltip>
<TooltipTrigger asChild>
															<Button aria-label={t("common.randomize")} onClick={handleRandomizeRealityTarget} variant="ghost" size="xs" className="size-7 p-0">{<RefreshCw className="w-[14px] h-[14px]" />}</Button>
														</TooltipTrigger>
<TooltipContent>{t("common.randomize")}</TooltipContent>
</Tooltip>
													</div>
												</FormLabel>
												<Input {...register("realityTarget", { required: true })}
													placeholder="example.com:443"
												/>
												{(errors.realityTarget ||
													fieldValidationErrors.realityTarget) && (
													<p className="text-[0.75rem] text-red-500 mt-1">
														{fieldValidationErrors.realityTarget ||
															t("validation.required")}
													</p>
												)}
											</FormControl>
											<FormControl required isInvalid={Boolean(
													errors.realityServerNames ||
														fieldValidationErrors.realityServerNames,
												)}>
												<FormLabel>
													<div className="flex flex-row items-center gap-2">
														<p>{t("inbounds.reality.serverNames")}</p>
														<Tooltip>
<TooltipTrigger asChild>
															<Button aria-label={t("common.randomize")} onClick={handleRandomizeRealityTarget} variant="ghost" size="xs" className="size-7 p-0">{<RefreshCw className="w-[14px] h-[14px]" />}</Button>
														</TooltipTrigger>
<TooltipContent>{t("common.randomize")}</TooltipContent>
</Tooltip><FieldHint>{t("inbounds.serverNamesHint")}</FieldHint>
													</div>
												</FormLabel>
												<Input
													{...register("realityServerNames", {
														required: true,
													})}
													placeholder="domain.com"
												/>
												{(errors.realityServerNames ||
													fieldValidationErrors.realityServerNames) && (
													<p className="text-[0.75rem] text-red-500 mt-1">
														{fieldValidationErrors.realityServerNames ||
															t("validation.required")}
													</p>
												)}
											</FormControl>
											<FormControl>
												<FormLabel helpKey="inbounds.reality.maxTimediffHelp">{t("inbounds.reality.maxTimediff")}</FormLabel>
												<Controller
													control={control}
													name="realityMaxTimediff"
													render={({ field }) => (
														<NumberField doneLabel={t("common.done")}
																	inputMode="numeric"
															value={field.value ?? ""}
															onChange={(value) => field.onChange(value)}
															min={0}
														/>
													)}
												/>
											</FormControl>
											<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
												<FormControl>
													<FormLabel helpKey="inbounds.reality.minClientVerHelp">{t("inbounds.reality.minClientVer")}</FormLabel>
													<Input {...register("realityMinClientVer")}
														placeholder="25.9.11"
													/>
												</FormControl>
												<FormControl>
													<FormLabel helpKey="inbounds.reality.maxClientVerHelp">{t("inbounds.reality.maxClientVer")}</FormLabel>
													<Input
														{...register("realityMaxClientVer")}
														placeholder="25.9.11"
													/>
												</FormControl>
											</div>
											<FormControl required isInvalid={Boolean(
													errors.realityShortIds ||
														fieldValidationErrors.realityShortIds,
												)}>
												<FormLabel>
													<div className="flex flex-row items-center gap-2">
														<p>{t("inbounds.reality.shortIds")}</p>
														<Tooltip>
<TooltipTrigger asChild>
															<Button aria-label={t("common.randomize")} onClick={handleRandomizeRealityShortIds} variant="ghost" size="xs" className="size-7 p-0">{<RefreshCw className="w-[14px] h-[14px]" />}</Button>
														</TooltipTrigger>
<TooltipContent>{t("common.randomize")}</TooltipContent>
</Tooltip><FieldHint>{t("inbounds.shortIdsHint")}</FieldHint>
													</div>
												</FormLabel>
												<Input {...register("realityShortIds")} />
												<Button onClick={handleGenerateShortId} variant="outline" size="xs" className="mt-2 self-start">
													{t("inbounds.reality.generateShortId")}
												</Button>
												{(errors.realityShortIds ||
													fieldValidationErrors.realityShortIds) && (
													<p className="text-[0.75rem] text-red-500 mt-1">
														{fieldValidationErrors.realityShortIds ||
															t("validation.required")}
													</p>
												)}
											</FormControl>
											<FormControl>
												<FormLabel helpKey="inbounds.reality.spiderXHelp">{t("inbounds.reality.spiderX")}</FormLabel>
												<Input {...register("realitySpiderX")} />
											</FormControl>
											<FormControl>
												<FormLabel helpKey="inbounds.reality.publicKeyHelp">{t("inbounds.reality.publicKey")}</FormLabel>
												<Input {...register("realityPublicKey")} />
											</FormControl>
											<FormControl required isInvalid={Boolean(
													errors.realityPrivateKey ||
														fieldValidationErrors.realityPrivateKey,
												)}>
												<FormLabel helpKey="inbounds.reality.privateKeyHelp">{t("inbounds.reality.privateKey")}</FormLabel>
												<Input
													{...register("realityPrivateKey", { required: true })}
												/>
												{(errors.realityPrivateKey ||
													fieldValidationErrors.realityPrivateKey) && (
													<p className="text-[0.75rem] text-red-500 mt-1">
														{fieldValidationErrors.realityPrivateKey ||
															t("validation.required")}
													</p>
												)}
											</FormControl>
											<div className="flex flex-row items-center gap-3">
												<Button onClick={handleGenerateRealityKeypair} size="xs">
													{t("inbounds.reality.generateKeys")}
												</Button>
												<Button onClick={handleClearRealityKeypair} variant="ghost" size="xs">
													{t("clear")}
												</Button>
											</div>
											<div className="flex flex-col gap-3 xray-dialog-section">
												<p className="text-[0.875rem] font-semibold">
													Fallback bandwidth limits
												</p>
												<div className="grid grid-cols-1 md:grid-cols-3 gap-3">
													{(
														[
															[
																"realityLimitFallbackUploadAfterBytes",
																"Upload after bytes",
															],
															[
																"realityLimitFallbackUploadBytesPerSec",
																"Upload bytes/sec",
															],
															[
																"realityLimitFallbackUploadBurstBytesPerSec",
																"Upload burst bytes/sec",
															],
															[
																"realityLimitFallbackDownloadAfterBytes",
																"Download after bytes",
															],
															[
																"realityLimitFallbackDownloadBytesPerSec",
																"Download bytes/sec",
															],
															[
																"realityLimitFallbackDownloadBurstBytesPerSec",
																"Download burst bytes/sec",
															],
														] as const
													).map(([name, label]) => (
														<FormControl key={name} isInvalid={!!fieldValidationErrors[name]}>
															<FormLabel>{label}</FormLabel>
															<FormNumberField control={control} name={name as keyof InboundFormValues} inputMode="numeric"
																placeholder="0"
															/>
															{fieldValidationErrors[name] && (
																<FieldError>
																	{fieldValidationErrors[name]}
																</FieldError>
															)}
														</FormControl>
													))}
												</div>
											</div>
											<FormControl>
												<FormLabel helpKey="inbounds.reality.mldsa65SeedHelp">{t("inbounds.reality.mldsa65Seed")}</FormLabel>
												<Input {...register("realityMldsa65Seed")} />
											</FormControl>
											<FormControl>
												<FormLabel helpKey="inbounds.reality.mldsa65VerifyHelp">{t("inbounds.reality.mldsa65Verify")}</FormLabel>
												<Input {...register("realityMldsa65Verify")} />
											</FormControl>
											<div className="flex flex-row items-center gap-3">
												<Button onClick={handleGenerateMldsa65} size="xs">
													{t("inbounds.reality.mldsa65Generate")}
												</Button>
												<Button onClick={handleClearMldsa65} variant="ghost" size="xs">
													{t("clear")}
												</Button>
											</div>
										</div>
									)}

									{streamSecurity === "reality" && vlessAuthenticationSection}

									{supportsFallback && (
										<div className="flex flex-col gap-3 xray-dialog-section" data-form-section="fallbacks" data-form-section-title={t("inbounds.fallbacks")}>
											<div className="flex items-center justify-between">
												<div className="font-medium">{t("inbounds.fallbacks")}</div>
												<button type="button" aria-label={t("inbounds.fallbacks.add")} title={t("inbounds.fallbacks.add")} onClick={handleAddFallback} className={buttonVariants({ variant: "outline", size: "icon-sm" })}><Plus className="size-4" /></button>
											</div>
											{fallbackFields.length === 0 ? (
												<p className="text-[0.875rem] text-gray-500">
													{t("inbounds.fallbacks.empty")}
												</p>
											) : (
												fallbackFields.map((field, index) => (
													<div key={field.id} className={cn("border rounded-md p-3", sectionBorder)}>
														<div className="flex justify-between items-center mb-3">
															<p className="font-semibold">
																{t("inbounds.fallbacks.type")} #{index + 1}
															</p>
															<Button onClick={() => removeFallback(index)} variant="ghost" size="xs" className="text-destructive hover:bg-destructive/10">
																{t("delete")}
															</Button>
														</div>
														<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
															<FormControl>
																<FormLabel helpKey="inbounds.fallbacks.destHelp">{t("inbounds.fallbacks.dest")}</FormLabel>
																<Input
																	placeholder="example.com:443"
																	{...register(
																		`fallbacks.${index}.dest` as const,
																	)}
																/>
															</FormControl>
															<FormControl>
																<FormLabel helpKey="pathHelp">{t("path")}</FormLabel>
																<Input
																	{...register(
																		`fallbacks.${index}.path` as const,
																	)}
																	placeholder="/"
																/>
															</FormControl>
															<FormControl>
																<FormLabel helpKey="inbounds.fallbacks.typeHelp">{t("inbounds.fallbacks.type")}</FormLabel>
																<Input
																	{...register(
																		`fallbacks.${index}.type` as const,
																	)}
																	placeholder="none"
																/>
															</FormControl>
															<FormControl>
																<FormLabel helpKey="inbounds.fallbacks.alpnHelp">{t("inbounds.fallbacks.alpn")}</FormLabel>
																<Input
																	{...register(
																		`fallbacks.${index}.alpn` as const,
																	)}
																	placeholder="h2,http/1.1"
																/>
															</FormControl>
															<FormControl>
																<FormLabel>Xver</FormLabel>
																<Input
																	{...register(
																		`fallbacks.${index}.xver` as const,
																	)}
																	placeholder="0"
																/>
															</FormControl>
														</div>
													</div>
												))
											)}
										</div>
									)}

									{supportsStreamSettings && (
											<div className="flex flex-col gap-3 xray-dialog-section" data-form-section="sniffing" data-form-section-title={t("inbounds.sniffing")}>
												<div className="flex items-center justify-between">
													<div className="flex flex-row items-center gap-2">
														<div className="font-medium">
															{t("inbounds.sniffing")}
														</div>
													<FieldHint>{t("inbounds.sniffingHint")}</FieldHint>
													</div>
													<Controller control={control} name={"sniffingEnabled"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
												</div>
												{sniffingEnabled && (
													<div className="flex flex-col gap-3">
														<FormControl>
															<FormLabel helpKey="inbounds.sniffingDestinationsHelp">{t("inbounds.sniffingDestinations")}</FormLabel>
															<Controller
																control={control}
																name="sniffingDestinations"
																render={({ field }) => (
																	<div className="flex flex-col gap-2">
																		<div className="flex flex-row items-center gap-4">
																			{sniffingOptions.map((option) => (
																				<label key={option.value} className="flex cursor-pointer items-center gap-2 text-sm"><Checkbox checked={(field.value ?? []).includes(option.value)} onCheckedChange={(checked) => field.onChange(checked === true ? [...(field.value ?? []), option.value] : (field.value ?? []).filter((item: string) => item !== option.value))} /><span>{option.label}</span></label>
																			))}
																		</div>
																	</div>
																)}
															/>
														</FormControl>
													<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
															<FormControl>
																<FormLabel>Excluded IP rules</FormLabel>
																<Textarea
																	{...register("sniffingIpsExcluded")}
																	rows={2}
																	placeholder="geoip:private"
																/>
															</FormControl>
															<FormControl>
																<FormLabel>Excluded domain rules</FormLabel>
																<Textarea
																	{...register("sniffingDomainsExcluded")}
																	rows={2}
																	placeholder="geosite:private"
																/>
															</FormControl>
														</div>
														<FormControl className="flex items-center">
															<FormLabel className="mb-0" helpKey="inbounds.sniffingRouteOnlyHelp">{t("inbounds.sniffingRouteOnly")}</FormLabel>
															<Controller control={control} name={"sniffingRouteOnly"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
														</FormControl>
														<FormControl className="flex items-center">
															<FormLabel className="mb-0" helpKey="inbounds.sniffingMetadataOnlyHelp">{t("inbounds.sniffingMetadataOnly")}</FormLabel>
															<Controller control={control} name={"sniffingMetadataOnly"} render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
														</FormControl>
													</div>
												)}
											</div>
										)}
									{canViewNote ? (
										<div data-form-section="note" data-form-section-title={t("inbounds.note")} className="flex flex-col gap-3">
											<FormControl>
												<FormLabel>{t("inbounds.note")}</FormLabel>
												<Textarea rows={3} maxLength={4000} value={noteDraft} disabled={noteQuery.isLoading} onChange={(event) => setNoteDraft(event.target.value)} />
												<FieldDescription>{t("entityNote.hint")}</FieldDescription>
											</FormControl>
										</div>
									) : null}
								</div>
							</TabsContent>
							<TabsContent value="1" forceMount className="mt-0 data-[state=inactive]:hidden">
								<div className="flex flex-col items-stretch gap-4">
									{jsonError && (
										<Alert variant="destructive">
											<CircleAlert className="size-4" aria-hidden="true" />
											{jsonError}
										</Alert>
									)}
									<div className="h-[420px]">
										<JsonEditor
											json={jsonText}
											canonicalContext="inbound"
											onChange={handleJsonEditorChange}
										/>
									</div>
								</div>
							</TabsContent>
							<TabsContent value="2" forceMount className="mt-0 data-[state=inactive]:hidden">
								<Controller
									control={control}
									name="targetIds"
									rules={{
										validate: (value) =>
											Boolean(value?.length) ||
											t("inbounds.error.targetsRequired"),
									}}
									render={({ field }) => {
										const selectedIds: string[] = field.value || [];
										const allCustomSelected =
											customTargetIds.length > 0 &&
											customTargetIds.every((id) => selectedIds.includes(id));
										const someCustomSelected =
											!allCustomSelected &&
											customTargetIds.some((id) => selectedIds.includes(id));
										return (
											<div className="flex flex-col items-stretch gap-3">
												{customTargetIds.length > 0 && (
													<label className="flex cursor-pointer items-center gap-2 text-sm"><Checkbox checked={allCustomSelected || (someCustomSelected ? "indeterminate" : false)} onCheckedChange={() => field.onChange(allCustomSelected ? selectedIds.filter((id) => !customTargetIds.includes(id)) : [...selectedIds, ...customTargetIds.filter((id) => !selectedIds.includes(id))])} /><span>{t("inbounds.selectAllCustomNodes")}</span></label>
												)}
												<div className="flex flex-col gap-2">
													<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
														{availableTargets.map((target) => (
															<div key={target.id} className={cn("border rounded-md p-3", sectionBorder)}>
																<label className="flex cursor-pointer items-center gap-2 text-sm"><Checkbox checked={selectedIds.includes(target.id)} onCheckedChange={(checked) => field.onChange(checked === true ? [...selectedIds, target.id] : selectedIds.filter((id) => id !== target.id))} /><span><div className="flex flex-row items-center gap-2">
																		<p>
																			{target.type === "master"
																				? t("default")
																				: target.name}
																		</p>
																		<Badge className="bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-gray-500/20 dark:text-gray-200">
																			{target.type === "master"
																				? t("default")
																				: target.mode}
																		</Badge>
																	</div></span></label>
															</div>
														))}
													</div>
													{errors.targetIds && (
														<p className="text-[0.75rem] text-red-500 mt-2">
															{String(errors.targetIds.message)}
														</p>
													)}
												</div>
											</div>
										);
									}}
								/>
							</TabsContent>
					</div>
				</Tabs>
				<DialogFooter className="flex-row flex-wrap items-center justify-between gap-2 border-t px-5 py-3">
					{isEditMode && onDelete ? (
						<div className="flex flex-row flex-wrap items-center gap-2">
							<DeleteConfirmDialog
								description={t("inbounds.confirmDelete")}
								loading={isDeleting}
								disabled={isSubmitting}
								onConfirm={onDelete}
							>
								<button type="button" disabled={isSubmitting} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-destructive")}>
									{t("delete")}
								</button>
							</DeleteConfirmDialog>
							{onClone ? (
								<button type="button" onClick={onClone} disabled={isSubmitting} className={buttonVariants({ variant: "outline", size: "sm" })}>
									{t("hostsPage.clone")}
								</button>
							) : null}
						</div>
					) : null}
					<div className="ms-auto flex flex-row flex-wrap items-center gap-2">
						<button type="button" onClick={onClose} className={buttonVariants({ variant: "ghost", size: "sm" })}>
							{t("hostsPage.cancel")}
						</button>
						<button
							type="button"
							onClick={handleSubmit(submitForm)}
							disabled={isSubmitting || hasBlockingErrorsWithJson}
							className={buttonVariants({ size: "sm" })}
						>
							{isEditMode ? t("save") : isCloneMode ? t("inbounds.cloneSubmit") : t("create")}
						</button>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};
