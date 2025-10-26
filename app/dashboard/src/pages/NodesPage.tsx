import {
  Alert,
  AlertDescription,
  AlertIcon,
  Box,
  Button,
  ButtonGroup,
  chakra,
  Divider,
  HStack,
  IconButton,
  Popover,
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
  Input,
  InputGroup,
  InputLeftElement,
  Select,
  SimpleGrid,
  Tooltip,
  Stack,
  Spinner,
  Switch,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Tag,
  Text,
  VStack,
  useColorMode,
  useToast,
} from "@chakra-ui/react";
import {
  PlusIcon as AddIcon,
  TrashIcon as DeleteIcon,
  PencilIcon as EditIcon,
  ArrowPathIcon,
  CalendarDaysIcon,
  InformationCircleIcon,
  PresentationChartLineIcon,
  ServerStackIcon,
  MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";
import { useNodes, useNodesQuery, FetchNodesQueryKey, NodeType } from "contexts/NodesContext";
import { useDashboard } from "contexts/DashboardContext";
import { FC, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "react-query";
import { NodeModalStatusBadge } from "../components/NodeModalStatusBadge";
import { NodeFormModal } from "../components/NodeFormModal";
import { DeleteNodeModal } from "../components/DeleteNodeModal";
import ReactApexChart from "react-apexcharts";
import ReactDatePicker from "react-datepicker";
import { ApexOptions } from "apexcharts";
import { createUsageConfig } from "./UsageFilter";
import dayjs, { ManipulateType } from "dayjs";
import utc from "dayjs/plugin/utc";

dayjs.extend(utc);
import useGetUser from "hooks/useGetUser";
import { fetch as apiFetch } from "service/http";
import { formatBytes } from "utils/formatByte";
import { generateErrorMessage, generateSuccessMessage } from "utils/toastHandler";
import { CoreVersionDialog } from "../components/CoreVersionDialog";
import { GeoUpdateDialog } from "../components/GeoUpdateDialog";

const AddIconStyled = chakra(AddIcon, { baseStyle: { w: 4, h: 4 } });
const DeleteIconStyled = chakra(DeleteIcon, { baseStyle: { w: 4, h: 4 } });
const EditIconStyled = chakra(EditIcon, { baseStyle: { w: 4, h: 4 } });
const ArrowPathIconStyled = chakra(ArrowPathIcon, { baseStyle: { w: 4, h: 4 } });
const CalendarIconStyled = chakra(CalendarDaysIcon, { baseStyle: { w: 4, h: 4 } });
const ChartIcon = chakra(PresentationChartLineIcon, { baseStyle: { w: 4, h: 4 } });
const ManageNodesIcon = chakra(ServerStackIcon, { baseStyle: { w: 4, h: 4 } });
const InfoIcon = chakra(InformationCircleIcon, { baseStyle: { w: 4, h: 4 } });
const SearchIcon = chakra(MagnifyingGlassIcon, { baseStyle: { w: 4, h: 4 } });

type RangeKey = "24h" | "7d" | "30d" | "90d" | "custom";
type PresetRangeKey = Exclude<RangeKey, "custom">;

interface RangeState {
  key: RangeKey;
  start: Date;
  end: Date;
  unit: ManipulateType;
}

interface UsagePreset {
  key: PresetRangeKey;
  label: string;
  amount: number;
  unit: ManipulateType;
}

interface DailyUsagePoint {
  date: string;
  used_traffic: number;
}

interface NodeUsageSlice {
  nodeId: number;
  nodeName: string;
  total: number;
}

interface CoreStatsResponse {
  version: string | null;
  started: string | null;
  logs_websocket?: string;
}

type VersionDialogTarget =
  | { type: "master" }
  | { type: "node"; node: NodeType }
  | { type: "bulk" };

type GeoDialogTarget =
  | { type: "master" }
  | { type: "node"; node: NodeType };

const FALLBACK_PRESET: UsagePreset = { key: "30d", label: "30d", amount: 30, unit: "day" };

const formatTimeseriesLabel = (value: string) => {
  if (!value) return value;
  const hasTime = value.includes(" ");
  const normalized = hasTime ? value.replace(" ", "T") : value;
  const parsed = dayjs.utc(normalized);
  if (!parsed.isValid()) {
    return value;
  }
  return hasTime ? parsed.local().format("MM-DD HH:mm") : parsed.format("YYYY-MM-DD");
};

const formatApiStart = (date: Date) => dayjs(date).utc().format("YYYY-MM-DDTHH:mm:ss");
const formatApiEnd = (date: Date) => dayjs(date).utc().format("YYYY-MM-DDTHH:mm:ss");
const buildRangeFromPreset = (preset: UsagePreset): RangeState => {
  const alignUnit: ManipulateType = preset.unit == "hour" ? "hour" : "day";
  const end = dayjs().utc().endOf(alignUnit);
  const span = Math.max(preset.amount - 1, 0);
  const start = end.subtract(span, preset.unit).startOf(alignUnit);
  return {
    key: preset.key,
    start: start.toDate(),
    end: end.toDate(),
    unit: preset.unit,
  };
};

const normalizeCustomRange = (start: Date, end: Date): RangeState => {
  const startDate = dayjs(start);
  const endDate = dayjs(end);
  const [minDate, maxDate] = startDate.isBefore(endDate) ? [startDate, endDate] : [endDate, startDate];
  const startAligned = minDate.startOf("day");
  const endAligned = maxDate.endOf("day");
  const isSingleDay = startAligned.isSame(endAligned, "day");
  return {
    key: "custom",
    start: startAligned.toDate(),
    end: endAligned.toDate(),
    unit: isSingleDay ? "hour" : "day",
  };
};

const buildDailyUsageOptions = (colorMode: string, categories: string[]): ApexOptions => {
  const axisColor = colorMode === "dark" ? "#d8dee9" : "#1a202c";
  return {
    chart: {
      type: "area",
      toolbar: {
        show: false,
      },
      zoom: { enabled: false },
    },
    dataLabels: { enabled: false },
    stroke: {
      curve: "smooth",
      width: 2,
    },
    fill: {
      type: "gradient",
      gradient: {
        shadeIntensity: 1,
        opacityFrom: 0.35,
        opacityTo: 0.05,
        stops: [0, 80, 100],
      },
    },
    grid: {
      borderColor: colorMode === "dark" ? "#2D3748" : "#E2E8F0",
    },
    xaxis: {
      categories,
      labels: {
        style: {
          colors: categories.map(() => axisColor),
        },
      },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: {
      labels: {
        formatter: (value: number) => formatBytes(Number(value) || 0, 1),
        style: {
          colors: [axisColor],
        },
      },
    },
    tooltip: {
      theme: colorMode === "dark" ? "dark" : "light",
      shared: true,
      fillSeriesColor: false,
      y: {
        formatter: (value: number) => formatBytes(Number(value) || 0, 2),
      },
    },
    colors: [colorMode === "dark" ? "#63B3ED" : "#3182CE"],
  };
};

type UsageRangeControlsProps = {
  presets: UsagePreset[];
  range: RangeState;
  onPresetChange: (key: PresetRangeKey) => void;
  onCustomChange: (start: Date, end: Date) => void;
};

const UsageRangeControls: FC<UsageRangeControlsProps> = ({ presets, range, onPresetChange, onCustomChange }) => {
  const { t } = useTranslation();
  const startLabel = dayjs(range.start).format("YYYY-MM-DD");
  const endLabel = dayjs(range.end).format("YYYY-MM-DD");
  const rangeLabel = startLabel === endLabel ? startLabel : `${startLabel} - ${endLabel}`;
  const [isCalendarOpen, setCalendarOpen] = useState(false);
  const [draftRange, setDraftRange] = useState<[Date | null, Date | null]>([range.start, range.end]);

  useEffect(() => {
    if (!isCalendarOpen) {
      setDraftRange([range.start, range.end]);
    }
  }, [isCalendarOpen, range.start, range.end]);

  return (
    <Stack
      direction={{ base: "column", md: "row" }}
      spacing={{ base: 3, md: 4 }}
      alignItems={{ base: "stretch", md: "center" }}
      justifyContent="flex-end"
      w="full"
    >
      <Stack
        direction={{ base: "column", sm: "row" }}
        spacing={2}
        flexWrap="wrap"
        justifyContent={{ sm: "flex-end" }}
        w="full"
      >
        {presets.map((preset) => (
          <Button
            key={preset.key}
            size="sm"
            onClick={() => onPresetChange(preset.key)}
            colorScheme="primary"
            variant={range.key === preset.key ? "solid" : "outline"}
            w={{ base: "full", sm: "auto" }}
          >
            {preset.label}
          </Button>
        ))}
      </Stack>
      <Popover
        placement="bottom-end"
        isOpen={isCalendarOpen}
        onClose={() => {
          setCalendarOpen(false);
        }}
        closeOnBlur={false}
      >
        <PopoverTrigger>
          <Button
            size="sm"
            variant="outline"
            leftIcon={<CalendarIconStyled />}
            w={{ base: "full", sm: "auto" }}
            onClick={() => {
              if (isCalendarOpen) {
                setCalendarOpen(false);
                return;
              }
              setDraftRange([range.start, range.end]);
              setCalendarOpen(true);
            }}
          >
            {rangeLabel}
          </Button>
        </PopoverTrigger>
        <PopoverContent w="auto">
          <PopoverArrow />
          <PopoverBody>
            <ReactDatePicker
              selectsRange
              inline
              maxDate={new Date()}
              startDate={draftRange[0] ?? undefined}
              endDate={draftRange[1] ?? undefined}
              onChange={(dates) => {
                const [start, end] = (dates ?? []) as [Date | null, Date | null];
                setDraftRange([start, end]);
                if (start && end) {
                  onCustomChange(start, end);
                  setCalendarOpen(false);
                }
              }}
            />
            <Text mt={2} fontSize="xs" color="gray.500" _dark={{ color: "gray.400" }}>
              {t("nodes.customRangeHint", "Select a start and end date")}
            </Text>
          </PopoverBody>
        </PopoverContent>
      </Popover>
    </Stack>
  );
};

export const NodesPage: FC = () => {
  const { t } = useTranslation();
  const { onEditingNodes } = useDashboard();
  const {
    data: nodes,
    isLoading,
    error,
    refetch: refetchNodes,
    isFetching,
  } = useNodesQuery();
  const { fetchNodesUsage, addNode, updateNode, reconnectNode, setDeletingNode } = useNodes();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { colorMode } = useColorMode();
  const [editingNode, setEditingNode] = useState<any>(null);
  const [isAddNodeOpen, setAddNodeOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [versionDialogTarget, setVersionDialogTarget] = useState<VersionDialogTarget | null>(null);
  const [geoDialogTarget, setGeoDialogTarget] = useState<GeoDialogTarget | null>(null);
  const [updatingCoreNodeId, setUpdatingCoreNodeId] = useState<number | null>(null);
  const [updatingGeoNodeId, setUpdatingGeoNodeId] = useState<number | null>(null);
  const [updatingMasterCore, setUpdatingMasterCore] = useState(false);
  const [updatingBulkCore, setUpdatingBulkCore] = useState(false);
  const [updatingMasterGeo, setUpdatingMasterGeo] = useState(false);
  const {
    data: coreStats,
    isLoading: isCoreLoading,
    refetch: refetchCoreStats,
    error: coreError,
  } = useQuery<CoreStatsResponse>(
    ["core-stats"],
    () => apiFetch<CoreStatsResponse>("/core"),
    {
      refetchOnWindowFocus: false,
    }
  );
  const presets = useMemo<UsagePreset[]>(
    () => [
      { key: "24h", label: t("nodes.range24h", "Last 24 hours"), amount: 24, unit: "hour" },
      { key: "7d", label: t("nodes.range7d", "Last 7 days"), amount: 7, unit: "day" },
      { key: "30d", label: t("nodes.range30d", "Last 30 days"), amount: 30, unit: "day" },
      { key: "90d", label: t("nodes.range90d", "Last 90 days"), amount: 90, unit: "day" },
    ],
    [t]
  );
  const defaultPreset = presets.find((preset) => preset.key === "30d") ?? presets[0] ?? FALLBACK_PRESET;
  const [nodesUsageRange, setNodesUsageRange] = useState<RangeState>(() => buildRangeFromPreset(defaultPreset));
  const [nodeUsageSlices, setNodeUsageSlices] = useState<NodeUsageSlice[]>([]);
  const [nodeUsageLoading, setNodeUsageLoading] = useState(false);
  const [nodeDailyRange, setNodeDailyRange] = useState<RangeState>(() => buildRangeFromPreset(defaultPreset));
  const [nodeDailySelectedNodeId, setNodeDailySelectedNodeId] = useState<number | null>(null);
  const [nodeDailyLoading, setNodeDailyLoading] = useState(false);
  const [nodeDailyPoints, setNodeDailyPoints] = useState<DailyUsagePoint[]>([]);
  const [nodeDailyMeta, setNodeDailyMeta] = useState<{ nodeName: string; nodeId: number } | null>(null);
  const [adminDonutRange, setAdminDonutRange] = useState<RangeState>(() => buildRangeFromPreset(defaultPreset));
  const [adminDailyRange, setAdminDailyRange] = useState<RangeState>(() => buildRangeFromPreset(defaultPreset));
  const [activeTab, setActiveTab] = useState(0);
  const { userData } = useGetUser();
  const [adminOptions, setAdminOptions] = useState<string[]>([]);
  const [selectedAdminDaily, setSelectedAdminDaily] = useState<string | null>(null);
  const [selectedAdminTotals, setSelectedAdminTotals] = useState<string | null>(null);
  const [adminDailySlices, setAdminDailySlices] = useState<NodeUsageSlice[]>([]);
  const [adminTotalsSlices, setAdminTotalsSlices] = useState<NodeUsageSlice[]>([]);
  const [adminDonutLoading, setAdminDonutLoading] = useState(false);
  const [selectedAdminNodeId, setSelectedAdminNodeId] = useState<number | null>(null);
  const [adminDailyLoading, setAdminDailyLoading] = useState(false);
  const [adminDailyPoints, setAdminDailyPoints] = useState<DailyUsagePoint[]>([]);
  const [adminDailyMeta, setAdminDailyMeta] = useState<{ nodeName: string | null; nodeId: number } | null>(null);
  const parseNodeUsageSlices = useCallback(
    (raw: any): NodeUsageSlice[] => {
      if (!raw) return [];
      const values = Array.isArray(raw) ? raw : Object.values(raw);
      return values.map((entry: any) => ({
        nodeId: Number(entry?.node_id ?? 0),
        nodeName: entry?.node_name ?? t("nodes.unknownNode", "Unknown"),
        total: Number(entry?.uplink ?? 0) + Number(entry?.downlink ?? 0),
      }));
    },
    [t]
  );
  const handleNodesUsagePresetChange = useCallback(
    (key: PresetRangeKey) => {
      const preset = presets.find((item) => item.key === key) ?? FALLBACK_PRESET;
      setNodesUsageRange(buildRangeFromPreset(preset));
    },
    [presets]
  );

  const handleNodesUsageCustomChange = useCallback((start: Date, end: Date) => {
    const normalized = normalizeCustomRange(start, end);
    setNodesUsageRange(normalized);
  }, []);

  const handleNodeDailyPresetChange = useCallback(
    (key: PresetRangeKey) => {
      const preset = presets.find((item) => item.key === key) ?? FALLBACK_PRESET;
      setNodeDailyRange(buildRangeFromPreset(preset));
    },
    [presets]
  );

  const handleNodeDailyCustomChange = useCallback((start: Date, end: Date) => {
    const normalized = normalizeCustomRange(start, end);
    setNodeDailyRange(normalized);
  }, []);

  const handleAdminDailyPresetChange = useCallback(
    (key: PresetRangeKey) => {
      const preset = presets.find((item) => item.key === key) ?? FALLBACK_PRESET;
      setAdminDailyRange(buildRangeFromPreset(preset));
    },
    [presets]
  );

  const handleAdminDailyCustomChange = useCallback((start: Date, end: Date) => {
    const normalized = normalizeCustomRange(start, end);
    setAdminDailyRange(normalized);
  }, []);

  const handleAdminDonutPresetChange = useCallback(
    (key: PresetRangeKey) => {
      const preset = presets.find((item) => item.key === key) ?? FALLBACK_PRESET;
      setAdminDonutRange(buildRangeFromPreset(preset));
    },
    [presets]
  );

  const handleAdminDonutCustomChange = useCallback((start: Date, end: Date) => {
    const normalized = normalizeCustomRange(start, end);
    setAdminDonutRange(normalized);
  }, []);
  const [togglingNodeId, setTogglingNodeId] = useState<number | null>(null);
  const [pendingStatus, setPendingStatus] = useState<Record<number, boolean>>({});

  const totalNodeUsage = useMemo(
    () => nodeUsageSlices.reduce((sum, slice) => sum + slice.total, 0),
    [nodeUsageSlices]
  );

  const nodeUsageChart = useMemo(() => {
    const series = nodeUsageSlices.map((slice) => slice.total);
    const labels = nodeUsageSlices.map((slice) => slice.nodeName);
    const config = createUsageConfig(
      colorMode,
      `${t("userDialog.total")} ${formatBytes(totalNodeUsage || 0, 2)}`,
      series,
      labels
    );
    return config;
  }, [colorMode, nodeUsageSlices, t, totalNodeUsage]);

  const nodeDailyCategories = useMemo(
    () => nodeDailyPoints.map((point) => formatTimeseriesLabel(point.date)),
    [nodeDailyPoints]
  );

  const nodeDailySeries = useMemo(
    () => [
      {
        name: t("nodes.usedTrafficSeries", "Used traffic"),
        data: nodeDailyPoints.map((point) => point.used_traffic),
      },
    ],
    [nodeDailyPoints, t]
  );

  const nodeDailyTotal = useMemo(
    () => nodeDailyPoints.reduce((sum, point) => sum + point.used_traffic, 0),
    [nodeDailyPoints]
  );

  const nodeDailyChartConfig = useMemo(
    () => ({
      options: buildDailyUsageOptions(colorMode, nodeDailyCategories),
      series: nodeDailySeries,
    }),
    [colorMode, nodeDailyCategories, nodeDailySeries]
  );

  const totalAdminUsage = useMemo(
    () => adminTotalsSlices.reduce((sum, slice) => sum + slice.total, 0),
    [adminTotalsSlices]
  );

  const adminDonutChart = useMemo(() => {
    const series = adminTotalsSlices.map((slice) => slice.total);
    const labels = adminTotalsSlices.map((slice) => slice.nodeName);
    const config = createUsageConfig(
      colorMode,
      `${t("userDialog.total")} ${formatBytes(totalAdminUsage || 0, 2)}`,
      series,
      labels
    );
    return config;
  }, [adminTotalsSlices, colorMode, t, totalAdminUsage]);

  const adminDailyCategories = useMemo(
    () => adminDailyPoints.map((point) => formatTimeseriesLabel(point.date)),
    [adminDailyPoints]
  );

  const adminDailySeries = useMemo(
    () => [
      {
        name: t("nodes.usedTrafficSeries", "Used traffic"),
        data: adminDailyPoints.map((point) => point.used_traffic),
      },
    ],
    [adminDailyPoints, t]
  );

  const adminDailyTotal = useMemo(
    () => adminDailyPoints.reduce((sum, point) => sum + point.used_traffic, 0),
    [adminDailyPoints]
  );

  const adminDailyChartConfig = useMemo(
    () => ({
      options: buildDailyUsageOptions(colorMode, adminDailyCategories),
      series: adminDailySeries,
    }),
    [colorMode, adminDailyCategories, adminDailySeries]
  );

  const filteredNodes = useMemo(() => {
    if (!nodes) return [];
    const term = searchTerm.trim().toLowerCase();
    if (!term) return nodes;
    return nodes.filter((node) => {
      const name = (node.name ?? "").toLowerCase();
      const address = (node.address ?? "").toLowerCase();
      const version = (node.xray_version ?? "").toLowerCase();
      return (
        name.includes(term) ||
        address.includes(term) ||
        version.includes(term)
      );
    });
  }, [nodes, searchTerm]);

  const hasConnectedNodes = useMemo(
    () => (nodes ?? []).some((node) => node.id != null && node.status === "connected"),
    [nodes]
  );

  const nodeDailyOptions = useMemo(() => {
    const options: { value: number; label: string }[] = [];
    const seen = new Set<number>();

    nodeUsageSlices.forEach((slice) => {
      if (slice.nodeId > 0 && !seen.has(slice.nodeId)) {
        seen.add(slice.nodeId);
        options.push({ value: slice.nodeId, label: slice.nodeName });
      }
    });

    if (Array.isArray(nodes)) {
      nodes.forEach((node) => {
        if (node?.id && !seen.has(node.id)) {
          seen.add(node.id);
          options.push({ value: node.id, label: node.name });
        }
      });
    }

    return options.sort((a, b) => a.label.localeCompare(b.label));
  }, [nodeUsageSlices, nodes]);

  const adminNodeOptions = useMemo(() => {
    const options: { value: number; label: string }[] = [];
    const seen = new Set<number>();

    adminDailySlices.forEach((slice) => {
      if (!seen.has(slice.nodeId)) {
        seen.add(slice.nodeId);
        options.push({ value: slice.nodeId, label: slice.nodeName });
      }
    });

    if (!seen.has(0)) {
      options.push({ value: 0, label: t("nodes.masterNode", "Master") });
    }

    // ensure physical nodes are present
    if (Array.isArray(nodes)) {
      nodes.forEach((node) => {
        if (node?.id && !seen.has(node.id)) {
          seen.add(node.id);
          options.push({ value: node.id, label: node.name });
        }
      });
    }

    return options.sort((a, b) => a.label.localeCompare(b.label));
  }, [adminDailySlices, nodes, t]);

  const adminSelectOptions = useMemo(
    () => adminOptions.map((username) => ({ value: username, label: username })),
    [adminOptions]
  );

  const nodesById = useMemo(() => {
    const map = new Map<number, string>();
    if (Array.isArray(nodes)) {
      nodes.forEach((node) => {
        if (node?.id != null) {
          map.set(node.id, node.name);
        }
      });
    }
    return map;
  }, [nodes]);

  useEffect(() => {
    onEditingNodes(activeTab === 0);
    return () => {
      if (activeTab === 0) {
        onEditingNodes(false);
      }
    };
  }, [activeTab, onEditingNodes]);

  useEffect(() => {
    let cancelled = false;
    setNodeUsageLoading(true);
    fetchNodesUsage({
      start: formatApiStart(nodesUsageRange.start),
      end: formatApiEnd(nodesUsageRange.end),
    })
      .then((data: any) => {
        if (cancelled) return;
        const slices = parseNodeUsageSlices(data?.usages);
        setNodeUsageSlices(slices);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Error fetching usage data:", err);
        setNodeUsageSlices([]);
        toast({
          title: t("errorFetchingData"),
          status: "error",
          isClosable: true,
          position: "top",
          duration: 3000,
        });
      })
      .finally(() => {
        if (!cancelled) {
          setNodeUsageLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [fetchNodesUsage, nodesUsageRange, parseNodeUsageSlices, toast, t]);

  useEffect(() => {
    if (!userData?.username) return;
    setSelectedAdminDaily((prev) => prev ?? userData.username);
    setSelectedAdminTotals((prev) => prev ?? userData.username);
    if (!userData.is_sudo) {
      setAdminOptions([userData.username]);
    }
  }, [userData]);

  useEffect(() => {
    if (!userData?.is_sudo) return;
    let cancelled = false;
    apiFetch("/admins")
      .then((payload: any) => {
        if (cancelled) return;
        const adminsList = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.admins)
          ? payload.admins
          : [];
        const usernames: string[] = adminsList
          .map((admin: any) => admin?.username)
          .filter((username: unknown): username is string => typeof username === "string");

        const uniqueUsernamesSet = new Set<string>(usernames);
        const uniqueUsernames: string[] = Array.from(uniqueUsernamesSet.values());
        uniqueUsernames.sort((a, b) => a.localeCompare(b));

        if (!uniqueUsernames.length && userData?.username) {
          setAdminOptions([userData.username]);
          return;
        }
        setAdminOptions(uniqueUsernames);
        setSelectedAdminDaily((prev) => {
          if (prev && uniqueUsernames.includes(prev)) {
            return prev;
          }
          const fallback = uniqueUsernames[0] ?? null;
          return fallback ?? prev ?? null;
        });
        setSelectedAdminTotals((prev) => {
          if (prev && uniqueUsernames.includes(prev)) {
            return prev;
          }
          const fallback = uniqueUsernames[0] ?? null;
          return fallback ?? prev ?? null;
        });
      })
      .catch((err) => {
        console.error("Error fetching admins:", err);
      });

    return () => {
      cancelled = true;
    };
  }, [userData?.is_sudo, userData?.username]);

  useEffect(() => {
    if (nodeDailySelectedNodeId !== null) return;
    const topNode = nodeUsageSlices
      .filter((slice) => slice.nodeId > 0)
      .sort((a, b) => b.total - a.total)[0]?.nodeId;
    if (topNode && topNode > 0) {
      setNodeDailySelectedNodeId(topNode);
      return;
    }
    if (Array.isArray(nodes) && nodes.length) {
      const firstNode = nodes[0]?.id;
      if (firstNode) {
        setNodeDailySelectedNodeId(firstNode);
      }
    }
  }, [nodeDailySelectedNodeId, nodeUsageSlices, nodes]);

  useEffect(() => {
    setSelectedAdminNodeId(null);
  }, [selectedAdminDaily]);

  useEffect(() => {
    if (!selectedAdminDaily) {
      setAdminDailySlices([]);
      setSelectedAdminNodeId(null);
      return;
    }

    let cancelled = false;
    const query = {
      start: formatApiStart(adminDailyRange.start),
      end: formatApiEnd(adminDailyRange.end),
    };

    apiFetch(`/admin/${encodeURIComponent(selectedAdminDaily)}/usage/nodes`, {
      query,
    })
      .then((data: any) => {
        if (cancelled) return;
        const slices = parseNodeUsageSlices(data?.usages);
        setAdminDailySlices(slices);
        setSelectedAdminNodeId((prev) => {
          if (prev !== null) {
            return prev;
          }
          const top = slices
            .filter((slice) => slice.nodeId !== 0)
            .sort((a, b) => b.total - a.total)[0]?.nodeId;
          if (typeof top === "number") {
            return top;
          }
          return slices[0]?.nodeId ?? 0;
        });
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Error fetching daily admin nodes:", err);
        setAdminDailySlices([]);
        setSelectedAdminNodeId(null);
        toast({
          title: t("errorFetchingData"),
          status: "error",
          isClosable: true,
          position: "top",
          duration: 3000,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [selectedAdminDaily, adminDailyRange, parseNodeUsageSlices, toast, t]);

  useEffect(() => {
    if (!selectedAdminTotals) {
      setAdminTotalsSlices([]);
      setAdminDonutLoading(false);
      return;
    }

    let cancelled = false;
    setAdminDonutLoading(true);
    apiFetch(`/admin/${encodeURIComponent(selectedAdminTotals)}/usage/nodes`, {
      query: {
        start: formatApiStart(adminDonutRange.start),
        end: formatApiEnd(adminDonutRange.end),
      },
    })
      .then((data: any) => {
        if (cancelled) return;
        const slices = parseNodeUsageSlices(data?.usages);
        setAdminTotalsSlices(slices);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Error fetching admin totals nodes:", err);
        setAdminTotalsSlices([]);
        toast({
          title: t("errorFetchingData"),
          status: "error",
          isClosable: true,
          position: "top",
          duration: 3000,
        });
      })
      .finally(() => {
        if (!cancelled) {
          setAdminDonutLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedAdminTotals, adminDonutRange, parseNodeUsageSlices, toast, t]);

  useEffect(() => {
    if (nodeDailySelectedNodeId === null) {
      setNodeDailyPoints([]);
      return;
    }

    let cancelled = false;
    setNodeDailyLoading(true);

    const query: Record<string, string> = {
      start: formatApiStart(nodeDailyRange.start),
      end: formatApiEnd(nodeDailyRange.end),
    };
    if (nodeDailyRange.unit === "hour") {
      query.granularity = "hour";
    }

    apiFetch(`/node/${nodeDailySelectedNodeId}/usage/daily`, {
      query,
    })
      .then((data: any) => {
        if (cancelled) return;
        const usages = Array.isArray(data?.usages) ? data.usages : [];
        const mapped = usages.map((entry: any) => ({
          date: entry?.date ?? "",
          used_traffic: Number(entry?.used_traffic ?? 0),
        }));
        setNodeDailyPoints(mapped);
        const fallbackName =
          data?.node_name ?? nodesById.get(nodeDailySelectedNodeId) ?? t("nodes.unknownNode", "Unknown");
        setNodeDailyMeta({
          nodeName: fallbackName,
          nodeId: data?.node_id ?? nodeDailySelectedNodeId,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Error fetching node daily usage:", err);
        setNodeDailyPoints([]);
        toast({
          title: t("errorFetchingData"),
          status: "error",
          isClosable: true,
          position: "top",
          duration: 3000,
        });
      })
      .finally(() => {
        if (!cancelled) {
          setNodeDailyLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [nodeDailySelectedNodeId, nodeDailyRange, nodesById, toast, t]);

  useEffect(() => {
    if (!selectedAdminDaily) {
      setAdminDailyPoints([]);
      return;
    }
    if (selectedAdminNodeId === null) {
      setAdminDailyPoints([]);
      return;
    }

    let cancelled = false;
    setAdminDailyLoading(true);
    const query: Record<string, string | number> = {
      start: formatApiStart(adminDailyRange.start),
      end: formatApiEnd(adminDailyRange.end),
    };

    if (selectedAdminNodeId !== undefined && selectedAdminNodeId !== null) {
      query.node_id = selectedAdminNodeId;
    }

    if (adminDailyRange.unit === "hour") {
      query.granularity = "hour";
    }
    apiFetch(`/admin/${encodeURIComponent(selectedAdminDaily)}/usage/chart`, {
      query,
    })
      .then((data: any) => {
        if (cancelled) return;
        const usages = Array.isArray(data?.usages) ? data.usages : [];
        const mapped = usages.map((entry: any) => ({
          date: entry?.date ?? "",
          used_traffic: Number(entry?.used_traffic ?? 0),
        }));
        setAdminDailyPoints(mapped);
        setAdminDailyMeta({
          nodeName: data?.node_name ?? adminNodeOptions.find((option) => option.value === selectedAdminNodeId)?.label ?? null,
          nodeId: data?.node_id ?? selectedAdminNodeId,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Error fetching admin usage chart:", err);
        setAdminDailyPoints([]);
        toast({
          title: t("errorFetchingData"),
          status: "error",
          isClosable: true,
          position: "top",
          duration: 3000,
        });
      })
      .finally(() => {
        if (!cancelled) {
          setAdminDailyLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedAdminDaily, selectedAdminNodeId, adminDailyRange, adminNodeOptions, t, toast]);

  const { isLoading: isAdding, mutate: addNodeMutate } = useMutation(addNode, {
    onSuccess: () => {
      generateSuccessMessage(t("nodes.addNodeSuccess"), toast);
      queryClient.invalidateQueries(FetchNodesQueryKey);
      setAddNodeOpen(false);
    },
    onError: (e) => {
      generateErrorMessage(e, toast);
    },
  });

  const { isLoading: isUpdating, mutate: updateNodeMutate } = useMutation(updateNode, {
    onSuccess: () => {
      generateSuccessMessage(t("nodes.nodeUpdated"), toast);
      queryClient.invalidateQueries(FetchNodesQueryKey);
      setEditingNode(null);
    },
    onError: (e) => {
      generateErrorMessage(e, toast);
    },
  });

  const { isLoading: isReconnecting, mutate: reconnect } = useMutation(reconnectNode, {
    onSuccess: () => {
      queryClient.invalidateQueries(FetchNodesQueryKey);
    },
  });

  const { mutate: toggleNodeStatus, isLoading: isToggling } = useMutation(updateNode, {
    onSuccess: () => {
      queryClient.invalidateQueries(FetchNodesQueryKey);
    },
    onError: (e) => {
      generateErrorMessage(e, toast);
    },
    onSettled: (_, __, variables: any) => {
      if (variables?.id != null) {
        setPendingStatus((prev) => {
          const next = { ...prev };
          delete next[variables.id as number];
          return next;
        });
      }
      setTogglingNodeId(null);
    },
  });

  const handleToggleNode = (node: NodeType) => {
    if (!node?.id) return;
    const isEnabled = node.status !== "disabled";
    const nextStatus = isEnabled ? "disabled" : "connecting";
    const nodeId = node.id as number;
    setTogglingNodeId(nodeId);
    setPendingStatus((prev) => ({ ...prev, [nodeId]: !isEnabled }));
    toggleNodeStatus({ ...node, status: nextStatus });
  };

  const closeVersionDialog = () => setVersionDialogTarget(null);
  const closeGeoDialog = () => setGeoDialogTarget(null);

  const handleVersionSubmit = async ({ version, persist }: { version: string; persist?: boolean }) => {
    if (!versionDialogTarget) {
      return;
    }

    if (versionDialogTarget.type === "master") {
      setUpdatingMasterCore(true);
      try {
        await apiFetch("/core/xray/update", {
          method: "POST",
          body: { version, persist_env: Boolean(persist) },
        });
        generateSuccessMessage(
          t("nodes.coreVersionDialog.masterUpdateSuccess", { version }),
          toast
        );
        await Promise.all([
          refetchCoreStats(),
          queryClient.invalidateQueries(FetchNodesQueryKey),
        ]);
        closeVersionDialog();
      } catch (error) {
        generateErrorMessage(error, toast);
        const message =
          error instanceof Error ? error.message : t("nodes.coreVersionDialog.genericError");
        throw new Error(message);
      } finally {
        setUpdatingMasterCore(false);
      }
      return;
    }

    if (versionDialogTarget.type === "node") {
      const nodeId = versionDialogTarget.node.id;
      if (!nodeId) {
        const message = t("nodes.coreVersionDialog.nodeIdMissing", "Node identifier missing.");
        toast({
          title: message,
          status: "error",
          isClosable: true,
          position: "top",
          duration: 3000,
        });
        throw new Error(message);
      }

      setUpdatingCoreNodeId(nodeId);
      try {
        await apiFetch(`/node/${nodeId}/xray/update`, {
          method: "POST",
          body: { version },
        });
        queryClient.setQueryData<NodeType[] | undefined>(FetchNodesQueryKey, (prev) => {
          if (!prev) return prev;
          return prev.map((existing) =>
            existing.id === nodeId ? { ...existing, xray_version: version } : existing
          );
        });
        generateSuccessMessage(
          t("nodes.coreVersionDialog.nodeUpdateSuccess", {
            name: versionDialogTarget.node.name ?? nodeId,
            version,
          }),
          toast
        );
        queryClient.invalidateQueries(FetchNodesQueryKey);
        closeVersionDialog();
      } catch (error) {
        generateErrorMessage(error, toast);
        const message =
          error instanceof Error ? error.message : t("nodes.coreVersionDialog.genericError");
        throw new Error(message);
      } finally {
        setUpdatingCoreNodeId(null);
      }
      return;
    }

    if (versionDialogTarget.type === "bulk") {
      const targetNodes = (nodes ?? []).filter(
        (node) => node.id != null && node.status === "connected"
      );
      if (targetNodes.length === 0) {
        const message = t(
          "nodes.coreVersionDialog.noConnectedNodes",
          "No connected nodes available for update."
        );
        toast({
          title: message,
          status: "warning",
          isClosable: true,
          position: "top",
          duration: 3000,
        });
        throw new Error(message);
      }

      setUpdatingBulkCore(true);
      try {
        const results: Array<{ status: "fulfilled" | "rejected"; node: NodeType }> = [];
        for (const node of targetNodes) {
          try {
            await apiFetch(`/node/${node.id}/xray/update`, {
              method: "POST",
              body: { version },
            });
            results.push({ status: "fulfilled", node });
          } catch (err) {
            results.push({ status: "rejected", node });
            generateErrorMessage(err, toast);
          }
        }

        const total = results.length;
        const success = results.filter((res) => res.status === "fulfilled").length;
        const failed = total - success;

        if (success > 0) {
          const successfulIds = new Set(
            results.filter((res) => res.status === "fulfilled").map((res) => res.node.id)
          );
          queryClient.setQueryData<NodeType[] | undefined>(FetchNodesQueryKey, (prev) => {
            if (!prev) return prev;
            return prev.map((existing) =>
              existing.id != null && successfulIds.has(existing.id)
                ? { ...existing, xray_version: version }
                : existing
            );
          });
        }

        if (success > 0) {
          generateSuccessMessage(
            t("nodes.coreVersionDialog.bulkSuccess", { success, total }),
            toast
          );
        }

        if (failed > 0) {
          const failureMessage = t("nodes.coreVersionDialog.bulkPartialError", { failed, total });
          toast({
            title: failureMessage,
            status: "error",
            isClosable: true,
            position: "top",
            duration: 4000,
          });
        }

        queryClient.invalidateQueries(FetchNodesQueryKey);
        closeVersionDialog();
      } catch (error) {
        generateErrorMessage(error, toast);
        const message =
          error instanceof Error ? error.message : t("nodes.coreVersionDialog.genericError");
        throw new Error(message);
      } finally {
        setUpdatingBulkCore(false);
      }
    }
  };

  const handleGeoSubmit = async (payload: {
    mode: "template" | "manual";
    templateIndexUrl: string;
    templateName: string;
    files: { name: string; url: string }[];
    persistEnv: boolean;
    applyToNodes: boolean;
  }) => {
    if (!geoDialogTarget) {
      return;
    }

    if (geoDialogTarget.type === "master") {
      setUpdatingMasterGeo(true);
      const body: Record<string, unknown> = {
        mode: payload.mode === "template" ? "default" : "custom",
        persist_env: payload.persistEnv,
        apply_to_nodes: payload.applyToNodes,
        skip_node_ids: [],
      };
      if (payload.mode === "template") {
        body.template_index_url = payload.templateIndexUrl;
        body.template_name = payload.templateName;
      } else {
        body.files = payload.files;
      }

      try {
        await apiFetch("/core/geo/apply", {
          method: "POST",
          body,
        });
        generateSuccessMessage(t("nodes.geoDialog.masterSuccess"), toast);
        closeGeoDialog();
      } catch (error) {
        generateErrorMessage(error, toast);
        const message =
          error instanceof Error ? error.message : t("nodes.geoDialog.genericError");
        throw new Error(message);
      } finally {
        setUpdatingMasterGeo(false);
      }
      return;
    }

    if (geoDialogTarget.type === "node") {
      const nodeId = geoDialogTarget.node.id;
      if (!nodeId) {
        const message = t("nodes.geoDialog.nodeIdMissing", "Node identifier missing.");
        toast({
          title: message,
          status: "error",
          isClosable: true,
          position: "top",
          duration: 3000,
        });
        throw new Error(message);
      }

      setUpdatingGeoNodeId(nodeId);
      const body: Record<string, unknown> = {};
      if (payload.mode === "template") {
        body.template_index_url = payload.templateIndexUrl;
        body.template_name = payload.templateName;
      } else {
        body.files = payload.files;
      }

      try {
        await apiFetch(`/node/${nodeId}/geo/update`, {
          method: "POST",
          body,
        });
        generateSuccessMessage(
          t("nodes.geoDialog.nodeSuccess", {
            name: geoDialogTarget.node.name ?? nodeId,
          }),
          toast
        );
        queryClient.invalidateQueries(FetchNodesQueryKey);
        closeGeoDialog();
      } catch (error) {
        generateErrorMessage(error, toast);
        const message =
          error instanceof Error ? error.message : t("nodes.geoDialog.genericError");
        throw new Error(message);
      } finally {
        setUpdatingGeoNodeId(null);
      }
    }
  };

  const errorMessage =
    error instanceof Error
      ? error.message
      : error && typeof error === "object" && "message" in (error as Record<string, unknown>)
      ? String((error as { message?: unknown }).message ?? t("errorOccurred"))
      : undefined;
  const hasError = Boolean(errorMessage);
  const masterLabel = t("nodes.masterNode", "Master");
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const masterMatchesSearch =
    !normalizedSearch ||
    masterLabel.toLowerCase().includes(normalizedSearch) ||
    (coreStats?.version ?? "").toLowerCase().includes(normalizedSearch);
  const versionDialogLoading =
    versionDialogTarget?.type === "master"
      ? updatingMasterCore
      : versionDialogTarget?.type === "node"
      ? versionDialogTarget.node.id != null &&
        updatingCoreNodeId === versionDialogTarget.node.id
      : versionDialogTarget?.type === "bulk"
      ? updatingBulkCore
      : false;
  const geoDialogLoading =
    geoDialogTarget?.type === "master"
      ? updatingMasterGeo
      : geoDialogTarget?.type === "node"
      ? geoDialogTarget.node.id != null && updatingGeoNodeId === geoDialogTarget.node.id
      : false;
  const versionDialogTitle =
    versionDialogTarget?.type === "master"
      ? t("nodes.coreVersionDialog.masterTitle")
      : versionDialogTarget?.type === "bulk"
      ? t("nodes.coreVersionDialog.bulkTitle")
      : versionDialogTarget?.type === "node"
      ? t("nodes.coreVersionDialog.nodeTitle", {
          name: versionDialogTarget.node.name ?? t("nodes.unnamedNode", "Unnamed node"),
        })
      : "";
  const versionDialogDescription =
    versionDialogTarget?.type === "master"
      ? t("nodes.coreVersionDialog.masterDescription")
      : versionDialogTarget?.type === "bulk"
      ? t("nodes.coreVersionDialog.bulkDescription")
      : versionDialogTarget?.type === "node"
      ? t("nodes.coreVersionDialog.nodeDescription", {
          name: versionDialogTarget.node.name ?? t("nodes.unnamedNode", "Unnamed node"),
        })
      : "";
  const versionDialogCurrentVersion =
    versionDialogTarget?.type === "master"
      ? coreStats?.version ?? ""
      : versionDialogTarget?.type === "node"
      ? versionDialogTarget.node.xray_version ?? ""
      : "";
  const geoDialogTitle =
    geoDialogTarget?.type === "master"
      ? t("nodes.geoDialog.masterTitle")
      : geoDialogTarget?.type === "node"
      ? t("nodes.geoDialog.nodeTitle", {
          name: geoDialogTarget.node.name ?? t("nodes.unnamedNode", "Unnamed node"),
        })
      : "";

  return (
    <VStack spacing={6} align="stretch">
      <Stack spacing={1}>
        <Text as="h1" fontWeight="semibold" fontSize="2xl">
          {t("header.nodes")}
        </Text>
        <Text fontSize="sm" color="gray.600" _dark={{ color: "gray.300" }}>
          {t(
            "nodes.pageDescription",
            "Manage node availability, edit configurations, and reconnect problematic nodes."
          )}
        </Text>
      </Stack>
      <Tabs
        variant="enclosed"
        colorScheme="primary"
        index={activeTab}
        onChange={setActiveTab}
      >
        <TabList>
          <Tab>
            <HStack spacing={2} align="center">
              <ManageNodesIcon />
              <Text>{t("nodes.manageNodes", "Manage Nodes")}</Text>
            </HStack>
          </Tab>
          <Tab>
            <HStack spacing={2} align="center">
              <ChartIcon />
              <Text>{t("header.nodesUsage")}</Text>
            </HStack>
          </Tab>
        </TabList>
        <TabPanels>
          <TabPanel>
            <VStack spacing={4} align="stretch">
              <Stack
                direction={{ base: "column", lg: "row" }}
                spacing={{ base: 3, lg: 4 }}
                alignItems={{ base: "stretch", lg: "center" }}
                justifyContent="space-between"
                w="full"
              >
                <Text fontWeight="semibold">{t("nodes.manageNodesHeader", "Node list")}</Text>
                <Stack
                  direction={{ base: "column", md: "row" }}
                  spacing={{ base: 3, md: 3 }}
                  alignItems={{ base: "stretch", md: "center" }}
                  justifyContent="flex-end"
                  w={{ base: "full", lg: "auto" }}
                >
                  <Stack
                    direction={{ base: "row", sm: "row" }}
                    spacing={2}
                    alignItems="center"
                    justifyContent="flex-end"
                    w={{ base: "full", md: "auto" }}
                  >
                    <Tooltip label={t("nodes.refreshNodes", "Refresh nodes")}>
                      <IconButton
                        aria-label={t("nodes.refreshNodes", "Refresh nodes")}
                        icon={<ArrowPathIconStyled />}
                        variant="ghost"
                        size="sm"
                        onClick={() => refetchNodes()}
                        isLoading={isFetching}
                      />
                    </Tooltip>
                    <InputGroup size="sm" maxW={{ base: "full", md: "260px" }}>
                      <InputLeftElement pointerEvents="none">
                        <SearchIcon color="gray.400" />
                      </InputLeftElement>
                      <Input
                        value={searchTerm}
                        onChange={(event) => setSearchTerm(event.target.value)}
                        placeholder={t("nodes.searchPlaceholder", "Search nodes")}
                      />
                    </InputGroup>
                  </Stack>
                  <Stack direction={{ base: "column", sm: "row" }} spacing={2} justify="flex-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setVersionDialogTarget({ type: "bulk" })}
                      isDisabled={!hasConnectedNodes}
                      w={{ base: "full", sm: "auto" }}
                    >
                      {t("nodes.updateAllNodesCore")}
                    </Button>
                    <Button
                      leftIcon={<AddIconStyled />}
                      colorScheme="primary"
                      size="sm"
                      onClick={() => setAddNodeOpen(true)}
                      w={{ base: "full", sm: "auto" }}
                    >
                      {t("nodes.addNewMarzbanNode")}
                    </Button>
                  </Stack>
                </Stack>
              </Stack>
              {hasError && (
                <Alert status="error" borderRadius="md">
                  <AlertIcon />
                  <AlertDescription>{errorMessage}</AlertDescription>
                </Alert>
              )}
              {isLoading ? (
                <SimpleGrid columns={{ base: 1, md: 2, xl: 3 }} spacing={4}>
                  {Array.from({ length: 3 }).map((_, idx) => (
                    <Box
                      key={`nodes-skeleton-${idx}`}
                      borderWidth="1px"
                      borderRadius="lg"
                      p={6}
                      boxShadow="sm"
                      display="flex"
                      alignItems="center"
                      justifyContent="center"
                    >
                      <VStack spacing={3}>
                        <Spinner />
                        <Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }}>
                          {t("loading")}
                        </Text>
                      </VStack>
                    </Box>
                  ))}
                </SimpleGrid>
              ) : (
                <SimpleGrid columns={{ base: 1, md: 2, xl: 3 }} spacing={4}>
                  {masterMatchesSearch && (
                    <Box
                      key="master-node"
                      borderWidth="1px"
                      borderRadius="lg"
                      p={6}
                      boxShadow="sm"
                      _hover={{ boxShadow: "md" }}
                      transition="box-shadow 0.2s ease-in-out"
                    >
                      {isCoreLoading ? (
                        <VStack spacing={3} align="center" justify="center">
                          <Spinner />
                          <Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }}>
                            {t("loading")}
                          </Text>
                        </VStack>
                      ) : coreError ? (
                        <VStack spacing={3} align="stretch">
                          <Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }}>
                            {t("nodes.masterLoadFailed", "Unable to load master details.")}
                          </Text>
                          <Button size="sm" variant="outline" onClick={() => refetchCoreStats()}>
                            {t("refresh", "Refresh")}
                          </Button>
                        </VStack>
                      ) : (
                        <VStack align="stretch" spacing={4}>
                          <Stack spacing={2}>
                            <HStack spacing={3} align="center" flexWrap="wrap">
                              <Text fontWeight="semibold" fontSize="lg">
                                {masterLabel}
                              </Text>
                              <Tag colorScheme="purple" size="sm">
                                {coreStats?.version
                                  ? `Xray ${coreStats.version}`
                                  : t("nodes.versionUnknown", "Version unknown")}
                              </Tag>
                            </HStack>
                            <Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }}>
                              {coreStats?.started
                                ? t("nodes.masterStartedAt", {
                                    date: dayjs(coreStats.started).local().format("YYYY-MM-DD HH:mm"),
                                  })
                                : t("nodes.masterStartedUnknown", "Start time unavailable")}
                            </Text>
                          </Stack>
                          <Divider />
                          <Stack direction={{ base: "column", sm: "row" }} spacing={2}>
                            <Button
                              size="sm"
                              variant="outline"
                              colorScheme="primary"
                              onClick={() => setVersionDialogTarget({ type: "master" })}
                              isLoading={updatingMasterCore}
                            >
                              {t("nodes.coreVersionDialog.updateMasterButton")}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setGeoDialogTarget({ type: "master" })}
                              isLoading={updatingMasterGeo}
                            >
                              {t("nodes.geoDialog.updateMasterButton")}
                            </Button>
                          </Stack>
                        </VStack>
                      )}
                    </Box>
                  )}
                  {filteredNodes.length > 0
                    ? filteredNodes.map((node) => {
                        const status = node.status || "error";
                        const nodeId = node?.id as number | undefined;
                        const isEnabled = status !== "disabled";
                        const pending = nodeId != null ? pendingStatus[nodeId] : undefined;
                        const displayEnabled = pending ?? isEnabled;
                        const isToggleLoading =
                          nodeId != null && togglingNodeId === nodeId && isToggling;
                        const isCoreUpdating = nodeId != null && updatingCoreNodeId === nodeId;
                        const isGeoUpdating = nodeId != null && updatingGeoNodeId === nodeId;
                        return (
                          <Box
                            key={node.id ?? node.name}
                            borderWidth="1px"
                            borderRadius="lg"
                            p={6}
                            boxShadow="sm"
                            _hover={{ boxShadow: "md" }}
                            transition="box-shadow 0.2s ease-in-out"
                          >
                            <VStack align="stretch" spacing={4}>
                              <Stack spacing={2}>
                                <HStack spacing={3} align="center" flexWrap="wrap">
                                  <Text fontWeight="semibold" fontSize="lg">
                                    {node.name || t("nodes.unnamedNode", "Unnamed node")}
                                  </Text>
                                  <Switch
                                    size="sm"
                                    colorScheme="primary"
                                    isChecked={displayEnabled}
                                    onChange={() => handleToggleNode(node)}
                                    isDisabled={isToggleLoading}
                                    aria-label={t("nodes.toggleAvailability", "Toggle node availability")}
                                  />
                                  {node.status === "error" && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      leftIcon={<ArrowPathIconStyled />}
                                      onClick={() => reconnect(node)}
                                      isLoading={isReconnecting}
                                    >
                                      {t("nodes.reconnect")}
                                    </Button>
                                  )}
                                </HStack>
                                <HStack spacing={2} flexWrap="wrap">
                                  <NodeModalStatusBadge status={status} compact />
                                  <HStack spacing={1} align="center">
                                    <Tag colorScheme="blue" size="sm">
                                      {node.xray_version
                                        ? `Xray ${node.xray_version}`
                                        : t("nodes.versionUnknown", "Version unknown")}
                                    </Tag>
                                    <Button
                                      size="xs"
                                      variant="ghost"
                                      colorScheme="primary"
                                      onClick={() => nodeId && setVersionDialogTarget({ type: "node", node })}
                                      isLoading={isCoreUpdating}
                                      isDisabled={!nodeId}
                                    >
                                      {t("nodes.updateCoreAction")}
                                    </Button>
                                  </HStack>
                                  <Button
                                    size="xs"
                                    variant="ghost"
                                    onClick={() => nodeId && setGeoDialogTarget({ type: "node", node })}
                                    isLoading={isGeoUpdating}
                                    isDisabled={!nodeId}
                                  >
                                    {t("nodes.updateGeoAction")}
                                  </Button>
                                </HStack>
                              </Stack>

                              {node.message && (
                                <Alert
                                  status="warning"
                                  variant="left-accent"
                                  borderRadius="md"
                                  fontSize="sm"
                                >
                                  <AlertIcon />
                                  <AlertDescription>{node.message}</AlertDescription>
                                </Alert>
                              )}

                              <Divider />
                              <SimpleGrid columns={{ base: 1, sm: 2 }} spacingY={2}>
                                <Box>
                                  <Text fontSize="xs" textTransform="uppercase" color="gray.500">
                                    {t("nodes.nodeAddress")}
                                  </Text>
                                  <Text fontWeight="medium">{node.address}</Text>
                                </Box>
                                <Box>
                                  <Text fontSize="xs" textTransform="uppercase" color="gray.500">
                                    {t("nodes.nodePort")}
                                  </Text>
                                  <Text fontWeight="medium">{node.port}</Text>
                                </Box>
                                <Box>
                                  <Text fontSize="xs" textTransform="uppercase" color="gray.500">
                                    {t("nodes.nodeAPIPort")}
                                  </Text>
                                  <Text fontWeight="medium">{node.api_port}</Text>
                                </Box>
                                <Box>
                                  <Text fontSize="xs" textTransform="uppercase" color="gray.500">
                                    {t("nodes.usageCoefficient")}
                                  </Text>
                                  <Text fontWeight="medium">{node.usage_coefficient}</Text>
                                </Box>
                              </SimpleGrid>
                              <Divider />
                              <HStack justify="space-between" align="center" flexWrap="wrap" gap={2}>
                                <Text fontSize="xs" color="gray.500" _dark={{ color: "gray.400" }}>
                                  {t("nodes.id", "ID")}: {node.id ?? "-"}
                                </Text>
                                <ButtonGroup size="sm" variant="ghost">
                                  <IconButton
                                    aria-label={t("edit")}
                                    icon={<EditIconStyled />}
                                    onClick={() => setEditingNode(node)}
                                  />
                                  <IconButton
                                    aria-label={t("delete")}
                                    icon={<DeleteIconStyled />}
                                    colorScheme="red"
                                    onClick={() => setDeletingNode(node)}
                                  />
                                </ButtonGroup>
                              </HStack>
                            </VStack>
                          </Box>
                        );
                      })
                    : !masterMatchesSearch && (
                        <Box
                          key="empty-nodes"
                          borderWidth="1px"
                          borderRadius="lg"
                          p={8}
                          textAlign="center"
                          color="gray.500"
                          _dark={{ color: "gray.400" }}
                        >
                          {nodes && nodes.length > 0
                            ? t("nodes.noNodesMatchSearch", "No nodes match your search.")
                            : t("nodes.noNodesAvailable", "No nodes have been added yet.")}
                        </Box>
                      )}
                </SimpleGrid>
              )}
            </VStack>
          </TabPanel>
          <TabPanel>
            <VStack spacing={6} align="stretch">
              <Box borderWidth="1px" borderRadius="lg" p={{ base: 4, md: 6 }} boxShadow="md">
                <Stack
                  direction={{ base: "column", lg: "row" }}
                  spacing={{ base: 4, lg: 6 }}
                  justifyContent="space-between"
                  alignItems={{ base: "stretch", lg: "flex-start" }}
                  w="full"
                >
                  <VStack align="start" spacing={1}>
                    <Tooltip label={t("nodes.trafficOverviewTooltip", "Total usage per node over the chosen range.")} placement="top" fontSize="sm">
                      <HStack spacing={2} align="center">
                        <Text fontWeight="semibold">{t("nodes.trafficOverview", "Traffic overview")}</Text>
                        <InfoIcon color="gray.500" _dark={{ color: "gray.400" }} aria-label="info" cursor="help" />
                      </HStack>
                    </Tooltip>
                    <Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }}>
                      {t("nodes.totalLabel", "Total")}:{" "}
                      <chakra.span fontWeight="medium">{formatBytes(totalNodeUsage || 0, 2)}</chakra.span>
                    </Text>
                  </VStack>
                  <UsageRangeControls
                    presets={presets}
                    range={nodesUsageRange}
                    onPresetChange={handleNodesUsagePresetChange}
                    onCustomChange={handleNodesUsageCustomChange}
                  />
                </Stack>
                <Box mt={6}>
                  {nodeUsageLoading ? (
                    <VStack spacing={3}>
                      <Spinner />
                      <Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }}>
                        {t("loading")}
                      </Text>
                    </VStack>
                  ) : nodeUsageChart.series.length ? (
                    <ReactApexChart options={nodeUsageChart.options} series={nodeUsageChart.series} type="donut" height={360} />
                  ) : (
                    <Text textAlign="center" color="gray.500" _dark={{ color: "gray.400" }}>
                      {t("noData")}
                    </Text>
                  )}
                </Box>
              </Box>

              <Box borderWidth="1px" borderRadius="lg" p={{ base: 4, md: 6 }} boxShadow="md">
                <Stack
                  direction={{ base: "column", lg: "row" }}
                  spacing={{ base: 4, lg: 6 }}
                  justifyContent="space-between"
                  alignItems={{ base: "stretch", lg: "flex-start" }}
                  w="full"
                >
                  <VStack align="start" spacing={1}>
                    <Tooltip label={t("nodes.perDayUsageTooltip", "Daily traffic aggregated for the selected node within the chosen range.")} placement="top" fontSize="sm">
                      <HStack spacing={2} align="center">
                        <Text fontWeight="semibold">{t("nodes.perDayUsage", "Per day usage")}</Text>
                        <InfoIcon color="gray.500" _dark={{ color: "gray.400" }} aria-label="info" cursor="help" />
                      </HStack>
                    </Tooltip>
                    <Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }}>
                      {t("nodes.selectedNode", "Node")}:{" "}
                      <chakra.span fontWeight="medium">{nodeDailyMeta?.nodeName ?? t("nodes.unknownNode", "Unknown")}</chakra.span>{" "}
                      {t("nodes.totalLabel", "Total")}:{" "}
                      <chakra.span fontWeight="medium">{formatBytes(nodeDailyTotal || 0, 2)}</chakra.span>
                    </Text>
                  </VStack>
                  <Stack
                    direction={{ base: "column", md: "row" }}
                    spacing={{ base: 3, md: 4 }}
                    alignItems={{ base: "stretch", md: "center" }}
                    justifyContent="flex-end"
                    w="full"
                  >
                    <Select
                      size="sm"
                      minW={{ md: "180px" }}
                      w={{ base: "full", md: "auto" }}
                      value={nodeDailySelectedNodeId ?? ""}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (!value) {
                          setNodeDailySelectedNodeId(null);
                          return;
                        }
                        const parsed = Number(value);
                        setNodeDailySelectedNodeId(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
                      }}
                      placeholder={t("nodes.selectNode", "Select node")}
                    >
                      {nodeDailyOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                    <UsageRangeControls
                      presets={presets}
                      range={nodeDailyRange}
                      onPresetChange={handleNodeDailyPresetChange}
                      onCustomChange={handleNodeDailyCustomChange}
                    />
                  </Stack>
                </Stack>
                <Box mt={6}>
                  {nodeDailyLoading ? (
                    <VStack spacing={3}>
                      <Spinner />
                      <Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }}>
                        {t("loading")}
                      </Text>
                    </VStack>
                  ) : nodeDailySeries[0]?.data?.length ? (
                    <ReactApexChart options={nodeDailyChartConfig.options} series={nodeDailyChartConfig.series} type="area" height={360} />
                  ) : (
                    <Text textAlign="center" color="gray.500" _dark={{ color: "gray.400" }}>
                      {t("noData")}
                    </Text>
                  )}
                </Box>
              </Box>

              <Box borderWidth="1px" borderRadius="lg" p={{ base: 4, md: 6 }} boxShadow="md">
                <Stack
                  direction={{ base: "column", lg: "row" }}
                  spacing={{ base: 4, lg: 6 }}
                  justifyContent="space-between"
                  alignItems={{ base: "stretch", lg: "flex-start" }}
                  w="full"
                >
                  <VStack align="start" spacing={1}>
                    <Tooltip label={t("nodes.adminUsagePerNodeTooltip", "Daily usage for the selected admin on the chosen node.")} placement="top" fontSize="sm">
                      <HStack spacing={2} align="center">
                        <Text fontWeight="semibold">{t("nodes.adminUsagePerNode", "Admin usage per day for a node")}</Text>
                        <InfoIcon color="gray.500" _dark={{ color: "gray.400" }} aria-label="info" cursor="help" />
                      </HStack>
                    </Tooltip>
                    <Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }}>
                      {t("nodes.selectedAdmin", "Admin")}:{" "}
                      <chakra.span fontWeight="medium">{selectedAdminDaily ?? "-"}</chakra.span>{" "}
                      {t("nodes.selectedNode", "Node")}:{" "}
                      <chakra.span fontWeight="medium">{adminDailyMeta?.nodeName ?? t("nodes.unknownNode", "Unknown")}</chakra.span>{" "}
                      {t("nodes.totalLabel", "Total")}:{" "}
                      <chakra.span fontWeight="medium">{formatBytes(adminDailyTotal || 0, 2)}</chakra.span>
                    </Text>
                  </VStack>
                  <Stack
                    direction={{ base: "column", md: "row" }}
                    spacing={{ base: 3, md: 4 }}
                    alignItems={{ base: "stretch", md: "center" }}
                    justifyContent="flex-end"
                    w="full"
                  >
                    <Select
                      size="sm"
                      minW={{ md: "160px" }}
                      w={{ base: "full", md: "auto" }}
                      value={selectedAdminDaily ?? ""}
                      onChange={(event) => setSelectedAdminDaily(event.target.value || null)}
                      isDisabled={adminSelectOptions.length === 0}
                    >
                      {adminSelectOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                    <Select
                      size="sm"
                      minW={{ md: "180px" }}
                      w={{ base: "full", md: "auto" }}
                      value={selectedAdminNodeId ?? ""}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (value === "") {
                          setSelectedAdminNodeId(null);
                          return;
                        }
                        const parsed = Number(value);
                        setSelectedAdminNodeId(Number.isNaN(parsed) ? null : parsed);
                      }}
                      placeholder={t("nodes.selectNode", "Select node")}
                    >
                      {adminNodeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                    <UsageRangeControls
                      presets={presets}
                      range={adminDailyRange}
                      onPresetChange={handleAdminDailyPresetChange}
                      onCustomChange={handleAdminDailyCustomChange}
                    />
                  </Stack>
                </Stack>
                <Box mt={6}>
                  {adminDailyLoading ? (
                    <VStack spacing={3}>
                      <Spinner />
                      <Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }}>
                        {t("loading")}
                      </Text>
                    </VStack>
                  ) : adminDailySeries[0]?.data?.length ? (
                    <ReactApexChart
                      options={adminDailyChartConfig.options}
                      series={adminDailyChartConfig.series}
                      type="area"
                      height={360}
                    />
                  ) : (
                    <Text textAlign="center" color="gray.500" _dark={{ color: "gray.400" }}>
                      {t("noData")}
                    </Text>
                  )}
                </Box>
              </Box>

              <Box borderWidth="1px" borderRadius="lg" p={{ base: 4, md: 6 }} boxShadow="md">
                <Stack
                  direction={{ base: "column", lg: "row" }}
                  spacing={{ base: 4, lg: 6 }}
                  justifyContent="space-between"
                  alignItems={{ base: "stretch", lg: "flex-start" }}
                  w="full"
                >
                  <VStack align="start" spacing={1}>
                    <Tooltip label={t("nodes.perAdminUsageTooltip", "Total usage by node for the selected admin.")} placement="top" fontSize="sm">
                      <HStack spacing={2} align="center">
                        <Text fontWeight="semibold">{t("nodes.perAdminUsage", "Per admin usages")}</Text>
                        <InfoIcon color="gray.500" _dark={{ color: "gray.400" }} aria-label="info" cursor="help" />
                      </HStack>
                    </Tooltip>
                    <Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }}>
                      {t("nodes.selectedAdmin", "Admin")}:{" "}
                      <chakra.span fontWeight="medium">{selectedAdminTotals ?? "-"}</chakra.span>{" "}
                      {t("nodes.totalLabel", "Total")}:{" "}
                      <chakra.span fontWeight="medium">{formatBytes(totalAdminUsage || 0, 2)}</chakra.span>
                    </Text>
                  </VStack>
                  <Stack
                    direction={{ base: "column", md: "row" }}
                    spacing={{ base: 3, md: 4 }}
                    alignItems={{ base: "stretch", md: "center" }}
                    justifyContent="flex-end"
                    w="full"
                  >
                    <Select
                      size="sm"
                      minW={{ md: "160px" }}
                      w={{ base: "full", md: "auto" }}
                      value={selectedAdminTotals ?? ""}
                      onChange={(event) => setSelectedAdminTotals(event.target.value || null)}
                      isDisabled={adminSelectOptions.length === 0}
                    >
                      {adminSelectOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                    <UsageRangeControls
                      presets={presets}
                      range={adminDonutRange}
                      onPresetChange={handleAdminDonutPresetChange}
                      onCustomChange={handleAdminDonutCustomChange}
                    />
                  </Stack>
                </Stack>
                <Box mt={6}>
                  {adminDonutLoading ? (
                    <VStack spacing={3}>
                      <Spinner />
                      <Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }}>
                        {t("loading")}
                      </Text>
                    </VStack>
                  ) : adminDonutChart.series.length ? (
                    <ReactApexChart
                      options={adminDonutChart.options}
                      series={adminDonutChart.series}
                      type="donut"
                      height={360}
                    />
                  ) : (
                    <Text textAlign="center" color="gray.500" _dark={{ color: "gray.400" }}>
                      {t("noData")}
                    </Text>
                  )}
                </Box>
              </Box>
            </VStack>
          </TabPanel>
        </TabPanels>
      </Tabs>
      <CoreVersionDialog
        isOpen={Boolean(versionDialogTarget)}
        onClose={closeVersionDialog}
        onSubmit={handleVersionSubmit}
        currentVersion={versionDialogCurrentVersion}
        title={versionDialogTitle}
        description={versionDialogDescription}
        allowPersist={versionDialogTarget?.type === "master"}
        isSubmitting={versionDialogLoading}
      />
      <GeoUpdateDialog
        isOpen={Boolean(geoDialogTarget)}
        onClose={closeGeoDialog}
        onSubmit={handleGeoSubmit}
        title={geoDialogTitle}
        showMasterOptions={geoDialogTarget?.type === "master"}
        isSubmitting={geoDialogLoading}
      />
      <NodeFormModal
        isOpen={isAddNodeOpen}
        onClose={() => setAddNodeOpen(false)}
        mutate={addNodeMutate}
        isLoading={isAdding}
        isAddMode
      />
      <NodeFormModal
        isOpen={!!editingNode}
        onClose={() => setEditingNode(null)}
        node={editingNode}
        mutate={updateNodeMutate}
        isLoading={isUpdating}
      />
      <DeleteNodeModal deleteCallback={() => queryClient.invalidateQueries(FetchNodesQueryKey)} />
    </VStack>
  );
};

export default NodesPage;
