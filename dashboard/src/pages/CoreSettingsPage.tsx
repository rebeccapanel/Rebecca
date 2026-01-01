import type { TableProps } from "@chakra-ui/react";
import {
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
	Select,
	Spinner,
	Stack,
	Switch,
	Tab,
	TabList,
	Table,
	TabPanel,
	TabPanels,
	Tabs,
	Tag,
	TagCloseButton,
	TagLabel,
	Tbody,
	Td,
	Text,
	Th,
	Thead,
	Tr,
	useBreakpointValue,
	useColorModeValue,
	useDisclosure,
	useToast,
	VStack,
	Wrap,
	WrapItem,
} from "@chakra-ui/react";
import {
	PlusIcon as AddIcon,
	AdjustmentsHorizontalIcon,
	ArrowDownIcon,
	ArrowsPointingInIcon,
	ArrowsPointingOutIcon,
	ArrowsRightLeftIcon,
	ArrowUpIcon,
	ArrowUpTrayIcon,
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
import { BalancerModal } from "../components/BalancerModal";
import { DnsModal } from "../components/DnsModal";
import { FakeDnsModal } from "../components/FakeDnsModal";
import { JsonEditor } from "../components/JsonEditor";
import { OutboundModal } from "../components/OutboundModal";
import { type RoutingRule, RuleModal } from "../components/RuleModal";
import { WarpModal } from "../components/WarpModal";
import { SizeFormatter } from "../utils/outbound";
import { computeOutboundIds } from "../utils/outboundId";
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
const compactActionButtonProps = {
	colorScheme: "primary",
	size: "xs" as const,
	variant: "solid" as const,
	fontSize: "xs",
	px: 3,
	h: 7,
};

const serializeConfig = (value: any) => JSON.stringify(value ?? {});
const formatList = (value: string | string[] | undefined) =>
	Array.isArray(value) ? value.join(",") : (value ?? "");

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

type OutboundJson = Record<string, any>;

const SettingsSection: FC<{ title: string; children: ReactNode }> = ({
	title,
	children,
}) => {
	const headerBg = useColorModeValue("gray.50", "whiteAlpha.100");
	const borderColor = useColorModeValue("gray.200", "whiteAlpha.300");
	return (
		<Box
			borderWidth="1px"
			borderColor={borderColor}
			borderRadius="lg"
			overflow="hidden"
		>
			<Box bg={headerBg} px={{ base: 3, md: 4 }} py={2}>
				<Text fontWeight="semibold" fontSize={{ base: "sm", md: "md" }}>
					{title}
				</Text>
			</Box>
			<Box overflowX="auto">
				<Table variant="simple" size="sm" minW={{ base: "100%", md: "unset" }}>
					<Tbody>{children}</Tbody>
				</Table>
			</Box>
		</Box>
	);
};

const SettingRow: FC<{
	label: string;
	controlId: string;
	children: (controlId: string) => ReactNode;
}> = ({ label, controlId, children }) => {
	const labelColor = useColorModeValue("gray.700", "whiteAlpha.800");
	return (
		<Tr
			display={{ base: "block", md: "table-row" }}
			_notFirst={{
				borderTopWidth: { base: "1px", md: "0" },
				borderColor: "gray.200",
				_dark: { borderColor: "whiteAlpha.200" },
			}}
		>
			<Td
				width={{ base: "100%", md: "40%" }}
				py={3}
				pr={{ base: 0, md: 4 }}
				display={{ base: "block", md: "table-cell" }}
			>
				<FormLabel
					htmlFor={controlId}
					mb={{ base: 2, md: 0 }}
					color={labelColor}
				>
					{label}
				</FormLabel>
			</Td>
			<Td py={3} display={{ base: "block", md: "table-cell" }}>
				<FormControl
					id={controlId}
					display="flex"
					flexDir={{ base: "column", md: "row" }}
					alignItems={{ base: "flex-start", md: "center" }}
					gap={{ base: 2, md: 4 }}
					w="full"
				>
					{children(controlId)}
				</FormControl>
			</Td>
		</Tr>
	);
};

const TableCard: FC<{ children: ReactNode }> = ({ children }) => {
	const borderColor = useColorModeValue("gray.200", "whiteAlpha.200");
	const bg = useColorModeValue("white", "blackAlpha.400");
	const shadow = useColorModeValue("sm", "none");
	return (
		<Box
			borderWidth="1px"
			borderColor={borderColor}
			borderRadius="xl"
			bg={bg}
			boxShadow={shadow}
			overflow="hidden"
		>
			<Box overflowX="auto">{children}</Box>
		</Box>
	);
};

const TableGrid: FC<TableProps> = ({ children, ...props }) => {
	const headerBg = useColorModeValue("gray.50", "whiteAlpha.100");
	const verticalBorderColor = useColorModeValue("gray.200", "whiteAlpha.300");
	const headerBorderColor = useColorModeValue("gray.300", "whiteAlpha.300");
	const bodyBorderColor = useColorModeValue("gray.100", "whiteAlpha.200");
	const hoverBg = useColorModeValue("gray.50", "whiteAlpha.100");
	return (
		<Table
			size="sm"
			w="full"
			{...props}
			sx={{
				borderCollapse: "separate",
				borderSpacing: 0,
				"th, td": {
					borderRight: "1px solid",
					borderColor: verticalBorderColor,
				},
				"th:first-of-type, td:first-of-type": {
					borderLeft: "1px solid",
					borderColor: verticalBorderColor,
				},
				"thead th": {
					bg: headerBg,
					borderBottom: "1px solid",
					borderBottomColor: headerBorderColor,
					textTransform: "none",
					fontWeight: "semibold",
					fontSize: "sm",
					letterSpacing: "normal",
				},
				"tbody td": {
					borderBottom: "1px solid",
					borderBottomColor: bodyBorderColor,
					fontSize: "sm",
					verticalAlign: "top",
				},
				"tbody tr:last-of-type td": {
					borderBottom: "none",
				},
				"tbody tr:hover": {
					bg: hoverBg,
				},
			}}
		>
			{children}
		</Table>
	);
};

export const CoreSettingsPage: FC = () => {
	const { t } = useTranslation();
	const {
		fetchCoreSettings,
		updateConfig,
		config,
		isPostLoading,
		restartCore,
	} = useCoreSettings();
	const { userData, getUserIsSuccess } = useGetUser();
	const { onEditingCore } = useDashboard();
	const canManageXraySettings =
		getUserIsSuccess && Boolean(userData.permissions?.sections.xray);
	const { data: serverIPs } = useQuery(
		["server-ips"],
		() => apiFetch<{ ipv4: string; ipv6: string }>("/core/ips"),
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
		isOpen: isDnsOpen,
		onOpen: onDnsOpen,
		onClose: onDnsClose,
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

	const [outboundData, setOutboundData] = useState<any[]>([]);
	const [routingRuleData, setRoutingRuleData] = useState<any[]>([]);
	const [balancersData, setBalancersData] = useState<any[]>([]);
	const [dnsServers, setDnsServers] = useState<any[]>([]);
	const [fakeDns, setFakeDns] = useState<any[]>([]);
	const [outboundsTraffic, setOutboundsTraffic] = useState<any[]>([]);
	const [outboundIds, setOutboundIds] = useState<string[]>([]);
	const [editingRuleIndex, setEditingRuleIndex] = useState<number | null>(null);
	const [editingOutboundIndex, setEditingOutboundIndex] = useState<
		number | null
	>(null);
	const [editingDnsIndex, setEditingDnsIndex] = useState<number | null>(null);
	const [isFullScreen, setIsFullScreen] = useState(false);
	const [advSettings, setAdvSettings] = useState<string>("xraySetting");
	const [obsSettings, setObsSettings] = useState<string>("");
	const isMobile = useBreakpointValue({ base: true, md: false });
	const [jsonKey, setJsonKey] = useState(0); // force re-render of JsonEditor
	const [warpOptionValue, setWarpOptionValue] = useState<string>("");
	const [warpCustomDomain, setWarpCustomDomain] = useState<string>("");
	const [activeTab, setActiveTab] = useState<number>(0);
	const tabKeys = [
		"basic",
		"routing",
		"outbounds",
		"balancers",
		"dns",
		"advanced",
		"logs",
	];
	const splitHash = () => {
		const hash = window.location.hash || "";
		const idx = hash.indexOf("#", 1);
		return {
			base: idx >= 0 ? hash.slice(0, idx) : hash,
			tab: idx >= 0 ? hash.slice(idx + 1) : "",
		};
	};

useEffect(() => {
	const syncFromHash = () => {
		const { tab } = splitHash();
		const idx = tabKeys.findIndex((key) => key === tab.toLowerCase());
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
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const basicSectionBorder = useColorModeValue("gray.200", "whiteAlpha.300");

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
		if (!canManageXraySettings) {
			onEditingCore(false);
			return;
		}

		onEditingCore(true);
		fetchCoreSettings()
			.then(() => {
				console.log("Core settings fetched successfully");
			})
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
	}, [canManageXraySettings, fetchCoreSettings, onEditingCore, toast, t]);

	useEffect(() => {
		if (config) {
			form.reset({ config });
			initialConfigStringRef.current = serializeConfig(config);
			syncOutboundDisplay((config?.outbounds as OutboundJson[]) || []);
			syncRoutingRuleDisplay((config?.routing?.rules as RoutingRule[]) || []);
			setBalancersData(
				config?.routing?.balancers?.map((b: any, index: number) => ({
					key: index,
					tag: b.tag || "",
					strategy: b.strategy?.type || "random",
					selector: b.selector || [],
					fallbackTag: b.fallbackTag || "",
				})) || [],
			);
			setDnsServers(config?.dns?.servers || []);
			setFakeDns(config?.fakedns || []);
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
	}, [config, form, syncOutboundDisplay, syncRoutingRuleDisplay]);

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
		updateConfig(submittedConfig)
			.then(() => {
				form.reset({ config: submittedConfig });
				initialConfigStringRef.current = serializeConfig(submittedConfig);
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

	const fetchOutboundsTraffic = async () => {
		const response = await apiFetch<{ success: boolean; obj: any }>(
			"/panel/xray/getOutboundsTraffic",
		);
		if (response?.success) {
			setOutboundsTraffic(response.obj);
		}
	};

	const _resetOutboundTraffic = async (index: number) => {
		const payload: Record<string, string | undefined> = {};
		if (index < 0) {
			payload.outbound_id = "-all-";
			payload.tag = "-alltags-";
		} else {
			const outboundId = outboundIds[index];
			if (outboundId) {
				payload.outbound_id = outboundId;
			}
			payload.tag = outboundData[index]?.tag;
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

	const addBalancer = () => {
		onBalancerOpen();
	};

	const editBalancer = (_index: number) => {
		onBalancerOpen();
	};

	const deleteBalancer = (index: number) => {
		const newBalancers = [...balancersData];
		const removedBalancer = newBalancers.splice(index, 1)[0];
		form.setValue("config.routing.balancers", newBalancers, {
			shouldDirty: true,
		});
		setBalancersData(newBalancers);
		const newConfig = { ...form.getValues("config") };
		if (newConfig.observatory) {
			newConfig.observatory.subjectSelector =
				newConfig.observatory.subjectSelector.filter(
					(s: string) => s !== removedBalancer.tag,
				);
		}
		if (newConfig.burstObservatory) {
			newConfig.burstObservatory.subjectSelector =
				newConfig.burstObservatory.subjectSelector.filter(
					(s: string) => s !== removedBalancer.tag,
				);
		}
		form.setValue("config", newConfig, { shouldDirty: true });
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

	const addFakeDns = () => {
		onFakeDnsOpen();
	};

	const editFakeDns = (_index: number) => {
		onFakeDnsOpen();
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
			case "vless":
				return (
					outbound.settings.vnext?.map(
						(obj: any) => `${obj.address}:${obj.port}`,
					) || []
				);
			case "http":
			case "socks":
			case "shadowsocks":
			case "trojan":
				return (
					outbound.settings.servers?.map(
						(obj: any) => `${obj.address}:${obj.port}`,
					) || []
				);
			case "dns":
				return [`${outbound.settings?.address}:${outbound.settings?.port}`];
			case "wireguard":
				return outbound.settings.peers?.map((peer: any) => peer.endpoint) || [];
			default:
				return [];
		}
	};

	const findOutboundTraffic = (outbound: any, index: number) => {
		const outboundId = outboundIds[index];
		const traffic = outboundId
			? outboundsTraffic.find((t) => t.outbound_id === outboundId)
			: outboundsTraffic.find((t) => t.tag === outbound.tag);
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

	useEffect(() => {
		let active = true;
		if (!canManageXraySettings) return;
		fetchOutboundsTraffic().catch(() => {
			if (active) setOutboundsTraffic([]);
		});
		return () => {
			active = false;
		};
	}, [canManageXraySettings]);

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

	const warpSectionBg = useColorModeValue("white", "blackAlpha.400");
	const warpSectionBorder = useColorModeValue("gray.200", "whiteAlpha.200");

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
				return JSON.stringify(cfg.inbounds ?? [], null, 2);
			case "outboundSettings":
				return JSON.stringify(cfg.outbounds ?? [], null, 2);
			case "routingRuleSettings":
				return JSON.stringify(cfg.routing?.rules ?? [], null, 2);
			default:
				return JSON.stringify(cfg ?? {}, null, 2);
		}
	};

	const setAdvancedJson = (value: string) => {
		try {
			const parsed = JSON.parse(value);
			const cfg = { ...(form.getValues("config") || {}) };
			switch (advSettings) {
				case "inboundSettings":
					cfg.inbounds = parsed;
					break;
				case "outboundSettings":
					cfg.outbounds = parsed;
					syncOutboundDisplay(parsed as OutboundJson[]);
					break;
				case "routingRuleSettings":
					if (!cfg.routing) cfg.routing = {};
					cfg.routing.rules = parsed;
					syncRoutingRuleDisplay(parsed as RoutingRule[]);
					break;
				default:
					// replace whole config
					form.setValue("config", parsed, { shouldDirty: true });
					// sync all derived states
					syncOutboundDisplay((parsed?.outbounds as OutboundJson[]) || []);
					syncRoutingRuleDisplay(
						(parsed?.routing?.rules as RoutingRule[]) || [],
					);
					setBalancersData(
						parsed?.routing?.balancers?.map((b: any, index: number) => ({
							key: index,
							tag: b.tag || "",
							strategy: b.strategy?.type || "random",
							selector: b.selector || [],
							fallbackTag: b.fallbackTag || "",
						})) || [],
					);
					setDnsServers(parsed?.dns?.servers || []);
					setFakeDns(parsed?.fakedns || []);
					return;
			}
			form.setValue("config", cfg, { shouldDirty: true });
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

	const handleTabChange = (index: number) => {
		setActiveTab(index);
		const key = tabKeys[index] || "";
		const { base } = splitHash();
		window.location.hash = `${base || "#"}#${key}`;
	};

	return (
		<VStack spacing={6} align="stretch">
			<Text as="h1" fontWeight="semibold" fontSize="2xl">
				{t("header.coreSettings")}
			</Text>
			<Text color="gray.600" _dark={{ color: "gray.300" }} fontSize="sm">
				{t("pages.xray.coreDescription")}
			</Text>
			<Stack
				direction={{ base: "column", sm: "row" }}
				spacing={{ base: 3, sm: 4 }}
				justifyContent="space-between"
				alignItems={{ base: "stretch", sm: "center" }}
			>
				<Stack
					direction={{ base: "column", sm: "row" }}
					spacing={3}
					flexWrap="wrap"
					w="full"
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
						onClick={() => handleRestartCore()}
						variant="outline"
						w={{ base: "full", sm: "auto" }}
					>
						{t(isRestarting ? "core.restarting" : "core.restartCore")}
					</Button>
				</Stack>
			</Stack>
			<Tabs
				variant="enclosed"
				colorScheme="primary"
				isLazy
				isManual
				index={activeTab}
				onChange={handleTabChange}
			>
				<TabList
					overflowX="auto"
					flexWrap={{ base: "wrap", md: "nowrap" }}
					gap={{ base: 2, md: 0 }}
					pb={{ base: 1, md: 0 }}
					sx={{
						"&::-webkit-scrollbar": { display: "none" },
						button: {
							flexShrink: 0,
							fontSize: "sm",
							minW: "max-content",
							px: 3,
							py: 2,
							"@media (min-width: 48em)": {
								fontSize: "md",
								px: 4,
								py: 3,
							},
						},
					}}
				>
					<Tab>
						<HStack spacing={2} align="center">
							<BasicTabIcon />
							<Text as="span">{t("pages.xray.basicTemplate")}</Text>
						</HStack>
					</Tab>
					<Tab>
						<HStack spacing={2} align="center">
							<RoutingTabIcon />
							<Text as="span">{t("pages.xray.Routings")}</Text>
						</HStack>
					</Tab>
					<Tab>
						<HStack spacing={2} align="center">
							<OutboundTabIcon />
							<Text as="span">{t("pages.xray.Outbounds")}</Text>
						</HStack>
					</Tab>
					<Tab>
						<HStack spacing={2} align="center">
							<BalancerTabIcon />
							<Text as="span">{t("pages.xray.Balancers")}</Text>
						</HStack>
					</Tab>
					<Tab>
						<HStack spacing={2} align="center">
							<DnsTabIcon />
							<Text as="span">{t("DNS")}</Text>
						</HStack>
					</Tab>
					<Tab>
						<HStack spacing={2} align="center">
							<AdvancedTabIcon />
							<Text as="span">{t("pages.xray.advancedTemplate")}</Text>
						</HStack>
					</Tab>
					<Tab>
						<HStack spacing={2} align="center">
							<LogsTabIcon />
							<Text as="span">{t("pages.xray.logs")}</Text>
						</HStack>
					</Tab>
				</TabList>
				<TabPanels>
					<TabPanel>
						<VStack spacing={4} align="stretch">
							<Box
								borderWidth="1px"
								borderColor={basicSectionBorder}
								borderRadius="lg"
								p={{ base: 3, md: 4 }}
							>
								<VStack spacing={4} align="stretch">
									<SettingsSection
										title={t("pages.xray.serverIPs", "Server IPs")}
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
														handleFreedomDomainStrategyChange(
															event.target.value,
														)
													}
													isDisabled={freedomOutboundIndex === -1}
												>
													<option value="">
														{t("core.default", "Default")}
													</option>
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
															{["AsIs", "IPIfNonMatch", "IPOnDemand"].map(
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
									</SettingsSection>
									<Box
										borderWidth="1px"
										borderColor={warpSectionBorder}
										borderRadius="lg"
										bg={warpSectionBg}
										p={{ base: 3, md: 4 }}
									>
										<VStack align="stretch" spacing={3}>
											<HStack justify="space-between" align="center">
												<Text fontWeight="semibold">
													{t("pages.xray.warpRouting")}
												</Text>
												<Button
													variant="outline"
													size="sm"
													leftIcon={<WarpIconStyled />}
													onClick={onWarpOpen}
												>
													{warpExists
														? t("pages.xray.warp.manage", "Manage WARP")
														: t("pages.xray.warp.create", "Create WARP")}
												</Button>
											</HStack>
											<Text fontSize="sm" color={warpDomainHelper}>
												{t("pages.xray.warpRoutingDesc")}
											</Text>
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
															{[
																"none",
																"debug",
																"info",
																"warning",
																"error",
															].map((s) => (
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
											label={t("pages.xray.accessLog")}
											controlId="access-log"
										>
											{(id) => (
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
											)}
										</SettingRow>
										<SettingRow
											label={t("pages.xray.errorLog")}
											controlId="error-log"
										>
											{(id) => (
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
							</Box>
						</VStack>
					</TabPanel>
					<TabPanel>
						<VStack spacing={4} align="stretch">
							<Button
								leftIcon={<AddIconStyled />}
								{...compactActionButtonProps}
								onClick={addRule}
							>
								{t("pages.xray.rules.add")}
							</Button>
							<TableCard>
								<TableGrid minW="1100px">
									<Thead>
										<Tr>
											<Th rowSpan={2} w="80px">
												{t("common.index")}
											</Th>
											<Th colSpan={2}>{t("pages.xray.rules.sourceGroup")}</Th>
											<Th colSpan={3}>{t("pages.xray.rules.networkGroup")}</Th>
											<Th colSpan={3}>
												{t("pages.xray.rules.destinationGroup")}
											</Th>
											<Th colSpan={2}>{t("pages.xray.rules.inboundGroup")}</Th>
											<Th rowSpan={2}>{t("pages.xray.rules.outbound")}</Th>
											<Th rowSpan={2}>{t("pages.xray.rules.balancer")}</Th>
											<Th rowSpan={2}>{t("actions")}</Th>
										</Tr>
										<Tr>
											<Th>{t("IP")}</Th>
											<Th>{t("port")}</Th>
											<Th>{t("network")}</Th>
											<Th>{t("pages.xray.rules.protocol")}</Th>
											<Th>{t("pages.xray.rules.attrs")}</Th>
											<Th>{t("IP")}</Th>
											<Th>{t("pages.xray.rules.domain")}</Th>
											<Th>{t("port")}</Th>
											<Th>{t("pages.xray.rules.inboundTag")}</Th>
											<Th>{t("pages.xray.rules.user")}</Th>
										</Tr>
									</Thead>
									<Tbody>
										{routingRuleData.length === 0 && (
											<Tr>
												<Td colSpan={14}>
													<Text textAlign="center" color="gray.500">
														{t("pages.xray.rules.empty")}
													</Text>
												</Td>
											</Tr>
										)}
										{routingRuleData.map((rule, index) => (
											<Tr key={rule.key}>
												<Td>
													<VStack align="flex-start" spacing={1}>
														<Text fontWeight="semibold">{index + 1}</Text>
														<HStack spacing={1}>
															<IconButton
																aria-label="move up"
																icon={<ArrowUpIconStyled />}
																size="xs"
																variant="ghost"
																isDisabled={index === 0}
																onClick={() => replaceRule(index, index - 1)}
															/>
															<IconButton
																aria-label="move down"
																icon={<ArrowDownIconStyled />}
																size="xs"
																variant="ghost"
																isDisabled={
																	index === routingRuleData.length - 1
																}
																onClick={() => replaceRule(index, index + 1)}
															/>
														</HStack>
													</VStack>
												</Td>
												<Td>{renderChipList(rule.source, "blue")}</Td>
												<Td>{renderTextValue(rule.sourcePort)}</Td>
												<Td>{renderChipList(rule.network, "purple")}</Td>
												<Td>{renderChipList(rule.protocol, "green")}</Td>
												<Td>{renderAttrsCell(rule.attrs)}</Td>
												<Td>{renderChipList(rule.ip, "blue")}</Td>
												<Td>{renderChipList(rule.domain, "blue")}</Td>
												<Td>{renderTextValue(rule.port)}</Td>
												<Td>{renderChipList(rule.inboundTag, "teal")}</Td>
												<Td>{renderChipList(rule.user, "cyan")}</Td>
												<Td>{renderTextValue(rule.outboundTag)}</Td>
												<Td>{renderTextValue(rule.balancerTag)}</Td>
												<Td>
													<HStack spacing={1}>
														<IconButton
															aria-label="edit"
															icon={<EditIconStyled />}
															size="xs"
															variant="ghost"
															onClick={() => editRule(index)}
														/>
														<IconButton
															aria-label="delete"
															icon={<DeleteIconStyled />}
															size="xs"
															variant="ghost"
															colorScheme="red"
															onClick={() => deleteRule(index)}
														/>
													</HStack>
												</Td>
											</Tr>
										))}
									</Tbody>
								</TableGrid>
							</TableCard>
						</VStack>
					</TabPanel>
					<TabPanel>
						<VStack spacing={4} align="stretch">
							<HStack>
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
									leftIcon={<ReloadIconStyled />}
									size="xs"
									variant="ghost"
									onClick={fetchOutboundsTraffic}
								>
									{t("refresh")}
								</Button>
							</HStack>
							<TableCard>
								<TableGrid minW="880px">
									<Thead>
										<Tr>
											<Th>#</Th>
											<Th>{t("pages.xray.outbound.tag")}</Th>
											<Th>{t("protocol")}</Th>
											<Th>{t("pages.xray.outbound.address")}</Th>
											<Th>{t("pages.inbounds.traffic")}</Th>
										</Tr>
									</Thead>
									<Tbody>
										{outboundData.map((outbound, index) => (
											<Tr key={outbound.key}>
												<Td>
													<HStack>
														<Text>{index + 1}</Text>
														<IconButton
															aria-label={t(
																"pages.xray.outbound.moveUp",
																"Move up",
															)}
															icon={<ArrowUpIconStyled />}
															size="xs"
															variant="ghost"
															isDisabled={index === 0}
															onClick={() => moveOutboundUp(index)}
														/>
														<IconButton
															aria-label={t(
																"pages.xray.outbound.moveDown",
																"Move down",
															)}
															icon={<ArrowDownIconStyled />}
															size="xs"
															variant="ghost"
															isDisabled={index === outboundData.length - 1}
															onClick={() => moveOutboundDown(index)}
														/>
														<IconButton
															aria-label="edit"
															icon={<EditIconStyled />}
															size="xs"
															variant="ghost"
															onClick={() => editOutbound(index)}
														/>
														<IconButton
															aria-label="delete"
															icon={<DeleteIconStyled />}
															size="xs"
															variant="ghost"
															colorScheme="red"
															onClick={() => deleteOutbound(index)}
														/>
													</HStack>
												</Td>
												<Td>{outbound.tag}</Td>
												<Td>
													<Tag colorScheme="purple">{outbound.protocol}</Tag>
													{["vmess", "vless", "trojan", "shadowsocks"].includes(
														outbound.protocol,
													) && (
														<>
															<Tag colorScheme="blue">
																{outbound.streamSettings?.network}
															</Tag>
															{outbound.streamSettings?.security === "tls" && (
																<Tag colorScheme="green">tls</Tag>
															)}
															{outbound.streamSettings?.security ===
																"reality" && (
																<Tag colorScheme="green">reality</Tag>
															)}
														</>
													)}
												</Td>
												<Td>
													{findOutboundAddress(outbound).map((addr: string) => (
														<Text key={addr}>{addr}</Text>
													))}
												</Td>
												<Td>
													<Tag colorScheme="green">
														{findOutboundTraffic(outbound, index)}
													</Tag>
												</Td>
											</Tr>
										))}
									</Tbody>
								</TableGrid>
							</TableCard>
						</VStack>
					</TabPanel>
					<TabPanel>
						<VStack spacing={4} align="stretch">
							<Button
								leftIcon={<AddIconStyled />}
								{...compactActionButtonProps}
								onClick={addBalancer}
							>
								{t("pages.xray.balancer.addBalancer")}
							</Button>
							<TableCard>
								<TableGrid minW="680px">
									<Thead>
										<Tr>
											<Th>#</Th>
											<Th>{t("pages.xray.balancer.tag")}</Th>
											<Th>{t("pages.xray.balancer.balancerStrategy")}</Th>
											<Th>{t("pages.xray.balancer.balancerSelectors")}</Th>
										</Tr>
									</Thead>
									<Tbody>
										{balancersData.map((balancer, index) => (
											<Tr key={balancer.key}>
												<Td>
													<HStack>
														<Text>{index + 1}</Text>
														<IconButton
															aria-label="edit"
															icon={<EditIconStyled />}
															size="xs"
															variant="ghost"
															onClick={() => editBalancer(index)}
														/>
														<IconButton
															aria-label="delete"
															icon={<DeleteIconStyled />}
															size="xs"
															variant="ghost"
															colorScheme="red"
															onClick={() => deleteBalancer(index)}
														/>
													</HStack>
												</Td>
												<Td>{balancer.tag}</Td>
												<Td>
													<Tag
														colorScheme={
															balancer.strategy === "random"
																? "purple"
																: "green"
														}
													>
														{balancer.strategy === "random"
															? "Random"
															: balancer.strategy === "roundRobin"
																? "Round Robin"
																: balancer.strategy === "leastLoad"
																	? "Least Load"
																	: "Least Ping"}
													</Tag>
												</Td>
												<Td>
													{balancer.selector.map((sel: string) => (
														<Tag key={sel} colorScheme="blue" m={1}>
															{sel}
														</Tag>
													))}
												</Td>
											</Tr>
										))}
									</Tbody>
								</TableGrid>
							</TableCard>
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
					</TabPanel>
					<TabPanel>
						<VStack spacing={4} align="stretch">
							<FormControl display="flex" alignItems="center">
								<FormLabel>{t("pages.xray.dns.enable")}</FormLabel>
								<Controller
									name="config.dns"
									control={form.control}
									render={({ field }) => (
										<Switch
											isChecked={!!field.value}
											onChange={(e) => {
												const newConfig = { ...form.getValues("config") };
												if (e.target.checked) {
													newConfig.dns = {
														servers: [],
														queryStrategy: "UseIP",
														tag: "dns_inbound",
													};
													setDnsServers([]);
													setFakeDns([]);
												} else {
													delete newConfig.dns;
													delete newConfig.fakedns;
													setDnsServers([]);
													setFakeDns([]);
												}
												form.setValue("config", newConfig, {
													shouldDirty: true,
												});
												field.onChange(newConfig.dns);
											}}
										/>
									)}
								/>
							</FormControl>
							{form.watch("config.dns") && (
								<>
									<Button
										leftIcon={<AddIconStyled />}
										{...compactActionButtonProps}
										onClick={addDnsServer}
									>
										{t("pages.xray.dns.add")}
									</Button>
									{dnsServers.length > 0 && (
										<TableCard>
											<TableGrid minW="720px">
												<Thead>
													<Tr>
														<Th>#</Th>
														<Th>{t("pages.xray.outbound.address")}</Th>
														<Th>{t("pages.xray.dns.domains")}</Th>
														<Th>{t("pages.xray.dns.expectIPs")}</Th>
													</Tr>
												</Thead>
												<Tbody>
													{dnsServers.map((dns, index) => (
														<Tr key={dns.address ?? JSON.stringify(dns)}>
															<Td>
																<HStack>
																	<Text>{index + 1}</Text>
																	<IconButton
																		aria-label="edit"
																		icon={<EditIconStyled />}
																		size="xs"
																		variant="ghost"
																		onClick={() => editDnsServer(index)}
																	/>
																	<IconButton
																		aria-label="delete"
																		icon={<DeleteIconStyled />}
																		size="xs"
																		variant="ghost"
																		colorScheme="red"
																		onClick={() => deleteDnsServer(index)}
																	/>
																</HStack>
															</Td>
															<Td>
																{typeof dns === "object" ? dns.address : dns}
															</Td>
															<Td>
																{typeof dns === "object"
																	? formatList(dns.domains)
																	: ""}
															</Td>
															<Td>
																{typeof dns === "object"
																	? formatList(dns.expectIPs)
																	: ""}
															</Td>
														</Tr>
													))}
												</Tbody>
											</TableGrid>
										</TableCard>
									)}
								</>
							)}
							{fakeDns.length > 0 && (
								<>
									<Button
										leftIcon={<AddIconStyled />}
										{...compactActionButtonProps}
										onClick={addFakeDns}
									>
										{t("pages.xray.fakedns.add")}
									</Button>
									<TableCard>
										<TableGrid minW="520px">
											<Thead>
												<Tr>
													<Th>#</Th>
													<Th>{t("pages.xray.fakedns.ipPool")}</Th>
													<Th>{t("pages.xray.fakedns.poolSize")}</Th>
												</Tr>
											</Thead>
											<Tbody>
												{fakeDns.map((fake, index) => (
													<Tr key={fake.ipPool ?? JSON.stringify(fake)}>
														<Td>
															<HStack>
																<Text>{index + 1}</Text>
																<IconButton
																	aria-label="edit"
																	icon={<EditIconStyled />}
																	size="xs"
																	variant="ghost"
																	onClick={() => editFakeDns(index)}
																/>
																<IconButton
																	aria-label="delete"
																	icon={<DeleteIconStyled />}
																	size="xs"
																	variant="ghost"
																	colorScheme="red"
																	onClick={() => deleteFakeDns(index)}
																/>
															</HStack>
														</Td>
														<Td>{fake.ipPool}</Td>
														<Td>{fake.poolSize}</Td>
													</Tr>
												))}
											</Tbody>
										</TableGrid>
									</TableCard>
								</>
							)}
						</VStack>
					</TabPanel>
					<TabPanel>
						<VStack spacing={4} align="stretch">
							<Box px={2}>
								<Text fontWeight="semibold">{t("pages.xray.Template")}</Text>
								<Text
									fontSize="sm"
									color="gray.600"
									_dark={{ color: "gray.300" }}
								>
									{t("pages.xray.TemplateDesc")}
								</Text>
							</Box>
							<Box px={2}>
								<RadioGroup
									onChange={(v) => {
										setAdvSettings(v);
										setJsonKey((prev) => prev + 1);
									}}
									value={advSettings}
								>
									<HStack spacing={3} wrap="wrap">
										<Radio value="xraySetting">
											{t("pages.xray.completeTemplate")}
										</Radio>
										<Radio value="inboundSettings">
											{t("pages.xray.Inbounds")}
										</Radio>
										<Radio value="outboundSettings">
											{t("pages.xray.Outbounds")}
										</Radio>
										<Radio value="routingRuleSettings">
											{t("pages.xray.Routings")}
										</Radio>
									</HStack>
								</RadioGroup>
							</Box>
							<Box
								position="relative"
								w="100%"
								h="calc(100vh - 350px)"
								minH="400px"
							>
								<IconButton
									position={isFullScreen ? "fixed" : "absolute"}
									top={2}
									right={2}
									aria-label={isFullScreen ? "Exit Full Screen" : "Full Screen"}
									icon={
										isFullScreen ? (
											<ExitFullScreenIconStyled />
										) : (
											<FullScreenIconStyled />
										)
									}
									onClick={toggleFullScreen}
									zIndex={isFullScreen ? 1101 : 10}
								/>
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
										json={advancedJsonValue}
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
					</TabPanel>
					<TabPanel>
						<Box>
							<XrayLogsPage showTitle={false} />
						</Box>
					</TabPanel>
				</TabPanels>
			</Tabs>
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
			<WarpModal
				isOpen={isWarpOpen}
				onClose={handleWarpModalClose}
				initialOutbound={warpOutbound}
				onSave={handleWarpSave}
				onDelete={handleWarpDelete}
			/>
			<BalancerModal
				isOpen={isBalancerOpen}
				onClose={onBalancerClose}
				form={form}
				setBalancersData={setBalancersData}
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
			<FakeDnsModal
				isOpen={isFakeDnsOpen}
				onClose={onFakeDnsClose}
				form={form}
				setFakeDns={setFakeDns}
			/>
		</VStack>
	);
};

export default CoreSettingsPage;
