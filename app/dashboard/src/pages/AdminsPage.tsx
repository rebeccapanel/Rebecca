import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  Badge,
  Box,
  Button,
  Divider,
  Flex,
  FormControl,
  FormErrorMessage,
  FormLabel,
  Switch,
  HStack,
  IconButton,
  Input as ChakraInput,
  InputGroup,
  InputRightElement,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Select,
  Spinner,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Table,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tooltip,
  Tr,
  VStack,
  Wrap,
  WrapItem,
  useColorMode,
  useDisclosure,
  useToast,
} from "@chakra-ui/react";
import {
  ArrowPathIcon,
  ChevronDownIcon,
  NoSymbolIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  TrashIcon,
  SparklesIcon,
  EyeIcon,
  EyeSlashIcon,
  UserGroupIcon,
  ChartBarIcon,
} from "@heroicons/react/24/outline";
import { chakra } from "@chakra-ui/react";
import { UsageFilter } from "components/UsageFilter";
import { createUsageConfig } from "components/UsageFilter";
import { useAdminsStore } from "contexts/AdminsContext";
import { FilterUsageType } from "contexts/DashboardContext";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Admin, AdminCreatePayload, AdminUpdatePayload } from "types/Admin";
import { formatBytes } from "utils/formatByte";
import { generateErrorMessage, generateSuccessMessage } from "utils/toastHandler";
import { fetch as apiFetch } from "service/http";
import { ApexOptions } from "apexcharts";
import ReactApexChart from "react-apexcharts";
import dayjs from "dayjs";
import { UseFormReturn, useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

const AddIcon = chakra(PlusIcon, { baseStyle: { w: 4, h: 4 } });
const EditIcon = chakra(PencilIcon, { baseStyle: { w: 4, h: 4 } });
const ResetIcon = chakra(ArrowPathIcon, { baseStyle: { w: 4, h: 4 } });
const DisableIcon = chakra(NoSymbolIcon, { baseStyle: { w: 4, h: 4 } });
const ActivateIcon = chakra(PlayIcon, { baseStyle: { w: 4, h: 4 } });
const DeleteIcon = chakra(TrashIcon, { baseStyle: { w: 4, h: 4 } });
const RandomIcon = chakra(SparklesIcon, { baseStyle: { w: 4, h: 4 } });
const ViewIcon = chakra(EyeIcon, { baseStyle: { w: 4, h: 4 } });
const ViewOffIcon = chakra(EyeSlashIcon, { baseStyle: { w: 4, h: 4 } });
const ManageTabIcon = chakra(UserGroupIcon, { baseStyle: { w: 4, h: 4 } });
const UsageTabIcon = chakra(ChartBarIcon, { baseStyle: { w: 4, h: 4 } });
const SortIcon = chakra(ChevronDownIcon, {
  baseStyle: {
    w: 4,
    h: 4,
    transition: "transform 0.2s",
  },
});

type AdminFormValues = {
  username: string;
  password?: string;
  telegram_id?: string;
  is_sudo?: boolean;
};

const SortIndicator = ({
  sort,
  column,
}: {
  sort: string;
  column: string;
}) => {
  const isActive = sort.includes(column);
  const isDescending = isActive && sort.startsWith("-");
  return (
    <SortIcon
      opacity={isActive ? 1 : 0}
      transform={isActive && !isDescending ? "rotate(180deg)" : undefined}
    />
  );
};

type AdminDailyEntry = {
  date: string;
  used_traffic: number;
};

type AdminDailyUsageResponse = {
  username: string;
  usages: AdminDailyEntry[];
};

type AdminNodeUsageEntry = {
  node_id: number | null;
  node_name: string;
  uplink?: number;
  downlink?: number;
};

type AdminNodeUsageResponse = {
  usages: AdminNodeUsageEntry[];
};

const buildDefaultUsageRange = (): FilterUsageType => {
  const end = dayjs().utc();
  const start = end.clone().subtract(7, "day");
  return {
    start: start.format("YYYY-MM-DDTHH:00:00"),
    end: end.format("YYYY-MM-DDTHH:00:00"),
  };
};

const formatTimeseriesLabel = (value: string) => {
  if (!value) return value;
  const parsed = dayjs(value);
  if (!parsed.isValid()) {
    return value;
  }
  return parsed.format("YYYY-MM-DD");
};

const buildUsageLineOptions = (
  t: (key: string, defaultValue?: string, options?: Record<string, string | number>) => string,
  labels: string[],
  colorMode: "light" | "dark"
): ApexOptions => ({
  chart: {
    type: "line",
    height: 320,
    animations: { enabled: false },
    toolbar: { show: false },
  },
  stroke: {
    curve: "smooth",
    width: 2,
  },
  dataLabels: { enabled: false },
  xaxis: {
    categories: labels,
    labels: {
      style: {
        colors: colorMode === "dark" ? "#CBD5E0" : undefined,
      },
    },
  },
  yaxis: {
    labels: {
      formatter: (value) => formatBytes(Number(value) || 0),
      style: {
        colors: colorMode === "dark" ? "#CBD5E0" : undefined,
      },
    },
  },
  tooltip: {
    y: {
      formatter: (value) => formatBytes(Number(value) || 0, 2),
      title: {
        formatter: () => t("admins.usageValue", "Usage"),
      },
    },
  },
});

interface AdminFormModalProps {
  isOpen: boolean;
  mode: "create" | "edit";
  admin?: Admin | null;
  onSubmit: (
    values: AdminFormValues,
    form: UseFormReturn<AdminFormValues>
  ) => Promise<void>;
  onClose: () => void;
}

const AdminFormModal: React.FC<AdminFormModalProps> = ({
  isOpen,
  mode,
  admin,
  onSubmit,
  onClose,
}) => {
  const { t } = useTranslation();
  const toast = useToast();

  const schema = useMemo(() => {
    const base = z
      .object({
        username: z
          .string()
          .trim()
          .min(3, { message: t("admins.validation.usernameMin") }),
        password: z
          .string()
          .trim()
          .optional()
          .transform((value) => (value === "" ? undefined : value))
          .refine(
            (value) => !value || value.length >= 6,
            t("admins.validation.passwordMin")
          ),
        telegram_id: z
          .string()
          .trim()
          .optional()
          .transform((value) => (value === "" ? undefined : value))
          .refine(
            (value) => value === undefined || /^\d+$/.test(value),
            t("admins.validation.telegramNumeric")
          ),
      })
      .superRefine((values, ctx) => {
        if (mode === "create" && !values.password) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["password"],
            message: t("admins.validation.passwordRequired"),
          });
        }
      });
    return base as z.ZodType<AdminFormValues>;
  }, [mode, t]);

  const form = useForm<AdminFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      username: "",
      password: "",
      telegram_id: "",
      is_sudo: false,
    },
  });

  const { register, handleSubmit, reset, formState, setValue, watch } = form;

  const sudoField = register("is_sudo");
  const [showPassword, setShowPassword] = useState(false);

  const generateRandomString = useCallback((length: number) => {
    const characters =
      "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    const charactersLength = characters.length;

    if (typeof window !== "undefined" && window.crypto?.getRandomValues) {
      const randomValues = new Uint32Array(length);
      window.crypto.getRandomValues(randomValues);
      return Array.from(randomValues, (value) =>
        characters[value % charactersLength]
      ).join("");
    }

    return Array.from({ length }, () => {
      const index = Math.floor(Math.random() * charactersLength);
      return characters[index];
    }).join("");
  }, []);

  const handleGenerateUsername = useCallback(() => {
    if (mode === "edit") return;
    const randomUsername = generateRandomString(8);
    setValue("username", randomUsername, {
      shouldDirty: true,
      shouldValidate: true,
    });
  }, [generateRandomString, mode, setValue]);

  const handleGeneratePassword = useCallback(() => {
    const randomPassword = generateRandomString(12);
    setValue("password", randomPassword, {
      shouldDirty: true,
      shouldValidate: true,
    });
  }, [generateRandomString, setValue]);
  const { errors, isSubmitting } = formState;

  useEffect(() => {
    if (isOpen) {
      reset({
        username: admin?.username ?? "",
        password: "",
        telegram_id:
          admin?.telegram_id !== undefined && admin?.telegram_id !== null
            ? String(admin.telegram_id)
            : "",
      });
    }
  }, [admin, isOpen, reset]);

  const handleFormSubmit = handleSubmit(async (values) => {
    try {
      await onSubmit(values, form);
      reset({
        username: "",
        password: "",
        telegram_id: "",
      });
      onClose();
    } catch (error) {
      generateErrorMessage(error, toast, form);
    }
  });

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg">
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>
          {mode === "create"
            ? t("admins.addAdminTitle", "Add admin")
            : t("admins.editAdminTitle", "Edit admin")}
        </ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <VStack spacing={4} align="stretch">
            <FormControl isInvalid={!!errors.username}>
              <FormLabel>{t("username")}</FormLabel>
              <InputGroup>
                <ChakraInput
                  placeholder={t(
                    "admins.usernamePlaceholder",
                    "Admin username"
                  )}
                  {...register("username")}
                  isDisabled={mode === "edit"}
                  pr="28"
                />
                <InputRightElement
                  width="auto"
                  pr="2"
                  pointerEvents={mode === "edit" ? "none" : "auto"}
                >
                  <IconButton
                    aria-label={t("admins.generateUsername", "Random")}
                    size="xs"
                    variant="ghost"
                    icon={<RandomIcon />}
                    onClick={handleGenerateUsername}
                    isDisabled={mode === "edit"}
                  />
                </InputRightElement>
              </InputGroup>
              <FormErrorMessage>
                {errors.username?.message as string}
              </FormErrorMessage>
            </FormControl>
            <FormControl isInvalid={!!errors.password}>
              <FormLabel>{t("password")}</FormLabel>
              <InputGroup>
                <ChakraInput
                  placeholder={t("admins.passwordPlaceholder", "Password")}
                  type={showPassword ? "text" : "password"}
                  {...register("password")}
                  pr="28"
                />
                <InputRightElement width="auto" pr="2" pointerEvents="auto">
                  <HStack spacing={1}>
                    <IconButton
                      aria-label={showPassword ? t("hide", "Hide") : t("show", "Show")}
                      size="xs"
                      variant="ghost"
                      icon={showPassword ? <ViewOffIcon /> : <ViewIcon />}
                      onClick={() => setShowPassword((s) => !s)}
                      type="button"
                    />
                    <IconButton
                      aria-label={t("admins.generatePassword", "Random")}
                      size="xs"
                      variant="ghost"
                      icon={<RandomIcon />}
                      onClick={handleGeneratePassword}
                      type="button"
                    />
                  </HStack>
                </InputRightElement>
              </InputGroup>
              <FormErrorMessage>
                {errors.password?.message as string}
              </FormErrorMessage>
              {mode === "edit" && (
                <Text fontSize="xs" color="gray.500" mt={1}>
                  {t(
                    "admins.passwordOptionalHint",
                    "Leave empty to keep current password."
                  )}
                </Text>
              )}
            </FormControl>
            <FormControl display="flex" alignItems="center">
              <VStack align="start" spacing={1} w="full">
                <HStack justify="space-between" w="full">
                  <FormLabel mb={0}>
                    {t("admins.isSudo", "Sudo access")}
                  </FormLabel>
                  <Switch
                    size="md"
                    isChecked={watch("is_sudo")}
                    onChange={(event) =>
                      setValue("is_sudo", event.target.checked, {
                        shouldDirty: true,
                      })
                    }
                    onBlur={sudoField.onBlur}
                    ref={sudoField.ref}
                  />
                </HStack>
                <Text fontSize="xs" color="gray.500">
                  {t(
                    "admins.isSudoHint",
                    "Sudo admins can manage other admins and system settings."
                  )}
                </Text>
              </VStack>
            </FormControl>
            <FormControl isInvalid={!!errors.telegram_id}>
              <FormLabel>{t("admins.telegramId", "Telegram ID")}</FormLabel>
              <ChakraInput
                placeholder={t(
                  "admins.telegramPlaceholder",
                  "Optional numeric Telegram ID"
                )}
                inputMode="numeric"
                {...register("telegram_id")}
              />
              <FormErrorMessage>
                {errors.telegram_id?.message as string}
              </FormErrorMessage>
            </FormControl>
          </VStack>
        </ModalBody>
        <ModalFooter>
          <HStack spacing={3}>
            <Button variant="ghost" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button
              colorScheme="primary"
              onClick={handleFormSubmit}
              isLoading={isSubmitting}
            >
              {mode === "create"
                ? t("admins.addAdmin", "Create")
                : t("save", "Save")}
            </Button>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export const AdminsPage: React.FC = () => {
  const { t } = useTranslation();
  const toast = useToast();
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const { colorMode } = useColorMode();
  const {
    admins,
    loading,
    filters,
    fetchAdmins,
    setFilters,
    createAdmin,
    updateAdmin,
    deleteAdmin,
    resetUsage,
    disableUsers,
    activateUsers,
  } = useAdminsStore();

  const [search, setSearch] = useState(filters.search);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [formAdmin, setFormAdmin] = useState<Admin | null>(null);
  const formDisclosure = useDisclosure();

  const deleteDisclosure = useDisclosure();
  const [adminToDelete, setAdminToDelete] = useState<Admin | null>(null);
  const [actionState, setActionState] = useState<{
    type: "reset" | "disable" | "activate";
    username: string;
  } | null>(null);

  const [usageAdmin, setUsageAdmin] = useState<string | null>(null);
  const [usageFilter, setUsageFilter] = useState<string>("1w");
  const [usageQuery, setUsageQuery] = useState<FilterUsageType>(
    buildDefaultUsageRange()
  );
  const [dailyUsage, setDailyUsage] = useState<AdminDailyEntry[]>([]);
  const [nodeUsage, setNodeUsage] = useState<AdminNodeUsageEntry[]>([]);
  const [usageLoading, setUsageLoading] = useState(false);
  const [lastUsageUpdated, setLastUsageUpdated] = useState<Date | null>(null);

  useEffect(() => {
    fetchAdmins().catch((error) => {
      generateErrorMessage(error, toast);
    });
  }, [fetchAdmins, toast]);

  useEffect(() => {
    if (admins.length && !usageAdmin) {
      setUsageAdmin(admins[0].username);
    }
  }, [admins, usageAdmin]);

  const handleSearchSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setFilters({ search: search.trim(), offset: 0 });
    fetchAdmins().catch((error) => generateErrorMessage(error, toast));
  };

  const handleRefreshAdmins = () => {
    fetchAdmins().catch((error) => generateErrorMessage(error, toast));
  };

  const handleSort = (column: "username" | "users_usage") => {
    let newSort = filters.sort || "username";
    if (newSort.includes(column)) {
      if (newSort.startsWith("-")) {
        newSort = "username";
      } else {
        newSort = `-${column}`;
      }
    } else {
      newSort = column;
    }
    setFilters({ sort: newSort, offset: 0 });
    fetchAdmins().catch((error) => generateErrorMessage(error, toast));
  };

  const handleOpenCreate = () => {
    setFormMode("create");
    setFormAdmin(null);
    formDisclosure.onOpen();
  };

  const handleOpenEdit = (admin: Admin) => {
    setFormMode("edit");
    setFormAdmin(admin);
    formDisclosure.onOpen();
  };

  const handleFormSubmit = async (
    values: AdminFormValues,
    form: UseFormReturn<AdminFormValues>
  ) => {
    try {
      if (formMode === "create") {
        const payload: AdminCreatePayload = {
          username: values.username.trim(),
          password: values.password ?? "",
          is_sudo: false,
          telegram_id: values.telegram_id
            ? Number(values.telegram_id)
            : undefined,
        };
        await createAdmin(payload);
        generateSuccessMessage(t("admins.createSuccess", "Admin created"), toast);
      } else if (formAdmin) {
        const payload: AdminUpdatePayload = {
          is_sudo: formAdmin.is_sudo,
          telegram_id: values.telegram_id
            ? Number(values.telegram_id)
            : undefined,
        };
        if (values.password) {
          payload.password = values.password;
        }
        await updateAdmin(formAdmin.username, payload);
        generateSuccessMessage(t("admins.updateSuccess", "Admin updated"), toast);
      }
    } catch (error) {
      generateErrorMessage(error, toast, form);
      throw error;
    }
  };

  const openDeleteDialog = (admin: Admin) => {
    setAdminToDelete(admin);
    deleteDisclosure.onOpen();
  };

  const handleDeleteAdmin = async () => {
    if (!adminToDelete) return;
    try {
      await deleteAdmin(adminToDelete.username);
      generateSuccessMessage(t("admins.deleteSuccess", "Admin removed"), toast);
      deleteDisclosure.onClose();
      setAdminToDelete(null);
    } catch (error) {
      generateErrorMessage(error, toast);
    }
  };

  const runAction = async (
    type: "reset" | "disable" | "activate",
    admin: Admin
  ) => {
    setActionState({ type, username: admin.username });
    try {
      if (type === "reset") {
        await resetUsage(admin.username);
        generateSuccessMessage(
          t("admins.resetUsageSuccess", "Usage reset"),
          toast
        );
      } else if (type === "disable") {
        await disableUsers(admin.username);
        generateSuccessMessage(
          t("admins.disableUsersSuccess", "Users disabled"),
          toast
        );
      } else if (type === "activate") {
        await activateUsers(admin.username);
        generateSuccessMessage(
          t("admins.activateUsersSuccess", "Users activated"),
          toast
        );
      }
    } catch (error) {
      generateErrorMessage(error, toast);
    } finally {
      setActionState(null);
    }
  };

  const loadUsageData = useCallback(
    async (adminUsername: string, query?: FilterUsageType) => {
      if (!adminUsername) return;
      const effectiveQuery = query ?? usageQuery;
      setUsageLoading(true);
      try {
        const [dailyResponse, nodeResponse] = await Promise.all([
          apiFetch<AdminDailyUsageResponse>(
            `/admin/${encodeURIComponent(adminUsername)}/usage/daily`,
            effectiveQuery ? { query: effectiveQuery } : {}
          ),
          apiFetch<AdminNodeUsageResponse>(
            `/admin/${encodeURIComponent(adminUsername)}/usage/nodes`,
            effectiveQuery ? { query: effectiveQuery } : {}
          ),
        ]);
        setDailyUsage(dailyResponse?.usages ?? []);
        setNodeUsage(nodeResponse?.usages ?? []);
        setLastUsageUpdated(new Date());
      } catch (error) {
        setDailyUsage([]);
        setNodeUsage([]);
        generateErrorMessage(error, toast);
      } finally {
        setUsageLoading(false);
      }
    },
    [toast, usageQuery]
  );

  useEffect(() => {
    if (usageAdmin) {
      loadUsageData(usageAdmin);
    }
  }, [loadUsageData, usageAdmin]);

  const usageLineLabels = useMemo(
    () => dailyUsage.map((entry) => formatTimeseriesLabel(entry.date)),
    [dailyUsage]
  );

  const usageLineSeries = useMemo(
    () => [
      {
        name: t("admins.usageSeriesName", "Total usage"),
        data: dailyUsage.map((entry) => Number(entry.used_traffic || 0)),
      },
    ],
    [dailyUsage, t]
  );

  const nodeUsageChart = useMemo(() => {
    const totals = nodeUsage.map(
      (entry) => Number(entry.uplink ?? 0) + Number(entry.downlink ?? 0)
    );
    const labels = nodeUsage.map(
      (entry) => entry.node_name || t("admins.unknownNode", "Unknown")
    );
    return createUsageConfig(
      colorMode,
      `${t("admins.usageNodesTitle", "Usage by node")}: `,
      totals,
      labels
    );
  }, [colorMode, nodeUsage, t]);

  const handleUsageFilterChange = (filter: string, query: FilterUsageType) => {
    setUsageFilter(filter);
    setUsageQuery(query);
    if (usageAdmin) {
      loadUsageData(usageAdmin, query);
    }
  };

  const handleUsageAdminChange = (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => {
    const value = event.target.value || null;
    setUsageAdmin(value);
    if (value) {
      loadUsageData(value);
    }
  };

  return (
    <VStack align="stretch" spacing={6}>
      <Tabs variant="enclosed" colorScheme="primary">
        <TabList>
          <Tab>{t("admins.manageTab", "Admins")}</Tab>
          <Tab>{t("admins.usageTab", "Usage")}</Tab>
        </TabList>
        <TabPanels>
          <TabPanel px={0}>
            <VStack align="stretch" spacing={4}>
              <Flex
                as="form"
                onSubmit={handleSearchSubmit}
                justify="space-between"
                gap={4}
                flexWrap="wrap"
              >
                <HStack spacing={3}>
                  <ChakraInput
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={t(
                      "admins.searchPlaceholder",
                      "Search admins..."
                    )}
                    size="sm"
                    maxW="260px"
                  />
                  <Button type="submit" size="sm">
                    {t("search")}
                  </Button>
                </HStack>
                <HStack spacing={3}>
                  <Button
                    size="sm"
                    variant="outline"
                    leftIcon={<ResetIcon />}
                    onClick={handleRefreshAdmins}
                  >
                    {t("refresh")}
                  </Button>
                  <Button
                    size="sm"
                    colorScheme="primary"
                    leftIcon={<AddIcon />}
                    onClick={handleOpenCreate}
                  >
                    {t("admins.addAdmin", "Add admin")}
                  </Button>
                </HStack>
              </Flex>
              <Box borderWidth="1px" borderRadius="md" overflowX="auto">
                {loading ? (
                  <Flex justify="center" py={12}>
                    <Spinner />
                  </Flex>
                ) : admins.length ? (
                  <Table size="sm">
                    <Thead>
                      <Tr>
                        <Th>{t("username")}</Th>
                        <Th>{t("admins.isSudo", "Sudo access")}</Th>
                        <Th>{t("admins.telegramId", "Telegram ID")}</Th>
                        <Th>{t("admins.discordWebhook", "Discord webhook")}</Th>
                        <Th>{t("admins.usageColumn", "Usage")}</Th>
                        <Th>{t("actions")}</Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {admins.map((admin) => {
                        const usage = formatBytes(admin.users_usage ?? 0);
                        const isActionLoading =
                          actionState?.username === admin.username;
                        return (
                          <Tr key={admin.username}>
                            <Td fontWeight="medium">{admin.username}</Td>
                            <Td>
                              {admin.is_sudo ? (
                                <Badge colorScheme="purple">
                                  {t("admins.sudoBadge", "Sudo")}
                                </Badge>
                              ) : (
                                <Badge>{t("admins.standardBadge", "Standard")}</Badge>
                              )}
                            </Td>
                            <Td>
                              {admin.telegram_id !== null &&
                              admin.telegram_id !== undefined
                                ? admin.telegram_id
                                : "-"}
                            </Td>
                            <Td maxW="220px">
                              <Text isTruncated>
                                {admin.discord_webhook || "-"}
                              </Text>
                            </Td>
                            <Td>{usage}</Td>
                            <Td>
                              <HStack spacing={1}>
                                <Tooltip
                                  label={t("admins.editAction", "Edit")}
                                  placement="top"
                                >
                                  <IconButton
                                    aria-label="edit admin"
                                    icon={<EditIcon />}
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => handleOpenEdit(admin)}
                                  />
                                </Tooltip>
                                <Tooltip
                                  label={t("admins.resetUsage", "Reset usage")}
                                  placement="top"
                                >
                                  <IconButton
                                    aria-label="reset usage"
                                    icon={<ResetIcon />}
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => runAction("reset", admin)}
                                    isLoading={
                                      isActionLoading &&
                                      actionState?.type === "reset"
                                    }
                                    isDisabled={(admin.users_usage ?? 0) === 0}
                                  />
                                </Tooltip>
                                <Tooltip
                                  label={t(
                                    "admins.disableUsers",
                                    "Disable users"
                                  )}
                                  placement="top"
                                >
                                  <IconButton
                                    aria-label="disable users"
                                    icon={<DisableIcon />}
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => runAction("disable", admin)}
                                    isLoading={
                                      isActionLoading &&
                                      actionState?.type === "disable"
                                    }
                                  />
                                </Tooltip>
                                <Tooltip
                                  label={t(
                                    "admins.activateUsers",
                                    "Activate users"
                                  )}
                                  placement="top"
                                >
                                  <IconButton
                                    aria-label="activate users"
                                    icon={<ActivateIcon />}
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => runAction("activate", admin)}
                                    isLoading={
                                      isActionLoading &&
                                      actionState?.type === "activate"
                                    }
                                  />
                                </Tooltip>
                                <Tooltip label={t("delete")} placement="top">
                                  <IconButton
                                    aria-label="delete admin"
                                    icon={<DeleteIcon />}
                                    size="sm"
                                    variant="ghost"
                                    colorScheme="red"
                                    onClick={() => openDeleteDialog(admin)}
                                  />
                                </Tooltip>
                              </HStack>
                            </Td>
                          </Tr>
                        );
                      })}
                    </Tbody>
                  </Table>
                ) : (
                  <Flex direction="column" align="center" py={12} gap={2}>
                    <Text color="gray.500">
                      {t("admins.emptyStateTitle", "No admins found")}
                    </Text>
                    <Text fontSize="sm" color="gray.500">
                      {t(
                        "admins.emptyStateDescription",
                        "Add an admin to get started."
                      )}
                    </Text>
                  </Flex>
                )}
              </Box>
            </VStack>
          </TabPanel>
          <TabPanel px={0}>
            <VStack align="stretch" spacing={4}>
              <HStack spacing={3} flexWrap="wrap">
                <FormControl maxW="260px">
                  <FormLabel fontSize="sm">
                    {t("admins.selectAdmin", "Select admin")}
                  </FormLabel>
                  <Select
                    size="sm"
                    value={usageAdmin ?? ""}
                    onChange={handleUsageAdminChange}
                  >
                    {admins.map((admin) => (
                      <option key={admin.username} value={admin.username}>
                        {admin.username}
                      </option>
                    ))}
                  </Select>
                </FormControl>
                <UsageFilter
                  defaultValue={usageFilter}
                  onChange={handleUsageFilterChange}
                />
                <Button
                  size="sm"
                  leftIcon={<ResetIcon />}
                  onClick={() => usageAdmin && loadUsageData(usageAdmin)}
                  isLoading={usageLoading}
                  variant="outline"
                >
                  {t("refresh")}
                </Button>
              </HStack>
              {lastUsageUpdated && (
                <Text fontSize="xs" color="gray.500">
                  {t(
                    "admins.usageLastUpdated",
                    "Updated {{time}}",
                    { time: dayjs(lastUsageUpdated).fromNow() }
                  )}
                </Text>
              )}
              <Box
                borderWidth="1px"
                borderRadius="md"
                p={4}
                minH="320px"
                display="flex"
                alignItems="center"
                justifyContent="center"
              >
                {usageLoading ? (
                  <Spinner />
                ) : dailyUsage.length ? (
                  <ReactApexChart
                    options={buildUsageLineOptions(t, usageLineLabels, colorMode)}
                    series={usageLineSeries}
                    type="line"
                    height={320}
                  />
                ) : (
                  <Text color="gray.500">
                    {t(
                      "admins.usageEmpty",
                      "No usage data for the selected range."
                    )}
                  </Text>
                )}
              </Box>
              <Divider />
              <Box
                borderWidth="1px"
                borderRadius="md"
                p={4}
                minH="320px"
                display="flex"
                alignItems="center"
                justifyContent="center"
              >
                {usageLoading ? (
                  <Spinner />
                ) : nodeUsage.length ? (
                  <ReactApexChart
                    options={nodeUsageChart.options}
                    series={nodeUsageChart.series}
                    type="donut"
                    height={320}
                  />
                ) : (
                  <Text color="gray.500">
                    {t(
                      "admins.usageNodesEmpty",
                      "No node usage data for this range."
                    )}
                  </Text>
                )}
              </Box>
            </VStack>
          </TabPanel>
        </TabPanels>
      </Tabs>

      <AdminFormModal
        isOpen={formDisclosure.isOpen}
        mode={formMode}
        admin={formAdmin}
        onSubmit={handleFormSubmit}
        onClose={formDisclosure.onClose}
      />

      <AlertDialog
        isOpen={deleteDisclosure.isOpen}
        leastDestructiveRef={cancelRef}
        onClose={deleteDisclosure.onClose}
      >
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              {t("admins.confirmDeleteTitle", "Delete admin")}
            </AlertDialogHeader>
            <AlertDialogBody>
              {t(
                "admins.confirmDeleteMessage",
                "Are you sure you want to delete {{username}}?",
                {
                  username: adminToDelete?.username ?? "",
                }
              )}
            </AlertDialogBody>
            <AlertDialogFooter>
              <Button ref={cancelRef} onClick={deleteDisclosure.onClose}>
                {t("cancel")}
              </Button>
              <Button colorScheme="red" onClick={handleDeleteAdmin} ml={3}>
                {t("delete")}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </VStack>
  );
};

export default AdminsPage;
