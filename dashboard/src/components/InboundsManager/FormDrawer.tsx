import type { FormLabelProps, InputProps, TextareaProps } from "@chakra-ui/react";
import {
	Alert,
	AlertDescription,
	AlertIcon,
	AlertTitle,
	Box,
	Button,
	Input as ChakraInput,
	Textarea as ChakraTextarea,
	Checkbox,
	CheckboxGroup,
	Collapse,
	Divider,
	Flex,
	FormControl,
	FormLabel,
	HStack,
	IconButton,
	Modal,
	ModalCloseButton,
	ModalOverlay,
	Radio,
	RadioGroup,
	SimpleGrid,
	Stack,
	Switch,
	Tab,
	TabList,
	TabPanel,
	TabPanels,
	Tabs,
	Tag,
	Text,
	Tooltip,
	useColorModeValue,
	useToast,
	VStack,
} from "@chakra-ui/react";
import {
	ArrowPathIcon,
	InformationCircleIcon,
	QuestionMarkCircleIcon,
	SparklesIcon,
} from "@heroicons/react/24/outline";
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
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import {
	generateEchCert,
	generateOVSelfSigned,
	generateMldsa65,
	generateRealityKeypair,
	generateRealityShortId,
	getVlessEncAuthBlocks,
	type VlessEncAuthBlock,
} from "service/xray";
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
	tlsEchForceOptions,
	tlsFingerprintOptions,
	tlsUsageOptions,
	tlsVersionOptions,
	validateInboundFormFields,
	validateInboundFormValues,
} from "utils/inbounds";
import { NumericInput } from "../common/NumericInput";
import { DeleteConfirmPopover } from "../DeleteConfirmPopover";
import {
	XrayModalBody,
	XrayModalContent,
	XrayModalFooter,
	XrayModalHeader,
} from "../xray/XrayDialog";

type Props = {
	isOpen: boolean;
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

const Input = forwardRef<HTMLInputElement, InputProps>((props, ref) => (
	<ChakraInput size="sm" ref={ref} {...props} />
));
Input.displayName = "InboundFormInput";

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
	(props, ref) => (
		<ChakraTextarea size="sm" resize="vertical" ref={ref} {...props} />
	),
);
Textarea.displayName = "InboundFormTextarea";

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

const fillRandomValues = (buffer: Uint8Array) => {
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
	isOpen,
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
	const toast = useToast();
	const ovLabel = (
		labelKey: string,
		labelFallback: string,
		helpKey: string,
		helpFallback: string,
		labelProps: FormLabelProps = {},
	) => (
		<FormLabel {...labelProps}>
			<HStack spacing={1.5} align="center">
				<Text as="span">{t(labelKey, labelFallback)}</Text>
				<Tooltip label={t(helpKey, helpFallback)} hasArrow placement="top">
					<Box
						as={InformationCircleIcon}
						boxSize={4}
						color="gray.500"
						cursor="help"
						aria-label={t("common.info", "Info")}
					/>
				</Tooltip>
			</HStack>
		</FormLabel>
	);
	const [vlessAuthOptions, setVlessAuthOptions] = useState<VlessEncAuthBlock[]>(
		[],
	);
	const [vlessAuthLoading, setVlessAuthLoading] = useState(false);
	const [ovCertLoading, setOVCertLoading] = useState(false);
	const [activeTab, setActiveTab] = useState(0);
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
		fields: xhttpHeaderFields,
		append: appendXhttpHeader,
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
	const autoOVTunnelPortRef = useRef("");
	const supportsStreamSettings =
		currentProtocol !== "http" &&
		currentProtocol !== "socks" &&
		currentProtocol !== "openvpn" &&
		currentProtocol !== "l2tp";
	const warningBg = useColorModeValue("yellow.50", "yellow.900");
	const warningBorder = useColorModeValue("yellow.400", "yellow.500");
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
			return t(
				"inbounds.error.tlsUnsupported",
				"TLS is not supported for the selected protocol/network.",
			);
		}
		if (streamSecurity === "reality" && !canEnableReality) {
			return t(
				"inbounds.error.realityUnsupported",
				"Reality is not supported for the selected protocol/network.",
			);
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
	const _hasBlockingErrors = Boolean(
		tagError ||
			portError ||
			streamCompatibilityError ||
			fieldValidationMessages.length,
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
		if (isEditMode) {
			return protocolOptions;
		}
		return protocolOptions.filter(
			(option) => option !== "http" && option !== "socks",
		);
	}, [isEditMode]);
	const availableTargets = useMemo<CoreConfigTarget[]>(
		() =>
			configTargets.length
				? configTargets
				: [
						{
							id: "master",
							type: "master",
							name: "Master",
							node_id: null,
							mode: "custom",
						},
					],
		[configTargets],
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
	}, [BLOCKED_PORTS, form]);

	useEffect(() => {
		if (!portValue) {
			setPortWarning(null);
			return;
		}
		const numeric = Number(portValue);
		if (Number.isFinite(numeric) && BLOCKED_PORTS.has(numeric)) {
			setPortWarning(
				t(
					"inbounds.portWarningBlocked",
					"This port is commonly blocked by servers/firewalls. Better to avoid it.",
				),
			);
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
			setTagError(t("inbounds.error.tagExists", "Inbound tag already exists"));
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
					inb.port?.toString() === portValue &&
					inboundTargets.some((targetId) => selectedTargets.has(targetId))
				);
			})
		) {
			setPortError(
				t("inbounds.error.portExists", "Inbound port already exists"),
			);
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
							<NumericInput
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
			<FormControl display="flex" alignItems="center">
				<FormLabel mb={0}>{label}</FormLabel>
				<Controller
					control={control}
					name={`sockopt.${name}` as const}
					render={({ field }) => (
						<Switch
							isChecked={
								typeof field.value === "boolean"
									? field.value
									: Boolean(field.value)
							}
							onChange={(event) => field.onChange(event.target.checked)}
						/>
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
				<Input
					{...register(`sockopt.${name}` as const)}
					placeholder={placeholder}
				/>
			</FormControl>
		),
		[register],
	);

	const supportsFallback =
		currentProtocol === "vless" || currentProtocol === "trojan";

	const sectionBorder = useColorModeValue("gray.200", "gray.700");

	const submitForm = async (values: InboundFormValues) => {
		const errors = validateInboundFormValues(values);
		if (errors.length) {
			setActiveTab(0);
			toast({
				title: t("inbounds.error.invalidConfig", "Inbound config is invalid"),
				description: errors[0],
				status: "error",
				isClosable: true,
				position: "top",
			});
			return;
		}
		await onSubmit(values);
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
			toast({
				status: "success",
				title: t("inbounds.reality.generateKeys", "Generate key pair"),
				description: "Key pair generated successfully using Xray",
				duration: 2000,
				isClosable: true,
			});
		} catch (error) {
			toast({
				status: "error",
				title: t(
					"inbounds.reality.generateError",
					"Unable to generate key pair",
				),
				description: error instanceof Error ? error.message : undefined,
			});
		}
	}, [form, toast, t]);

	const handleClearRealityKeypair = useCallback(() => {
		form.setValue("realityPrivateKey", "", { shouldDirty: true });
		form.setValue("realityPublicKey", "", { shouldDirty: true });
	}, [form]);

	const handleGenerateEchCert = useCallback(async () => {
		const sni = form.getValues("tlsServerName")?.trim();
		if (!sni) {
			toast({
				status: "warning",
				title: t("inbounds.tls.echMissingSni", "SNI is required"),
			});
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
			toast({
				status: "success",
				title: t("inbounds.tls.echGenerated", "ECH certificate generated"),
				duration: 2000,
				isClosable: true,
			});
		} catch (error) {
			toast({
				status: "error",
				title: t("inbounds.tls.echError", "Unable to generate ECH certificate"),
				description: error instanceof Error ? error.message : undefined,
			});
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
			toast({
				status: "success",
				title: t(
					"inbounds.openvpn.generateSelfSignedSuccess",
					"Self-signed certificates generated",
				),
				duration: 2500,
				isClosable: true,
			});
		} catch (error) {
			toast({
				status: "error",
				title: t(
					"inbounds.openvpn.generateSelfSignedError",
					"Unable to generate OpenVPN certificates",
				),
				description: error instanceof Error ? error.message : undefined,
			});
		} finally {
			setOVCertLoading(false);
		}
	}, [form, t, toast]);

	const handleGenerateMldsa65 = useCallback(async () => {
		try {
			const { seed, verify } = await generateMldsa65();
			form.setValue("realityMldsa65Seed", seed ?? "", { shouldDirty: true });
			form.setValue("realityMldsa65Verify", verify ?? "", {
				shouldDirty: true,
			});
			toast({
				status: "success",
				title: t("inbounds.reality.mldsaGenerated", "ML-DSA-65 generated"),
				duration: 2000,
				isClosable: true,
			});
		} catch (error) {
			toast({
				status: "error",
				title: t("inbounds.reality.mldsaError", "Unable to generate ML-DSA-65"),
				description: error instanceof Error ? error.message : undefined,
			});
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
			toast({
				status: "success",
				title: t("inbounds.reality.generateShortId", "Generate short ID"),
				description: "Short ID generated successfully",
				duration: 2000,
				isClosable: true,
			});
		} catch (error) {
			toast({
				status: "error",
				title: t(
					"inbounds.reality.shortIdError",
					"Unable to generate short ID",
				),
				description: error instanceof Error ? error.message : undefined,
			});
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
			toast({
				status: "error",
				title: t("inbounds.vless.getKeysError", "Unable to fetch VLESS keys"),
			});
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
				toast({
					status: "warning",
					title: t(
						"inbounds.vless.authNotFound",
						"Authentication block not available",
					),
				});
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
			toast({
				status: "info",
				title: t(
					"inbounds.vless.selectAuthFirst",
					"Select an authentication option first",
				),
			});
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

	useEffect(() => {
		if (isOpen && currentProtocol === "vless") {
			ensureVlessAuthBlocks();
		}
	}, [currentProtocol, ensureVlessAuthBlocks, isOpen]);

	const vlessAuthenticationSection =
		currentProtocol === "vless" ? (
			<Stack className="xray-dialog-section" spacing={3}>
				<Text fontSize="sm" fontWeight="semibold">
					{t("inbounds.vless.authentication", "Authentication")}
				</Text>
				<Controller
					control={control}
					name="vlessSelectedAuth"
					render={({ field }) => (
						<FormControl>
							<FormLabel>
								{t("inbounds.vless.authentication", "Authentication")}
							</FormLabel>
							<SearchableTagSelect
								value={field.value || ""}
								options={[
									{ value: "", label: t("common.none", "None") },
									...computedVlessAuthOptions.map((option) => ({
										value: option.value,
										label: option.label,
									})),
								]}
								placeholder={t(
									"inbounds.vless.authPlaceholder",
									"Select authentication",
								)}
								onChange={async (selected) => {
									const value = String(selected);
									field.onChange(value);
									await handleAuthSelection(value);
								}}
							/>
						</FormControl>
					)}
				/>
				<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
					<FormControl>
						<FormLabel>
							{t("inbounds.vless.decryption", "Decryption")}
						</FormLabel>
						<Input {...register("vlessDecryption")} />
					</FormControl>
					<FormControl>
						<FormLabel>
							{t("inbounds.vless.encryption", "Encryption")}
						</FormLabel>
						<Input {...register("vlessEncryption")} />
					</FormControl>
				</SimpleGrid>
				<HStack spacing={3}>
					<Button
						size="sm"
						onClick={handleFetchAuthClick}
						isLoading={vlessAuthLoading}
						isDisabled={!vlessSelectedAuth}
					>
						{t("inbounds.vless.getKeys", "Get new keys")}
					</Button>
					<Button size="sm" variant="ghost" onClick={handleClearAuth}>
						{t("inbounds.vless.clearKeys", "Clear")}
					</Button>
				</HStack>
			</Stack>
		) : null;

	return (
		<Modal
			isOpen={isOpen}
			onClose={onClose}
			size="5xl"
			scrollBehavior="inside"
			isCentered
		>
			<ModalOverlay bg="blackAlpha.400" backdropFilter="blur(8px)" />
			<XrayModalContent
				maxW={{ base: "95vw", md: "4xl" }}
				className="inbound-form-modal"
			>
				<XrayModalHeader>
					{mode === "create"
						? t("inbounds.add", "Add inbound")
						: mode === "clone"
							? t("inbounds.cloneTitle", "Clone inbound")
							: t("inbounds.edit", "Edit inbound")}
				</XrayModalHeader>
				<ModalCloseButton />
				<XrayModalBody>
					<Tabs
						className="xray-dialog-auto-sections"
						variant="unstyled"
						index={activeTab}
						onChange={(index) => setActiveTab(index)}
					>
						<TabList>
							<Tab>{t("form")}</Tab>
							<Tab>{t("json")}</Tab>
							<Tab>{t("inbounds.targets", "Targets")}</Tab>
						</TabList>
						<TabPanels>
							<TabPanel px={0}>
								<VStack align="stretch" spacing={6}>
									<Stack className="xray-dialog-section" spacing={3}>
										<Text fontSize="sm" fontWeight="semibold">
											{t("inbounds.basicSettings", "Basic settings")}
										</Text>
										<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
											<FormControl
												isRequired
												isInvalid={!!tagError || !!fieldValidationErrors.tag}
											>
												<FormLabel>{t("inbounds.tag", "Tag")}</FormLabel>
												<Input
													{...register("tag", { required: true })}
													isDisabled={isEditMode}
												/>
												{(tagError || fieldValidationErrors.tag) && (
													<Text fontSize="xs" color="red.500" mt={1}>
														{tagError || fieldValidationErrors.tag}
													</Text>
												)}
											</FormControl>
											<FormControl>
												<FormLabel>
													{t("inbounds.listen", "Listen address")}
												</FormLabel>
												<Input placeholder="::" {...register("listen")} />
											</FormControl>
										</SimpleGrid>
										<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
											<FormControl
												isRequired
												isInvalid={!!portError || !!fieldValidationErrors.port}
											>
												<FormLabel>{t("inbounds.port", "Port")}</FormLabel>
												<Input
													placeholder="443"
													{...register("port", { required: true })}
													value={portValue}
													onChange={(event) => {
														register("port").onChange(event);
														form.setValue("port", event.target.value, {
															shouldDirty: true,
														});
													}}
													bg={portWarning ? warningBg : undefined}
													_dark={{
														bg: portWarning ? warningBg : undefined,
														color: "white",
													}}
													borderColor={portWarning ? warningBorder : undefined}
												/>
												<HStack justify="space-between" mt={1}>
													<Button
														size="xs"
														variant="ghost"
														leftIcon={<SparklesIcon width={16} height={16} />}
														onClick={() => generateRandomPort()}
													>
														{t("inbounds.randomPort", "Random")}
													</Button>
												</HStack>
												{portWarning && (
													<Text fontSize="xs" color="yellow.600" mt={1}>
														{portWarning}
													</Text>
												)}
												{(portError || fieldValidationErrors.port) && (
													<Text fontSize="xs" color="red.500" mt={1}>
														{portError || fieldValidationErrors.port}
													</Text>
												)}
											</FormControl>
											<FormControl isRequired>
												<FormLabel>
													{t("inbounds.protocol", "Protocol")}
												</FormLabel>
												<SearchableTagSelect
													value={currentProtocol}
													isDisabled={mode === "edit"}
													options={visibleProtocolOptions.map((option) => ({
														value: option,
														label: option.toUpperCase(),
													}))}
													placeholder={t("inbounds.protocol", "Protocol")}
													onChange={(value) => {
														const nextProtocol =
															String(value) as InboundFormValues["protocol"];
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
															form.setValue("hysteriaQuicParams.enabled", false, {
																shouldDirty: true,
															});
															form.setValue("tlsAlpn", ["h3"], {
																shouldDirty: true,
															});
															form.setValue("tlsFingerprint", "", {
																shouldDirty: true,
															});
														}
														if (nextProtocol === "openvpn") {
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
										</SimpleGrid>
										{currentProtocol === "vmess" && (
											<FormControl display="flex" alignItems="center">
												<FormLabel mb={0}>
													{t(
														"inbounds.vmess.disableInsecure",
														"Disable insecure encryption",
													)}
												</FormLabel>
												<Switch {...register("disableInsecureEncryption")} />
											</FormControl>
										)}
										{currentProtocol === "shadowsocks" && (
											<Stack spacing={3}>
												<FormControl>
													<FormLabel>
														{t("inbounds.shadowsocks.password", "Password")}
													</FormLabel>
													<Input
														type="text"
														autoComplete="off"
														{...register("shadowsocksPassword")}
													/>
												</FormControl>
												<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
													<FormControl>
														<FormLabel>
															{t(
																"inbounds.shadowsocks.method",
																"Encryption method",
															)}
														</FormLabel>
														<SearchableTagSelect
															value={formValues.shadowsocksMethod || ""}
															options={shadowsocksMethods}
															placeholder={t(
																"inbounds.shadowsocks.method",
																"Encryption method",
															)}
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
														<FormLabel>
															{t(
																"inbounds.shadowsocks.network",
																"Allowed networks",
															)}
														</FormLabel>
														<SearchableTagSelect
															value={formValues.shadowsocksNetwork || ""}
															options={shadowsocksNetworkOptions}
															placeholder={t(
																"inbounds.shadowsocks.network",
																"Allowed networks",
															)}
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
												</SimpleGrid>
												<FormControl display="flex" alignItems="center">
													<FormLabel mb={0}>
														{t("inbounds.shadowsocks.ivCheck", "IV check")}
													</FormLabel>
													<Switch {...register("shadowsocksIvCheck")} />
												</FormControl>
											</Stack>
										)}
										{currentProtocol === "http" && (
											<Stack spacing={3}>
												<Flex justify="space-between" align="center">
													<Text fontWeight="medium">
														{t("inbounds.http.accounts", "HTTP accounts")}
													</Text>
													<Button
														size="xs"
														onClick={() =>
															appendHttpAccount({ user: "", pass: "" })
														}
													>
														{t("inbounds.accounts.add", "Add account")}
													</Button>
												</Flex>
												<Stack spacing={3}>
													{httpAccountFields.map((field, index) => (
														<Box
															key={field.id}
															borderWidth="1px"
															borderRadius="md"
															borderColor={sectionBorder}
															p={3}
														>
															<Flex
																justify="space-between"
																align="center"
																mb={3}
															>
																<Text fontWeight="semibold">
																	{t("inbounds.accounts.label", "Account")} #
																	{index + 1}
																</Text>
																<Button
																	size="xs"
																	variant="ghost"
																	colorScheme="red"
																	onClick={() => removeHttpAccount(index)}
																>
																	{t("hostsPage.delete", "Delete")}
																</Button>
															</Flex>
															<SimpleGrid
																columns={{ base: 1, md: 2 }}
																spacing={3}
															>
																<FormControl>
																	<FormLabel>
																		{t("username", "Username")}
																	</FormLabel>
																	<Input
																		{...register(
																			`httpAccounts.${index}.user` as const,
																		)}
																	/>
																</FormControl>
																<FormControl>
																	<FormLabel>
																		{t("password", "Password")}
																	</FormLabel>
																	<Input
																		{...register(
																			`httpAccounts.${index}.pass` as const,
																		)}
																	/>
																</FormControl>
															</SimpleGrid>
														</Box>
													))}
													{!httpAccountFields.length && (
														<Text fontSize="sm" color="gray.500">
															{t(
																"inbounds.http.noAccountsHint",
																"Add at least one username/password pair.",
															)}
														</Text>
													)}
												</Stack>
												<FormControl display="flex" alignItems="center">
													<FormLabel mb={0}>
														{t(
															"inbounds.http.allowTransparent",
															"Allow transparent proxy",
														)}
													</FormLabel>
													<Switch {...register("httpAllowTransparent")} />
												</FormControl>
											</Stack>
										)}
										{currentProtocol === "socks" && (
											<Stack spacing={3}>
												<FormControl display="flex" alignItems="center">
													<FormLabel mb={0}>
														{t("inbounds.socks.udp", "Enable UDP")}
													</FormLabel>
													<Switch {...register("socksUdpEnabled")} />
												</FormControl>
												{socksUdpEnabled && (
													<FormControl>
														<FormLabel>
															{t("inbounds.socks.udpIp", "UDP bind IP")}
														</FormLabel>
														<Input
															{...register("socksUdpIp")}
															placeholder="127.0.0.1"
														/>
													</FormControl>
												)}
												<FormControl display="flex" alignItems="center">
													<FormLabel mb={0}>
														{t("inbounds.socks.auth", "Require authentication")}
													</FormLabel>
													<Controller
														control={control}
														name="socksAuth"
														render={({ field }) => (
															<Switch
																isChecked={field.value === "password"}
																onChange={(event) =>
																	field.onChange(
																		event.target.checked
																			? "password"
																			: "noauth",
																	)
																}
															/>
														)}
													/>
												</FormControl>
												{socksAuth === "password" && (
													<Stack spacing={3}>
														<Flex justify="space-between" align="center">
															<Text fontWeight="medium">
																{t("inbounds.socks.accounts", "SOCKS accounts")}
															</Text>
															<Button
																size="xs"
																onClick={() =>
																	appendSocksAccount({ user: "", pass: "" })
																}
															>
																{t("inbounds.accounts.add", "Add account")}
															</Button>
														</Flex>
														{socksAccountFields.map((field, index) => (
															<Box
																key={field.id}
																borderWidth="1px"
																borderRadius="md"
																borderColor={sectionBorder}
																p={3}
															>
																<Flex
																	justify="space-between"
																	align="center"
																	mb={3}
																>
																	<Text fontWeight="semibold">
																		{t("inbounds.accounts.label", "Account")} #
																		{index + 1}
																	</Text>
																	<Button
																		size="xs"
																		variant="ghost"
																		colorScheme="red"
																		onClick={() => removeSocksAccount(index)}
																	>
																		{t("hostsPage.delete", "Delete")}
																	</Button>
																</Flex>
																<SimpleGrid
																	columns={{ base: 1, md: 2 }}
																	spacing={3}
																>
																	<FormControl>
																		<FormLabel>
																			{t("username", "Username")}
																		</FormLabel>
																		<Input
																			{...register(
																				`socksAccounts.${index}.user` as const,
																			)}
																		/>
																	</FormControl>
																	<FormControl>
																		<FormLabel>
																			{t("password", "Password")}
																		</FormLabel>
																		<Input
																			{...register(
																				`socksAccounts.${index}.pass` as const,
																			)}
																		/>
																	</FormControl>
																</SimpleGrid>
															</Box>
														))}
														{!socksAccountFields.length && (
															<Text fontSize="sm" color="gray.500">
																{t(
																	"inbounds.socks.noAccountsHint",
																	"Add at least one account for password mode.",
																)}
															</Text>
														)}
													</Stack>
												)}
											</Stack>
										)}
										{currentProtocol === "openvpn" && (
											<Stack spacing={3}>
												<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
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
															placeholder={t(
																"inbounds.openvpn.transport",
																"Transport",
															)}
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
													<FormControl
														isRequired
														isInvalid={Boolean(
															fieldValidationErrors.ovTunnelPort,
														)}
													>
														{ovLabel(
															"inbounds.openvpn.tunnelPort",
															"Tunnel port",
															"inbounds.openvpn.help.tunnelPort",
															"Internal Xray tunnel port used by nftables/TProxy. It must be unique and different from the public OpenVPN port.",
														)}
														<Input
															{...register("ovTunnelPort")}
															placeholder="41940"
														/>
														{fieldValidationErrors.ovTunnelPort && (
															<Text fontSize="xs" color="red.500" mt={1}>
																{fieldValidationErrors.ovTunnelPort}
															</Text>
														)}
													</FormControl>
												</SimpleGrid>
												<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
													<FormControl
														isRequired
														isInvalid={Boolean(
															fieldValidationErrors.ovIPv4Pool,
														)}
													>
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
															<Text fontSize="xs" color="red.500" mt={1}>
																{fieldValidationErrors.ovIPv4Pool}
															</Text>
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
												</SimpleGrid>
												<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
													<FormControl>
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
												</SimpleGrid>
												<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
													<FormControl display="flex" alignItems="center">
														{ovLabel(
															"inbounds.openvpn.redirectGateway",
															"Redirect gateway",
															"inbounds.openvpn.help.redirectGateway",
															"Push the default route to clients so all client traffic enters the VPN.",
															{ mb: 0 },
														)}
														<Switch {...register("ovRedirectGateway")} />
													</FormControl>
													<FormControl display="flex" alignItems="center">
														{ovLabel(
															"inbounds.openvpn.tproxy",
															"Enable TProxy automation",
															"inbounds.openvpn.help.tproxy",
															"Create nftables and policy routing rules that forward OpenVPN client traffic into the generated Xray tunnel inbound.",
															{ mb: 0 },
														)}
														<Switch {...register("ovTproxyEnabled")} />
													</FormControl>
													<FormControl display="flex" alignItems="center">
														{ovLabel(
															"inbounds.openvpn.accounting",
															"Enable accounting",
															"inbounds.openvpn.help.accounting",
															"Record OpenVPN session traffic and report it to the same Rebecca user quota/accounting pipeline.",
															{ mb: 0 },
														)}
														<Switch {...register("ovAccountingEnabled")} />
													</FormControl>
												</SimpleGrid>
												<FormControl
													isInvalid={Boolean(
														fieldValidationErrors.ovManagementPort,
													)}
												>
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
														<Text fontSize="xs" color="red.500" mt={1}>
															{fieldValidationErrors.ovManagementPort}
														</Text>
													)}
												</FormControl>
												<Box>
													<Button
														size="sm"
														leftIcon={<SparklesIcon width={16} />}
														onClick={handleGenerateOVSelfSigned}
														isLoading={ovCertLoading}
													>
														{t(
															"inbounds.openvpn.generateSelfSigned",
															"Generate self-signed certs",
														)}
													</Button>
												</Box>
												<FormControl
													isRequired
													isInvalid={Boolean(fieldValidationErrors.ovCA)}
												>
													{ovLabel(
														"inbounds.openvpn.ca",
														"CA certificate",
														"inbounds.openvpn.help.ca",
														"Certificate authority used to sign the OpenVPN server certificate. A self-signed CA is fine for personal use.",
													)}
													<Textarea rows={4} {...register("ovCA")} />
													{fieldValidationErrors.ovCA && (
														<Text fontSize="xs" color="red.500" mt={1}>
															{fieldValidationErrors.ovCA}
														</Text>
													)}
												</FormControl>
												<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
													<FormControl
														isRequired
														isInvalid={Boolean(
															fieldValidationErrors.ovServerCertificate,
														)}
													>
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
															<Text fontSize="xs" color="red.500" mt={1}>
																{
																	fieldValidationErrors.ovServerCertificate
																}
															</Text>
														)}
													</FormControl>
													<FormControl
														isRequired
														isInvalid={Boolean(
															fieldValidationErrors.ovServerKey,
														)}
													>
														{ovLabel(
															"inbounds.openvpn.serverKey",
															"Server key",
															"inbounds.openvpn.help.serverKey",
															"Private key for the OpenVPN server certificate. Keep it private; it is written only to the node's OpenVPN config.",
														)}
														<Textarea rows={4} {...register("ovServerKey")} />
														{fieldValidationErrors.ovServerKey && (
															<Text fontSize="xs" color="red.500" mt={1}>
																{fieldValidationErrors.ovServerKey}
															</Text>
														)}
													</FormControl>
												</SimpleGrid>
												<FormControl>
													{ovLabel(
														"inbounds.openvpn.dh",
														"DH parameters",
														"inbounds.openvpn.help.dh",
														"Optional Diffie-Hellman parameters for older TLS modes. Usually not needed with modern ECDHE/OpenVPN setups.",
													)}
													<Textarea rows={4} {...register("ovDH")} />
												</FormControl>
												<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
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
												</SimpleGrid>
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
											</Stack>
										)}
										{currentProtocol === "l2tp" && (
											<Stack spacing={3}>
												<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
													<FormControl
														isRequired
														isInvalid={Boolean(
															fieldValidationErrors.l2tpTunnelPort,
														)}
													>
														{ovLabel(
															"inbounds.l2tp.tunnelPort",
															"Tunnel port",
															"inbounds.l2tp.help.tunnelPort",
															"Internal Xray tunnel port used by nftables/TProxy. It must be unique and different from the public L2TP port.",
														)}
														<Input
															{...register("l2tpTunnelPort")}
															placeholder="51200"
														/>
														{fieldValidationErrors.l2tpTunnelPort && (
															<Text fontSize="xs" color="red.500" mt={1}>
																{fieldValidationErrors.l2tpTunnelPort}
															</Text>
														)}
													</FormControl>
													<FormControl
														isRequired
														isInvalid={Boolean(
															fieldValidationErrors.l2tpIPv4Pool,
														)}
													>
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
															<Text fontSize="xs" color="red.500" mt={1}>
																{fieldValidationErrors.l2tpIPv4Pool}
															</Text>
														)}
													</FormControl>
												</SimpleGrid>
												<FormControl
													isRequired
													isInvalid={Boolean(fieldValidationErrors.l2tpIPSecPSK)}
												>
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
														<Text fontSize="xs" color="red.500" mt={1}>
															{fieldValidationErrors.l2tpIPSecPSK}
														</Text>
													)}
												</FormControl>
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
												<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
													<FormControl display="flex" alignItems="center">
														{ovLabel(
															"inbounds.l2tp.redirectGateway",
															"Redirect gateway",
															"inbounds.l2tp.help.redirectGateway",
															"Route all client traffic through the L2TP/IPsec VPN.",
															{ mb: 0 },
														)}
														<Switch {...register("l2tpRedirectGateway")} />
													</FormControl>
													<FormControl display="flex" alignItems="center">
														{ovLabel(
															"inbounds.l2tp.tproxy",
															"Enable TProxy automation",
															"inbounds.l2tp.help.tproxy",
															"Create nftables and policy routing rules that forward L2TP client traffic into the generated Xray tunnel inbound.",
															{ mb: 0 },
														)}
														<Switch {...register("l2tpTproxyEnabled")} />
													</FormControl>
													<FormControl display="flex" alignItems="center">
														{ovLabel(
															"inbounds.l2tp.accounting",
															"Enable accounting",
															"inbounds.l2tp.help.accounting",
															"Record L2TP session traffic and report it to the same Rebecca user quota/accounting pipeline.",
															{ mb: 0 },
														)}
														<Switch {...register("l2tpAccountingEnabled")} />
													</FormControl>
												</SimpleGrid>
											</Stack>
										)}
									</Stack>

									{supportsStreamSettings && (
										<Stack className="xray-dialog-section" spacing={3}>
											<Text fontSize="sm" fontWeight="semibold">
												{t("inbounds.streamSettings", "Stream settings")}
											</Text>
											{currentProtocol === "hysteria" ? (
												<Alert status="info" borderRadius="md">
													<AlertIcon />
													<AlertDescription fontSize="sm">
														{t(
															"inbounds.hysteria.fixedTransport",
															"Hysteria2 always uses the Hysteria transport with TLS.",
														)}
													</AlertDescription>
												</Alert>
											) : (
												<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
													<FormControl>
														<FormLabel>
															{t("inbounds.network", "Network")}
														</FormLabel>
														<SearchableTagSelect
															value={streamNetwork}
															options={ALL_NETWORK_OPTIONS}
															placeholder={t("inbounds.network", "Network")}
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
														<FormLabel>
															{t("inbounds.security", "Security")}
														</FormLabel>
														<Controller
															control={control}
															name="streamSecurity"
															render={({ field }) => (
																<SearchableTagSelect
																	value={field.value}
																	options={streamSecurityOptions.map(
																		(security) => ({
																			value: security,
																			label: security,
																			disabled:
																				security === "tls"
																					? !TLS_COMPATIBLE_PROTOCOLS.includes(
																							currentProtocol,
																						)
																					: security === "reality"
																						? !REALITY_COMPATIBLE_PROTOCOLS.includes(
																								currentProtocol,
																							)
																						: false,
																		}),
																	)}
																	placeholder={t("inbounds.security", "Security")}
																	onChange={(value) =>
																		field.onChange(String(value))
																	}
																/>
															)}
														/>
													</FormControl>
												</SimpleGrid>
											)}
											{streamCompatibilityError && (
												<Alert status="error" borderRadius="md">
													<AlertIcon />
													<AlertDescription fontSize="sm">
														{streamCompatibilityError}
													</AlertDescription>
												</Alert>
											)}

											{streamNetwork === "ws" && (
												<Alert status="warning" borderRadius="md" mt={2}>
													<AlertIcon />
													<Box>
														<AlertTitle fontSize="sm">
															{t(
																"inbounds.wsDeprecatedTitle",
																"WebSocket transport is deprecated in Xray",
															)}
														</AlertTitle>
														<AlertDescription fontSize="xs">
															{t(
																"inbounds.wsDeprecatedDescription",
																"Xray recommends migrating WebSocket (ws) configs to XHTTP (H2/H3). Consider using xhttp instead of ws for new inbounds.",
															)}
														</AlertDescription>
													</Box>
												</Alert>
											)}

											{streamNetwork === "ws" && (
												<Stack spacing={3}>
													<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
														<FormControl
															isInvalid={!!fieldValidationErrors.wsPath}
														>
															<FormLabel>
																{t("inbounds.ws.path", "WebSocket path")}
															</FormLabel>
															<Input
																{...register("wsPath")}
																placeholder="/ws"
															/>
															{fieldValidationErrors.wsPath && (
																<Text fontSize="xs" color="red.500" mt={1}>
																	{fieldValidationErrors.wsPath}
																</Text>
															)}
														</FormControl>
														<FormControl>
															<FormLabel>
																{t("inbounds.ws.host", "Host")}
															</FormLabel>
															<Input
																{...register("wsHost")}
																placeholder="example.com"
															/>
														</FormControl>
													</SimpleGrid>
													<Stack spacing={2}>
														<Flex justify="space-between" align="center">
															<Text fontWeight="medium">
																{t("inbounds.ws.headers", "Custom headers")}
															</Text>
															<Button
																size="xs"
																onClick={() =>
																	appendWsHeader({ name: "", value: "" })
																}
															>
																{t("inbounds.accounts.add", "Add")}
															</Button>
														</Flex>
														{wsHeaderFields.map((field, index) => (
															<HStack
																key={field.id}
																spacing={2}
																align="flex-start"
															>
																<FormControl>
																	<Input
																		{...register(
																			`wsHeaders.${index}.name` as const,
																		)}
																		placeholder={t(
																			"inbounds.ws.headerName",
																			"Header name",
																		)}
																	/>
																</FormControl>
																<FormControl>
																	<Input
																		{...register(
																			`wsHeaders.${index}.value` as const,
																		)}
																		placeholder={t(
																			"inbounds.ws.headerValue",
																			"Header value",
																		)}
																	/>
																</FormControl>
																<Button
																	size="xs"
																	variant="ghost"
																	colorScheme="red"
																	onClick={() => removeWsHeader(index)}
																>
																	{t("hostsPage.delete", "Delete")}
																</Button>
															</HStack>
														))}
													</Stack>
												</Stack>
											)}

											{streamNetwork === "tcp" && (
												<Stack spacing={3}>
													<FormControl>
														<FormLabel>
															{t("inbounds.tcp.headerType", "TCP header type")}
														</FormLabel>
														<SearchableTagSelect
															value={tcpHeaderType}
															options={["none", "http"]}
															placeholder={t(
																"inbounds.tcp.headerType",
																"TCP header type",
															)}
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
														<SimpleGrid
															columns={{ base: 1, md: 2 }}
															spacing={3}
														>
															<FormControl>
																<FormLabel>
																	{t("inbounds.tcp.host", "HTTP host list")}
																</FormLabel>
																<Textarea
																	{...register("tcpHttpHosts")}
																	placeholder="example.com"
																/>
															</FormControl>
															<FormControl>
																<FormLabel>
																	{t("inbounds.tcp.path", "HTTP path")}
																</FormLabel>
																<Input {...register("tcpHttpPath")} />
															</FormControl>
														</SimpleGrid>
													)}
												</Stack>
											)}

											{streamNetwork === "grpc" && (
												<SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
													<FormControl>
														<FormLabel>
															{t("inbounds.grpc.serviceName", "Service name")}
														</FormLabel>
														<Input {...register("grpcServiceName")} />
													</FormControl>
													<FormControl>
														<FormLabel>
															{t("inbounds.grpc.authority", "Authority")}
														</FormLabel>
														<Input {...register("grpcAuthority")} />
													</FormControl>
													<FormControl display="flex" alignItems="center">
														<FormLabel mb={0}>
															{t("inbounds.grpc.multiMode", "Multi mode")}
														</FormLabel>
														<Switch {...register("grpcMultiMode")} />
													</FormControl>
												</SimpleGrid>
											)}

											{streamNetwork === "kcp" && (
												<SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
													<FormControl>
														<FormLabel>
															{t("inbounds.kcp.headerType", "mKCP header")}
														</FormLabel>
														<Input {...register("kcpHeaderType")} />
													</FormControl>
													<FormControl>
														<FormLabel>
															{t("inbounds.kcp.seed", "mKCP seed")}
														</FormLabel>
														<Input {...register("kcpSeed")} />
													</FormControl>
												</SimpleGrid>
											)}

											{streamNetwork === "quic" && (
												<SimpleGrid columns={{ base: 1, md: 3 }} spacing={3}>
													<FormControl>
														<FormLabel>
															{t("inbounds.quic.security", "QUIC security")}
														</FormLabel>
														<Input {...register("quicSecurity")} />
													</FormControl>
													<FormControl>
														<FormLabel>
															{t("inbounds.quic.key", "QUIC key")}
														</FormLabel>
														<Input {...register("quicKey")} />
													</FormControl>
													<FormControl>
														<FormLabel>
															{t(
																"inbounds.quic.headerType",
																"QUIC header type",
															)}
														</FormLabel>
														<Input {...register("quicHeaderType")} />
													</FormControl>
												</SimpleGrid>
											)}

											{streamNetwork === "httpupgrade" && (
												<SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
													<FormControl
														isInvalid={!!fieldValidationErrors.httpupgradePath}
													>
														<FormLabel>
															{t("inbounds.httpUpgrade.path", "Path")}
														</FormLabel>
														<Input {...register("httpupgradePath")} />
														{fieldValidationErrors.httpupgradePath && (
															<Text fontSize="xs" color="red.500" mt={1}>
																{fieldValidationErrors.httpupgradePath}
															</Text>
														)}
													</FormControl>
													<FormControl>
														<FormLabel>
															{t("inbounds.httpUpgrade.host", "Host")}
														</FormLabel>
														<Input {...register("httpupgradeHost")} />
													</FormControl>
												</SimpleGrid>
											)}

											{streamNetwork === "splithttp" && (
												<SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
													<FormControl
														isInvalid={!!fieldValidationErrors.splithttpPath}
													>
														<FormLabel>
															{t("inbounds.splitHttp.path", "Path")}
														</FormLabel>
														<Input {...register("splithttpPath")} />
														{fieldValidationErrors.splithttpPath && (
															<Text fontSize="xs" color="red.500" mt={1}>
																{fieldValidationErrors.splithttpPath}
															</Text>
														)}
													</FormControl>
													<FormControl>
														<FormLabel>
															{t("inbounds.splitHttp.host", "Host")}
														</FormLabel>
														<Input {...register("splithttpHost")} />
													</FormControl>
												</SimpleGrid>
											)}

											{streamNetwork === "xhttp" && (
												<Stack spacing={3}>
													<SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
														<FormControl>
															<FormLabel>
																{t("inbounds.xhttp.host", "Host")}
															</FormLabel>
															<Input
																{...register("xhttpHost")}
																placeholder="example.com"
															/>
														</FormControl>
														<FormControl
															isInvalid={!!fieldValidationErrors.xhttpPath}
														>
															<FormLabel>
																{t("inbounds.xhttp.path", "Path")}
															</FormLabel>
															<Input
																{...register("xhttpPath")}
																placeholder="/"
															/>
															{fieldValidationErrors.xhttpPath && (
																<Text fontSize="xs" color="red.500" mt={1}>
																	{fieldValidationErrors.xhttpPath}
																</Text>
															)}
														</FormControl>
													</SimpleGrid>
													<Stack spacing={2}>
														<Flex justify="space-between" align="center">
															<Text fontWeight="medium">
																{t("inbounds.xhttp.headers", "Custom headers")}
															</Text>
															<Button
																size="xs"
																onClick={() =>
																	appendXhttpHeader({ name: "", value: "" })
																}
															>
																{t("inbounds.accounts.add", "Add")}
															</Button>
														</Flex>
														{xhttpHeaderFields.map((field, index) => (
															<HStack
																key={field.id}
																spacing={2}
																align="flex-start"
															>
																<FormControl>
																	<Input
																		{...register(
																			`xhttpHeaders.${index}.name` as const,
																		)}
																		placeholder={t(
																			"inbounds.xhttp.headerName",
																			"Header name",
																		)}
																	/>
																</FormControl>
																<FormControl>
																	<Input
																		{...register(
																			`xhttpHeaders.${index}.value` as const,
																		)}
																		placeholder={t(
																			"inbounds.xhttp.headerValue",
																			"Header value",
																		)}
																	/>
																</FormControl>
																<Button
																	size="xs"
																	variant="ghost"
																	colorScheme="red"
																	onClick={() => removeXhttpHeader(index)}
																>
																	{t("hostsPage.delete", "Delete")}
																</Button>
															</HStack>
														))}
													</Stack>
													<SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
														<FormControl>
															<FormLabel>
																{t("inbounds.xhttp.mode", "Mode")}
															</FormLabel>
															<SearchableTagSelect
																value={formValues.xhttpMode || ""}
																options={[
																	{
																		value: "",
																		label: t("common.default", "Default"),
																	},
																	...XHTTP_MODE_OPTIONS,
																]}
																placeholder={t("inbounds.xhttp.mode", "Mode")}
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
														<FormControl
															isInvalid={
																!!fieldValidationErrors.xhttpPaddingBytes
															}
														>
															<FormLabel>
																{t(
																	"inbounds.xhttp.paddingBytes",
																	"Padding bytes",
																)}
															</FormLabel>
															<Input
																{...register("xhttpPaddingBytes")}
																placeholder="100-1000"
															/>
															{fieldValidationErrors.xhttpPaddingBytes && (
																<Text fontSize="xs" color="red.500" mt={1}>
																	{fieldValidationErrors.xhttpPaddingBytes}
																</Text>
															)}
														</FormControl>
													</SimpleGrid>
													{xhttpMode === "packet-up" && (
														<SimpleGrid
															columns={{ base: 1, md: 2 }}
															spacing={3}
														>
															<FormControl>
																<FormLabel>
																	{t(
																		"inbounds.xhttp.maxBuffered",
																		"Max buffered upload",
																	)}
																</FormLabel>
																<Input
																	{...register("xhttpScMaxBufferedPosts")}
																	placeholder="30"
																/>
															</FormControl>
															<FormControl>
																<FormLabel>
																	{t(
																		"inbounds.xhttp.maxUploadBytes",
																		"Max upload size (bytes)",
																	)}
																</FormLabel>
																<Input
																	{...register("xhttpScMaxEachPostBytes")}
																	placeholder="1000000"
																/>
															</FormControl>
														</SimpleGrid>
													)}
													{xhttpMode === "stream-up" && (
														<FormControl>
															<FormLabel>
																{t(
																	"inbounds.xhttp.streamUp",
																	"Stream-up server seconds",
																)}
															</FormLabel>
															<Input
																{...register("xhttpScStreamUpServerSecs")}
																placeholder="20-80"
															/>
														</FormControl>
													)}
													<FormControl display="flex" alignItems="center">
														<FormLabel mb={0}>
															{t("inbounds.xhttp.noSSE", "Disable SSE header")}
														</FormLabel>
														<Switch {...register("xhttpNoSSEHeader")} />
													</FormControl>
												</Stack>
											)}

											{streamNetwork === "hysteria" && (
												<Stack spacing={3}>
													<SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
														<FormControl>
															<FormLabel>
																{t("inbounds.hysteria.version", "Hysteria version")}
															</FormLabel>
															<Input
																{...register("hysteriaVersion")}
																placeholder="2"
																isDisabled
															/>
														</FormControl>
														<FormControl
															isInvalid={
																!!fieldValidationErrors.hysteriaUdpIdleTimeout
															}
														>
															<FormLabel>
																{t(
																	"inbounds.hysteria.udpIdleTimeout",
																	"UDP idle timeout",
																)}
															</FormLabel>
															<Input
																{...register("hysteriaUdpIdleTimeout")}
																placeholder="60"
															/>
															{fieldValidationErrors.hysteriaUdpIdleTimeout && (
																<Text fontSize="xs" color="red.500" mt={1}>
																	{
																		fieldValidationErrors.hysteriaUdpIdleTimeout
																	}
																</Text>
															)}
														</FormControl>
													</SimpleGrid>

													<FormControl display="flex" alignItems="center">
														<FormLabel mb={0}>
															{t(
																"inbounds.hysteria.enableMasquerade",
																"Enable masquerade",
															)}
														</FormLabel>
														<Switch {...register("hysteriaMasqueradeEnabled")} />
													</FormControl>
													<Collapse
														in={Boolean(hysteriaMasqueradeEnabled)}
														animateOpacity
													>
														<Stack spacing={3} mt={2}>
															<SimpleGrid
																columns={{ base: 1, md: 2 }}
																spacing={3}
															>
																<FormControl
																	isInvalid={
																		!!fieldValidationErrors.hysteriaMasqueradeType
																	}
																>
																	<FormLabel>
																		{t(
																			"inbounds.hysteria.masqueradeType",
																			"Masquerade type",
																		)}
																	</FormLabel>
																	<SearchableTagSelect
																		value={hysteriaMasqueradeType}
																		options={[
																			{
																				value: "",
																				label: t(
																					"inbounds.hysteria.defaultMasquerade",
																					"default (404 page)",
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
																			"Masquerade type",
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
																		<Text fontSize="xs" color="red.500" mt={1}>
																			{
																				fieldValidationErrors.hysteriaMasqueradeType
																			}
																		</Text>
																	)}
																</FormControl>
																{hysteriaMasqueradeType === "string" && (
																	<FormControl>
																		<FormLabel>
																			{t(
																				"inbounds.hysteria.statusCode",
																				"Status code",
																			)}
																		</FormLabel>
																		<Input
																			{...register(
																				"hysteriaMasqueradeStatusCode",
																			)}
																			placeholder="200"
																		/>
																	</FormControl>
																)}
															</SimpleGrid>

															{hysteriaMasqueradeType === "proxy" && (
																<Stack spacing={3}>
																	<FormControl
																		isInvalid={
																			!!fieldValidationErrors.hysteriaMasqueradeUrl
																		}
																	>
																		<FormLabel>
																			{t(
																				"inbounds.hysteria.proxyUrl",
																				"Proxy URL",
																			)}
																		</FormLabel>
																		<Input
																			{...register("hysteriaMasqueradeUrl")}
																			placeholder="https://example.com"
																		/>
																		{fieldValidationErrors.hysteriaMasqueradeUrl && (
																			<Text fontSize="xs" color="red.500" mt={1}>
																				{
																					fieldValidationErrors.hysteriaMasqueradeUrl
																				}
																			</Text>
																		)}
																	</FormControl>
																	<HStack spacing={6} flexWrap="wrap">
																		<FormControl
																			display="flex"
																			alignItems="center"
																			w="auto"
																		>
																			<FormLabel mb={0}>
																				{t(
																					"inbounds.hysteria.rewriteHost",
																					"Rewrite host",
																				)}
																			</FormLabel>
																			<Switch
																				{...register(
																					"hysteriaMasqueradeRewriteHost",
																				)}
																			/>
																		</FormControl>
																		<FormControl
																			display="flex"
																			alignItems="center"
																			w="auto"
																		>
																			<FormLabel mb={0}>
																				{t(
																					"inbounds.hysteria.insecure",
																					"Insecure upstream",
																				)}
																			</FormLabel>
																			<Switch
																				{...register(
																					"hysteriaMasqueradeInsecure",
																				)}
																			/>
																		</FormControl>
																	</HStack>
																</Stack>
															)}

															{hysteriaMasqueradeType === "file" && (
																<FormControl
																	isInvalid={
																		!!fieldValidationErrors.hysteriaMasqueradeDir
																	}
																>
																	<FormLabel>
																		{t(
																			"inbounds.hysteria.fileDir",
																			"File directory",
																		)}
																	</FormLabel>
																	<Input
																		{...register("hysteriaMasqueradeDir")}
																		placeholder="/var/www/html"
																	/>
																	{fieldValidationErrors.hysteriaMasqueradeDir && (
																		<Text fontSize="xs" color="red.500" mt={1}>
																			{
																				fieldValidationErrors.hysteriaMasqueradeDir
																			}
																		</Text>
																	)}
																</FormControl>
															)}

															{hysteriaMasqueradeType === "string" && (
																<FormControl>
																	<FormLabel>
																		{t(
																			"inbounds.hysteria.content",
																			"Response content",
																		)}
																	</FormLabel>
																	<Textarea
																		{...register("hysteriaMasqueradeContent")}
																		placeholder="ok"
																	/>
																</FormControl>
															)}

															<Stack spacing={2}>
																<Flex justify="space-between" align="center">
																	<Text fontWeight="medium">
																		{t(
																			"inbounds.hysteria.headers",
																			"Masquerade headers",
																		)}
																	</Text>
																	<Button
																		size="xs"
																		onClick={() =>
																			appendHysteriaMasqueradeHeader({
																				name: "",
																				value: "",
																			})
																		}
																	>
																		{t("inbounds.accounts.add", "Add")}
																	</Button>
																</Flex>
																{hysteriaMasqueradeHeaderFields.map(
																	(field, index) => (
																		<HStack
																			key={field.id}
																			spacing={2}
																			align="flex-start"
																		>
																			<FormControl>
																				<Input
																					{...register(
																						`hysteriaMasqueradeHeaders.${index}.name` as const,
																					)}
																					placeholder={t(
																						"inbounds.hysteria.headerName",
																						"Header name",
																					)}
																				/>
																			</FormControl>
																			<FormControl>
																				<Input
																					{...register(
																						`hysteriaMasqueradeHeaders.${index}.value` as const,
																					)}
																					placeholder={t(
																						"inbounds.hysteria.headerValue",
																						"Header value",
																					)}
																				/>
																			</FormControl>
																			<Button
																				size="xs"
																				variant="ghost"
																				colorScheme="red"
																				onClick={() =>
																					removeHysteriaMasqueradeHeader(index)
																				}
																			>
																				{t("hostsPage.delete", "Delete")}
																			</Button>
																		</HStack>
																	),
																)}
															</Stack>
														</Stack>
													</Collapse>

													<Stack spacing={3} className="xray-dialog-section">
														<Flex justify="space-between" align="center" gap={3}>
															<Box>
																<Text fontSize="sm" fontWeight="semibold">
																	{t("inbounds.hysteria.udpMasks", "UDP Masks")}
																</Text>
																<Text fontSize="xs" color="gray.500">
																	{t(
																		"inbounds.hysteria.udpMasksHint",
																		"Hysteria2 supports Salamander obfuscation. Gecko stores a packet size range on the same Salamander mask.",
																	)}
																</Text>
															</Box>
															<Button
																size="xs"
																leftIcon={<SparklesIcon width={14} height={14} />}
																onClick={() =>
																	appendHysteriaUdpMask(
																		createDefaultHysteriaUdpMask(),
																	)
																}
															>
																{t("inbounds.hysteria.addUdpMask", "Add mask")}
															</Button>
														</Flex>
														{fieldValidationErrors.hysteriaUdpMasks && (
															<Text fontSize="xs" color="red.500">
																{fieldValidationErrors.hysteriaUdpMasks}
															</Text>
														)}
														{hysteriaUdpMaskFields.length === 0 && (
															<Text fontSize="xs" color="gray.500">
																{t(
																	"inbounds.hysteria.noUdpMasks",
																	"No UDP mask will be emitted.",
																)}
															</Text>
														)}
														{hysteriaUdpMaskFields.map((field, index) => {
															const maskMode =
																formValues.hysteriaUdpMasks?.[index]?.mode ||
																"salamander";
															return (
																<Stack
																	key={field.id}
																	spacing={3}
																	borderWidth="1px"
																	borderColor="whiteAlpha.200"
																	borderRadius="md"
																	p={3}
																>
																	<Flex justify="space-between" align="center">
																		<Text fontSize="sm" fontWeight="semibold">
																			{t(
																				"inbounds.hysteria.udpMaskTitle",
																				"UDP Mask {{index}}",
																				{ index: index + 1 },
																			)}
																		</Text>
																		<Button
																			size="xs"
																			variant="ghost"
																			colorScheme="red"
																			onClick={() => removeHysteriaUdpMask(index)}
																		>
																			{t("hostsPage.delete", "Delete")}
																		</Button>
																	</Flex>
																	<SimpleGrid
																		columns={{ base: 1, md: 2 }}
																		spacing={3}
																	>
																		<FormControl>
																			<FormLabel>
																				{t("inbounds.hysteria.maskType", "Type")}
																			</FormLabel>
																			<SearchableTagSelect
																				value="salamander"
																				isDisabled
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
																			<FormLabel>
																				{t("inbounds.hysteria.maskMode", "Mode")}
																			</FormLabel>
																			<Controller
																				control={control}
																				name={`hysteriaUdpMasks.${index}.mode` as const}
																				render={({ field: modeField }) => (
																					<SearchableTagSelect
																						value={modeField.value || "salamander"}
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
																							"inbounds.hysteria.maskMode",
																							"Mode",
																						)}
																						onChange={(value) =>
																							modeField.onChange(String(value))
																						}
																					/>
																				)}
																			/>
																			<Text fontSize="xs" color="gray.500" mt={1}>
																				{maskMode === "gecko"
																					? t(
																							"inbounds.hysteria.geckoHint",
																							"Gecko splits packets into random-padded fragments.",
																						)
																					: t(
																							"inbounds.hysteria.salamanderHint",
																							"Scrambles each packet into random-looking bytes.",
																						)}
																			</Text>
																		</FormControl>
																		<FormControl>
																			<FormLabel>
																				{t(
																					"inbounds.hysteria.maskPassword",
																					"Password",
																				)}
																			</FormLabel>
																			<HStack>
																				<Input
																					{...register(
																						`hysteriaUdpMasks.${index}.password` as const,
																					)}
																					placeholder="Obfuscation password"
																				/>
																				<IconButton
																					aria-label={t(
																						"inbounds.hysteria.generatePassword",
																						"Generate password",
																					)}
																					icon={<ArrowPathIcon width={16} height={16} />}
																					size="sm"
																					variant="outline"
																					onClick={() =>
																						form.setValue(
																							`hysteriaUdpMasks.${index}.password`,
																							randomLowerAndNum(16),
																							{
																								shouldDirty: true,
																								shouldValidate: true,
																							},
																						)
																					}
																				/>
																			</HStack>
																		</FormControl>
																		{maskMode === "gecko" && (
																			<FormControl>
																				<FormLabel>
																					{t(
																						"inbounds.hysteria.packetSize",
																						"Packet size",
																					)}
																				</FormLabel>
																				<Input
																					{...register(
																						`hysteriaUdpMasks.${index}.packetSize` as const,
																					)}
																					placeholder="512-1200"
																				/>
																				<Text fontSize="xs" color="gray.500" mt={1}>
																					{t(
																						"inbounds.hysteria.packetSizeHint",
																						"Serialized as a string range, for example 512-1200.",
																					)}
																				</Text>
																			</FormControl>
																		)}
																	</SimpleGrid>
																</Stack>
															);
														})}
													</Stack>

													<Stack spacing={3} className="xray-dialog-section">
														<FormControl display="flex" alignItems="center">
															<FormLabel mb={0}>
																{t(
																	"inbounds.hysteria.quicParams",
																	"QUIC Params",
																)}
															</FormLabel>
															<Switch
																{...register("hysteriaQuicParams.enabled")}
															/>
														</FormControl>
														<Collapse
															in={Boolean(formValues.hysteriaQuicParams?.enabled)}
															animateOpacity
														>
															<Stack spacing={3} mt={2}>
																<SimpleGrid
																	columns={{ base: 1, md: 2 }}
																	spacing={3}
																>
																	<FormControl>
																		<FormLabel>
																			{t(
																				"inbounds.hysteria.congestion",
																				"Congestion",
																			)}
																		</FormLabel>
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
																						"Congestion",
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
																			<FormLabel>
																				{t(
																					"inbounds.hysteria.bbrProfile",
																					"BBR Profile",
																				)}
																			</FormLabel>
																			<Controller
																				control={control}
																				name="hysteriaQuicParams.bbrProfile"
																				render={({ field }) => (
																					<SearchableTagSelect
																						value={field.value || ""}
																						options={[
																							{
																								value: "",
																								label: t(
																									"common.auto",
																									"Auto",
																								),
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
																</SimpleGrid>
																{["brutal", "force-brutal"].includes(
																	formValues.hysteriaQuicParams?.congestion || "",
																) && (
																	<SimpleGrid
																		columns={{ base: 1, md: 2 }}
																		spacing={3}
																	>
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
																	</SimpleGrid>
																)}
																<HStack spacing={6} flexWrap="wrap">
																	<FormControl
																		display="flex"
																		alignItems="center"
																		w="auto"
																	>
																		<FormLabel mb={0}>
																			{t("common.debug", "Debug")}
																		</FormLabel>
																		<Switch
																			{...register(
																				"hysteriaQuicParams.debug",
																			)}
																		/>
																	</FormControl>
																	<FormControl
																		display="flex"
																		alignItems="center"
																		w="auto"
																	>
																		<FormLabel mb={0}>
																			{t(
																				"inbounds.hysteria.udpHop",
																				"UDP Hop",
																			)}
																		</FormLabel>
																		<Switch
																			{...register(
																				"hysteriaQuicParams.udpHopEnabled",
																			)}
																		/>
																	</FormControl>
																</HStack>
																{formValues.hysteriaQuicParams?.udpHopEnabled && (
																	<SimpleGrid
																		columns={{ base: 1, md: 2 }}
																		spacing={3}
																	>
																		<FormControl>
																			<FormLabel>
																				{t(
																					"inbounds.hysteria.hopPorts",
																					"Hop ports",
																				)}
																			</FormLabel>
																			<Input
																				{...register(
																					"hysteriaQuicParams.udpHopPorts",
																				)}
																				placeholder="20000-50000"
																			/>
																		</FormControl>
																		<FormControl>
																			<FormLabel>
																				{t(
																					"inbounds.hysteria.hopInterval",
																					"Hop interval",
																				)}
																			</FormLabel>
																			<Input
																				{...register(
																					"hysteriaQuicParams.udpHopInterval",
																				)}
																				placeholder="5-10"
																			/>
																		</FormControl>
																	</SimpleGrid>
																)}
																<SimpleGrid
																	columns={{ base: 1, md: 2 }}
																	spacing={3}
																>
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
																</SimpleGrid>
																<FormControl display="flex" alignItems="center">
																	<FormLabel mb={0}>
																		{t(
																			"inbounds.hysteria.disablePathMtu",
																			"Disable path MTU discovery",
																		)}
																	</FormLabel>
																	<Switch
																		{...register(
																			"hysteriaQuicParams.disablePathMTUDiscovery",
																		)}
																	/>
																</FormControl>
															</Stack>
														</Collapse>
													</Stack>
												</Stack>
											)}
											<FormControl display="flex" alignItems="center">
												<FormLabel mb={0}>
													{t("inbounds.sockopt.enable", "Enable sockopt")}
												</FormLabel>
												<Controller
													control={control}
													name="sockoptEnabled"
													render={({ field }) => (
														<Switch
															isChecked={Boolean(field.value)}
															onChange={(event) =>
																field.onChange(event.target.checked)
															}
														/>
													)}
												/>
											</FormControl>
											<Collapse in={Boolean(sockoptEnabled)} animateOpacity>
												<Stack
													className="xray-dialog-section"
													spacing={3}
													mt={2}
												>
													<Text fontSize="sm" fontWeight="semibold">
														{t("inbounds.sockopt.title", "Sockopt")}
													</Text>
													<SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
														{renderSockoptNumberInput(
															"mark",
															t("inbounds.sockopt.routeMark", "Route mark"),
														)}
														{renderSockoptNumberInput(
															"tcpKeepAliveInterval",
															t(
																"inbounds.sockopt.tcpKeepAliveInterval",
																"TCP keep alive interval",
															),
														)}
														{renderSockoptNumberInput(
															"tcpKeepAliveIdle",
															t(
																"inbounds.sockopt.tcpKeepAliveIdle",
																"TCP keep alive idle",
															),
														)}
														{renderSockoptNumberInput(
															"tcpMaxSeg",
															t(
																"inbounds.sockopt.tcpMaxSeg",
																"TCP max segment",
															),
														)}
														{renderSockoptNumberInput(
															"tcpUserTimeout",
															t(
																"inbounds.sockopt.tcpUserTimeout",
																"TCP user timeout",
															),
														)}
														{renderSockoptNumberInput(
															"tcpWindowClamp",
															t(
																"inbounds.sockopt.tcpWindowClamp",
																"TCP window clamp",
															),
														)}
													</SimpleGrid>
													<SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
														{renderSockoptTextInput(
															"dialerProxy",
															t("inbounds.sockopt.dialerProxy", "Dialer proxy"),
															"proxy",
														)}
														{renderSockoptTextInput(
															"interfaceName",
															t(
																"inbounds.sockopt.interfaceName",
																"Interface name",
															),
														)}
													</SimpleGrid>
													<SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
														<FormControl>
															<FormLabel>
																{t(
																	"inbounds.sockopt.domainStrategy",
																	"Domain strategy",
																)}
															</FormLabel>
															<Controller
																control={control}
																name="sockopt.domainStrategy"
																render={({ field }) => (
																	<SearchableTagSelect
																		value={field.value || ""}
																		options={[
																			{
																				value: "",
																				label: t("common.none", "None"),
																			},
																			...DOMAIN_STRATEGY_OPTIONS,
																		]}
																		placeholder={t(
																			"inbounds.sockopt.domainStrategy",
																			"Domain strategy",
																		)}
																		onChange={(value) =>
																			field.onChange(String(value))
																		}
																	/>
																)}
															/>
														</FormControl>
														<FormControl>
															<FormLabel>
																{t(
																	"inbounds.sockopt.tcpCongestion",
																	"TCP congestion",
																)}
															</FormLabel>
															<Controller
																control={control}
																name="sockopt.tcpcongestion"
																render={({ field }) => (
																	<SearchableTagSelect
																		value={field.value || ""}
																		options={[
																			{
																				value: "",
																				label: t("common.none", "None"),
																			},
																			...TCP_CONGESTION_OPTIONS,
																		]}
																		placeholder={t(
																			"inbounds.sockopt.tcpCongestion",
																			"TCP congestion",
																		)}
																		onChange={(value) =>
																			field.onChange(String(value))
																		}
																	/>
																)}
															/>
														</FormControl>
														<FormControl>
															<FormLabel>
																{t("inbounds.sockopt.tproxy", "TProxy")}
															</FormLabel>
															<Controller
																control={control}
																name="sockopt.tproxy"
																render={({ field }) => (
																	<SearchableTagSelect
																		value={field.value || ""}
																		options={TPROXY_OPTIONS.map((option) => ({
																			value: option,
																			label: option || t("common.none", "None"),
																		}))}
																		placeholder={t(
																			"inbounds.sockopt.tproxy",
																			"TProxy",
																		)}
																		onChange={(value) =>
																			field.onChange(String(value))
																		}
																	/>
																)}
															/>
														</FormControl>
													</SimpleGrid>
													<SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
														{renderSockoptSwitch(
															"acceptProxyProtocol",
															t(
																"inbounds.sockopt.acceptProxyProtocol",
																"Accept proxy protocol",
															),
														)}
														{renderSockoptSwitch(
															"tcpFastOpen",
															t(
																"inbounds.sockopt.tcpFastOpen",
																"TCP fast open",
															),
														)}
														{renderSockoptSwitch(
															"tcpMptcp",
															t("inbounds.sockopt.tcpMptcp", "Multipath TCP"),
														)}
														{renderSockoptSwitch(
															"penetrate",
															t("inbounds.sockopt.penetrate", "Penetrate"),
														)}
														{renderSockoptSwitch(
															"V6Only",
															t("inbounds.sockopt.v6Only", "IPv6 only"),
														)}
													</SimpleGrid>
												</Stack>
											</Collapse>
										</Stack>
									)}

									{streamSecurity !== "tls" &&
										streamSecurity !== "reality" &&
										vlessAuthenticationSection}

									{streamSecurity === "tls" && (
										<Stack className="xray-dialog-section" spacing={3}>
											<Text fontSize="sm" fontWeight="semibold">
												{t("inbounds.tls.title", "TLS settings")}
											</Text>
											<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
												<FormControl>
													<FormLabel>
														{t("inbounds.tls.serverName", "Server name (SNI)")}
													</FormLabel>
													<Input
														{...register("tlsServerName")}
														placeholder="example.com"
													/>
												</FormControl>
												<FormControl>
													<FormLabel>
														{t("inbounds.tls.cipherSuites", "Cipher suites")}
													</FormLabel>
													<SearchableTagSelect
														value={formValues.tlsCipherSuites || ""}
														options={[
															{ value: "", label: t("common.auto", "Auto") },
															...tlsCipherOptions,
														]}
														placeholder={t(
															"inbounds.tls.cipherSuites",
															"Cipher suites",
														)}
														onChange={(value) =>
															form.setValue("tlsCipherSuites", String(value), {
																shouldDirty: true,
																shouldValidate: true,
															})
														}
													/>
												</FormControl>
											</SimpleGrid>
											<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
												<FormControl>
													<FormLabel>
														{t("inbounds.tls.minVersion", "Min version")}
													</FormLabel>
													<SearchableTagSelect
														value={formValues.tlsMinVersion || ""}
														options={tlsVersionOptions}
														placeholder={t(
															"inbounds.tls.minVersion",
															"Min version",
														)}
														onChange={(value) =>
															form.setValue("tlsMinVersion", String(value), {
																shouldDirty: true,
																shouldValidate: true,
															})
														}
													/>
												</FormControl>
												<FormControl>
													<FormLabel>
														{t("inbounds.tls.maxVersion", "Max version")}
													</FormLabel>
													<SearchableTagSelect
														value={formValues.tlsMaxVersion || ""}
														options={tlsVersionOptions}
														placeholder={t(
															"inbounds.tls.maxVersion",
															"Max version",
														)}
														onChange={(value) =>
															form.setValue("tlsMaxVersion", String(value), {
																shouldDirty: true,
																shouldValidate: true,
															})
														}
													/>
												</FormControl>
											</SimpleGrid>
											<FormControl>
												<FormLabel>
													{t("inbounds.tls.fingerprint", "uTLS fingerprint")}
												</FormLabel>
												<SearchableTagSelect
													value={formValues.tlsFingerprint || ""}
													options={[
														{ value: "", label: t("common.none", "None") },
														...tlsFingerprintOptions,
													]}
													placeholder={t(
														"inbounds.tls.fingerprint",
														"uTLS fingerprint",
													)}
													onChange={(value) =>
														form.setValue("tlsFingerprint", String(value), {
															shouldDirty: true,
															shouldValidate: true,
														})
													}
												/>
											</FormControl>
											<FormControl>
												<FormLabel>{t("inbounds.tls.alpn", "ALPN")}</FormLabel>
												<Controller
													control={control}
													name="tlsAlpn"
													render={({ field }) => (
														<SearchableTagSelect
															mode="multiple"
															value={field.value ?? []}
															options={tlsAlpnOptions}
															placeholder={t(
																"inbounds.tls.selectAlpn",
																"Select ALPN values",
															)}
															searchPlaceholder={t(
																"inbounds.tls.searchAlpn",
																"Search ALPN",
															)}
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
											<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
												<FormControl display="flex" alignItems="center">
													<FormLabel mb={0}>
														{t("inbounds.tls.allowInsecure", "Allow insecure")}
													</FormLabel>
													<Switch {...register("tlsAllowInsecure")} />
												</FormControl>
												<FormControl display="flex" alignItems="center">
													<FormLabel mb={0}>
														{t(
															"inbounds.tls.rejectUnknownSni",
															"Reject unknown SNI",
														)}
													</FormLabel>
													<Switch {...register("tlsRejectUnknownSni")} />
												</FormControl>
												<FormControl display="flex" alignItems="center">
													<FormLabel mb={0}>
														{t(
															"inbounds.tls.disableSystemRoot",
															"Disable system root",
														)}
													</FormLabel>
													<Switch {...register("tlsDisableSystemRoot")} />
												</FormControl>
												<FormControl display="flex" alignItems="center">
													<FormLabel mb={0}>
														{t(
															"inbounds.tls.enableSessionResumption",
															"Session resumption",
														)}
													</FormLabel>
													<Switch {...register("tlsEnableSessionResumption")} />
												</FormControl>
											</SimpleGrid>
											<FormControl>
												<FormLabel>
													{t(
														"inbounds.tls.verifyPeerCertByName",
														"Verify peer cert by name",
													)}
												</FormLabel>
												<Input {...register("tlsVerifyPeerCertByName")} />
											</FormControl>
											<Divider />
											<Stack spacing={3}>
												<Flex align="center" justify="space-between">
													<Box fontWeight="medium">
														{t("inbounds.tls.certificates", "Certificates")}
													</Box>
													<Button size="xs" onClick={handleAddTlsCertificate}>
														{t(
															"inbounds.tls.addCertificate",
															"Add certificate",
														)}
													</Button>
												</Flex>
												{tlsCertificateFields.map((field, index) => {
													const certConfig = tlsCertificates[index] || {
														useFile: true,
														usage: "encipherment",
													};
													const usage = certConfig.usage || "encipherment";
													return (
														<Box
															key={field.id}
															borderWidth="1px"
															borderRadius="md"
															borderColor={sectionBorder}
															p={3}
														>
															<Flex
																justify="space-between"
																align="center"
																mb={3}
															>
																<Text fontWeight="semibold">
																	{t("inbounds.tls.certificate", "Certificate")}{" "}
																	#{index + 1}
																</Text>
																{tlsCertificateFields.length > 1 && (
																	<Button
																		size="xs"
																		variant="ghost"
																		colorScheme="red"
																		onClick={() => removeTlsCertificate(index)}
																	>
																		{t("hostsPage.delete", "Delete")}
																	</Button>
																)}
															</Flex>
															<FormControl>
																<FormLabel>
																	{t(
																		"inbounds.tls.certificateSource",
																		"Certificate source",
																	)}
																</FormLabel>
																<Controller
																	control={control}
																	name={
																		`tlsCertificates.${index}.useFile` as const
																	}
																	render={({ field }) => (
																		<RadioGroup
																			value={field.value ? "file" : "content"}
																			onChange={(value) =>
																				field.onChange(value === "file")
																			}
																		>
																			<HStack spacing={4}>
																				<Radio value="file">
																					{t(
																						"inbounds.tls.certificatePath",
																						"Path",
																					)}
																				</Radio>
																				<Radio value="content">
																					{t(
																						"inbounds.tls.certificateContent",
																						"Content",
																					)}
																				</Radio>
																			</HStack>
																		</RadioGroup>
																	)}
																/>
															</FormControl>
															{certConfig.useFile ? (
																<SimpleGrid
																	columns={{ base: 1, md: 2 }}
																	spacing={3}
																>
																	<FormControl>
																		<FormLabel>
																			{t(
																				"inbounds.tls.certFile",
																				"Certificate file",
																			)}
																		</FormLabel>
																		<Input
																			{...register(
																				`tlsCertificates.${index}.certFile` as const,
																			)}
																		/>
																	</FormControl>
																	<FormControl>
																		<FormLabel>
																			{t("inbounds.tls.keyFile", "Key file")}
																		</FormLabel>
																		<Input
																			{...register(
																				`tlsCertificates.${index}.keyFile` as const,
																			)}
																		/>
																	</FormControl>
																</SimpleGrid>
															) : (
																<SimpleGrid
																	columns={{ base: 1, md: 2 }}
																	spacing={3}
																>
																	<FormControl>
																		<FormLabel>
																			{t("inbounds.tls.cert", "Certificate")}
																		</FormLabel>
																		<Textarea
																			rows={3}
																			{...register(
																				`tlsCertificates.${index}.cert` as const,
																			)}
																		/>
																	</FormControl>
																	<FormControl>
																		<FormLabel>
																			{t("inbounds.tls.key", "Key")}
																		</FormLabel>
																		<Textarea
																			rows={3}
																			{...register(
																				`tlsCertificates.${index}.key` as const,
																			)}
																		/>
																	</FormControl>
																</SimpleGrid>
															)}
															<SimpleGrid
																columns={{ base: 1, md: 2 }}
																spacing={3}
															>
																<FormControl display="flex" alignItems="center">
																	<FormLabel mb={0}>
																		{t(
																			"inbounds.tls.oneTimeLoading",
																			"One time loading",
																		)}
																	</FormLabel>
																	<Switch
																		{...register(
																			`tlsCertificates.${index}.oneTimeLoading` as const,
																		)}
																	/>
																</FormControl>
																<FormControl>
																	<FormLabel>
																		{t("inbounds.tls.usage", "Usage option")}
																	</FormLabel>
																	<SearchableTagSelect
																		value={usage}
																		options={tlsUsageOptions}
																		placeholder={t(
																			"inbounds.tls.usage",
																			"Usage option",
																		)}
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
															</SimpleGrid>
															{usage === "issue" && (
																<FormControl display="flex" alignItems="center">
																	<FormLabel mb={0}>
																		{t(
																			"inbounds.tls.buildChain",
																			"Build chain",
																		)}
																	</FormLabel>
																	<Switch
																		{...register(
																			`tlsCertificates.${index}.buildChain` as const,
																		)}
																	/>
																</FormControl>
															)}
														</Box>
													);
												})}
											</Stack>
											<Divider />
											<Stack spacing={3}>
												<FormControl>
													<FormLabel>
														{t("inbounds.tls.echKey", "ECH key")}
													</FormLabel>
													<Input {...register("tlsEchServerKeys")} />
												</FormControl>
												<FormControl>
													<FormLabel>
														{t("inbounds.tls.echConfig", "ECH config")}
													</FormLabel>
													<Input {...register("tlsEchConfigList")} />
												</FormControl>
												<FormControl>
													<FormLabel>
														{t("inbounds.tls.echForceQuery", "ECH force query")}
													</FormLabel>
													<SearchableTagSelect
														value={formValues.tlsEchForceQuery || ""}
														options={tlsEchForceOptions}
														placeholder={t(
															"inbounds.tls.echForceQuery",
															"ECH force query",
														)}
														onChange={(value) =>
															form.setValue("tlsEchForceQuery", String(value), {
																shouldDirty: true,
																shouldValidate: true,
															})
														}
													/>
												</FormControl>
												<HStack spacing={3}>
													<Button size="xs" onClick={handleGenerateEchCert}>
														{t("inbounds.tls.echGenerate", "Get new ECH cert")}
													</Button>
													<Button
														size="xs"
														variant="ghost"
														onClick={handleClearEchCert}
													>
														{t("common.clear", "Clear")}
													</Button>
												</HStack>
											</Stack>
										</Stack>
									)}

									{streamSecurity === "tls" && vlessAuthenticationSection}

									{streamSecurity === "reality" && (
										<Stack className="xray-dialog-section" spacing={3}>
											<Text fontSize="sm" fontWeight="semibold">
												{t("inbounds.reality.title", "Reality settings")}
											</Text>
											<FormControl display="flex" alignItems="center">
												<FormLabel mb={0}>
													{t("inbounds.reality.show", "Show")}
												</FormLabel>
												<Switch {...register("realityShow")} />
											</FormControl>
											<FormControl>
												<FormLabel>
													{t("inbounds.reality.xver", "Xver")}
												</FormLabel>
												<Controller
													control={control}
													name="realityXver"
													render={({ field }) => (
														<NumericInput
															value={field.value ?? ""}
															onChange={(value) => field.onChange(value)}
															min={0}
														/>
													)}
												/>
											</FormControl>
											<FormControl>
												<FormLabel>
													{t(
														"inbounds.reality.fingerprint",
														"uTLS fingerprint",
													)}
												</FormLabel>
												<SearchableTagSelect
													value={formValues.realityFingerprint || ""}
													options={tlsFingerprintOptions}
													placeholder={t(
														"inbounds.reality.fingerprint",
														"uTLS fingerprint",
													)}
													onChange={(value) =>
														form.setValue("realityFingerprint", String(value), {
															shouldDirty: true,
															shouldValidate: true,
														})
													}
												/>
											</FormControl>
											<FormControl
												isRequired
												isInvalid={Boolean(
													errors.realityTarget ||
														fieldValidationErrors.realityTarget,
												)}
											>
												<FormLabel>
													<HStack spacing={2}>
														<Text>
															{t("inbounds.reality.target", "Target")}
														</Text>
														<Tooltip label={t("common.randomize", "Randomize")}>
															<IconButton
																aria-label={t("common.randomize", "Randomize")}
																variant="ghost"
																size="xs"
																icon={<ArrowPathIcon width={14} height={14} />}
																onClick={handleRandomizeRealityTarget}
															/>
														</Tooltip>
													</HStack>
												</FormLabel>
												<Input
													{...register("realityTarget", { required: true })}
													placeholder="example.com:443"
												/>
												{(errors.realityTarget ||
													fieldValidationErrors.realityTarget) && (
													<Text fontSize="xs" color="red.500" mt={1}>
														{fieldValidationErrors.realityTarget ||
															t(
																"validation.required",
																"This field is required",
															)}
													</Text>
												)}
											</FormControl>
											<FormControl
												isRequired
												isInvalid={Boolean(
													errors.realityServerNames ||
														fieldValidationErrors.realityServerNames,
												)}
											>
												<FormLabel>
													<HStack spacing={2}>
														<Text>
															{t(
																"inbounds.reality.serverNames",
																"Server names",
															)}
														</Text>
														<Tooltip label={t("common.randomize", "Randomize")}>
															<IconButton
																aria-label={t("common.randomize", "Randomize")}
																variant="ghost"
																size="xs"
																icon={<ArrowPathIcon width={14} height={14} />}
																onClick={handleRandomizeRealityTarget}
															/>
														</Tooltip>
													</HStack>
												</FormLabel>
												<Input
													{...register("realityServerNames", {
														required: true,
													})}
													placeholder="domain.com"
												/>
												<Box fontSize="sm" color="gray.500">
													{t(
														"inbounds.serverNamesHint",
														"Separate entries with commas.",
													)}
												</Box>
												{(errors.realityServerNames ||
													fieldValidationErrors.realityServerNames) && (
													<Text fontSize="xs" color="red.500" mt={1}>
														{fieldValidationErrors.realityServerNames ||
															t(
																"validation.required",
																"This field is required",
															)}
													</Text>
												)}
											</FormControl>
											<FormControl>
												<FormLabel>
													{t(
														"inbounds.reality.maxTimediff",
														"Max time diff (ms)",
													)}
												</FormLabel>
												<Controller
													control={control}
													name="realityMaxTimediff"
													render={({ field }) => (
														<NumericInput
															value={field.value ?? ""}
															onChange={(value) => field.onChange(value)}
															min={0}
														/>
													)}
												/>
											</FormControl>
											<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
												<FormControl>
													<FormLabel>
														{t(
															"inbounds.reality.minClientVer",
															"Min client ver",
														)}
													</FormLabel>
													<Input
														{...register("realityMinClientVer")}
														placeholder="25.9.11"
													/>
												</FormControl>
												<FormControl>
													<FormLabel>
														{t(
															"inbounds.reality.maxClientVer",
															"Max client ver",
														)}
													</FormLabel>
													<Input
														{...register("realityMaxClientVer")}
														placeholder="25.9.11"
													/>
												</FormControl>
											</SimpleGrid>
											<FormControl
												isRequired
												isInvalid={Boolean(
													errors.realityShortIds ||
														fieldValidationErrors.realityShortIds,
												)}
											>
												<FormLabel>
													<HStack spacing={2}>
														<Text>
															{t("inbounds.reality.shortIds", "Short IDs")}
														</Text>
														<Tooltip label={t("common.randomize", "Randomize")}>
															<IconButton
																aria-label={t("common.randomize", "Randomize")}
																variant="ghost"
																size="xs"
																icon={<ArrowPathIcon width={14} height={14} />}
																onClick={handleRandomizeRealityShortIds}
															/>
														</Tooltip>
													</HStack>
												</FormLabel>
												<Input {...register("realityShortIds")} />
												<Button
													size="xs"
													mt={2}
													variant="outline"
													onClick={handleGenerateShortId}
													alignSelf="flex-start"
												>
													{t(
														"inbounds.reality.generateShortId",
														"Generate short ID",
													)}
												</Button>
												<Box fontSize="sm" color="gray.500">
													{t(
														"inbounds.shortIdsHint",
														"Separate entries with commas.",
													)}
												</Box>
												{(errors.realityShortIds ||
													fieldValidationErrors.realityShortIds) && (
													<Text fontSize="xs" color="red.500" mt={1}>
														{fieldValidationErrors.realityShortIds ||
															t(
																"validation.required",
																"This field is required",
															)}
													</Text>
												)}
											</FormControl>
											<FormControl>
												<FormLabel>
													{t("inbounds.reality.spiderX", "SpiderX")}
												</FormLabel>
												<Input {...register("realitySpiderX")} />
											</FormControl>
											<FormControl>
												<FormLabel>
													{t(
														"inbounds.reality.publicKey",
														"Reality public key",
													)}
												</FormLabel>
												<Input {...register("realityPublicKey")} />
											</FormControl>
											<FormControl
												isRequired
												isInvalid={Boolean(
													errors.realityPrivateKey ||
														fieldValidationErrors.realityPrivateKey,
												)}
											>
												<FormLabel>
													{t(
														"inbounds.reality.privateKey",
														"Reality private key",
													)}
												</FormLabel>
												<Input
													{...register("realityPrivateKey", { required: true })}
												/>
												{(errors.realityPrivateKey ||
													fieldValidationErrors.realityPrivateKey) && (
													<Text fontSize="xs" color="red.500" mt={1}>
														{fieldValidationErrors.realityPrivateKey ||
															t(
																"validation.required",
																"This field is required",
															)}
													</Text>
												)}
											</FormControl>
											<HStack spacing={3}>
												<Button
													size="xs"
													onClick={handleGenerateRealityKeypair}
												>
													{t("inbounds.reality.generateKeys", "Get new cert")}
												</Button>
												<Button
													size="xs"
													variant="ghost"
													onClick={handleClearRealityKeypair}
												>
													{t("common.clear", "Clear")}
												</Button>
											</HStack>
											<FormControl>
												<FormLabel>
													{t("inbounds.reality.mldsa65Seed", "ML-DSA-65 seed")}
												</FormLabel>
												<Input {...register("realityMldsa65Seed")} />
											</FormControl>
											<FormControl>
												<FormLabel>
													{t(
														"inbounds.reality.mldsa65Verify",
														"ML-DSA-65 verify",
													)}
												</FormLabel>
												<Input {...register("realityMldsa65Verify")} />
											</FormControl>
											<HStack spacing={3}>
												<Button size="xs" onClick={handleGenerateMldsa65}>
													{t(
														"inbounds.reality.mldsa65Generate",
														"Get new seed",
													)}
												</Button>
												<Button
													size="xs"
													variant="ghost"
													onClick={handleClearMldsa65}
												>
													{t("common.clear", "Clear")}
												</Button>
											</HStack>
										</Stack>
									)}

									{streamSecurity === "reality" && vlessAuthenticationSection}

									{supportsFallback && (
										<Stack className="xray-dialog-section" spacing={3}>
											<Flex align="center" justify="space-between">
												<Box fontWeight="medium">
													{t("inbounds.fallbacks", "Fallbacks")}
												</Box>
												<Button size="xs" onClick={handleAddFallback}>
													{t("inbounds.fallbacks.add", "Add fallback")}
												</Button>
											</Flex>
											{fallbackFields.length === 0 ? (
												<Text fontSize="sm" color="gray.500">
													{t(
														"inbounds.fallbacks.empty",
														"No fallbacks configured yet.",
													)}
												</Text>
											) : (
												fallbackFields.map((field, index) => (
													<Box
														key={field.id}
														borderWidth="1px"
														borderRadius="md"
														borderColor={sectionBorder}
														p={3}
													>
														<Flex justify="space-between" align="center" mb={3}>
															<Text fontWeight="semibold">
																{t("inbounds.fallbacks.type", "Fallback")} #
																{index + 1}
															</Text>
															<Button
																size="xs"
																variant="ghost"
																colorScheme="red"
																onClick={() => removeFallback(index)}
															>
																{t("hostsPage.delete", "Delete")}
															</Button>
														</Flex>
														<SimpleGrid
															columns={{ base: 1, md: 2 }}
															spacing={3}
														>
															<FormControl>
																<FormLabel>
																	{t(
																		"inbounds.fallbacks.dest",
																		"Destination (host:port)",
																	)}
																</FormLabel>
																<Input
																	placeholder="example.com:443"
																	{...register(
																		`fallbacks.${index}.dest` as const,
																	)}
																/>
															</FormControl>
															<FormControl>
																<FormLabel>
																	{t("inbounds.fallbacks.path", "Path")}
																</FormLabel>
																<Input
																	{...register(
																		`fallbacks.${index}.path` as const,
																	)}
																	placeholder="/"
																/>
															</FormControl>
															<FormControl>
																<FormLabel>
																	{t("inbounds.fallbacks.type", "Type")}
																</FormLabel>
																<Input
																	{...register(
																		`fallbacks.${index}.type` as const,
																	)}
																	placeholder="none"
																/>
															</FormControl>
															<FormControl>
																<FormLabel>
																	{t("inbounds.fallbacks.alpn", "ALPN")}
																</FormLabel>
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
														</SimpleGrid>
													</Box>
												))
											)}
										</Stack>
									)}

									<Stack className="xray-dialog-section" spacing={3}>
										<Flex align="center" justify="space-between">
											<HStack spacing={2}>
												<Box fontWeight="medium">
													{t("inbounds.sniffing", "Sniffing")}
												</Box>
												<Tooltip
													label={t(
														"inbounds.sniffingHint",
														"It is recommended to keep the default.",
													)}
												>
													<QuestionMarkCircleIcon width={16} height={16} />
												</Tooltip>
											</HStack>
											<Switch {...register("sniffingEnabled")} />
										</Flex>
										{sniffingEnabled && (
											<Stack spacing={3}>
												<FormControl>
													<FormLabel>
														{t(
															"inbounds.sniffingDestinations",
															"Protocols to sniff",
														)}
													</FormLabel>
													<Controller
														control={control}
														name="sniffingDestinations"
														render={({ field }) => (
															<CheckboxGroup
																value={field.value ?? []}
																onChange={field.onChange}
															>
																<HStack spacing={4}>
																	{sniffingOptions.map((option) => (
																		<Checkbox
																			key={option.value}
																			value={option.value}
																		>
																			{option.label}
																		</Checkbox>
																	))}
																</HStack>
															</CheckboxGroup>
														)}
													/>
												</FormControl>
												<FormControl display="flex" alignItems="center">
													<FormLabel mb={0}>
														{t("inbounds.sniffingRouteOnly", "Route only")}
													</FormLabel>
													<Switch {...register("sniffingRouteOnly")} />
												</FormControl>
												<FormControl display="flex" alignItems="center">
													<FormLabel mb={0}>
														{t(
															"inbounds.sniffingMetadataOnly",
															"Metadata only",
														)}
													</FormLabel>
													<Switch {...register("sniffingMetadataOnly")} />
												</FormControl>
											</Stack>
										)}
									</Stack>
								</VStack>
							</TabPanel>
							<TabPanel px={0}>
								<VStack align="stretch" spacing={4}>
									{jsonError && (
										<Alert status="error">
											<AlertIcon />
											{jsonError}
										</Alert>
									)}
									<Box height="420px">
										<JsonEditor
											json={jsonText}
											canonicalContext="inbound"
											onChange={handleJsonEditorChange}
										/>
									</Box>
								</VStack>
							</TabPanel>
							<TabPanel px={0}>
								<Controller
									control={control}
									name="targetIds"
									rules={{
										validate: (value) =>
											Boolean(value?.length) ||
											t("inbounds.error.targetsRequired", "Select a target"),
									}}
									render={({ field }) => (
										<CheckboxGroup
											value={field.value || []}
											onChange={(value) => field.onChange(value)}
										>
											<SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
												{availableTargets.map((target) => (
													<Box
														key={target.id}
														borderWidth="1px"
														borderColor={sectionBorder}
														borderRadius="md"
														p={3}
													>
														<Checkbox value={target.id}>
															<HStack spacing={2}>
																<Text>{target.name}</Text>
																<Tag size="sm" colorScheme="gray">
																	{target.type === "master"
																		? "Master"
																		: target.mode}
																</Tag>
															</HStack>
														</Checkbox>
													</Box>
												))}
											</SimpleGrid>
											{errors.targetIds && (
												<Text fontSize="xs" color="red.500" mt={2}>
													{String(errors.targetIds.message)}
												</Text>
											)}
										</CheckboxGroup>
									)}
								/>
							</TabPanel>
						</TabPanels>
					</Tabs>
				</XrayModalBody>
				<XrayModalFooter
					justifyContent={isEditMode && onDelete ? "space-between" : "flex-end"}
				>
					{isEditMode && onDelete && (
						<HStack spacing={3}>
							<DeleteConfirmPopover
								message={t(
									"inbounds.confirmDelete",
									"Are you sure you want to delete this inbound?",
								)}
								isLoading={isDeleting}
								isDisabled={isSubmitting}
								onConfirm={onDelete}
							>
								<Button
									variant="ghost"
									colorScheme="red"
									isDisabled={isSubmitting}
								>
									{t("common.delete", "Delete")}
								</Button>
							</DeleteConfirmPopover>
							{onClone && (
								<Button
									variant="outline"
									onClick={onClone}
									isDisabled={isSubmitting}
								>
									{t("inbounds.clone", "Clone")}
								</Button>
							)}
						</HStack>
					)}
					<HStack spacing={3}>
						{isEditMode ? (
							<>
								<Button variant="ghost" onClick={onClose}>
									{t("hostsPage.cancel", "Cancel")}
								</Button>
								<Button
									colorScheme="primary"
									isLoading={isSubmitting}
									isDisabled={hasBlockingErrorsWithJson}
									onClick={handleSubmit(submitForm)}
								>
									{t("common.save", "Save")}
								</Button>
							</>
						) : (
							<>
								<Button variant="ghost" onClick={onClose}>
									{t("hostsPage.cancel", "Cancel")}
								</Button>
								<Button
									colorScheme="primary"
									isLoading={isSubmitting}
									isDisabled={hasBlockingErrorsWithJson}
									onClick={handleSubmit(submitForm)}
								>
									{isCloneMode
										? t("inbounds.cloneSubmit", "Create clone")
										: t("common.create", "Create")}
								</Button>
							</>
						)}
					</HStack>
				</XrayModalFooter>
			</XrayModalContent>
		</Modal>
	);
};
