import type { InputProps, SelectProps, TextareaProps } from "@chakra-ui/react";
import {
	Alert,
	AlertDescription,
	AlertIcon,
	AlertTitle,
	Box,
	Button,
	Input as ChakraInput,
	Select as ChakraSelect,
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
	ModalBody,
	ModalCloseButton,
	ModalContent,
	ModalFooter,
	ModalHeader,
	ModalOverlay,
	NumberInput,
	NumberInputField,
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
	Text,
	Tooltip,
	useColorModeValue,
	useToast,
	VStack,
} from "@chakra-ui/react";
import {
	ArrowPathIcon,
	QuestionMarkCircleIcon,
	SparklesIcon,
} from "@heroicons/react/24/outline";
import { JsonEditor } from "components/JsonEditor";
import { shadowsocksMethods } from "constants/Proxies";
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
	generateMldsa65,
	generateRealityKeypair,
	generateRealityShortId,
	getVlessEncAuthBlocks,
	type VlessEncAuthBlock,
} from "service/xray";
import {
	buildInboundPayload,
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
} from "utils/inbounds";

type Props = {
	isOpen: boolean;
	mode: "create" | "edit" | "clone";
	initialValue: RawInbound | null;
	isSubmitting: boolean;
	existingInbounds: RawInbound[];
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

const Select = forwardRef<HTMLSelectElement, SelectProps>((props, ref) => (
	<ChakraSelect size="sm" ref={ref} {...props} />
));
Select.displayName = "InboundFormSelect";

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
];
const TLS_COMPATIBLE_NETWORKS: Array<InboundFormValues["streamNetwork"]> = [
	"tcp",
	"ws",
	"http",
	"grpc",
	"httpupgrade",
	"xhttp",
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
	onClose,
	onSubmit,
	onDelete,
	onClone,
	isDeleting,
}) => {
	const { t } = useTranslation();
	const toast = useToast();
	const [vlessAuthOptions, setVlessAuthOptions] = useState<VlessEncAuthBlock[]>(
		[],
	);
	const [vlessAuthLoading, setVlessAuthLoading] = useState(false);
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
		fields: xhttpHeaderFields,
		append: appendXhttpHeader,
		remove: removeXhttpHeader,
	} = useFieldArray({
		control,
		name: "xhttpHeaders",
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
	const tagValue = useWatch({ control, name: "tag" }) || watch("tag") || "";
	const portValue = useWatch({ control, name: "port" }) || watch("port") || "";
	const supportsStreamSettings =
		currentProtocol !== "http" && currentProtocol !== "socks";
	const warningBg = useColorModeValue("yellow.50", "yellow.900");
	const warningBorder = useColorModeValue("yellow.400", "yellow.500");
	const defaultVlessAuthLabels = useMemo(
		() => ["X25519, not Post-Quantum", "ML-KEM-768, Post-Quantum"],
		[],
	);
	const ALL_NETWORK_OPTIONS = streamNetworks;
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
	const _hasBlockingErrors = Boolean(
		tagError || portError || streamCompatibilityError,
	);
	const hasBlockingErrorsWithJson = Boolean(
		tagError || portError || jsonError || streamCompatibilityError,
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
			setPortError(null);
			return;
		}
		if (
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
		if (
			portValue &&
			existingInbounds.some((inb) => inb.port?.toString() === portValue)
		) {
			setPortError(
				t("inbounds.error.portExists", "Inbound port already exists"),
			);
		} else {
			setPortError(null);
		}
	}, [existingInbounds, portValue, tagValue, t, isEditMode]);

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
							<NumberInput
								min={0}
								value={numberInputValue ?? ""}
								onChange={(valueString) => field.onChange(valueString)}
							>
								<NumberInputField />
							</NumberInput>
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
				updatingFromJsonRef.current = true;
				reset(mapped);
				setJsonError(null);
			} catch (error) {
				setJsonError(error instanceof Error ? error.message : "Invalid JSON");
			}
		},
		[reset],
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

	return (
		<Modal
			isOpen={isOpen}
			onClose={onClose}
			size="5xl"
			scrollBehavior="inside"
			isCentered
		>
			<ModalOverlay />
			<ModalContent maxW={{ base: "95vw", md: "4xl" }}>
				<ModalHeader>
					{mode === "create"
						? t("inbounds.add", "Add inbound")
						: mode === "clone"
							? t("inbounds.cloneTitle", "Clone inbound")
							: t("inbounds.edit", "Edit inbound")}
				</ModalHeader>
				<ModalCloseButton />
				<ModalBody>
					<Tabs
						variant="enclosed"
						colorScheme="primary"
						index={activeTab}
						onChange={(index) => setActiveTab(index)}
					>
						<TabList>
							<Tab>{t("form")}</Tab>
							<Tab>{t("json")}</Tab>
						</TabList>
						<TabPanels>
							<TabPanel px={0}>
								<VStack align="stretch" spacing={6}>
									<Stack
										spacing={4}
										borderWidth="1px"
										borderColor={sectionBorder}
										borderRadius="lg"
										p={4}
									>
										<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
											<FormControl isRequired isInvalid={!!tagError}>
												<FormLabel>{t("inbounds.tag", "Tag")}</FormLabel>
												<Input
													{...register("tag", { required: true })}
													isDisabled={isEditMode}
												/>
												{tagError && (
													<Text fontSize="xs" color="red.500" mt={1}>
														{tagError}
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
											<FormControl isRequired isInvalid={!!portError}>
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
												{portError && (
													<Text fontSize="xs" color="red.500" mt={1}>
														{portError}
													</Text>
												)}
											</FormControl>
											<FormControl isRequired>
												<FormLabel>
													{t("inbounds.protocol", "Protocol")}
												</FormLabel>
												<Select
													{...register("protocol", { required: true })}
													isDisabled={mode === "edit"}
												>
													{visibleProtocolOptions.map((option) => (
														<option key={option} value={option}>
															{option.toUpperCase()}
														</option>
													))}
												</Select>
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
														<Select {...register("shadowsocksMethod")}>
															{shadowsocksMethods.map((method) => (
																<option key={method} value={method}>
																	{method}
																</option>
															))}
														</Select>
													</FormControl>
													<FormControl>
														<FormLabel>
															{t(
																"inbounds.shadowsocks.network",
																"Allowed networks",
															)}
														</FormLabel>
														<Select {...register("shadowsocksNetwork")}>
															{shadowsocksNetworkOptions.map((option) => (
																<option key={option} value={option}>
																	{option}
																</option>
															))}
														</Select>
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
										{currentProtocol === "vless" && (
											<Stack spacing={3}>
												<Controller
													control={control}
													name="vlessSelectedAuth"
													render={({ field }) => (
														<FormControl>
															<FormLabel>
																{t(
																	"inbounds.vless.authentication",
																	"Authentication",
																)}
															</FormLabel>
															<ChakraSelect
																placeholder={t(
																	"inbounds.vless.authPlaceholder",
																	"Select authentication",
																)}
																value={field.value || ""}
																onChange={async (event) => {
																	const value = event.target.value;
																	field.onChange(value);
																	await handleAuthSelection(value);
																}}
															>
																<option value="">
																	{t("common.none", "None")}
																</option>
																{computedVlessAuthOptions.map((option) => (
																	<option
																		key={option.value}
																		value={option.value}
																	>
																		{option.label}
																	</option>
																))}
															</ChakraSelect>
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
													<Button
														size="sm"
														variant="ghost"
														onClick={handleClearAuth}
													>
														{t("inbounds.vless.clearKeys", "Clear")}
													</Button>
												</HStack>
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
									</Stack>

									{supportsStreamSettings && (
										<Stack
											spacing={4}
											borderWidth="1px"
											borderColor={sectionBorder}
											borderRadius="lg"
											p={4}
										>
											<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
												<FormControl>
													<FormLabel>
														{t("inbounds.network", "Network")}
													</FormLabel>
													<Select {...register("streamNetwork")}>
														{ALL_NETWORK_OPTIONS.map((network) => (
															<option key={network} value={network}>
																{network}
															</option>
														))}
													</Select>
												</FormControl>
												<FormControl>
													<FormLabel>
														{t("inbounds.security", "Security")}
													</FormLabel>
													<Controller
														control={control}
														name="streamSecurity"
														render={({ field }) => (
															<RadioGroup
																value={field.value}
																onChange={field.onChange}
															>
																<HStack spacing={4}>
																	{streamSecurityOptions.map((security) => {
																		const disabled =
																			security === "tls"
																				? !TLS_COMPATIBLE_PROTOCOLS.includes(
																						currentProtocol,
																					)
																				: security === "reality"
																					? !REALITY_COMPATIBLE_PROTOCOLS.includes(
																							currentProtocol,
																						)
																					: false;
																		return (
																			<Radio
																				key={security}
																				value={security}
																				isDisabled={disabled}
																			>
																				{security}
																			</Radio>
																		);
																	})}
																</HStack>
															</RadioGroup>
														)}
													/>
												</FormControl>
											</SimpleGrid>
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
												<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
													<FormControl>
														<FormLabel>
															{t("inbounds.ws.path", "WebSocket path")}
														</FormLabel>
														<Input {...register("wsPath")} placeholder="/ws" />
													</FormControl>
													<FormControl>
														<FormLabel>
															{t("inbounds.ws.host", "WebSocket host header")}
														</FormLabel>
														<Input {...register("wsHost")} />
													</FormControl>
												</SimpleGrid>
											)}

											{streamNetwork === "tcp" && (
												<Stack spacing={3}>
													<FormControl>
														<FormLabel>
															{t("inbounds.tcp.headerType", "TCP header type")}
														</FormLabel>
														<Select {...register("tcpHeaderType")}>
															<option value="none">none</option>
															<option value="http">http</option>
														</Select>
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
													<FormControl>
														<FormLabel>
															{t("inbounds.httpUpgrade.path", "Path")}
														</FormLabel>
														<Input {...register("httpupgradePath")} />
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
													<FormControl>
														<FormLabel>
															{t("inbounds.splitHttp.path", "Path")}
														</FormLabel>
														<Input {...register("splithttpPath")} />
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
														<FormControl>
															<FormLabel>
																{t("inbounds.xhttp.path", "Path")}
															</FormLabel>
															<Input
																{...register("xhttpPath")}
																placeholder="/"
															/>
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
															<Select {...register("xhttpMode")}>
																<option value="">
																	{t("common.default", "Default")}
																</option>
																{XHTTP_MODE_OPTIONS.map((mode) => (
																	<option key={mode} value={mode}>
																		{mode}
																	</option>
																))}
															</Select>
														</FormControl>
														<FormControl>
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
													spacing={4}
													borderWidth="1px"
													borderColor={sectionBorder}
													borderRadius="md"
													p={4}
													mt={2}
												>
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
																	<ChakraSelect {...field}>
																		<option value="">
																			{t("common.none", "None")}
																		</option>
																		{DOMAIN_STRATEGY_OPTIONS.map((option) => (
																			<option key={option} value={option}>
																				{option}
																			</option>
																		))}
																	</ChakraSelect>
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
																	<ChakraSelect {...field}>
																		<option value="">
																			{t("common.none", "None")}
																		</option>
																		{TCP_CONGESTION_OPTIONS.map((option) => (
																			<option key={option} value={option}>
																				{option}
																			</option>
																		))}
																	</ChakraSelect>
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
																	<ChakraSelect {...field}>
																		{TPROXY_OPTIONS.map((option) => (
																			<option key={option} value={option}>
																				{option}
																			</option>
																		))}
																	</ChakraSelect>
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
									{streamSecurity === "tls" && (
										<Stack
											spacing={4}
											borderWidth="1px"
											borderColor={sectionBorder}
											borderRadius="lg"
											p={4}
										>
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
													<Select {...register("tlsCipherSuites")}>
														<option value="">{t("common.auto", "Auto")}</option>
														{tlsCipherOptions.map((option) => (
															<option key={option} value={option}>
																{option}
															</option>
														))}
													</Select>
												</FormControl>
											</SimpleGrid>
											<SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
												<FormControl>
													<FormLabel>
														{t("inbounds.tls.minVersion", "Min version")}
													</FormLabel>
													<Select {...register("tlsMinVersion")}>
														{tlsVersionOptions.map((option) => (
															<option key={option} value={option}>
																{option}
															</option>
														))}
													</Select>
												</FormControl>
												<FormControl>
													<FormLabel>
														{t("inbounds.tls.maxVersion", "Max version")}
													</FormLabel>
													<Select {...register("tlsMaxVersion")}>
														{tlsVersionOptions.map((option) => (
															<option key={option} value={option}>
																{option}
															</option>
														))}
													</Select>
												</FormControl>
											</SimpleGrid>
											<FormControl>
												<FormLabel>
													{t("inbounds.tls.fingerprint", "uTLS fingerprint")}
												</FormLabel>
												<Select {...register("tlsFingerprint")}>
													<option value="">{t("common.none", "None")}</option>
													{tlsFingerprintOptions.map((option) => (
														<option key={option} value={option}>
															{option}
														</option>
													))}
												</Select>
											</FormControl>
											<FormControl>
												<FormLabel>{t("inbounds.tls.alpn", "ALPN")}</FormLabel>
												<Controller
													control={control}
													name="tlsAlpn"
													render={({ field }) => (
														<CheckboxGroup
															value={field.value ?? []}
															onChange={field.onChange}
														>
															<HStack spacing={4} flexWrap="wrap">
																{tlsAlpnOptions.map((option) => (
																	<Checkbox key={option} value={option}>
																		{option}
																	</Checkbox>
																))}
															</HStack>
														</CheckboxGroup>
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
																	<Select
																		{...register(
																			`tlsCertificates.${index}.usage` as const,
																		)}
																	>
																		{tlsUsageOptions.map((option) => (
																			<option key={option} value={option}>
																				{option}
																			</option>
																		))}
																	</Select>
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
													<Select {...register("tlsEchForceQuery")}>
														{tlsEchForceOptions.map((option) => (
															<option key={option} value={option}>
																{option}
															</option>
														))}
													</Select>
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

									{streamSecurity === "reality" && (
										<Stack
											spacing={4}
											borderWidth="1px"
											borderColor={sectionBorder}
											borderRadius="lg"
											p={4}
										>
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
														<NumberInput
															value={field.value ?? ""}
															onChange={(value) => field.onChange(value)}
															min={0}
														>
															<NumberInputField />
														</NumberInput>
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
												<Select {...register("realityFingerprint")}>
													{tlsFingerprintOptions.map((option) => (
														<option key={option} value={option}>
															{option}
														</option>
													))}
												</Select>
											</FormControl>
											<FormControl
												isRequired
												isInvalid={Boolean(errors.realityTarget)}
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
												{errors.realityTarget && (
													<Text fontSize="xs" color="red.500" mt={1}>
														{t("validation.required", "This field is required")}
													</Text>
												)}
											</FormControl>
											<FormControl
												isRequired
												isInvalid={Boolean(errors.realityServerNames)}
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
														"Separate entries with commas or new lines.",
													)}
												</Box>
												{errors.realityServerNames && (
													<Text fontSize="xs" color="red.500" mt={1}>
														{t("validation.required", "This field is required")}
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
														<NumberInput
															value={field.value ?? ""}
															onChange={(value) => field.onChange(value)}
															min={0}
														>
															<NumberInputField />
														</NumberInput>
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
											<FormControl isInvalid={Boolean(errors.realityShortIds)}>
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
												<Textarea rows={2} {...register("realityShortIds")} />
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
														"Separate entries with commas or new lines.",
													)}
												</Box>
												{errors.realityShortIds && (
													<Text fontSize="xs" color="red.500" mt={1}>
														{t("validation.required", "This field is required")}
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
												<Textarea rows={2} {...register("realityPublicKey")} />
											</FormControl>
											<FormControl
												isRequired
												isInvalid={Boolean(errors.realityPrivateKey)}
											>
												<FormLabel>
													{t(
														"inbounds.reality.privateKey",
														"Reality private key",
													)}
												</FormLabel>
												<Textarea
													rows={2}
													{...register("realityPrivateKey", { required: true })}
												/>
												{errors.realityPrivateKey && (
													<Text fontSize="xs" color="red.500" mt={1}>
														{t("validation.required", "This field is required")}
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
												<Textarea
													rows={2}
													{...register("realityMldsa65Seed")}
												/>
											</FormControl>
											<FormControl>
												<FormLabel>
													{t(
														"inbounds.reality.mldsa65Verify",
														"ML-DSA-65 verify",
													)}
												</FormLabel>
												<Textarea
													rows={2}
													{...register("realityMldsa65Verify")}
												/>
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

									{supportsFallback && (
										<Stack
											spacing={3}
											borderWidth="1px"
											borderColor={sectionBorder}
											borderRadius="lg"
											p={4}
										>
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

									<Stack
										spacing={4}
										borderWidth="1px"
										borderColor={sectionBorder}
										borderRadius="lg"
										p={4}
									>
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
											onChange={handleJsonEditorChange}
										/>
									</Box>
								</VStack>
							</TabPanel>
						</TabPanels>
					</Tabs>
				</ModalBody>
				<ModalFooter
					justifyContent={isEditMode && onDelete ? "space-between" : "flex-end"}
				>
					{isEditMode && onDelete && (
						<HStack spacing={3}>
							<Button
								variant="ghost"
								colorScheme="red"
								onClick={onDelete}
								isLoading={isDeleting}
								isDisabled={isSubmitting}
							>
								{t("common.delete", "Delete")}
							</Button>
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
				</ModalFooter>
			</ModalContent>
		</Modal>
	);
};
