import {

  Alert,

  AlertIcon,

  Box,

  Button,

  Collapse,

  Flex,

  FormControl,

  FormErrorMessage,

  FormHelperText,

  FormLabel,

  Grid,

  GridItem,

  HStack,

  IconButton,

  InputGroup,

  InputRightElement,

  Input as ChakraInput,

  Modal,

  ModalBody,

  ModalCloseButton,

  ModalContent,

  ModalFooter,

  ModalHeader,

  ModalOverlay,

  Select,

  Spinner,

  Switch,

  Text,

  Textarea,

  Tooltip,

  VStack,
  Stack,

  chakra,

  useColorMode,

  useToast,

} from "@chakra-ui/react";

import {

  ChartPieIcon,

  CheckIcon,

  LockClosedIcon,

  PencilIcon,

  UserPlusIcon,

  QuestionMarkCircleIcon,

  SparklesIcon,

} from "@heroicons/react/24/outline";

import { zodResolver } from "@hookform/resolvers/zod";

import { resetStrategy } from "constants/UserSettings";

import { FilterUsageType, useDashboard } from "contexts/DashboardContext";

import { useServicesStore } from "contexts/ServicesContext";

import useGetUser from "hooks/useGetUser";

import dayjs from "dayjs";

import { FC, useEffect, useState } from "react";
import ReactApexChart from "react-apexcharts";

import { Controller, FormProvider, useForm, useWatch } from "react-hook-form";

import { useTranslation } from "react-i18next";

import { User, UserCreate, UserCreateWithService } from "types/User";

import { relativeExpiryDate } from "utils/dateFormatter";

import { z } from "zod";

import { DeleteIcon } from "./DeleteUserModal";

import { Icon } from "./Icon";

import { Input } from "./Input";

import { UsageFilter, createUsageConfig } from "./UsageFilter";





const AddUserIcon = chakra(UserPlusIcon, {

  baseStyle: {

    w: 5,

    h: 5,

  },

});



const EditUserIcon = chakra(PencilIcon, {

  baseStyle: {

    w: 5,

    h: 5,

  },

});



const UserUsageIcon = chakra(ChartPieIcon, {

  baseStyle: {

    w: 5,

    h: 5,

  },

});



const LimitLockIcon = chakra(LockClosedIcon, {

  baseStyle: {

    w: {

      base: 16,

      md: 20,

    },

    h: {

      base: 16,

      md: 20,

    },

  },

});



const ConfirmIcon = chakra(CheckIcon, {

  baseStyle: {

    w: 4,

    h: 4,

  },

});



export type UserDialogProps = {};

type BaseFormFields = Pick<

  UserCreate,

  | "username"

  | "status"

  | "expire"

  | "data_limit"

  | "ip_limit"

  | "data_limit_reset_strategy"

  | "on_hold_expire_duration"

  | "note"

  | "proxies"

  | "inbounds"

>;



export type FormType = BaseFormFields & {

  service_id: number | null;

  next_plan_enabled: boolean;

  next_plan_data_limit: number | null;

  next_plan_expire: number | null;

  next_plan_add_remaining_traffic: boolean;

  next_plan_fire_on_either: boolean;

};



const formatUser = (user: User): FormType => {

  const nextPlan = user.next_plan ?? null;

  return {

    ...user,

    data_limit: user.data_limit

      ? Number((user.data_limit / 1073741824).toFixed(5))

      : user.data_limit,

    ip_limit: user.ip_limit && user.ip_limit > 0 ? user.ip_limit : null,

    on_hold_expire_duration:

      user.on_hold_expire_duration

        ? Number(user.on_hold_expire_duration / (24 * 60 * 60))

        : user.on_hold_expire_duration,

    service_id: user.service_id ?? null,

    next_plan_enabled: Boolean(nextPlan),

    next_plan_data_limit: nextPlan?.data_limit

      ? Number((nextPlan.data_limit / 1073741824).toFixed(5))

      : null,

    next_plan_expire: nextPlan?.expire ?? null,

    next_plan_add_remaining_traffic: nextPlan?.add_remaining_traffic ?? false,

    next_plan_fire_on_either: nextPlan?.fire_on_either ?? true,

  };

};

const getDefaultValues = (): FormType => {

  return {

    data_limit: null,

    ip_limit: null,

    expire: null,

    username: "",

    data_limit_reset_strategy: "no_reset",

    status: "active",

    on_hold_expire_duration: null,

    note: "",

    inbounds: {},

    proxies: {

      vless: { id: "", flow: "" },

      vmess: { id: "" },

      trojan: { password: "" },

      shadowsocks: { password: "", method: "chacha20-ietf-poly1305" },

    },

    service_id: null,

    next_plan_enabled: false,

    next_plan_data_limit: null,

    next_plan_expire: null,

    next_plan_add_remaining_traffic: false,

    next_plan_fire_on_either: true,

  };

};



const baseSchema = {

  username: z.string().min(1, { message: "Required" }),

  note: z.string().nullable(),

  service_id: z

    .union([z.string(), z.number()])

    .nullable()

    .transform((value) => {

      if (value === "" || value === null || typeof value === "undefined") {

        return null;

      }

      const parsed = Number(value);

      return Number.isNaN(parsed) ? null : parsed;

    }),

  proxies: z

    .record(z.string(), z.record(z.string(), z.any()))

    .transform((ins) => {

      const deleteIfEmpty = (obj: any, key: string) => {

        if (obj && obj[key] === "") {

          delete obj[key];

        }

      };

      deleteIfEmpty(ins.vmess, "id");

      deleteIfEmpty(ins.vless, "id");

      deleteIfEmpty(ins.trojan, "password");

      deleteIfEmpty(ins.shadowsocks, "password");

      deleteIfEmpty(ins.shadowsocks, "method");

      return ins;

    }),

  data_limit: z

    .string()

    .min(0)

    .or(z.number())

    .nullable()

    .transform((str) => {

      if (str) return Number((parseFloat(String(str)) * 1073741824).toFixed(5));

      return 0;

    }),

  expire: z.number().nullable(),

  data_limit_reset_strategy: z.string(),

  inbounds: z.record(z.string(), z.array(z.string())).transform((ins) => {

    Object.keys(ins).forEach((protocol) => {

      if (Array.isArray(ins[protocol]) && !ins[protocol]?.length)

        delete ins[protocol];

    });

    return ins;

  }),

  next_plan_enabled: z.boolean().default(false),

  next_plan_data_limit: z

    .union([z.string(), z.number(), z.null()])

    .transform((value) => {

      if (value === null || value === "" || typeof value === "undefined") {

        return null;

      }

      const parsed = Number(value);

      if (Number.isNaN(parsed)) {

        return null;

      }

      return Math.max(0, parsed);

    }),

  next_plan_expire: z

    .union([z.number(), z.string(), z.null()])

    .transform((value) => {

      if (value === "" || value === null || typeof value === "undefined") {

        return null;

      }

      const parsed = Number(value);

      return Number.isNaN(parsed) ? null : parsed;

    }),

  next_plan_add_remaining_traffic: z.boolean().default(false),

  next_plan_fire_on_either: z.boolean().default(true),

};



const schema = z.discriminatedUnion("status", [

  z.object({

    status: z.literal("active"),

    ...baseSchema,

  }),

  z.object({

    status: z.literal("disabled"),

    ...baseSchema,

  }),

  z.object({

    status: z.literal("limited"),

    ...baseSchema,

  }),

  z.object({

    status: z.literal("expired"),

    ...baseSchema,

  }),

  z.object({

    status: z.literal("on_hold"),

    on_hold_expire_duration: z.coerce

      .number()

      .min(0.1, "Required")

      .transform((d) => {

        return d * (24 * 60 * 60);

      }),

    ...baseSchema,

  }),

]);



export const UserDialog: FC<UserDialogProps> = () => {

  const {

    editingUser,

    isCreatingNewUser,

    onCreateUser,

    editUser,

    fetchUserUsage,

    onEditingUser,

    createUserWithService,

    onDeletingUser,

    users: usersState,

    isUserLimitReached,

  } = useDashboard();

  const isEditing = !!editingUser;

  const isOpen = isCreatingNewUser || isEditing;

  const usersLimit = usersState.users_limit ?? null;

  const activeUsersCount = usersState.active_total ?? null;

  const limitReached = isUserLimitReached && !isEditing;

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState<string | null>("");

  const toast = useToast();

  const { t } = useTranslation();


  const { colorMode } = useColorMode();


  const form = useForm<FormType>({

    defaultValues: getDefaultValues(),

    resolver: zodResolver(schema),

  });

  const expireInitialValue = form.getValues("expire");

  const nextPlanInitialValue = form.getValues("next_plan_expire");

  function deriveDaysFromSeconds(value: unknown): number | null {
    if (typeof value !== "number" || value <= 0) {
      return null;
    }
    const target = dayjs.unix(value).utc().local();
    const now = dayjs();
    const diff = target.diff(now, "day", true);
    if (!Number.isFinite(diff)) {
      return null;
    }
    return Math.max(0, Math.round(diff));
  }

  function convertDaysToSecondsFromNow(days: number): number {
    return dayjs().add(days, "day").endOf("day").utc().unix();
  }

  const [expireDays, setExpireDays] = useState<number | null>(() =>
    deriveDaysFromSeconds(expireInitialValue)
  );
  const [nextPlanDays, setNextPlanDays] = useState<number | null>(() =>
    deriveDaysFromSeconds(nextPlanInitialValue)
  );


  

  

    const services = useServicesStore((state) => state.services);
  const servicesLoading = useServicesStore((state) => state.isLoading);
  const { userData, getUserIsSuccess } = useGetUser();
  const isSudo = Boolean(getUserIsSuccess && userData.is_sudo);
  const [selectedServiceId, setSelectedServiceId] = useState<number | null>(null);

  const hasServices = services.length > 0;
  const selectedService = selectedServiceId
    ? services.find((service) => service.id === selectedServiceId) ?? null
    : null;
  const isServiceManagedUser = Boolean(editingUser?.service_id);
  const nonSudoSingleService = !isSudo && services.length === 1;
  const showServiceSelector = isSudo || services.length !== 1;
  const useTwoColumns = showServiceSelector && services.length > 0;
  const shouldCenterForm = !useTwoColumns;
  const shouldCompactModal = !isSudo && services.length === 0;

  const [usageVisible, setUsageVisible] = useState(false);
  const handleUsageToggle = () => {
    setUsageVisible((current) => !current);
  };




  useEffect(() => {

    if (isOpen) {

      useServicesStore.getState().fetchServices();

    }

  }, [isOpen]);



  useEffect(() => {

    if (isEditing) {

      if (editingUser?.service_id) {

        setSelectedServiceId(editingUser.service_id);

      } else if (isSudo) {

        setSelectedServiceId(null);

      } else if (services.length) {

        setSelectedServiceId(services[0]?.id ?? null);

      } else {

        setSelectedServiceId(null);

      }

    } else if (!isOpen) {

      setSelectedServiceId(null);

    }

  }, [isEditing, editingUser, isOpen, isSudo, services]);



  useEffect(() => {

    if (!isEditing && isOpen && hasServices) {

      setSelectedServiceId((current) => current ?? services[0]?.id ?? null);

    }

  }, [services, isEditing, isOpen, hasServices]);



  useEffect(() => {

    if (!isEditing && isOpen && !hasServices) {

      setSelectedServiceId(null);

    }

  }, [hasServices, isEditing, isOpen]);

  useEffect(() => {
    if (nonSudoSingleService && services[0]) {
      setSelectedServiceId((current) => current ?? services[0].id);
    }
  }, [nonSudoSingleService, services]);



  const [dataLimit, userStatus] = useWatch({

    control: form.control,

    name: ["data_limit", "status"],

  });

  const nextPlanEnabled = useWatch({

    control: form.control,

    name: "next_plan_enabled",

  });

  const expireValue = useWatch({

    control: form.control,

    name: "expire",

  });

  const nextPlanDataLimit = useWatch({

    control: form.control,

    name: "next_plan_data_limit",

  });

  const nextPlanExpire = useWatch({

    control: form.control,

    name: "next_plan_expire",

  });

  const nextPlanAddRemainingTraffic = useWatch({

    control: form.control,

    name: "next_plan_add_remaining_traffic",

  });

  const nextPlanFireOnEither = useWatch({

    control: form.control,

    name: "next_plan_fire_on_either",

  });



  useEffect(() => {
    const derivedDays = deriveDaysFromSeconds(expireValue);
    setExpireDays((prev) => (prev === derivedDays ? prev : derivedDays));
  }, [expireValue]);

  useEffect(() => {
    const derivedDays = deriveDaysFromSeconds(nextPlanExpire);
    setNextPlanDays((prev) => (prev === derivedDays ? prev : derivedDays));
  }, [nextPlanExpire]);


  const handleNextPlanToggle = (checked: boolean) => {

    form.setValue("next_plan_enabled", checked, { shouldDirty: true });

    if (checked) {

      if (form.getValues("next_plan_data_limit") === null) {

        form.setValue("next_plan_data_limit", 0, { shouldDirty: false });

      }

      if (form.getValues("next_plan_add_remaining_traffic") === undefined) {

        form.setValue("next_plan_add_remaining_traffic", false, { shouldDirty: false });

      }

      if (form.getValues("next_plan_fire_on_either") === undefined) {

        form.setValue("next_plan_fire_on_either", true, { shouldDirty: false });

      }

    } else {
      form.setValue("next_plan_data_limit", null, { shouldDirty: true });
      form.setValue("next_plan_expire", null, { shouldDirty: true });
      setNextPlanDays(null);
    }
  };


  const usageTitle = t("userDialog.total");

  const [usage, setUsage] = useState(createUsageConfig(colorMode, usageTitle));

  const [usageFilter, setUsageFilter] = useState("1m");

  const fetchUsageWithFilter = (query: FilterUsageType) => {

    fetchUserUsage(editingUser!, query).then((data: any) => {

      const labels = [];

      const series = [];

      for (const key in data.usages) {

        series.push(data.usages[key].used_traffic);

        labels.push(data.usages[key].node_name);

      }

      setUsage(createUsageConfig(colorMode, usageTitle, series, labels));

    });

  };



  useEffect(() => {
    if (editingUser) {
      const formatted = formatUser(editingUser);
      form.reset(formatted);
      setExpireDays(deriveDaysFromSeconds(formatted.expire));
      setNextPlanDays(deriveDaysFromSeconds(formatted.next_plan_expire));
      fetchUsageWithFilter({
        start: dayjs().utc().subtract(30, "day").format("YYYY-MM-DDTHH:00:00"),
      });
    } else {
      const defaults = getDefaultValues();
      form.reset(defaults);
      setExpireDays(deriveDaysFromSeconds(defaults.expire));
      setNextPlanDays(deriveDaysFromSeconds(defaults.next_plan_expire));
    }
  }, [editingUser, isEditing, isOpen]);



  const submit = (values: FormType) => {

    if (limitReached) {

      return;

    }

    setLoading(true);

    setError(null);



    const {

      service_id: _serviceId,

      next_plan_enabled,

      next_plan_data_limit,

      next_plan_expire,

      next_plan_add_remaining_traffic,

      next_plan_fire_on_either,

      proxies,

      inbounds,

      status,

      data_limit,

      data_limit_reset_strategy,

      on_hold_expire_duration,

      ip_limit,

      ...rest

    } = values;



    const normalizedNextPlanDataLimit =

      next_plan_enabled && next_plan_data_limit && next_plan_data_limit > 0

        ? Number((Number(next_plan_data_limit) * 1073741824).toFixed(5))

        : 0;



    const nextPlanPayload = next_plan_enabled

      ? {

          data_limit: normalizedNextPlanDataLimit,

          expire: next_plan_expire ?? 0,

          add_remaining_traffic: next_plan_add_remaining_traffic,

          fire_on_either: next_plan_fire_on_either,

        }

      : null;

    const normalizedIpLimit =
      typeof ip_limit === "number" && Number.isFinite(ip_limit) && ip_limit > 0
        ? Math.floor(ip_limit)
        : 0;



    if (!isEditing) {
      const effectiveServiceId =
        selectedServiceId ?? (nonSudoSingleService ? services[0]?.id ?? null : null);

      if (!effectiveServiceId) {
        setError(t("userDialog.selectService", "Please choose a service"));
        setLoading(false);
        return;
      }

      const serviceBody: UserCreateWithService = {

        username: values.username,

        service_id: effectiveServiceId,

        note: values.note,

        status:

          values.status === "active" ||

          values.status === "disabled" ||

          values.status === "on_hold"

            ? values.status

            : "active",

        expire: values.expire,

        data_limit: values.data_limit,

        ip_limit: normalizedIpLimit,

        data_limit_reset_strategy:

          data_limit && data_limit > 0

            ? data_limit_reset_strategy

            : "no_reset",

        on_hold_expire_duration:

          status === "on_hold" ? on_hold_expire_duration : null,

      };

      if (nextPlanPayload) {

        serviceBody.next_plan = nextPlanPayload;

      }



      createUserWithService(serviceBody)

        .then(() => {

          toast({

            title: t("userDialog.userCreated", { username: values.username }),

            status: "success",

            isClosable: true,

            position: "top",

            duration: 3000,

          });

          onClose();

        })

        .catch((err) => {

          if (err?.response?.status === 409 || err?.response?.status === 400) {

            setError(err?.response?._data?.detail);

          }

          if (err?.response?.status === 422) {

            Object.keys(err.response._data.detail).forEach((key) => {

              setError(err?.response._data.detail[key] as string);

              form.setError(

                key as "proxies" | "username" | "data_limit" | "expire",

                {

                  type: "custom",

                  message: err.response._data.detail[key],

                }

              );

            });

          }

        })

        .finally(() => {

          setLoading(false);

        });



      return;

    }



    const body: Record<string, unknown> = {

      ...rest,

      data_limit,

      ip_limit: normalizedIpLimit,

      data_limit_reset_strategy:

        data_limit && data_limit > 0 ? data_limit_reset_strategy : "no_reset",

      status:

        status === "active" || status === "disabled" || status === "on_hold"

          ? status

          : "active",

      on_hold_expire_duration:

        status === "on_hold" ? on_hold_expire_duration : null,

    };



    if (nextPlanPayload) {

      body.next_plan = nextPlanPayload;

    } else if (!next_plan_enabled && editingUser?.next_plan) {

      body.next_plan = null;

    }



    if (!editingUser?.service_id) {

      if (proxies && Object.keys(proxies).length > 0) {

        body.proxies = proxies;

      }

      if (inbounds && Object.keys(inbounds).length > 0) {

        body.inbounds = inbounds;

      }

    }



    if (typeof selectedServiceId !== "undefined") {

      if (selectedServiceId === null) {

        if (isSudo) {

          body.service_id = null;

        }

      } else if (selectedServiceId !== editingUser?.service_id) {

        body.service_id = selectedServiceId;

      }

    }



    editUser(editingUser!.username, body as UserCreate)

      .then(() => {

        toast({

          title: t("userDialog.userEdited", { username: values.username }),

          status: "success",

          isClosable: true,

          position: "top",

          duration: 3000,

        });

        onClose();

      })

      .catch((err) => {

        if (err?.response?.status === 409 || err?.response?.status === 400) {

          setError(err?.response?._data?.detail);

        }

        if (err?.response?.status === 422) {

          Object.keys(err.response._data.detail).forEach((key) => {

            setError(err?.response._data.detail[key] as string);

            form.setError(

              key as "proxies" | "username" | "data_limit" | "expire",

              {

                type: "custom",

                message: err.response._data.detail[key],

              }

            );

          });

        }

      })

      .finally(() => {

        setLoading(false);

      });

  };



  const onClose = () => {

    form.reset(getDefaultValues());
    setExpireDays(null);
    setNextPlanDays(null);

    onCreateUser(false);

    onEditingUser(null);

    setError(null);

    setUsageVisible(false);

    setUsageFilter("1m");

    setSelectedServiceId(null);

  };



  const handleResetUsage = () => {

    useDashboard.setState({ resetUsageUser: editingUser });

  };



  const handleRevokeSubscription = () => {

    useDashboard.setState({ revokeSubscriptionUser: editingUser });

  };



  const disabled = loading || limitReached;

  const isOnHold = userStatus === "on_hold";



  const [randomUsernameLoading, setrandomUsernameLoading] = useState(false);



  const createRandomUsername = (): string => {

    setrandomUsernameLoading(true);

    let result = "";

    const characters =

      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    const charactersLength = characters.length;

    let counter = 0;

    while (counter < 6) {

      result += characters.charAt(Math.floor(Math.random() * charactersLength));

      counter += 1;

    }

    return result;

  };



  return (

    <Modal isOpen={isOpen} onClose={onClose} size={shouldCompactModal ? "lg" : "2xl"}>

      <ModalOverlay bg="blackAlpha.300" backdropFilter="blur(10px)" />

      <FormProvider {...form}>

        <ModalContent mx="3" position="relative" overflow="hidden">

          <ModalCloseButton mt={3} disabled={loading} />

          <Box

            pointerEvents={limitReached ? "none" : "auto"}

            filter={limitReached ? "blur(6px)" : "none"}

            transition="filter 0.2s ease"

          >

            <form onSubmit={form.handleSubmit(submit)}>

            <ModalHeader pt={6}>

              <HStack gap={2}>

                <Icon color="primary">

                  {isEditing ? (

                    <EditUserIcon color="white" />

                  ) : (

                    <AddUserIcon color="white" />

                  )}

                </Icon>

                <Text fontWeight="semibold" fontSize="lg">

                  {isEditing

                    ? t("userDialog.editUserTitle")

                    : t("createNewUser")}

                </Text>

              </HStack>

            </ModalHeader>

            <ModalBody>

              {isEditing && isServiceManagedUser && (

                <Alert status="info" mb={4} borderRadius="md">

                  <AlertIcon />

                  {t(

                    "userDialog.serviceManagedNotice",

                    "This user is tied to service {{service}}. Update the service to change shared settings.",

                    {

                      service: editingUser?.service_name ?? "",

                    }

                  )}

                </Alert>

              )}

              <Grid
                templateColumns={{
                  base: "repeat(1, 1fr)",
                  md: useTwoColumns ? "repeat(2, 1fr)" : "minmax(0, 1fr)",
                }}
                gap={3}
                {...(shouldCenterForm ? { maxW: "720px", mx: "auto", w: "full" } : {})}
              >
                <GridItem>

                  <VStack justifyContent="space-between">

                    <Flex

                      flexDirection="column"

                      gridAutoRows="min-content"

                      w="full"

                    >

                      <Flex flexDirection="row" w="full" gap={2}>

                        <FormControl
                          mb={"10px"}
                          isInvalid={!!form.formState.errors.username?.message}
                        >
                          <FormLabel>{t("username")}</FormLabel>
                          <HStack align="flex-end">
                            <Box flex="1" minW="0">
                              <InputGroup size="sm">
                                <ChakraInput
                                  type="text"
                                  borderRadius="6px"
                                  placeholder={t("username")}
                                  isDisabled={disabled || isEditing}
                                  {...form.register("username")}
                                />
                                {!isEditing && (
                                  <InputRightElement width="auto" pr={1}>
                                    <IconButton
                                      aria-label={t(
                                        "userDialog.generateUsername",
                                        "Generate random username"
                                      )}
                                      size="sm"
                                      variant="ghost"
                                      icon={<SparklesIcon width={18} />}
                                      onClick={() => {
                                        const randomUsername = createRandomUsername();
                                        form.setValue("username", randomUsername, {
                                          shouldDirty: true,
                                        });
                                        setTimeout(() => {
                                          setrandomUsernameLoading(false);
                                        }, 350);
                                      }}
                                      isLoading={randomUsernameLoading}
                                      isDisabled={disabled}
                                    />
                                  </InputRightElement>
                                )}
                              </InputGroup>
                            </Box>
                            {isEditing && (
                              <HStack px={1}>
                                <Controller

                                  name="status"

                                  control={form.control}

                                  render={({ field }) => {

                                    return (

                                      <Tooltip

                                        placement="top"

                                        label={"status: " + t(`status.${field.value}`)}

                                        textTransform="capitalize"

                                      >

                                        <Box>

                                          <Switch

                                            colorScheme="primary"

                                            isChecked={field.value === "active"}

                                            onChange={(e) => {

                                              if (e.target.checked) {

                                                field.onChange("active");

                                              } else {

                                                field.onChange("disabled");

                                              }

                                            }}

                                          />

                                        </Box>

                                      </Tooltip>

                                    );

                                  }}

                                />

                              </HStack>

                            )}

                          </HStack>

                          <FormErrorMessage>
                            {form.formState.errors.username?.message}
                          </FormErrorMessage>

                        </FormControl>

                      </Flex>

                      <Stack
                        direction={{ base: "column", md: "row" }}
                        spacing={4}
                        mb={"10px"}
                      >
                        <FormControl flex="1">
                          <FormLabel>{t("userDialog.dataLimit")}</FormLabel>
                          <Controller
                            control={form.control}
                            name="data_limit"
                            render={({ field }) => {
                              return (
                                <Input
                                  endAdornment="GB"
                                  type="number"
                                  size="sm"
                                  borderRadius="6px"
                                  onChange={field.onChange}
                                  disabled={disabled}
                                  error={form.formState.errors.data_limit?.message}
                                  value={field.value ? String(field.value) : ""}
                                />
                              );
                            }}
                          />
                        </FormControl>
                        <FormControl flex="1">
                          <FormLabel display="flex" alignItems="center" gap={2}>
                            {t("userDialog.ipLimitLabel", "IP limit")}
                            <Tooltip
                              hasArrow
                              placement="top"
                              label={t(
                                "userDialog.ipLimitHint",
                                "Maximum number of unique IPs allowed. Leave empty or '-' for unlimited."
                              )}
                            >
                              <chakra.span display="inline-flex" color="gray.400" cursor="help">
                                <QuestionMarkCircleIcon width={16} height={16} />
                              </chakra.span>
                            </Tooltip>
                          </FormLabel>
                          <Controller
                            control={form.control}
                            name="ip_limit"
                            rules={{
                              validate: (value) => {
                                if (value === null || value === undefined) {
                                  return true;
                                }
                                if (typeof value !== "number" || Number.isNaN(value)) {
                                  return t(
                                    "userDialog.ipLimitValidation",
                                    "Enter a valid non-negative number"
                                  );
                                }
                                return value >= 0
                                  ? true
                                  : t(
                                      "userDialog.ipLimitValidation",
                                      "Enter a valid non-negative number"
                                    );
                              },
                            }}
                            render={({ field }) => (
                              <Input
                                size="sm"
                                borderRadius="6px"
                                placeholder={t(
                                  "userDialog.ipLimitPlaceholder",
                                  "Leave empty or '-' for unlimited"
                                )}
                                value={
                                  typeof field.value === "number" && field.value > 0
                                    ? String(field.value)
                                    : ""
                                }
                                onChange={(event) => {
                                  const raw = event.target.value;
                                  if (!raw.trim() || raw.trim() === "-") {
                                    field.onChange(null);
                                    return;
                                  }
                                  const parsed = Number(raw);
                                  if (Number.isNaN(parsed)) {
                                    return;
                                  }
                                  field.onChange(parsed < 0 ? 0 : Math.floor(parsed));
                                }}
                                disabled={disabled}
                                error={form.formState.errors.ip_limit?.message}
                              />
                            )}
                          />
                        </FormControl>
                      </Stack>

                      <Collapse

                        in={!!(dataLimit && dataLimit > 0)}

                        animateOpacity

                        style={{ width: "100%" }}

                      >

                        <FormControl height="66px">

                          <FormLabel>

                            {t("userDialog.periodicUsageReset")}

                          </FormLabel>

                          <Controller

                            control={form.control}

                            name="data_limit_reset_strategy"

                            render={({ field }) => {

                              return (

                                <Select

                                  size="sm"

                                  {...field}

                                  disabled={disabled}

                                  bg={disabled ? "gray.100" : "transparent"}

                                  _dark={{

                                    bg: disabled ? "gray.600" : "transparent",

                                  }}

                                  sx={{

                                    option: {

                                      backgroundColor: colorMode === "dark" ? "#222C3B" : "white"

                                    }

                                  }}

                                >

                                  {resetStrategy.map((s) => {

                                    return (

                                      <option key={s.value} value={s.value}>

                                        {t(

                                          "userDialog.resetStrategy" + s.title

                                        )}

                                      </option>

                                    );

                                  })}

                                </Select>

                              );

                            }}

                          />

                        </FormControl>

                      </Collapse>



                      <FormControl
                        mb={"10px"}
                        isInvalid={!isOnHold && Boolean(form.formState.errors.expire)}
                      >
                        <Flex
                          justify="space-between"
                          align={{ base: "flex-start", md: "center" }}
                          gap={{ base: 2, md: 4 }}
                          flexDirection={{ base: "column", md: "row" }}
                        >
                          <FormLabel mb={0}>
                            {isOnHold
                              ? t("userDialog.onHoldExpireDuration")
                              : t("userDialog.expiryDaysLabel", "Expires in (days)")}
                          </FormLabel>
                          {!isEditing && (
                            <Controller
                              name="status"
                              control={form.control}
                              render={({ field }) => {
                                const checked = field.value === "on_hold";
                                return (
                                  <HStack spacing={2} align="center">
                                    <Text fontSize="sm" color="gray.600" _dark={{ color: "gray.400" }}>
                                      {t("userDialog.onHold")}
                                    </Text>
                                    <Switch
                                      colorScheme="primary"
                                      isChecked={checked}
                                      onChange={(event) => {
                                        const nextChecked = event.target.checked;
                                        if (nextChecked) {
                                          field.onChange("on_hold");
                                        } else {
                                          field.onChange("active");
                                          form.setValue("on_hold_expire_duration", null, {
                                            shouldDirty: true,
                                          });
                                        }
                                      }}
                                      isDisabled={disabled}
                                    />
                                  </HStack>
                                );
                              }}
                            />
                          )}
                        </Flex>

                        {isOnHold ? (
                          <Controller
                            control={form.control}
                            name="on_hold_expire_duration"
                            render={({ field }) => {
                              return (
                                <Input
                                  endAdornment="Days"
                                  type="number"
                                  size="sm"
                                  borderRadius="6px"
                                  onChange={(event) => {
                                    form.setValue("expire", null);
                                    const raw = event.target.value;
                                    if (!raw) {
                                      field.onChange(null);
                                      return;
                                    }
                                    const parsed = Number(raw);
                                    if (Number.isNaN(parsed) || parsed < 0) {
                                      return;
                                    }
                                    field.onChange(Math.round(parsed));
                                  }}
                                  disabled={disabled}
                                  error={
                                    form.formState.errors
                                      .on_hold_expire_duration?.message
                                  }
                                  value={field.value ? String(field.value) : ""}
                                />
                              );
                            }}
                          />
                        ) : (
                          <>
                            <Controller
                              name="expire"
                              control={form.control}
                              render={({ field }) => {
                                const { status, time } = relativeExpiryDate(field.value);
                                const handleDaysChange = (valueAsString: string) => {
                                  if (!valueAsString) {
                                    setExpireDays(null);
                                    field.onChange(null);
                                    return;
                                  }
                                  const parsed = Number(valueAsString);
                                  if (Number.isNaN(parsed) || parsed < 0) {
                                    return;
                                  }
                                  const normalizedDays = Math.min(Math.round(parsed), 3650);
                                  setExpireDays(normalizedDays);
                                  form.setValue("on_hold_expire_duration", null, {
                                    shouldDirty: false,
                                  });
                                  const normalized = convertDaysToSecondsFromNow(
                                    normalizedDays
                                  );
                                  field.onChange(normalized);
                                };

                                return (
                                  <Box flex="1" minW="180px">
                                    <Input
                                      endAdornment={t("userDialog.days", "Days")}
                                      type="number"
                                      size="sm"
                                      borderRadius="6px"
                                      value={
                                        typeof expireDays === "number" ? String(expireDays) : ""
                                      }
                                      onChange={(event) => handleDaysChange(event.target.value)}
                                      disabled={disabled}
                                      error={form.formState.errors.expire?.message}
                                    />
                                    {field.value ? (
                                      <FormHelperText>{t(status, { time })}</FormHelperText>
                                    ) : null}
                                  </Box>
                                );
                              }}
                            />
                            <FormErrorMessage>
                              {form.formState.errors.expire?.message}
                            </FormErrorMessage>
                          </>
                        )}
                      </FormControl>

                      <Box mb={"10px"}>
                        <HStack justify="space-between" align="center">
                          <FormLabel mb={0}>{t("userDialog.nextPlanTitle", "Next plan")}</FormLabel>
                          <Switch
                            colorScheme="primary"
                            isChecked={nextPlanEnabled}
                            onChange={(event) => handleNextPlanToggle(event.target.checked)}
                            isDisabled={disabled}
                          />
                        </HStack>
                        <Text fontSize="xs" color="gray.500" _dark={{ color: "gray.400" }} mt={1}>
                          {t(
                            "userDialog.nextPlanDescription",
                            "Configure automatic renewal details for this user."
                          )}
                        </Text>
                        <Collapse in={nextPlanEnabled} animateOpacity style={{ width: "100%" }}>
                          <VStack align="stretch" spacing={3} mt={3}>
                            <FormControl>
                              <FormLabel fontSize="sm">
                                {t("userDialog.nextPlanDataLimit", "Next plan data limit")}
                              </FormLabel>
                              <Input
                                endAdornment="GB"
                                type="number"
                                size="sm"
                                borderRadius="6px"
                                disabled={disabled}
                                value={
                                  nextPlanDataLimit !== null && typeof nextPlanDataLimit !== "undefined"
                                    ? String(nextPlanDataLimit)
                                    : ""
                                }
                                onChange={(event) => {
                                  const rawValue = event.target.value;
                                  if (!rawValue) {
                                    form.setValue("next_plan_data_limit", null, { shouldDirty: true });
                                    return;
                                  }
                                  const parsed = Number(rawValue);
                                  if (Number.isNaN(parsed)) {
                                    return;
                                  }
                                  form.setValue("next_plan_data_limit", Math.max(0, parsed), {
                                    shouldDirty: true,
                                  });
                                }}
                              />
                            </FormControl>
                            <FormControl>
                              <FormLabel fontSize="sm">
                                {t("userDialog.nextPlanExpireDays", "Next plan in (days)")}
                              </FormLabel>
                              <Controller
                                control={form.control}
                                name="next_plan_expire"
                                render={({ field }) => {
                                  const handleDaysChange = (valueAsString: string) => {
                                    if (!valueAsString) {
                                      setNextPlanDays(null);
                                      field.onChange(null);
                                      return;
                                    }
                                    const parsed = Number(valueAsString);
                                    if (Number.isNaN(parsed) || parsed < 0) {
                                      return;
                                    }
                                    const normalizedDays = Math.min(Math.round(parsed), 3650);
                                    setNextPlanDays(normalizedDays);
                                    const normalized = convertDaysToSecondsFromNow(
                                      normalizedDays
                                    );
                                    field.onChange(normalized);
                                  };

                                  return (
                                    <Input
                                      endAdornment={t("userDialog.days", "Days")}
                                      type="number"
                                      size="sm"
                                      borderRadius="6px"
                                      value={
                                        typeof nextPlanDays === "number"
                                          ? String(nextPlanDays)
                                          : ""
                                      }
                                      onChange={(event) => handleDaysChange(event.target.value)}
                                      disabled={disabled}
                                    />
                                  );
                                }}
                              />
                            </FormControl>
                            <HStack justify="space-between">
                              <Text fontSize="sm" color="gray.600" _dark={{ color: "gray.400" }}>
                                {t(
                                  "userDialog.nextPlanAddRemainingTraffic",
                                  "Carry over remaining traffic"
                                )}
                              </Text>
                              <Switch
                                size="sm"
                                colorScheme="primary"
                                isChecked={Boolean(nextPlanAddRemainingTraffic)}
                                onChange={(event) =>
                                  form.setValue(
                                    "next_plan_add_remaining_traffic",
                                    event.target.checked,
                                    { shouldDirty: true }
                                  )
                                }
                                isDisabled={disabled}
                              />
                            </HStack>
                            <HStack justify="space-between">
                              <Text fontSize="sm" color="gray.600" _dark={{ color: "gray.400" }}>
                                {t(
                                  "userDialog.nextPlanFireOnEither",
                                  "Trigger on data or expiry"
                                )}
                              </Text>
                              <Switch
                                size="sm"
                                colorScheme="primary"
                                isChecked={Boolean(nextPlanFireOnEither)}
                                onChange={(event) =>
                                  form.setValue("next_plan_fire_on_either", event.target.checked, {
                                    shouldDirty: true,
                                  })
                                }
                                isDisabled={disabled}
                              />
                            </HStack>
                          </VStack>
                        </Collapse>
                      </Box>

                      <FormControl

                        mb={"10px"}

                        isInvalid={!!form.formState.errors.note}

                      >

                        <FormLabel>{t("userDialog.note")}</FormLabel>

                        <Textarea {...form.register("note")} />

                        <FormErrorMessage>

                          {form.formState.errors?.note?.message}

                        </FormErrorMessage>

                      </FormControl>

                    </Flex>

                    {error && (

                      <Alert

                        status="error"

                        display={{ base: "none", md: "flex" }}

                      >

                        <AlertIcon />

                        {error}

                      </Alert>

                    )}

                  </VStack>

                </GridItem>

                {showServiceSelector && (
                <GridItem mt={useTwoColumns ? 0 : 4}>

                  <FormControl isRequired={!isEditing}>

                    <FormLabel>{t("userDialog.selectServiceLabel", "Service")}</FormLabel>

                    {servicesLoading ? (

                      <HStack spacing={2} py={4}>

                        <Spinner size="sm" />

                        <Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }}>

                          {t("loading")}

                        </Text>

                      </HStack>

                    ) : hasServices ? (

                      <VStack align="stretch" spacing={3}>

                        {isEditing && isSudo && (

                          <Box

                            role="button"

                            tabIndex={disabled ? -1 : 0}

                            aria-pressed={selectedServiceId === null}

                            onKeyDown={(event) => {

                              if (disabled) return;

                              if (event.key === "Enter" || event.key === " ") {

                                event.preventDefault();

                                setSelectedServiceId(null);

                              }

                            }}

                            onClick={() => {

                              if (disabled) return;

                              setSelectedServiceId(null);

                            }}

                            borderWidth="1px"

                            borderRadius="md"

                            p={4}

                            borderColor={

                              selectedServiceId === null ? "primary.500" : "gray.200"

                            }

                            bg={selectedServiceId === null ? "primary.50" : "transparent"}

                            cursor={disabled ? "not-allowed" : "pointer"}

                            pointerEvents={disabled ? "none" : "auto"}

                            transition="border-color 0.2s ease, background-color 0.2s ease"

                            _hover={

                              disabled

                                ? {}

                                : {

                                    borderColor: selectedServiceId === null ? "primary.500" : "gray.300",

                                  }

                            }

                            _dark={{

                              borderColor:

                                selectedServiceId === null ? "primary.400" : "gray.700",

                              bg:

                                selectedServiceId === null ? "primary.900" : "transparent",

                            }}

                          >

                            <Text fontWeight="semibold">

                              {t("userDialog.noServiceOption", "No service")}

                            </Text>

                            <Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }} mt={1}>

                              {t(

                                "userDialog.noServiceHelper",

                                "Keep this user detached from shared service settings."

                              )}

                            </Text>

                          </Box>

                        )}

                        {services.map((service) => {

                          const isSelected = selectedServiceId === service.id;

                          return (

                            <Box

                              key={service.id}

                              role="button"

                              tabIndex={disabled ? -1 : 0}

                              aria-pressed={isSelected}

                              onKeyDown={(event) => {

                                if (disabled) return;

                                if (event.key === "Enter" || event.key === " ") {

                                  event.preventDefault();

                                  setSelectedServiceId(service.id);

                                }

                              }}

                              onClick={() => {

                                if (disabled) return;

                                setSelectedServiceId(service.id);

                              }}

                              borderWidth="1px"

                            borderRadius="md"

                            p={4}

                            borderColor={isSelected ? "primary.500" : "gray.200"}

                            bg={isSelected ? "primary.50" : "transparent"}

                            cursor={disabled ? "not-allowed" : "pointer"}

                            pointerEvents={disabled ? "none" : "auto"}

                            transition="border-color 0.2s ease, background-color 0.2s ease"

                            _hover={

                              disabled

                                ? {}

                                : {

                                      borderColor: isSelected ? "primary.500" : "gray.300",

                                    }

                              }

                              _dark={{

                                borderColor: isSelected ? "primary.400" : "gray.700",

                                bg: isSelected ? "primary.900" : "transparent",

                              }}

                            >

                              <HStack justify="space-between" align="flex-start">

                                <VStack align="flex-start" spacing={0}>

                                  <Text fontWeight="semibold">{service.name}</Text>

                                  {service.description && (

                                    <Text

                                      fontSize="sm"

                                      color="gray.500"

                                      _dark={{ color: "gray.400" }}

                                    >

                                      {service.description}

                                    </Text>

                                  )}

                                </VStack>

                                <Text fontSize="xs" color="gray.500" _dark={{ color: "gray.400" }}>

                                  {t("userDialog.serviceSummary", "{{hosts}} hosts, {{users}} users", {

                                    hosts: service.host_count,

                                    users: service.user_count,

                                  })}

                                </Text>

                              </HStack>

                            </Box>

                          );

                        })}

                      </VStack>

                    ) : (

                      <Alert status="warning" borderRadius="md">

                        <AlertIcon />

                        {t(

                          "userDialog.noServicesAvailable",

                          "No services are available yet. Create a service to manage users."

                        )}

                      </Alert>

                    )}

                    {selectedService && (

                      <FormHelperText mt={2}>

                        {t(

                          "userDialog.serviceSummary",

                          "{{hosts}} hosts, {{users}} users",

                          {

                            hosts: selectedService.host_count,

                            users: selectedService.user_count,

                          }

                        )}

                      </FormHelperText>

                    )}

                  </FormControl>

                </GridItem>
                )}

                {isEditing && usageVisible && (

                  <GridItem
                    pt={6}
                    colSpan={{ base: 1, md: showServiceSelector ? 2 : 1 }}
                  >

                    <VStack gap={4}>

                      <UsageFilter

                        defaultValue={usageFilter}

                        onChange={(filter, query) => {

                          setUsageFilter(filter);

                          fetchUsageWithFilter(query);

                        }}

                      />

                      <Box

                        width={{ base: "100%", md: "70%" }}

                        justifySelf="center"

                      >

                        <ReactApexChart

                          options={usage.options}

                          series={usage.series}

                          type="donut"

                        />

                      </Box>

                    </VStack>

                  </GridItem>

                )}

              </Grid>

              {error && (

                <Alert

                  mt="3"

                  status="error"

                  display={{ base: "flex", md: "none" }}

                >

                  <AlertIcon />

                  {error}

                </Alert>

              )}

            </ModalBody>

            <ModalFooter mt="3">

              <HStack

                justifyContent="space-between"

                w="full"

                gap={3}

                flexDirection={{

                  base: "column",

                  sm: "row",

                }}

              >

                <HStack

                  justifyContent="flex-start"

                  w={{

                    base: "full",

                    sm: "unset",

                  }}

                >

                  {isEditing && (

                    <>

                      <Tooltip label={t("delete")} placement="top">

                        <IconButton

                          aria-label="Delete"

                          size="sm"

                          onClick={() => {

                            onDeletingUser(editingUser);

                            onClose();

                          }}

                        >

                          <DeleteIcon />

                        </IconButton>

                      </Tooltip>

                      <Tooltip label={t("userDialog.usage")} placement="top">

                        <IconButton

                          aria-label="usage"

                          size="sm"

                          onClick={handleUsageToggle}

                        >

                          <UserUsageIcon />

                        </IconButton>

                      </Tooltip>

                      <Button onClick={handleResetUsage} size="sm">

                        {t("userDialog.resetUsage")}

                      </Button>

                      <Button onClick={handleRevokeSubscription} size="sm">

                        {t("userDialog.revokeSubscription")}

                      </Button>

                    </>

                  )}

                </HStack>

                <HStack

                  w="full"

                  maxW={{ md: "50%", base: "full" }}

                  justify="end"

                >

                  <Button

                    type="submit"

                    size="sm"

                    px="8"

                    colorScheme="primary"

                    leftIcon={loading ? <Spinner size="xs" /> : undefined}

                    disabled={disabled}

                  >

                    {isEditing ? t("userDialog.editUser") : t("createUser")}

                  </Button>

                </HStack>

              </HStack>

            </ModalFooter>

          </form>

          </Box>

          {limitReached && (

            <Flex

              position="absolute"

              inset={0}

              align="center"

              justify="center"

              direction="column"

              gap={4}

              bg="blackAlpha.600"

              color="white"

              textAlign="center"

              p={6}

              pointerEvents="none"

            >

              <Icon color="primary">

                <LimitLockIcon />

              </Icon>

              <Text fontSize="xl" fontWeight="semibold">

                {t("userDialog.limitReachedTitle")}

              </Text>

              <Text fontSize="md" maxW="sm">

                {usersLimit && usersLimit > 0

                  ? t("userDialog.limitReachedBody", {

                      limit: usersLimit,

                      active: activeUsersCount ?? usersLimit,

                    })

                  : t("userDialog.limitReachedContent")}

              </Text>

            </Flex>

          )}

        </ModalContent>

      </FormProvider>

    </Modal>

  );

};






