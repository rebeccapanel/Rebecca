import {
  Badge,
  Box,
  BoxProps,
  Button,
  Card,
  chakra,
  Flex,
  HStack,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  SimpleGrid,
  Stack,
  Tag,
  Text,
  useColorMode,
  useColorModeValue,
  VStack,
  Wrap,
  WrapItem,
} from "@chakra-ui/react";
import { ChartBarIcon } from "@heroicons/react/24/outline";
import { useDashboard } from "contexts/DashboardContext";
import useGetUser from "hooks/useGetUser";
import { TFunction } from "i18next";
import { FC, ReactNode, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "react-query";
import Chart from "react-apexcharts";
import { fetch } from "service/http";
import { formatBytes, numberWithCommas } from "utils/formatByte";
import { formatDuration } from "utils/formatDuration";
import { SystemStats } from "types/System";

export const StatisticsQueryKey = "statistics-query-key";
import { AdminRole } from "types/Admin";

const iconProps = {
  baseStyle: {
    w: 5,
    h: 5,
    position: "relative",
    zIndex: "2",
  },
};

const ChartIcon = chakra(ChartBarIcon, iconProps);

const formatNumberValue = (value: number) => numberWithCommas(value) ?? value.toString();
const normalizeVersion = (value?: string | null) => {
  if (!value) return "";
  // Remove leading 'v' or 'vv', remove '-alpha', '-beta', '-rc' etc. suffixes, and trim
  return value.trim().replace(/^v+/i, "").split(/[-_]/)[0].trim();
};

const HISTORY_INTERVALS = [
  { labelKey: "historyInterval.2m", seconds: 120 },
  { labelKey: "historyInterval.10m", seconds: 600 },
  { labelKey: "historyInterval.30m", seconds: 1800 },
  { labelKey: "historyInterval.1h", seconds: 3600 },
  { labelKey: "historyInterval.3h", seconds: 10800 },
  { labelKey: "historyInterval.5h", seconds: 18000 },
];

type CpuMemoryHistoryPayload = {
  type: "cpu" | "memory";
  title: string;
  metricLabel: string;
  entries: SystemStats["cpu_history"];
};

type NetworkHistoryPayload = {
  type: "network";
  title: string;
  entries: SystemStats["network_history"];
};

type PanelHistoryPayload = {
  type: "panel";
  title: string;
  cpuEntries: SystemStats["panel_cpu_history"];
  memoryEntries: SystemStats["panel_memory_history"];
};

type HistoryModalPayload =
  | CpuMemoryHistoryPayload
  | NetworkHistoryPayload
  | PanelHistoryPayload;

const HistoryModal: FC<{
  isOpen: boolean;
  onClose: () => void;
  payload: HistoryModalPayload | null;
  intervalSeconds: number;
  onIntervalChange: (value: number) => void;
  t: TFunction;
}> = ({ isOpen, onClose, payload, intervalSeconds, onIntervalChange, t }) => {
  const { colorMode } = useColorMode();
  const nowSeconds = Math.floor(Date.now() / 1000);
  const cutoff = nowSeconds - intervalSeconds;
  const filteredStandardEntries = useMemo(() => {
    if (!payload || payload.type === "network" || payload.type === "panel") {
      return [];
    }
    return payload.entries.filter((entry) => entry.timestamp >= cutoff);
  }, [payload, cutoff]);

  const filteredNetworkEntries = useMemo(() => {
    if (!payload || payload.type !== "network") {
      return [];
    }
    return payload.entries.filter((entry) => entry.timestamp >= cutoff);
  }, [payload, cutoff]);

  const filteredPanelCpu = useMemo(() => {
    if (!payload || payload.type !== "panel") return [];
    return payload.cpuEntries.filter((entry) => entry.timestamp >= cutoff);
  }, [payload, cutoff]);

  const filteredPanelMemory = useMemo(() => {
    if (!payload || payload.type !== "panel") return [];
    return payload.memoryEntries.filter((entry) => entry.timestamp >= cutoff);
  }, [payload, cutoff]);

  const chartSeries = useMemo(() => {
    if (!payload) {
      return [];
    }
    if (payload.type === "network") {
      return [
        {
          name: t("networkIncoming"),
          data: filteredNetworkEntries.map((entry) => [
            entry.timestamp * 1000,
            entry.incoming,
          ]),
        },
        {
          name: t("networkOutgoing"),
          data: filteredNetworkEntries.map((entry) => [
            entry.timestamp * 1000,
            entry.outgoing,
          ]),
        },
      ];
    }
    if (payload.type === "panel") {
      return [
        {
          name: t("cpuUsage"),
          data: filteredPanelCpu.map((entry) => [
            entry.timestamp * 1000,
            entry.value,
          ]),
        },
        {
          name: t("memoryUsage"),
          data: filteredPanelMemory.map((entry) => [
            entry.timestamp * 1000,
            entry.value,
          ]),
        },
      ];
    }
    return [
      {
        name: payload.metricLabel,
        data: filteredStandardEntries.map((entry) => [
          entry.timestamp * 1000,
          entry.value,
        ]),
      },
    ];
  }, [
    filteredStandardEntries,
    filteredNetworkEntries,
    filteredPanelCpu,
    filteredPanelMemory,
    payload,
    t,
  ]);

  const options = useMemo(
    () => ({
      chart: {
        type: "line" as const,
        animations: { enabled: false },
        toolbar: { show: false },
        zoom: { enabled: false },
        background: "transparent",
      },
      theme: { mode: colorMode },
      stroke: { curve: "smooth" as const },
      xaxis: {
        type: "datetime" as const,
        labels: {
          datetimeFormatter: { hour: "HH:mm" },
        },
      },
      yaxis: {
        decimalsInFloat: 0,
      },
      tooltip: {
        x: { format: "HH:mm:ss" },
      },
    }),
    [colorMode]
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="xl" scrollBehavior="inside">
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>
          {t("historyModalTitle", { metric: payload?.title ?? "" })}
        </ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <Stack spacing={3}>
            <Flex wrap="wrap" gap={2}>
              {HISTORY_INTERVALS.map((interval) => (
                <Button
                  key={interval.seconds}
                  size="sm"
                  variant={intervalSeconds === interval.seconds ? "solid" : "outline"}
                  onClick={() => onIntervalChange(interval.seconds)}
                >
                  {t(interval.labelKey)}
                </Button>
              ))}
            </Flex>
            <Chart
              options={options}
              series={chartSeries}
              type="line"
              height={300}
            />
          </Stack>
        </ModalBody>
        <ModalFooter>
          <Button onClick={onClose}>{t("close")}</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

const HistorySparkline: FC<{ values: number[]; accent?: string }> = ({
  values,
  accent,
}) => {
  const defaultColor = useColorModeValue("gray.600", "gray.300");
  const normalized = values.length ? values : [0];
  const maxValue = Math.max(...normalized, 1);
  
  return (
    <HStack alignItems="flex-end" spacing="2px" mt={2} minH="42px" w="full" overflow="hidden">
      {normalized.map((value, index) => {
        const heightPct = maxValue > 0 ? (value / maxValue) * 100 : 0;
        const height = Math.max(4, Math.round((heightPct / 100) * 40));
        return (
          <Box
            key={index}
            flex="0 1 4px"
            minW="2px"
            maxW="4px"
            h={`${height}px`}
            bg={accent ?? defaultColor}
            borderRadius="1px"
            transition="all 0.2s"
          />
        );
      })}
    </HStack>
  );
};

const HistoryPreview: FC<{
  label: string;
  value: string;
  history: number[];
  accent?: string;
  onOpen?: () => void;
  actionLabel: string;
}> = ({ label, value, history, accent, onOpen, actionLabel }) => (
  <Stack spacing={1}>
    <HStack justifyContent="space-between" alignItems="center">
      <Box>
        <Text fontSize="xs" color="gray.500">
          {label}
        </Text>
        <Text fontSize="lg" fontWeight="semibold">
          {value}
        </Text>
      </Box>
      {onOpen && (
        <Button size="xs" variant="ghost" onClick={onOpen}>
          {actionLabel}
        </Button>
      )}
    </HStack>
    <HistorySparkline values={history} accent={accent} />
  </Stack>
);

const MetricBadge: FC<{ label: string; value: string; colorScheme?: string }> = ({
  label,
  value,
  colorScheme = "gray",
}) => {
  const borderColor = useColorModeValue("gray.200", "gray.700");
  const bg = useColorModeValue("white", "gray.900");
  const valueColor = useColorModeValue(
    colorScheme === "gray" ? "gray.800" : `${colorScheme}.600`,
    colorScheme === "gray" ? "gray.100" : `${colorScheme}.300`
  );

  return (
    <Box
      px={3}
      py={2}
      borderRadius="md"
      borderWidth="1px"
      borderColor={borderColor}
      bg={bg}
      _dark={{ bg: "gray.800", borderColor: "gray.700" }}
    >
      <Text fontSize="xs" color="gray.500">
        {label}
      </Text>
      <Text fontWeight="semibold" color={valueColor}>
        {value}
      </Text>
    </Box>
  );
};

const SystemOverviewCard: FC<{
  data: SystemStats;
  t: TFunction;
  onOpenHistory: (payload: HistoryModalPayload) => void;
}> = ({ data, t, onOpenHistory }) => {
  const cpuHistoryValues = data.cpu_history.map((entry) => entry.value);
  const memoryHistoryValues = data.memory_history.map((entry) => entry.value);
  const networkHistoryValues = data.network_history.map((entry) => entry.incoming);
  const latestPanelRelease = useQuery({
    queryKey: ["panel-latest-release"],
    queryFn: async () => {
      const response = await window.fetch(
        "https://api.github.com/repos/rebeccapanel/Rebecca/releases/latest",
        { headers: { Accept: "application/vnd.github+json" } }
      );
      if (!response.ok) throw new Error("Failed to load latest panel release");
      return response.json();
    },
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  const latestPanelVersion =
    latestPanelRelease.data?.tag_name || latestPanelRelease.data?.name || "";
  const isPanelUpdateAvailable =
    normalizeVersion(latestPanelVersion) &&
    normalizeVersion(data.version) &&
    normalizeVersion(latestPanelVersion) !== normalizeVersion(data.version);
  return (
    <Card p={5} borderRadius="12px" boxShadow="none">
      <Stack spacing={4}>
        <Stack
          direction={{ base: "column", md: "row" }}
          spacing={{ base: 2, md: 4 }}
          justifyContent="space-between"
          align={{ base: "flex-start", md: "center" }}
        >
          <Text fontSize="lg" fontWeight="semibold">
            {t("systemOverview")}
          </Text>
          <Wrap spacing={2} justify={{ base: "flex-start", md: "flex-end" }}>
            <WrapItem>
              <Tag colorScheme="gray">v{data.version}</Tag>
            </WrapItem>
            {latestPanelVersion && (
              <WrapItem>
                <Tag colorScheme={isPanelUpdateAvailable ? "green" : "blue"}>
                  {isPanelUpdateAvailable
                    ? t("system.updateAvailable", {
                        version: latestPanelVersion,
                      })
                    : t("system.latestRelease", {
                        version: latestPanelVersion,
                      })}
                </Tag>
              </WrapItem>
            )}
            <WrapItem>
              <Tag colorScheme="gray">
                {t("loadAverage")}: {" "}
                {data.load_avg.length
                  ? data.load_avg.map((value) => value.toFixed(2)).join(" | ")
                  : "-"}
              </Tag>
            </WrapItem>
          </Wrap>
        </Stack>
        <SimpleGrid columns={{ base: 1, md: 3 }} gap={4}>
          <HistoryPreview
            label={t("cpuUsage")}
            value={`${data.cpu_usage.toFixed(1)}%`}
            history={cpuHistoryValues}
            actionLabel={t("viewHistory")}
            onOpen={() =>
              onOpenHistory({
                type: "cpu",
                title: t("cpuUsage"),
                metricLabel: t("cpuUsage"),
                entries: data.cpu_history,
              })
            }
          />
          <HistoryPreview
            label={t("memoryUsage")}
            value={`${data.memory.percent.toFixed(1)}%`}
            history={memoryHistoryValues}
            actionLabel={t("viewHistory")}
            onOpen={() =>
              onOpenHistory({
                type: "memory",
                title: t("memoryUsage"),
                metricLabel: t("memoryUsage"),
                entries: data.memory_history,
              })
            }
          />
          <HistoryPreview
            label={t("networkHistory")}
            value={`${formatBytes(data.incoming_bandwidth_speed)}/s`}
            history={networkHistoryValues}
            actionLabel={t("viewHistory")}
            onOpen={() =>
              onOpenHistory({
                type: "network",
                title: t("networkHistory"),
                entries: data.network_history,
              })
            }
          />
        </SimpleGrid>
        <SimpleGrid columns={{ base: 1, md: 2 }} gap={4}>
          <MetricBadge
            label={t("incomingSpeed")}
            value={`${formatBytes(data.incoming_bandwidth_speed)}/s`}
            colorScheme="green"
          />
          <MetricBadge
            label={t("outgoingSpeed")}
            value={`${formatBytes(data.outgoing_bandwidth_speed)}/s`}
            colorScheme="blue"
          />
        </SimpleGrid>
        <SimpleGrid columns={{ base: 1, md: 3 }} gap={4}>
          <MetricBadge
            label={t("memoryUsage")}
            value={`${formatBytes(data.memory.current)} / ${formatBytes(data.memory.total)}`}
          />
          <MetricBadge
            label={t("swapUsage")}
            value={`${formatBytes(data.swap.current)} / ${formatBytes(data.swap.total)}`}
          />
          <MetricBadge
            label={t("diskUsage")}
            value={`${formatBytes(data.disk.current)} / ${formatBytes(data.disk.total)}`}
          />
        </SimpleGrid>
        <Stack
          direction={{ base: "column", md: "row" }}
          spacing={2}
          flexWrap="wrap"
          alignItems="flex-start"
        >
          <Tag colorScheme="green">
            {t("systemUptime")}: {formatDuration(data.uptime_seconds)}
          </Tag>
          <Tag colorScheme="blue">
            {t("panelUptime")}: {formatDuration(data.panel_uptime_seconds)}
          </Tag>
          <Tag colorScheme="orange">
            {t("xrayUptime")}: {formatDuration(data.xray_uptime_seconds)}
          </Tag>
        </Stack>
        {data.last_xray_error && !data.xray_running && (
          <Box
            mt={4}
            p={4}
            borderRadius="md"
            bg="red.50"
            borderWidth="1px"
            borderColor="red.200"
            _dark={{
              bg: "rgba(239, 68, 68, 0.1)",
              borderColor: "red.800",
            }}
          >
            <HStack spacing={2} mb={2} alignItems="center">
              <Text fontSize="sm" fontWeight="semibold" color="red.600" _dark={{ color: "red.400" }}>
                {t("coreError", "Core Error")}:
              </Text>
            </HStack>
            <Text
              fontSize="sm"
              color="red.700"
              fontFamily="mono"
              whiteSpace="pre-wrap"
              wordBreak="break-word"
              _dark={{ color: "red.300" }}
            >
              {data.last_xray_error}
            </Text>
          </Box>
        )}
      </Stack>
    </Card>
  );
};

const PanelOverviewCard: FC<{
  data: SystemStats;
  t: TFunction;
  onOpenHistory: (payload: HistoryModalPayload) => void;
}> = ({ data, t, onOpenHistory }) => {
  const panelCpuHistory = data.panel_cpu_history.map((entry) => entry.value);
  const panelMemoryHistory = data.panel_memory_history.map((entry) => entry.value);
  return (
    <Card p={5} borderRadius="12px" boxShadow="none">
      <Stack spacing={4}>
        <HStack justifyContent="space-between" alignItems="center">
          <Text fontSize="lg" fontWeight="semibold">
            {t("panelUsage")}
          </Text>
          <Badge colorScheme={data.xray_running ? "green" : "red"}>
            {data.xray_running ? t("status.running") : t("status.stopped")}
          </Badge>
        </HStack>
        <SimpleGrid columns={{ base: 1, md: 2 }} gap={4}>
          <HistoryPreview
            label={t("cpuUsage")}
            value={`${data.panel_cpu_percent.toFixed(1)}%`}
            history={panelCpuHistory}
            actionLabel={t("viewHistory")}
            onOpen={() =>
              onOpenHistory({
                type: "panel",
                title: t("panelUsage"),
                cpuEntries: data.panel_cpu_history,
                memoryEntries: data.panel_memory_history,
              })
            }
          />
          <HistoryPreview
            label={t("memoryUsage")}
            value={`${data.panel_memory_percent.toFixed(1)}%`}
            history={panelMemoryHistory}
            actionLabel={t("viewHistory")}
            onOpen={() =>
              onOpenHistory({
                type: "panel",
                title: t("panelUsage"),
                cpuEntries: data.panel_cpu_history,
                memoryEntries: data.panel_memory_history,
              })
            }
          />
        </SimpleGrid>
        <SimpleGrid columns={{ base: 1, md: 3 }} gap={4}>
          <MetricBadge
            label={t("threads")}
            value={formatNumberValue(data.app_threads)}
            colorScheme="purple"
          />
          <MetricBadge
            label={t("appMemory")}
            value={formatBytes(data.app_memory)}
            colorScheme="blue"
          />
        </SimpleGrid>
      </Stack>
    </Card>
  );
};

const UsersUsageCard: FC<{ value: number; t: TFunction }> = ({ value, t }) => {
  const borderColor = useColorModeValue("gray.200", "gray.700");
  const bg = useColorModeValue("gray.50", "gray.900");
  const iconBg = useColorModeValue("primary.100", "primary.900");
  const iconColor = useColorModeValue("primary.500", "primary.200");
  return (
    <Box borderWidth="1px" borderColor={borderColor} borderRadius="md" bg={bg} p={4}>
      <HStack justifyContent="space-between" alignItems="center">
        <HStack alignItems="center" spacing={3}>
          <Box p={2} borderRadius="md" bg={iconBg}>
            <ChartIcon color={iconColor} />
          </Box>
          <Text fontSize="xs" color="gray.500">
            {t("UsersUsage")}
          </Text>
        </HStack>
        <Text fontSize="2xl" fontWeight="semibold">
          {formatBytes(value)}
        </Text>
      </HStack>
    </Box>
  );
};

const UsersOverviewCard: FC<{
  data: SystemStats;
  t: TFunction;
}> = ({ data, t }) => (
  <Card p={5} borderRadius="12px" boxShadow="none">
    <Stack spacing={4}>
      <Text fontSize="lg" fontWeight="semibold">
        {t("usersOverview")}
      </Text>
      <MetricBadge
        label={t("totalUsersLabel")}
        value={formatNumberValue(data.total_user)}
        colorScheme="blue"
      />
      <UsersUsageCard value={data.panel_total_bandwidth} t={t} />
      <SimpleGrid columns={{ base: 1, sm: 2 }} gap={3}>
        <MetricBadge
          label={t("status.active")}
          value={formatNumberValue(data.users_active)}
          colorScheme="green"
        />
        <MetricBadge
          label={t("status.disabled")}
          value={formatNumberValue(data.users_disabled)}
          colorScheme="red"
        />
        <MetricBadge
          label={t("status.expired")}
          value={formatNumberValue(data.users_expired)}
          colorScheme="orange"
        />
        <MetricBadge
          label={t("status.limited")}
          value={formatNumberValue(data.users_limited)}
          colorScheme="yellow"
        />
        <MetricBadge
          label={t("status.on_hold")}
          value={formatNumberValue(data.users_on_hold)}
          colorScheme="purple"
        />
      </SimpleGrid>
    </Stack>
  </Card>
);

const YourUsageCard: FC<{
  data?: SystemStats["personal_usage"];
  t: TFunction;
}> = ({ data, t }) => {
  if (!data) return null;
  return (
    <Card p={5} borderRadius="12px" boxShadow="none">
      <Stack spacing={4}>
        <Text fontSize="lg" fontWeight="semibold">
          {t("yourUsage")}
        </Text>
        <SimpleGrid columns={{ base: 1, md: 2 }} gap={4}>
          <MetricBadge
            label={t("totalUsersLabel")}
            value={formatNumberValue(data.total_users)}
            colorScheme="blue"
          />
          <MetricBadge
            label={t("consumedData")}
            value={formatBytes(data.consumed_bytes)}
            colorScheme="green"
          />
          <MetricBadge
            label={t("builtData")}
            value={formatBytes(data.built_bytes)}
            colorScheme="purple"
          />
          <MetricBadge
            label={t("resetData")}
            value={formatBytes(data.reset_bytes)}
            colorScheme="orange"
          />
        </SimpleGrid>
      </Stack>
    </Card>
  );
};

const AdminOverviewCard: FC<{
  data?: SystemStats["admin_overview"];
  t: TFunction;
}> = ({ data, t }) => {
  if (!data) return null;
  return (
    <Card p={5} borderRadius="12px" boxShadow="none">
      <Stack spacing={4}>
        <Text fontSize="lg" fontWeight="semibold">
          {t("adminOverview")}
        </Text>
        <SimpleGrid columns={{ base: 1, md: 2 }} gap={3}>
          <MetricBadge
            label={t("totalAdmins")}
            value={formatNumberValue(data.total_admins)}
            colorScheme="blue"
          />
          <MetricBadge
            label={t("sudoAdmins")}
            value={formatNumberValue(data.sudo_admins)}
            colorScheme="purple"
          />
          <MetricBadge
            label={t("fullAccessAdmins")}
            value={formatNumberValue(data.full_access_admins)}
            colorScheme="green"
          />
          <MetricBadge
            label={t("standardAdmins")}
            value={formatNumberValue(data.standard_admins)}
            colorScheme="orange"
          />
        </SimpleGrid>
        {data.top_admin_username && (
          <Box>
            <Text fontSize="sm" color="gray.500">
              {t("topAdmin")}:{" "}
              <Text as="span" fontWeight="semibold">
                {data.top_admin_username}
              </Text>
            </Text>
            <Text fontSize="sm" color="gray.500">
              {t("topAdminUsage")}: {formatBytes(data.top_admin_usage)}
            </Text>
          </Box>
        )}
      </Stack>
    </Card>
  );
};

export const Statistics: FC<BoxProps> = (props) => {
  const { version } = useDashboard();
  const { userData } = useGetUser();
  const { t } = useTranslation();
  const { data: systemData } = useQuery<SystemStats>({
    queryKey: "statistics-query-key",
    queryFn: () => fetch("/system"),
    refetchInterval: 3_000,
    onSuccess: ({ version: currentVersion }) => {
      if (version !== currentVersion) useDashboard.setState({ version: currentVersion });
    },
  });
  const [historyPayload, setHistoryPayload] = useState<HistoryModalPayload | null>(null);
  const [historyInterval, setHistoryInterval] = useState(HISTORY_INTERVALS[0].seconds);
  const latestPanelRelease = useQuery({
    queryKey: ["panel-latest-release"],
    queryFn: async () => {
      const response = await window.fetch(
        "https://api.github.com/repos/rebeccapanel/Rebecca/releases/latest",
        { headers: { Accept: "application/vnd.github+json" } }
      );
      if (!response.ok) throw new Error("Failed to load latest panel release");
      return response.json();
    },
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const latestPanelVersion = latestPanelRelease.data?.tag_name || latestPanelRelease.data?.name || "";
  const currentPanelVersion = systemData?.version || version || "";
  const isPanelUpdateAvailable =
    normalizeVersion(latestPanelVersion) &&
    normalizeVersion(currentPanelVersion) &&
    normalizeVersion(latestPanelVersion) !== normalizeVersion(currentPanelVersion);

  const canSeeGlobal =
    userData.role === AdminRole.Sudo || userData.role === AdminRole.FullAccess;

  const openHistory = (payload: HistoryModalPayload) => {
    setHistoryPayload(payload);
  };

  const userCards: ReactNode[] = [];
  if (systemData) {
    userCards.push(
      <UsersOverviewCard
        key="users-overview"
        data={systemData}
        t={t}
      />
    );
  }
  const personalUsageCard =
    systemData?.personal_usage && (
      <YourUsageCard
        key="your-usage"
        data={systemData.personal_usage}
        t={t}
      />
    );
  if (personalUsageCard) {
    userCards.push(personalUsageCard);
  }
  const userGridColumns = userCards.length > 1 ? 2 : 1;

  return (
    <Stack spacing={4} width="full" {...props}>
      {systemData && (
        <>
          <SystemOverviewCard data={systemData} t={t} onOpenHistory={openHistory} />
          <PanelOverviewCard data={systemData} t={t} onOpenHistory={openHistory} />
        </>
      )}
      {userCards.length > 0 && (
        <SimpleGrid columns={{ base: 1, md: userGridColumns }} gap={4}>
          {userCards}
        </SimpleGrid>
      )}
      {canSeeGlobal && systemData && (
        <AdminOverviewCard data={systemData.admin_overview} t={t} />
      )}
      <HistoryModal
        isOpen={Boolean(historyPayload)}
        onClose={() => setHistoryPayload(null)}
        payload={historyPayload}
        intervalSeconds={historyInterval}
        onIntervalChange={setHistoryInterval}
        t={t}
      />
    </Stack>
  );
};
