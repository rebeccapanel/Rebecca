import React, { FC, useEffect, useMemo, useState } from "react";
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
} from "@chakra-ui/react";
import type { PlacementWithLogical } from "@chakra-ui/react";
import ReactApexChart from "react-apexcharts";
import type { ApexOptions } from "apexcharts";
import DatePicker from "components/common/DatePicker";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { useTranslation } from "react-i18next";
import { CalendarDaysIcon, InformationCircleIcon } from "@heroicons/react/24/outline";
import { fetch as apiFetch } from "service/http";
import {
  ServiceAdminTimeseries,
  ServiceAdminUsage,
  ServiceAdminUsageResponse,
  ServiceSummary,
  ServiceUsagePoint,
  ServiceUsageTimeseries,
} from "types/Service";
import { formatBytes } from "utils/formatByte";

dayjs.extend(utc);

const CalendarIcon = chakra(CalendarDaysIcon, { baseStyle: { w: 4, h: 4 } });
const InfoIcon = chakra(InformationCircleIcon, { baseStyle: { w: 4, h: 4 } });

type UsagePreset = { key: string; label: string; amount: number; unit: "day" | "hour" };
type RangeState = { key: string; start: Date; end: Date; unit: "day" | "hour" };

const presets: UsagePreset[] = [
  { key: "24h", label: "24h", amount: 24, unit: "hour" },
  { key: "7d", label: "7d", amount: 7, unit: "day" },
  { key: "30d", label: "30d", amount: 30, unit: "day" },
  { key: "90d", label: "90d", amount: 90, unit: "day" },
];

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

const formatApiStart = (date: Date) => dayjs(date).utc().format("YYYY-MM-DDTHH:mm:ssZ");
const formatApiEnd = (date: Date) => dayjs(date).utc().format("YYYY-MM-DDTHH:mm:ssZ");

const formatTimeseriesLabel = (timestamp: string, granularity: "day" | "hour") => {
  if (!timestamp) return timestamp;
  const parsed = dayjs.utc(timestamp);
  if (!parsed.isValid()) return timestamp;
  return granularity === "hour" ? parsed.local().format("MM-DD HH:mm") : parsed.format("YYYY-MM-DD");
};

const buildAreaChartOptions = (colorMode: string, categories: string[], label: string): ApexOptions => {
  const axisColor = colorMode === "dark" ? "#d8dee9" : "#1a202c";
  return {
    chart: { type: "area" as const, toolbar: { show: false }, zoom: { enabled: false } },
    dataLabels: { enabled: false },
    stroke: { curve: "smooth" as const, width: 2 },
    fill: { type: "gradient" as const, gradient: { shadeIntensity: 1, opacityFrom: 0.35, opacityTo: 0.05, stops: [0, 80, 100] } },
    grid: { borderColor: colorMode === "dark" ? "#2D3748" : "#E2E8F0" },
    xaxis: { categories, labels: { style: { colors: categories.map(() => axisColor) }, rotate: 0 }, axisBorder: { show: false }, axisTicks: { show: false } },
    yaxis: { labels: { formatter: (value: number) => formatBytes(Number(value) || 0, 1), style: { colors: [axisColor] } }, title: { text: label, style: { color: axisColor } } },
    tooltip: { theme: colorMode === "dark" ? "dark" : "light", shared: true, fillSeriesColor: false, y: { formatter: (value: number) => formatBytes(Number(value) || 0, 2) } },
    colors: [colorMode === "dark" ? "#63B3ED" : "#3182CE"],
  };
};

const buildDonutOptions = (colorMode: string, labels: string[]): ApexOptions => ({
  labels,
  legend: { position: "bottom" as const, labels: { colors: colorMode === "dark" ? "#d8dee9" : "#1a202c" } },
  tooltip: {
    y: {
      formatter: (value: number) => formatBytes(Number(value) || 0, 2),
      title: {
        formatter: (seriesName: string, opts?: { seriesIndex: number; w: { globals: { labels: string[] } } }) =>
          opts?.w?.globals?.labels?.[opts.seriesIndex] ?? seriesName,
      },
    },
  },
  colors: [
    "#3182CE",
    "#63B3ED",
    "#ED8936",
    "#38A169",
    "#9F7AEA",
    "#F6AD55",
    "#4299E1",
    "#E53E3E",
    "#D53F8C",
    "#805AD5",
  ],
});

type ServiceUsageAnalyticsProps = {
  services: ServiceSummary[];
  selectedServiceId?: number | null;
};

export const ServiceUsageAnalytics: FC<ServiceUsageAnalyticsProps> = ({ services, selectedServiceId }) => {
  const { t } = useTranslation();
  const { colorMode } = useColorMode();
  const fallbackPlacement: PlacementWithLogical = "auto-end";
  const popoverPlacement: PlacementWithLogical =
    useBreakpointValue<PlacementWithLogical>({ base: "bottom", md: "auto-end" }) ?? fallbackPlacement;

  const serviceOptions = useMemo(() => services.map((service) => ({ id: service.id, name: service.name })), [services]);
  const initialServiceId = useMemo(() => {
    if (selectedServiceId) return selectedServiceId;
    if (serviceOptions.length) return serviceOptions[0].id;
    return null;
  }, [selectedServiceId, serviceOptions]);

  const defaultPreset = presets.find((preset) => preset.key === "30d") ?? presets[0];

  const [serviceId, setServiceId] = useState<number | null>(initialServiceId);
  const [range, setRange] = useState<RangeState>(() => buildRangeFromPreset(defaultPreset));
  const [selectedPresetKey, setSelectedPresetKey] = useState<string>(defaultPreset.key);
  const [draftRange, setDraftRange] = useState<[Date | null, Date | null]>([null, null]);
  const [isCalendarOpen, setCalendarOpen] = useState(false);
  const [timeseries, setTimeseries] = useState<ServiceUsagePoint[]>([]);
  const [timeseriesGranularity, setTimeseriesGranularity] = useState<"day" | "hour">("day");
  const [adminUsage, setAdminUsage] = useState<ServiceAdminUsage[]>([]);
  const [loadingTimeseries, setLoadingTimeseries] = useState(false);
  const [loadingAdmins, setLoadingAdmins] = useState(false);
  const [selectedAdminId, setSelectedAdminId] = useState<number | null>(null);
  const [adminTimeseries, setAdminTimeseries] = useState<ServiceUsagePoint[]>([]);
  const [adminTimeseriesGranularity, setAdminTimeseriesGranularity] = useState<"day" | "hour">("day");
  const [adminTimeseriesUsername, setAdminTimeseriesUsername] = useState<string>("");
  const [loadingAdminTimeseries, setLoadingAdminTimeseries] = useState(false);

  useEffect(() => {
    setServiceId(initialServiceId);
  }, [initialServiceId]);

  useEffect(() => {
    if (!serviceId) {
      setTimeseries([]);
      setAdminUsage([]);
      setAdminTimeseries([]);
      setSelectedAdminId(null);
      setAdminTimeseriesUsername("");
      return;
    }
    const params = {
      start: formatApiStart(range.start),
      end: formatApiEnd(range.end),
    };
    const granularityParam = range.unit === "hour" ? "hour" : "day";

    let cancelled = false;
    setLoadingTimeseries(true);
    apiFetch<ServiceUsageTimeseries>(`/v2/services/${serviceId}/usage/timeseries`, {
      query: { ...params, granularity: granularityParam },
    })
      .then((data) => {
        if (cancelled || !data) return;
        setTimeseries(data.points ?? []);
        setTimeseriesGranularity(data.granularity ?? granularityParam);
      })
      .catch(() => {
        if (!cancelled) {
          setTimeseries([]);
          setTimeseriesGranularity(granularityParam);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingTimeseries(false);
      });

    setLoadingAdmins(true);
    apiFetch<ServiceAdminUsageResponse>(`/v2/services/${serviceId}/usage/admins`, {
      query: params,
    })
      .then((data) => {
        if (cancelled || !data) return;
        setAdminUsage(data.admins ?? []);
      })
      .catch(() => {
        if (!cancelled) setAdminUsage([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingAdmins(false);
      });

    return () => {
      cancelled = true;
    };
  }, [serviceId, range.start, range.end, range.unit]);

  useEffect(() => {
    if (!serviceId) {
      setSelectedAdminId(null);
      setAdminTimeseries([]);
      setAdminTimeseriesUsername("");
      return;
    }

    if (!adminUsage.length) {
      setSelectedAdminId(null);
      return;
    }

    setSelectedAdminId((previous) => {
      const availableIds = adminUsage.map((item) => item.admin_id);
      if (previous === null) {
        if (availableIds.includes(null)) {
          return previous;
        }
      } else if (availableIds.includes(previous)) {
        return previous;
      }

      const withUsage = adminUsage.find((item) => (item.used_traffic || 0) > 0);
      if (withUsage) {
        return withUsage.admin_id ?? null;
      }

      const fallback = adminUsage[0];
      return fallback?.admin_id ?? null;
    });
  }, [adminUsage, serviceId]);

  useEffect(() => {
    if (!serviceId) {
      setAdminTimeseries([]);
      setAdminTimeseriesUsername("");
      setAdminTimeseriesGranularity("day");
      return;
    }

    if (selectedAdminId === undefined) {
      return;
    }

    if (!adminUsage.length && selectedAdminId === null) {
      setAdminTimeseries([]);
      setAdminTimeseriesUsername("");
      return;
    }

    const granularityParam = range.unit === "hour" ? "hour" : "day";
    const adminParam =
      selectedAdminId === null ? "null" : Number.isFinite(selectedAdminId) ? String(selectedAdminId) : "null";

    let cancelled = false;
    setLoadingAdminTimeseries(true);
    apiFetch<ServiceAdminTimeseries>(`/v2/services/${serviceId}/usage/admin-timeseries`, {
      query: {
        start: formatApiStart(range.start),
        end: formatApiEnd(range.end),
        granularity: granularityParam,
        admin_id: adminParam,
      },
    })
      .then((data) => {
        if (cancelled || !data) return;
        setAdminTimeseries(data.points ?? []);
        setAdminTimeseriesGranularity(data.granularity ?? granularityParam);
        setAdminTimeseriesUsername(data.username ?? "");
      })
      .catch(() => {
        if (!cancelled) {
          setAdminTimeseries([]);
          setAdminTimeseriesUsername("");
          setAdminTimeseriesGranularity(granularityParam);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingAdminTimeseries(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [adminUsage, range.end, range.start, range.unit, selectedAdminId, serviceId]);

  const rangeLabel = useMemo(() => {
    const startLabel = dayjs(range.start).format("YYYY-MM-DD");
    const endLabel = dayjs(range.end).format("YYYY-MM-DD");
    return `${startLabel} – ${endLabel}`;
  }, [range.start, range.end]);

  const categories = useMemo(
    () => timeseries.map((point) => formatTimeseriesLabel(point.timestamp, timeseriesGranularity)),
    [timeseries, timeseriesGranularity]
  );

  const areaSeries = useMemo(
    () => [
      {
        name: t("services.usageSeries", "Usage"),
        data: timeseries.map((point) => point.used_traffic),
      },
    ],
    [timeseries, t]
  );

  const areaOptions = useMemo(
    () => buildAreaChartOptions(colorMode, categories, t("services.usageYAxis", "Usage")),
    [categories, colorMode, t]
  );

  const adminSelectOptions = useMemo(
    () =>
      adminUsage.map((item) => ({
        value: item.admin_id === null ? "null" : String(item.admin_id),
        label: item.username || t("services.unassignedAdmin", "Unassigned"),
      })),
    [adminUsage, t]
  );

  const adminDisplayLabel = useMemo(() => {
    const targetValue = selectedAdminId === null ? "null" : String(selectedAdminId);
    return (
      adminSelectOptions.find((option) => option.value === targetValue)?.label ??
      (selectedAdminId === null ? t("services.unassignedAdmin", "Unassigned") : "")
    );
  }, [adminSelectOptions, selectedAdminId, t]);

  const adminTimeseriesCategories = useMemo(
    () => adminTimeseries.map((point) => formatTimeseriesLabel(point.timestamp, adminTimeseriesGranularity)),
    [adminTimeseries, adminTimeseriesGranularity]
  );

  const adminTimeseriesSeries = useMemo(
    () => [
      {
        name: t("services.usageSeries", "Usage"),
        data: adminTimeseries.map((point) => point.used_traffic),
      },
    ],
    [adminTimeseries, t]
  );

  const adminTimeseriesOptions = useMemo(
    () => buildAreaChartOptions(colorMode, adminTimeseriesCategories, t("services.usageYAxis", "Usage")),
    [adminTimeseriesCategories, colorMode, t]
  );

  const adminTimeseriesTotal = useMemo(
    () => adminTimeseries.reduce((total, point) => total + (point.used_traffic || 0), 0),
    [adminTimeseries]
  );

  const donutSeries = useMemo(() => adminUsage.map((item) => item.used_traffic), [adminUsage]);
  const donutLabels = useMemo(
    () => adminUsage.map((item) => item.username || t("services.unassignedAdmin", "Unassigned")),
    [adminUsage, t]
  );
  const donutOptions = useMemo(() => buildDonutOptions(colorMode, donutLabels), [colorMode, donutLabels]);
  const adminTotal = useMemo(() => adminUsage.reduce((acc, item) => acc + (item.used_traffic || 0), 0), [adminUsage]);

  if (serviceOptions.length === 0) {
    return (
      <VStack spacing={2} align="stretch" mt={4}>
        <Text fontWeight="semibold">{t("services.usageAnalyticsTitle", "Usage Analytics")}</Text>
        <Box borderWidth="1px" borderRadius="md" p={6}>
          <Text color="gray.500">{t("services.noServicesAvailable", "No services available")}</Text>
        </Box>
      </VStack>
    );
  }

  return (
    <VStack spacing={4} align="stretch">
      <HStack justify="space-between" align={{ base: "stretch", md: "center" }} flexDir={{ base: "column", md: "row" }} gap={3}>
        <Text fontWeight="semibold" fontSize="lg">
          {t("services.usageAnalyticsTitle", "Usage Analytics")}
        </Text>
        <Stack direction={{ base: "column", md: "row" }} spacing={{ base: 3, md: 4 }} align={{ base: "stretch", md: "center" }}>
          <Select
            value={serviceId ?? ""}
            onChange={(event) => setServiceId(Number(event.target.value) || null)}
            minW={{ md: "220px" }}
          >
            {serviceOptions.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name}
              </option>
            ))}
          </Select>
          <Stack direction={{ base: "column", sm: "row" }} spacing={2}>
            {presets.map((preset) => (
              <Button
                key={preset.key}
                size="sm"
                variant={selectedPresetKey === preset.key ? "solid" : "outline"}
                colorScheme="primary"
                onClick={() => {
                  setSelectedPresetKey(preset.key);
                  setRange(buildRangeFromPreset(preset));
                }}
              >
                {preset.label}
              </Button>
            ))}
          </Stack>
          <Popover
            placement={popoverPlacement}
            isOpen={isCalendarOpen}
            onClose={() => setCalendarOpen(false)}
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
                leftIcon={<CalendarIcon />}
                onClick={() => {
                  setDraftRange([range.start, range.end]);
                  setCalendarOpen((value) => !value);
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
                        const normalized = normalizeCustomRange(start, end);
                        setSelectedPresetKey("custom");
                        setRange(normalized);
                        setCalendarOpen(false);
                      }
                    }}
                  />
                </Box>
                <Text mt={2} fontSize="xs" color="gray.500">
                  {t("nodes.customRangeHint", "Select a start and end date")}
                </Text>
              </PopoverBody>
            </PopoverContent>
          </Popover>
        </Stack>
      </HStack>

      <Box borderWidth="1px" borderRadius="md" p={4}>
        <HStack justify="space-between" align={{ base: "stretch", md: "center" }} flexDir={{ base: "column", md: "row" }} gap={3}>
          <Text fontWeight="semibold">{t("services.usageOverTime", "Usage over time")}</Text>
          <HStack fontSize="sm" color="gray.500">
            <InfoIcon />
            <Text>
              {t("services.totalUsage", "Total")}{" "}
              <chakra.span fontWeight="medium">{formatBytes(timeseries.reduce((acc, item) => acc + (item.used_traffic || 0), 0), 2)}</chakra.span>
            </Text>
          </HStack>
        </HStack>
        <Box mt={4}>
          {loadingTimeseries ? (
            <VStack spacing={3} py={10}>
              <Spinner />
              <Text fontSize="sm" color="gray.500">
                {t("loading")}
              </Text>
            </VStack>
          ) : timeseries.length ? (
            <ReactApexChart type="area" height={360} options={areaOptions} series={areaSeries} />
          ) : (
            <Text textAlign="center" color="gray.500">
              {t("noData")}
            </Text>
          )}
        </Box>
      </Box>

      <Box borderWidth="1px" borderRadius="md" p={4}>
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
                "services.adminUsageTrendHint",
                "Daily usage for the selected admin within this service."
              )}
              placement="top"
              fontSize="sm"
            >
              <HStack spacing={2} align="center">
                <Text fontWeight="semibold">{t("services.adminUsageTrend", "Admin usage over time")}</Text>
                <InfoIcon color="gray.500" aria-label="info" cursor="help" />
              </HStack>
            </Tooltip>
            <Text fontSize="sm" color="gray.500">
              {t("services.selectedAdmin", "Admin")}:{" "}
              <chakra.span fontWeight="medium">{adminDisplayLabel || adminTimeseriesUsername || "-"}</chakra.span>{" "}
              {t("services.totalUsage", "Total")}:{" "}
              <chakra.span fontWeight="medium">{formatBytes(adminTimeseriesTotal || 0, 2)}</chakra.span>
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
              minW={{ md: "200px" }}
              value={selectedAdminId === null ? "null" : String(selectedAdminId)}
              onChange={(event) => {
                const value = event.target.value;
                if (value === "null") {
                  setSelectedAdminId(null);
                  return;
                }
                const parsed = Number(value);
                setSelectedAdminId(Number.isNaN(parsed) ? null : parsed);
              }}
              isDisabled={adminSelectOptions.length === 0}
            >
              {adminSelectOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Stack>
        </Stack>
        <Box mt={4}>
          {loadingAdminTimeseries ? (
            <VStack spacing={3} py={10}>
              <Spinner />
              <Text fontSize="sm" color="gray.500">
                {t("loading")}
              </Text>
            </VStack>
          ) : adminTimeseriesSeries[0]?.data?.length ? (
            <ReactApexChart type="area" height={360} options={adminTimeseriesOptions} series={adminTimeseriesSeries} />
          ) : (
            <Text textAlign="center" color="gray.500">
              {t("noData")}
            </Text>
          )}
        </Box>
      </Box>

      <Box borderWidth="1px" borderRadius="md" p={4}>
        <HStack justify="space-between" align={{ base: "stretch", md: "center" }} flexDir={{ base: "column", md: "row" }} gap={3}>
          <Text fontWeight="semibold">{t("services.adminUsageDistribution", "Admin usage distribution")}</Text>
          <HStack fontSize="sm" color="gray.500">
            <InfoIcon />
            <Text>
              {t("services.totalUsage", "Total")}{" "}
              <chakra.span fontWeight="medium">{formatBytes(adminTotal, 2)}</chakra.span>
            </Text>
          </HStack>
        </HStack>
        <Stack mt={4} direction={{ base: "column", lg: "row" }} spacing={6} align={{ base: "stretch", lg: "center" }}>
          <Box flex="1">
            {loadingAdmins ? (
              <VStack spacing={3} py={8}>
                <Spinner />
                <Text fontSize="sm" color="gray.500">
                  {t("loading")}
                </Text>
              </VStack>
            ) : adminUsage.length && adminTotal > 0 ? (
              <ReactApexChart type="donut" height={320} options={donutOptions} series={donutSeries} />
            ) : (
              <Text textAlign="center" color="gray.500">
                {t("noData")}
              </Text>
            )}
          </Box>
          <VStack flex="1" align="stretch" spacing={2}>
            {adminUsage.length ? (
              adminUsage.map((item) => (
                <HStack
                  key={`${item.admin_id ?? "na"}-${item.username}`}
                  justify="space-between"
                  borderWidth="1px"
                  borderRadius="md"
                  px={3}
                  py={2}
                >
                  <Text fontWeight="medium">{item.username || t("services.unassignedAdmin", "Unassigned")}</Text>
                  <Text fontSize="sm" color="gray.500">
                    {formatBytes(item.used_traffic || 0, 2)}
                  </Text>
                </HStack>
              ))
            ) : (
              <Text color="gray.500">{t("noData")}</Text>
            )}
          </VStack>
        </Stack>
      </Box>
    </VStack>
  );
};

export default ServiceUsageAnalytics;
