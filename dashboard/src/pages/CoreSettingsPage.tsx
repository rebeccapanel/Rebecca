import { toneClass } from "lib/tone";
import { Tooltip, TooltipContent, TooltipTrigger } from "components/ui/tooltip";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "components/ui/accordion";
import { Field, FieldLabel } from "components/ui/field";
import { Badge } from "components/ui/badge";
import { Spinner } from "components/ui/spinner";
import { Button } from "components/ui/button";
import { Switch } from "components/ui/switch";
import { Input } from "components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "components/ui/dropdown-menu";
import { toast } from "components/ui/sonner";
import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import { withClass } from "lib/withClass";
import { Plus as AddIcon, SlidersHorizontal, ArrowDown, Minimize2, Maximize2, ArrowLeftRight, ArrowUp, Upload, Zap, CircleCheck, ChevronsUp, CloudUpload, Trash2 as DeleteIcon, Pencil as EditIcon, Ellipsis, Globe, RefreshCw as ReloadIcon, Scale, Wrench, CircleX } from "lucide-react";

import { useDisclosure } from "hooks/useDisclosure";
import { useBreakpointValue } from "hooks/useBreakpointValue";

import { cn } from "lib/cn";
import { CompactChips, CompactTextWithCopy } from "components/CompactPopover";
import { PanelSelect as Select } from "components/common/PanelSelect";
import { SearchInput } from "components/common/SearchInput";
import { ListCard } from "components/ui/list-card";
import { SegmentedControl } from "components/ui/segmented-control";
import { RefreshSplitButton } from "components/users/RefreshSplitButton";
import { useIntervalRefresh } from "hooks/useIntervalRefresh";
import { buildSortOptions, DataTableSortMenu } from "components/ui/DataTableSortMenu";
import type { SortingState } from "@tanstack/react-table";
import { ConfirmDialog } from "components/dialogs/ConfirmDialog";
import {
	applyXrayPropagation,
	type PropagationOp,
	type PropagationSection,
	propagationKey,
} from "service/xrayPropagation";
import {
	DataTable,
	PageLoadingSkeleton,
	type DataTableBulkAction,
	type DataTableColumn,
	type DataTableRowAction,
	ResourceSummaryPills,
	TabSystem,
} from "components/ui";
import { useCoreSettings } from "contexts/CoreSettingsContext";
import { useDashboard } from "contexts/DashboardContext";
import useGetUser from "hooks/useGetUser";
import { isMullvadOutbound } from "utils/mullvad";
import { DEFAULT_SEARCH_MATCH_OPTIONS, matchesSearch } from "utils/searchMatch";
import {
	type FC,
	type ReactNode,
	useCallback,
	useEffect,
	lazy,
	useMemo,
	useRef,
	useState,
	Suspense,
} from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { SiMullvad, SiNordvpn, SiTorproject } from "react-icons/si";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation, useSearchParams } from "react-router-dom";
import { fetch as apiFetch, getAPIErrorMessage } from "service/http";
import psiphonIconUrl from "../assets/brands/psiphon.png";
import windscribeIconUrl from "../assets/brands/windscribe.png";
import type { BalancerFormValues } from "../components/BalancerModal";
import { ObservatorySettings } from "../components/xray/ObservatorySettings";
import { cleanLeastLoadSettings, type LeastLoadSettings } from "utils/xrayBalancer";
import { splitMultiValueText } from "../components/common/MultiValueAutocomplete";
import type { PsiphonProxyFormValues } from "../components/PsiphonProxyModal";
import type {
	ReverseFormValues,
	ReverseType,
} from "../components/ReverseModal";
import type { RoutingRule } from "../components/RuleModal";
import type { TorProxyFormValues } from "../components/TorProxyModal";
import type { WindscribeProxyFormValues } from "../components/WindscribeProxyModal";
import {
	canonicalizeRebeccaJson,
	type RebeccaJsonContext,
	stringifyRebeccaJson,
} from "../utils/jsonFormatting";
import { SizeFormatter } from "../utils/outbound";
import { computeOutboundIds } from "../utils/outboundId";
import { sumOutboundTraffic } from "../utils/outboundTraffic";

const JsonEditor = lazy(async () => ({
	default: (await import("../components/JsonEditor")).JsonEditor,
}));
const BalancerModal = lazy(async () => ({
	default: (await import("../components/BalancerModal")).BalancerModal,
}));
const DnsModal = lazy(async () => ({
	default: (await import("../components/DnsModal")).DnsModal,
}));
const DnsPresetsModal = lazy(async () => ({
	default: (await import("../components/DnsPresetsModal")).DnsPresetsModal,
}));
const FakeDnsModal = lazy(async () => ({
	default: (await import("../components/FakeDnsModal")).FakeDnsModal,
}));
const MullvadModal = lazy(async () => ({
	default: (await import("../components/MullvadModal")).MullvadModal,
}));
const NordVPNModal = lazy(async () => ({
	default: (await import("../components/NordVPNModal")).NordVPNModal,
}));
const OutboundModal = lazy(async () => ({
	default: (await import("../components/OutboundModal")).OutboundModal,
}));
const OutboundSubscriptionsModal = lazy(async () => ({
	default: (await import("../components/OutboundSubscriptionsModal"))
		.OutboundSubscriptionsModal,
}));
const PsiphonProxyModal = lazy(async () => ({
	default: (await import("../components/PsiphonProxyModal")).PsiphonProxyModal,
}));
const ReverseModal = lazy(async () => ({
	default: (await import("../components/ReverseModal")).ReverseModal,
}));
const RuleModal = lazy(async () => ({
	default: (await import("../components/RuleModal")).RuleModal,
}));
const RouteTestModal = lazy(async () => ({
	default: (await import("../components/xray/RouteTestModal")).RouteTestModal,
}));
const TorProxyModal = lazy(async () => ({
	default: (await import("../components/TorProxyModal")).TorProxyModal,
}));
const WarpModal = lazy(async () => ({
	default: (await import("../components/WarpModal")).WarpModal,
}));
const WindscribeProxyModal = lazy(async () => ({
	default: (await import("../components/WindscribeProxyModal"))
		.WindscribeProxyModal,
}));

const AddIconStyled = withClass(AddIcon, "w-3.5 h-3.5");
const DeleteIconStyled = withClass(DeleteIcon, "w-4 h-4");
const EditIconStyled = withClass(EditIcon, "w-4 h-4");
const ArrowUpIconStyled = withClass(ArrowUp, "w-4 h-4");
const ChevronDoubleUpIconStyled = withClass(ChevronsUp, "w-4 h-4");
const ArrowDownIconStyled = withClass(ArrowDown, "w-4 h-4");
const ReloadIconStyled = withClass(ReloadIcon, "w-4 h-4");
const FullScreenIconStyled = withClass(Maximize2, "w-4 h-4");
const ExitFullScreenIconStyled = withClass(Minimize2, "w-4 h-4");
const BasicTabIcon = withClass(SlidersHorizontal, "w-4 h-4");
const RoutingTabIcon = withClass(ArrowLeftRight, "w-4 h-4");
const OutboundTabIcon = withClass(Upload, "w-4 h-4");
const BalancerTabIcon = withClass(Scale, "w-4 h-4");
const DnsTabIcon = withClass(Globe, "w-4 h-4");
const AdvancedTabIcon = withClass(Wrench, "w-4 h-4");
const WarpIconStyled = withClass(CloudUpload, "w-4 h-4");
const BoltIconStyled = withClass(Zap, "w-4 h-4");
const CheckCircleIconStyled = withClass(CircleCheck, "w-3.5 h-3.5");
const XCircleIconStyled = withClass(CircleX, "w-3.5 h-3.5");
const MoreIconStyled = withClass(Ellipsis, "w-4 h-4");
const NordVPNIconStyled = () => (
	<span className="inline-flex text-[#4687ff]">
		{SiNordvpn({ size: 16, "aria-hidden": true })}
	</span>
);
const MullvadIconStyled = () => (
	<span className="inline-flex">
		{SiMullvad({ size: 16, "aria-hidden": true })}
	</span>
);
const TorIconStyled: FC<{ size?: number }> = ({ size = 16 }) => (
	<span className="inline-flex text-[#7d4698]">
		{SiTorproject({ size, "aria-hidden": true })}
	</span>
);
const WindscribeIconStyled = () => (
	<img src={windscribeIconUrl} alt="" aria-hidden="true" className="size-4 object-contain" />
);
const PsiphonIconStyled = () => (
	<img src={psiphonIconUrl} alt="" aria-hidden="true" className="size-4 object-contain" />
);
const ManagedOutboundBadge: FC<{ outbound: any }> = ({ outbound }) => {
	const meta = managedOutboundMeta(outbound);
	if (!meta || meta.provider === "tor") return null;
	const providerName =
		meta.provider === "windscribe" ? "Windscribe" : "Psiphon";
	const icon =
		meta.provider === "windscribe" ? (
			<WindscribeIconStyled />
		) : (
			<PsiphonIconStyled />
		);
	return (
		<Tooltip>
<TooltipTrigger asChild>
			<div className="flex flex-row items-center gap-1 px-1.5 py-0.5 rounded-xs bg-whiteAlpha-100 shrink-0">
				{icon}
			</div>
		</TooltipTrigger>
<TooltipContent>{
				meta.country
					? `${providerName} - ${meta.country.toUpperCase()}`
					: providerName
			}</TooltipContent>
</Tooltip>
	);
};
const compactActionButtonProps = {
	size: "xs" as const,
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
const isNonEmptyArray = (value: unknown) =>
	Array.isArray(value) && value.length > 0;
const isNonEmptyRecord = (value: unknown) =>
	Boolean(
		value &&
			typeof value === "object" &&
			!Array.isArray(value) &&
			Object.keys(value).length > 0,
	);
const isDnsConfigEnabled = (dns: unknown, fakeDnsValue: unknown) => {
	if (isNonEmptyArray(fakeDnsValue)) return true;
	if (!dns || typeof dns !== "object" || Array.isArray(dns)) return false;
	const dnsConfig = dns as Record<string, unknown>;
	return (
		isNonEmptyArray(dnsConfig.servers) || isNonEmptyRecord(dnsConfig.hosts)
	);
};
const createDefaultDnsConfig = () => ({
	servers: [] as any[],
	queryStrategy: "UseIP",
	tag: "dns_inbound",
	enableParallelQuery: false,
});
const DEFAULT_OBSERVATORY = {
	subjectSelector: [] as string[],
	probeUrl: "https://www.google.com/generate_204",
	probeInterval: "10m",
	enableConcurrency: true,
};
const DEFAULT_BURST_OBSERVATORY = {
	subjectSelector: [] as string[],
	pingConfig: {
		destination: "https://connectivitycheck.gstatic.com/generate_204",
		connectivity: "",
		interval: "1m",
		sampling: 10,
		timeout: "5s",
		httpMethod: "HEAD",
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
type EditableCoreConfig = Record<string, any>;
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

const formatOutboundDelay = (delay?: number) => {
	if (typeof delay !== "number" || !Number.isFinite(delay)) return null;
	return delay >= 0 && delay < 1 ? "<1 ms" : `${delay} ms`;
};
type BalancerConfig = {
	tag: string;
	selector: string[];
	fallbackTag?: string;
	strategy?: { type: string; settings?: LeastLoadSettings };
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

type ManagedOutboundProvider = "tor" | "windscribe" | "psiphon";

type ManagedOutboundMeta = {
	provider: ManagedOutboundProvider;
	country?: string;
};

const managedOutboundMeta = (outbound: any): ManagedOutboundMeta | null => {
	const metadataProvider = String(outbound?.rebecca_proxy ?? "")
		.trim()
		.toLowerCase();
	if (["tor", "windscribe", "psiphon"].includes(metadataProvider)) {
		return { provider: metadataProvider as ManagedOutboundProvider };
	}
	const tag = String(outbound?.tag ?? "").trim();
	const match = tag.match(
		/(?:^|[-_.])(tor|windscribe|psiphon)(?:-([a-z]{2}))?$/i,
	);
	if (!match) return null;
	return {
		provider: match[1].toLowerCase() as ManagedOutboundProvider,
		country: match[2]?.toLowerCase(),
	};
};

const stringArray = (value: unknown): string[] =>
	Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: typeof value === "string" && value
			? [value]
			: [];

const readVlessOutboundAccount = (outbound: any): VlessOutboundAccount => {
	const settings = outbound?.settings ?? {};
	if (Object.hasOwn(settings, "address") || settings?.reverse) {
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
		octets.every(
			(octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255,
		)
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
	const security = String(
		outbound?.streamSettings?.security ?? "none",
	).toLowerCase();
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
}> = ({ title, children }) => {
	const headerBg = "bg-gray-50 dark:bg-whiteAlpha-100";
	const panelBg = "bg-white dark:bg-surface-dark";
	const borderColor = "border-gray-200! dark:border-whiteAlpha-300!";
	return (
		<Accordion type="single" collapsible>
			<AccordionItem value="section" className={cn("border rounded-md overflow-hidden", borderColor, panelBg)}>
					<AccordionTrigger className={cn("px-3 md:px-4 py-2.5", headerBg)}>
						<div className="flex-1 text-start">
							<p className="font-semibold text-[0.875rem] md:text-[1rem]">
								{title}
							</p>
						</div>
						
					</AccordionTrigger>
				<AccordionContent className="p-0">
					<div className="flex flex-col items-stretch gap-0">
						{children}
					</div>
				</AccordionContent>
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
	const labelColor = "text-gray-700 dark:text-whiteAlpha-800";
	const descriptionColor = "text-gray-500 dark:text-whiteAlpha-600";
	const dividerColor = "border-t-gray-100! dark:border-t-whiteAlpha-200!";
	return (
		<div className={cn("grid grid-cols-[1fr] md:grid-cols-[minmax(220px,_32%)_1fr] gap-2 md:gap-4 px-3 md:px-4 py-3 border-t first:border-t-0 items-center", dividerColor)}>
			<div className="min-w-0!">
				<FieldLabel htmlFor={controlId} className={cn("text-[0.875rem] font-semibold", description ? "mb-1" : "mb-0", labelColor)}>
					{label}
				</FieldLabel>
				{description && (
					<p className={cn("text-[0.75rem] leading-[1.45]", descriptionColor)}>
						{description}
					</p>
				)}
			</div>
			<Field id={controlId} className="w-full">
				{children(controlId)}
			</Field>
		</div>
	);
};

export const CoreSettingsPage: FC = () => {
	const location = useLocation();
	const [searchParams] = useSearchParams();
	const requestedTarget = searchParams.get("target") || "master";
	const { t } = useTranslation();
	const {
		fetchCoreSettings,
		fetchConfigTargets,
		updateConfig,
		config: loadedConfig,
		configTargets,
		isPostLoading,
		restartCore,
		updateConfigTargetMode,
	} = useCoreSettings();
	const config = loadedConfig as EditableCoreConfig | null;
	const { userData, getUserIsSuccess } = useGetUser();
	const onEditingCore = useDashboard((state) => state.onEditingCore);
	const canManageXraySettings =
		getUserIsSuccess && Boolean(userData.permissions?.sections.xray);
	const [selectedTarget, setSelectedTarget] = useState(requestedTarget);
	useEffect(() => setSelectedTarget(requestedTarget), [requestedTarget]);
	const [pendingPropagations, setPendingPropagations] = useState<
		PropagationOp[]
	>([]);
	const [deleteWarning, setDeleteWarning] = useState<{
		description: string;
		onConfirm: () => void;
	} | null>(null);
	
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
		isOpen: isRouteTestOpen,
		onOpen: onRouteTestOpen,
		onClose: onRouteTestClose,
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
		isOpen: isMullvadOpen,
		onOpen: onMullvadOpen,
		onClose: onMullvadClose,
	} = useDisclosure();
	// the outbound the Mullvad window opens on; undefined for a new one
	const [mullvadEditTag, setMullvadEditTag] = useState<string>();
	const openMullvad = (tag?: string) => {
		setMullvadEditTag(tag);
		onMullvadOpen();
	};
	const {
		isOpen: isOutboundSubsOpen,
		onOpen: onOutboundSubsOpen,
		onClose: onOutboundSubsClose,
	} = useDisclosure();
	const {
		isOpen: isTorProxyOpen,
		onOpen: onTorProxyOpen,
		onClose: onTorProxyClose,
	} = useDisclosure();
	const {
		isOpen: isWindscribeProxyOpen,
		onOpen: onWindscribeProxyOpen,
		onClose: onWindscribeProxyClose,
	} = useDisclosure();
	const {
		isOpen: isPsiphonProxyOpen,
		onOpen: onPsiphonProxyOpen,
		onClose: onPsiphonProxyClose,
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
	const [outboundSearchMatch, setOutboundSearchMatch] = useState(
		DEFAULT_SEARCH_MATCH_OPTIONS,
	);
	const [outboundAutoRefresh, setOutboundAutoRefresh] = useState(0);
	const [selectedOutboundIds, setSelectedOutboundIds] = useState<string[]>([]);
	const [outboundTestType, setOutboundTestType] =
		useState<OutboundTestType>("latency");
	const [testingAllOutbounds, setTestingAllOutbounds] = useState(false);
	const [isApplyingTorProxy, setIsApplyingTorProxy] = useState(false);
	const [isApplyingWindscribeProxy, setIsApplyingWindscribeProxy] =
		useState(false);
	const [isApplyingPsiphonProxy, setIsApplyingPsiphonProxy] = useState(false);
	const [routingRuleData, setRoutingRuleData] = useState<any[]>([]);
	const [routingRuleSearch, setRoutingRuleSearch] = useState("");
	const [routingSorting, setRoutingSorting] = useState<SortingState>([]);
	const [subscriptionSorting, setSubscriptionSorting] = useState<SortingState>([]);
	const [outboundSorting, setOutboundSorting] = useState<SortingState>([]);
	const [managedOutboundSorting, setManagedOutboundSorting] = useState<SortingState>([]);
	const [reverseSorting, setReverseSorting] = useState<SortingState>([]);
	const [balancerSorting, setBalancerSorting] = useState<SortingState>([]);
	const [dnsSorting, setDnsSorting] = useState<SortingState>([]);
	const [fakeDnsSorting, setFakeDnsSorting] = useState<SortingState>([]);
	const [routingRuleSearchMatch, setRoutingRuleSearchMatch] = useState(
		DEFAULT_SEARCH_MATCH_OPTIONS,
	);
	const [routeTestRule, setRouteTestRule] = useState<RoutingRule | null>(null);
	const [balancersData, setBalancersData] = useState<BalancerRow[]>([]);
	const [dnsServers, setDnsServers] = useState<any[]>([]);
	const [fakeDns, setFakeDns] = useState<any[]>([]);
	const [outboundsTraffic, setOutboundsTraffic] = useState<any[]>([]);
	const [outboundIds, setOutboundIds] = useState<string[]>([]);
	const [outboundReset, setOutboundReset] = useState<{
		index: number;
		scope: "target" | "all";
	} | null>(null);
	const [outboundTestStates, setOutboundTestStates] = useState<
		Record<number, OutboundTestState>
	>({});
	const [outboundHealthStates, setOutboundHealthStates] = useState<
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
	const isMobile = useBreakpointValue({ base: true, md: false });
	const [jsonKey, setJsonKey] = useState(0); // force re-render of JsonEditor
	const [advancedJsonValid, setAdvancedJsonValid] = useState(true);
	const [warpOptionValue, setWarpOptionValue] = useState<string>("");
	const [warpCustomDomain, setWarpCustomDomain] = useState<string>("");
	const [activeTab, setActiveTab] = useState<number>(0);
	const { data: serverIPs } = useQuery({ queryKey: ["server-ips", selectedTarget], queryFn: () =>
			apiFetch<{ ipv4: string; ipv6: string }>("/core/ips", {
				query: { target: selectedTarget },
			}), staleTime: 5 * 60 * 1000, // 5 minutes
			enabled: canManageXraySettings && activeTab === 0, });
	const [isChangingTargetMode, setIsChangingTargetMode] = useState(false);
	const selectedTargetInfo = useMemo(
		() => configTargets.find((target) => target.id === selectedTarget),
		[configTargets, selectedTarget],
	);
	const isMasterTarget =
		selectedTarget === "master" || selectedTargetInfo?.type === "master";
	const outboundNodeTargetRequiredMessage = t(
		"pages.xray.outbound.testNodeTargetRequired",
	);
	const outboundAddressRequiredMessage = t(
		"pages.xray.outbound.testAddressRequired",
	);
	const outboundTestTypeLabels: Record<OutboundTestType, string> = {
		latency: t("pages.xray.outbound.testTypeLatency"),
		tcp: t("pages.xray.outbound.testTypeTcp"),
		icmp: t("pages.xray.outbound.testTypeIcmp"),
	};
	const outboundTestResultLabel = useCallback((result: OutboundTestResult) => {
		const delayLabel = formatOutboundDelay(result.delay) ?? "-";
		const targetLabel = result.address
			? result.port
				? `${result.address}:${result.port}`
				: result.address
			: "";
		const statusCodeLabel = result.statusCode ? ` (${result.statusCode})` : "";
		return [delayLabel + statusCodeLabel, targetLabel]
			.filter(Boolean)
			.join(" · ");
	}, []);
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
		],
		[],
	);
	const readHashTab = useCallback(
		(hash = window.location.hash) => (hash || "").replace(/^#/, "").toLowerCase(),
		[],
	);

	useEffect(() => {
		const syncFromHash = (hash: string) => {
			const idx = tabKeys.indexOf(readHashTab(hash));
			if (idx >= 0) {
				setActiveTab(idx);
			} else {
				setActiveTab(0);
				window.history.replaceState(
					null,
					"",
					`${window.location.pathname}${window.location.search}#${tabKeys[0]}`,
				);
			}
		};
		syncFromHash(location.hash);
		const onHashChange = () => syncFromHash(window.location.hash);
		window.addEventListener("hashchange", onHashChange);
		return () => window.removeEventListener("hashchange", onHashChange);
	}, [location.hash, readHashTab, tabKeys]);

	const pageShellBg = "bg-white dark:bg-surface-dark";
	const pageShellBorder = "border-gray-200! dark:border-whiteAlpha-300!";
	const pageShellBorderTop = "border-t-gray-200! dark:border-t-whiteAlpha-300!";
	const pageHintColor = "text-gray-600 dark:text-gray-300";

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
		if (!configTargets.length) return;
		if (!configTargets.some((target) => target.id === selectedTarget)) {
			setSelectedTarget("master");
		}
	}, [configTargets, selectedTarget]);

	useEffect(() => {
		if (!canManageXraySettings) return;
		fetchConfigTargets().catch((error) => {
			toast.error(t("core.errorFetchingConfig"), { description: error.message, duration: 3000 });
		});
	}, [canManageXraySettings, fetchConfigTargets, toast, t]);

	useEffect(() => {
		if (!canManageXraySettings) {
			onEditingCore(false);
			return;
		}

		onEditingCore(true);
		fetchCoreSettings(selectedTarget).catch((error) => {
			toast.error(t("core.errorFetchingConfig"), { description: error.message, duration: 3000 });
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
			setJsonKey((prev) => prev + 1); // force JsonEditor re-mount
		}
	}, [
		buildBalancerRows,
		config,
		form,
		syncOutboundDisplay,
		syncRoutingRuleDisplay,
	]);


	const { mutate: handleRestartCore, isPending: isRestarting } = useMutation({ mutationFn: restartCore, onSuccess: () => {
				toast.success(t("core.restartSuccess"), { duration: 3000 });
			},
			onError: (e: any) => {
				toast.error(t("core.generalErrorMessage"), { description: e.response?.data?.detail || e.message, duration: 3000 });
			}, });

	const propagationBaseFor = (section: PropagationSection, current: unknown) => {
		if (current == null) return null;
		const pending = pendingPropagations.find(
			(op) =>
				op.source === selectedTarget &&
				op.section === section &&
				propagationKey(op.after) === propagationKey(current),
		);
		return pending ? pending.before : current;
	};

	const queuePropagation = (
		section: PropagationSection,
		current: unknown,
		after: unknown,
		targets: string[],
	) => {
		setPendingPropagations((previous) => {
			const next = [...previous];
			const index =
				current == null
					? -1
					: next.findIndex(
							(op) =>
								op.source === selectedTarget &&
								op.section === section &&
								propagationKey(op.after) === propagationKey(current),
						);
			if (index >= 0) {
				if (targets.length) {
					next[index] = { ...next[index], after, targets };
				} else {
					next.splice(index, 1);
				}
			} else if (targets.length) {
				next.push({
					source: selectedTarget,
					section,
					before: current ?? null,
					after,
					targets,
				});
			}
			return next;
		});
	};

	const applyPendingPropagations = async () => {
		const operations = pendingPropagations.filter(
			(op) => op.source === selectedTarget,
		);
		setPendingPropagations([]);
		const summary = { applied: 0, skipped: 0, failed: 0 };
		for (const operation of operations) {
			try {
				const results = await applyXrayPropagation(operation);
				for (const result of results) {
					if (result.applied) summary.applied += 1;
					else if (result.error) summary.failed += 1;
					else summary.skipped += 1;
				}
			} catch {
				summary.failed += operation.targets.length;
			}
		}
		return summary;
	};

	const countOutboundReferences = (tags: string[]) => {
		const names = tags.filter(Boolean);
		if (!names.length) return 0;
		return (
			getRoutingRules().filter((rule) =>
				names.includes(String(rule.outboundTag ?? "")),
			).length +
			getBalancers().filter((balancer) =>
				balancer.selector.some((tag) => names.includes(tag)),
			).length
		);
	};

	const confirmOutboundRemoval = (tags: unknown[], remove: () => void) => {
		const references = countOutboundReferences(
			tags.map((tag) => String(tag ?? "")),
		);
		if (!references) {
			remove();
			return;
		}
		setDeleteWarning({
			description: t("pages.xray.propagate.deleteOutboundReferenced", {
				count: references,
			}),
			onConfirm: remove,
		});
	};

	const renameOutboundReferences = (oldTag: string, newTag: string) => {
		commitRoutingRules(
			getRoutingRules().map((rule) =>
				rule.outboundTag === oldTag ? { ...rule, outboundTag: newTag } : rule,
			),
		);
		commitBalancers(
			getBalancers().map((balancer) => ({
				...balancer,
				selector: balancer.selector.map((tag) =>
					tag === oldTag ? newTag : tag,
				),
			})),
		);
	};

	const handleOnSave = form.handleSubmit(({ config: submittedConfig }: any) => {
		const nextConfig = JSON.parse(JSON.stringify(submittedConfig || {}));
		if (!dnsEnabledState) {
			delete nextConfig.dns;
			delete nextConfig.fakedns;
		} else if (!nextConfig.dns) {
			nextConfig.dns = createDefaultDnsConfig();
		}
		updateConfig(nextConfig, selectedTarget)
			.then(async () => {
				form.reset({ config: nextConfig });
				initialConfigStringRef.current = serializeConfig(nextConfig);
				setDnsEnabledState(Boolean(nextConfig.dns));
				toast.success(t("core.successMessage"), { duration: 3000 });
				const summary = await applyPendingPropagations();
				if (summary.applied + summary.skipped + summary.failed > 0) {
					toast(t("pages.xray.propagate.summary", summary), { duration: 5000 });
				}
			})
			.catch((e) => {
				let message = t("core.generalErrorMessage");
				const detail = e?.response?._data?.detail;
				if (typeof detail === "object" && detail !== null)
					message = detail[Object.keys(detail)[0]];
				if (typeof detail === "string") message = detail;
				toast.error(message, { duration: 3000 });
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
			await fetchConfigTargets();
			await fetchCoreSettings(selectedTarget);
		} catch {
			toast.error(t("core.generalErrorMessage"), { duration: 3000 });
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

	useIntervalRefresh(outboundAutoRefresh, activeTab === 2, () => void fetchOutboundsTraffic().catch(() => undefined));

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

	const confirmOutboundTrafficReset = async () => {
		if (!outboundReset) return;
		await _resetOutboundTraffic(outboundReset.index, outboundReset.scope);
		setOutboundReset(null);
	};

	const testOutbound = async (index: number) => {
		const outbounds = getOutbounds();
		const outbound = outbounds[index];
		if (!outbound) {
			toast.error(t("pages.xray.outbound.testError"), { duration: 3000 });
			return;
		}

		if (isMasterTarget) {
			toast.warning(outboundNodeTargetRequiredMessage, { duration: 4000 });
			return;
		}

		const outboundTag = String(outbound.tag ?? "").trim();
		const protocol = String(outbound.protocol ?? "")
			.trim()
			.toLowerCase();
		if (protocol === "blackhole" || outboundTag.toLowerCase() === "blocked") {
			toast.warning(t("pages.xray.outbound.testBlocked"), { duration: 3000 });
			return;
		}
		if (
			(outboundTestType === "tcp" || outboundTestType === "icmp") &&
			findOutboundAddress(outbound).length === 0
		) {
			toast.warning(outboundAddressRequiredMessage, { duration: 4000 });
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
					toast.success(`${t("pages.xray.outbound.testSuccess")}: ${outboundTestResultLabel(result)}`, { duration: 3000 });
				} else {
					const errorMessage =
						result.error || t("pages.xray.outbound.testFailed");
					toast.error(`${t("pages.xray.outbound.testFailed")}: ${errorMessage}`, { duration: 4000 });
				}
				return;
			}

			const message = response?.msg || t("pages.xray.outbound.testError");
			const failureResult: OutboundTestResult = {
				success: false,
				error: message,
			};
			setOutboundTestStates((prev) => ({
				...prev,
				[index]: { testing: false, result: failureResult },
			}));
			toast.error(message, { duration: 3000 });
		} catch (error: any) {
			const detail =
				error?.response?._data?.detail ??
				error?.data?.detail ??
				error?.message ??
				t("pages.xray.outbound.testError");
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
			toast.error(`${t("pages.xray.outbound.testError")}: ${detailText}`, { duration: 4000 });
		}
	};

	const checkOutboundHealth = async (index: number) => {
		const outbounds = getOutbounds();
		const outbound = outbounds[index];
		if (!outbound) return;
		if (!managedOutboundMeta(outbound)) {
			toast.warning(t("pages.xray.outbound.healthSupported"), { duration: 4000 });
			return;
		}
		if (isMasterTarget) {
			toast.warning(outboundNodeTargetRequiredMessage, { duration: 4000 });
			return;
		}
		setOutboundHealthStates((prev) => ({
			...prev,
			[index]: { testing: true, result: null },
		}));
		try {
			const response = await apiFetch<{
				success: boolean;
				obj?: OutboundTestResult;
				msg?: string;
			}>("/panel/xray/outboundHealth", {
				method: "POST",
				body: {
					outbound: JSON.stringify(outbound),
					allOutbounds: JSON.stringify(outbounds),
					target_id: selectedTarget,
					test_type: "latency",
				},
			});
			const result = response?.obj ?? {
				success: false,
				error: response?.msg || t("pages.xray.outbound.healthFailed"),
			};
			setOutboundHealthStates((prev) => ({
				...prev,
				[index]: { testing: false, result },
			}));
			toast(result.success
					? `${t("pages.xray.outbound.healthHealthy")}: ${outboundTestResultLabel(result)}`
					: `${t("pages.xray.outbound.healthFailed")}: ${result.error || t("unknown")}`, { duration: 4000 });
		} catch (error: unknown) {
			const detail =
				getAPIErrorMessage(error) || t("pages.xray.outbound.healthFailed");
			const result = { success: false, error: detail };
			setOutboundHealthStates((prev) => ({
				...prev,
				[index]: { testing: false, result },
			}));
			toast.error(`${t("pages.xray.outbound.healthFailed")}: ${detail}`, { duration: 4000 });
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

	const addTorOutbound = async (values: TorProxyFormValues) => {
		setIsApplyingTorProxy(true);
		try {
			const response = await apiFetch<{
				success: boolean;
				obj?: { outbound?: any; outbounds?: any[]; message?: string };
				msg?: string;
			}>("/panel/xray/tor/setup", {
				method: "POST",
				body: {
					target_id: selectedTarget,
					locations: values.locations,
					start_port: values.startPort,
					port_step: values.portStep,
					direction: values.direction,
					tag_prefix: values.tagPrefix.trim(),
					strict: values.strict,
				},
			});
			const generatedOutbounds = response?.obj?.outbounds?.length
				? response.obj.outbounds
				: response?.obj?.outbound
					? [response.obj.outbound]
					: [];
			if (!response?.success || generatedOutbounds.length === 0) {
				throw new Error(response?.msg || t("pages.xray.tor.failed"));
			}
			const outbounds = getOutbounds();
			const duplicate = generatedOutbounds.find((outbound) =>
				outbounds.some(
					(item: any) => String(item?.tag ?? "") === String(outbound.tag ?? ""),
				),
			);
			if (duplicate) {
				throw new Error(
					t("pages.xray.outbound.tagExistsNamed", {
						tag: String(duplicate.tag ?? ""),
					}),
				);
			}
			for (const outbound of generatedOutbounds) {
				outbounds.push(outbound);
			}
			commitOutbounds(outbounds);
			onTorProxyClose();
			toast.success(response.obj?.message || t("pages.xray.tor.added"), { duration: 4000 });
		} catch (error: any) {
			const detail =
				error?.response?._data?.detail ??
				error?.data?.detail ??
				error?.message ??
				t("pages.xray.tor.failed");
			toast.error(typeof detail === "string" ? detail : JSON.stringify(detail), { duration: 5000 });
		} finally {
			setIsApplyingTorProxy(false);
		}
	};

	const addWindscribeOutbound = async (values: WindscribeProxyFormValues) => {
		setIsApplyingWindscribeProxy(true);
		try {
			const location = values.location.split(",")[0]?.trim().toLowerCase();
			const response = await apiFetch<{
				success: boolean;
				obj?: { outbound?: any; message?: string };
				msg?: string;
			}>("/panel/xray/windscribe/setup", {
				method: "POST",
				body: {
					target_id: selectedTarget,
					location,
					port: values.port,
					tag: values.tag.trim(),
				},
			});
			const outbound = response?.obj?.outbound;
			if (!response?.success || !outbound) {
				throw new Error(response?.msg || t("pages.xray.windscribe.failed"));
			}
			const outbounds = getOutbounds();
			const existingIndex = outbounds.findIndex(
				(item: any) => String(item?.tag ?? "") === String(outbound.tag ?? ""),
			);
			if (existingIndex >= 0) {
				outbounds[existingIndex] = outbound;
			} else {
				outbounds.push(outbound);
			}
			commitOutbounds(outbounds);
			onWindscribeProxyClose();
			toast.success(response.obj?.message || t("pages.xray.windscribe.added"), { duration: 4000 });
		} catch (error: any) {
			const detail =
				error?.response?._data?.detail ??
				error?.data?.detail ??
				error?.message ??
				t("pages.xray.windscribe.failed");
			toast.error(typeof detail === "string" ? detail : JSON.stringify(detail), { duration: 5000 });
		} finally {
			setIsApplyingWindscribeProxy(false);
		}
	};

	const addPsiphonOutbounds = async (values: PsiphonProxyFormValues) => {
		setIsApplyingPsiphonProxy(true);
		try {
			const locations = splitMultiValueText(values.locations)
				.map((location) => location.trim().toLowerCase())
				.filter(Boolean);
			const response = await apiFetch<{
				success: boolean;
				obj?: { outbounds?: any[]; message?: string };
				msg?: string;
			}>("/panel/xray/psiphon/setup", {
				method: "POST",
				body: {
					target_id: selectedTarget,
					config: values.config,
					locations,
					port: values.port,
					tag: values.tag.trim(),
				},
			});
			const generatedOutbounds = response?.obj?.outbounds ?? [];
			if (!response?.success || generatedOutbounds.length === 0) {
				throw new Error(response?.msg || t("pages.xray.psiphon.failed"));
			}
			const outbounds = getOutbounds();
			for (const outbound of generatedOutbounds) {
				const existingIndex = outbounds.findIndex(
					(item: any) =>
						String(item?.tag ?? "") === String(outbound?.tag ?? ""),
				);
				if (existingIndex >= 0) outbounds[existingIndex] = outbound;
				else outbounds.push(outbound);
			}
			commitOutbounds(outbounds);
			onPsiphonProxyClose();
			toast.success(response.obj?.message || t("pages.xray.psiphon.added"), { duration: 4000 });
		} catch (error: any) {
			const detail =
				error?.response?._data?.detail ??
				error?.data?.detail ??
				error?.message ??
				t("pages.xray.psiphon.failed");
			toast.error(typeof detail === "string" ? detail : JSON.stringify(detail), { duration: 5000 });
		} finally {
			setIsApplyingPsiphonProxy(false);
		}
	};

	const editOutbound = (index: number) => {
		setEditingOutboundIndex(index);
		onOutboundOpen();
	};

	const deleteOutbound = (index: number) => {
		const outbounds = getOutbounds();
		if (index < 0 || index >= outbounds.length) return;
		confirmOutboundRemoval([outbounds[index]?.tag], () => {
			const current = getOutbounds();
			current.splice(index, 1);
			commitOutbounds(current);
			setSelectedOutboundIds((selected) =>
				selected.filter((id) => Number(id) !== index),
			);
		});
	};

	const deleteSelectedOutbounds = (ids: string[]) => {
		const indexes = ids
			.map((id) => Number(id))
			.filter((index) => Number.isInteger(index) && index >= 0)
			.sort((a, b) => b - a);
		if (!indexes.length) return;
		const outbounds = getOutbounds();
		confirmOutboundRemoval(
			indexes.map((index) => outbounds[index]?.tag),
			() => {
				const current = getOutbounds();
				for (const index of indexes) {
					if (index >= 0 && index < current.length) {
						current.splice(index, 1);
					}
				}
				commitOutbounds(current);
				setSelectedOutboundIds([]);
			},
		);
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

	const moveOutboundToTop = (index: number) => {
		moveOutbound(index, 0);
	};

	const moveOutboundDown = (index: number) => {
		moveOutbound(index, index + 1);
	};

	const filteredRoutingRules = useMemo(() => {
		const rows = routingRuleData.map((rule, originalIndex) => ({
			rule,
			originalIndex,
		}));
		if (!routingRuleSearch.trim()) return rows;
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
				.join(" ");
			return matchesSearch(haystack, routingRuleSearch, routingRuleSearchMatch);
		});
	}, [routingRuleData, routingRuleSearch, routingRuleSearchMatch]);

	const filteredOutboundData = useMemo(() => {
		const rows = outboundData.map((outbound, originalIndex) => ({
			outbound,
			originalIndex,
		}));
		const matches = outboundSearch.trim()
			? rows.filter(({ outbound }) =>
					matchesSearch(
						JSON.stringify(outbound),
						outboundSearch,
						outboundSearchMatch,
					),
				)
			: rows;
		return matches;
	}, [
		outboundData,
		outboundSearch,
		outboundSearchMatch,
	]);
	const managedOutboundData = useMemo(
		() =>
			filteredOutboundData.filter(({ outbound }) =>
				managedOutboundMeta(outbound),
			),
		[filteredOutboundData],
	);
	const standardOutboundData = useMemo(
		() =>
			filteredOutboundData.filter(
				({ outbound }) => !managedOutboundMeta(outbound),
			),
		[filteredOutboundData],
	);
	const managedOutboundTotal = useMemo(
		() =>
			outboundData.filter((outbound) => managedOutboundMeta(outbound)).length,
		[outboundData],
	);

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

	const handleRuleModalSubmit = (rule: RoutingRule, targetIds: string[]) => {
		const currentRules = getRoutingRules();
		queuePropagation(
			"routing.rules",
			editingRuleIndex !== null ? (canonicalRoutingRules[editingRuleIndex] ?? null) : null,
			rule,
			targetIds,
		);
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
				observatory.subjectSelector = Array.from(
					new Set([...(observatory.subjectSelector ?? []), ...collectSelectors(leastPings)]),
				);
				nextConfig.observatory = observatory;
			} else {
				delete nextConfig.observatory;
			}

			if (leastLoads.length > 0) {
				const burstObservatory = nextConfig.burstObservatory
					? { ...nextConfig.burstObservatory }
					: { ...DEFAULT_BURST_OBSERVATORY };
				burstObservatory.subjectSelector = Array.from(
					new Set([...(burstObservatory.subjectSelector ?? []), ...collectSelectors(leastLoads)]),
				);
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
		const settings =
			typeof balancer.strategy === "object" ? balancer.strategy?.settings : undefined;
		if (strategyType && strategyType !== "random") {
			normalized.strategy =
				settings && Object.keys(settings).length
					? { type: strategyType, settings }
					: { type: strategyType };
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

	const strategySettingsAt = useCallback(
		(index: number | null): LeastLoadSettings | undefined => {
			if (index === null) return undefined;
			const strategy = getBalancers()[index]?.strategy;
			return typeof strategy === "object" ? strategy.settings : undefined;
		},
		[getBalancers],
	);

	const toBalancerConfig = useCallback(
		(values: BalancerFormValues): BalancerConfig => {
			const base: BalancerConfig = {
				tag: values.tag.trim(),
				selector: values.selector.map((item) => item.trim()).filter(Boolean),
				fallbackTag: values.fallbackTag ?? "",
			};
			if (values.strategy && values.strategy !== "random") {
				const settings =
					values.strategy === "leastLoad"
						? cleanLeastLoadSettings(values.strategySettings)
						: undefined;
				base.strategy = settings
					? { type: values.strategy, settings }
					: { type: values.strategy };
			}
			return base;
		},
		[],
	);

	const handleBalancerSubmit = (
		values: BalancerFormValues,
		targetIds: string[],
	) => {
		const balancers = getBalancers();
		const nextBalancer = toBalancerConfig(values);
		let oldTag: string | undefined;
		const previous =
			editingBalancerIndex !== null &&
			editingBalancerIndex >= 0 &&
			editingBalancerIndex < balancers.length
				? balancers[editingBalancerIndex]
				: undefined;
		queuePropagation("balancers", previous ?? null, nextBalancer, targetIds);
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
		const tag = balancers[index].tag;
		const removeBalancer = () => {
			const current = getBalancers();
			current.splice(index, 1);
			commitBalancers(current);
		};
		const references = tag
			? getRoutingRules().filter((rule) => rule.balancerTag === tag).length
			: 0;
		if (!references) {
			removeBalancer();
			return;
		}
		setDeleteWarning({
			description: t("pages.xray.propagate.deleteBalancerReferenced", {
				count: references,
			}),
			onConfirm: removeBalancer,
		});
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
				toast.error(t("pages.xray.reverse.vlessOutboundInvalid"), { duration: 4000 });
				return;
			}
			if (!isSecureVlessConnection(outbound, account)) {
				toast.error(t("pages.xray.reverse.transportSecurityRequired"), { duration: 5000 });
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
				toast.error(t("pages.xray.reverse.vlessInboundInvalid"), { duration: 4000 });
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
					outbound.settings.vnext?.map((obj: any) =>
						formatOutboundEndpoint(obj.address, obj.port),
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
					outbound.settings.vnext?.map((obj: any) =>
						formatOutboundEndpoint(obj.address, obj.port),
					) || []
				).filter(Boolean);
			case "http":
			case "socks":
			case "shadowsocks":
			case "trojan":
				return (
					outbound.settings.servers?.map((obj: any) =>
						formatOutboundEndpoint(obj.address, obj.port),
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

	const testSubscriptionOutbound = async (
		outbound: OutboundJson,
		index: number,
	) => {
		const stateKey = String(outbound.tag ?? `subscription-${index}`);
		if (!outbound) return;
		if (isMasterTarget) {
			toast.warning(outboundNodeTargetRequiredMessage, { duration: 4000 });
			return;
		}
		const outboundTag = String(outbound.tag ?? "").trim();
		const protocol = String(outbound.protocol ?? "")
			.trim()
			.toLowerCase();
		if (protocol === "blackhole" || outboundTag.toLowerCase() === "blocked") {
			toast.warning(t("pages.xray.outbound.testBlocked"), { duration: 3000 });
			return;
		}
		if (
			(outboundTestType === "tcp" || outboundTestType === "icmp") &&
			findOutboundAddress(outbound).length === 0
		) {
			toast.warning(outboundAddressRequiredMessage, { duration: 4000 });
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
						error: response?.msg || t("pages.xray.outbound.testError"),
					},
				},
			}));
		} catch (error: any) {
			const detail =
				error?.response?._data?.detail ??
				error?.data?.detail ??
				error?.message ??
				t("pages.xray.outbound.testError");
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
			toast.warning(outboundNodeTargetRequiredMessage, { duration: 4000 });
			return;
		}
		type TestItem =
			| { kind: "template"; index: number; outbound: OutboundJson }
			| {
					kind: "subscription";
					index: number;
					stateKey: string;
					outbound: OutboundJson;
			  };
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
				const tag = String(item.outbound.tag ?? "")
					.trim()
					.toLowerCase();
				const protocol = String(item.outbound.protocol ?? "")
					.trim()
					.toLowerCase();
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
			toast.warning(outboundTestType === "tcp" || outboundTestType === "icmp"
						? outboundAddressRequiredMessage
						: t("pages.xray.outbound.testNothing"), { duration: 4000 });
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
								error: response?.msg || t("pages.xray.outbound.testError"),
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
								error: response?.msg || t("pages.xray.outbound.testError"),
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
				t("pages.xray.outbound.testError");
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
			toast.error(`${t("pages.xray.outbound.testError")}: ${detailText}`, { duration: 4000 });
		} finally {
			setTestingAllOutbounds(false);
		}
	};

	const findOutboundTraffic = (outbound: any, index: number) => {
		return sumOutboundTraffic(
			outboundsTraffic,
			selectedTarget,
			outboundIds[index],
			outbound.tag,
			isMasterTarget,
		);
	};

	const findSubscriptionOutboundTraffic = (outbound: any) => {
		const outboundId = outboundsTraffic.find(
			(item) =>
				(item.target_id || "master") === selectedTarget &&
				item.tag === outbound.tag,
		)?.outbound_id;
		return sumOutboundTraffic(
			outboundsTraffic,
			selectedTarget,
			outboundId,
			outbound.tag,
			isMasterTarget,
		);
	};

	const renderOutboundTraffic = (traffic?: { up?: number; down?: number }) => (
		<div className="flex flex-row items-center gap-3 whitespace-nowrap text-[0.75rem] [font-variant-numeric:tabular-nums]">
			<p className="text-teal-400">
				↑ {SizeFormatter.sizeFormat(Number(traffic?.up) || 0)}
			</p>
			<p className="text-blue-400">
				↓ {SizeFormatter.sizeFormat(Number(traffic?.down) || 0)}
			</p>
		</div>
	);

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
								![
									"openvpn",
									"wireguard",
									"l2tp",
									"pptp",
									"ikev2",
									"anyconnect",
								].includes(protocol)
							) {
								return true;
							}
							const rawTproxy = inbound?.settings?.tproxy_enabled;
							return !(
								rawTproxy === false ||
								String(rawTproxy ?? "")
									.toLowerCase()
									.trim() === "false"
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
							const tag = String(outbound?.tag ?? "")
								.toLowerCase()
								.trim();
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
					if (String(outbound?.protocol).toLowerCase() !== "vless")
						return false;
					const account = readVlessOutboundAccount(outbound);
					const reverseTag = String(outbound?.settings?.reverse?.tag ?? "");
					return (
						Boolean(
							outbound?.tag && account.address && account.port && account.id,
						) &&
						isSecureVlessConnection(outbound, account) &&
						(!reverseTag || outbound?.tag === editingReverseRow?.connectionTag)
					);
				})
				.map((outbound: any) => String(outbound.tag)),
		[canonicalOutbounds, editingReverseRow?.connectionTag],
	);
	const vlessOutboundDetails = useMemo(
		() =>
			Object.fromEntries(
				canonicalOutbounds.map((outbound: any) => {
					const account = readVlessOutboundAccount(outbound);
					return [
						String(outbound?.tag ?? ""),
						{ credentialId: account.id, flow: account.flow },
					];
				}),
			),
		[canonicalOutbounds],
	);
	const outboundTestStateByTag = useMemo(() => {
		const next: Record<string, OutboundTestState> = {};
		canonicalOutbounds.forEach((outbound, index) => {
			const tag = String(outbound?.tag ?? "").trim();
			const state = outboundTestStates[index];
			if (tag && state) next[tag] = state;
		});
		subscriptionOutbounds.forEach((outbound, index) => {
			const tag = String(outbound?.tag ?? "").trim();
			const state =
				subscriptionOutboundTestStates[tag || `subscription-${index}`];
			if (tag && state) next[tag] = state;
		});
		return next;
	}, [
		canonicalOutbounds,
		outboundTestStates,
		subscriptionOutbounds,
		subscriptionOutboundTestStates,
	]);
	const outboundTestingByTag = useMemo(
		() =>
			Object.fromEntries(
				Object.entries(outboundTestStateByTag).map(([tag, state]) => [
					tag,
					state.testing,
				]),
			),
		[outboundTestStateByTag],
	);
	const withCachedOutboundLatency = useCallback(
		(tags: string[]) =>
			tags.map((tag) => {
				const delay = formatOutboundDelay(
					outboundTestStateByTag[tag]?.result?.delay,
				);
				const label = delay ? `${tag} · ${delay}` : tag;
				return { value: tag, label, title: label };
			}),
		[outboundTestStateByTag],
	);
	const outboundTagOptions = useMemo(
		() => withCachedOutboundLatency(availableOutboundTags),
		[availableOutboundTags, withCachedOutboundLatency],
	);
	const vlessOutboundTagOptions = useMemo(
		() => withCachedOutboundLatency(vlessOutboundTags),
		[vlessOutboundTags, withCachedOutboundLatency],
	);
	const testOutboundByTag = (tag: string) => {
		const templateIndex = canonicalOutbounds.findIndex(
			(outbound) => String(outbound?.tag ?? "").trim() === tag,
		);
		if (templateIndex >= 0) {
			void testOutbound(templateIndex);
			return;
		}
		const subscriptionIndex = subscriptionOutbounds.findIndex(
			(outbound) => String(outbound?.tag ?? "").trim() === tag,
		);
		if (subscriptionIndex >= 0) {
			void testSubscriptionOutbound(
				subscriptionOutbounds[subscriptionIndex],
				subscriptionIndex,
			);
		}
	};

	const existingReverseTags = useMemo(
		() =>
			Array.from(
				new Set([
					...availableInboundTags,
					...availableOutboundTags,
					...reverseData.map((reverse) => reverse.tag),
				]),
			).filter(
				(tag) =>
					tag &&
					tag !== (editingReverseIndex !== null ? editingReverseRow?.tag : ""),
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
			toast.warning(t("pages.xray.warp.domainExists"), { duration: 3000 });
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

	const warpDomainHelper = "text-gray-600 dark:text-gray-300";

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

	const handleMullvadSave = (
		outbound: OutboundJson,
		replaceIndex: number | null,
	) => {
		const previousTag =
			replaceIndex === null
				? ""
				: String(getOutbounds()[replaceIndex]?.tag ?? "");
		// a renamed outbound keeps its routing rules and balancers
		if (previousTag && previousTag !== outbound.tag) {
			renameOutboundReferences(previousTag, String(outbound.tag));
		}
		handleNordSave(outbound, replaceIndex);
	};

	const handleMullvadSaveMany = (outbounds: OutboundJson[]) => {
		commitOutbounds([...getOutbounds(), ...outbounds]);
	};

	const handleOutboundSave = (outboundJson: unknown, targetIds: string[]) => {
		const outbound = outboundJson as OutboundJson;
		const outbounds = getOutbounds();
		const tag = String(outbound.tag ?? "");
		const duplicateIndex = outbounds.findIndex(
			(item, index) => item?.tag === tag && index !== editingOutboundIndex,
		);
		if (duplicateIndex >= 0) {
			throw new Error(t("pages.xray.outbound.tagExistsNamed", { tag }));
		}
		const previous =
			editingOutboundIndex !== null &&
			editingOutboundIndex >= 0 &&
			editingOutboundIndex < outbounds.length
				? outbounds[editingOutboundIndex]
				: undefined;
		if (previous?.tag && previous.tag !== tag) {
			renameOutboundReferences(String(previous.tag), tag);
		}
		queuePropagation("outbounds", previous ?? null, outbound, targetIds);
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
			form.setValue(
				"config",
				canonicalizeRebeccaJson(cfg, "config") as EditableCoreConfig,
				{
					shouldDirty: true,
				},
			);
		} catch (_e) {
			// ignore invalid JSON until it becomes valid
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
			return <p className="text-gray-400">-</p>;
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
			return <p className="text-gray-400">-</p>;
		}
		const str = typeof value === "string" ? value : String(value);
		if (str.length > 30) {
			return <CompactTextWithCopy text={str} label={t("details")} />;
		}
		return <p>{str}</p>;
	};

	const renderAttrsCell = (attrsValue: string | undefined) => {
		if (!attrsValue) {
			return <p className="text-gray-400">-</p>;
		}
		try {
			const parsed = JSON.parse(attrsValue);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				const entries = Object.entries(parsed as Record<string, unknown>);
				if (!entries.length) {
					return <p className="text-gray-400">-</p>;
				}
				return (
					<div className="flex flex-wrap gap-1">
						{entries.map(([key, value]) => (
							<Badge key={key} className="bg-purple-100 text-purple-800 hover:bg-purple-200 dark:bg-purple-500/20 dark:text-purple-200">
								{`${key}: ${String(value)}`}
							</Badge>
						))}
					</div>
				);
			}
		} catch (_error) {
			// fall back to raw string rendering below
		}
		return (
			<p className="font-mono text-[0.75rem] whitespace-pre-wrap">
				{attrsValue}
			</p>
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
		<div className="flex flex-row items-center gap-1 flex-wrap">
			<Badge className="bg-purple-100 text-purple-800 hover:bg-purple-200 dark:bg-purple-500/20 dark:text-purple-200">
				{String(outbound.protocol ?? "-")}
			</Badge>
			{["vmess", "vless", "trojan", "shadowsocks"].includes(
				String(outbound.protocol ?? ""),
			) && (
				<>
					{outbound.streamSettings?.network && (
						<Badge className="bg-blue-100 text-blue-800 hover:bg-blue-200 dark:bg-blue-500/20 dark:text-blue-200">
							{String(outbound.streamSettings.network)}
						</Badge>
					)}
					{["tls", "reality"].includes(outbound.streamSettings?.security) && (
						<Badge className="bg-green-600 text-white">
							{String(outbound.streamSettings.security)}
						</Badge>
					)}
				</>
			)}
		</div>
	);

	const renderAddressList = (addresses: string[]) =>
		addresses.length === 0 ? (
			<p className="text-gray-400">-</p>
		) : (
			<div className="flex flex-col items-start gap-1">
				{addresses.map((addr) => (
					<CompactTextWithCopy key={addr} text={addr} label={addr} />
				))}
			</div>
		);

	const renderOutboundTestResult = (state: OutboundTestState | undefined) => {
		if (state?.testing) return <Spinner />;
		if (!state?.result)
			return (
				<p className="text-[0.75rem] text-gray-500">
					-
				</p>
			);

		const result = state.result;
		return (
			<Tooltip>
<TooltipTrigger asChild>
				<Badge className={cn(toneClass(result.success ? "green" : "red"), "[font-variant-numeric:tabular-nums] rounded-full gap-1")}>
					{result.success ? <CheckCircleIconStyled /> : <XCircleIconStyled />}
					{result.success
						? (formatOutboundDelay(result.delay) ?? "-")
						: t("pages.xray.outbound.testFailedBadge")}
				</Badge>
			</TooltipTrigger>
<TooltipContent>{
					result.success
						? result.output || outboundTestResultLabel(result)
						: result.error || t("pages.xray.outbound.testFailed")
				}</TooltipContent>
</Tooltip>
		);
	};

	const renderOutboundTestButton = (
		outbound: any,
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
			String(outbound.protocol ?? "")
				.toLowerCase()
				.trim() === "blackhole" ||
			String(outbound.tag ?? "")
				.toLowerCase()
				.trim() === "blocked";

		const testLabel = `${t("pages.xray.routeTester.test")} · ${outboundTestTypeLabels[outboundTestType]}`;
		return (
			<Tooltip>
<TooltipTrigger asChild>
				<Button aria-label={testLabel} disabled={Boolean(disabledReason) || isBlocked} onClick={(event) => {
						event.stopPropagation();
						onTest();
					}} size="sm" loading={Boolean(state?.testing)} className="size-8 p-0">{<BoltIconStyled />}</Button>
			</TooltipTrigger>
<TooltipContent>{disabledReason || testLabel}</TooltipContent>
</Tooltip>
		);
	};

	const renderOutboundHealthButton = (
		outbound: any,
		state: OutboundTestState | undefined,
		onCheck: () => void,
	) => {
		if (!managedOutboundMeta(outbound)) return null;
		const resultLabel = state?.result
			? state.result.success
				? `${t("pages.xray.outbound.healthHealthy")}: ${outboundTestResultLabel(state.result)}`
				: `${t("pages.xray.outbound.healthFailed")}: ${state.result.error || t("unknown")}`
			: t("pages.xray.outbound.healthCheck");
		return (
			<Tooltip>
<TooltipTrigger asChild>
				<Button aria-label={t("pages.xray.outbound.healthCheck")} disabled={isMasterTarget} onClick={(event) => {
						event.stopPropagation();
						onCheck();
					}} variant="outline" size="sm" loading={Boolean(state?.testing)} className="border border-green-500 bg-transparent text-green-600 hover:bg-green-50 dark:text-green-300 dark:hover:bg-green-500/10 size-8 p-0">{<CircleCheck className="w-[18px] h-[18px]" />}</Button>
			</TooltipTrigger>
<TooltipContent>{resultLabel}</TooltipContent>
</Tooltip>
		);
	};

	const routingRuleColumns: DataTableColumn<RoutingRuleDisplayRow>[] = [
		{
			id: "rule",
			sortValue: ({ originalIndex }) => originalIndex,
			header: t("pages.xray.Routings"),
			isPrimary: true,
			priority: "primary",
			minSize: { base: "180px", lg: "210px" },
			cell: ({ rule, originalIndex }) => (
				<div className="flex flex-col items-start gap-1">
					<div className="flex flex-row items-center gap-2 min-w-0!">
						<Badge className={toneClass(rule.enabled === false ? "gray" : "green")}>
							#{originalIndex + 1}
						</Badge>
						<p className="font-semibold truncate">
							{rule.outboundTag ||
								rule.balancerTag ||
								t("pages.xray.rules.any")}
						</p>
					</div>
					<p className="text-[0.75rem] text-panel-text-muted truncate">
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
					</p>
				</div>
			),
		},
		{
			id: "source",
			sortValue: ({ rule }) => String(rule.source ?? ""),
			header: t("pages.xray.rules.sourceGroup"),
			priority: "medium",
			hideBelow: "xl",
			cell: ({ rule }) => (
				<div className="flex flex-col items-start gap-1">
					{renderChipList(rule.source, "blue")}
					{renderTextValue(rule.sourcePort)}
				</div>
			),
			mobileMetaLabel: t("pages.xray.rules.sourceGroup"),
		},
		{
			id: "network",
			sortValue: ({ rule }) => String(rule.network ?? ""),
			header: t("pages.xray.rules.networkGroup"),
			priority: "high",
			cell: ({ rule }) => (
				<div className="flex flex-col items-start gap-1">
					{renderChipList(rule.network, "purple")}
					{renderChipList(rule.protocol, "green")}
					{renderAttrsCell(rule.attrs)}
				</div>
			),
			mobileMetaLabel: t("pages.xray.rules.networkGroup"),
		},
		{
			id: "destination",
			sortValue: ({ rule }) => String(rule.domain ?? rule.ip ?? ""),
			header: t("pages.xray.rules.destinationGroup"),
			priority: "high",
			minSize: "180px",
			cell: ({ rule }) => (
				<div className="flex flex-col items-start gap-1">
					{renderChipList(rule.ip, "blue")}
					{renderChipList(rule.domain, "blue")}
					{renderTextValue(rule.port)}
				</div>
			),
			mobileMetaLabel: t("pages.xray.rules.destinationGroup"),
		},
		{
			id: "inbound",
			sortValue: ({ rule }) => String(rule.inboundTag ?? ""),
			header: t("inbound"),
			priority: "medium",
			hideBelow: "lg",
			cell: ({ rule }) => (
				<div className="flex flex-col items-start gap-1">
					{renderChipList(rule.inboundTag, "teal")}
					{renderChipList(rule.user, "cyan")}
				</div>
			),
			mobileMetaLabel: t("inbound"),
		},
		{
			id: "target",
			sortValue: ({ rule }) => String(rule.outboundTag ?? rule.balancerTag ?? ""),
			header: t("pages.xray.rules.outbound"),
			priority: "high",
			mobileSummary: true,
			cell: ({ rule }) => (
				<div className="flex flex-col items-start gap-1">
					{renderTextValue(rule.outboundTag)}
					{renderTextValue(rule.balancerTag)}
				</div>
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
			id: "test",
			label: t("pages.xray.routeTester.test"),
			icon: <BoltIconStyled />,
			onClick: () => openRouteTest(row.originalIndex),
		},
		{
			id: "move-top",
			label: t("pages.xray.rules.top"),
			icon: <ChevronDoubleUpIconStyled />,
			disabled:
				routingRuleSearch.trim().length > 0 || row.originalIndex === 0,
			onClick: () => replaceRule(row.originalIndex, 0),
		},
		{
			id: "move-up",
			label: t("pages.xray.rules.up"),
			icon: <ArrowUpIconStyled />,
			disabled:
				routingRuleSearch.trim().length > 0 || row.originalIndex === 0,
			onClick: () => replaceRule(row.originalIndex, row.originalIndex - 1),
		},
		{
			id: "move-down",
			label: t("pages.xray.rules.down"),
			icon: <ArrowDownIconStyled />,
			disabled:
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
			sortValue: ({ outbound }) => outbound.tag ?? "",
			header: t("pages.xray.outbound.tag"),
			isPrimary: true,
			priority: "primary",
			minSize: { base: "170px", lg: "210px" },
			cell: ({ outbound }) => (
				<div className="flex flex-col items-start gap-1">
					<div className="flex flex-row items-center gap-1.5 max-w-full min-w-0!">
						{managedOutboundMeta(outbound)?.provider === "tor" && (
							<Tooltip>
<TooltipTrigger asChild>
								<div className="inline-flex shrink-0">
									<TorIconStyled size={20} />
								</div>
							</TooltipTrigger>
<TooltipContent>{"Tor"}</TooltipContent>
</Tooltip>
						)}
						<p className="font-semibold truncate">
							{String(outbound.tag ?? "-")}
						</p>
						<ManagedOutboundBadge outbound={outbound} />
					</div>
					{renderOutboundBadges(outbound)}
				</div>
			),
		},
		{
			id: "address",
			sortValue: ({ outbound }) => findOutboundAddress(outbound).join(", "),
			header: t("pages.xray.outbound.address"),
			priority: "high",
			minSize: "190px",
			cell: ({ outbound }) => renderAddressList(findOutboundAddress(outbound)),
			mobileMetaLabel: t("pages.xray.outbound.address"),
		},
		{
			id: "traffic",
			sortValue: ({ outbound, originalIndex }) => {
				const traffic = findOutboundTraffic(outbound, originalIndex);
				return (traffic?.up ?? 0) + (traffic?.down ?? 0);
			},
			header: t("pages.inbounds.traffic"),
			priority: "high",
			mobileSummary: true,
			cell: ({ outbound, originalIndex }) =>
				renderOutboundTraffic(findOutboundTraffic(outbound, originalIndex)),
		},
		{
			id: "latency",
			sortValue: ({ originalIndex }) => outboundTestStates[originalIndex]?.result?.delay ?? Number.POSITIVE_INFINITY,
			header: t("pages.xray.outbound.testTypeLatency"),
			priority: "high",
			cell: ({ originalIndex }) =>
				renderOutboundTestResult(outboundTestStates[originalIndex]),
			mobileMetaLabel: t("pages.xray.outbound.testTypeLatency"),
		},
		{
			id: "test",
			header: t("pages.xray.routeTester.test"),
			priority: "medium",
			hideBelow: "lg",
			cell: ({ outbound, originalIndex }) =>
				<div className="flex flex-row items-center gap-1">
					{renderOutboundTestButton(
						outbound,
						outboundTestStates[originalIndex],
						() => testOutbound(originalIndex),
					)}
					{renderOutboundHealthButton(
						outbound,
						outboundHealthStates[originalIndex],
						() => checkOutboundHealth(originalIndex),
					)}
				</div>,
			mobileMetaLabel: t("pages.xray.routeTester.test"),
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
		...(isMullvadOutbound(form.getValues("config.outbounds")?.[row.originalIndex])
			? [
					{
						id: "edit-mullvad",
						label: t("pages.xray.mullvad.edit"),
						icon: <MullvadIconStyled />,
						onClick: () =>
							openMullvad(
								String(
									form.getValues("config.outbounds")?.[row.originalIndex]?.tag ?? "",
								),
							),
					},
				]
			: []),
		{
			id: "move-top",
			label: t("pages.xray.outbound.moveToTop"),
			icon: <ChevronDoubleUpIconStyled />,
			disabled:
				outboundSearch.trim().length > 0 ||
				outboundSorting.length > 0 ||
				row.originalIndex === 0,
			onClick: () => moveOutboundToTop(row.originalIndex),
		},
		{
			id: "move-up",
			label: t("pages.xray.outbound.moveUp"),
			icon: <ArrowUpIconStyled />,
			disabled:
				outboundSearch.trim().length > 0 ||
				outboundSorting.length > 0 ||
				row.originalIndex === 0,
			onClick: () => moveOutboundUp(row.originalIndex),
		},
		{
			id: "move-down",
			label: t("pages.xray.outbound.moveDown"),
			icon: <ArrowDownIconStyled />,
			disabled:
				outboundSearch.trim().length > 0 ||
				outboundSorting.length > 0 ||
				row.originalIndex === outboundData.length - 1,
			onClick: () => moveOutboundDown(row.originalIndex),
		},
		{
			id: "reset",
			label: t("pages.xray.outbound.resetTraffic"),
			icon: <ReloadIconStyled />,
			onClick: () =>
				setOutboundReset({ index: row.originalIndex, scope: "target" }),
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
			id: "reset-target",
			label: t("pages.xray.outbound.resetTarget"),
			icon: <ReloadIconStyled />,
			onClick: () => setOutboundReset({ index: -1, scope: "target" }),
		},
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

	const subscriptionOutboundColumns: DataTableColumn<SubscriptionOutboundDisplayRow>[] =
		[
			{
				id: "tag",
				sortValue: ({ outbound }) => outbound.tag ?? "",
				header: t("pages.xray.outbound.tag"),
				isPrimary: true,
				priority: "primary",
				cell: ({ outbound }) => (
					<div className="flex flex-col items-start gap-1">
						<p className="font-semibold truncate">
							{String(outbound.tag ?? "-")}
						</p>
						<Badge className="bg-green-600 text-white">
							{t("pages.xray.outboundSub.sourceBadge")}
						</Badge>
					</div>
				),
			},
			{
				id: "protocol",
				sortValue: ({ outbound }) => outbound.protocol ?? "",
				header: t("protocol"),
				priority: "high",
				cell: ({ outbound }) => renderOutboundBadges(outbound),
				mobileMetaLabel: t("protocol"),
			},
			{
				id: "address",
				sortValue: ({ outbound }) => findOutboundAddress(outbound).join(", "),
				header: t("pages.xray.outbound.address"),
				priority: "medium",
				hideBelow: "lg",
				cell: ({ outbound }) =>
					renderAddressList(findOutboundAddress(outbound)),
				mobileMetaLabel: t("pages.xray.outbound.address"),
			},
			{
				id: "traffic",
				sortValue: ({ outbound }) => {
					const traffic = findSubscriptionOutboundTraffic(outbound);
					return (traffic?.up ?? 0) + (traffic?.down ?? 0);
				},
				header: t("pages.inbounds.traffic"),
				priority: "high",
				mobileSummary: true,
				cell: ({ outbound }) =>
					renderOutboundTraffic(findSubscriptionOutboundTraffic(outbound)),
			},
			{
				id: "latency",
				sortValue: ({ stateKey }) => subscriptionOutboundTestStates[stateKey]?.result?.delay ?? Number.POSITIVE_INFINITY,
				header: t("pages.xray.outbound.testTypeLatency"),
				priority: "high",
				cell: ({ stateKey }) =>
					renderOutboundTestResult(subscriptionOutboundTestStates[stateKey]),
				mobileMetaLabel: t("pages.xray.outbound.testTypeLatency"),
			},
			{
				id: "test",
				header: t("pages.xray.routeTester.test"),
				priority: "medium",
				hideBelow: "lg",
				cell: ({ outbound, index, stateKey }) =>
					renderOutboundTestButton(
						outbound,
						subscriptionOutboundTestStates[stateKey],
						() => testSubscriptionOutbound(outbound, index),
					),
				mobileMetaLabel: t("pages.xray.routeTester.test"),
			},
		];

	const reverseColumns: DataTableColumn<ReverseRow>[] = [
		{
			id: "type",
			sortValue: (reverse) => reverse.type ?? "",
			header: t("pages.xray.reverse.type"),
			isPrimary: true,
			priority: "primary",
			cell: (reverse) => (
				<Badge className={toneClass(reverse.type === "internal" ? "blue" : "purple")}>
					{reverse.type === "internal"
						? t("pages.xray.reverse.internal")
						: t("pages.xray.reverse.public")}
				</Badge>
			),
		},
		{
			id: "tag",
			sortValue: (reverse) => reverse.tag ?? "",
			header: t("pages.xray.reverse.tag"),
			priority: "high",
			cell: (reverse) => renderTextValue(reverse.tag),
			mobileSummary: true,
		},
		{
			id: "connection",
			sortValue: (reverse) => reverse.connectionTag ?? "",
			header: t("pages.xray.reverse.connection"),
			priority: "high",
			cell: (reverse) => renderTextValue(reverse.connectionTag),
		},
		{
			id: "target",
			sortValue: (reverse) => (reverse.type === "internal" ? reverse.targetTag ?? "" : String(reverse.inboundTags ?? "")),
			header: t("pages.xray.reverse.target"),
			priority: "medium",
			hideBelow: "lg",
			cell: (reverse) =>
				reverse.type === "internal"
					? renderTextValue(reverse.targetTag)
					: renderChipList(reverse.inboundTags, "cyan"),
		},
	];

	const reverseActions = (
		row: ReverseRow,
	): DataTableRowAction<ReverseRow>[] => [
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
			sortValue: (balancer) => balancer.tag ?? "",
			header: t("pages.xray.balancer.tag"),
			isPrimary: true,
			priority: "primary",
			cell: (balancer) => <p className="font-semibold">{balancer.tag}</p>,
		},
		{
			id: "strategy",
			sortValue: (balancer) => balancer.strategy ?? "",
			header: t("pages.xray.balancer.balancerStrategy"),
			priority: "high",
			mobileSummary: true,
			cell: (balancer) => (
				<Badge className={toneClass(balancer.strategy === "random" ? "purple" : "green")}>
					{balancer.strategy === "random"
						? "Random"
						: balancer.strategy === "roundRobin"
							? "Round Robin"
							: balancer.strategy === "leastLoad"
								? "Least Load"
								: "Least Ping"}
				</Badge>
			),
		},
		{
			id: "selector",
			sortValue: (balancer) => String(balancer.selector ?? ""),
			header: t("pages.xray.balancer.balancerSelectors"),
			priority: "high",
			cell: (balancer) => renderChipList(balancer.selector, "blue"),
		},
	];

	const balancerActions = (
		row: BalancerRow,
	): DataTableRowAction<BalancerRow>[] => [
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
			sortValue: ({ dns }) => String(typeof dns === "object" ? dns.address : dns),
			header: t("pages.xray.outbound.address"),
			isPrimary: true,
			priority: "primary",
			cell: ({ dns }) =>
				renderTextValue(typeof dns === "object" ? dns.address : dns),
		},
		{
			id: "domains",
			sortValue: ({ dns }) => (typeof dns === "object" ? String(dns.domains ?? "") : ""),
			header: t("pages.xray.dns.domains"),
			priority: "high",
			cell: ({ dns }) =>
				typeof dns === "object" ? renderChipList(dns.domains, "blue") : "",
			mobileSummary: true,
		},
		{
			id: "expectIPs",
			sortValue: ({ dns }) => (typeof dns === "object" ? String(dns.expectIPs ?? "") : ""),
			header: t("pages.xray.dns.expectIPs"),
			priority: "medium",
			hideBelow: "lg",
			cell: ({ dns }) =>
				typeof dns === "object" ? renderChipList(dns.expectIPs, "green") : "",
		},
	];
	const dnsActions = (
		row: DnsDisplayRow,
	): DataTableRowAction<DnsDisplayRow>[] => [
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
			sortValue: ({ fake }) => String(fake.ipPool ?? ""),
			header: t("pages.xray.fakedns.ipPool"),
			isPrimary: true,
			priority: "primary",
			cell: ({ fake }) => renderTextValue(fake.ipPool),
		},
		{
			id: "poolSize",
			sortValue: ({ fake }) => Number(fake.poolSize) || 0,
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
		return <PageLoadingSkeleton variant="settings" />;
	}

	if (!canManageXraySettings) {
		return (
			<div className="flex flex-col gap-4 items-stretch">
				<h1 className="font-semibold text-[1.5rem]">
					{t("header.xraySettings")}
				</h1>
				<p className="text-[0.875rem] text-gray-500 dark:text-gray-400">
					{t("xraySettings.noPermission")}
				</p>
			</div>
		);
	}

	const advancedJsonValue = activeTab === 6 ? getAdvancedJson() : "";
	const advancedJsonModes = [
		{
			value: "xraySetting",
			label: t("pages.xray.completeTemplate"),
			description: t("pages.xray.completeTemplateDesc"),
		},
		{
			value: "inboundSettings",
			label: t("pages.xray.Inbounds"),
			description: t("pages.xray.inboundsJsonDesc"),
		},
		{
			value: "outboundSettings",
			label: t("pages.xray.Outbounds"),
			description: t("pages.xray.outboundsJsonDesc"),
		},
		{
			value: "routingRuleSettings",
			label: t("pages.xray.Routings"),
			description: t("pages.xray.routingRulesJsonDesc"),
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
		if (readHashTab() !== key) window.location.hash = key;
	};

	const openRouteTest = (index: number) => {
		const rule = getRoutingRules()[index];
		if (!rule) return;
		setRouteTestRule(rule);
		onRouteTestOpen();
	};

	return (
		<div className="flex flex-col gap-4 items-stretch">
			<div className={cn(pageShellBorder, "hover:md:shadow-sm hover:md:border-panel-border-strong!", cn("border rounded-2xl p-4 md:p-5 [transition:box-shadow_0.2s_ease,_border-color_0.2s_ease]", pageShellBg))}>
				<div className="flex flex-col lg:flex-row gap-4 items-stretch lg:items-end justify-between">
					<div className="min-w-0!">
						<h1 className="font-semibold text-[1.5rem]">
							{t("header.coreSettings")}
						</h1>
						<p className={cn("text-[0.875rem] mt-1", pageHintColor)}>
							{t("pages.xray.coreDescription")}
						</p>
					</div>
					<div className="flex flex-row items-center gap-2 flex-wrap justify-stretch lg:justify-end">
						<Button disabled={!hasConfigChanges || isPostLoading} onClick={handleOnSave} size="sm" loading={isPostLoading} className="w-full sm:w-auto">
							{t("save")}
						</Button>
						<Button onClick={() => handleRestartCore(selectedTarget)} variant="outline" size="sm" loading={isRestarting} className="w-full sm:w-auto">{<ReloadIconStyled />}
							{t(isRestarting ? "core.restarting" : "core.restartCore")}
						</Button>
					</div>
				</div>
				{hasNodeTargets && (
					<div className={cn(pageShellBorderTop, "flex flex-row mt-4 pt-3 border-t gap-3 items-end flex-wrap w-full")}>
						<Field className="w-full sm:w-[260px]">
							<FieldLabel className={cn("mb-1 text-[0.75rem]", pageHintColor)}>
								{t("pages.xray.routeTester.target")}
							</FieldLabel>
							<Select size="sm" value={selectedTarget} onChange={(event) => setSelectedTarget(event.target.value)} options={[
									{ label: t("core.defaultConfig"), value: "master" },
									...configTargets
										.filter((target) => target.type === "node")
										.map((target) => ({
											label: (
												<span className="flex flex-row items-center min-w-0! gap-1">
													<span className="truncate">
														{target.name}
														{target.address ? ` - ${target.address}` : ""}
													</span>
													{target.mode === "custom" && (
														<span className="shrink-0 text-[10px] opacity-70">
															(custom)
														</span>
													)}
												</span>
											),
											searchLabel: target.name,
											value: target.id,
										})),
								]} className="h-[32px]" />
						</Field>
						{selectedTargetInfo?.type === "node" && (
							<Field className="flex items-center w-full sm:w-auto min-h-[32px]">
								<FieldLabel className="mb-0 text-[0.875rem]">
									{t("core.customNodeConfig")}
								</FieldLabel>
								<Switch checked={selectedTargetInfo.mode === "custom"} disabled={isChangingTargetMode} onCheckedChange={(checked: boolean) => handleTargetModeChange(checked)} />
							</Field>
						)}
					</div>
				)}
			</div>
			<TabSystem tabs={[
					{
						value: "basic",
						isActive: activeTab === 0,
						onClick: () => handleTabChange(0),
						label: (
							<div className="flex flex-row gap-2 items-center">
								<BasicTabIcon />
								<span>{t("pages.xray.basicTemplate")}</span>
							</div>
						),
					},
					{
						value: "routing",
						isActive: activeTab === 1,
						onClick: () => handleTabChange(1),
						label: (
							<div className="flex flex-row gap-2 items-center">
								<RoutingTabIcon />
								<span>{t("pages.xray.Routings")}</span>
							</div>
						),
					},
					{
						value: "outbounds",
						isActive: activeTab === 2,
						onClick: () => handleTabChange(2),
						label: (
							<div className="flex flex-row gap-2 items-center">
								<OutboundTabIcon />
								<span>{t("pages.xray.Outbounds")}</span>
							</div>
						),
					},
					{
						value: "reverse",
						isActive: activeTab === 3,
						onClick: () => handleTabChange(3),
						label: (
							<div className="flex flex-row gap-2 items-center">
								<ReloadIconStyled />
								<span>{t("pages.xray.reverse.title")}</span>
							</div>
						),
					},
					{
						value: "balancers",
						isActive: activeTab === 4,
						onClick: () => handleTabChange(4),
						label: (
							<div className="flex flex-row gap-2 items-center">
								<BalancerTabIcon />
								<span>{t("pages.xray.Balancers")}</span>
							</div>
						),
					},
					{
						value: "dns",
						isActive: activeTab === 5,
						onClick: () => handleTabChange(5),
						label: (
							<div className="flex flex-row gap-2 items-center">
								<DnsTabIcon />
								<span>{t("DNS")}</span>
							</div>
						),
					},
					{
						value: "advanced",
						isActive: activeTab === 6,
						onClick: () => handleTabChange(6),
						label: (
							<div className="flex flex-row gap-2 items-center">
								<AdvancedTabIcon />
								<span>{t("pages.xray.advancedTemplate")}</span>
							</div>
						),
					},
				]} className="overflow-x-auto overflow-y-hidden max-w-full" />
			<div className="mt-2 md:mt-3">
				{activeTab === 0 && (
					<div className="p-0 mt-3">
						<div className="flex flex-col gap-4 items-stretch">
							<div className="flex flex-col gap-3 items-stretch">
								<SettingsSection title={t("pages.xray.serverIPs")}>
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
											<Select id={id} size="sm" value={freedomDomainStrategy} onChange={(event) =>
													handleFreedomDomainStrategyChange(event.target.value)
												} disabled={freedomOutboundIndex === -1} className="max-w-[220px]">
												<option value="">{t("common.default")}</option>
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
													<Select {...field} id={id} size="sm" className="max-w-[220px]">
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
									<SettingRow
										label={t("pages.xray.routingScript")}
										description={t("pages.xray.routingScriptDesc")}
										controlId="routing-script"
									>
										{(id) => (
											<Controller
												name="config.routing.script"
												control={form.control}
												render={({ field }) => (
													<Input
														id={id}
														value={field.value ?? ""}
														onChange={(event) => field.onChange(event.target.value)}
														placeholder="/path/to/routing.lua"
														className="max-w-[320px]"
													/>
												)}
											/>
										)}
									</SettingRow>
								</SettingsSection>
								<SettingsSection title={t("pages.xray.warpRouting")}>
									<div className="p-3 md:p-4">
										<div className="flex flex-col items-stretch gap-3">
											<div className="flex flex-row gap-2 justify-between items-center">
												<p className={cn("text-[0.875rem]", warpDomainHelper)}>
													{t("pages.xray.warpRoutingDesc")}
												</p>
												<Button onClick={onWarpOpen} variant="outline" size="sm" className="shrink-0">{<WarpIconStyled />}
													{warpExists
														? t("pages.xray.warp.manage")
														: t("pages.xray.warp.create")}
												</Button>
											</div>
											<div className="flex flex-wrap gap-2">
												{warpDomains.length === 0 && (
													<div>
														<Badge className="bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-gray-500/20 dark:text-gray-200">
															{t("core.empty")}
														</Badge>
													</div>
												)}
												{warpDomains.map((domain) => (
													<div key={domain}>
														<Badge className="rounded-full">
															{domain}
															
														</Badge>
													</div>
												))}
											</div>
											<div className="flex flex-row items-center gap-3 flex-wrap">
												<Select placeholder={t("core.select")} size="sm" value={warpOptionValue} onChange={(event) => {
														const { value } = event.target;
														if (value) {
															handleWarpDomainAdd(value);
														}
														setWarpOptionValue("");
													}} disabled={availableWarpOptions.length === 0} className="max-w-[240px]">
													{availableWarpOptions.map((option) => (
														<option key={option.value} value={option.value}>
															{option.label}
														</option>
													))}
												</Select>
												<div className="flex flex-row items-center gap-2 max-w-[320px] flex-1">
													<Input value={warpCustomDomain} onChange={(event) =>
															setWarpCustomDomain(event.target.value)
														} />
													<Button onClick={() => {
															handleWarpDomainAdd(warpCustomDomain);
															setWarpCustomDomain("");
														}} disabled={!warpCustomDomain.trim()} size="sm">
														{t("add")}
													</Button>
												</div>
											</div>
										</div>
									</div>
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
													<Switch id={id} checked={!!field.value} onCheckedChange={(checked: boolean) => field.onChange(checked)} />
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
													<Switch id={id} checked={!!field.value} onCheckedChange={(checked: boolean) => field.onChange(checked)} />
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
													<Switch id={id} checked={!!field.value} onCheckedChange={(checked: boolean) => field.onChange(checked)} />
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
													<Switch id={id} checked={!!field.value} onCheckedChange={(checked: boolean) => field.onChange(checked)} />
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
													<Select {...field} id={id} size="sm" className="max-w-[220px]">
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
											<div className="flex flex-row items-center gap-2 w-full flex-wrap">
												<Controller
													name="config.log.access"
													control={form.control}
													render={({ field }) => (
														<Select {...field} id={id} size="sm" className="max-w-[220px]">
															<option value="">{t("common.empty")}</option>
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
														<Select id={`${id}-cleanup`} size="sm" value={
																field.value === undefined ||
																field.value === null ||
																field.value === ""
																	? "0"
																	: String(field.value)
															} onChange={(e) =>
																field.onChange(Number(e.target.value))
															} className="max-w-[220px]">
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
											</div>
										)}
									</SettingRow>
									<SettingRow
										label={t("pages.xray.errorLog")}
										controlId="error-log"
									>
										{(id) => (
											<div className="flex flex-row items-center gap-2 w-full flex-wrap">
												<Controller
													name="config.log.error"
													control={form.control}
													render={({ field }) => (
														<Select {...field} id={id} size="sm" className="max-w-[220px]">
															<option value="">{t("common.empty")}</option>
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
														<Select id={`${id}-cleanup`} size="sm" value={
																field.value === undefined ||
																field.value === null ||
																field.value === ""
																	? "0"
																	: String(field.value)
															} onChange={(e) =>
																field.onChange(Number(e.target.value))
															} className="max-w-[220px]">
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
											</div>
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
													<Select {...field} id={id} size="sm" className="max-w-[220px]">
														<option value="">{t("common.empty")}</option>
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
													<Switch id={id} checked={!!field.value} onCheckedChange={(checked: boolean) => field.onChange(checked)} />
												)}
											/>
										)}
									</SettingRow>
								</SettingsSection>
							</div>
						</div>
					</div>
				)}
				{activeTab === 1 && (
					<div className="p-0 mt-3">
						<div className="flex flex-col gap-4 items-stretch">
							<ListCard
								overview={{
									total: { label: t("pages.xray.Routings"), value: routingRuleData.length },
									rows: [{ key: "listed", label: t("listed"), value: filteredRoutingRules.length, tone: "bg-panel-success" }],
								}}
								toolbar={
									<div className="flex flex-col gap-2 md:flex-row md:items-center">
										<div className="flex flex-row items-center gap-2">
											<SearchInput containerProps={{ className: "min-w-0 flex-1 md:w-[320px] md:flex-none" }} placeholder={t("search")} value={routingRuleSearch} onChange={(e) => setRoutingRuleSearch(e.target.value)} matchOptions={routingRuleSearchMatch} onMatchOptionsChange={setRoutingRuleSearchMatch} />
											<DataTableSortMenu options={buildSortOptions(routingRuleColumns, filteredRoutingRules)} sorting={routingSorting} onSortingChange={setRoutingSorting} />
										</div>
										<div className="flex flex-row items-center gap-2 flex-wrap justify-end md:ms-auto">
											<Button {...compactActionButtonProps} onClick={addRule}>{<AddIconStyled />}
												{t("pages.xray.rules.add")}
											</Button>
										</div>
									</div>
								}
							/>
							<DataTable
								sorting={routingSorting} onSortingChange={setRoutingSorting} showSortMenu={false}
								data={filteredRoutingRules}
								columns={routingRuleColumns}
								getRowId={(row) => String(row.originalIndex)}
								rowActions={routingRuleActions}

								actionsColumnWidth="52px"
								emptyState={t("pages.xray.rules.empty")}
								ariaLabel={t("pages.xray.Routings")}
							/>
							{subscriptionOutbounds.length > 0 && (
								<div className="flex flex-col items-stretch gap-3">
									<ListCard
										overview={{
											total: { label: t("pages.xray.outboundSub.fromSubsTitle"), value: subscriptionOutbounds.length },
											rows: [],
										}}
										toolbar={<div className="flex flex-row items-center gap-2 flex-wrap"><DataTableSortMenu options={buildSortOptions(subscriptionOutboundColumns, subscriptionOutboundRows)} sorting={subscriptionSorting} onSortingChange={setSubscriptionSorting} /></div>}
									>
										<p className="text-panel-text-muted text-[0.75rem]">
											{t("pages.xray.outboundSub.fromSubsDesc")}
										</p>
									</ListCard>
									<DataTable
										sorting={subscriptionSorting} onSortingChange={setSubscriptionSorting} showSortMenu={false}
										data={subscriptionOutboundRows}
										columns={subscriptionOutboundColumns}
										getRowId={(row) => `${row.stateKey}-${row.index}`}
										actionsDisplay="none"
										emptyState={t("pages.xray.outbound.empty")}
										ariaLabel={t("pages.xray.outboundSub.fromSubsTitle")}
									/>
								</div>
							)}
						</div>
					</div>
				)}
				{activeTab === 2 && (
					<div className="p-0 mt-3">
						<div className="flex flex-col gap-4 items-stretch">
							<ListCard
								overview={{
									total: { label: t("pages.xray.Outbounds"), value: outboundData.length - managedOutboundTotal },
									rows: [
										{ key: "listed", label: t("listed"), value: standardOutboundData.length, tone: "bg-panel-success" },
										{ key: "selected", label: t("services.selected"), value: selectedOutboundIds.length, tone: "bg-panel-info" },
									],
								}}
								toolbar={
									<div className="flex flex-row flex-wrap items-center gap-2">
										<div className="flex min-w-0 basis-full flex-row items-center gap-2 md:flex-1">
											<SearchInput containerProps={{ className: "min-w-0 flex-1 md:w-[280px] md:flex-none" }} placeholder={t("search")} value={outboundSearch} onChange={(e) => setOutboundSearch(e.target.value)} matchOptions={outboundSearchMatch} onMatchOptionsChange={setOutboundSearchMatch} />
											<DataTableSortMenu options={buildSortOptions(outboundColumns, standardOutboundData)} sorting={outboundSorting} onSortingChange={setOutboundSorting} />
										</div>
										<SegmentedControl<OutboundTestType>
											label={t("pages.xray.routeTester.test")}
											value={outboundTestType}
											options={(["latency", "tcp", "icmp"] as OutboundTestType[]).map((type) => ({ value: type, label: outboundTestTypeLabels[type] }))}
											onChange={(value) => setOutboundTestType(value)}
										/>
										<Button {...compactActionButtonProps} disabled={isMasterTarget} onClick={testAllOutbounds} loading={testingAllOutbounds}>{<BoltIconStyled />}
											{t("pages.xray.outbound.testAll")}
										</Button>
										<div className="flex flex-row flex-wrap items-center justify-end gap-2 ms-auto">
											<Button onClick={onOutboundSubsOpen} variant="ghost" size="xs">{<CloudUpload className="w-[14px]" />}
												{t("pages.xray.outboundSub.title")}
											</Button>
											<Button onClick={() => setOutboundReset({ index: -1, scope: "all" })} variant="ghost" size="xs" className="text-destructive hover:bg-destructive/10">
												{t("pages.xray.outbound.resetAll")}
											</Button>
											<DropdownMenu>
												<DropdownMenuTrigger asChild><Button size="xs" variant="ghost">{<MoreIconStyled />}
													{t("more")}
												</Button></DropdownMenuTrigger>
												
													<DropdownMenuContent className="min-w-[210px]!">
														<DropdownMenuItem onSelect={onWarpOpen}>
															{warpExists
																? t("pages.xray.warp.manage")
																: t("pages.xray.warp.create")}
														</DropdownMenuItem>
														<DropdownMenuItem onSelect={onNordOpen}>
															NordVPN
														</DropdownMenuItem>
														<DropdownMenuItem onSelect={() => openMullvad()}>
															Mullvad
														</DropdownMenuItem>
														<DropdownMenuItem disabled={isApplyingTorProxy} onSelect={onTorProxyOpen}>
															{t("pages.xray.tor.setup")}
														</DropdownMenuItem>
														<DropdownMenuItem disabled={isApplyingWindscribeProxy} onSelect={onWindscribeProxyOpen}>
															Windscribe
														</DropdownMenuItem>
														<DropdownMenuItem disabled={isApplyingPsiphonProxy} onSelect={onPsiphonProxyOpen}>
															Psiphon
														</DropdownMenuItem>
													</DropdownMenuContent>
												
											</DropdownMenu>
											<RefreshSplitButton
												onRefresh={() => void fetchOutboundsTraffic().catch(() => undefined)}
												interval={outboundAutoRefresh}
												onIntervalChange={setOutboundAutoRefresh}
											/>
											<Button {...compactActionButtonProps} onClick={addOutbound}>{<AddIconStyled />}
												{t("pages.xray.outbound.addOutbound")}
											</Button>
										</div>
									</div>
								}
							/>
							<DataTable
								sorting={outboundSorting} onSortingChange={setOutboundSorting} showSortMenu={false}
								data={standardOutboundData}
								columns={outboundColumns}
								getRowId={(row) => String(row.originalIndex)}
								enableSelection
								selectedRowIds={selectedOutboundIds}
								onSelectionChange={(ids) => setSelectedOutboundIds(ids)}
								bulkActions={outboundBulkActions}
								rowActions={outboundActions}

								actionsColumnWidth="52px"
								emptyState={t("pages.xray.outbound.empty")}
								ariaLabel={t("pages.xray.Outbounds")}
							/>
							{managedOutboundTotal > 0 && (
								<div className="flex flex-col items-stretch gap-3">
									<ListCard
										overview={{
											total: { label: t("pages.xray.outboundManaged.title"), value: managedOutboundTotal },
											rows: [{ key: "listed", label: t("listed"), value: managedOutboundData.length, tone: "bg-panel-info" }],
										}}
										toolbar={<div className="flex flex-row items-center gap-2 flex-wrap"><DataTableSortMenu options={buildSortOptions(outboundColumns, managedOutboundData)} sorting={managedOutboundSorting} onSortingChange={setManagedOutboundSorting} /></div>}
									>
										<p className="text-panel-text-muted text-[0.75rem]">
											{t("pages.xray.outboundManaged.description")}
										</p>
									</ListCard>
									<DataTable
										sorting={managedOutboundSorting} onSortingChange={setManagedOutboundSorting} showSortMenu={false}
										data={managedOutboundData}
										columns={outboundColumns}
										getRowId={(row) => String(row.originalIndex)}
										rowActions={outboundActions}

										actionsColumnWidth="52px"
										emptyState={t("pages.xray.outbound.empty")}
										ariaLabel={t("pages.xray.outboundManaged.title")}
									/>
								</div>
							)}
						</div>
					</div>
				)}
				{activeTab === 3 && (
					<div className="p-0 mt-3">
						<div className="flex flex-col gap-4 items-stretch">
							<ListCard
								overview={{
									total: { label: t("pages.xray.reverse.title"), value: reverseData.length },
									rows: [
										{ key: "internal", label: t("pages.xray.reverse.internal"), value: reverseData.filter((reverse) => reverse.type === "internal").length, tone: "bg-panel-info" },
										{ key: "public", label: t("pages.xray.reverse.public"), value: reverseData.filter((reverse) => reverse.type === "public").length, tone: "bg-panel-accent" },
									],
								}}
								toolbar={
									<div className="flex flex-row items-center gap-2 flex-wrap">
										<DataTableSortMenu options={buildSortOptions(reverseColumns, reverseData)} sorting={reverseSorting} onSortingChange={setReverseSorting} />
										<div className="flex flex-row items-center justify-end gap-2 flex-wrap ms-auto">
											<Button {...compactActionButtonProps} onClick={addReverse}>{<AddIconStyled />}
												{t("pages.xray.reverse.add")}
											</Button>
										</div>
									</div>
								}
							/>
							<DataTable
								sorting={reverseSorting} onSortingChange={setReverseSorting} showSortMenu={false}
								data={reverseData}
								columns={reverseColumns}
								getRowId={(row) => row.key}
								rowActions={reverseActions}

								actionsColumnWidth="52px"
								emptyState={t("pages.xray.reverse.empty")}
								ariaLabel={t("pages.xray.reverse.title")}
							/>
						</div>
					</div>
				)}
				{activeTab === 4 && (
					<div className="p-0 mt-3">
						<div className="flex flex-col gap-4 items-stretch">
							<ListCard
								overview={{
									total: { label: t("pages.xray.Balancers"), value: balancersData.length },
									rows: [
										{
											key: "selectors",
											label: t("pages.xray.balancer.balancerSelectors"),
											value: balancersData.reduce((total, balancer) => total + balancer.selector.length, 0),
											tone: "bg-panel-info",
										},
									],
								}}
								toolbar={
									<div className="flex flex-row items-center gap-2 flex-wrap">
										<DataTableSortMenu options={buildSortOptions(balancerColumns, balancersData)} sorting={balancerSorting} onSortingChange={setBalancerSorting} />
										<div className="flex flex-row items-center justify-end gap-2 flex-wrap ms-auto">
											<Button {...compactActionButtonProps} onClick={addBalancer}>{<AddIconStyled />}
												{t("pages.xray.balancer.addBalancer")}
											</Button>
										</div>
									</div>
								}
							/>
							<DataTable
								sorting={balancerSorting} onSortingChange={setBalancerSorting} showSortMenu={false}
								data={balancersData}
								columns={balancerColumns}
								getRowId={(row) => String(row.key)}
								rowActions={balancerActions}

								actionsColumnWidth="52px"
								emptyState={t("emptyBalancersDesc")}
								ariaLabel={t("pages.xray.Balancers")}
							/>
							<ObservatorySettings
								observatory={watchedConfig?.observatory}
								burstObservatory={watchedConfig?.burstObservatory}
								leastPingTags={balancersData.filter((row) => row.strategy === "leastPing").map((row) => row.tag)}
								leastLoadTags={balancersData.filter((row) => row.strategy === "leastLoad").map((row) => row.tag)}
								outboundOptions={availableOutboundTags}
								onChange={(next) => {
									const cfg = { ...(form.getValues("config") || {}) };
									if (next.observatory) cfg.observatory = next.observatory;
									if (next.burstObservatory) cfg.burstObservatory = next.burstObservatory;
									form.setValue("config", cfg, { shouldDirty: true });
								}}
							/>
						</div>
					</div>
				)}
				{activeTab === 5 && (
					<div className="p-0 mt-3">
						<div className="flex flex-col gap-4 items-stretch">
							<SettingsSection title={t("pages.xray.generalConfigs")}>
								<SettingRow
									label={t("pages.xray.dns.enable")}
									description={t("pages.xray.dns.enableDesc")}
									controlId="dns-enable"
								>
									{(id) => (
										<Switch id={id} checked={dnsEnabled} onCheckedChange={(nextChecked: boolean) => {
												const checked = nextChecked;
												const newConfig = {
													...form.getValues("config"),
												};
												if (checked) {
													newConfig.dns =
														newConfig.dns || createDefaultDnsConfig();
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
											}} />
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
														<Input id={id} value={field.value ?? ""} onChange={(event) =>
																field.onChange(event.target.value)
															} className="max-w-[240px]" />
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
														<Input id={id} value={field.value ?? ""} onChange={(event) =>
																field.onChange(event.target.value)
															} className="max-w-[240px]" />
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
														<Select id={id} size="sm" value={field.value ?? "UseIP"} onChange={(event) =>
																field.onChange(event.target.value)
															} className="max-w-[220px]">
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
														<Switch id={id} checked={Boolean(field.value)} onCheckedChange={(checked: boolean) => field.onChange(checked)} />
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
														<Switch id={id} checked={Boolean(field.value)} onCheckedChange={(checked: boolean) => field.onChange(checked)} />
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
														<Switch id={id} checked={Boolean(field.value)} onCheckedChange={(checked: boolean) => field.onChange(checked)} />
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
														<Switch id={id} checked={Boolean(field.value)} onCheckedChange={(checked: boolean) => field.onChange(checked)} />
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
														<Switch id={id} checked={Boolean(field.value)} onCheckedChange={(checked: boolean) => field.onChange(checked)} />
													)}
												/>
											)}
										</SettingRow>
									</>
								)}
							</SettingsSection>
							{dnsEnabled && (
								<div className="flex flex-col items-stretch gap-3">
									<ListCard
										overview={{
											total: { label: t("DNS"), value: dnsServers.length },
											rows: [
												{
													key: "domains",
													label: t("pages.xray.dns.domains"),
													value: dnsRows.reduce(
														(total, row) => total + (typeof row.dns === "object" ? toChipList(row.dns.domains).length : 0),
														0,
													),
													tone: "bg-panel-info",
												},
											],
										}}
										toolbar={
											<div className="flex flex-row items-center gap-2 flex-wrap">
												<DataTableSortMenu options={buildSortOptions(dnsColumns, dnsRows)} sorting={dnsSorting} onSortingChange={setDnsSorting} />
												<div className="flex flex-row items-center justify-end gap-2 flex-wrap ms-auto">
													<Button onClick={onDnsPresetsOpen} variant="outline" size="xs">
														{t("pages.xray.dns.presets")}
													</Button>
													<Button {...compactActionButtonProps} onClick={addDnsServer}>{<AddIconStyled />}
														{t("pages.xray.dns.add")}
													</Button>
												</div>
											</div>
										}
									/>
									<DataTable
										sorting={dnsSorting} onSortingChange={setDnsSorting} showSortMenu={false}
										data={dnsRows}
										columns={dnsColumns}
										getRowId={(row) => String(row.index)}
										rowActions={dnsActions}

										actionsColumnWidth="52px"
										emptyState={t("emptyDnsDesc")}
										ariaLabel={t("DNS")}
									/>
								</div>
							)}
							{dnsEnabled && (
								<div className="flex flex-col items-stretch gap-3">
									<ListCard
										overview={{
											total: { label: t("pages.xray.fakedns.title"), value: fakeDns.length },
											rows: [],
										}}
										toolbar={
											<div className="flex flex-row items-center gap-2 flex-wrap">
												<DataTableSortMenu options={buildSortOptions(fakeDnsColumns, fakeDnsRows)} sorting={fakeDnsSorting} onSortingChange={setFakeDnsSorting} />
												<div className="flex flex-row items-center justify-end gap-2 flex-wrap ms-auto">
													<Button {...compactActionButtonProps} onClick={addFakeDns}>{<AddIconStyled />}
														{t("pages.xray.fakedns.add")}
													</Button>
												</div>
											</div>
										}
									/>
									<DataTable
										sorting={fakeDnsSorting} onSortingChange={setFakeDnsSorting} showSortMenu={false}
										data={fakeDnsRows}
										columns={fakeDnsColumns}
										getRowId={(row) => String(row.index)}
										rowActions={fakeDnsActions}

										actionsColumnWidth="52px"
										emptyState={t("emptyFakeDnsDesc")}
										ariaLabel={t("pages.xray.fakedns.title")}
									/>
								</div>
							)}
						</div>
					</div>
				)}
				{activeTab === 6 && (
					<div className="p-0 mt-3">
						<div className="flex flex-col gap-4 items-stretch">
							<ListCard
								toolbar={
									<div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
										<div className="flex flex-col items-start gap-2 min-w-0">
											<p className="font-bold text-[1.125rem]">{t("pages.xray.advancedJsonEditor")}</p>
											<ResourceSummaryPills items={[
												{ label: t("pages.xray.advancedTemplate"), value: activeAdvancedJsonMode.label, colorScheme: "blue" },
												{ label: t("status"), value: advancedJsonValid ? t("jsonEditor.valid") : t("jsonEditor.invalid"), colorScheme: advancedJsonValid ? "green" : "red" },
											]} />
										</div>
										<div className="flex flex-row items-center gap-2 flex-wrap justify-end">
											{advancedJsonModes.map((option) => {
												const selected = advSettings === option.value;
												return (
													<Button key={option.value} onClick={() => {
															setAdvSettings(option.value);
															setJsonKey((prev) => prev + 1);
														}} size="xs" variant={selected ? "default" : "outline"}>
														{option.label}
													</Button>
												);
											})}
										</div>
									</div>
								}
							/>
							<div className="relative w-full h-[calc(100vh_-_350px)] min-h-[400px]">
								<div className={cn(isFullScreen ? "w-screen" : "w-full", isFullScreen ? "h-screen" : "h-full", isFullScreen ? "fixed" : "relative", isFullScreen ? "top-0" : "top-auto", isFullScreen ? "left-0" : "left-auto", isFullScreen ? "z-[1000]" : "z-[auto]")}>
									<Suspense fallback={<Spinner />}>
										<JsonEditor
											key={`advanced-${advSettings}-${jsonKey}`}
											label={activeAdvancedJsonMode.label}
											description={activeAdvancedJsonMode.description}
											json={advancedJsonValue}
											canonicalContext={advancedJsonContext}
											onValidityChange={setAdvancedJsonValid}
											toolbarActions={
												<Button aria-label={
														isFullScreen ? "Exit Full Screen" : "Full Screen"
													} onClick={toggleFullScreen} variant="outline" size="xs" className="size-7 p-0">{isFullScreen ? (
															<ExitFullScreenIconStyled />
														) : (
															<FullScreenIconStyled />
														)}</Button>
											}
											onChange={(value) => {
												setAdvancedJson(value);
											}}
										/>
									</Suspense>
								</div>
								{isFullScreen && isMobile && (
									<Button onClick={toggleFullScreen} size="sm" className="fixed bottom-4 left-[50%] [transform:translateX(-50%)] z-[1102]">
										{t("pages.xray.exitFullscreen")}
									</Button>
								)}
							</div>
						</div>
					</div>
				)}
			</div>
			<Suspense fallback={null}>
				{isOutboundOpen && (
					<OutboundModal
						open={isOutboundOpen}
						onClose={handleOutboundModalClose}
						mode={editingOutboundIndex !== null ? "edit" : "create"}
						initialOutbound={
							editingOutboundIndex !== null
								? canonicalOutbounds[editingOutboundIndex]
								: null
						}
						existingTags={availableOutboundTags}
						sourceTarget={selectedTarget}
						propagationBase={
							propagationBaseFor(
								"outbounds",
								editingOutboundIndex !== null
									? (canonicalOutbounds[editingOutboundIndex] ?? null)
									: null,
							) as Record<string, unknown> | null
						}
						onSubmitOutbound={handleOutboundSave}
					/>
				)}
				{isRuleOpen && (
					<RuleModal
						open={isRuleOpen}
						mode={editingRuleIndex !== null ? "edit" : "create"}
						initialRule={
							editingRuleIndex !== null
								? canonicalRoutingRules[editingRuleIndex] || null
								: null
						}
						availableInboundTags={availableInboundTags}
						availableOutboundTags={outboundTagOptions}
						availableBalancerTags={availableBalancerTags}
						onTestOutbound={testOutboundByTag}
						outboundTestingByTag={outboundTestingByTag}
						sourceTarget={selectedTarget}
						propagationBase={
							propagationBaseFor(
								"routing.rules",
								editingRuleIndex !== null
									? (canonicalRoutingRules[editingRuleIndex] ?? null)
									: null,
							) as RoutingRule | null
						}
						onSubmit={handleRuleModalSubmit}
						onClose={handleRuleModalClose}
					/>
				)}
				{isRouteTestOpen && (
					<RouteTestModal
						open={isRouteTestOpen}
						onClose={onRouteTestClose}
						rule={routeTestRule}
						target={selectedTarget}
						targetName={selectedTargetInfo?.name || selectedTarget || "master"}
						isMasterTarget={isMasterTarget}
						config={form.getValues("config")}
					/>
				)}
				{isReverseOpen && (
					<ReverseModal
						open={isReverseOpen}
						onClose={handleReverseModalClose}
						mode={editingReverseIndex !== null ? "edit" : "create"}
						initialReverse={editingReverseInitial}
						inboundTags={availableInboundTags}
						outboundTags={availableOutboundTags}
						outboundOptions={outboundTagOptions}
						vlessInboundTags={vlessInboundTags}
						vlessOutboundTags={vlessOutboundTags}
						vlessOutboundOptions={vlessOutboundTagOptions}
						vlessOutboundDetails={vlessOutboundDetails}
						existingTags={existingReverseTags}
						reverseCount={reverseData.length}
						onTestOutbound={testOutboundByTag}
						outboundTestingByTag={outboundTestingByTag}
						onSubmit={handleReverseSubmit}
					/>
				)}
				{isWarpOpen && (
					<WarpModal
						open={isWarpOpen}
						onClose={handleWarpModalClose}
						initialOutbound={warpOutbound}
						onSave={handleWarpSave}
						onDelete={handleWarpDelete}
					/>
				)}
				{isNordOpen && (
					<NordVPNModal
						open={isNordOpen}
						onClose={handleNordModalClose}
						initialOutbounds={getOutbounds()}
						onSave={handleNordSave}
						onDelete={handleNordDelete}
					/>
				)}
				{isMullvadOpen && (
					<MullvadModal
						open={isMullvadOpen}
						onClose={onMullvadClose}
						initialTag={mullvadEditTag}
						targetID={selectedTarget}
						canPing={!isMasterTarget}
						initialOutbounds={getOutbounds()}
						onSave={handleMullvadSave}
						onSaveMany={handleMullvadSaveMany}
						onDelete={handleNordDelete}
					/>
				)}
				{isOutboundSubsOpen && (
					<OutboundSubscriptionsModal
						open={isOutboundSubsOpen}
						onClose={onOutboundSubsClose}
						onChanged={async () => {
							await fetchActiveSubscriptionOutbounds();
							await fetchOutboundsTraffic();
						}}
					/>
				)}
				{isTorProxyOpen && (
					<TorProxyModal
						open={isTorProxyOpen}
						loading={isApplyingTorProxy}
						isMasterTarget={isMasterTarget}
						existingTags={availableOutboundTags}
						onClose={onTorProxyClose}
						onSubmit={addTorOutbound}
					/>
				)}
				{isWindscribeProxyOpen && (
					<WindscribeProxyModal
						open={isWindscribeProxyOpen}
						loading={isApplyingWindscribeProxy}
						isMasterTarget={isMasterTarget}
						targetID={selectedTarget}
						existingTags={availableOutboundTags}
						onClose={onWindscribeProxyClose}
						onSubmit={addWindscribeOutbound}
					/>
				)}
				{isPsiphonProxyOpen && (
					<PsiphonProxyModal
						open={isPsiphonProxyOpen}
						loading={isApplyingPsiphonProxy}
						isMasterTarget={isMasterTarget}
						targetID={selectedTarget}
						existingTags={availableOutboundTags}
						onClose={onPsiphonProxyClose}
						onSubmit={addPsiphonOutbounds}
					/>
				)}
				{isBalancerOpen && (
					<BalancerModal
						open={isBalancerOpen}
						onClose={handleBalancerModalClose}
						mode={editingBalancerIndex !== null ? "edit" : "create"}
						initialBalancer={
							editingBalancerIndex !== null
								? {
										tag: balancersData[editingBalancerIndex]?.tag ?? "",
										strategy:
											balancersData[editingBalancerIndex]?.strategy ?? "random",
										selector:
											balancersData[editingBalancerIndex]?.selector ?? [],
										fallbackTag:
											balancersData[editingBalancerIndex]?.fallbackTag ?? "",
										strategySettings: strategySettingsAt(editingBalancerIndex),
									}
								: null
						}
						outboundTags={availableOutboundTags}
						outboundOptions={outboundTagOptions}
						excludedOutboundTags={excludedBalancerOutboundTags}
						onTestOutbound={testOutboundByTag}
						outboundTestingByTag={outboundTestingByTag}
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
						sourceTarget={selectedTarget}
						propagationBase={
							propagationBaseFor(
								"balancers",
								editingBalancerIndex !== null
									? (getBalancers()[editingBalancerIndex] ?? null)
									: null,
							) as Record<string, unknown> | null
						}
						onSubmit={handleBalancerSubmit}
					/>
				)}
				{isDnsOpen && (
					<DnsModal
						open={isDnsOpen}
						onClose={handleDnsModalClose}
						form={form}
						setDnsServers={setDnsServers}
						dnsIndex={editingDnsIndex}
						currentDnsData={
							editingDnsIndex !== null ? dnsServers[editingDnsIndex] : null
						}
					/>
				)}
				{isDnsPresetsOpen && (
					<DnsPresetsModal
						open={isDnsPresetsOpen}
						onClose={onDnsPresetsClose}
						onSelectPreset={applyDnsPreset}
					/>
				)}
				{isFakeDnsOpen && (
					<FakeDnsModal
						open={isFakeDnsOpen}
						onClose={handleFakeDnsModalClose}
						form={form}
						setFakeDns={setFakeDns}
						fakeDnsIndex={editingFakeDnsIndex}
						currentFakeDnsData={
							editingFakeDnsIndex !== null ? fakeDns[editingFakeDnsIndex] : null
						}
					/>
				)}
			</Suspense>
			<ConfirmDialog
				open={Boolean(deleteWarning)}
				onClose={() => setDeleteWarning(null)}
				onConfirm={() => {
					deleteWarning?.onConfirm();
					setDeleteWarning(null);
				}}
				title={t("pages.xray.propagate.deleteTitle")}
				description={deleteWarning?.description ?? ""}
				colorScheme="red"
			/>
			<ConfirmDialog
				open={Boolean(outboundReset)}
				onClose={() => setOutboundReset(null)}
				onConfirm={confirmOutboundTrafficReset}
				title={t("pages.xray.outbound.resetTraffic")}
				description={
					outboundReset?.index === -1
						? t("pages.xray.outbound.resetTrafficScopeConfirm")
						: t("pages.xray.outbound.resetTrafficConfirm", {
								tag: outboundData[outboundReset?.index ?? -1]?.tag ?? "",
							})
				}
				confirmLabel={t("reset")}
			/>
		</div>
	);
};

export default CoreSettingsPage;
