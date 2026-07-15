import {
	Accordion,
	AccordionButton,
	AccordionIcon,
	AccordionItem,
	AccordionPanel,
	Box,
	Button,
	chakra,
	FormControl,
	FormLabel,
	HStack,
	IconButton,
	Input,
	Radio,
	RadioGroup,
	Spinner,
	Stack,
	Switch,
	Tag,
	TagCloseButton,
	TagLabel,
	Text,
	Tooltip,
	useBreakpointValue,
	useColorModeValue,
	useDisclosure,
	useToast,
	VStack,
	Wrap,
	WrapItem,
} from "@chakra-ui/react";
import { PanelSelect as Select } from "components/common/PanelSelect";
import {
	PlusIcon as AddIcon,
	AdjustmentsHorizontalIcon,
	ArrowDownIcon,
	ArrowsPointingInIcon,
	ArrowsPointingOutIcon,
	ArrowsRightLeftIcon,
	ArrowUpIcon,
	ArrowUpTrayIcon,
	BoltIcon,
	CloudArrowUpIcon,
	TrashIcon as DeleteIcon,
	DocumentTextIcon,
	PencilIcon as EditIcon,
	GlobeAltIcon,
	ArrowPathIcon as ReloadIcon,
	ScaleIcon,
	WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";
import { CompactChips, CompactTextWithCopy } from "components/CompactPopover";
import {
	DataTable,
	ResourceListCard,
	TabSystem,
	type DataTableBulkAction,
	type DataTableColumn,
	type DataTableRowAction,
} from "components/ui";
import { useCoreSettings } from "contexts/CoreSettingsContext";
import { useDashboard } from "contexts/DashboardContext";
import useGetUser from "hooks/useGetUser";
import {
	type FC,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "react-query";
import { fetch as apiFetch } from "service/http";
import {
	type BalancerFormValues,
	BalancerModal,
} from "../components/BalancerModal";
import { DnsModal } from "../components/DnsModal";
import { DnsPresetsModal } from "../components/DnsPresetsModal";
import { FakeDnsModal } from "../components/FakeDnsModal";
import { JsonEditor } from "../components/JsonEditor";
import { NordVPNModal } from "../components/NordVPNModal";
import { OutboundModal } from "../components/OutboundModal";
import { OutboundSubscriptionsModal } from "../components/OutboundSubscriptionsModal";
import {
	type ReverseFormValues,
	ReverseModal,
	type ReverseType,
} from "../components/ReverseModal";
import { type RoutingRule, RuleModal } from "../components/RuleModal";
import { WarpModal } from "../components/WarpModal";
import { SizeFormatter } from "../utils/outbound";
import { computeOutboundIds } from "../utils/outboundId";
import {
	canonicalizeRebeccaJson,
	stringifyRebeccaJson,
	type RebeccaJsonContext,
} from "../utils/jsonFormatting";
import XrayLogsPage from "./XrayLogsPage";

const AddIconStyled = chakra(AddIcon, { baseStyle: { w: 3.5, h: 3.5 } });
const DeleteIconStyled = chakra(DeleteIcon, { baseStyle: { w: 4, h: 4 } });
const EditIconStyled = chakra(EditIcon, { baseStyle: { w: 4, h: 4 } });
const ArrowUpIconStyled = chakra(ArrowUpIcon, { baseStyle: { w: 4, h: 4 } });
const ArrowDownIconStyled = chakra(ArrowDownIcon, {
	baseStyle: { w: 4, h: 4 },
});
const ReloadIconStyled = chakra(ReloadIcon, { baseStyle: { w: 4, h: 4 } });
const FullScreenIconStyled = chakra(ArrowsPointingOutIcon, {
	baseStyle: { w: 4, h: 4 },
});
const ExitFullScreenIconStyled = chakra(ArrowsPointingInIcon, {
	baseStyle: { w: 4, h: 4 },
});
const BasicTabIcon = chakra(AdjustmentsHorizontalIcon, {
	baseStyle: { w: 4, h: 4 },
});
const RoutingTabIcon = chakra(ArrowsRightLeftIcon, {
	baseStyle: { w: 4, h: 4 },
});
const OutboundTabIcon = chakra(ArrowUpTrayIcon, { baseStyle: { w: 4, h: 4 } });
const BalancerTabIcon = chakra(ScaleIcon, { baseStyle: { w: 4, h: 4 } });
const DnsTabIcon = chakra(GlobeAltIcon, { baseStyle: { w: 4, h: 4 } });
const AdvancedTabIcon = chakra(WrenchScrewdriverIcon, {
	baseStyle: { w: 4, h: 4 },
});
const LogsTabIcon = chakra(DocumentTextIcon, { baseStyle: { w: 4, h: 4 } });
const WarpIconStyled = chakra(CloudArrowUpIcon, { baseStyle: { w: 4, h: 4 } });
const BoltIconStyled = chakra(BoltIcon, { baseStyle: { w: 4, h: 4 } });
const compactActionButtonProps = {
	colorScheme: "primary",
	size: "xs" as const,
	variant: "solid" as const,
	fontSize: "xs",
	px: 3,
	h: 7,
};

const serializeConfig = (value: any) => JSON.stringify(value ?? {});
const normalizeSearchValue = (value: unknown): string => {
	if (Array.isArray(value)) return value.map(normalizeSearchValue).join(" ");
	if (value && typeof value === "object") return JSON.stringify(value);
	return String(value ?? "");
};
const formatOutboundEndpoint = (address: unknown, port?: unknown) => {
	const host = String(address ?? "").trim();
	if (!host) return "";
	const portValue = String(port ?? "").trim();
	return portValue ? `${host}:${portValue}` : host;
};
const DNS_STRATEGY_OPTIONS = ["UseSystem", "UseIP", "UseIPv4", "UseIPv6"];
const isNonEmptyArray = (value: unknown) => Array.isArray(value) && value.length > 0;
const isNonEmptyRecord = (value: unknown) =>
	Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0);
const isDnsConfigEnabled = (dns: unknown, fakeDnsValue: unknown) => {
	if (isNonEmptyArray(fakeDnsValue)) return true;
	if (!dns || typeof dns !== "object" || Array.isArray(dns)) return false;
	const dnsConfig = dns as Record<string, unknown>;
	return isNonEmptyArray(dnsConfig.servers) || isNonEmptyRecord(dnsConfig.hosts);
};
const createDefaultDnsConfig = () => ({
	servers: [] as any[],
	queryStrategy: "UseIP",
	tag: "dns_inbound",
	enableParallelQuery: false,
});
const DEFAULT_OBSERVATORY = {
	subjectSelector: [] as string[],
	probeURL: "http://www.google.com/gen_204",
	probeInterval: "10m",
	enableConcurrency: true,
};
const DEFAULT_BURST_OBSERVATORY = {
	subjectSelector: [] as string[],
	pingConfig: {
		destination: "http://www.google.com/gen_204",
		interval: "30m",
		connectivity: "http://connectivitycheck.platform.hicloud.com/generate_204",
		timeout: "10s",
		sampling: 2,
	},
};

const SERVICES_OPTIONS: { label: string; value: string }[] = [
	{ label: "Apple", value: "geosite:apple" },
	{ label: "Meta", value: "geosite:meta" },
	{ label: "Google", value: "geosite:google" },
	{ label: "OpenAI", value: "geosite:openai" },
	{ label: "Spotify", value: "geosite:spotify" },
	{ label: "Netflix", value: "geosite:netflix" },
	{ label: "Reddit", value: "geosite:reddit" },
	{ label: "Speedtest", value: "geosite:speedtest" },
];

const XRAY_LOG_DIR_HINT = "/var/lib/rebecca/xray-core";
const DEFAULT_ACCESS_LOG_PATH = `${XRAY_LOG_DIR_HINT}/access.log`;
const DEFAULT_ERROR_LOG_PATH = `${XRAY_LOG_DIR_HINT}/error.log`;
const LOG_CLEANUP_INTERVAL_OPTIONS = [
	{ value: 0, labelKey: "pages.xray.logCleanupDisabled", fallback: "Disabled" },
	{
		value: 3600,
		labelKey: "pages.xray.logCleanup1h",
		fallback: "Every 1 hour",
	},
	{
		value: 10800,
		labelKey: "pages.xray.logCleanup3h",
		fallback: "Every 3 hours",
	},
	{
		value: 21600,
		labelKey: "pages.xray.logCleanup6h",
		fallback: "Every 6 hours",
	},
	{
		value: 86400,
		labelKey: "pages.xray.logCleanup24h",
		fallback: "Every 24 hours",
	},
];

type OutboundJson = Record<string, any>;
type OutboundTestType = "latency" | "tcp" | "icmp";
type OutboundTestResult = {
	success: boolean;
	delay?: number;
	error?: string;
	statusCode?: number;
	test_type?: OutboundTestType;
	address?: string;
	port?: number;
	output?: string;
};
type OutboundTestState = {
	testing: boolean;
	result: OutboundTestResult | null;
};
type BalancerConfig = {
	tag: string;
	selector: string[];
	fallbackTag?: string;
	strategy?: { type: string };
};
type BalancerRow = {
	key: number;
	tag: string;
	strategy: string;
	selector: string[];
	fallbackTag: string;
};
type ReverseRow = {
	key: string;
	index: number;
	type: ReverseType;
	tag: string;
	connectionTag: string;
	credentialId: string;
	flow: string;
	targetTag: string;
	inboundTags: string[];
};

type VlessOutboundAccount = {
	address: unknown;
	port: number;
	id: string;
	flow: string;
	encryption: string;
	level?: number;
	email?: string;
	seed?: string;
	testpre?: number;
	testseed?: number[];
};

const stringArray = (value: unknown): string[] =>
	Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: typeof value === "string" && value
			? [value]
			: [];

const readVlessOutboundAccount = (outbound: any): VlessOutboundAccount => {
	const settings = outbound?.settings ?? {};
	if (
		Object.hasOwn(settings, "address") ||
		settings?.reverse
	) {
		return {
			address: settings.address ?? "",
			port: Number(settings.port) || 0,
			id: String(settings.id ?? ""),
			flow: String(settings.flow ?? ""),
			encryption: String(settings.encryption ?? "none"),
			level: settings.level,
			email: settings.email,
			seed: settings.seed,
			testpre: settings.testpre,
			testseed: settings.testseed,
		};
	}
	const server = Array.isArray(settings.vnext) ? settings.vnext[0] : undefined;
	const user = Array.isArray(server?.users) ? server.users[0] : undefined;
	return {
		address: server?.address ?? "",
		port: Number(server?.port) || 0,
		id: String(user?.id ?? ""),
		flow: String(user?.flow ?? ""),
		encryption: String(user?.encryption ?? "none"),
		level: user?.level,
		email: user?.email,
		seed: user?.seed,
		testpre: user?.testpre,
		testseed: user?.testseed,
	};
};

const isPrivateXrayAddress = (value: unknown) => {
	const host = String(value ?? "")
		.trim()
		.toLowerCase()
		.replace(/^\[|\]$/g, "")
		.replace(/\.$/, "");
	const octets = host.split(".").map(Number);
	if (
		octets.length === 4 &&
		octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
	) {
		const [a, b, c] = octets;
		return (
			a === 0 ||
			a === 10 ||
			a === 127 ||
			(a === 100 && b >= 64 && b <= 127) ||
			(a === 169 && b === 254) ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 0 && (c === 0 || c === 2)) ||
			(a === 192 && b === 88 && c === 99) ||
			(a === 192 && b === 168) ||
			(a === 198 && (b === 18 || b === 19)) ||
			(a === 198 && b === 51 && c === 100) ||
			(a === 203 && b === 0 && c === 113) ||
			a >= 224
		);
	}
	if (host.includes(":")) {
		const first = Number.parseInt(host.split(":")[0] || "0", 16);
		return (
			host === "::" ||
			host === "::1" ||
			(first >= 0xfc00 && first <= 0xfdff) ||
			(first >= 0xfe80 && first <= 0xfebf) ||
			(first >= 0xff00 && first <= 0xffff)
		);
	}
	if (!host.includes(".")) {
		return /^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host);
	}
	return [
		"lan",
		"localdomain",
		"example",
		"invalid",
		"localhost",
		"test",
		"local",
		"home.arpa",
		"internal",
	].some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
};

const isSecureVlessConnection = (
	outbound: any,
	account = readVlessOutboundAccount(outbound),
) => {
	const security = String(outbound?.streamSettings?.security ?? "none").toLowerCase();
	return (
		(security !== "" && security !== "none") ||
		(account.encryption !== "" && account.encryption !== "none") ||
		isPrivateXrayAddress(account.address)
	);
};

const buildReverseRows = (config: any): ReverseRow[] => {
	const rows: Omit<ReverseRow, "index">[] = [];
	const rules: RoutingRule[] = Array.isArray(config?.routing?.rules)
		? config.routing.rules
		: [];

	for (const outbound of config?.outbounds ?? []) {
		if (String(outbound?.protocol).toLowerCase() !== "vless") continue;
		const tag = String(outbound?.settings?.reverse?.tag ?? "").trim();
		if (!tag) continue;
		const account = readVlessOutboundAccount(outbound);
		const targetRule = rules.find((rule) => {
			const tags = stringArray(rule.inboundTag);
			return tags.length === 1 && tags[0] === tag;
		});
		rows.push({
			key: `internal-${outbound?.tag ?? "vless"}-${tag}`,
			type: "internal",
			tag,
			connectionTag: String(outbound?.tag ?? ""),
			credentialId: account.id,
			flow: account.flow,
			targetTag: String(targetRule?.outboundTag ?? ""),
			inboundTags: [],
		});
	}

	for (const inbound of config?.inbounds ?? []) {
		if (String(inbound?.protocol).toLowerCase() !== "vless") continue;
		for (const client of inbound?.settings?.clients ?? []) {
			const tag = String(client?.reverse?.tag ?? "").trim();
			if (!tag) continue;
			rows.push({
				key: `public-${inbound?.tag ?? "vless"}-${tag}-${client?.id ?? ""}`,
				type: "public",
				tag,
				connectionTag: String(inbound?.tag ?? ""),
				credentialId: String(client?.id ?? ""),
				flow: String(client?.flow ?? ""),
				targetTag: "",
				inboundTags: Array.from(
					new Set(
						rules
							.filter((rule) => rule.outboundTag === tag)
							.flatMap((rule) => stringArray(rule.inboundTag)),
					),
				),
			});
		}
	}

	return rows.map((row, index) => ({ ...row, index }));
};

const removeReverseFromConfig = (config: any, reverse: ReverseRow) => {
	if (reverse.type === "internal") {
		const outbound = (config.outbounds ?? []).find(
			(item: any) => item?.tag === reverse.connectionTag,
		);
		if (outbound?.settings) delete outbound.settings.reverse;
	} else {
		const inbound = (config.inbounds ?? []).find(
			(item: any) => item?.tag === reverse.connectionTag,
		);
		if (inbound?.settings && Array.isArray(inbound.settings.clients)) {
			inbound.settings.clients = inbound.settings.clients.filter(
				(client: any) =>
					client?.reverse?.tag !== reverse.tag ||
					String(client?.id ?? "") !== reverse.credentialId,
			);
		}
	}

	if (Array.isArray(config?.routing?.rules)) {
		config.routing.rules = config.routing.rules.filter((rule: RoutingRule) => {
			if (reverse.type === "public") return rule.outboundTag !== reverse.tag;
			const tags = stringArray(rule.inboundTag);
			return !(tags.length === 1 && tags[0] === reverse.tag);
		});
	}
	delete config.reverse;
};

// UX credit: the compact Xray settings panels and row action flow are
// intentionally inspired by 3x-ui's Xray settings page.
const SettingsSection: FC<{
	title: string;
	children: ReactNode;
	defaultOpen?: boolean;
}> = ({
	title,
	children,
	defaultOpen = false,
}) => {
	const headerBg = useColorModeValue("gray.50", "whiteAlpha.100");
	const panelBg = useColorModeValue("white", "surface.dark");
	const borderColor = useColorModeValue("gray.200", "whiteAlpha.300");
	return (
		<Accordion allowToggle defaultIndex={defaultOpen ? 0 : undefined} reduceMotion>
			<AccordionItem
				borderWidth="1px"
				borderColor={borderColor}
				borderRadius="md"
				bg={panelBg}
				overflow="hidden"
			>
				<h2>
					<AccordionButton bg={headerBg} px={{ base: 3, md: 4 }} py={2.5}>
						<Box flex="1" textAlign="start">
							<Text fontWeight="semibold" fontSize={{ base: "sm", md: "md" }}>
								{title}
							</Text>
						</Box>
						<AccordionIcon />
					</AccordionButton>
				</h2>
				<AccordionPanel p={0}>
					<VStack align="stretch" spacing={0}>
						{children}
					</VStack>
				</AccordionPanel>
			</AccordionItem>
		</Accordion>
	);
};

const SettingRow: FC<{
	label: ReactNode;
	description?: ReactNode;
	controlId: string;
	children: (controlId: string) => ReactNode;
}> = ({ label, description, controlId, children }) => {
	const labelColor = useColorModeValue("gray.700", "whiteAlpha.800");
	const descriptionColor = useColorModeValue("gray.500", "whiteAlpha.600");
	const dividerColor = useColorModeValue("gray.100", "whiteAlpha.200");
	return (
		<Box
			display="grid"
			gridTemplateColumns={{ base: "1fr", md: "minmax(220px, 32%) 1fr" }}
			gap={{ base: 2, md: 4 }}
			px={{ base: 3, md: 4 }}
			py={3}
			borderTopWidth="1px"
			borderTopColor={dividerColor}
			_first={{ borderTopWidth: 0 }}
			alignItems="center"
		>
			<Box minW={0}>
				<FormLabel
					htmlFor={controlId}
					mb={description ? 1 : 0}
					color={labelColor}
					fontSize="sm"
					fontWeight="semibold"
				>
					{label}
				</FormLabel>
				{description && (
					<Text fontSize="xs" color={descriptionColor} lineHeight="1.45">
						{description}
					</Text>
				)}
			</Box>
			<FormControl id={controlId} w="full">
				{children(controlId)}
			</FormControl>
		</Box>
	);
};

export const CoreSettingsPage: FC = () => {
	const { t, i18n } = useTranslation();
	const isRTL = i18n.dir(i18n.language) === "rtl";
	const {
		fetchCoreSettings,
		updateConfig,
		config,
		configTargets,
		isPostLoading,
		restartCore,
		updateConfigTargetMode,
	} = useCoreSettings();
	const { userData, getUserIsSuccess } = useGetUser();
	const { onEditingCore } = useDashboard();
	const canManageXraySettings =
		getUserIsSuccess && Boolean(userData.permissions?.sections.xray);
	const [selectedTarget, setSelectedTarget] = useState("master");
	const { data: serverIPs } = useQuery(
		["server-ips", selectedTarget],
		() =>
			apiFetch<{ ipv4: string; ipv6: string }>("/core/ips", {
				query: { target: selectedTarget },
			}),
		{
			staleTime: 5 * 60 * 1000, // 5 minutes
			enabled: canManageXraySettings,
		},
	);
	const toast = useToast();
	const {
		isOpen: isOutboundOpen,
		onOpen: onOutboundOpen,
		onClose: onOutboundClose,
	} = useDisclosure();
	const {
		isOpen: isRuleOpen,
		onOpen: onRuleOpen,
		onClose: onRuleClose,
	} = useDisclosure();
	const {
		isOpen: isBalancerOpen,
		onOpen: onBalancerOpen,
		onClose: onBalancerClose,
	} = useDisclosure();
	const {
		isOpen: isReverseOpen,
		onOpen: onReverseOpen,
		onClose: onReverseClose,
	} = useDisclosure();
	const {
		isOpen: isDnsOpen,
		onOpen: onDnsOpen,
		onClose: onDnsClose,
	} = useDisclosure();
	const {
		isOpen: isDnsPresetsOpen,
		onOpen: onDnsPresetsOpen,
		onClose: onDnsPresetsClose,
	} = useDisclosure();
	const {
		isOpen: isFakeDnsOpen,
		onOpen: onFakeDnsOpen,
		onClose: onFakeDnsClose,
	} = useDisclosure();
	const {
		isOpen: isWarpOpen,
		onOpen: onWarpOpen,
		onClose: onWarpClose,
	} = useDisclosure();
	const {
		isOpen: isNordOpen,
		onOpen: onNordOpen,
		onClose: onNordClose,
	} = useDisclosure();
	const {
		isOpen: isOutboundSubsOpen,
		onOpen: onOutboundSubsOpen,
		onClose: onOutboundSubsClose,
	} = useDisclosure();

	const form = useForm({
		defaultValues: {
			config: config || {
				outbounds: [],
				routing: { rules: [], balancers: [] },
				dns: { servers: [] },
			},
		},
	});
	const initialConfigStringRef = useRef(
		serializeConfig(form.getValues("config")),
	);
	const watchedConfig = useWatch({ control: form.control, name: "config" });
	const hasConfigChanges = useMemo(
		() => serializeConfig(watchedConfig) !== initialConfigStringRef.current,
		[watchedConfig],
	);
	const [dnsEnabledState, setDnsEnabledState] = useState(false);
	const dnsEnabled = dnsEnabledState;

	const [outboundData, setOutboundData] = useState<any[]>([]);
	const [outboundSearch, setOutboundSearch] = useState("");
	const [selectedOutboundIds, setSelectedOutboundIds] = useState<string[]>([]);
	const [outboundTestType, setOutboundTestType] =
		useState<OutboundTestType>("latency");
	const [testingAllOutbounds, setTestingAllOutbounds] = useState(false);
	const [routingRuleData, setRoutingRuleData] = useState<any[]>([]);
	const [routingRuleSearch, setRoutingRuleSearch] = useState("");
	const [balancersData, setBalancersData] = useState<BalancerRow[]>([]);
	const [dnsServers, setDnsServers] = useState<any[]>([]);
	const [fakeDns, setFakeDns] = useState<any[]>([]);
	const [outboundsTraffic, setOutboundsTraffic] = useState<any[]>([]);
	const [outboundIds, setOutboundIds] = useState<string[]>([]);
	const [outboundTestStates, setOutboundTestStates] = useState<
		Record<number, OutboundTestState>
	>({});
	const [subscriptionOutbounds, setSubscriptionOutbounds] = useState<
		OutboundJson[]
	>([]);
	const [subscriptionOutboundTestStates, setSubscriptionOutboundTestStates] =
		useState<Record<string, OutboundTestState>>({});
	const [editingRuleIndex, setEditingRuleIndex] = useState<number | null>(null);
	const [editingOutboundIndex, setEditingOutboundIndex] = useState<
		number | null
	>(null);
	const [editingBalancerIndex, setEditingBalancerIndex] = useState<
		number | null
	>(null);
	const [editingReverseIndex, setEditingReverseIndex] = useState<number | null>(
		null,
	);
	const [editingDnsIndex, setEditingDnsIndex] = useState<number | null>(null);
	const [editingFakeDnsIndex, setEditingFakeDnsIndex] = useState<number | null>(
		null,
	);
	const [isFullScreen, setIsFullScreen] = useState(false);
	const [advSettings, setAdvSettings] = useState<string>("xraySetting");
	const [obsSettings, setObsSettings] = useState<string>("");
	const isMobile = useBreakpointValue({ base: true, md: false });
	const [jsonKey, setJsonKey] = useState(0); // force re-render of JsonEditor
	const [advancedJsonValid, setAdvancedJsonValid] = useState(true);
	const [warpOptionValue, setWarpOptionValue] = useState<string>("");
	const [warpCustomDomain, setWarpCustomDomain] = useState<string>("");
	const [activeTab, setActiveTab] = useState<number>(0);
	const [isChangingTargetMode, setIsChangingTargetMode] = useState(false);
	const selectedTargetInfo = useMemo(
		() => configTargets.find((target) => target.id === selectedTarget),
		[configTargets, selectedTarget],
	);
	const isMasterTarget =
		selectedTarget === "master" || selectedTargetInfo?.type === "master";
	const outboundNodeTargetRequiredMessage = t(
		"pages.xray.outbound.testNodeTargetRequired",
		"Change the target to a node before testing this outbound.",
	);
	const outboundAddressRequiredMessage = t(
		"pages.xray.outbound.testAddressRequired",
		"TCP and ICMP tests require an outbound address. Use latency test or configure an address for this outbound.",
	);
	const outboundTestTypeLabels: Record<OutboundTestType, string> = {
		latency: t("pages.xray.outbound.testTypeLatency", "Latency"),
		tcp: t("pages.xray.outbound.testTypeTcp", "TCP"),
		icmp: t("pages.xray.outbound.testTypeIcmp", "ICMP"),
	};
	const outboundTestResultLabel = useCallback(
		(result: OutboundTestResult) => {
			const delayLabel =
				typeof result.delay === "number" && result.delay > 0
					? `${result.delay}ms`
					: "-";
			const targetLabel = result.address
				? result.port
					? `${result.address}:${result.port}`
					: result.address
				: "";
			const statusCodeLabel = result.statusCode
				? ` (${result.statusCode})`
				: "";
			return [delayLabel + statusCodeLabel, targetLabel]
				.filter(Boolean)
				.join(" · ");
		},
		[],
	);
	const hasNodeTargets = useMemo(
		() => configTargets.some((target) => target.type === "node"),
		[configTargets],
	);
	const tabKeys = useMemo(
		() => [
			"basic",
			"routing",
			"outbounds",
			"reverse",
			"balancers",
			"dns",
			"advanced",
			"logs",
		],
		[],
	);
	const splitHash = useCallback(() => {
		const hash = window.location.hash || "";
		const idx = hash.indexOf("#", 1);
		return {
			base: idx >= 0 ? hash.slice(0, idx) : hash,
			tab: idx >= 0 ? hash.slice(idx + 1) : "",
		};
	}, []);

	useEffect(() => {
		const syncFromHash = () => {
			const { tab } = splitHash();
			const idx = tabKeys.indexOf(tab.toLowerCase());
			if (idx >= 0) {
				setActiveTab(idx);
			} else {
				setActiveTab(0);
				const { base } = splitHash();
				window.location.hash = `${base || "#"}#${tabKeys[0]}`;
			}
		};
		syncFromHash();
		window.addEventListener("hashchange", syncFromHash);
		return () => window.removeEventListener("hashchange", syncFromHash);
	}, [splitHash, tabKeys]);

	const pageShellBg = useColorModeValue("white", "surface.dark");
	const pageShellBorder = useColorModeValue("gray.200", "whiteAlpha.300");
	const pageHintColor = useColorModeValue("gray.600", "gray.300");

	const buildOutboundRows = useCallback(
		(outbounds: OutboundJson[]) =>
			outbounds.map((outbound, index) => ({
				key: `${index}-${outbound.tag ?? outbound.protocol ?? "outbound"}`,
				...outbound,
			})),
		[],
	);

	const syncOutboundDisplay = useCallback(
		(outbounds: OutboundJson[]) => {
			setOutboundData(buildOutboundRows(outbounds));
		},
		[buildOutboundRows],
	);

	const getOutbounds = useCallback((): OutboundJson[] => {
		const value = form.getValues("config.outbounds");
		if (!Array.isArray(value)) return [];
		return JSON.parse(JSON.stringify(value));
	}, [form]);

	const commitOutbounds = useCallback(
		(outbounds: OutboundJson[]) => {
			form.setValue("config.outbounds", outbounds, { shouldDirty: true });
			syncOutboundDisplay(outbounds);
			setJsonKey((prev) => prev + 1);
		},
		[form, syncOutboundDisplay],
	);

	const buildRoutingRuleRows = useCallback(
		(rules: RoutingRule[]) =>
			rules.map((rule, index) => ({
				key: `${index}-${rule.outboundTag ?? rule.balancerTag ?? "rule"}`,
				source: rule.source ?? [],
				sourcePort: rule.sourcePort ?? [],
				network: rule.network ?? [],
				protocol: rule.protocol ?? [],
				attrs: rule.attrs ? JSON.stringify(rule.attrs, null, 2) : "",
				ip: rule.ip ?? [],
				domain: rule.domain ?? [],
				port: rule.port ?? [],
				inboundTag: rule.inboundTag ?? [],
				user: rule.user ?? [],
				outboundTag: rule.outboundTag ?? "",
				balancerTag: rule.balancerTag ?? "",
				type: rule.type ?? "field",
				domainMatcher: rule.domainMatcher ?? "",
			})),
		[],
	);

	const buildBalancerRows = useCallback(
		(balancers: BalancerConfig[]) =>
			balancers.map((balancer, index) => ({
				key: index,
				tag: balancer.tag || "",
				strategy:
					typeof balancer.strategy === "string"
						? balancer.strategy
						: balancer.strategy?.type || "random",
				selector: balancer.selector || [],
				fallbackTag: balancer.fallbackTag || "",
			})),
		[],
	);

	const syncRoutingRuleDisplay = useCallback(
		(rules: RoutingRule[]) => {
			setRoutingRuleData(buildRoutingRuleRows(rules));
		},
		[buildRoutingRuleRows],
	);

	const commitRoutingRules = useCallback(
		(rules: RoutingRule[]) => {
			form.setValue("config.routing.rules", rules, { shouldDirty: true });
			syncRoutingRuleDisplay(rules);
			setJsonKey((prev) => prev + 1);
		},
		[form, syncRoutingRuleDisplay],
	);

	const getRoutingRules = useCallback((): RoutingRule[] => {
		const rules = form.getValues("config.routing.rules");
		if (Array.isArray(rules)) {
			return JSON.parse(JSON.stringify(rules));
		}
		return [];
	}, [form]);

	useEffect(() => {
		const handleFullscreenChange = () => {
			setIsFullScreen(Boolean(document.fullscreenElement));
		};

		document.addEventListener("fullscreenchange", handleFullscreenChange);
		return () => {
			document.removeEventListener("fullscreenchange", handleFullscreenChange);
		};
	}, []);

	useEffect(() => {
		if (!configTargets.length) {
			if (selectedTarget !== "master") {
				setSelectedTarget("master");
			}
			return;
		}
		if (!configTargets.some((target) => target.id === selectedTarget)) {
			setSelectedTarget("master");
		}
	}, [configTargets, selectedTarget]);

	useEffect(() => {
		if (!canManageXraySettings) {
			onEditingCore(false);
			return;
		}

		onEditingCore(true);
		fetchCoreSettings(selectedTarget)
			.catch((error) => {
				toast({
					title: t("core.errorFetchingConfig"),
					description: error.message,
					status: "error",
					isClosable: true,
					position: "top",
					duration: 3000,
				});
			});
		return () => onEditingCore(false);
	}, [
		canManageXraySettings,
		fetchCoreSettings,
		onEditingCore,
		selectedTarget,
		toast,
		t,
	]);

	useEffect(() => {
		if (config) {
			form.reset({ config });
			initialConfigStringRef.current = serializeConfig(config);
			syncOutboundDisplay((config?.outbounds as OutboundJson[]) || []);
			syncRoutingRuleDisplay((config?.routing?.rules as RoutingRule[]) || []);
			setBalancersData(
				buildBalancerRows(
					(config?.routing?.balancers as BalancerConfig[]) || [],
				),
			);
			setDnsServers(config?.dns?.servers || []);
			setFakeDns(config?.fakedns || []);
			setDnsEnabledState(isDnsConfigEnabled(config?.dns, config?.fakedns));
			// initialize observatory editor selection if present
			setObsSettings(
				config?.observatory
					? "observatory"
					: config?.burstObservatory
						? "burstObservatory"
						: "",
			);
			setJsonKey((prev) => prev + 1); // force JsonEditor re-mount
		}
	}, [
		buildBalancerRows,
		config,
		form,
		syncOutboundDisplay,
		syncRoutingRuleDisplay,
	]);

	useEffect(() => {
		const hasObservatory = Boolean(watchedConfig?.observatory);
		const hasBurstObservatory = Boolean(watchedConfig?.burstObservatory);
		if (obsSettings === "observatory" && !hasObservatory) {
			setObsSettings(hasBurstObservatory ? "burstObservatory" : "");
			return;
		}
		if (obsSettings === "burstObservatory" && !hasBurstObservatory) {
			setObsSettings(hasObservatory ? "observatory" : "");
			return;
		}
		if (!obsSettings) {
			if (hasObservatory) {
				setObsSettings("observatory");
			} else if (hasBurstObservatory) {
				setObsSettings("burstObservatory");
			}
		}
	}, [
		obsSettings,
		watchedConfig?.observatory,
		watchedConfig?.burstObservatory,
	]);

	const { mutate: handleRestartCore, isLoading: isRestarting } = useMutation(
		restartCore,
		{
			onSuccess: () => {
				toast({
					title: t("core.restartSuccess"),
					status: "success",
					isClosable: true,
					position: "top",
					duration: 3000,
				});
			},
			onError: (e: any) => {
				toast({
					title: t("core.generalErrorMessage"),
					description: e.response?.data?.detail || e.message,
					status: "error",
					isClosable: true,
					position: "top",
					duration: 3000,
				});
			},
		},
	);

	const handleOnSave = form.handleSubmit(({ config: submittedConfig }: any) => {
		const nextConfig = JSON.parse(JSON.stringify(submittedConfig || {}));
		if (!dnsEnabledState) {
			delete nextConfig.dns;
			delete nextConfig.fakedns;
		} else if (!nextConfig.dns) {
			nextConfig.dns = createDefaultDnsConfig();
		}
		updateConfig(nextConfig, selectedTarget)
			.then(() => {
				form.reset({ config: nextConfig });
				initialConfigStringRef.current = serializeConfig(nextConfig);
				setDnsEnabledState(Boolean(nextConfig.dns));
				toast({
					title: t("core.successMessage"),
					status: "success",
					isClosable: true,
					position: "top",
					duration: 3000,
				});
			})
			.catch((e) => {
				let message = t("core.generalErrorMessage");
				if (typeof e.response._data.detail === "object")
					message =
						e.response._data.detail[Object.keys(e.response._data.detail)[0]];
				if (typeof e.response._data.detail === "string")
					message = e.response._data.detail;
				toast({
					title: message,
					status: "error",
					isClosable: true,
					position: "top",
					duration: 3000,
				});
			});
	});

	const handleTargetModeChange = async (checked: boolean) => {
		if (!selectedTargetInfo?.node_id) {
			return;
		}
		setIsChangingTargetMode(true);
		try {
			await updateConfigTargetMode(
				selectedTargetInfo.node_id,
				checked ? "custom" : "default",
			);
			await fetchCoreSettings(selectedTarget);
		} finally {
			setIsChangingTargetMode(false);
		}
	};

	const fetchOutboundsTraffic = useCallback(async () => {
		const response = await apiFetch<{ success: boolean; obj: any }>(
			"/panel/xray/getOutboundsTraffic",
		);
		if (response?.success) {
			setOutboundsTraffic(response.obj);
		}
	}, []);

	const fetchActiveSubscriptionOutbounds = useCallback(async () => {
		const response = await apiFetch<{ success: boolean; obj: OutboundJson[] }>(
			"/panel/xray/outbound-subs/active",
		);
		if (response?.success) {
			setSubscriptionOutbounds(Array.isArray(response.obj) ? response.obj : []);
		}
	}, []);

	const _resetOutboundTraffic = async (
		index: number,
		scope: "target" | "all" = "target",
	) => {
		const payload: Record<string, string | undefined> = {};
		if (index < 0) {
			payload.outbound_id = "-all-";
			payload.tag = "-alltags-";
			if (scope === "target") {
				payload.target_id = selectedTarget;
			}
		} else {
			const outboundId = outboundIds[index];
			if (outboundId) {
				payload.outbound_id = outboundId;
			}
			payload.tag = outboundData[index]?.tag;
			payload.target_id = selectedTarget;
		}
		const cleanedPayload = Object.fromEntries(
			Object.entries(payload).filter(([, value]) => value !== undefined),
		);
		const response = await apiFetch<{ success: boolean }>(
			"/panel/xray/resetOutboundsTraffic",
			{
				method: "POST",
				body: cleanedPayload,
			},
		);
		if (response?.success) {
			await fetchOutboundsTraffic();
		}
	};

	const testOutbound = async (index: number) => {
		const outbounds = getOutbounds();
		const outbound = outbounds[index];
		if (!outbound) {
			toast({
				title: t("pages.xray.outbound.testError", "Unable to test outbound"),
				status: "error",
				isClosable: true,
				position: "top",
				duration: 3000,
			});
			return;
		}

		if (isMasterTarget) {
			toast({
				title: outboundNodeTargetRequiredMessage,
				status: "warning",
				isClosable: true,
				position: "top",
				duration: 4000,
			});
			return;
		}

		const outboundTag = String(outbound.tag ?? "").trim();
		const protocol = String(outbound.protocol ?? "")
			.trim()
			.toLowerCase();
		if (protocol === "blackhole" || outboundTag.toLowerCase() === "blocked") {
			toast({
				title: t(
					"pages.xray.outbound.testBlocked",
					"Blocked/blackhole outbound cannot be tested",
				),
				status: "warning",
				isClosable: true,
				position: "top",
				duration: 3000,
			});
			return;
		}
		if (
			(outboundTestType === "tcp" || outboundTestType === "icmp") &&
			findOutboundAddress(outbound).length === 0
		) {
			toast({
				title: outboundAddressRequiredMessage,
				status: "warning",
				isClosable: true,
				position: "top",
				duration: 4000,
			});
			return;
		}

		setOutboundTestStates((prev) => ({
			...prev,
			[index]: { testing: true, result: null },
		}));

		try {
			const response = await apiFetch<{
				success: boolean;
				obj?: OutboundTestResult;
				msg?: string;
			}>("/panel/xray/testOutbound", {
				method: "POST",
				body: {
					outbound: JSON.stringify(outbound),
					allOutbounds: JSON.stringify(outbounds),
					target_id: selectedTarget,
					test_type: outboundTestType,
				},
			});

			const result = response?.obj;
			if (response?.success && result) {
				setOutboundTestStates((prev) => ({
					...prev,
					[index]: { testing: false, result },
				}));

				if (result.success) {
					toast({
						title: `${t("pages.xray.outbound.testSuccess", "Outbound test successful")}: ${outboundTestResultLabel(result)}`,
						status: "success",
						isClosable: true,
						position: "top",
						duration: 3000,
					});
				} else {
					const errorMessage =
						result.error ||
						t("pages.xray.outbound.testFailed", "Outbound test failed");
					toast({
						title: `${t("pages.xray.outbound.testFailed", "Outbound test failed")}: ${errorMessage}`,
						status: "error",
						isClosable: true,
						position: "top",
						duration: 4000,
					});
				}
				return;
			}

			const message =
				response?.msg ||
				t("pages.xray.outbound.testError", "Unable to test outbound");
			const failureResult: OutboundTestResult = {
				success: false,
				error: message,
			};
			setOutboundTestStates((prev) => ({
				...prev,
				[index]: { testing: false, result: failureResult },
			}));
			toast({
				title: message,
				status: "error",
				isClosable: true,
				position: "top",
				duration: 3000,
			});
		} catch (error: any) {
			const detail =
				error?.response?._data?.detail ??
				error?.data?.detail ??
				error?.message ??
				t("pages.xray.outbound.testError", "Unable to test outbound");
			const detailText =
				typeof detail === "string"
					? detail
					: JSON.stringify(detail ?? "Unknown error");

			setOutboundTestStates((prev) => ({
				...prev,
				[index]: {
					testing: false,
					result: {
						success: false,
						error: detailText,
					},
				},
			}));
			toast({
				title: `${t("pages.xray.outbound.testError", "Unable to test outbound")}: ${detailText}`,
				status: "error",
				isClosable: true,
				position: "top",
				duration: 4000,
			});
		}
	};

	const handleOutboundModalClose = () => {
		setEditingOutboundIndex(null);
		onOutboundClose();
	};

	const addOutbound = () => {
		setEditingOutboundIndex(null);
		onOutboundOpen();
	};

	const editOutbound = (index: number) => {
		setEditingOutboundIndex(index);
		onOutboundOpen();
	};

	const deleteOutbound = (index: number) => {
		const outbounds = getOutbounds();
		if (index < 0 || index >= outbounds.length) return;
		outbounds.splice(index, 1);
		commitOutbounds(outbounds);
		setSelectedOutboundIds((current) =>
			current.filter((id) => Number(id) !== index),
		);
	};

	const deleteSelectedOutbounds = (ids: string[]) => {
		const indexes = ids
			.map((id) => Number(id))
			.filter((index) => Number.isInteger(index) && index >= 0)
			.sort((a, b) => b - a);
		if (!indexes.length) return;
		const outbounds = getOutbounds();
		for (const index of indexes) {
			if (index >= 0 && index < outbounds.length) {
				outbounds.splice(index, 1);
			}
		}
		commitOutbounds(outbounds);
		setSelectedOutboundIds([]);
	};

	const moveOutbound = (fromIndex: number, toIndex: number) => {
		const outbounds = getOutbounds();
		if (
			fromIndex < 0 ||
			fromIndex >= outbounds.length ||
			toIndex < 0 ||
			toIndex >= outbounds.length
		) {
			return;
		}
		const [moved] = outbounds.splice(fromIndex, 1);
		outbounds.splice(toIndex, 0, moved);
		commitOutbounds(outbounds);
	};

	const moveOutboundUp = (index: number) => {
		moveOutbound(index, index - 1);
	};

	const moveOutboundDown = (index: number) => {
		moveOutbound(index, index + 1);
	};

	const filteredRoutingRules = useMemo(() => {
		const term = routingRuleSearch.trim().toLowerCase();
		const rows = routingRuleData.map((rule, originalIndex) => ({
			rule,
			originalIndex,
		}));
		if (!term) return rows;
		return rows.filter(({ rule }) => {
			const haystack = [
				rule.source,
				rule.sourcePort,
				rule.network,
				rule.protocol,
				rule.attrs,
				rule.ip,
				rule.domain,
				rule.port,
				rule.inboundTag,
				rule.user,
				rule.outboundTag,
				rule.balancerTag,
			]
				.map(normalizeSearchValue)
				.join(" ")
				.toLowerCase();
			return haystack.includes(term);
		});
	}, [routingRuleData, routingRuleSearch]);

	const filteredOutboundData = useMemo(() => {
		const term = outboundSearch.trim().toLowerCase();
		const rows = outboundData.map((outbound, originalIndex) => ({
			outbound,
			originalIndex,
		}));
		if (!term) return rows;
		return rows.filter(({ outbound }) =>
			JSON.stringify(outbound).toLowerCase().includes(term),
		);
	}, [outboundData, outboundSearch]);

	const addRule = () => {
		setEditingRuleIndex(null);
		onRuleOpen();
	};

	const editRule = (index: number) => {
		setEditingRuleIndex(index);
		onRuleOpen();
	};

	const deleteRule = (index: number) => {
		const currentRules = getRoutingRules();
		currentRules.splice(index, 1);
		commitRoutingRules(currentRules);
	};

	const replaceRule = (oldIndex: number, newIndex: number) => {
		const currentRules = getRoutingRules();
		if (
			oldIndex < 0 ||
			oldIndex >= currentRules.length ||
			newIndex < 0 ||
			newIndex >= currentRules.length
		) {
			return;
		}
		const [moved] = currentRules.splice(oldIndex, 1);
		currentRules.splice(newIndex, 0, moved);
		commitRoutingRules(currentRules);
	};

	const handleRuleModalSubmit = (rule: RoutingRule) => {
		const currentRules = getRoutingRules();
		if (
			editingRuleIndex !== null &&
			editingRuleIndex >= 0 &&
			editingRuleIndex < currentRules.length
		) {
			currentRules[editingRuleIndex] = rule;
		} else {
			currentRules.push(rule);
		}
		commitRoutingRules(currentRules);
		setEditingRuleIndex(null);
	};

	const handleRuleModalClose = () => {
		setEditingRuleIndex(null);
		onRuleClose();
	};

	const getBalancers = useCallback((): BalancerConfig[] => {
		const balancers = form.getValues("config.routing.balancers");
		if (Array.isArray(balancers)) {
			return JSON.parse(JSON.stringify(balancers));
		}
		return [];
	}, [form]);

	const applyObservatorySelectors = useCallback(
		(cfg: any, balancers: BalancerConfig[]) => {
			const nextConfig = { ...cfg };
			const getStrategy = (balancer: BalancerConfig) => {
				if (typeof balancer.strategy === "string") {
					return balancer.strategy;
				}
				return balancer.strategy?.type || "random";
			};
			const collectSelectors = (items: BalancerConfig[]) => {
				const selectorSet = new Set<string>();
				items.forEach((balancer) => {
					(balancer.selector || []).forEach((selector) => {
						if (selector) selectorSet.add(selector);
					});
				});
				return Array.from(selectorSet);
			};
			const leastPings = balancers.filter(
				(balancer) => getStrategy(balancer) === "leastPing",
			);
			const leastLoads = balancers.filter((balancer) =>
				["leastLoad", "roundRobin", "random"].includes(getStrategy(balancer)),
			);

			if (leastPings.length > 0) {
				const observatory = nextConfig.observatory
					? { ...nextConfig.observatory }
					: { ...DEFAULT_OBSERVATORY };
				observatory.subjectSelector = collectSelectors(leastPings);
				nextConfig.observatory = observatory;
			} else {
				delete nextConfig.observatory;
			}

			if (leastLoads.length > 0) {
				const burstObservatory = nextConfig.burstObservatory
					? { ...nextConfig.burstObservatory }
					: { ...DEFAULT_BURST_OBSERVATORY };
				burstObservatory.subjectSelector = collectSelectors(leastLoads);
				nextConfig.burstObservatory = burstObservatory;
			} else {
				delete nextConfig.burstObservatory;
			}

			return nextConfig;
		},
		[],
	);

	const normalizeBalancerConfig = useCallback((balancer: BalancerConfig) => {
		const strategyType =
			typeof balancer.strategy === "string"
				? balancer.strategy
				: balancer.strategy?.type;
		const normalized: BalancerConfig = {
			tag: balancer.tag ?? "",
			selector: balancer.selector ?? [],
			fallbackTag: balancer.fallbackTag ?? "",
		};
		if (strategyType && strategyType !== "random") {
			normalized.strategy = { type: strategyType };
		}
		return normalized;
	}, []);

	const commitBalancers = useCallback(
		(
			balancers: BalancerConfig[],
			options?: { oldTag?: string; newTag?: string },
		) => {
			const normalizedBalancers = balancers.map(normalizeBalancerConfig);
			const cfg = { ...(form.getValues("config") || {}) };
			if (!cfg.routing) cfg.routing = {};
			if (normalizedBalancers.length > 0) {
				cfg.routing.balancers = normalizedBalancers;
			} else {
				delete cfg.routing.balancers;
			}
			let updatedRules: RoutingRule[] | undefined;
			if (
				options?.oldTag &&
				options?.newTag &&
				options.oldTag !== options.newTag
			) {
				updatedRules = (cfg.routing.rules || []).map((rule: any) => {
					if (rule?.balancerTag === options.oldTag) {
						return { ...rule, balancerTag: options.newTag };
					}
					return rule;
				});
				cfg.routing.rules = updatedRules;
			}
			const updatedConfig = applyObservatorySelectors(cfg, normalizedBalancers);
			form.setValue("config", updatedConfig, { shouldDirty: true });
			setBalancersData(buildBalancerRows(normalizedBalancers));
			if (updatedRules) {
				syncRoutingRuleDisplay(updatedRules);
			}
			setJsonKey((prev) => prev + 1);
		},
		[
			applyObservatorySelectors,
			buildBalancerRows,
			form,
			normalizeBalancerConfig,
			syncRoutingRuleDisplay,
		],
	);

	const toBalancerConfig = useCallback(
		(values: BalancerFormValues): BalancerConfig => {
			const base: BalancerConfig = {
				tag: values.tag.trim(),
				selector: values.selector.map((item) => item.trim()).filter(Boolean),
				fallbackTag: values.fallbackTag ?? "",
			};
			if (values.strategy && values.strategy !== "random") {
				base.strategy = { type: values.strategy };
			}
			return base;
		},
		[],
	);

	const handleBalancerSubmit = (values: BalancerFormValues) => {
		const balancers = getBalancers();
		const nextBalancer = toBalancerConfig(values);
		let oldTag: string | undefined;
		if (
			editingBalancerIndex !== null &&
			editingBalancerIndex >= 0 &&
			editingBalancerIndex < balancers.length
		) {
			oldTag = balancers[editingBalancerIndex]?.tag;
			balancers[editingBalancerIndex] = nextBalancer;
		} else {
			balancers.push(nextBalancer);
		}
		commitBalancers(balancers, { oldTag, newTag: nextBalancer.tag });
		setEditingBalancerIndex(null);
		onBalancerClose();
	};

	const addBalancer = () => {
		setEditingBalancerIndex(null);
		onBalancerOpen();
	};

	const editBalancer = (index: number) => {
		setEditingBalancerIndex(index);
		onBalancerOpen();
	};

	const handleBalancerModalClose = () => {
		setEditingBalancerIndex(null);
		onBalancerClose();
	};

	const deleteBalancer = (index: number) => {
		const balancers = getBalancers();
		if (index < 0 || index >= balancers.length) return;
		balancers.splice(index, 1);
		commitBalancers(balancers);
	};

	const addReverse = () => {
		setEditingReverseIndex(null);
		onReverseOpen();
	};

	const editReverse = (index: number) => {
		setEditingReverseIndex(index);
		onReverseOpen();
	};

	const handleReverseModalClose = () => {
		setEditingReverseIndex(null);
		onReverseClose();
	};

	const handleReverseSubmit = (reverse: ReverseFormValues) => {
		const cfg = JSON.parse(JSON.stringify(form.getValues("config") || {}));
		if (!cfg.routing) cfg.routing = {};
		if (!Array.isArray(cfg.routing.rules)) cfg.routing.rules = [];

		const oldReverse =
			editingReverseIndex !== null ? reverseData[editingReverseIndex] : null;
		let previousPublicClient: any;
		let previousReverseSettings: Record<string, unknown> = {};
		if (oldReverse?.type === "internal") {
			const oldOutbound = (cfg.outbounds ?? []).find(
				(item: any) => item?.tag === oldReverse.connectionTag,
			);
			previousReverseSettings = oldOutbound?.settings?.reverse ?? {};
		} else if (oldReverse?.type === "public") {
			const oldInbound = (cfg.inbounds ?? []).find(
				(item: any) => item?.tag === oldReverse.connectionTag,
			);
			previousPublicClient = (oldInbound?.settings?.clients ?? []).find(
				(client: any) =>
					client?.reverse?.tag === oldReverse.tag &&
					String(client?.id ?? "") === oldReverse.credentialId,
			);
			previousReverseSettings = previousPublicClient?.reverse ?? {};
		}
		const oldRuleIndex = oldReverse
			? cfg.routing.rules.findIndex((rule: RoutingRule) => {
					if (oldReverse.type === "public") {
						return rule.outboundTag === oldReverse.tag;
					}
					const tags = stringArray(rule.inboundTag);
					return tags.length === 1 && tags[0] === oldReverse.tag;
				})
			: -1;
		if (oldReverse) removeReverseFromConfig(cfg, oldReverse);

		let nextRule: RoutingRule;
		if (reverse.type === "internal") {
			const outbound = (cfg.outbounds ?? []).find(
				(item: any) =>
					item?.tag === reverse.interconnectionOutboundTag &&
					String(item?.protocol).toLowerCase() === "vless",
			);
			const account = readVlessOutboundAccount(outbound);
			if (!outbound || !account.address || !account.port || !account.id) {
				toast({
					title: t(
						"pages.xray.reverse.vlessOutboundInvalid",
						"The VLESS connection is incomplete",
					),
					status: "error",
					isClosable: true,
					position: "top",
					duration: 4000,
				});
				return;
			}
			if (!isSecureVlessConnection(outbound, account)) {
				toast({
					title: t(
						"pages.xray.reverse.transportSecurityRequired",
						"Public VLESS connections require TLS or VLESS Encryption",
					),
					status: "error",
					isClosable: true,
					position: "top",
					duration: 5000,
				});
				return;
			}
			outbound.settings = {
				address: account.address,
				port: account.port,
				id: account.id,
				encryption: account.encryption || "none",
				flow: account.flow || undefined,
				level: account.level || undefined,
				email: account.email || undefined,
				seed: account.seed || undefined,
				testpre: account.testpre || undefined,
				testseed: account.testseed?.length ? account.testseed : undefined,
				reverse: { ...previousReverseSettings, tag: reverse.tag },
			};
			nextRule = {
				type: "field",
				inboundTag: [reverse.tag],
				outboundTag: reverse.outboundTag,
			};
		} else {
			const inbound = (cfg.inbounds ?? []).find(
				(item: any) =>
					item?.tag === reverse.interconnectionInboundTag &&
					String(item?.protocol).toLowerCase() === "vless",
			);
			if (!inbound) {
				toast({
					title: t(
						"pages.xray.reverse.vlessInboundInvalid",
						"The VLESS connection is unavailable",
					),
					status: "error",
					isClosable: true,
					position: "top",
					duration: 4000,
				});
				return;
			}
			if (!inbound.settings) inbound.settings = {};
			if (!Array.isArray(inbound.settings.clients)) {
				inbound.settings.clients = [];
			}
			inbound.settings.clients.push({
				...previousPublicClient,
				id: reverse.credentialId,
				email: previousPublicClient?.email || `reverse.${reverse.tag}`,
				flow: reverse.flow || undefined,
				reverse: { ...previousReverseSettings, tag: reverse.tag },
			});
			nextRule = {
				type: "field",
				inboundTag: reverse.inboundTags,
				outboundTag: reverse.tag,
			};
		}

		const insertAt =
			oldRuleIndex >= 0
				? Math.min(oldRuleIndex, cfg.routing.rules.length)
				: cfg.routing.rules.length;
		cfg.routing.rules.splice(insertAt, 0, nextRule);
		delete cfg.reverse;
		form.setValue("config", cfg, { shouldDirty: true });
		syncRoutingRuleDisplay(cfg.routing.rules);
		setJsonKey((prev) => prev + 1);
		handleReverseModalClose();
	};

	const deleteReverse = (index: number) => {
		const reverse = reverseData[index];
		if (!reverse) return;
		const cfg = JSON.parse(JSON.stringify(form.getValues("config") || {}));
		if (!cfg.routing) cfg.routing = {};
		if (!Array.isArray(cfg.routing.rules)) cfg.routing.rules = [];
		removeReverseFromConfig(cfg, reverse);
		form.setValue("config", cfg, { shouldDirty: true });
		syncRoutingRuleDisplay(cfg.routing.rules);
		setJsonKey((prev) => prev + 1);
	};

	const addDnsServer = () => {
		setEditingDnsIndex(null);
		onDnsOpen();
	};

	const editDnsServer = (index: number) => {
		setEditingDnsIndex(index);
		onDnsOpen();
	};

	const handleDnsModalClose = () => {
		setEditingDnsIndex(null);
		onDnsClose();
	};

	const deleteDnsServer = (index: number) => {
		const newDnsServers = [...dnsServers];
		newDnsServers.splice(index, 1);
		form.setValue("config.dns.servers", newDnsServers, { shouldDirty: true });
		setDnsServers(newDnsServers);
	};

	const applyDnsPreset = (servers: string[]) => {
		const currentConfig = form.getValues("config");
		const nextConfig = { ...currentConfig };
		const dnsConfig = nextConfig.dns
			? { ...nextConfig.dns }
			: createDefaultDnsConfig();
		dnsConfig.servers = [...servers];
		nextConfig.dns = dnsConfig;
		form.setValue("config", nextConfig, { shouldDirty: true });
		setDnsServers(dnsConfig.servers);
		setDnsEnabledState(true);
	};

	const addFakeDns = () => {
		setEditingFakeDnsIndex(null);
		onFakeDnsOpen();
	};

	const editFakeDns = (index: number) => {
		setEditingFakeDnsIndex(index);
		onFakeDnsOpen();
	};

	const handleFakeDnsModalClose = () => {
		setEditingFakeDnsIndex(null);
		onFakeDnsClose();
	};

	const deleteFakeDns = (index: number) => {
		const newFakeDns = [...fakeDns];
		newFakeDns.splice(index, 1);
		form.setValue("config.fakedns", newFakeDns.length > 0 ? newFakeDns : null, {
			shouldDirty: true,
		});
		setFakeDns(newFakeDns);
	};

	const findOutboundAddress = (outbound: any) => {
			switch (outbound.protocol) {
			case "vmess":
				return (
					outbound.settings.vnext?.map(
						(obj: any) => formatOutboundEndpoint(obj.address, obj.port),
					) || []
				).filter(Boolean);
			case "vless":
				if (outbound.settings?.address) {
					return [
						formatOutboundEndpoint(
							outbound.settings.address,
							outbound.settings.port,
						),
					].filter(Boolean);
				}
				return (
					outbound.settings.vnext?.map(
						(obj: any) => formatOutboundEndpoint(obj.address, obj.port),
					) || []
				).filter(Boolean);
			case "http":
			case "socks":
			case "shadowsocks":
			case "trojan":
				return (
					outbound.settings.servers?.map(
						(obj: any) => formatOutboundEndpoint(obj.address, obj.port),
					) || []
				).filter(Boolean);
			case "dns":
				return [
					formatOutboundEndpoint(
						outbound.settings?.address,
						outbound.settings?.port,
					),
				].filter(Boolean);
			case "wireguard":
				return (
					outbound.settings.peers?.map((peer: any) =>
						String(peer.endpoint ?? "").trim(),
					) || []
				).filter(Boolean);
			default:
				return [];
		}
	};

	const testSubscriptionOutbound = async (outbound: OutboundJson, index: number) => {
		const stateKey = String(outbound.tag ?? `subscription-${index}`);
		if (!outbound) return;
		if (isMasterTarget) {
			toast({
				title: outboundNodeTargetRequiredMessage,
				status: "warning",
				isClosable: true,
				position: "top",
				duration: 4000,
			});
			return;
		}
		const outboundTag = String(outbound.tag ?? "").trim();
		const protocol = String(outbound.protocol ?? "")
			.trim()
			.toLowerCase();
		if (protocol === "blackhole" || outboundTag.toLowerCase() === "blocked") {
			toast({
				title: t(
					"pages.xray.outbound.testBlocked",
					"Blocked/blackhole outbound cannot be tested",
				),
				status: "warning",
				isClosable: true,
				position: "top",
				duration: 3000,
			});
			return;
		}
		if (
			(outboundTestType === "tcp" || outboundTestType === "icmp") &&
			findOutboundAddress(outbound).length === 0
		) {
			toast({
				title: outboundAddressRequiredMessage,
				status: "warning",
				isClosable: true,
				position: "top",
				duration: 4000,
			});
			return;
		}
		setSubscriptionOutboundTestStates((prev) => ({
			...prev,
			[stateKey]: { testing: true, result: null },
		}));
		try {
			const allOutbounds = [...getOutbounds(), ...subscriptionOutbounds];
			const response = await apiFetch<{
				success: boolean;
				obj?: OutboundTestResult;
				msg?: string;
			}>("/panel/xray/testOutbound", {
				method: "POST",
				body: {
					outbound: JSON.stringify(outbound),
					allOutbounds: JSON.stringify(allOutbounds),
					target_id: selectedTarget,
					test_type: outboundTestType,
				},
			});
			const result = response?.obj;
			if (response?.success && result) {
				setSubscriptionOutboundTestStates((prev) => ({
					...prev,
					[stateKey]: { testing: false, result },
				}));
				return;
			}
			setSubscriptionOutboundTestStates((prev) => ({
				...prev,
				[stateKey]: {
					testing: false,
					result: {
						success: false,
						error:
							response?.msg ||
							t("pages.xray.outbound.testError", "Unable to test outbound"),
					},
				},
			}));
		} catch (error: any) {
			const detail =
				error?.response?._data?.detail ??
				error?.data?.detail ??
				error?.message ??
				t("pages.xray.outbound.testError", "Unable to test outbound");
			setSubscriptionOutboundTestStates((prev) => ({
				...prev,
				[stateKey]: {
					testing: false,
					result: {
						success: false,
						error:
							typeof detail === "string"
								? detail
								: JSON.stringify(detail ?? "Unknown error"),
					},
				},
			}));
		}
	};

	const testAllOutbounds = async () => {
		if (testingAllOutbounds) return;
		if (isMasterTarget) {
			toast({
				title: outboundNodeTargetRequiredMessage,
				status: "warning",
				isClosable: true,
				position: "top",
				duration: 4000,
			});
			return;
		}
		type TestItem =
			| { kind: "template"; index: number; outbound: OutboundJson }
			| { kind: "subscription"; index: number; stateKey: string; outbound: OutboundJson };
		const templateItems = getOutbounds().map((outbound, index) => ({
			kind: "template" as const,
			index,
			outbound,
		}));
		const subscriptionItems = subscriptionOutbounds.map((outbound, index) => ({
			kind: "subscription" as const,
			index,
			stateKey: String(outbound.tag ?? `subscription-${index}`),
			outbound,
		}));
		const items: TestItem[] = [...templateItems, ...subscriptionItems].filter(
			(item) => {
				const tag = String(item.outbound.tag ?? "").trim().toLowerCase();
				const protocol = String(item.outbound.protocol ?? "").trim().toLowerCase();
				if (protocol === "blackhole" || tag === "blocked") return false;
				if (
					(outboundTestType === "tcp" || outboundTestType === "icmp") &&
					findOutboundAddress(item.outbound).length === 0
				) {
					return false;
				}
				return true;
			},
		);
		if (items.length === 0) {
			toast({
				title:
					outboundTestType === "tcp" || outboundTestType === "icmp"
						? outboundAddressRequiredMessage
						: t("pages.xray.outbound.testNothing", "No outbound can be tested"),
				status: "warning",
				isClosable: true,
				position: "top",
				duration: 4000,
			});
			return;
		}
		setTestingAllOutbounds(true);
		setOutboundTestStates((prev) => {
			const next = { ...prev };
			for (const item of items) {
				if (item.kind === "template") {
					next[item.index] = { testing: true, result: null };
				}
			}
			return next;
		});
		setSubscriptionOutboundTestStates((prev) => {
			const next = { ...prev };
			for (const item of items) {
				if (item.kind === "subscription") {
					next[item.stateKey] = { testing: true, result: null };
				}
			}
			return next;
		});
		try {
			const allOutbounds = [...getOutbounds(), ...subscriptionOutbounds];
			const response = await apiFetch<{
				success: boolean;
				obj?: OutboundTestResult[];
				msg?: string;
			}>("/panel/xray/testOutbounds", {
				method: "POST",
				body: {
					outbounds: JSON.stringify(items.map((item) => item.outbound)),
					allOutbounds: JSON.stringify(allOutbounds),
					target_id: selectedTarget,
					test_type: outboundTestType,
				},
			});
			const results = Array.isArray(response?.obj) ? response.obj : [];
			setOutboundTestStates((prev) => {
				const next = { ...prev };
				items.forEach((item, index) => {
					if (item.kind === "template") {
						next[item.index] = {
							testing: false,
							result: results[index] ?? {
								success: false,
								error: response?.msg || t("pages.xray.outbound.testError", "Unable to test outbound"),
							},
						};
					}
				});
				return next;
			});
			setSubscriptionOutboundTestStates((prev) => {
				const next = { ...prev };
				items.forEach((item, index) => {
					if (item.kind === "subscription") {
						next[item.stateKey] = {
							testing: false,
							result: results[index] ?? {
								success: false,
								error: response?.msg || t("pages.xray.outbound.testError", "Unable to test outbound"),
							},
						};
					}
				});
				return next;
			});
		} catch (error: any) {
			const detail =
				error?.response?._data?.detail ??
				error?.data?.detail ??
				error?.message ??
				t("pages.xray.outbound.testError", "Unable to test outbound");
			const detailText =
				typeof detail === "string"
					? detail
					: JSON.stringify(detail ?? "Unknown error");
			const failure: OutboundTestResult = { success: false, error: detailText };
			setOutboundTestStates((prev) => {
				const next = { ...prev };
				for (const item of items) {
					if (item.kind === "template") {
						next[item.index] = { testing: false, result: failure };
					}
				}
				return next;
			});
			setSubscriptionOutboundTestStates((prev) => {
				const next = { ...prev };
				for (const item of items) {
					if (item.kind === "subscription") {
						next[item.stateKey] = { testing: false, result: failure };
					}
				}
				return next;
			});
			toast({
				title: `${t("pages.xray.outbound.testError", "Unable to test outbound")}: ${detailText}`,
				status: "error",
				isClosable: true,
				position: "top",
				duration: 4000,
			});
		} finally {
			setTestingAllOutbounds(false);
		}
	};

	const findOutboundTraffic = (outbound: any, index: number) => {
		const outboundId = outboundIds[index];
		const targetTraffic = outboundsTraffic.filter(
			(t) => (t.target_id || "master") === selectedTarget,
		);
		const traffic = outboundId
			? targetTraffic.find((t) => t.outbound_id === outboundId)
			: targetTraffic.find((t) => t.tag === outbound.tag);
		return traffic
			? `${SizeFormatter.sizeFormat(traffic.up)} / ${SizeFormatter.sizeFormat(traffic.down)}`
			: `${SizeFormatter.sizeFormat(0)} / ${SizeFormatter.sizeFormat(0)}`;
	};

	const canonicalOutbounds = useMemo<OutboundJson[]>(
		() =>
			Array.isArray(watchedConfig?.outbounds)
				? (watchedConfig.outbounds as OutboundJson[])
				: [],
		[watchedConfig],
	);

	useEffect(() => {
		let cancelled = false;
		const resolveIds = async () => {
			try {
				const ids = await computeOutboundIds(canonicalOutbounds);
				if (!cancelled) {
					setOutboundIds(ids);
				}
			} catch {
				if (!cancelled) {
					setOutboundIds(Array(canonicalOutbounds.length).fill(""));
				}
			}
		};
		resolveIds();
		return () => {
			cancelled = true;
		};
	}, [canonicalOutbounds]);

	const outboundIdsKey = useMemo(() => outboundIds.join("|"), [outboundIds]);

	useEffect(() => {
		void outboundIdsKey;
		setOutboundTestStates({});
	}, [outboundIdsKey]);

	useEffect(() => {
		let active = true;
		if (!canManageXraySettings) return;
		fetchOutboundsTraffic().catch(() => {
			if (active) setOutboundsTraffic([]);
		});
		fetchActiveSubscriptionOutbounds().catch(() => {
			if (active) setSubscriptionOutbounds([]);
		});
		return () => {
			active = false;
		};
	}, [
		canManageXraySettings,
		fetchActiveSubscriptionOutbounds,
		fetchOutboundsTraffic,
	]);

	const canonicalRoutingRules = useMemo<RoutingRule[]>(
		() =>
			Array.isArray(watchedConfig?.routing?.rules)
				? (watchedConfig.routing.rules as RoutingRule[])
				: [],
		[watchedConfig],
	);

	const availableInboundTags = useMemo<string[]>(
		() =>
			Array.from(
				new Set(
					(watchedConfig?.inbounds ?? [])
						.filter((inbound: any) => {
							const protocol = String(inbound?.protocol ?? "")
								.toLowerCase()
								.trim();
							if (
								!["openvpn", "wireguard", "l2tp", "pptp"].includes(protocol)
							) {
								return true;
							}
							const rawTproxy = inbound?.settings?.tproxy_enabled;
							return !(
								rawTproxy === false ||
								String(rawTproxy ?? "").toLowerCase().trim() === "false"
							);
						})
						.map((inbound: any) => inbound?.tag)
						.filter((tag: string | undefined): tag is string => Boolean(tag)),
				),
			),
		[watchedConfig],
	);

	const availableOutboundTags = useMemo<string[]>(
		() =>
			Array.from(
				new Set(
					canonicalOutbounds
						.concat(subscriptionOutbounds)
						.map((outbound: any) => outbound?.tag)
						.filter((tag: string | undefined): tag is string => Boolean(tag)),
				),
			),
		[canonicalOutbounds, subscriptionOutbounds],
	);

	const excludedBalancerOutboundTags = useMemo<string[]>(
		() =>
			Array.from(
				new Set(
					canonicalOutbounds
						.filter((outbound: any) => {
							const protocol = String(outbound?.protocol ?? "")
								.toLowerCase()
								.trim();
							const tag = String(outbound?.tag ?? "").toLowerCase().trim();
							return protocol === "blackhole" || tag === "blocked";
						})
						.map((outbound: any) => outbound?.tag)
						.filter((tag: string | undefined): tag is string => Boolean(tag)),
				),
			),
		[canonicalOutbounds],
	);

	const availableBalancerTags = useMemo<string[]>(
		() =>
			Array.from(
				new Set(
					(watchedConfig?.routing?.balancers ?? [])
						.map((balancer: any) => balancer?.tag)
						.filter((tag: string | undefined): tag is string => Boolean(tag)),
				),
			),
		[watchedConfig],
	);

	const reverseData = useMemo<ReverseRow[]>(
		() => buildReverseRows(watchedConfig),
		[watchedConfig],
	);

	const editingReverseRow =
		editingReverseIndex !== null ? reverseData[editingReverseIndex] : null;

	const editingReverseInitial = useMemo<ReverseFormValues | null>(() => {
		if (!editingReverseRow) return null;
		return {
			type: editingReverseRow.type,
			tag: editingReverseRow.tag,
			credentialId: editingReverseRow.credentialId,
			flow: editingReverseRow.flow,
			interconnectionOutboundTag:
				editingReverseRow.type === "internal"
					? editingReverseRow.connectionTag
					: "",
			outboundTag: editingReverseRow.targetTag,
			interconnectionInboundTag:
				editingReverseRow.type === "public"
					? editingReverseRow.connectionTag
					: "",
			inboundTags: editingReverseRow.inboundTags,
		};
	}, [editingReverseRow]);

	const vlessInboundTags = useMemo(
		() =>
			(watchedConfig?.inbounds ?? [])
				.filter(
					(inbound: any) =>
						String(inbound?.protocol).toLowerCase() === "vless" && inbound?.tag,
				)
				.map((inbound: any) => String(inbound.tag)),
		[watchedConfig],
	);

	const vlessOutboundTags = useMemo(
		() =>
			canonicalOutbounds
				.filter((outbound: any) => {
					if (String(outbound?.protocol).toLowerCase() !== "vless") return false;
					const account = readVlessOutboundAccount(outbound);
					const reverseTag = String(outbound?.settings?.reverse?.tag ?? "");
					return (
						Boolean(outbound?.tag && account.address && account.port && account.id) &&
						isSecureVlessConnection(outbound, account) &&
						(!reverseTag || outbound?.tag === editingReverseRow?.connectionTag)
					);
				})
				.map((outbound: any) => String(outbound.tag)),
		[canonicalOutbounds, editingReverseRow?.connectionTag],
	);

	const existingReverseTags = useMemo(
		() =>
			Array.from(
				new Set([
					...availableInboundTags,
					...availableOutboundTags,
					...reverseData.map((reverse) => reverse.tag),
				]),
			)
				.filter(
					(tag) =>
						tag &&
						tag !==
							(editingReverseIndex !== null ? editingReverseRow?.tag : ""),
				),
		[
			availableInboundTags,
			availableOutboundTags,
			editingReverseIndex,
			editingReverseRow?.tag,
			reverseData,
		],
	);

	const freedomOutboundIndex = useMemo(() => {
		if (canonicalOutbounds.length === 0) return -1;
		return canonicalOutbounds.findIndex(
			(outbound: any) => outbound?.protocol === "freedom",
		);
	}, [canonicalOutbounds]);

	const freedomDomainStrategy = useMemo(() => {
		if (freedomOutboundIndex < 0) {
			return "";
		}
		const outbound = canonicalOutbounds[freedomOutboundIndex];
		return outbound?.settings?.domainStrategy ?? "";
	}, [freedomOutboundIndex, canonicalOutbounds]);

	const handleFreedomDomainStrategyChange = (value: string) => {
		const configValue = form.getValues("config") || {};
		const outbounds = Array.isArray(configValue.outbounds)
			? JSON.parse(JSON.stringify(configValue.outbounds))
			: [];

		const index = outbounds.findIndex(
			(outbound: any) => outbound?.protocol === "freedom",
		);

		if (index === -1) {
			return;
		}

		const updated = { ...outbounds[index] };
		const settings = { ...(updated.settings || {}) };
		if (value) {
			settings.domainStrategy = value;
		} else {
			delete settings.domainStrategy;
		}
		updated.settings = settings;
		outbounds[index] = updated;

		form.setValue("config.outbounds", outbounds, { shouldDirty: true });
		setOutboundData(
			outbounds.map((o: any, idx: number) => ({ key: idx, ...o })),
		);
		setJsonKey((prev) => prev + 1);
	};

	const warpOutbound = useMemo<OutboundJson | null>(
		() =>
			canonicalOutbounds.find((outbound) => outbound?.tag === "warp") ?? null,
		[canonicalOutbounds],
	);

	const warpOutboundIndex = useMemo(
		() => canonicalOutbounds.findIndex((outbound) => outbound?.tag === "warp"),
		[canonicalOutbounds],
	);

	const warpExists = warpOutboundIndex !== -1;

	const warpDomains = useMemo<string[]>(() => {
		const rule = canonicalRoutingRules.find(
			(routingRule) => routingRule.outboundTag === "warp",
		);
		return Array.isArray(rule?.domain) ? rule.domain : [];
	}, [canonicalRoutingRules]);

	const handleWarpDomainsChange = (domains: string[]) => {
		const normalized = domains
			.map((entry) => entry.trim())
			.filter(
				(entry, index, arr) => entry.length > 0 && arr.indexOf(entry) === index,
			);

		const currentRules = getRoutingRules();
		const existingIndex = currentRules.findIndex(
			(rule) => rule.outboundTag === "warp",
		);

		if (normalized.length === 0) {
			if (existingIndex !== -1) {
				currentRules.splice(existingIndex, 1);
				commitRoutingRules(currentRules);
			}
			return;
		}

		const updatedRule: RoutingRule = {
			type: "field",
			outboundTag: "warp",
			domain: normalized,
		};

		if (existingIndex !== -1) {
			currentRules[existingIndex] = {
				...currentRules[existingIndex],
				...updatedRule,
			};
		} else {
			currentRules.push(updatedRule);
		}
		commitRoutingRules(currentRules);
	};

	const handleWarpDomainAdd = (domain: string) => {
		const trimmed = domain.trim();
		if (!trimmed) return;
		if (warpDomains.includes(trimmed)) {
			toast({
				title: t(
					"pages.xray.warp.domainExists",
					"This domain already exists in the list.",
				),
				status: "warning",
				duration: 3000,
				isClosable: true,
				position: "top",
			});
			return;
		}
		handleWarpDomainsChange([...warpDomains, trimmed]);
	};

	const handleWarpDomainRemove = (domain: string) => {
		handleWarpDomainsChange(warpDomains.filter((item) => item !== domain));
	};

	const availableWarpOptions = useMemo(
		() =>
			SERVICES_OPTIONS.filter((option) => !warpDomains.includes(option.value)),
		[warpDomains],
	);

	const warpDomainHelper = useColorModeValue("gray.600", "gray.300");

	const handleWarpSave = (outbound: OutboundJson) => {
		const outbounds = getOutbounds();
		const tag = outbound.tag ?? "warp";
		const index = outbounds.findIndex((item) => item?.tag === tag);
		if (index >= 0) {
			outbounds[index] = outbound;
		} else {
			outbounds.push(outbound);
		}
		commitOutbounds(outbounds);
	};

	const handleWarpDelete = () => {
		const outbounds = getOutbounds();
		const index = outbounds.findIndex((item) => item?.tag === "warp");
		if (index === -1) {
			return;
		}
		outbounds.splice(index, 1);
		commitOutbounds(outbounds);
		handleWarpDomainsChange([]);
		setWarpOptionValue("");
		setWarpCustomDomain("");
	};

	const handleNordSave = (
		outbound: OutboundJson,
		replaceIndex: number | null,
	) => {
		const outbounds = getOutbounds();
		if (
			replaceIndex !== null &&
			replaceIndex >= 0 &&
			replaceIndex < outbounds.length
		) {
			outbounds[replaceIndex] = outbound;
		} else {
			outbounds.push(outbound);
		}
		commitOutbounds(outbounds);
	};

	const handleNordDelete = (index: number) => {
		const outbounds = getOutbounds();
		if (index < 0 || index >= outbounds.length) {
			return;
		}
		const tag = String(outbounds[index]?.tag ?? "");
		outbounds.splice(index, 1);
		commitOutbounds(outbounds);
		if (tag) {
			const rules = form.getValues("config.routing.rules");
			if (Array.isArray(rules)) {
				form.setValue(
					"config.routing.rules",
					rules.filter((rule: any) => rule?.outboundTag !== tag),
					{ shouldDirty: true },
				);
			}
		}
	};

	const handleOutboundSave = (outboundJson: unknown) => {
		const outbound = outboundJson as OutboundJson;
		const outbounds = getOutbounds();
		if (
			editingOutboundIndex !== null &&
			editingOutboundIndex >= 0 &&
			editingOutboundIndex < outbounds.length
		) {
			outbounds[editingOutboundIndex] = outbound;
		} else {
			outbounds.push(outbound);
		}
		commitOutbounds(outbounds);
		setEditingOutboundIndex(null);
	};

	const handleWarpModalClose = () => {
		onWarpClose();
	};

	const handleNordModalClose = () => {
		onNordClose();
	};

	const toggleFullScreen = () => {
		if (!document.fullscreenElement) {
			document.documentElement
				.requestFullscreen()
				.then(() => {
					setIsFullScreen(true);
				})
				.catch((err) => {
					console.error("Error entering fullscreen:", err);
				});
		} else {
			document
				.exitFullscreen()
				.then(() => {
					setIsFullScreen(false);
				})
				.catch((err) => {
					console.error("Error exiting fullscreen:", err);
				});
		}
	};

	const getAdvancedJson = () => {
		const cfg = form.getValues("config") || {};
		switch (advSettings) {
			case "inboundSettings":
				return stringifyRebeccaJson(cfg.inbounds ?? [], 2, "inbounds");
			case "outboundSettings":
				return stringifyRebeccaJson(cfg.outbounds ?? [], 2, "outbounds");
			case "routingRuleSettings":
				return stringifyRebeccaJson(
					cfg.routing?.rules ?? [],
					2,
					"routingRules",
				);
			default:
				return stringifyRebeccaJson(cfg ?? {}, 2, "config");
		}
	};

	const setAdvancedJson = (value: string) => {
		try {
			const parsed = JSON.parse(value);
			const cfg = { ...(form.getValues("config") || {}) };
			switch (advSettings) {
				case "inboundSettings":
					cfg.inbounds = canonicalizeRebeccaJson(parsed, "inbounds");
					break;
				case "outboundSettings":
					cfg.outbounds = canonicalizeRebeccaJson(parsed, "outbounds");
					syncOutboundDisplay(cfg.outbounds as OutboundJson[]);
					break;
				case "routingRuleSettings":
					if (!cfg.routing) cfg.routing = {};
					cfg.routing.rules = canonicalizeRebeccaJson(parsed, "routingRules");
					syncRoutingRuleDisplay(cfg.routing.rules as RoutingRule[]);
					break;
				default: {
					// replace whole config
					const canonicalConfig = canonicalizeRebeccaJson(
						parsed,
						"config",
					) as Record<string, any>;
					form.setValue("config", canonicalConfig, { shouldDirty: true });
					// sync all derived states
					syncOutboundDisplay(
						(canonicalConfig?.outbounds as OutboundJson[]) || [],
					);
					syncRoutingRuleDisplay(
						(canonicalConfig?.routing?.rules as RoutingRule[]) || [],
					);
					setBalancersData(
						buildBalancerRows(
							(canonicalConfig?.routing?.balancers as BalancerConfig[]) || [],
						),
					);
					setDnsServers(canonicalConfig?.dns?.servers || []);
					setFakeDns(canonicalConfig?.fakedns || []);
					return;
				}
			}
			form.setValue("config", canonicalizeRebeccaJson(cfg, "config"), {
				shouldDirty: true,
			});
		} catch (_e) {
			// ignore invalid JSON until it becomes valid
		}
	};

	const getObsJson = () => {
		const cfg = form.getValues("config") || {};
		if (obsSettings === "observatory")
			return JSON.stringify(cfg.observatory ?? {}, null, 2);
		if (obsSettings === "burstObservatory")
			return JSON.stringify(cfg.burstObservatory ?? {}, null, 2);
		return "";
	};

	const setObsJson = (value: string) => {
		try {
			const parsed = JSON.parse(value);
			const cfg = { ...(form.getValues("config") || {}) };
			if (obsSettings === "observatory") cfg.observatory = parsed;
			if (obsSettings === "burstObservatory") cfg.burstObservatory = parsed;
			form.setValue("config", cfg, { shouldDirty: true });
		} catch (_e) {
			// ignore until valid
		}
	};

	const toChipList = (value: unknown): string[] => {
		if (!value && value !== 0) return [];
		if (Array.isArray(value)) {
			return value
				.map((item) => (typeof item === "string" ? item.trim() : String(item)))
				.filter(Boolean);
		}
		if (typeof value === "string") {
			return value
				.split(",")
				.map((item) => item.trim())
				.filter(Boolean);
		}
		return [String(value)];
	};

	const renderChipList = (value: unknown, colorScheme: string = "blue") => {
		const chips = toChipList(value);
		if (!chips.length) {
			return <Text color="gray.400">-</Text>;
		}
		// use compact chips that show first item and a +N trigger on small screens
		return <CompactChips chips={chips} color={colorScheme} />;
	};

	const renderTextValue = (value: unknown) => {
		if (
			value === undefined ||
			value === null ||
			value === "" ||
			(typeof value === "string" && !value.trim())
		) {
			return <Text color="gray.400">-</Text>;
		}
		const str = typeof value === "string" ? value : String(value);
		if (str.length > 30) {
			return <CompactTextWithCopy text={str} label={t("details")} />;
		}
		return <Text>{str}</Text>;
	};

	const renderAttrsCell = (attrsValue: string | undefined) => {
		if (!attrsValue) {
			return <Text color="gray.400">-</Text>;
		}
		try {
			const parsed = JSON.parse(attrsValue);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				const entries = Object.entries(parsed as Record<string, unknown>);
				if (!entries.length) {
					return <Text color="gray.400">-</Text>;
				}
				return (
					<Box display="flex" flexWrap="wrap" gap="1">
						{entries.map(([key, value]) => (
							<Tag key={key} colorScheme="purple" size="sm">
								{`${key}: ${String(value)}`}
							</Tag>
						))}
					</Box>
				);
			}
		} catch (_error) {
			// fall back to raw string rendering below
		}
		return (
			<Text fontFamily="mono" fontSize="xs" whiteSpace="pre-wrap">
				{attrsValue}
			</Text>
		);
	};

	type RoutingRuleDisplayRow = { rule: any; originalIndex: number };
	type OutboundDisplayRow = { outbound: any; originalIndex: number };
	type SubscriptionOutboundDisplayRow = {
		outbound: OutboundJson;
		index: number;
		stateKey: string;
	};
	type DnsDisplayRow = { dns: any; index: number };
	type FakeDnsDisplayRow = { fake: any; index: number };

	const renderOutboundBadges = (outbound: any) => (
		<HStack spacing={1} flexWrap="wrap">
			<Tag colorScheme="purple" size="sm">
				{String(outbound.protocol ?? "-")}
			</Tag>
			{["vmess", "vless", "trojan", "shadowsocks"].includes(
				String(outbound.protocol ?? ""),
			) && (
				<>
					{outbound.streamSettings?.network && (
						<Tag colorScheme="blue" size="sm">
							{String(outbound.streamSettings.network)}
						</Tag>
					)}
					{["tls", "reality"].includes(outbound.streamSettings?.security) && (
						<Tag colorScheme="green" size="sm">
							{String(outbound.streamSettings.security)}
						</Tag>
					)}
				</>
			)}
		</HStack>
	);

	const renderAddressList = (addresses: string[]) =>
		addresses.length === 0 ? (
			<Text color="gray.400">-</Text>
		) : (
			<VStack align="start" spacing={1}>
				{addresses.map((addr) => (
					<CompactTextWithCopy key={addr} text={addr} label={addr} />
				))}
			</VStack>
		);

	const renderOutboundTestCell = (
		outbound: any,
		_originalIndex: number,
		state: OutboundTestState | undefined,
		onTest: () => void,
	) => {
		const addresses = findOutboundAddress(outbound);
		const requiresOutboundAddress =
			outboundTestType === "tcp" || outboundTestType === "icmp";
		const addressMissing = requiresOutboundAddress && addresses.length === 0;
		const disabledReason = isMasterTarget
			? outboundNodeTargetRequiredMessage
			: addressMissing
				? outboundAddressRequiredMessage
				: "";
		const isBlocked =
			String(outbound.protocol ?? "").toLowerCase().trim() === "blackhole" ||
			String(outbound.tag ?? "").toLowerCase().trim() === "blocked";

		return (
			<HStack spacing={2} minW={0}>
				<Tooltip
					hasArrow
					isDisabled={!disabledReason}
					label={disabledReason}
					shouldWrapChildren
				>
					<IconButton
						aria-label={t("pages.xray.outbound.test", "Test")}
						icon={<BoltIconStyled />}
						size="xs"
						variant="ghost"
						colorScheme="yellow"
						isLoading={Boolean(state?.testing)}
						isDisabled={Boolean(disabledReason) || isBlocked}
						onClick={(event) => {
							event.stopPropagation();
							onTest();
						}}
					/>
				</Tooltip>
				{state?.result ? (
					state.result.success ? (
						<Tooltip
							label={
								state.result.output || outboundTestResultLabel(state.result)
							}
							whiteSpace="pre-wrap"
						>
							<Tag colorScheme="green" size="sm">
								{outboundTestResultLabel(state.result)}
							</Tag>
						</Tooltip>
					) : (
						<Tooltip label={state.result.error || "-"}>
							<Tag colorScheme="red" size="sm">
								{t("pages.xray.outbound.testFailedBadge", "Failed")}
							</Tag>
						</Tooltip>
					)
				) : (
					<Text fontSize="xs" color="gray.500">
						-
					</Text>
				)}
			</HStack>
		);
	};

	const routingRuleColumns: DataTableColumn<RoutingRuleDisplayRow>[] = [
		{
			id: "rule",
			header: t("pages.xray.Routings"),
			isPrimary: true,
			priority: "primary",
			minSize: { base: "180px", lg: "210px" },
			cell: ({ rule, originalIndex }) => (
				<VStack align="start" spacing={1}>
					<HStack spacing={2} minW={0}>
						<Tag size="sm" colorScheme={rule.enabled === false ? "gray" : "green"}>
							#{originalIndex + 1}
						</Tag>
						<Text fontWeight="semibold" noOfLines={1}>
							{rule.outboundTag || rule.balancerTag || t("pages.xray.rules.any", "Any route")}
						</Text>
					</HStack>
					<Text fontSize="xs" color="panel.textMuted" noOfLines={1}>
						{[
							toChipList(rule.inboundTag).join(",") || "any inbound",
							rule.outboundTag
								? `→ ${rule.outboundTag}`
								: rule.balancerTag
									? `→ ${rule.balancerTag}`
									: "",
						]
							.filter(Boolean)
							.join(" ")}
					</Text>
				</VStack>
			),
		},
		{
			id: "source",
			header: t("pages.xray.rules.sourceGroup"),
			priority: "medium",
			hideBelow: "xl",
			cell: ({ rule }) => (
				<VStack align="start" spacing={1}>
					{renderChipList(rule.source, "blue")}
					{renderTextValue(rule.sourcePort)}
				</VStack>
			),
			mobileMetaLabel: t("pages.xray.rules.sourceGroup"),
		},
		{
			id: "network",
			header: t("pages.xray.rules.networkGroup"),
			priority: "high",
			cell: ({ rule }) => (
				<VStack align="start" spacing={1}>
					{renderChipList(rule.network, "purple")}
					{renderChipList(rule.protocol, "green")}
					{renderAttrsCell(rule.attrs)}
				</VStack>
			),
			mobileMetaLabel: t("pages.xray.rules.networkGroup"),
		},
		{
			id: "destination",
			header: t("pages.xray.rules.destinationGroup"),
			priority: "high",
			minSize: "180px",
			cell: ({ rule }) => (
				<VStack align="start" spacing={1}>
					{renderChipList(rule.ip, "blue")}
					{renderChipList(rule.domain, "blue")}
					{renderTextValue(rule.port)}
				</VStack>
			),
			mobileMetaLabel: t("pages.xray.rules.destinationGroup"),
		},
		{
			id: "inbound",
			header: t("pages.xray.rules.inboundGroup"),
			priority: "medium",
			hideBelow: "lg",
			cell: ({ rule }) => (
				<VStack align="start" spacing={1}>
					{renderChipList(rule.inboundTag, "teal")}
					{renderChipList(rule.user, "cyan")}
				</VStack>
			),
			mobileMetaLabel: t("pages.xray.rules.inboundGroup"),
		},
		{
			id: "target",
			header: t("pages.xray.rules.outbound"),
			priority: "high",
			mobileSummary: true,
			cell: ({ rule }) => (
				<VStack align="start" spacing={1}>
					{renderTextValue(rule.outboundTag)}
					{renderTextValue(rule.balancerTag)}
				</VStack>
			),
			mobileMetaLabel: t("pages.xray.rules.outbound"),
		},
	];

	const routingRuleActions = (
		row: RoutingRuleDisplayRow,
	): DataTableRowAction<RoutingRuleDisplayRow>[] => [
		{
			id: "edit",
			label: t("edit"),
			icon: <EditIconStyled />,
			onClick: () => editRule(row.originalIndex),
		},
		{
			id: "move-up",
			label: t("pages.xray.rules.up", "Move up"),
			icon: <ArrowUpIconStyled />,
			isDisabled: routingRuleSearch.trim().length > 0 || row.originalIndex === 0,
			onClick: () => replaceRule(row.originalIndex, row.originalIndex - 1),
		},
		{
			id: "move-down",
			label: t("pages.xray.rules.down", "Move down"),
			icon: <ArrowDownIconStyled />,
			isDisabled:
				routingRuleSearch.trim().length > 0 ||
				row.originalIndex === routingRuleData.length - 1,
			onClick: () => replaceRule(row.originalIndex, row.originalIndex + 1),
		},
		{
			id: "delete",
			label: t("delete"),
			icon: <DeleteIconStyled />,
			isDanger: true,
			onClick: () => deleteRule(row.originalIndex),
		},
	];

	const outboundColumns: DataTableColumn<OutboundDisplayRow>[] = [
		{
			id: "tag",
			header: t("pages.xray.outbound.tag"),
			isPrimary: true,
			priority: "primary",
			minSize: { base: "170px", lg: "210px" },
			cell: ({ outbound }) => (
				<VStack align="start" spacing={1}>
					<Text fontWeight="semibold" noOfLines={1}>
						{String(outbound.tag ?? "-")}
					</Text>
					{renderOutboundBadges(outbound)}
				</VStack>
			),
		},
		{
			id: "address",
			header: t("pages.xray.outbound.address"),
			priority: "high",
			minSize: "190px",
			cell: ({ outbound }) => renderAddressList(findOutboundAddress(outbound)),
			mobileMetaLabel: t("pages.xray.outbound.address"),
		},
		{
			id: "traffic",
			header: t("pages.inbounds.traffic"),
			priority: "high",
			mobileSummary: true,
			cell: ({ outbound, originalIndex }) => (
				<Tag colorScheme="green" size="sm">
					{findOutboundTraffic(outbound, originalIndex)}
				</Tag>
			),
		},
		{
			id: "test",
			header: t("pages.xray.outbound.test", "Test"),
			priority: "medium",
			hideBelow: "lg",
			cell: ({ outbound, originalIndex }) =>
				renderOutboundTestCell(
					outbound,
					originalIndex,
					outboundTestStates[originalIndex],
					() => testOutbound(originalIndex),
				),
			mobileMetaLabel: t("pages.xray.outbound.test", "Test"),
		},
	];

	const outboundActions = (
		row: OutboundDisplayRow,
	): DataTableRowAction<OutboundDisplayRow>[] => [
		{
			id: "edit",
			label: t("edit"),
			icon: <EditIconStyled />,
			onClick: () => editOutbound(row.originalIndex),
		},
		{
			id: "move-up",
			label: t("pages.xray.outbound.moveUp", "Move up"),
			icon: <ArrowUpIconStyled />,
			isDisabled: outboundSearch.trim().length > 0 || row.originalIndex === 0,
			onClick: () => moveOutboundUp(row.originalIndex),
		},
		{
			id: "move-down",
			label: t("pages.xray.outbound.moveDown", "Move down"),
			icon: <ArrowDownIconStyled />,
			isDisabled:
				outboundSearch.trim().length > 0 ||
				row.originalIndex === outboundData.length - 1,
			onClick: () => moveOutboundDown(row.originalIndex),
		},
		{
			id: "reset",
			label: t("pages.inbounds.resetTraffic", "Reset traffic"),
			icon: <ReloadIconStyled />,
			onClick: () => _resetOutboundTraffic(row.originalIndex, "target"),
		},
		{
			id: "delete",
			label: t("delete"),
			icon: <DeleteIconStyled />,
			isDanger: true,
			onClick: () => deleteOutbound(row.originalIndex),
		},
	];

	const outboundBulkActions: DataTableBulkAction<OutboundDisplayRow>[] = [
		{
			id: "delete",
			label: t("delete"),
			icon: <DeleteIconStyled />,
			isDanger: true,
			onClick: (_rows, rowIds) => deleteSelectedOutbounds(rowIds),
		},
	];

	const subscriptionOutboundRows = useMemo<SubscriptionOutboundDisplayRow[]>(
		() =>
			subscriptionOutbounds.map((outbound, index) => ({
				outbound,
				index,
				stateKey: String(outbound.tag ?? `subscription-${index}`),
			})),
		[subscriptionOutbounds],
	);

	const subscriptionOutboundColumns: DataTableColumn<SubscriptionOutboundDisplayRow>[] = [
		{
			id: "tag",
			header: t("pages.xray.outbound.tag"),
			isPrimary: true,
			priority: "primary",
			cell: ({ outbound }) => (
				<VStack align="start" spacing={1}>
					<Text fontWeight="semibold" noOfLines={1}>
						{String(outbound.tag ?? "-")}
					</Text>
					<Tag size="sm" colorScheme="green">
						{t("pages.xray.outboundSub.sourceBadge", "subscription")}
					</Tag>
				</VStack>
			),
		},
		{
			id: "protocol",
			header: t("protocol"),
			priority: "high",
			cell: ({ outbound }) => renderOutboundBadges(outbound),
			mobileMetaLabel: t("protocol"),
		},
		{
			id: "address",
			header: t("pages.xray.outbound.address"),
			priority: "medium",
			hideBelow: "lg",
			cell: ({ outbound }) => renderAddressList(findOutboundAddress(outbound)),
			mobileMetaLabel: t("pages.xray.outbound.address"),
		},
		{
			id: "traffic",
			header: t("pages.inbounds.traffic"),
			priority: "high",
			mobileSummary: true,
			cell: ({ outbound }) => {
				const traffic = outboundsTraffic
					.filter((item) => (item.target_id || "master") === selectedTarget)
					.find((item) => item.tag === outbound.tag);
				return (
					<Tag colorScheme="green" size="sm">
						{traffic
							? `${SizeFormatter.sizeFormat(traffic.up)} / ${SizeFormatter.sizeFormat(traffic.down)}`
							: `${SizeFormatter.sizeFormat(0)} / ${SizeFormatter.sizeFormat(0)}`}
					</Tag>
				);
			},
		},
		{
			id: "test",
			header: t("pages.xray.outbound.test", "Test"),
			priority: "medium",
			hideBelow: "lg",
			cell: ({ outbound, index, stateKey }) =>
				renderOutboundTestCell(
					outbound,
					index,
					subscriptionOutboundTestStates[stateKey],
					() => testSubscriptionOutbound(outbound, index),
				),
			mobileMetaLabel: t("pages.xray.outbound.test", "Test"),
		},
	];

	const reverseColumns: DataTableColumn<ReverseRow>[] = [
		{
			id: "type",
			header: t("pages.xray.reverse.type", "Type"),
			isPrimary: true,
			priority: "primary",
			cell: (reverse) => (
				<Tag colorScheme={reverse.type === "internal" ? "blue" : "purple"} size="sm">
					{reverse.type === "internal"
						? t("pages.xray.reverse.internal", "Internal device")
						: t("pages.xray.reverse.public", "Public server")}
				</Tag>
			),
		},
		{
			id: "tag",
			header: t("pages.xray.reverse.tag", "Tag"),
			priority: "high",
			cell: (reverse) => renderTextValue(reverse.tag),
			mobileSummary: true,
		},
		{
			id: "connection",
			header: t("pages.xray.reverse.connection", "Connection"),
			priority: "high",
			cell: (reverse) => renderTextValue(reverse.connectionTag),
		},
		{
			id: "target",
			header: t("pages.xray.reverse.target", "Target"),
			priority: "medium",
			hideBelow: "lg",
			cell: (reverse) =>
				reverse.type === "internal"
					? renderTextValue(reverse.targetTag)
					: renderChipList(reverse.inboundTags, "cyan"),
		},
	];

	const reverseActions = (row: ReverseRow): DataTableRowAction<ReverseRow>[] => [
		{
			id: "edit",
			label: t("edit"),
			icon: <EditIconStyled />,
			onClick: () => editReverse(row.index),
		},
		{
			id: "delete",
			label: t("delete"),
			icon: <DeleteIconStyled />,
			isDanger: true,
			onClick: () => deleteReverse(row.index),
		},
	];

	const balancerColumns: DataTableColumn<BalancerRow>[] = [
		{
			id: "tag",
			header: t("pages.xray.balancer.tag"),
			isPrimary: true,
			priority: "primary",
			cell: (balancer) => <Text fontWeight="semibold">{balancer.tag}</Text>,
		},
		{
			id: "strategy",
			header: t("pages.xray.balancer.balancerStrategy"),
			priority: "high",
			mobileSummary: true,
			cell: (balancer) => (
				<Tag
					colorScheme={balancer.strategy === "random" ? "purple" : "green"}
					size="sm"
				>
					{balancer.strategy === "random"
						? "Random"
						: balancer.strategy === "roundRobin"
							? "Round Robin"
							: balancer.strategy === "leastLoad"
								? "Least Load"
								: "Least Ping"}
				</Tag>
			),
		},
		{
			id: "selector",
			header: t("pages.xray.balancer.balancerSelectors"),
			priority: "high",
			cell: (balancer) => renderChipList(balancer.selector, "blue"),
		},
	];

	const balancerActions = (row: BalancerRow): DataTableRowAction<BalancerRow>[] => [
		{
			id: "edit",
			label: t("edit"),
			icon: <EditIconStyled />,
			onClick: () => editBalancer(row.key),
		},
		{
			id: "delete",
			label: t("delete"),
			icon: <DeleteIconStyled />,
			isDanger: true,
			onClick: () => deleteBalancer(row.key),
		},
	];

	const dnsRows = useMemo<DnsDisplayRow[]>(
		() => dnsServers.map((dns, index) => ({ dns, index })),
		[dnsServers],
	);
	const dnsColumns: DataTableColumn<DnsDisplayRow>[] = [
		{
			id: "address",
			header: t("pages.xray.outbound.address"),
			isPrimary: true,
			priority: "primary",
			cell: ({ dns }) => renderTextValue(typeof dns === "object" ? dns.address : dns),
		},
		{
			id: "domains",
			header: t("pages.xray.dns.domains"),
			priority: "high",
			cell: ({ dns }) =>
				typeof dns === "object" ? renderChipList(dns.domains, "blue") : "",
			mobileSummary: true,
		},
		{
			id: "expectIPs",
			header: t("pages.xray.dns.expectIPs"),
			priority: "medium",
			hideBelow: "lg",
			cell: ({ dns }) =>
				typeof dns === "object" ? renderChipList(dns.expectIPs, "green") : "",
		},
	];
	const dnsActions = (row: DnsDisplayRow): DataTableRowAction<DnsDisplayRow>[] => [
		{
			id: "edit",
			label: t("edit"),
			icon: <EditIconStyled />,
			onClick: () => editDnsServer(row.index),
		},
		{
			id: "delete",
			label: t("delete"),
			icon: <DeleteIconStyled />,
			isDanger: true,
			onClick: () => deleteDnsServer(row.index),
		},
	];

	const fakeDnsRows = useMemo<FakeDnsDisplayRow[]>(
		() => fakeDns.map((fake, index) => ({ fake, index })),
		[fakeDns],
	);
	const fakeDnsColumns: DataTableColumn<FakeDnsDisplayRow>[] = [
		{
			id: "ipPool",
			header: t("pages.xray.fakedns.ipPool"),
			isPrimary: true,
			priority: "primary",
			cell: ({ fake }) => renderTextValue(fake.ipPool),
		},
		{
			id: "poolSize",
			header: t("pages.xray.fakedns.poolSize"),
			priority: "high",
			mobileSummary: true,
			cell: ({ fake }) => renderTextValue(fake.poolSize),
		},
	];
	const fakeDnsActions = (
		row: FakeDnsDisplayRow,
	): DataTableRowAction<FakeDnsDisplayRow>[] => [
		{
			id: "edit",
			label: t("edit"),
			icon: <EditIconStyled />,
			onClick: () => editFakeDns(row.index),
		},
		{
			id: "delete",
			label: t("delete"),
			icon: <DeleteIconStyled />,
			isDanger: true,
			onClick: () => deleteFakeDns(row.index),
		},
	];

	if (!getUserIsSuccess) {
		return (
			<VStack spacing={4} align="center" py={10}>
				<Spinner size="lg" />
			</VStack>
		);
	}

	if (!canManageXraySettings) {
		return (
			<VStack spacing={4} align="stretch">
				<Text as="h1" fontWeight="semibold" fontSize="2xl">
					{t("header.xraySettings", "Xray settings")}
				</Text>
				<Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }}>
					{t(
						"xraySettings.noPermission",
						"You do not have permission to manage Xray settings.",
					)}
				</Text>
			</VStack>
		);
	}

	const observatoryJsonValue = getObsJson();
	const advancedJsonValue = getAdvancedJson();
	const advancedJsonModes = [
		{
			value: "xraySetting",
			label: t("pages.xray.completeTemplate"),
			description: t(
				"pages.xray.completeTemplateDesc",
				"Edit the complete Xray config object.",
			),
		},
		{
			value: "inboundSettings",
			label: t("pages.xray.Inbounds"),
			description: t(
				"pages.xray.inboundsJsonDesc",
				"Edit only the config.inbounds array.",
			),
		},
		{
			value: "outboundSettings",
			label: t("pages.xray.Outbounds"),
			description: t(
				"pages.xray.outboundsJsonDesc",
				"Edit only the config.outbounds array.",
			),
		},
		{
			value: "routingRuleSettings",
			label: t("pages.xray.Routings"),
			description: t(
				"pages.xray.routingRulesJsonDesc",
				"Edit only the routing.rules array.",
			),
		},
	];
	const activeAdvancedJsonMode =
		advancedJsonModes.find((option) => option.value === advSettings) ||
		advancedJsonModes[0];
	const advancedJsonContext: RebeccaJsonContext =
		advSettings === "inboundSettings"
			? "inbounds"
			: advSettings === "outboundSettings"
				? "outbounds"
				: advSettings === "routingRuleSettings"
					? "routingRules"
					: "config";

	const handleTabChange = (index: number) => {
		setActiveTab(index);
		const key = tabKeys[index] || "";
		const { base } = splitHash();
		window.location.hash = `${base || "#"}#${key}`;
	};

	return (
		<VStack spacing={4} align="stretch">
			<Box
				borderWidth="1px"
				borderColor={pageShellBorder}
				borderRadius="md"
				bg={pageShellBg}
				p={{ base: 3, md: 4 }}
			>
				<Stack
					direction={{ base: "column", lg: "row" }}
					spacing={4}
					align={{ base: "stretch", lg: "flex-end" }}
					justify="space-between"
				>
					<Box minW={0}>
						<Text as="h1" fontWeight="semibold" fontSize="2xl">
							{t("header.coreSettings")}
						</Text>
						<Text color={pageHintColor} fontSize="sm" mt={1}>
							{t("pages.xray.coreDescription")}
						</Text>
					</Box>
					<HStack
						spacing={2}
						flexWrap="wrap"
						justify={{ base: "stretch", lg: "flex-end" }}
					>
						<Button
							size="sm"
							colorScheme="primary"
							isLoading={isPostLoading}
							isDisabled={!hasConfigChanges || isPostLoading}
							onClick={handleOnSave}
							w={{ base: "full", sm: "auto" }}
						>
							{t("core.save")}
						</Button>
						<Button
							size="sm"
							leftIcon={<ReloadIconStyled />}
							isLoading={isRestarting}
							onClick={() => handleRestartCore(selectedTarget)}
							variant="outline"
							w={{ base: "full", sm: "auto" }}
						>
							{t(isRestarting ? "core.restarting" : "core.restartCore")}
						</Button>
					</HStack>
				</Stack>
				{hasNodeTargets && (
					<HStack
						mt={4}
						pt={3}
						borderTopWidth="1px"
						borderTopColor={pageShellBorder}
						spacing={3}
						align="flex-end"
						flexWrap="wrap"
						w="full"
					>
						<FormControl w={{ base: "full", sm: "260px" }}>
							<FormLabel mb={1} fontSize="xs" color={pageHintColor}>
								{t("core.configTarget", "Target")}
							</FormLabel>
							<Select
								size="sm"
								h="32px"
								value={selectedTarget}
								onChange={(event) => setSelectedTarget(event.target.value)}
							>
								{configTargets.map((target) => (
									<option key={target.id} value={target.id}>
										{target.type === "master"
											? target.name
											: `${target.name} (${target.mode})`}
									</option>
								))}
							</Select>
						</FormControl>
						{selectedTargetInfo?.type === "node" && (
							<FormControl
								display="flex"
								alignItems="center"
								w={{ base: "full", sm: "auto" }}
								minH="32px"
							>
								<FormLabel mb={0} fontSize="sm">
									{t("core.customNodeConfig", "Custom config")}
								</FormLabel>
								<Switch
									size="sm"
									isChecked={selectedTargetInfo.mode === "custom"}
									isDisabled={isChangingTargetMode}
									onChange={(event) =>
										handleTargetModeChange(event.target.checked)
									}
								/>
							</FormControl>
						)}
					</HStack>
				)}
			</Box>
			<TabSystem
				overflowX="auto"
				overflowY="hidden"
				maxW="full"
				sx={{
					WebkitOverflowScrolling: "touch",
					scrollbarWidth: "none",
					"&::-webkit-scrollbar": { display: "none" },
					button: { flexShrink: 0 },
				}}
				tabs={[
					{
						value: "basic",
						isActive: activeTab === 0,
						onClick: () => handleTabChange(0),
						label: (
							<HStack spacing={2} align="center">
								<BasicTabIcon />
								<Text as="span">{t("pages.xray.basicTemplate")}</Text>
							</HStack>
						),
					},
					{
						value: "routing",
						isActive: activeTab === 1,
						onClick: () => handleTabChange(1),
						label: (
							<HStack spacing={2} align="center">
								<RoutingTabIcon />
								<Text as="span">{t("pages.xray.Routings")}</Text>
							</HStack>
						),
					},
					{
						value: "outbounds",
						isActive: activeTab === 2,
						onClick: () => handleTabChange(2),
						label: (
							<HStack spacing={2} align="center">
								<OutboundTabIcon />
								<Text as="span">{t("pages.xray.Outbounds")}</Text>
							</HStack>
						),
					},
					{
						value: "reverse",
						isActive: activeTab === 3,
						onClick: () => handleTabChange(3),
						label: (
							<HStack spacing={2} align="center">
								<ReloadIconStyled />
								<Text as="span">{t("pages.xray.reverse.title", "Reverse")}</Text>
							</HStack>
						),
					},
					{
						value: "balancers",
						isActive: activeTab === 4,
						onClick: () => handleTabChange(4),
						label: (
							<HStack spacing={2} align="center">
								<BalancerTabIcon />
								<Text as="span">{t("pages.xray.Balancers")}</Text>
							</HStack>
						),
					},
					{
						value: "dns",
						isActive: activeTab === 5,
						onClick: () => handleTabChange(5),
						label: (
							<HStack spacing={2} align="center">
								<DnsTabIcon />
								<Text as="span">{t("DNS")}</Text>
							</HStack>
						),
					},
					{
						value: "advanced",
						isActive: activeTab === 6,
						onClick: () => handleTabChange(6),
						label: (
							<HStack spacing={2} align="center">
								<AdvancedTabIcon />
								<Text as="span">{t("pages.xray.advancedTemplate")}</Text>
							</HStack>
						),
					},
					{
						value: "logs",
						isActive: activeTab === 7,
						onClick: () => handleTabChange(7),
						label: (
							<HStack spacing={2} align="center">
								<LogsTabIcon />
								<Text as="span">{t("pages.xray.logs")}</Text>
							</HStack>
						),
					},
				]}
			/>
			<Box mt={{ base: 2, md: 3 }}>
				<Box p={0} mt={3} display={activeTab === 0 ? "block" : "none"}>
						<VStack spacing={4} align="stretch">
							<VStack spacing={3} align="stretch">
								<SettingsSection
									title={t("pages.xray.serverIPs", "Server IPs")}
									defaultOpen
								>
									<SettingRow label="IPv4" controlId="server-ipv4">
										{(_controlId) => (
											<CompactTextWithCopy
												text={serverIPs?.ipv4 || "Loading..."}
											/>
										)}
									</SettingRow>
									<SettingRow label="IPv6" controlId="server-ipv6">
										{(_controlId) => (
											<CompactTextWithCopy
												text={serverIPs?.ipv6 || "Loading..."}
											/>
										)}
									</SettingRow>
								</SettingsSection>
								<SettingsSection title={t("pages.xray.generalConfigs")}>
									<SettingRow
										label={t("pages.xray.FreedomStrategy")}
										controlId="freedom-domain-strategy"
									>
										{(id) => (
											<Select
												id={id}
												size="sm"
												maxW="220px"
												value={freedomDomainStrategy}
												onChange={(event) =>
													handleFreedomDomainStrategyChange(event.target.value)
												}
												isDisabled={freedomOutboundIndex === -1}
											>
												<option value="">{t("core.default", "Default")}</option>
												{[
													"AsIs",
													"UseIP",
													"UseIPv4",
													"UseIPv6",
													"UseIPv6v4",
													"UseIPv4v6",
												].map((s) => (
													<option key={s} value={s}>
														{s}
													</option>
												))}
											</Select>
										)}
									</SettingRow>
									<SettingRow
										label={t("pages.xray.RoutingStrategy")}
										controlId="routing-domain-strategy"
									>
										{(id) => (
											<Controller
												name="config.routing.domainStrategy"
												control={form.control}
												render={({ field }) => (
													<Select {...field} id={id} size="sm" maxW="220px">
														{["AsIs", "IPIfNonMatch", "IPOnDemand"].map((s) => (
															<option key={s} value={s}>
																{s}
															</option>
														))}
													</Select>
												)}
											/>
										)}
									</SettingRow>
								</SettingsSection>
								<SettingsSection title={t("pages.xray.warpRouting")}>
									<Box p={{ base: 3, md: 4 }}>
										<VStack align="stretch" spacing={3}>
											<HStack justify="space-between" align="center">
												<Text fontSize="sm" color={warpDomainHelper}>
													{t("pages.xray.warpRoutingDesc")}
												</Text>
												<Button
													variant="outline"
													size="sm"
													leftIcon={<WarpIconStyled />}
													onClick={onWarpOpen}
													flexShrink={0}
												>
													{warpExists
														? t("pages.xray.warp.manage", "Manage WARP")
														: t("pages.xray.warp.create", "Create WARP")}
												</Button>
											</HStack>
											<Wrap>
												{warpDomains.length === 0 && (
													<WrapItem>
														<Tag colorScheme="gray" variant="subtle">
															<TagLabel>{t("core.empty", "Empty")}</TagLabel>
														</Tag>
													</WrapItem>
												)}
												{warpDomains.map((domain) => (
													<WrapItem key={domain}>
														<Tag colorScheme="primary" borderRadius="full">
															<TagLabel>{domain}</TagLabel>
															<TagCloseButton
																aria-label={t("core.remove")}
																onClick={() => handleWarpDomainRemove(domain)}
															/>
														</Tag>
													</WrapItem>
												))}
											</Wrap>
											<HStack spacing={3} flexWrap="wrap">
												<Select
													placeholder={t("core.select", "Select...")}
													size="sm"
													maxW="240px"
													value={warpOptionValue}
													onChange={(event) => {
														const { value } = event.target;
														if (value) {
															handleWarpDomainAdd(value);
														}
														setWarpOptionValue("");
													}}
													isDisabled={availableWarpOptions.length === 0}
												>
													{availableWarpOptions.map((option) => (
														<option key={option.value} value={option.value}>
															{option.label}
														</option>
													))}
												</Select>
												<HStack spacing={2} maxW="320px" flex="1">
													<Input
														size="sm"
														value={warpCustomDomain}
														onChange={(event) =>
															setWarpCustomDomain(event.target.value)
														}
														placeholder="geosite:google"
													/>
													<Button
														size="sm"
														colorScheme="primary"
														onClick={() => {
															handleWarpDomainAdd(warpCustomDomain);
															setWarpCustomDomain("");
														}}
														isDisabled={!warpCustomDomain.trim()}
													>
														{t("core.add")}
													</Button>
												</HStack>
											</HStack>
										</VStack>
									</Box>
								</SettingsSection>
								<SettingsSection title={t("pages.xray.statistics")}>
									<SettingRow
										label={t("pages.xray.statsInboundUplink")}
										controlId="stats-inbound-uplink"
									>
										{(id) => (
											<Controller
												name="config.policy.system.statsInboundUplink"
												control={form.control}
												render={({ field }) => (
													<Switch
														id={id}
														isChecked={!!field.value}
														dir={isRTL ? "ltr" : undefined}
														onChange={(e) => field.onChange(e.target.checked)}
													/>
												)}
											/>
										)}
									</SettingRow>
									<SettingRow
										label={t("pages.xray.statsInboundDownlink")}
										controlId="stats-inbound-downlink"
									>
										{(id) => (
											<Controller
												name="config.policy.system.statsInboundDownlink"
												control={form.control}
												render={({ field }) => (
													<Switch
														id={id}
														isChecked={!!field.value}
														dir={isRTL ? "ltr" : undefined}
														onChange={(e) => field.onChange(e.target.checked)}
													/>
												)}
											/>
										)}
									</SettingRow>
									<SettingRow
										label={t("pages.xray.statsOutboundUplink")}
										controlId="stats-outbound-uplink"
									>
										{(id) => (
											<Controller
												name="config.policy.system.statsOutboundUplink"
												control={form.control}
												render={({ field }) => (
													<Switch
														id={id}
														isChecked={!!field.value}
														dir={isRTL ? "ltr" : undefined}
														onChange={(e) => field.onChange(e.target.checked)}
													/>
												)}
											/>
										)}
									</SettingRow>
									<SettingRow
										label={t("pages.xray.statsOutboundDownlink")}
										controlId="stats-outbound-downlink"
									>
										{(id) => (
											<Controller
												name="config.policy.system.statsOutboundDownlink"
												control={form.control}
												render={({ field }) => (
													<Switch
														id={id}
														isChecked={!!field.value}
														dir={isRTL ? "ltr" : undefined}
														onChange={(e) => field.onChange(e.target.checked)}
													/>
												)}
											/>
										)}
									</SettingRow>
								</SettingsSection>
								<SettingsSection title={t("pages.xray.logConfigs")}>
									<SettingRow
										label={t("pages.xray.logLevel")}
										controlId="log-level"
									>
										{(id) => (
											<Controller
												name="config.log.loglevel"
												control={form.control}
												render={({ field }) => (
													<Select {...field} id={id} size="sm" maxW="220px">
														{["none", "debug", "info", "warning", "error"].map(
															(s) => (
																<option key={s} value={s}>
																	{s}
																</option>
															),
														)}
													</Select>
												)}
											/>
										)}
									</SettingRow>
									<SettingRow
										label={t("pages.xray.accessLog")}
										controlId="access-log"
									>
										{(id) => (
											<HStack spacing={2} w="full" flexWrap="wrap">
												<Controller
													name="config.log.access"
													control={form.control}
													render={({ field }) => (
														<Select {...field} id={id} size="sm" maxW="220px">
															<option value="">Empty</option>
															{["none", DEFAULT_ACCESS_LOG_PATH].map((s) => (
																<option key={s} value={s}>
																	{s}
																</option>
															))}
														</Select>
													)}
												/>
												<Controller
													name="config.log.accessCleanupInterval"
													control={form.control}
													render={({ field }) => (
														<Select
															id={`${id}-cleanup`}
															size="sm"
															maxW="220px"
															value={
																field.value === undefined ||
																field.value === null ||
																field.value === ""
																	? "0"
																	: String(field.value)
															}
															onChange={(e) =>
																field.onChange(Number(e.target.value))
															}
														>
															{LOG_CLEANUP_INTERVAL_OPTIONS.map((option) => (
																<option
																	key={option.value}
																	value={String(option.value)}
																>
																	{t(option.labelKey, option.fallback)}
																</option>
															))}
														</Select>
													)}
												/>
											</HStack>
										)}
									</SettingRow>
									<SettingRow
										label={t("pages.xray.errorLog")}
										controlId="error-log"
									>
										{(id) => (
											<HStack spacing={2} w="full" flexWrap="wrap">
												<Controller
													name="config.log.error"
													control={form.control}
													render={({ field }) => (
														<Select {...field} id={id} size="sm" maxW="220px">
															<option value="">Empty</option>
															{["none", DEFAULT_ERROR_LOG_PATH].map((s) => (
																<option key={s} value={s}>
																	{s}
																</option>
															))}
														</Select>
													)}
												/>
												<Controller
													name="config.log.errorCleanupInterval"
													control={form.control}
													render={({ field }) => (
														<Select
															id={`${id}-cleanup`}
															size="sm"
															maxW="220px"
															value={
																field.value === undefined ||
																field.value === null ||
																field.value === ""
																	? "0"
																	: String(field.value)
															}
															onChange={(e) =>
																field.onChange(Number(e.target.value))
															}
														>
															{LOG_CLEANUP_INTERVAL_OPTIONS.map((option) => (
																<option
																	key={option.value}
																	value={String(option.value)}
																>
																	{t(option.labelKey, option.fallback)}
																</option>
															))}
														</Select>
													)}
												/>
											</HStack>
										)}
									</SettingRow>
									<SettingRow
										label={t("pages.xray.maskAddress")}
										controlId="mask-address"
									>
										{(id) => (
											<Controller
												name="config.log.maskAddress"
												control={form.control}
												render={({ field }) => (
													<Select {...field} id={id} size="sm" maxW="220px">
														<option value="">Empty</option>
														{["quarter", "half", "full"].map((s) => (
															<option key={s} value={s}>
																{s}
															</option>
														))}
													</Select>
												)}
											/>
										)}
									</SettingRow>
									<SettingRow
										label={t("pages.xray.dnsLog")}
										controlId="dns-log"
									>
										{(id) => (
											<Controller
												name="config.log.dnsLog"
												control={form.control}
												render={({ field }) => (
													<Switch
														id={id}
														isChecked={!!field.value}
														onChange={(e) => field.onChange(e.target.checked)}
													/>
												)}
											/>
										)}
									</SettingRow>
								</SettingsSection>
							</VStack>
						</VStack>
				</Box>
				<Box p={0} mt={3} display={activeTab === 1 ? "block" : "none"}>
						<VStack spacing={4} align="stretch">
							<ResourceListCard
								title={t("pages.xray.Routings")}
								summaryItems={[
									{
										label: t("total", "Total"),
										value: routingRuleData.length,
									},
									{
										label: t("listed", "Listed"),
										value: filteredRoutingRules.length,
										colorScheme: "green",
									},
								]}
								actions={
									<HStack spacing={2} flexWrap="wrap" justify="flex-end">
										<Button
											leftIcon={<AddIconStyled />}
											{...compactActionButtonProps}
											size="xs"
											onClick={addRule}
										>
											{t("pages.xray.rules.add")}
										</Button>
									</HStack>
								}
							>
								<Input
									size="sm"
									maxW={{ base: "full", md: "280px" }}
									placeholder={t("search", "Search")}
									value={routingRuleSearch}
									onChange={(e) => setRoutingRuleSearch(e.target.value)}
								/>
							</ResourceListCard>
							<DataTable
								data={filteredRoutingRules}
								columns={routingRuleColumns}
								getRowId={(row) => String(row.originalIndex)}
								rowActions={routingRuleActions}
								actionsDisplay="menu"
								actionsColumnWidth="52px"
								emptyState={t("pages.xray.rules.empty")}
								ariaLabel={t("pages.xray.Routings")}
							/>
							{subscriptionOutbounds.length > 0 && (
								<VStack align="stretch" spacing={3}>
									<ResourceListCard
										title={t(
											"pages.xray.outboundSub.fromSubsTitle",
											"Subscription outbounds",
										)}
										summaryItems={[
											{
												label: t("total", "Total"),
												value: subscriptionOutbounds.length,
												colorScheme: "green",
											},
										]}
									>
										<Text color="panel.textMuted" fontSize="xs">
											{t(
												"pages.xray.outboundSub.fromSubsDesc",
												"These outbounds are fetched from outbound subscriptions and merged into node runtime config.",
											)}
										</Text>
									</ResourceListCard>
									<DataTable
										data={subscriptionOutboundRows}
										columns={subscriptionOutboundColumns}
										getRowId={(row) => `${row.stateKey}-${row.index}`}
										actionsDisplay="none"
										emptyState={t("pages.xray.outbound.empty", "No outbound found")}
										ariaLabel={t(
											"pages.xray.outboundSub.fromSubsTitle",
											"Subscription outbounds",
										)}
									/>
								</VStack>
							)}
						</VStack>
				</Box>
				<Box p={0} mt={3} display={activeTab === 2 ? "block" : "none"}>
						<VStack spacing={4} align="stretch">
							<ResourceListCard
								title={t("pages.xray.Outbounds")}
								summaryItems={[
									{
										label: t("total", "Total"),
										value: outboundData.length,
									},
									{
										label: t("listed", "Listed"),
										value: filteredOutboundData.length,
										colorScheme: "green",
									},
									{
										label: t("selected", "Selected"),
										value: selectedOutboundIds.length,
										colorScheme: "blue",
									},
								]}
								actions={
									<HStack spacing={2} flexWrap="wrap" justify="flex-end">
										<Button
											leftIcon={<AddIconStyled />}
											{...compactActionButtonProps}
											onClick={addOutbound}
										>
											{t("pages.xray.outbound.addOutbound")}
										</Button>
										<Button
											leftIcon={<WarpIconStyled />}
											size="xs"
											variant="ghost"
											onClick={onWarpOpen}
										>
											{warpExists
												? t("pages.xray.warp.manage", "Manage WARP")
												: t("pages.xray.warp.create", "Create WARP")}
										</Button>
										<Button
											leftIcon={<CloudArrowUpIcon width={14} />}
											size="xs"
											variant="ghost"
											onClick={onOutboundSubsOpen}
										>
											{t(
												"pages.xray.outboundSub.manage",
												"Outbound subscriptions",
											)}
										</Button>
										<Button
											leftIcon={<GlobeAltIcon width={14} />}
											size="xs"
											variant="ghost"
											onClick={onNordOpen}
										>
											NordVPN
										</Button>
									</HStack>
								}
								footerActions={
									<>
										<Button
											leftIcon={<ReloadIconStyled />}
											size="xs"
											variant="ghost"
											onClick={fetchOutboundsTraffic}
										>
											{t("refresh")}
										</Button>
										<Button
											size="xs"
											variant="ghost"
											onClick={() => _resetOutboundTraffic(-1, "target")}
										>
											{t("pages.xray.outbound.resetTarget", "Reset target")}
										</Button>
										<Button
											size="xs"
											variant="ghost"
											colorScheme="red"
											onClick={() => _resetOutboundTraffic(-1, "all")}
										>
											{t("pages.xray.outbound.resetAll", "Reset all")}
										</Button>
										<Button
											size="xs"
											variant="ghost"
											leftIcon={<BoltIconStyled />}
											isLoading={testingAllOutbounds}
											isDisabled={isMasterTarget}
											onClick={testAllOutbounds}
										>
											{t("pages.xray.outbound.testAll", "Test all")}
										</Button>
									</>
								}
							>
								<Stack
									direction={{ base: "column", md: "row" }}
									spacing={2}
									align={{ base: "stretch", md: "center" }}
								>
									<Input
										size="sm"
										maxW={{ base: "full", md: "280px" }}
										placeholder={t("search", "Search")}
										value={outboundSearch}
										onChange={(e) => setOutboundSearch(e.target.value)}
									/>
									<RadioGroup
										size="sm"
										value={outboundTestType}
										onChange={(value) =>
											setOutboundTestType(value as OutboundTestType)
										}
									>
										<HStack
											spacing={2}
											borderWidth="1px"
											borderRadius="md"
											px={2}
											py={1}
											flexWrap="wrap"
										>
											{(["latency", "tcp", "icmp"] as OutboundTestType[]).map(
												(type) => (
													<Radio key={type} value={type} size="sm">
														{outboundTestTypeLabels[type]}
													</Radio>
												),
											)}
										</HStack>
									</RadioGroup>
								</Stack>
							</ResourceListCard>
							<DataTable
								data={filteredOutboundData}
								columns={outboundColumns}
								getRowId={(row) => String(row.originalIndex)}
								enableSelection
								selectedRowIds={selectedOutboundIds}
								onSelectionChange={(ids) => setSelectedOutboundIds(ids)}
								bulkActions={outboundBulkActions}
								rowActions={outboundActions}
								actionsDisplay="menu"
								actionsColumnWidth="52px"
								emptyState={t("pages.xray.outbound.empty", "No outbound found")}
								ariaLabel={t("pages.xray.Outbounds")}
							/>
						</VStack>
				</Box>
				<Box p={0} mt={3} display={activeTab === 3 ? "block" : "none"}>
						<VStack spacing={4} align="stretch">
							<ResourceListCard
								title={t("pages.xray.reverse.title", "Reverse")}
								summaryItems={[
									{
										label: t("total", "Total"),
										value: reverseData.length,
									},
									{
										label: t("pages.xray.reverse.internal", "Internal device"),
										value: reverseData.filter((reverse) => reverse.type === "internal")
											.length,
										colorScheme: "blue",
									},
									{
										label: t("pages.xray.reverse.public", "Public server"),
										value: reverseData.filter((reverse) => reverse.type === "public")
											.length,
										colorScheme: "purple",
									},
								]}
								actions={
									<Button
										leftIcon={<AddIconStyled />}
										{...compactActionButtonProps}
										onClick={addReverse}
									>
										{t("pages.xray.reverse.add", "Add Reverse")}
									</Button>
								}
							/>
							<DataTable
								data={reverseData}
								columns={reverseColumns}
								getRowId={(row) => row.key}
								rowActions={reverseActions}
								actionsDisplay="menu"
								actionsColumnWidth="52px"
								emptyState={t("pages.xray.reverse.empty", "No added reverse proxies.")}
								ariaLabel={t("pages.xray.reverse.title", "Reverse")}
							/>
						</VStack>
				</Box>
				<Box p={0} mt={3} display={activeTab === 4 ? "block" : "none"}>
						<VStack spacing={4} align="stretch">
							<ResourceListCard
								title={t("pages.xray.balancer.title", "Balancers")}
								summaryItems={[
									{
										label: t("total", "Total"),
										value: balancersData.length,
									},
									{
										label: t("pages.xray.balancer.balancerSelectors"),
										value: balancersData.reduce(
											(total, balancer) => total + balancer.selector.length,
											0,
										),
										colorScheme: "blue",
									},
								]}
								actions={
									<Button
										leftIcon={<AddIconStyled />}
										{...compactActionButtonProps}
										onClick={addBalancer}
									>
										{t("pages.xray.balancer.addBalancer")}
									</Button>
								}
							/>
							<DataTable
								data={balancersData}
								columns={balancerColumns}
								getRowId={(row) => String(row.key)}
								rowActions={balancerActions}
								actionsDisplay="menu"
								actionsColumnWidth="52px"
								emptyState={t("emptyBalancersDesc")}
								ariaLabel={t("pages.xray.balancer.title", "Balancers")}
							/>
							{/* Observatory / Burst Observatory editor (if present in config) */}
							{(form.getValues("config")?.observatory ||
								form.getValues("config")?.burstObservatory) && (
								<VStack spacing={3} align="stretch">
									<RadioGroup
										onChange={(v) => {
											setObsSettings(v);
											setJsonKey((prev) => prev + 1);
										}}
										value={obsSettings}
									>
										<HStack spacing={3}>
											{form.getValues("config")?.observatory && (
												<Radio value="observatory">Observatory</Radio>
											)}
											{form.getValues("config")?.burstObservatory && (
												<Radio value="burstObservatory">
													Burst Observatory
												</Radio>
											)}
										</HStack>
									</RadioGroup>
									<Box h="300px">
										<JsonEditor
											key={`obs-${obsSettings}-${jsonKey}`}
											json={observatoryJsonValue}
											onChange={(value) => setObsJson(value)}
										/>
									</Box>
								</VStack>
							)}
						</VStack>
				</Box>
				<Box p={0} mt={3} display={activeTab === 5 ? "block" : "none"}>
						<VStack spacing={4} align="stretch">
							<SettingsSection title={t("pages.xray.generalConfigs")}>
								<SettingRow
									label={t("pages.xray.dns.enable")}
									description={t("pages.xray.dns.enableDesc")}
									controlId="dns-enable"
								>
									{(id) => (
										<Switch
											id={id}
											isChecked={dnsEnabled}
											onChange={(e) => {
												const checked = e.target.checked;
												const newConfig = {
													...form.getValues("config"),
												};
												if (checked) {
													newConfig.dns = newConfig.dns || createDefaultDnsConfig();
													newConfig.fakedns = Array.isArray(newConfig.fakedns)
														? newConfig.fakedns
														: [];
													setDnsServers(newConfig.dns?.servers || []);
													setFakeDns(newConfig.fakedns || []);
												} else {
													delete newConfig.dns;
													delete newConfig.fakedns;
													setDnsServers([]);
													setFakeDns([]);
												}
												setDnsEnabledState(checked);
												form.setValue("config", newConfig, {
													shouldDirty: true,
												});
											}}
										/>
									)}
								</SettingRow>
								{dnsEnabled && (
									<>
										<SettingRow
											label={t("pages.xray.dns.tag")}
											description={t("pages.xray.dns.tagDesc")}
											controlId="dns-tag"
										>
											{(id) => (
												<Controller
													name="config.dns.tag"
													control={form.control}
													render={({ field }) => (
														<Input
															id={id}
															size="sm"
															maxW="240px"
															value={field.value ?? ""}
															onChange={(event) =>
																field.onChange(event.target.value)
															}
															placeholder="dns_inbound"
														/>
													)}
												/>
											)}
										</SettingRow>
										<SettingRow
											label={t("pages.xray.dns.clientIp")}
											description={t("pages.xray.dns.clientIpDesc")}
											controlId="dns-client-ip"
										>
											{(id) => (
												<Controller
													name="config.dns.clientIp"
													control={form.control}
													render={({ field }) => (
														<Input
															id={id}
															size="sm"
															maxW="240px"
															value={field.value ?? ""}
															onChange={(event) =>
																field.onChange(event.target.value)
															}
															placeholder="1.1.1.1"
														/>
													)}
												/>
											)}
										</SettingRow>
										<SettingRow
											label={t("pages.xray.dns.strategy")}
											description={t("pages.xray.dns.strategyDesc")}
											controlId="dns-strategy"
										>
											{(id) => (
												<Controller
													name="config.dns.queryStrategy"
													control={form.control}
													render={({ field }) => (
														<Select
															id={id}
															size="sm"
															maxW="220px"
															value={field.value ?? "UseIP"}
															onChange={(event) =>
																field.onChange(event.target.value)
															}
														>
															{DNS_STRATEGY_OPTIONS.map((strategy) => (
																<option key={strategy} value={strategy}>
																	{strategy}
																</option>
															))}
														</Select>
													)}
												/>
											)}
										</SettingRow>
										<SettingRow
											label={t("pages.xray.dns.disableCache")}
											description={t("pages.xray.dns.disableCacheDesc")}
											controlId="dns-disable-cache"
										>
											{(id) => (
												<Controller
													name="config.dns.disableCache"
													control={form.control}
													render={({ field }) => (
														<Switch
															id={id}
															isChecked={Boolean(field.value)}
															onChange={(event) =>
																field.onChange(event.target.checked)
															}
														/>
													)}
												/>
											)}
										</SettingRow>
										<SettingRow
											label={t("pages.xray.dns.disableFallback")}
											description={t("pages.xray.dns.disableFallbackDesc")}
											controlId="dns-disable-fallback"
										>
											{(id) => (
												<Controller
													name="config.dns.disableFallback"
													control={form.control}
													render={({ field }) => (
														<Switch
															id={id}
															isChecked={Boolean(field.value)}
															onChange={(event) =>
																field.onChange(event.target.checked)
															}
														/>
													)}
												/>
											)}
										</SettingRow>
										<SettingRow
											label={t("pages.xray.dns.disableFallbackIfMatch")}
											description={t(
												"pages.xray.dns.disableFallbackIfMatchDesc",
											)}
											controlId="dns-disable-fallback-match"
										>
											{(id) => (
												<Controller
													name="config.dns.disableFallbackIfMatch"
													control={form.control}
													render={({ field }) => (
														<Switch
															id={id}
															isChecked={Boolean(field.value)}
															onChange={(event) =>
																field.onChange(event.target.checked)
															}
														/>
													)}
												/>
											)}
										</SettingRow>
										<SettingRow
											label={t("pages.xray.dns.enableParallelQuery")}
											description={t("pages.xray.dns.enableParallelQueryDesc")}
											controlId="dns-parallel-query"
										>
											{(id) => (
												<Controller
													name="config.dns.enableParallelQuery"
													control={form.control}
													render={({ field }) => (
														<Switch
															id={id}
															isChecked={Boolean(field.value)}
															onChange={(event) =>
																field.onChange(event.target.checked)
															}
														/>
													)}
												/>
											)}
										</SettingRow>
										<SettingRow
											label={t("pages.xray.dns.useSystemHosts")}
											description={t("pages.xray.dns.useSystemHostsDesc")}
											controlId="dns-system-hosts"
										>
											{(id) => (
												<Controller
													name="config.dns.useSystemHosts"
													control={form.control}
													render={({ field }) => (
														<Switch
															id={id}
															isChecked={Boolean(field.value)}
															onChange={(event) =>
																field.onChange(event.target.checked)
															}
														/>
													)}
												/>
											)}
										</SettingRow>
									</>
								)}
							</SettingsSection>
							{dnsEnabled && (
								<VStack align="stretch" spacing={3}>
									<ResourceListCard
										title={t("DNS")}
										summaryItems={[
											{
												label: t("total", "Total"),
												value: dnsServers.length,
											},
											{
												label: t("pages.xray.dns.domains"),
												value: dnsRows.reduce(
													(total, row) =>
														total +
														(typeof row.dns === "object"
															? toChipList(row.dns.domains).length
															: 0),
													0,
												),
												colorScheme: "blue",
											},
										]}
										actions={
											<HStack spacing={2} flexWrap="wrap" justify="flex-end">
												<Button
													leftIcon={<AddIconStyled />}
													{...compactActionButtonProps}
													onClick={addDnsServer}
												>
													{t("pages.xray.dns.add")}
												</Button>
												<Button size="xs" variant="outline" onClick={onDnsPresetsOpen}>
													{t("pages.xray.dns.presets")}
												</Button>
											</HStack>
										}
									/>
									<DataTable
										data={dnsRows}
										columns={dnsColumns}
										getRowId={(row) => String(row.index)}
										rowActions={dnsActions}
										actionsDisplay="menu"
										actionsColumnWidth="52px"
										emptyState={t("emptyDnsDesc")}
										ariaLabel={t("DNS")}
									/>
								</VStack>
							)}
							{dnsEnabled && (
								<VStack align="stretch" spacing={3}>
									<ResourceListCard
										title={t("pages.xray.fakedns.title", "Fake DNS")}
										summaryItems={[
											{
												label: t("total", "Total"),
												value: fakeDns.length,
											},
										]}
										actions={
											<Button
												leftIcon={<AddIconStyled />}
												{...compactActionButtonProps}
												onClick={addFakeDns}
											>
												{t("pages.xray.fakedns.add")}
											</Button>
										}
									/>
									<DataTable
										data={fakeDnsRows}
										columns={fakeDnsColumns}
										getRowId={(row) => String(row.index)}
										rowActions={fakeDnsActions}
										actionsDisplay="menu"
										actionsColumnWidth="52px"
										emptyState={t("emptyFakeDnsDesc")}
										ariaLabel={t("pages.xray.fakedns.title", "Fake DNS")}
									/>
								</VStack>
							)}
						</VStack>
				</Box>
				<Box p={0} mt={3} display={activeTab === 6 ? "block" : "none"}>
						<VStack spacing={4} align="stretch">
							<ResourceListCard
								title={t("pages.xray.advancedJsonEditor", "JSON editor")}
								summaryItems={[
									{
										label: t("pages.xray.advancedTemplate", "Template"),
										value: activeAdvancedJsonMode.label,
										colorScheme: "blue",
									},
									{
										label: t("pages.xray.jsonStatus", "Status"),
										value: advancedJsonValid
											? t("jsonEditor.valid", "Valid JSON")
											: t("jsonEditor.invalid", "Invalid JSON"),
										colorScheme: advancedJsonValid ? "green" : "red",
									},
								]}
								actions={
									<HStack spacing={2} flexWrap="wrap" justify="flex-end">
										{advancedJsonModes.map((option) => {
											const selected = advSettings === option.value;
											return (
												<Button
													key={option.value}
													size="xs"
													variant={selected ? "solid" : "outline"}
													colorScheme={selected ? "primary" : "gray"}
													onClick={() => {
														setAdvSettings(option.value);
														setJsonKey((prev) => prev + 1);
													}}
												>
													{option.label}
												</Button>
											);
										})}
									</HStack>
								}
							/>
							<Box
								position="relative"
								w="100%"
								h="calc(100vh - 350px)"
								minH="400px"
							>
								<Box
									w={isFullScreen ? "100vw" : "100%"}
									h={isFullScreen ? "100vh" : "100%"}
									position={isFullScreen ? "fixed" : "relative"}
									top={isFullScreen ? 0 : "auto"}
									left={isFullScreen ? 0 : "auto"}
									zIndex={isFullScreen ? 1000 : "auto"}
								>
									<JsonEditor
										key={`advanced-${advSettings}-${jsonKey}`}
										label={activeAdvancedJsonMode.label}
										description={activeAdvancedJsonMode.description}
										json={advancedJsonValue}
										canonicalContext={advancedJsonContext}
										onValidityChange={setAdvancedJsonValid}
										toolbarActions={
											<IconButton
												aria-label={
													isFullScreen ? "Exit Full Screen" : "Full Screen"
												}
												icon={
													isFullScreen ? (
														<ExitFullScreenIconStyled />
													) : (
														<FullScreenIconStyled />
													)
												}
												onClick={toggleFullScreen}
												size="xs"
												variant="outline"
											/>
										}
										onChange={(value) => {
											setAdvancedJson(value);
										}}
									/>
								</Box>
								{isFullScreen && isMobile && (
									<Button
										position="fixed"
										bottom={4}
										left="50%"
										transform="translateX(-50%)"
										zIndex={1102}
										size="sm"
										colorScheme="primary"
										onClick={toggleFullScreen}
									>
										{t("pages.xray.exitFullscreen", "Exit full screen")}
									</Button>
								)}
							</Box>
						</VStack>
				</Box>
				<Box p={0} mt={3} display={activeTab === 7 ? "block" : "none"}>
						<Box>
							<XrayLogsPage showTitle={false} />
						</Box>
				</Box>
			</Box>
			<OutboundModal
				isOpen={isOutboundOpen}
				onClose={handleOutboundModalClose}
				mode={editingOutboundIndex !== null ? "edit" : "create"}
				initialOutbound={
					editingOutboundIndex !== null
						? canonicalOutbounds[editingOutboundIndex]
						: null
				}
				onSubmitOutbound={handleOutboundSave}
			/>
			<RuleModal
				isOpen={isRuleOpen}
				mode={editingRuleIndex !== null ? "edit" : "create"}
				initialRule={
					editingRuleIndex !== null
						? canonicalRoutingRules[editingRuleIndex] || null
						: null
				}
				availableInboundTags={availableInboundTags}
				availableOutboundTags={availableOutboundTags}
				availableBalancerTags={availableBalancerTags}
				onSubmit={handleRuleModalSubmit}
				onClose={handleRuleModalClose}
			/>
			<ReverseModal
				isOpen={isReverseOpen}
				onClose={handleReverseModalClose}
				mode={editingReverseIndex !== null ? "edit" : "create"}
				initialReverse={editingReverseInitial}
				inboundTags={availableInboundTags}
				outboundTags={availableOutboundTags}
				vlessInboundTags={vlessInboundTags}
				vlessOutboundTags={vlessOutboundTags}
				existingTags={existingReverseTags}
				reverseCount={reverseData.length}
				onSubmit={handleReverseSubmit}
			/>
			<WarpModal
				isOpen={isWarpOpen}
				onClose={handleWarpModalClose}
				initialOutbound={warpOutbound}
				onSave={handleWarpSave}
				onDelete={handleWarpDelete}
			/>
			<NordVPNModal
				isOpen={isNordOpen}
				onClose={handleNordModalClose}
				initialOutbounds={getOutbounds()}
				onSave={handleNordSave}
				onDelete={handleNordDelete}
			/>
			<OutboundSubscriptionsModal
				isOpen={isOutboundSubsOpen}
				onClose={onOutboundSubsClose}
				onChanged={async () => {
					await fetchActiveSubscriptionOutbounds();
					await fetchOutboundsTraffic();
				}}
			/>
			<BalancerModal
				isOpen={isBalancerOpen}
				onClose={handleBalancerModalClose}
				mode={editingBalancerIndex !== null ? "edit" : "create"}
				initialBalancer={
					editingBalancerIndex !== null
						? {
								tag: balancersData[editingBalancerIndex]?.tag ?? "",
								strategy:
									balancersData[editingBalancerIndex]?.strategy ?? "random",
								selector: balancersData[editingBalancerIndex]?.selector ?? [],
								fallbackTag:
									balancersData[editingBalancerIndex]?.fallbackTag ?? "",
							}
						: null
				}
				outboundTags={availableOutboundTags}
				excludedOutboundTags={excludedBalancerOutboundTags}
				existingTags={availableBalancerTags
					.map((tag) => tag.trim())
					.filter(
						(tag) =>
							tag &&
							tag !==
								(editingBalancerIndex !== null
									? balancersData[editingBalancerIndex]?.tag
									: ""),
					)}
				onSubmit={handleBalancerSubmit}
			/>
			<DnsModal
				isOpen={isDnsOpen}
				onClose={handleDnsModalClose}
				form={form}
				setDnsServers={setDnsServers}
				dnsIndex={editingDnsIndex}
				currentDnsData={
					editingDnsIndex !== null ? dnsServers[editingDnsIndex] : null
				}
			/>
			<DnsPresetsModal
				isOpen={isDnsPresetsOpen}
				onClose={onDnsPresetsClose}
				onSelectPreset={applyDnsPreset}
			/>
			<FakeDnsModal
				isOpen={isFakeDnsOpen}
				onClose={handleFakeDnsModalClose}
				form={form}
				setFakeDns={setFakeDns}
				fakeDnsIndex={editingFakeDnsIndex}
				currentFakeDnsData={
					editingFakeDnsIndex !== null ? fakeDns[editingFakeDnsIndex] : null
				}
			/>
		</VStack>
	);
};

export default CoreSettingsPage;
