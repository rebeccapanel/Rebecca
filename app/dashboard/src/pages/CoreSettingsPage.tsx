import {
  Box,
  VStack,
  Text,
  Tabs,
  TabList,
  Tab,
  TabPanels,
  TabPanel,
  Button,
  HStack,
  IconButton,
  useToast,
  Select,
  Switch,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Tag,
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverBody,
  PopoverArrow,
  PopoverCloseButton,
  useDisclosure,
  FormControl,
  FormLabel,
  useColorModeValue,
} from "@chakra-ui/react";
import type { TableProps } from "@chakra-ui/react";
import {
  PlusIcon as AddIcon,
  TrashIcon as DeleteIcon,
  PencilIcon as EditIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  ArrowPathIcon as ReloadIcon,
  ArrowsPointingOutIcon,
  ArrowsPointingInIcon,
  AdjustmentsHorizontalIcon,
  ArrowsRightLeftIcon,
  ArrowUpTrayIcon,
  ScaleIcon,
  GlobeAltIcon,
  WrenchScrewdriverIcon,
  DocumentTextIcon
} from "@heroicons/react/24/outline";
import { chakra } from "@chakra-ui/react";
import { useCoreSettings } from "contexts/CoreSettingsContext";
import { useDashboard } from "contexts/DashboardContext";
import { FC, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { JsonEditor } from "../components/JsonEditor";
import XrayLogsPage from "./XrayLogsPage";
import { Controller, useForm, useWatch } from "react-hook-form";
import { useMutation } from "react-query";
import { OutboundModal } from "../components/OutboundModal";
import { RuleModal } from "../components/RuleModal";
import { BalancerModal } from "../components/BalancerModal";
import { DnsModal } from "../components/DnsModal";
import { FakeDnsModal } from "../components/FakeDnsModal";
import { SizeFormatter, Outbound } from "../utils/outbound";
import { fetch as apiFetch } from "service/http";

const AddIconStyled = chakra(AddIcon, { baseStyle: { w: 3.5, h: 3.5 } });
const DeleteIconStyled = chakra(DeleteIcon, { baseStyle: { w: 4, h: 4 } });
const EditIconStyled = chakra(EditIcon, { baseStyle: { w: 4, h: 4 } });
const ArrowUpIconStyled = chakra(ArrowUpIcon, { baseStyle: { w: 4, h: 4 } });
const ArrowDownIconStyled = chakra(ArrowDownIcon, { baseStyle: { w: 4, h: 4 } });
const ReloadIconStyled = chakra(ReloadIcon, { baseStyle: { w: 4, h: 4 } });
const FullScreenIconStyled = chakra(ArrowsPointingOutIcon, { baseStyle: { w: 4, h: 4 } });
const ExitFullScreenIconStyled = chakra(ArrowsPointingInIcon, { baseStyle: { w: 4, h: 4 } });
const BasicTabIcon = chakra(AdjustmentsHorizontalIcon, { baseStyle: { w: 4, h: 4 } });
const RoutingTabIcon = chakra(ArrowsRightLeftIcon, { baseStyle: { w: 4, h: 4 } });
const OutboundTabIcon = chakra(ArrowUpTrayIcon, { baseStyle: { w: 4, h: 4 } });
const BalancerTabIcon = chakra(ScaleIcon, { baseStyle: { w: 4, h: 4 } });
const DnsTabIcon = chakra(GlobeAltIcon, { baseStyle: { w: 4, h: 4 } });
const AdvancedTabIcon = chakra(WrenchScrewdriverIcon, { baseStyle: { w: 4, h: 4 } });
const LogsTabIcon = chakra(DocumentTextIcon, { baseStyle: { w: 4, h: 4 } });
const compactActionButtonProps = {
  colorScheme: "primary",
  size: "xs" as const,
  variant: "solid" as const,
  fontSize: "xs",
  px: 3,
  h: 7
};

const serializeConfig = (value: any) => JSON.stringify(value ?? {});

const SettingsSection: FC<{ title: string; children: ReactNode }> = ({ title, children }) => {
  const headerBg = useColorModeValue("gray.50", "whiteAlpha.100");
  const borderColor = useColorModeValue("gray.200", "whiteAlpha.300");
  return (
    <Box borderWidth="1px" borderColor={borderColor} borderRadius="lg" overflow="hidden">
      <Box bg={headerBg} px={4} py={2}>
        <Text fontWeight="semibold">{title}</Text>
      </Box>
      <Table variant="simple" size="sm">
        <Tbody>{children}</Tbody>
      </Table>
    </Box>
  );
};

const SettingRow: FC<{ label: string; controlId: string; children: (controlId: string) => ReactNode }> = ({
  label,
  controlId,
  children,
}) => {
  const labelColor = useColorModeValue("gray.700", "whiteAlpha.800");
  return (
    <Tr>
      <Td width="40%" py={3} pr={4}>
        <FormLabel htmlFor={controlId} mb="0" color={labelColor}>
          {label}
        </FormLabel>
      </Td>
      <Td py={3}>
        <FormControl id={controlId} display="flex" alignItems="center" gap={4}>
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
    <Box borderWidth="1px" borderColor={borderColor} borderRadius="xl" bg={bg} boxShadow={shadow} overflow="hidden">
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
  const { fetchCoreSettings, updateConfig, isLoading, config, isPostLoading, restartCore } = useCoreSettings();
  const { onEditingCore } = useDashboard();
  const toast = useToast();
  const { isOpen: isOutboundOpen, onOpen: onOutboundOpen, onClose: onOutboundClose } = useDisclosure();
  const { isOpen: isRuleOpen, onOpen: onRuleOpen, onClose: onRuleClose } = useDisclosure();
  const { isOpen: isBalancerOpen, onOpen: onBalancerOpen, onClose: onBalancerClose } = useDisclosure();
  const { isOpen: isDnsOpen, onOpen: onDnsOpen, onClose: onDnsClose } = useDisclosure();
  const { isOpen: isFakeDnsOpen, onOpen: onFakeDnsOpen, onClose: onFakeDnsClose } = useDisclosure();

  const form = useForm({
    defaultValues: { config: config || { outbounds: [], routing: { rules: [], balancers: [] }, dns: { servers: [] } } },
  });
  const initialConfigStringRef = useRef(serializeConfig(form.getValues("config")));
  const watchedConfig = useWatch({ control: form.control, name: "config" });
  const hasConfigChanges = useMemo(
    () => serializeConfig(watchedConfig) !== initialConfigStringRef.current,
    [watchedConfig]
  );

  const [outboundData, setOutboundData] = useState<any[]>([]);
  const [routingRuleData, setRoutingRuleData] = useState<any[]>([]);
  const [balancersData, setBalancersData] = useState<any[]>([]);
  const [dnsServers, setDnsServers] = useState<any[]>([]);
  const [fakeDns, setFakeDns] = useState<any[]>([]);
  const [outboundsTraffic, setOutboundsTraffic] = useState<any[]>([]);
  const [isFullScreen, setIsFullScreen] = useState(false);

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
    onEditingCore(true);
    fetchCoreSettings().then(() => {
      console.log("Core settings fetched successfully");
    }).catch((error) => {
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
  }, [fetchCoreSettings, onEditingCore, toast, t]);

  useEffect(() => {
    if (config) {
      form.reset({ config });
      initialConfigStringRef.current = serializeConfig(config);
      setOutboundData(config?.outbounds?.map((o: any, index: number) => ({ key: index, ...o })) || []);
      setRoutingRuleData(
        config?.routing?.rules?.map((r: any, index: number) => ({
          key: index,
          ...r,
          domain: r.domain?.join(","),
          ip: r.ip?.join(","),
          source: r.source?.join(","),
          network: Array.isArray(r.network) ? r.network.join(",") : r.network,
          user: r.user?.join(","),
          inboundTag: r.inboundTag?.join(","),
          protocol: r.protocol?.join(","),
          attrs: JSON.stringify(r.attrs, null, 2),
        })) || []
      );
      setBalancersData(
        config?.routing?.balancers?.map((b: any, index: number) => ({
          key: index,
          tag: b.tag || "",
          strategy: b.strategy?.type || "random",
          selector: b.selector || [],
          fallbackTag: b.fallbackTag || "",
        })) || []
      );
      setDnsServers(config?.dns?.servers || []);
      setFakeDns(config?.fakedns || []);
    }
  }, [config, form]);

  const { mutate: handleRestartCore, isLoading: isRestarting } = useMutation(restartCore, {
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
  });

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
          message = e.response._data.detail[Object.keys(e.response._data.detail)[0]];
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
    const response = await apiFetch<{ success: boolean; obj: any }>("/panel/xray/getOutboundsTraffic");
    if (response?.success) {
      setOutboundsTraffic(response.obj);
    }
  };

  const resetOutboundTraffic = async (index: number) => {
    const tag = index >= 0 ? outboundData[index].tag : "-alltags-";
    const response = await apiFetch<{ success: boolean }>("/panel/xray/resetOutboundsTraffic", {
      method: "POST",
      body: { tag },
    });
    if (response?.success) {
      await fetchOutboundsTraffic();
    }
  };

  const addOutbound = () => {
    onOutboundOpen();
  };

  const editOutbound = (index: number) => {
    onOutboundOpen();
  };

  const deleteOutbound = (index: number) => {
    const newOutbounds = [...outboundData];
    newOutbounds.splice(index, 1);
    form.setValue("config.outbounds", newOutbounds, { shouldDirty: true });
    setOutboundData(newOutbounds);
  };

  const setFirstOutbound = (index: number) => {
    const newOutbounds = [...outboundData];
    newOutbounds.splice(0, 0, newOutbounds.splice(index, 1)[0]);
    form.setValue("config.outbounds", newOutbounds, { shouldDirty: true });
    setOutboundData(newOutbounds);
  };

  const addRule = () => {
    onRuleOpen();
  };

  const editRule = (index: number) => {
    onRuleOpen();
  };

  const deleteRule = (index: number) => {
    const newRules = [...routingRuleData];
    newRules.splice(index, 1);
    form.setValue("config.routing.rules", newRules, { shouldDirty: true });
    setRoutingRuleData(newRules);
  };

  const replaceRule = (oldIndex: number, newIndex: number) => {
    const newRules = [...routingRuleData];
    newRules.splice(newIndex, 0, newRules.splice(oldIndex, 1)[0]);
    form.setValue("config.routing.rules", newRules, { shouldDirty: true });
    setRoutingRuleData(newRules);
  };

  const addBalancer = () => {
    onBalancerOpen();
  };

  const editBalancer = (index: number) => {
    onBalancerOpen();
  };

  const deleteBalancer = (index: number) => {
    const newBalancers = [...balancersData];
    const removedBalancer = newBalancers.splice(index, 1)[0];
    form.setValue("config.routing.balancers", newBalancers, { shouldDirty: true });
    setBalancersData(newBalancers);
    const newConfig = { ...form.getValues("config") };
    if (newConfig.observatory) {
      newConfig.observatory.subjectSelector = newConfig.observatory.subjectSelector.filter(
        (s: string) => s !== removedBalancer.tag
      );
    }
    if (newConfig.burstObservatory) {
      newConfig.burstObservatory.subjectSelector = newConfig.burstObservatory.subjectSelector.filter(
        (s: string) => s !== removedBalancer.tag
      );
    }
    form.setValue("config", newConfig, { shouldDirty: true });
  };

  const addDnsServer = () => {
    onDnsOpen();
  };

  const editDnsServer = (index: number) => {
    onDnsOpen();
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

  const editFakeDns = (index: number) => {
    onFakeDnsOpen();
  };

  const deleteFakeDns = (index: number) => {
    const newFakeDns = [...fakeDns];
    newFakeDns.splice(index, 1);
    form.setValue("config.fakedns", newFakeDns.length > 0 ? newFakeDns : null, { shouldDirty: true });
    setFakeDns(newFakeDns);
  };

  const findOutboundAddress = (outbound: any) => {
    switch (outbound.protocol) {
      case "vmess":
      case "vless":
        return outbound.settings.vnext?.map((obj: any) => `${obj.address}:${obj.port}`) || [];
      case "http":
      case "socks":
      case "shadowsocks":
      case "trojan":
        return outbound.settings.servers?.map((obj: any) => `${obj.address}:${obj.port}`) || [];
      case "dns":
        return [`${outbound.settings?.address}:${outbound.settings?.port}`];
      case "wireguard":
        return outbound.settings.peers?.map((peer: any) => peer.endpoint) || [];
      default:
        return [];
    }
  };

  const findOutboundTraffic = (outbound: any) => {
    const traffic = outboundsTraffic.find((t) => t.tag === outbound.tag);
    return traffic
      ? `${SizeFormatter.sizeFormat(traffic.up)} / ${SizeFormatter.sizeFormat(traffic.down)}`
      : `${SizeFormatter.sizeFormat(0)} / ${SizeFormatter.sizeFormat(0)}`;
  };

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => {
        setIsFullScreen(true);
      }).catch((err) => {
        console.error("Error entering fullscreen:", err);
      });
    } else {
      document.exitFullscreen().then(() => {
        setIsFullScreen(false);
      }).catch((err) => {
        console.error("Error exiting fullscreen:", err);
      });
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
    return (
      <Box display="flex" flexWrap="wrap" gap="1">
        {chips.map((chip, idx) => (
          <Tag key={`${chip}-${idx}`} colorScheme={colorScheme} size="sm">
            {chip}
          </Tag>
        ))}
      </Box>
    );
  };

  const renderTextValue = (value: unknown) => {
    if (value === undefined || value === null || value === "" || (typeof value === "string" && !value.trim())) {
      return <Text color="gray.400">-</Text>;
    }
    return <Text>{typeof value === "string" ? value : String(value)}</Text>;
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
    } catch (error) {
      // fall back to raw string rendering below
    }
    return (
      <Text fontFamily="mono" fontSize="xs" whiteSpace="pre-wrap">
        {attrsValue}
      </Text>
    );
  };

  return (
    <VStack spacing={6} align="stretch">
      <Text as="h1" fontWeight="semibold" fontSize="2xl">
        {t("header.coreSettings")}
      </Text>
      <Text color="gray.600" _dark={{ color: "gray.300" }} fontSize="sm">
        {t("pages.xray.coreDescription")}
      </Text>
      <HStack justifyContent="space-between">
        <HStack>
          <Button
            size="sm"
            colorScheme="primary"
            isLoading={isPostLoading}
            isDisabled={!hasConfigChanges || isPostLoading}
            onClick={handleOnSave}
          >
            {t("core.save")}
          </Button>
        <Button
          size="sm"
          leftIcon={<ReloadIconStyled />}
          isLoading={isRestarting}
          onClick={() => handleRestartCore()}
        >
          {t(isRestarting ? "core.restarting" : "core.restartCore")}
        </Button>
      </HStack>
    </HStack>
      <Tabs variant="enclosed" colorScheme="primary">
        <TabList>
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
              <SettingsSection title={t("pages.xray.generalConfigs")}>
                <SettingRow label={t("pages.xray.FreedomStrategy")} controlId="freedom-domain-strategy">
                  {(id) => (
                    <Controller
                      name="config.outbounds[0].settings.domainStrategy"
                      control={form.control}
                      render={({ field }) => (
                        <Select {...field} id={id} size="sm" maxW="220px">
                          {["AsIs", "UseIP", "UseIPv4", "UseIPv6", "UseIPv6v4", "UseIPv4v6"].map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </Select>
                      )}
                    />
                  )}
                </SettingRow>
                <SettingRow label={t("pages.xray.RoutingStrategy")} controlId="routing-domain-strategy">
                  {(id) => (
                    <Controller
                      name="config.routing.domainStrategy"
                      control={form.control}
                      render={({ field }) => (
                        <Select {...field} id={id} size="sm" maxW="220px">
                          {["AsIs", "IPIfNonMatch", "IPOnDemand"].map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </Select>
                      )}
                    />
                  )}
                </SettingRow>
              </SettingsSection>
              <SettingsSection title={t("pages.xray.statistics")}>
                <SettingRow label={t("pages.xray.statsInboundUplink")} controlId="stats-inbound-uplink">
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
                <SettingRow label={t("pages.xray.statsInboundDownlink")} controlId="stats-inbound-downlink">
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
                <SettingRow label={t("pages.xray.statsOutboundUplink")} controlId="stats-outbound-uplink">
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
                <SettingRow label={t("pages.xray.statsOutboundDownlink")} controlId="stats-outbound-downlink">
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
                <SettingRow label={t("pages.xray.logLevel")} controlId="log-level">
                  {(id) => (
                    <Controller
                      name="config.log.loglevel"
                      control={form.control}
                      render={({ field }) => (
                        <Select {...field} id={id} size="sm" maxW="220px">
                          {["none", "debug", "info", "warning", "error"].map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </Select>
                      )}
                    />
                  )}
                </SettingRow>
                <SettingRow label={t("pages.xray.accessLog")} controlId="access-log">
                  {(id) => (
                    <Controller
                      name="config.log.access"
                      control={form.control}
                      render={({ field }) => (
                        <Select {...field} id={id} size="sm" maxW="220px">
                          <option value="">Empty</option>
                          {["none", "./access.log"].map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </Select>
                      )}
                    />
                  )}
                </SettingRow>
                <SettingRow label={t("pages.xray.errorLog")} controlId="error-log">
                  {(id) => (
                    <Controller
                      name="config.log.error"
                      control={form.control}
                      render={({ field }) => (
                        <Select {...field} id={id} size="sm" maxW="220px">
                          <option value="">Empty</option>
                          {["none", "./error.log"].map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </Select>
                      )}
                    />
                  )}
                </SettingRow>
                <SettingRow label={t("pages.xray.maskAddress")} controlId="mask-address">
                  {(id) => (
                    <Controller
                      name="config.log.maskAddress"
                      control={form.control}
                      render={({ field }) => (
                        <Select {...field} id={id} size="sm" maxW="220px">
                          <option value="">Empty</option>
                          {["quarter", "half", "full"].map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </Select>
                      )}
                    />
                  )}
                </SettingRow>
                <SettingRow label={t("pages.xray.dnsLog")} controlId="dns-log">
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
          </TabPanel>
          <TabPanel>
            <VStack spacing={4} align="stretch">
              <Button leftIcon={<AddIconStyled />} {...compactActionButtonProps} onClick={addRule}>
                {t("pages.xray.rules.add")}
              </Button>
              <TableCard>
                <TableGrid minW="1100px">
                  <Thead>
                    <Tr>
                      <Th rowSpan={2} w="80px">
                        {t("common.index", { defaultValue: "#" })}
                      </Th>
                      <Th colSpan={2}>{t("pages.xray.rules.sourceGroup", { defaultValue: "Source" })}</Th>
                      <Th colSpan={3}>{t("pages.xray.rules.networkGroup", { defaultValue: "Network" })}</Th>
                      <Th colSpan={3}>{t("pages.xray.rules.destinationGroup", { defaultValue: "Destination" })}</Th>
                      <Th colSpan={2}>{t("pages.xray.rules.inboundGroup", { defaultValue: "Inbound" })}</Th>
                      <Th rowSpan={2}>{t("pages.xray.rules.outbound")}</Th>
                      <Th rowSpan={2}>{t("pages.xray.rules.balancer", { defaultValue: "Balancer" })}</Th>
                      <Th rowSpan={2}>{t("actions", { defaultValue: "Actions" })}</Th>
                    </Tr>
                    <Tr>
                      <Th>{t("IP", { defaultValue: "IP" })}</Th>
                      <Th>{t("port", { defaultValue: "Port" })}</Th>
                      <Th>{t("network", { defaultValue: "Network" })}</Th>
                      <Th>{t("pages.xray.rules.protocol", { defaultValue: "Protocol" })}</Th>
                      <Th>{t("pages.xray.rules.attrs", { defaultValue: "Attrs" })}</Th>
                      <Th>{t("IP", { defaultValue: "IP" })}</Th>
                      <Th>{t("pages.xray.rules.domain", { defaultValue: "Domain" })}</Th>
                      <Th>{t("port", { defaultValue: "Port" })}</Th>
                      <Th>{t("pages.xray.rules.inboundTag", { defaultValue: "Inbound Tag" })}</Th>
                      <Th>{t("pages.xray.rules.user", { defaultValue: "Client" })}</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {routingRuleData.length === 0 && (
                      <Tr>
                        <Td colSpan={14}>
                          <Text textAlign="center" color="gray.500">
                            {t("pages.xray.rules.empty", { defaultValue: "No routing rules defined yet." })}
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
                                isDisabled={index === routingRuleData.length - 1}
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
                <Button leftIcon={<AddIconStyled />} {...compactActionButtonProps} onClick={addOutbound}>
                  {t("pages.xray.outbound.addOutbound")}
                </Button>
                <Button leftIcon={<ReloadIconStyled />} size="xs" variant="ghost" onClick={fetchOutboundsTraffic}>
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
                            aria-label="move to top"
                            icon={<ArrowUpIconStyled />}
                            size="xs"
                            variant="ghost"
                            isDisabled={index === 0}
                            onClick={() => setFirstOutbound(index)}
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
                        {["vmess", "vless", "trojan", "shadowsocks"].includes(outbound.protocol) && (
                          <>
                            <Tag colorScheme="blue">{outbound.streamSettings?.network}</Tag>
                            {outbound.streamSettings?.security === "tls" && (
                              <Tag colorScheme="green">tls</Tag>
                            )}
                            {outbound.streamSettings?.security === "reality" && (
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
                        <Tag colorScheme="green">{findOutboundTraffic(outbound)}</Tag>
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
              <Button leftIcon={<AddIconStyled />} {...compactActionButtonProps} onClick={addBalancer}>
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
                        <Tag colorScheme={balancer.strategy === "random" ? "purple" : "green"}>
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
                          newConfig.dns = { servers: [], queryStrategy: "UseIP", tag: "dns_inbound" };
                        } else {
                          delete newConfig.dns;
                          delete newConfig.fakedns;
                        }
                        form.setValue("config", newConfig, { shouldDirty: true });
                        setDnsServers([]);
                        setFakeDns([]);
                      }}
                    />
                  )}
                />
              </FormControl>
              {dnsServers.length > 0 && (
                <>
                  <Button leftIcon={<AddIconStyled />} {...compactActionButtonProps} onClick={addDnsServer}>
                    {t("pages.xray.dns.add")}
                  </Button>
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
                          <Tr key={index}>
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
                            <Td>{typeof dns === "object" ? dns.address : dns}</Td>
                            <Td>{typeof dns === "object" ? dns.domains?.join(",") : ""}</Td>
                            <Td>{typeof dns === "object" ? dns.expectIPs?.join(",") : ""}</Td>
                          </Tr>
                        ))}
                      </Tbody>
                    </TableGrid>
                  </TableCard>
                </>
              )}
              {fakeDns.length > 0 && (
                <>
                  <Button leftIcon={<AddIconStyled />} {...compactActionButtonProps} onClick={addFakeDns}>
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
                          <Tr key={index}>
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
            <Box position="relative" w="100%" h="100vh">
              <IconButton
                position="absolute"
                top={2}
                right={2}
                aria-label={isFullScreen ? "Exit Full Screen" : "Full Screen"}
                icon={isFullScreen ? <ExitFullScreenIconStyled /> : <FullScreenIconStyled />}
                onClick={toggleFullScreen}
                zIndex={10}
              />
              <Box
                w={isFullScreen ? "100vw" : "100%"}
                h={isFullScreen ? "100vh" : "100%"}
                position={isFullScreen ? "fixed" : "relative"}
                top={isFullScreen ? 0 : "auto"}
                left={isFullScreen ? 0 : "auto"}
                zIndex={isFullScreen ? 1000 : "auto"}
              >
                <Controller
                  control={form.control}
                  name="config"
                  render={({ field }) => (
                    <JsonEditor
                      json={field.value ?? {}}
                      onChange={(value) => {
                        try {
                          const parsed = JSON.parse(value);
                          field.onChange(parsed);
                        } catch {
                          // ignore invalid JSON until it becomes valid
                        }
                      }}
                    />
                  )}
                />
              </Box>
            </Box>
          </TabPanel>
          <TabPanel>
            <Box>
              <XrayLogsPage showTitle={false} />
            </Box>
          </TabPanel>
        </TabPanels>
      </Tabs>
      <OutboundModal isOpen={isOutboundOpen} onClose={onOutboundClose} form={form} setOutboundData={setOutboundData} />
      <RuleModal isOpen={isRuleOpen} onClose={onRuleClose} form={form} setRoutingRuleData={setRoutingRuleData} />
      <BalancerModal isOpen={isBalancerOpen} onClose={onBalancerClose} form={form} setBalancersData={setBalancersData} />
      <DnsModal isOpen={isDnsOpen} onClose={onDnsClose} form={form} setDnsServers={setDnsServers} />
      <FakeDnsModal isOpen={isFakeDnsOpen} onClose={onFakeDnsClose} form={form} setFakeDns={setFakeDns} />
    </VStack>
  );
};

export default CoreSettingsPage;
