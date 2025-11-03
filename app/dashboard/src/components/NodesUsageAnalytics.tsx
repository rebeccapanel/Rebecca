
import {
  Box,
  Button,
  HStack,
  Popover,
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
  Select,
  Spinner,
  Stack,
  Text,
  Tooltip,
  VStack,
  chakra,
  useColorMode,
  useBreakpointValue,
  useToast,
} from "@chakra-ui/react";
import { CalendarDaysIcon, InformationCircleIcon } from "@heroicons/react/24/outline";
import ReactApexChart from "react-apexcharts";
import type { ApexOptions } from "apexcharts";
import DatePicker from "components/common/DatePicker";
import dayjs, { ManipulateType } from "dayjs";
import utc from "dayjs/plugin/utc";
import { FC, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import useGetUser from "hooks/useGetUser";
import { useNodes, useNodesQuery } from "contexts/NodesContext";
import { createUsageConfig } from "./UsageFilter";
import { formatBytes } from "utils/formatByte";
import { fetch as apiFetch } from "service/http";

dayjs.extend(utc);

const CalendarIconStyled = chakra(CalendarDaysIcon, { baseStyle: { w: 4, h: 4 } });
const InfoIcon = chakra(InformationCircleIcon, { baseStyle: { w: 4, h: 4 } });

type RangeKey = "24h" | "7d" | "30d" | "90d" | "custom";
type PresetRangeKey = Exclude<RangeKey, "custom">;

type UsagePreset = {
  key: PresetRangeKey;
  label: string;
  amount: number;
  unit: ManipulateType;
};

type RangeState = {
  key: RangeKey;
  start: Date;
  end: Date;
  unit: ManipulateType;
};

type NodeUsageSlice = {
  nodeId: number;
  nodeName: string;
  total: number;
};

type DailyUsagePoint = {
  date: string;
  used_traffic: number;
};

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
  const alignUnit: ManipulateType = preset.unit === "hour" ? "hour" : "day";
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
    chart: { type: "area", toolbar: { show: false }, zoom: { enabled: false } },
    dataLabels: { enabled: false },
    stroke: { curve: "smooth", width: 2 },
    fill: {
      type: "gradient",
      gradient: { shadeIntensity: 1, opacityFrom: 0.35, opacityTo: 0.05, stops: [0, 80, 100] },
    },
    grid: { borderColor: colorMode === "dark" ? "#2D3748" : "#E2E8F0" },
    xaxis: {
      categories,
      labels: { style: { colors: categories.map(() => axisColor) } },
      axisBorder: { show: false },
      axisTicks: { show: false },
    },
    yaxis: {
      labels: {
        formatter: (value: number) => formatBytes(Number(value) || 0, 1),
        style: { colors: [axisColor] },
      },
    },
    tooltip: {
      theme: colorMode === "dark" ? "dark" : "light",
      shared: true,
      fillSeriesColor: false,
      y: { formatter: (value: number) => formatBytes(Number(value) || 0, 2) },
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
const UsageRangeControls: FC<UsageRangeControlsProps> = ({
  presets,
  range,
  onPresetChange,
  onCustomChange,
}) => {
  const { t } = useTranslation();
  const popoverPlacement = useBreakpointValue({ base: "bottom", md: "auto-end" }) ?? "auto-end";
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
        placement={popoverPlacement}
        isOpen={isCalendarOpen}
        onClose={() => {
          setCalendarOpen(false);
        }}
        closeOnBlur={false}
        modifiers={[
          { name: "preventOverflow", options: { padding: 16 } },
          {
            name: "flip",
            options: { fallbackPlacements: ["top-end", "bottom-start", "top-start"] },
          },
        ]}
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
        <PopoverContent
          w="fit-content"
          maxW="calc(100vw - 2rem)"
          _focus={{ outline: "none" }}
        >
          <PopoverArrow />
          <PopoverBody px={3} py={3}>
            <Box overflowX="auto" maxW="full">
              <DatePicker
                selectsRange
                inline
                maxDate={new Date()}
                startDate={draftRange[0] ?? undefined}
                endDate={draftRange[1] ?? undefined}
                calendarClassName="usage-range-datepicker"
                onChange={(dates: [Date | null, Date | null] | null) => {
                  const [start, end] = dates ?? [null, null];
                  setDraftRange([start, end]);
                  if (start && end) {
                    onCustomChange(start, end);
                    setCalendarOpen(false);
                  }
                }}
              />
            </Box>
            <Text mt={2} fontSize="xs" color="gray.500" _dark={{ color: "gray.400" }}>
              {t("nodes.customRangeHint", "Select a start and end date")}
            </Text>
          </PopoverBody>
        </PopoverContent>
      </Popover>
    </Stack>
  );
};

const NodesUsageAnalytics: FC = () => {
  const { t } = useTranslation();
  const toast = useToast();
  const { colorMode } = useColorMode();
  const { data: nodes } = useNodesQuery();
  const { fetchNodesUsage } = useNodes();
  const { userData } = useGetUser();

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
  const totalNodeUsage = useMemo(
    () => nodeUsageSlices.reduce((sum, slice) => sum + slice.total, 0),
    [nodeUsageSlices]
  );

  const nodeUsageChart = useMemo(() => {
    const series = nodeUsageSlices.map((slice) => slice.total);
    const labels = nodeUsageSlices.map((slice) => slice.nodeName);
    return createUsageConfig(
      colorMode,
      `${t("userDialog.total")} ${formatBytes(totalNodeUsage || 0, 2)}`,
      series,
      labels
    );
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
    return createUsageConfig(
      colorMode,
      `${t("userDialog.total")} ${formatBytes(totalAdminUsage || 0, 2)}`,
      series,
      labels
    );
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

        const uniqueUsernames = Array.from(new Set(usernames)).sort((a, b) => a.localeCompare(b));

        if (!uniqueUsernames.length && userData?.username) {
          setAdminOptions([userData.username]);
          return;
        }

        setAdminOptions(uniqueUsernames);
        setSelectedAdminDaily((prev) => {
          if (prev && uniqueUsernames.includes(prev)) {
            return prev;
          }
          return uniqueUsernames[0] ?? prev ?? null;
        });
        setSelectedAdminTotals((prev) => {
          if (prev && uniqueUsernames.includes(prev)) {
            return prev;
          }
          return uniqueUsernames[0] ?? prev ?? null;
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

    apiFetch(`/admin/${encodeURIComponent(selectedAdminDaily)}/usage/nodes`, { query })
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
      setNodeDailyMeta(null);
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

    apiFetch(`/node/${nodeDailySelectedNodeId}/usage/daily`, { query })
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
      setAdminDailyMeta(null);
      return;
    }
    if (selectedAdminNodeId === null) {
      setAdminDailyPoints([]);
      setAdminDailyMeta(null);
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

    apiFetch(`/admin/${encodeURIComponent(selectedAdminDaily)}/usage/chart`, { query })
      .then((data: any) => {
        if (cancelled) return;
        const usages = Array.isArray(data?.usages) ? data.usages : [];
        const mapped = usages.map((entry: any) => ({
          date: entry?.date ?? "",
          used_traffic: Number(entry?.used_traffic ?? 0),
        }));
        setAdminDailyPoints(mapped);
        setAdminDailyMeta({
          nodeName:
            data?.node_name ??
            adminNodeOptions.find((option) => option.value === selectedAdminNodeId)?.label ??
            null,
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
  return (
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
            <Tooltip
              label={t("nodes.trafficOverviewTooltip", "Total usage per node over the chosen range.")}
              placement="top"
              fontSize="sm"
            >
              <HStack spacing={2} align="center">
                <Text fontWeight="semibold">{t("nodes.trafficOverview", "Traffic overview")}</Text>
                <InfoIcon color="gray.500" _dark={{ color: "gray.400" }} aria-label="info" cursor="help" />
              </HStack>
            </Tooltip>
            <Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }}>
              {t("nodes.totalLabel", "Total")}: {" "}
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
            <Tooltip
              label={t(
                "nodes.perDayUsageTooltip",
                "Daily traffic aggregated for the selected node within the chosen range."
              )}
              placement="top"
              fontSize="sm"
            >
              <HStack spacing={2} align="center">
                <Text fontWeight="semibold">{t("nodes.perDayUsage", "Per day usage")}</Text>
                <InfoIcon color="gray.500" _dark={{ color: "gray.400" }} aria-label="info" cursor="help" />
              </HStack>
            </Tooltip>
            <Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }}>
              {t("nodes.selectedNode", "Node")}: {" "}
              <chakra.span fontWeight="medium">{nodeDailyMeta?.nodeName ?? t("nodes.unknownNode", "Unknown")}</chakra.span>{" "}
              {t("nodes.totalLabel", "Total")}: {" "}
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
            <ReactApexChart
              options={nodeDailyChartConfig.options}
              series={nodeDailyChartConfig.series}
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
            <Tooltip
              label={t("nodes.adminUsageChartTooltip", "Usage trend for the selected admin and node.")}
              placement="top"
              fontSize="sm"
            >
              <HStack spacing={2} align="center">
                <Text fontWeight="semibold">{t("nodes.adminUsageChart", "Admin usage chart")}</Text>
                <InfoIcon color="gray.500" _dark={{ color: "gray.400" }} aria-label="info" cursor="help" />
              </HStack>
            </Tooltip>
            <Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }}>
              {t("nodes.selectedAdmin", "Admin")}: {" "}
              <chakra.span fontWeight="medium">{selectedAdminDaily ?? "-"}</chakra.span>{" "}
              {t("nodes.selectedNode", "Node")}: {" "}
              <chakra.span fontWeight="medium">
                {adminDailyMeta?.nodeName ?? t("nodes.unknownNode", "Unknown")}
              </chakra.span>{" "}
              {t("nodes.totalLabel", "Total")}: {" "}
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
          direction={{ base: "column", md: "row" }}
          spacing={{ base: 4, md: 6 }}
          justifyContent="space-between"
          alignItems={{ base: "stretch", md: "flex-start" }}
          w="full"
        >
          <VStack align="start" spacing={1}>
            <Tooltip
              label={t("nodes.perAdminUsageTooltip", "Total usage by node for the selected admin.")}
              placement="top"
              fontSize="sm"
            >
              <HStack spacing={2} align="center">
                <Text fontWeight="semibold">{t("nodes.perAdminUsage", "Per admin usages")}</Text>
                <InfoIcon color="gray.500" _dark={{ color: "gray.400" }} aria-label="info" cursor="help" />
              </HStack>
            </Tooltip>
            <Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }}>
              {t("nodes.selectedAdmin", "Admin")}: {" "}
              <chakra.span fontWeight="medium">{selectedAdminTotals ?? "-"}</chakra.span>{" "}
              {t("nodes.totalLabel", "Total")}: {" "}
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
  );
};

export default NodesUsageAnalytics;
