import React, { FC, useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  HStack,
  Select,
  Spinner,
  Stack,
  Text,
  VStack,
  chakra,
  Tooltip,
  useColorMode,
} from "@chakra-ui/react";
import ReactApexChart from "react-apexcharts";
import type { ApexOptions } from "apexcharts";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { useTranslation } from "react-i18next";
import { fetch as apiFetch } from "service/http";
import { useAdminsStore } from "contexts/AdminsContext";
import { formatBytes } from "utils/formatByte";
import {
  ServiceAdminUsage,
  ServiceAdminUsageResponse,
  ServiceListResponse,
  ServiceSummary,
} from "types/Service";
import { buildRangeFromPreset, normalizeCustomRange } from "utils/usageRange";
import type { Admin } from "types/Admin";
import { InformationCircleIcon } from "@heroicons/react/24/outline";
import { DateRangePicker, type DateRangeValue } from "components/common/DateRangePicker";
import { ChartBox } from "components/common/ChartBox";

dayjs.extend(utc);
const InfoIcon = chakra(InformationCircleIcon, { baseStyle: { w: 4, h: 4 } });

interface DailyUsagePoint {
  date: string;
  used_traffic: number;
}

interface AdminUsageApiResponse {
  usages?: Array<{
    date?: string;
    used_traffic?: number;
  }>;
}

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

const buildDailyUsageOptions = (colorMode: string, categories: string[]): ApexOptions => {
  const axisColor = colorMode === "dark" ? "#d8dee9" : "#1a202c";
  return {
    chart: { type: "area" as const, toolbar: { show: false }, zoom: { enabled: false } },
    dataLabels: { enabled: false },
    stroke: { curve: "smooth" as const, width: 2 },
    fill: { type: "gradient" as const, gradient: { shadeIntensity: 1, opacityFrom: 0.35, opacityTo: 0.05, stops: [0, 80, 100] } },
    grid: { borderColor: colorMode === "dark" ? "#2D3748" : "#E2E8F0" },
    xaxis: { categories, labels: { style: { colors: categories.map(() => axisColor) } }, axisBorder: { show: false }, axisTicks: { show: false } },
    yaxis: { labels: { formatter: (value: number) => formatBytes(Number(value) || 0, 1), style: { colors: [axisColor] } } },
    tooltip: { theme: colorMode === "dark" ? "dark" : "light", shared: true, fillSeriesColor: false, y: { formatter: (value: number) => formatBytes(Number(value) || 0, 2) } },
    colors: [colorMode === "dark" ? "#63B3ED" : "#3182CE"],
  };
};

const buildServiceDonutOptions = (colorMode: string, labels: string[]): ApexOptions => ({
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

const AdminsUsage: FC = () => {
  const { t } = useTranslation();
  const { colorMode } = useColorMode();
  const { admins: pagedAdmins } = useAdminsStore();

  const [admins, setAdmins] = useState<any[]>([]);
  const [serviceOptions, setServiceOptions] = useState<ServiceSummary[]>([]);
  const [selectedServiceId, setSelectedServiceId] = useState<number | null>(null);
  const [serviceAdminUsage, setServiceAdminUsage] = useState<ServiceAdminUsage[]>([]);
  const [loadingServiceUsage, setLoadingServiceUsage] = useState(false);
  const presets = useMemo(
    () => [
      { key: "7h", label: "7h", amount: 7, unit: "hour" as const },
      { key: "1d", label: "1d", amount: 1, unit: "day" as const },
      { key: "3d", label: "3d", amount: 3, unit: "day" as const },
      { key: "1w", label: "1w", amount: 7, unit: "day" as const },
      { key: "1m", label: "1m", amount: 30, unit: "day" as const },
      { key: "3m", label: "3m", amount: 90, unit: "day" as const },
    ],
    []
  );

  const [range, setRange] = useState<DateRangeValue>(() => {
    const end = dayjs().utc().endOf("day");
    const start = end.subtract(30, "day").startOf("day");
    return { start: start.toDate(), end: end.toDate(), presetKey: "1m", key: "1m" };
  });
  const [selectedAdmin, setSelectedAdmin] = useState<string | null>(null);
  const [points, setPoints] = useState<DailyUsagePoint[]>([]);
  const [loading, setLoading] = useState(false);
  const selectedService = useMemo(
    () => serviceOptions.find((service) => service.id === selectedServiceId) ?? null,
    [serviceOptions, selectedServiceId]
  );
  const filteredAdmins = useMemo(() => {
    if (!selectedServiceId) return admins;
    const allowedUsernames = new Set(
      serviceAdminUsage
        .map((entry) => entry.username)
        .filter((username): username is string => Boolean(username))
    );
    const filtered = admins.filter((admin) => allowedUsernames.has(admin.username));
    return filtered.length ? filtered : admins;
  }, [admins, selectedServiceId, serviceAdminUsage]);
  const serviceUsageTotal = useMemo(
    () => serviceAdminUsage.reduce((acc, item) => acc + (item.used_traffic || 0), 0),
    [serviceAdminUsage]
  );
  const serviceDonutSeries = useMemo(
    () => serviceAdminUsage.map((item) => item.used_traffic || 0),
    [serviceAdminUsage]
  );
  const serviceDonutLabels = useMemo(
    () => serviceAdminUsage.map((item) => item.username || t("services.unassignedAdmin", "Unassigned")),
    [serviceAdminUsage, t]
  );
  const serviceDonutOptions = useMemo(
    () => buildServiceDonutOptions(colorMode, serviceDonutLabels),
    [colorMode, serviceDonutLabels]
  );

useEffect(() => {
  let cancelled = false;

  const loadServices = async () => {
    try {
      const response = await apiFetch<ServiceListResponse>("/v2/services", {
        query: { limit: 500 },
      });
      if (cancelled || !response) return;
      const list = response.services ?? [];
      setServiceOptions(list);
      setSelectedServiceId((prev) => {
        if (prev !== null) return prev;
        return list.length ? list[0].id : null;
      });
    } catch (error: unknown) {
      if (!cancelled) {
        setServiceOptions([]);
      }
    }
  };

  loadServices();

  return () => {
    cancelled = true;
  };
}, []);

useEffect(() => {
  if (!selectedServiceId) {
    setServiceAdminUsage([]);
    return;
  }
  let cancelled = false;
  setLoadingServiceUsage(true);
  apiFetch<ServiceAdminUsageResponse>(`/v2/services/${selectedServiceId}/usage/admins`, {
    query: {
      start: formatApiStart(range.start),
      end: formatApiEnd(range.end),
    },
  })
    .then((data: ServiceAdminUsageResponse | null) => {
      if (cancelled || !data) return;
      setServiceAdminUsage(data.admins ?? []);
    })
    .catch(() => {
      if (!cancelled) {
        setServiceAdminUsage([]);
      }
    })
    .finally(() => {
      if (!cancelled) setLoadingServiceUsage(false);
    });
  return () => {
    cancelled = true;
  };
}, [selectedServiceId, range.start, range.end]);

// load all admins (not paginated) for the select list
useEffect(() => {
    let cancelled = false;
    const loadAll = async () => {
      try {
        const data = await apiFetch<Admin[] | { admins?: Admin[] }>(`/admins`);
        if (cancelled) return;
        if (Array.isArray(data)) setAdmins(data);
        else setAdmins(data.admins || []);
      } catch (err: unknown) {
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
    const isHourly = dayjs(range.start).isSame(range.end, "day");
    const query: Record<string, string> = {
      start: formatApiStart(range.start),
      end: formatApiEnd(range.end),
    };
    if (isHourly) {
      query.granularity = "hour";
    }
    const endpoint = isHourly ? "chart" : "daily";
    console.debug("AdminsUsage: fetching usage", { selectedAdmin, endpoint, query });
    apiFetch<AdminUsageApiResponse>(`/admin/${encodeURIComponent(selectedAdmin)}/usage/${endpoint}`, { query })
      .then((data: AdminUsageApiResponse | null) => {
        if (cancelled) return;
        const usages = Array.isArray(data?.usages) ? data.usages : [];
        console.debug("AdminsUsage: response usages", { length: usages.length, endpoint });
        let mapped: DailyUsagePoint[];
        if (isHourly) {
          const aggregated = new Map<string, number>();
          usages.forEach((entry) => {
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
          const dailyPoints = usages.map((entry): DailyUsagePoint => ({
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
      .catch((err: unknown) => {
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
  if (!filteredAdmins || filteredAdmins.length === 0) return;
  const hasSelected = filteredAdmins.some((admin) => admin.username === selectedAdmin);
  if (!hasSelected) {
    setSelectedAdmin(filteredAdmins[0].username);
  }
}, [filteredAdmins, selectedAdmin]);

  const categories = useMemo(() => points.map((p) => formatTimeseriesLabel(p.date)), [points]);
  const series = useMemo(() => [{ name: t("nodes.usedTrafficSeries", "Used traffic"), data: points.map((p) => p.used_traffic) }], [points, t]);

  const chartConfig = useMemo(
    () => ({ options: buildDailyUsageOptions(colorMode, categories) as any, series }),
    [colorMode, categories, series]
  );

  const total = useMemo(() => points.reduce((sum, p) => sum + Number(p.used_traffic || 0), 0), [points]);
  
  const dateRangePresets = useMemo(
    () => presets.map((p) => ({
      key: p.key,
      label: p.label,
      amount: p.amount,
      unit: (p.unit === "hour" ? "hour" : "day") as "hour" | "day" | "week" | "month",
    })),
    []
  );
  
  const handleRangeChange = (value: DateRangeValue) => {
    setRange(value);
  };

  return (
    <VStack spacing={4} align="stretch">
      <ChartBox
        title={t("admins.serviceUsageTitle", "Service usage distribution")}
        headerActions={
          <Stack direction={{ base: "column", sm: "row" }} spacing={3} align={{ base: "stretch", sm: "center" }}>
            <Select
              value={selectedServiceId ?? ""}
              onChange={(event) => {
                const value = Number(event.target.value);
                setSelectedServiceId(Number.isNaN(value) ? null : value);
              }}
              minW={{ sm: "220px" }}
              placeholder={t("admins.selectService", "Select service")}
              isDisabled={!serviceOptions.length}
            >
              {serviceOptions.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </Select>
            <HStack fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }}>
              <InfoIcon />
              <Text>
                {t("services.totalUsage", "Total")}:{" "}
                <chakra.span fontWeight="medium">{formatBytes(serviceUsageTotal, 2)}</chakra.span>
              </Text>
            </HStack>
          </Stack>
        }
      >
        <Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }} mb={4}>
          {t("admins.serviceUsageHint", "Pick a service to see how its usage is split between admins.")}
        </Text>
        <Stack
          mt={6}
          direction={{ base: "column", lg: "row" }}
          spacing={{ base: 4, lg: 6 }}
          align={{ base: "stretch", lg: "center" }}
        >
          <Box flex="1">
            {loadingServiceUsage ? (
              <VStack spacing={3} py={8}>
                <Spinner />
                <Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }}>
                  {t("loading")}
                </Text>
              </VStack>
            ) : serviceAdminUsage.length && serviceUsageTotal > 0 ? (
              <ReactApexChart type="donut" height={320} options={serviceDonutOptions} series={serviceDonutSeries} />
            ) : (
              <Text textAlign="center" color="gray.500" _dark={{ color: "gray.400" }}>
                {t("noData")}
              </Text>
            )}
          </Box>
          <VStack flex="1" align="stretch" spacing={2}>
            {serviceAdminUsage.length ? (
              serviceAdminUsage.map((item) => {
                const username = item.username || t("services.unassignedAdmin", "Unassigned");
                const isSelectable = Boolean(item.username);
                const isActive = selectedAdmin === item.username && isSelectable;
                return (
                  <Button
                    key={`${item.admin_id ?? "na"}-${username}`}
                    size="sm"
                    variant={isActive ? "solid" : "outline"}
                    colorScheme="primary"
                    justifyContent="space-between"
                    onClick={() => {
                      if (isSelectable && item.username) {
                        setSelectedAdmin(item.username);
                      }
                    }}
                    isDisabled={!isSelectable}
                  >
                    <HStack justify="space-between" w="full">
                      <Text>{username}</Text>
                      <Text fontSize="sm" color="gray.500" _dark={{ color: "gray.300" }}>
                        {formatBytes(item.used_traffic || 0, 2)}
                      </Text>
                    </HStack>
                  </Button>
                );
              })
            ) : (
              <Text color="gray.500" _dark={{ color: "gray.400" }}>
                {t("noData")}
              </Text>
            )}
          </VStack>
        </Stack>
      </ChartBox>
      <ChartBox
        title={
          <HStack spacing={2} align="center">
            <Text fontWeight="semibold">{t("admins.dailyUsage", "Daily usage")}</Text>
            <Tooltip label={t("admins.dailyUsageTooltip", "Total data usage per day for the selected admin and time range")}>
              <InfoIcon color="gray.500" _dark={{ color: "gray.400" }} aria-label="info" cursor="help" />
            </Tooltip>
          </HStack>
        }
        headerActions={
          <Stack
            direction={{ base: "column", md: "row" }}
            spacing={{ base: 3, md: 4 }}
            alignItems={{ base: "stretch", md: "center" }}
            justifyContent="flex-end"
            w="full"
          >
            <DateRangePicker
              value={range}
              onChange={handleRangeChange}
              presets={dateRangePresets}
              defaultPreset="1m"
            />
            <Select
              value={selectedAdmin ?? ""}
              onChange={(e) => setSelectedAdmin(e.target.value || null)}
              w={{ base: "full", sm: "auto", md: "220px" }}
              minW={{ md: "200px" }}
              isDisabled={!filteredAdmins.length}
            >
              {filteredAdmins.map((a: any) => (
                <option key={a.username} value={a.username}>
                  {a.username}
                </option>
              ))}
            </Select>
          </Stack>
        }
      >
        <VStack align="start" spacing={1} mb={4}>
          <Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }}>
            {t("admins.selectedAdmin", "Admin")}:{" "}
            <chakra.span fontWeight="medium">{selectedAdmin ?? "-"}</chakra.span>{" "}
            {t("nodes.totalLabel", "Total")}:{" "}
            <chakra.span fontWeight="medium">{formatBytes(total || 0, 2)}</chakra.span>
          </Text>
        </VStack>
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
      </ChartBox>
    </VStack>
  );
};

export default AdminsUsage;
