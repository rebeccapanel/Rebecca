import React, { FC, useEffect, useMemo, useState } from "react";
import {
  Box,
  HStack,
  Select,
  Spinner,
  Stack,
  Text,
  VStack,
  useColorMode,
  Button,
  ButtonGroup,
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverBody,
  PopoverArrow,
  chakra,
  Tooltip,
} from "@chakra-ui/react";
import ReactApexChart from "react-apexcharts";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { useTranslation } from "react-i18next";
import { fetch as apiFetch } from "service/http";
import { useAdminsStore } from "contexts/AdminsContext";
import { formatBytes } from "utils/formatByte";
import { InformationCircleIcon } from "@heroicons/react/24/outline";

dayjs.extend(utc);
const InfoIcon = chakra(InformationCircleIcon, { baseStyle: { w: 4, h: 4 } });

interface DailyUsagePoint {
  date: string;
  used_traffic: number;
}

type PresetRangeKey = string;

type UsagePreset = { key: string; label: string; amount: number; unit: "day" | "hour" };
type RangeState = { key: string; start: Date; end: Date; unit: "day" | "hour" };

const FALLBACK_PRESET: UsagePreset = { key: "30d", label: "30d", amount: 30, unit: "day" };

const formatTimeseriesLabel = (value: string) => {
  if (!value) return value;
  const hasTime = value.includes(" ");
  const normalized = hasTime ? value.replace(" ", "T") : value;
  const parsed = dayjs.utc(normalized);
  if (!parsed.isValid()) return value;
  return hasTime ? parsed.local().format("MM-DD HH:mm") : parsed.format("YYYY-MM-DD");
};

const formatApiStart = (date: Date) => dayjs(date).utc().format("YYYY-MM-DDTHH:mm:ss") + "Z";
const formatApiEnd = (date: Date) => dayjs(date).utc().format("YYYY-MM-DDTHH:mm:ss") + "Z";

const buildRangeFromPreset = (preset: UsagePreset): RangeState => {
  const alignUnit: dayjs.ManipulateType = preset.unit === "hour" ? "hour" : "day";
  const end = dayjs().utc().endOf(alignUnit);
  const span = Math.max(preset.amount - 1, 0);
  const start = end.subtract(span, preset.unit).startOf(alignUnit);
  return { key: preset.key, start: start.toDate(), end: end.toDate(), unit: preset.unit };
};

const buildDailyUsageOptions = (colorMode: string, categories: string[]) => {
  const axisColor = colorMode === "dark" ? "#d8dee9" : "#1a202c";
  return {
    chart: { type: "area", toolbar: { show: false }, zoom: { enabled: false } },
    dataLabels: { enabled: false },
    stroke: { curve: "smooth", width: 2 },
    fill: { type: "gradient", gradient: { shadeIntensity: 1, opacityFrom: 0.35, opacityTo: 0.05, stops: [0, 80, 100] } },
    grid: { borderColor: colorMode === "dark" ? "#2D3748" : "#E2E8F0" },
    xaxis: { categories, labels: { style: { colors: categories.map(() => axisColor) } }, axisBorder: { show: false }, axisTicks: { show: false } },
    yaxis: { labels: { formatter: (value: number) => formatBytes(Number(value) || 0, 1), style: { colors: [axisColor] } } },
    tooltip: { theme: colorMode === "dark" ? "dark" : "light", shared: true, fillSeriesColor: false, y: { formatter: (value: number) => formatBytes(Number(value) || 0, 2) } },
    colors: [colorMode === "dark" ? "#63B3ED" : "#3182CE"],
  };
};

const AdminsUsage: FC = () => {
  const { t } = useTranslation();
  const { colorMode } = useColorMode();
  const { admins: pagedAdmins } = useAdminsStore();
  const [admins, setAdmins] = useState<any[]>([]);

  const presets = useMemo<UsagePreset[]>(
    () => [
      { key: "24h", label: "24h", amount: 24, unit: "hour" },
      { key: "7d", label: "7d", amount: 7, unit: "day" },
      { key: "30d", label: "30d", amount: 30, unit: "day" },
      { key: "90d", label: "90d", amount: 90, unit: "day" },
    ],
    []
  );

  const defaultPreset = presets.find((p) => p.key === "30d") ?? FALLBACK_PRESET;

  const [range, setRange] = useState<RangeState>(() => buildRangeFromPreset(defaultPreset));
  const [selectedPresetKey, setSelectedPresetKey] = useState<string>(defaultPreset.key);
  const [selectedAdmin, setSelectedAdmin] = useState<string | null>(null);
  const [points, setPoints] = useState<DailyUsagePoint[]>([]);
  const [loading, setLoading] = useState(false);

  // load all admins (not paginated) for the select list
  useEffect(() => {
    let cancelled = false;
    const loadAll = async () => {
      try {
        const data: any = await apiFetch(`/admins`);
        if (cancelled) return;
        if (Array.isArray(data)) setAdmins(data);
        else setAdmins(data.admins || []);
      } catch (err) {
        console.error("Failed to load all admins:", err);
        // fallback to paged admins from store
        setAdmins(pagedAdmins || []);
      }
    };
    loadAll();
    return () => {
      cancelled = true;
    };
  }, [pagedAdmins]);

  useEffect(() => {
    if (!selectedAdmin) return;
    let cancelled = false;
    setLoading(true);
    const query: Record<string, string> = {
      start: formatApiStart(range.start),
      end: formatApiEnd(range.end),
    };
    console.debug("AdminsUsage: fetching daily usage", { selectedAdmin, query });
    apiFetch(`/admin/${encodeURIComponent(selectedAdmin)}/usage/daily`, { query })
      .then((data: any) => {
        if (cancelled) return;
        const usages = Array.isArray(data?.usages) ? data.usages : [];
        console.debug("AdminsUsage: response daily usages", { length: usages.length });
        const mapped = usages.map((entry: any) => ({ date: entry?.date ?? "", used_traffic: Number(entry?.used_traffic ?? 0) }));
        setPoints(mapped);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Error fetching admin daily usage:", err);
        setPoints([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [selectedAdmin, range]);

  useEffect(() => {
    if (!admins || admins.length === 0) return;
    if (!selectedAdmin) setSelectedAdmin(admins[0].username);
  }, [admins, selectedAdmin]);

  // keep selectedPresetKey in sync with range; if range doesn't match any preset mark as custom
  useEffect(() => {
    const found = presets.find((p) => p.key === range.key);
    if (found) setSelectedPresetKey(found.key);
    else setSelectedPresetKey("custom");
  }, [range, presets]);

  const categories = useMemo(() => points.map((p) => formatTimeseriesLabel(p.date)), [points]);
  const series = useMemo(() => [{ name: t("nodes.usedTrafficSeries", "Used traffic"), data: points.map((p) => p.used_traffic) }], [points, t]);

  const chartConfig = useMemo(
    () => ({ options: buildDailyUsageOptions(colorMode, categories) as any, series }),
    [colorMode, categories, series]
  );

  const total = useMemo(() => points.reduce((sum, p) => sum + Number(p.used_traffic || 0), 0), [points]);

  return (
    <VStack spacing={4} align="stretch">
      <Box borderWidth="1px" borderRadius="lg" p={{ base: 4, md: 6 }} boxShadow="md">
        <HStack justify="space-between" align="start" flexWrap="wrap" gap={3}>
          <VStack align="start" spacing={1}>
            <HStack spacing={2} align="center">
              <Text fontWeight="semibold">{t("admins.dailyUsage", "Daily usage")}</Text>
              <Tooltip label={t("admins.dailyUsageTooltip", "Total data usage per day for the selected admin and time range")}> 
                <InfoIcon color="gray.500" _dark={{ color: "gray.400" }} aria-label="info" cursor="help" />
              </Tooltip>
            </HStack>
            <Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }}>
              {t("admins.selectedAdmin", "Admin")}: <chakra.span fontWeight="medium">{selectedAdmin ?? "-"}</chakra.span>  {t("nodes.totalLabel", "Total")}: <chakra.span fontWeight="medium">{formatBytes(total || 0, 2)}</chakra.span>
            </Text>
          </VStack>
          <HStack>
            <ButtonGroup size="sm" variant="outline">
              {presets.map((p) => (
                <Button
                  key={p.key}
                  onClick={() => {
                    setSelectedPresetKey(p.key);
                    setRange(buildRangeFromPreset(p));
                  }}
                  variant={selectedPresetKey === p.key ? "solid" : "outline"}
                  colorScheme="primary"
                >
                  {p.label}
                </Button>
              ))}
            </ButtonGroup>
            <Popover placement="bottom-end">
              <PopoverTrigger>
                <Button size="sm" variant="outline">{`${dayjs(range.start).format("YYYY-MM-DD")} - ${dayjs(range.end).format("YYYY-MM-DD")}`}</Button>
              </PopoverTrigger>
              <PopoverContent>
                <PopoverArrow />
                <PopoverBody>
                  <Text fontSize="sm">{t("selectRange")}</Text>
                </PopoverBody>
              </PopoverContent>
            </Popover>
            {/* granularity removed: daily endpoint used */}
            <Select value={selectedAdmin ?? ""} onChange={(e) => setSelectedAdmin(e.target.value)} width="220px">
              {admins.map((a) => (
                <option key={a.username} value={a.username}>{a.username}</option>
              ))}
            </Select>
          </HStack>
        </HStack>
        <Box mt={6}>
          {loading ? (
            <VStack spacing={3}>
              <Spinner />
              <Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }}>{t("loading")}</Text>
            </VStack>
          ) : chartConfig.series && chartConfig.series.length ? (
            <ReactApexChart options={chartConfig.options} series={chartConfig.series} type="area" height={360} />
          ) : (
            <Text textAlign="center" color="gray.500" _dark={{ color: "gray.400" }}>{t("noData")}</Text>
          )}
        </Box>
      </Box>
    </VStack>
  );
};

export default AdminsUsage;
