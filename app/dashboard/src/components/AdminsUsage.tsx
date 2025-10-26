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
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverBody,
  PopoverArrow,
  chakra,
  Tooltip,
} from "@chakra-ui/react";
import ReactApexChart from "react-apexcharts";
import ReactDatePicker from "react-datepicker";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { useTranslation } from "react-i18next";
import { fetch as apiFetch } from "service/http";
import { useAdminsStore } from "contexts/AdminsContext";
import { formatBytes } from "utils/formatByte";
import { CalendarDaysIcon, InformationCircleIcon } from "@heroicons/react/24/outline";

dayjs.extend(utc);
const InfoIcon = chakra(InformationCircleIcon, { baseStyle: { w: 4, h: 4 } });
const CalendarIcon = chakra(CalendarDaysIcon, { baseStyle: { w: 4, h: 4 } });

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
const toUtcMillis = (value: string) => {
  if (!value) return 0;
  const hasTime = value.includes(" ");
  const normalized = hasTime ? value.replace(" ", "T") : `${value}T00:00`;
  return dayjs.utc(normalized).valueOf();
};

const buildRangeFromPreset = (preset: UsagePreset): RangeState => {
  const alignUnit: dayjs.ManipulateType = preset.unit === "hour" ? "hour" : "day";
  const end = dayjs().utc().endOf(alignUnit);
  const span = Math.max(preset.amount - 1, 0);
  const start = end.subtract(span, preset.unit).startOf(alignUnit);
  return { key: preset.key, start: start.toDate(), end: end.toDate(), unit: preset.unit };
};

const normalizeCustomRange = (start: Date, end: Date): RangeState => {
  const startDate = dayjs(start);
  const endDate = dayjs(end);
  const [minDate, maxDate] = startDate.isBefore(endDate) ? [startDate, endDate] : [endDate, startDate];
  const startDay = minDate.startOf("day");
  const endDay = maxDate.endOf("day");
  const isSingleDay = startDay.isSame(endDay, "day");
  return {
    key: "custom",
    start: startDay.toDate(),
    end: endDay.toDate(),
    unit: isSingleDay ? "hour" : "day",
  };
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
  const [isCalendarOpen, setCalendarOpen] = useState(false);
  const [draftRange, setDraftRange] = useState<[Date | null, Date | null]>([range.start, range.end]);

  useEffect(() => {
    if (!isCalendarOpen) {
      setDraftRange([range.start, range.end]);
    }
  }, [isCalendarOpen, range.start, range.end]);

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
    const isHourly = range.unit === "hour";
    const query: Record<string, string> = {
      start: formatApiStart(range.start),
      end: formatApiEnd(range.end),
    };
    if (isHourly) {
      query.granularity = "hour";
    }
    const endpoint = isHourly ? "chart" : "daily";
    console.debug("AdminsUsage: fetching usage", { selectedAdmin, endpoint, query });
    apiFetch(`/admin/${encodeURIComponent(selectedAdmin)}/usage/${endpoint}`, { query })
      .then((data: any) => {
        if (cancelled) return;
        const usages = Array.isArray(data?.usages) ? data.usages : [];
        console.debug("AdminsUsage: response usages", { length: usages.length, endpoint });
        let mapped: DailyUsagePoint[];
        if (isHourly) {
          const aggregated = new Map<string, number>();
          usages.forEach((entry: any) => {
            const dateLabel = typeof entry?.date === "string" ? entry.date : "";
            if (!dateLabel) return;
            const current = aggregated.get(dateLabel) ?? 0;
            aggregated.set(dateLabel, current + Number(entry?.used_traffic ?? 0));
          });
          const aggregatedEntries: Array<[string, number]> = Array.from(aggregated.entries());
          aggregatedEntries.sort((entryA: [string, number], entryB: [string, number]) => {
            const [dateA] = entryA;
            const [dateB] = entryB;
            return toUtcMillis(dateA) - toUtcMillis(dateB);
          });
          mapped = aggregatedEntries.map(([date, used]) => ({ date, used_traffic: used }));
        } else {
          const dailyPoints = usages.map((entry: any): DailyUsagePoint => ({
            date: entry?.date ?? "",
            used_traffic: Number(entry?.used_traffic ?? 0),
          }));
          dailyPoints.sort(
            (pointA: DailyUsagePoint, pointB: DailyUsagePoint) =>
              toUtcMillis(pointA.date) - toUtcMillis(pointB.date)
          );
          mapped = dailyPoints;
        }
        setPoints(mapped);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("Error fetching admin usage:", err);
        setPoints([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
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
  const rangeLabel = useMemo(() => {
    const startLabel = dayjs(range.start).format("YYYY-MM-DD");
    const endLabel = dayjs(range.end).format("YYYY-MM-DD");
    return startLabel === endLabel ? startLabel : `${startLabel} - ${endLabel}`;
  }, [range.start, range.end]);

  return (
    <VStack spacing={4} align="stretch">
      <Box borderWidth="1px" borderRadius="lg" p={{ base: 4, md: 6 }} boxShadow="md">
        <Stack
          direction={{ base: "column", lg: "row" }}
          spacing={{ base: 4, lg: 6 }}
          justifyContent="space-between"
          alignItems={{ base: "stretch", lg: "flex-start" }}
          w="full"
        >
          <VStack align="start" spacing={1}>
            <HStack spacing={2} align="center">
              <Text fontWeight="semibold">{t("admins.dailyUsage", "Daily usage")}</Text>
              <Tooltip label={t("admins.dailyUsageTooltip", "Total data usage per day for the selected admin and time range")}> 
                <InfoIcon color="gray.500" _dark={{ color: "gray.400" }} aria-label="info" cursor="help" />
              </Tooltip>
            </HStack>
            <Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }}>
              {t("admins.selectedAdmin", "Admin")}:{" "}
              <chakra.span fontWeight="medium">{selectedAdmin ?? "-"}</chakra.span>{" "}
              {t("nodes.totalLabel", "Total")}:{" "}
              <chakra.span fontWeight="medium">{formatBytes(total || 0, 2)}</chakra.span>
            </Text>
          </VStack>
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
              flex="1"
              justifyContent={{ sm: "flex-end" }}
            >
              {presets.map((p) => (
                <Button
                  key={p.key}
                  size="sm"
                  onClick={() => {
                    setSelectedPresetKey(p.key);
                    setRange(buildRangeFromPreset(p));
                  }}
                  variant={selectedPresetKey === p.key ? "solid" : "outline"}
                  colorScheme="primary"
                  w={{ base: "full", sm: "auto" }}
                >
                  {p.label}
                </Button>
              ))}
            </Stack>
            <Stack
              direction={{ base: "column", sm: "row" }}
              spacing={2}
              alignItems={{ base: "stretch", sm: "center" }}
            >
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
                    leftIcon={<CalendarIcon />}
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
                          const normalized = normalizeCustomRange(start, end);
                          setSelectedPresetKey("custom");
                          setRange(normalized);
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
              <Select
                value={selectedAdmin ?? ""}
                onChange={(e) => setSelectedAdmin(e.target.value)}
                w={{ base: "full", sm: "auto", md: "220px" }}
                minW={{ md: "200px" }}
              >
                {admins.map((a) => (
                  <option key={a.username} value={a.username}>
                    {a.username}
                  </option>
                ))}
              </Select>
            </Stack>
          </Stack>
        </Stack>
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
