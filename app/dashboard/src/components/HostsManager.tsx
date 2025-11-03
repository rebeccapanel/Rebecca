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
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerOverlay,
  FormControl,
  FormLabel,
  HStack,
  IconButton,
  Input,
  InputGroup,
  InputRightElement,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  NumberInput,
  NumberInputField,
  Popover,
  PopoverArrow,
  PopoverBody,
  PopoverCloseButton,
  PopoverContent,
  PopoverTrigger,
  Portal,
  Select,
  SimpleGrid,
  Spinner,
  Stack,
  Switch,
  Tag,
  Text,
  Tooltip,
  VStack,
  chakra,
  useToast,
} from "@chakra-ui/react";
import { InformationCircleIcon, PencilIcon, PlusIcon, Bars3Icon } from "@heroicons/react/24/outline";
import {
  FC,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Reorder, useDragControls } from "framer-motion";
import { useTranslation } from "react-i18next";

import { useHosts, HostsSchema } from "contexts/HostsContext";
import { fetchInbounds, useDashboard } from "contexts/DashboardContext";
import { proxyALPN, proxyFingerprint, proxyHostSecurity } from "constants/Proxies";
import { DeleteIcon } from "./DeleteUserModal";

type HostData = {
  remark: string;
  address: string;
  sort: number;
  port: number | null;
  path: string;
  sni: string;
  host: string;
  mux_enable: boolean;
  allowinsecure: boolean;
  is_disabled: boolean;
  fragment_setting: string;
  noise_setting: string;
  random_user_agent: boolean;
  security: string;
  alpn: string;
  fingerprint: string;
  use_sni_as_host: boolean;
};

type HostState = {
  uid: string;
  inboundTag: string;
  data: HostData;
  original: HostData;
};

type InboundOption = {
  label: string;
  value: string;
  protocol: string;
  network: string;
};

type CreateHostValues = {
  inboundTag: string;
  remark: string;
  address: string;
  sort: number;
  port: number | null;
  path: string;
  sni: string;
  host: string;
};

const EditIcon = chakra(PencilIcon, {
  baseStyle: {
    w: 4,
    h: 4,
  },
});

const AddIcon = chakra(PlusIcon, {
  baseStyle: {
    w: 4,
    h: 4,
  },
});

const HandleIcon = chakra(Bars3Icon, {
  baseStyle: {
    w: 4,
    h: 4,
  },
});

const InfoIcon = chakra(InformationCircleIcon, {
  baseStyle: {
    w: 4,
    h: 4,
    color: "gray.400",
    cursor: "pointer",
  },
});

const DYNAMIC_TOKENS: Array<{ token: string; labelKey: string }> = [
  { token: "{SERVER_IP}", labelKey: "hostsDialog.currentServer" },
  { token: "{SERVER_IPV6}", labelKey: "hostsDialog.currentServerv6" },
  { token: "{USERNAME}", labelKey: "hostsDialog.username" },
  { token: "{DATA_USAGE}", labelKey: "hostsDialog.dataUsage" },
  { token: "{DATA_LEFT}", labelKey: "hostsDialog.remainingData" },
  { token: "{DATA_LIMIT}", labelKey: "hostsDialog.dataLimit" },
  { token: "{DAYS_LEFT}", labelKey: "hostsDialog.remainingDays" },
  { token: "{EXPIRE_DATE}", labelKey: "hostsDialog.expireDate" },
  { token: "{JALALI_EXPIRE_DATE}", labelKey: "hostsDialog.jalaliExpireDate" },
  { token: "{TIME_LEFT}", labelKey: "hostsDialog.remainingTime" },
  { token: "{STATUS_TEXT}", labelKey: "hostsDialog.statusText" },
  { token: "{STATUS_EMOJI}", labelKey: "hostsDialog.statusEmoji" },
  { token: "{PROTOCOL}", labelKey: "hostsDialog.proxyProtocol" },
  { token: "{TRANSPORT}", labelKey: "hostsDialog.proxyMethod" },
];

const DynamicTokensPopover: FC = () => {
  const { t } = useTranslation();

  return (
    <Popover isLazy placement="right">
      <PopoverTrigger>
        <Box mt="-1">
          <InfoIcon />
        </Box>
      </PopoverTrigger>
      <Portal>
        <PopoverContent maxW="xs" fontSize="xs">
          <PopoverArrow />
          <PopoverCloseButton />
          <PopoverBody>
            <Box pr={5} lineHeight="1.4">
              <Text mb={2}>{t("hostsDialog.desc")}</Text>
              {DYNAMIC_TOKENS.map(({ token, labelKey }) => (
                <Text key={token} mt={1}>
                  <Badge mr={2}>{token}</Badge>
                  {t(labelKey)}
                </Text>
              ))}
            </Box>
          </PopoverBody>
        </PopoverContent>
      </Portal>
    </Popover>
  );
};

const createUid = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const safeSortValue = (value: number | null | undefined) =>
  typeof value === "number" && !Number.isNaN(value) ? value : Number.MAX_SAFE_INTEGER;

const normalizeString = (value: string | null | undefined) => (value ?? "").trim();

const normalizeBoolean = (value: boolean | null | undefined, fallback = false) =>
  typeof value === "boolean" ? value : fallback;

const normalizeHostData = (
  host: HostsSchema[string][number],
  fallbackSort: number
): HostData => ({
  remark: host.remark ?? "",
  address: host.address ?? "",
  sort: host.sort ?? fallbackSort,
  port: host.port ?? null,
  path: normalizeString(host.path),
  sni: normalizeString(host.sni),
  host: normalizeString(host.host),
  mux_enable: normalizeBoolean(host.mux_enable),
  allowinsecure: normalizeBoolean(host.allowinsecure),
  is_disabled: normalizeBoolean(host.is_disabled, false),
  fragment_setting: normalizeString(host.fragment_setting),
  noise_setting: normalizeString(host.noise_setting),
  random_user_agent: normalizeBoolean(host.random_user_agent),
  security: host.security ?? "inbound_default",
  alpn: host.alpn ?? "",
  fingerprint: host.fingerprint ?? "",
  use_sni_as_host: normalizeBoolean(host.use_sni_as_host),
});

const cloneHostData = (data: HostData): HostData => ({
  remark: data.remark,
  address: data.address,
  sort: data.sort,
  port: data.port ?? null,
  path: data.path,
  sni: data.sni,
  host: data.host,
  mux_enable: data.mux_enable,
  allowinsecure: data.allowinsecure,
  is_disabled: data.is_disabled,
  fragment_setting: data.fragment_setting,
  noise_setting: data.noise_setting,
  random_user_agent: data.random_user_agent,
  security: data.security,
  alpn: data.alpn,
  fingerprint: data.fingerprint,
  use_sni_as_host: data.use_sni_as_host,
});

const serializeHostData = (data: HostData) => ({
  ...data,
  port: data.port ?? null,
  path: normalizeString(data.path),
  sni: normalizeString(data.sni),
  host: normalizeString(data.host),
  fragment_setting: normalizeString(data.fragment_setting),
  noise_setting: normalizeString(data.noise_setting),
});

const isHostDirty = (host: HostState) => {
  const current = serializeHostData(host.data);
  const original = serializeHostData(host.original);
  return JSON.stringify(current) !== JSON.stringify(original);
};

const formatHostForApi = (data: HostData): HostsSchema[string][number] => ({
  remark: data.remark.trim(),
  address: data.address.trim(),
  sort: data.sort,
  port: data.port,
  path: data.path.trim() ? data.path.trim() : null,
  sni: data.sni.trim() ? data.sni.trim() : null,
  host: data.host.trim() ? data.host.trim() : null,
  mux_enable: data.mux_enable,
  allowinsecure: data.allowinsecure,
  is_disabled: data.is_disabled,
  fragment_setting: data.fragment_setting.trim() ? data.fragment_setting.trim() : null,
  noise_setting: data.noise_setting.trim() ? data.noise_setting.trim() : null,
  random_user_agent: data.random_user_agent,
  security: data.security || "inbound_default",
  alpn: data.alpn || "",
  fingerprint: data.fingerprint || "",
  use_sni_as_host: data.use_sni_as_host,
});

const sortHosts = (hosts: HostState[]) =>
  [...hosts].sort((a, b) => {
    const diff = safeSortValue(a.data.sort) - safeSortValue(b.data.sort);
    if (diff !== 0) return diff;
    return a.data.remark.localeCompare(b.data.remark);
  });

const mapHostsToState = (hosts: HostsSchema): HostState[] => {
  const result: HostState[] = [];
  Object.entries(hosts).forEach(([tag, hostList]) => {
    hostList.forEach((host, index) => {
      const normalized = normalizeHostData(host, index);
      result.push({
        uid: createUid(),
        inboundTag: tag,
        data: cloneHostData(normalized),
        original: cloneHostData(normalized),
      });
    });
  });
  return sortHosts(result);
};

const groupHostsByInbound = (items: HostState[]): HostsSchema => {
  const grouped = new Map<string, HostData[]>();
  items.forEach((host) => {
    const list = grouped.get(host.inboundTag) ?? [];
    list.push(host.data);
    grouped.set(host.inboundTag, list);
  });
  const result: HostsSchema = {};
  grouped.forEach((value, key) => {
    result[key] = value
      .map((host) => formatHostForApi(host))
      .sort((a, b) => safeSortValue(a.sort) - safeSortValue(b.sort));
  });
  return result;
};

const sliceInboundPayload = (items: HostState[], inboundTag: string): HostsSchema => {
  const grouped = groupHostsByInbound(items);
  return { [inboundTag]: grouped[inboundTag] ?? [] };
};

type HostCardProps = {
  host: HostState;
  inboundOptions: InboundOption[];
  orderIndex: number;
  onToggleActive: (uid: string, active: boolean) => void;
  onEdit: (uid: string) => void;
  onDelete: (uid: string) => void;
  saving: boolean;
  deleting: boolean;
};

const HostCard: FC<HostCardProps> = ({
  host,
  inboundOptions,
  orderIndex,
  onToggleActive,
  onEdit,
  onDelete,
  saving,
  deleting,
}) => {
  const { t } = useTranslation();
  const inbound = inboundOptions.find((option) => option.value === host.inboundTag);
  const active = !host.data.is_disabled;
  const dirty = isHostDirty(host);
  const hostName = host.data.remark || t("hostsPage.untitledHost");

  return (
    <Card
      borderWidth="1px"
      borderColor={dirty ? "primary.400" : "gray.200"}
      _dark={{
        borderColor: dirty ? "primary.300" : "gray.700",
        bg: dirty ? "gray.800" : "gray.900",
      }}
      cursor="pointer"
      onClick={() => onEdit(host.uid)}
      transition="border-color 0.2s ease"
      _hover={{ borderColor: "primary.400" }}
    >
      <CardBody as={Stack} spacing={4}>
        <HStack justify="space-between" align="center" wrap="wrap" rowGap={2}>
          <VStack align="flex-start" spacing={1} flex="1">
            <Tooltip label={host.data.remark} isDisabled={!host.data.remark}>
              <Text fontWeight="semibold" noOfLines={1} maxW="full">
                {hostName}
              </Text>
            </Tooltip>
            <HStack spacing={2} flexWrap="wrap">
              <Tag colorScheme="gray" size="sm">
                {t("hostsPage.orderIndex", { value: orderIndex + 1 })}
              </Tag>
              {inbound && (
                <Tag colorScheme="purple" size="sm">
                  {`${inbound.value} (${inbound.protocol.toUpperCase()} - ${inbound.network})`}
                </Tag>
              )}
              {typeof host.data.port === "number" && (
                <Tag colorScheme="blue" size="sm">
                  {t("hostsPage.portTag", { value: host.data.port })}
                </Tag>
              )}
              {dirty && (
                <Tag colorScheme="orange" size="sm">
                  {t("hostsPage.unsaved")}
                </Tag>
              )}
            </HStack>
          </VStack>
          <HStack spacing={2}>
            <Switch
              size="sm"
              colorScheme="primary"
              isChecked={active}
              onChange={(event) => {
                event.stopPropagation();
                onToggleActive(host.uid, event.target.checked);
              }}
              aria-label={t("hostsPage.toggleActive")}
            />
            <Text fontSize="sm" color="gray.600" _dark={{ color: "gray.300" }}>
              {active ? t("hostsPage.enabled") : t("hostsPage.disabled")}
            </Text>
          </HStack>
        </HStack>

        <VStack align="stretch" spacing={2} color="gray.600" _dark={{ color: "gray.300" }}>
          <Text fontSize="sm">{host.data.address || t("hostsPage.noAddress")}</Text>
          {host.data.path && (
            <Text fontSize="sm" noOfLines={1}>
              {t("hostsDialog.path")}: {host.data.path}
            </Text>
          )}
          {host.data.sni && (
            <Text fontSize="sm" noOfLines={1}>
              {t("hostsDialog.sni")}: {host.data.sni}
            </Text>
          )}
        </VStack>

        <HStack justify="space-between">
          <Button
            size="sm"
            variant="outline"
            leftIcon={<EditIcon />}
            onClick={(event) => {
              event.stopPropagation();
              onEdit(host.uid);
            }}
            isLoading={saving}
          >
            {t("hostsPage.edit")}
          </Button>
          <IconButton
            aria-label={t("hostsPage.delete")}
            size="sm"
            colorScheme="red"
            variant="ghost"
            onClick={(event) => {
              event.stopPropagation();
              onDelete(host.uid);
            }}
            icon={<DeleteIcon />}
            isLoading={deleting}
          />
        </HStack>
      </CardBody>
    </Card>
  );
};

type SortRowProps = {
  host: HostState;
  index: number;
};

const SortRow: FC<SortRowProps> = ({ host, index }) => {
  const { t } = useTranslation();
  const dragControls = useDragControls();
  const hostName = host.data.remark || t("hostsPage.untitledHost");

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }
      event.preventDefault();
      dragControls.start(event);
    },
    [dragControls]
  );

  return (
    <Reorder.Item
      value={host}
      id={host.uid}
      dragListener={false}
      dragControls={dragControls}
      drag
      dragMomentum={false}
      whileDrag={{ zIndex: 10, scale: 1.01 }}
      dragTransition={{ bounceStiffness: 600, bounceDamping: 40 }}
      style={{ listStyle: "none", touchAction: "none" }}
    >
      <HStack
        borderWidth="1px"
        borderRadius="md"
        borderColor="gray.200"
        _dark={{ borderColor: "gray.600", bg: "gray.800" }}
        px={4}
        py={3}
        spacing={4}
        align="center"
      >
        <Tooltip label={t("hostsPage.dragHandle")} hasArrow>
          <IconButton
            aria-label={t("hostsPage.dragHandle")}
            size="sm"
            variant="ghost"
            icon={<HandleIcon />}
            cursor="grab"
            onPointerDown={handlePointerDown}
            style={{ touchAction: "none" }}
          />
        </Tooltip>
        <Tag colorScheme="gray" size="sm">
          {t("hostsPage.orderIndex", { value: index + 1 })}
        </Tag>
        <VStack align="flex-start" spacing={0} flex="1">
          <Tooltip label={host.data.remark} isDisabled={!host.data.remark}>
            <Text fontWeight="medium" noOfLines={1} maxW="full">
              {hostName}
            </Text>
          </Tooltip>
          <Text fontSize="sm" color="gray.500" _dark={{ color: "gray.300" }} noOfLines={1}>
            {host.data.address || host.inboundTag}
          </Text>
        </VStack>
      </HStack>
    </Reorder.Item>
  );
};

type HostDetailDrawerProps = {
  host: HostState | null;
  inboundOptions: InboundOption[];
  isOpen: boolean;
  onClose: () => void;
  onChange: <Key extends keyof HostData>(
    uid: string,
    key: Key,
    value: HostData[Key]
  ) => void;
  onChangeInbound: (uid: string, inboundTag: string) => void;
  onSave: (uid: string) => void;
  onReset: (uid: string) => void;
  onDelete: (uid: string) => void;
  saving: boolean;
  deleting: boolean;
};

const HostDetailDrawer: FC<HostDetailDrawerProps> = ({
  host,
  inboundOptions,
  isOpen,
  onClose,
  onChange,
  onChangeInbound,
  onSave,
  onReset,
  onDelete,
  saving,
  deleting,
}) => {
  const { t } = useTranslation();

  if (!host) {
    return null;
  }

  const inbound = inboundOptions.find((option) => option.value === host.inboundTag);
  const dirty = isHostDirty(host);

  return (
    <Drawer isOpen={isOpen} placement="right" size="xl" onClose={onClose}>
      <DrawerOverlay bg="blackAlpha.300" backdropFilter="blur(8px)" />
      <DrawerContent>
        <DrawerCloseButton />
        <DrawerHeader pb={1}>
          <VStack align="stretch" spacing={1}>
            <Text fontWeight="semibold" fontSize="lg">
              {host.data.remark || t("hostsPage.untitledHost")}
            </Text>
            <Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }}>
              {host.data.address || t("hostsPage.noAddress")}
            </Text>
            {inbound && (
              <Tag colorScheme="purple" size="sm" alignSelf="flex-start">
                {`${inbound.value} (${inbound.protocol.toUpperCase()} - ${inbound.network})`}
              </Tag>
            )}
          </VStack>
        </DrawerHeader>
        <DrawerBody>
          <VStack align="stretch" spacing={5}>
            <Card variant="outline">
              <CardHeader pb={2}>
                <Text fontWeight="semibold">{t("hostsPage.section.general")}</Text>
              </CardHeader>
              <CardBody pt={0}>
                <VStack align="stretch" spacing={4}>
                  <FormControl>
                    <FormLabel>{t("hostsDialog.remark")}</FormLabel>
                    <InputGroup>
                      <Input
                        value={host.data.remark}
                        onChange={(event) => onChange(host.uid, "remark", event.target.value)}
                      />
                      <InputRightElement width="auto" pr={2} pointerEvents="auto">
                        <DynamicTokensPopover />
                      </InputRightElement>
                    </InputGroup>
                  </FormControl>
                  <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
                    <FormControl>
                      <FormLabel>{t("hostsPage.inboundLabel")}</FormLabel>
                      <Select
                        value={host.inboundTag}
                        onChange={(event) => onChangeInbound(host.uid, event.target.value)}
                      >
                        {inboundOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                    </FormControl>
                    <FormControl>
                      <FormLabel>{t("hostsDialog.sort")}</FormLabel>
                      <NumberInput
                        value={host.data.sort}
                        allowMouseWheel
                        onChange={(_, num) =>
                          onChange(host.uid, "sort", Number.isNaN(num) ? host.data.sort : num)
                        }
                      >
                        <NumberInputField />
                      </NumberInput>
                    </FormControl>
                  </SimpleGrid>
                  <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
                    <FormControl>
                      <FormLabel>{t("hostsDialog.address")}</FormLabel>
                      <InputGroup>
                        <Input
                          value={host.data.address}
                          onChange={(event) => onChange(host.uid, "address", event.target.value)}
                        />
                        <InputRightElement width="auto" pr={2} pointerEvents="auto">
                          <DynamicTokensPopover />
                        </InputRightElement>
                      </InputGroup>
                    </FormControl>
                    <FormControl>
                      <FormLabel>{t("hostsDialog.port")}</FormLabel>
                      <NumberInput
                        value={host.data.port ?? ""}
                        allowMouseWheel
                        onChange={(_, num) =>
                          onChange(host.uid, "port", Number.isNaN(num) ? null : num)
                        }
                      >
                        <NumberInputField />
                      </NumberInput>
                    </FormControl>
                  </SimpleGrid>
                </VStack>
              </CardBody>
            </Card>

            <Card variant="outline">
              <CardHeader pb={2}>
                <Text fontWeight="semibold">{t("hostsPage.section.security")}</Text>
              </CardHeader>
              <CardBody pt={0}>
                <VStack align="stretch" spacing={4}>
                  <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
                    <FormControl>
                      <FormLabel>{t("hostsDialog.sni")}</FormLabel>
                      <Input
                        value={host.data.sni}
                        onChange={(event) => onChange(host.uid, "sni", event.target.value)}
                      />
                    </FormControl>
                    <FormControl>
                      <FormLabel>{t("hostsDialog.host")}</FormLabel>
                      <InputGroup>
                        <Input
                          value={host.data.host}
                          onChange={(event) => onChange(host.uid, "host", event.target.value)}
                        />
                        <InputRightElement width="auto" pr={2} pointerEvents="auto">
                          <DynamicTokensPopover />
                        </InputRightElement>
                      </InputGroup>
                    </FormControl>
                  </SimpleGrid>
                  <SimpleGrid columns={{ base: 1, md: 3 }} spacing={4}>
                    <FormControl>
                      <FormLabel>{t("hostsDialog.security")}</FormLabel>
                      <Select
                        value={host.data.security}
                        onChange={(event) => onChange(host.uid, "security", event.target.value)}
                      >
                        {proxyHostSecurity.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.title}
                          </option>
                        ))}
                      </Select>
                    </FormControl>
                    <FormControl>
                      <FormLabel>{t("hostsDialog.alpn")}</FormLabel>
                      <Select
                        value={host.data.alpn}
                        onChange={(event) => onChange(host.uid, "alpn", event.target.value)}
                      >
                        {proxyALPN.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.title}
                          </option>
                        ))}
                      </Select>
                    </FormControl>
                    <FormControl>
                      <FormLabel>{t("hostsDialog.fingerprint")}</FormLabel>
                      <Select
                        value={host.data.fingerprint}
                        onChange={(event) =>
                          onChange(host.uid, "fingerprint", event.target.value)
                        }
                      >
                        {proxyFingerprint.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.title}
                          </option>
                        ))}
                      </Select>
                    </FormControl>
                  </SimpleGrid>
                </VStack>
              </CardBody>
            </Card>

            <Card variant="outline">
              <CardHeader pb={2}>
                <Text fontWeight="semibold">{t("hostsPage.section.advanced")}</Text>
              </CardHeader>
              <CardBody pt={0}>
                <VStack align="stretch" spacing={4}>
                  <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
                    <FormControl>
                      <FormLabel>{t("hostsDialog.fragment")}</FormLabel>
                      <Input
                        value={host.data.fragment_setting}
                        onChange={(event) =>
                          onChange(host.uid, "fragment_setting", event.target.value)
                        }
                      />
                    </FormControl>
                    <FormControl>
                      <FormLabel>{t("hostsDialog.noise")}</FormLabel>
                      <Input
                        value={host.data.noise_setting}
                        onChange={(event) =>
                          onChange(host.uid, "noise_setting", event.target.value)
                        }
                      />
                    </FormControl>
                  </SimpleGrid>
                  <Stack direction={{ base: "column", md: "row" }} spacing={4}>
                    <Checkbox
                      isChecked={host.data.allowinsecure}
                      onChange={(event) =>
                        onChange(host.uid, "allowinsecure", event.target.checked)
                      }
                    >
                      {t("hostsDialog.allowinsecure")}
                    </Checkbox>
                    <Checkbox
                      isChecked={host.data.mux_enable}
                      onChange={(event) =>
                        onChange(host.uid, "mux_enable", event.target.checked)
                      }
                    >
                      {t("hostsDialog.muxEnable")}
                    </Checkbox>
                    <Checkbox
                      isChecked={host.data.random_user_agent}
                      onChange={(event) =>
                        onChange(host.uid, "random_user_agent", event.target.checked)
                      }
                    >
                      {t("hostsDialog.randomUserAgent")}
                    </Checkbox>
                    <Checkbox
                      isChecked={host.data.use_sni_as_host}
                      onChange={(event) =>
                        onChange(host.uid, "use_sni_as_host", event.target.checked)
                      }
                    >
                      {t("hostsDialog.useSniAsHost")}
                    </Checkbox>
                  </Stack>
                </VStack>
              </CardBody>
            </Card>
          </VStack>
        </DrawerBody>
        <DrawerFooter justifyContent="space-between">
          <Button
            size="sm"
            variant="ghost"
            colorScheme="red"
            leftIcon={<DeleteIcon />}
            onClick={() => onDelete(host.uid)}
            isLoading={deleting}
          >
            {t("hostsPage.delete")}
          </Button>
          <HStack spacing={3}>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onReset(host.uid)}
              isDisabled={!dirty || saving}
            >
              {t("hostsPage.reset")}
            </Button>
            <Button
              size="sm"
              colorScheme="primary"
              onClick={() => onSave(host.uid)}
              isDisabled={!dirty}
              isLoading={saving}
            >
              {t("hostsPage.save")}
            </Button>
          </HStack>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
};

type CreateHostModalProps = {
  isOpen: boolean;
  onClose: () => void;
  inboundOptions: InboundOption[];
  onSubmit: (values: CreateHostValues) => void;
  isSubmitting: boolean;
  defaultSort: number;
};

const CreateHostModal: FC<CreateHostModalProps> = ({
  isOpen,
  onClose,
  inboundOptions,
  onSubmit,
  isSubmitting,
  defaultSort,
}) => {
  const { t } = useTranslation();
  const initialRef = useRef<HTMLInputElement | null>(null);
  const [formState, setFormState] = useState<CreateHostValues>({
    inboundTag: inboundOptions[0]?.value ?? "",
    remark: "",
    address: "",
    sort: defaultSort ?? 0,
    port: null,
    path: "",
    sni: "",
    host: "",
  });

  useEffect(() => {
    if (isOpen) {
      setFormState({
        inboundTag: inboundOptions[0]?.value ?? "",
        remark: "",
        address: "",
        sort: defaultSort ?? 0,
        port: null,
        path: "",
        sni: "",
        host: "",
      });
      setTimeout(() => initialRef.current?.focus(), 150);
    }
  }, [defaultSort, inboundOptions, isOpen]);

  const handleSubmit = () => {
    if (!formState.inboundTag || !formState.remark.trim() || !formState.address.trim()) {
      return;
    }
    onSubmit(formState);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg" initialFocusRef={initialRef}>
      <ModalOverlay bg="blackAlpha.300" backdropFilter="blur(6px)" />
      <ModalContent>
        <ModalHeader>
          <HStack spacing={3}>
            <AddIcon />
            <Text fontWeight="semibold">{t("hostsPage.create.title")}</Text>
          </HStack>
        </ModalHeader>
        <ModalCloseButton mt={2} />
        <ModalBody as={VStack} align="stretch" spacing={4} pt={2}>
          <Text fontSize="sm" color="gray.600" _dark={{ color: "gray.300" }}>
            {t("hostsPage.create.description")}
          </Text>
          <FormControl>
            <FormLabel>{t("hostsPage.inboundLabel")}</FormLabel>
            <Select
              value={formState.inboundTag}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, inboundTag: event.target.value }))
              }
            >
              {inboundOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </FormControl>
          <FormControl isRequired>
            <FormLabel>{t("hostsDialog.remark")}</FormLabel>
            <InputGroup>
              <Input
                ref={initialRef}
                value={formState.remark}
                onChange={(event) =>
                  setFormState((prev) => ({ ...prev, remark: event.target.value }))
                }
              />
              <InputRightElement width="auto" pr={2} pointerEvents="auto">
                <DynamicTokensPopover />
              </InputRightElement>
            </InputGroup>
          </FormControl>
          <SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
            <FormControl isRequired>
              <FormLabel>{t("hostsDialog.address")}</FormLabel>
              <InputGroup>
                <Input
                  value={formState.address}
                  onChange={(event) =>
                    setFormState((prev) => ({ ...prev, address: event.target.value }))
                  }
                />
                <InputRightElement width="auto" pr={2} pointerEvents="auto">
                  <DynamicTokensPopover />
                </InputRightElement>
              </InputGroup>
            </FormControl>
            <FormControl>
              <FormLabel>{t("hostsDialog.port")}</FormLabel>
              <NumberInput
                value={formState.port ?? ""}
                onChange={(_, num) =>
                  setFormState((prev) => ({
                    ...prev,
                    port: Number.isNaN(num) ? null : num,
                  }))
                }
              >
                <NumberInputField />
              </NumberInput>
            </FormControl>
          </SimpleGrid>
          <SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
            <FormControl>
              <FormLabel>{t("hostsDialog.path")}</FormLabel>
              <Input
                value={formState.path}
                onChange={(event) =>
                  setFormState((prev) => ({ ...prev, path: event.target.value }))
                }
              />
            </FormControl>
            <FormControl>
              <FormLabel>{t("hostsDialog.sni")}</FormLabel>
              <Input
                value={formState.sni}
                onChange={(event) =>
                  setFormState((prev) => ({ ...prev, sni: event.target.value }))
                }
              />
            </FormControl>
          </SimpleGrid>
          <FormControl>
            <FormLabel>{t("hostsDialog.host")}</FormLabel>
            <InputGroup>
              <Input
                value={formState.host}
                onChange={(event) =>
                  setFormState((prev) => ({ ...prev, host: event.target.value }))
                }
              />
              <InputRightElement width="auto" pr={2} pointerEvents="auto">
                <DynamicTokensPopover />
              </InputRightElement>
            </InputGroup>
          </FormControl>
          <FormControl>
            <FormLabel>{t("hostsDialog.sort")}</FormLabel>
            <NumberInput
              value={Number.isFinite(formState.sort) ? formState.sort : ""}
              onChange={(_, num) =>
                setFormState((prev) => ({
                  ...prev,
                  sort: Number.isNaN(num) ? prev.sort : num,
                }))
              }
            >
              <NumberInputField />
            </NumberInput>
          </FormControl>
          <Box
            borderRadius="md"
            bg="gray.50"
            color="gray.600"
            fontSize="sm"
            px={4}
            py={3}
            _dark={{ bg: "gray.800", color: "gray.300" }}
          >
            {t("hostsPage.create.sortHint", { value: formState.sort ?? defaultSort })}
          </Box>
        </ModalBody>
        <ModalFooter gap={2}>
          <Button variant="ghost" onClick={onClose}>
            {t("hostsPage.cancel")}
          </Button>
          <Button colorScheme="primary" onClick={handleSubmit} isLoading={isSubmitting}>
            {t("hostsPage.create.submit")}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};
export const HostsManager: FC = () => {
  const { t } = useTranslation();
  const toast = useToast();
  const { hosts, fetchHosts, isLoading, isPostLoading, setHosts } = useHosts();
  const { inbounds } = useDashboard();
  const [hostItemsState, setHostItemsState] = useState<HostState[]>([]);
  const hostItemsRef = useRef<HostState[]>([]);
  const applyHostItems = useCallback(
    (updater: HostState[] | ((prev: HostState[]) => HostState[])) => {
      if (typeof updater === "function") {
        setHostItemsState((prev) => {
          const next = (updater as (prev: HostState[]) => HostState[])(prev);
          hostItemsRef.current = next;
          return next;
        });
      } else {
        hostItemsRef.current = updater;
        setHostItemsState(updater);
      }
    },
    []
  );

  const [selectedHostUid, setSelectedHostUid] = useState<string | null>(null);
  const [includeDisabled, setIncludeDisabled] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [savingHostUid, setSavingHostUid] = useState<string | null>(null);
  const [deletingUid, setDeletingUid] = useState<string | null>(null);
  const [confirmDeleteUid, setConfirmDeleteUid] = useState<string | null>(null);
  const [pendingSelection, setPendingSelection] = useState<{
    inboundTag: string;
    remark: string;
    address: string;
  } | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  const [orderDirtyState, setOrderDirtyState] = useState(false);
  const orderDirtyRef = useRef(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const [isSorting, setIsSorting] = useState(false);
  const [visualOrder, setVisualOrder] = useState<HostState[] | null>(null);

  useEffect(() => {
    fetchHosts();
  }, [fetchHosts]);

  useEffect(() => {
    if (!inbounds.size) {
      fetchInbounds();
    }
  }, [inbounds]);

  useEffect(() => {
    const mapped = mapHostsToState(hosts);
    applyHostItems(mapped);
  }, [hosts, applyHostItems]);

  useEffect(() => {
    if (pendingSelection) {
      const match = hostItemsRef.current.find(
        (host) =>
          host.inboundTag === pendingSelection.inboundTag &&
          host.data.remark.trim() === pendingSelection.remark &&
          host.data.address.trim() === pendingSelection.address
      );
      if (match) {
        setSelectedHostUid(match.uid);
        setPendingSelection(null);
      }
    }
  }, [hostItemsState, pendingSelection]);

  useEffect(() => {
    if (
      selectedHostUid &&
      !hostItemsRef.current.some((host) => host.uid === selectedHostUid) &&
      !pendingSelection
    ) {
      setSelectedHostUid(null);
    }
  }, [hostItemsState, selectedHostUid, pendingSelection]);

  const setOrderDirtyFlag = useCallback((value: boolean) => {
    orderDirtyRef.current = value;
    setOrderDirtyState(value);
  }, []);

  useEffect(() => {
    if (!isSorting) {
      setVisualOrder(null);
      setOrderDirtyFlag(false);
    }
  }, [includeDisabled, isSorting, setOrderDirtyFlag]);

  useEffect(() => {
    if (!isSorting || !visualOrder) {
      return;
    }
    const currentIds = new Set(hostItemsRef.current.map((host) => host.uid));
    const stillValid = visualOrder.every((host) => currentIds.has(host.uid));
    if (!stillValid) {
      setVisualOrder(null);
      setOrderDirtyFlag(false);
    }
  }, [hostItemsState, isSorting, setOrderDirtyFlag, visualOrder]);

  const inboundOptions: InboundOption[] = useMemo(() => {
    const options: InboundOption[] = [];
    inbounds.forEach((list) => {
      list.forEach((inbound) => {
        options.push({
          label: `${inbound.tag} (${inbound.protocol.toUpperCase()} - ${inbound.network})`,
          value: inbound.tag,
          protocol: inbound.protocol,
          network: inbound.network,
        });
      });
    });
    return options.sort((a, b) => a.label.localeCompare(b.label));
  }, [inbounds]);

  const activeHosts = useMemo(
    () =>
      hostItemsRef.current
        .filter((host) => !host.data.is_disabled)
        .sort((a, b) => safeSortValue(a.data.sort) - safeSortValue(b.data.sort)),
    [hostItemsState]
  );

  const allHosts = useMemo(
    () =>
      [...hostItemsRef.current].sort(
        (a, b) => safeSortValue(a.data.sort) - safeSortValue(b.data.sort)
      ),
    [hostItemsState]
  );

  const baseFilteredHosts = useMemo(
    () => (includeDisabled ? allHosts : activeHosts),
    [activeHosts, allHosts, includeDisabled]
  );

  useEffect(() => {
    if (isSorting) {
      setVisualOrder((prev) => prev ?? [...activeHosts]);
    }
  }, [activeHosts, isSorting]);

  const displayedHosts = isSorting ? visualOrder ?? activeHosts : baseFilteredHosts;


  const orderIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    displayedHosts.forEach((host, index) => map.set(host.uid, index));
    return map;
  }, [displayedHosts]);

  const selectedHost = selectedHostUid
    ? hostItemsRef.current.find((host) => host.uid === selectedHostUid) ?? null
    : null;

  const updateHost = <Key extends keyof HostData>(
    uid: string,
    key: Key,
    value: HostData[Key]
  ) => {
    applyHostItems((prev) =>
      sortHosts(
        prev.map((host) =>
          host.uid === uid ? { ...host, data: { ...host.data, [key]: value } } : host
        )
      )
    );
  };

  const updateHostInbound = (uid: string, inboundTag: string) => {
    applyHostItems((prev) =>
      sortHosts(
        prev.map((host) =>
          host.uid === uid
            ? {
                ...host,
                inboundTag,
              }
            : host
        )
      )
    );
  };

  const persistOrder = useCallback(async () => {
    if (!isSorting || savingOrder) return false;
    const baseOrder = activeHosts;
    const targetOrder = visualOrder ?? baseOrder;

    const hasChanges =
      targetOrder.length !== baseOrder.length ||
      targetOrder.some((host, index) => host.uid !== baseOrder[index]?.uid);

    if (!hasChanges) {
      setIsSorting(false);
      setVisualOrder(null);
      setOrderDirtyFlag(false);
      return true;
    }

    if (!visualOrder || targetOrder.length === 0) {
      setIsSorting(false);
      setVisualOrder(null);
      setOrderDirtyFlag(false);
      return true;
    }

    const orderedUids = targetOrder.map((host) => host.uid);
    const orderedIndexMap = new Map<string, number>();
    orderedUids.forEach((uid, index) => orderedIndexMap.set(uid, index));

    const previousHosts = hostItemsRef.current;

    const orderedSegment = hostItemsRef.current
      .filter((host) => orderedIndexMap.has(host.uid))
      .sort(
        (a, b) =>
          (orderedIndexMap.get(a.uid) ?? Number.MAX_SAFE_INTEGER) -
          (orderedIndexMap.get(b.uid) ?? Number.MAX_SAFE_INTEGER)
      );

    const remainingSegment = hostItemsRef.current
      .filter((host) => !orderedIndexMap.has(host.uid))
      .sort((a, b) => safeSortValue(a.data.sort) - safeSortValue(b.data.sort));

    const combined = [...orderedSegment, ...remainingSegment].map((host, index) => ({
      ...host,
      data: { ...host.data, sort: index },
      original: { ...host.original, sort: index },
    }));

    applyHostItems(combined);
    setVisualOrder(combined.filter((host) => !host.data.is_disabled));
    setSavingOrder(true);

    try {
      const payload = groupHostsByInbound(combined);
      await setHosts(payload);
      await fetchHosts();
      setOrderDirtyFlag(false);
      setIsSorting(false);
      setVisualOrder(null);
      toast({
        title: t("hostsPage.reorderSaved"),
        status: "success",
        isClosable: true,
        position: "top",
      });
      return true;
    } catch (error) {
      applyHostItems(previousHosts);
      const previousActive = previousHosts
        .filter((host) => !host.data.is_disabled)
        .sort((a, b) => safeSortValue(a.data.sort) - safeSortValue(b.data.sort));
      setVisualOrder(previousActive);
      setOrderDirtyFlag(true);
      toast({
        title: t("hostsPage.reorderFailed"),
        status: "error",
        isClosable: true,
        position: "top",
      });
      return false;
    } finally {
      setSavingOrder(false);
    }
  }, [
    applyHostItems,
    activeHosts,
    fetchHosts,
    isSorting,
    savingOrder,
    setHosts,
    setOrderDirtyFlag,
    t,
    toast,
    visualOrder,
  ]);

  const handleReorder = useCallback(
    (orderedSubset: HostState[]) => {
      if (!isSorting || !orderedSubset.length) return;
      const referenceOrder = visualOrder ?? activeHosts;
      const changed =
        orderedSubset.length !== referenceOrder.length ||
        orderedSubset.some((host, index) => host.uid !== referenceOrder[index]?.uid);

      if (!changed) {
        return;
      }

      setVisualOrder(orderedSubset);
      if (!orderDirtyRef.current) {
        setOrderDirtyFlag(true);
      }
    },
    [activeHosts, isSorting, setOrderDirtyFlag, visualOrder]
  );

  const enterSortMode = useCallback(() => {
    setVisualOrder([...activeHosts]);
    setOrderDirtyFlag(false);
    setIsSorting(true);
  }, [activeHosts, setOrderDirtyFlag]);

  const cancelSort = useCallback(() => {
    setIsSorting(false);
    setVisualOrder(null);
    setOrderDirtyFlag(false);
  }, [setOrderDirtyFlag]);

  const handleSaveSort = useCallback(() => {
    void persistOrder();
  }, [persistOrder]);

  const saveHost = async (uid: string) => {
    const host = hostItemsRef.current.find((item) => item.uid === uid);
    if (!host) return;
    setSavingHostUid(uid);
    setPendingSelection({
      inboundTag: host.inboundTag,
      remark: host.data.remark.trim(),
      address: host.data.address.trim(),
    });
    try {
      const payload = sliceInboundPayload(hostItemsRef.current, host.inboundTag);
      await setHosts(payload);
      await fetchHosts();
      toast({
        title: t("hostsPage.saved"),
        status: "success",
        isClosable: true,
        position: "top",
      });
    } catch (error) {
      toast({
        title: t("hostsPage.error.save"),
        status: "error",
        isClosable: true,
        position: "top",
      });
    } finally {
      setSavingHostUid(null);
    }
  };

  const resetHost = (uid: string) => {
    applyHostItems((prev) =>
      sortHosts(
        prev.map((host) =>
          host.uid === uid ? { ...host, data: cloneHostData(host.original) } : host
        )
      )
    );
  };

  const toggleActive = (uid: string, isActive: boolean) => {
    updateHost(uid, "is_disabled", !isActive);
    if (!isActive) {
      setIncludeDisabled(true);
    }
  };

  const handleDeleteHost = (uid: string) => {
    setConfirmDeleteUid(uid);
  };

  const confirmDelete = async () => {
    if (!confirmDeleteUid) return;
    const host = hostItemsRef.current.find((item) => item.uid === confirmDeleteUid);
    if (!host) return;
    setDeletingUid(confirmDeleteUid);
    try {
      const nextHosts = hostItemsRef.current.filter((item) => item.uid !== confirmDeleteUid);
      applyHostItems(nextHosts);
      const payload = sliceInboundPayload(nextHosts, host.inboundTag);
      await setHosts(payload);
      await fetchHosts();
      toast({
        title: t("hostsPage.deleted"),
        status: "success",
        isClosable: true,
        position: "top",
      });
      if (selectedHostUid === confirmDeleteUid) {
        setSelectedHostUid(null);
      }
    } catch (error) {
      toast({
        title: t("hostsPage.error.delete"),
        status: "error",
        isClosable: true,
        position: "top",
      });
    } finally {
      setDeletingUid(null);
      setConfirmDeleteUid(null);
    }
  };

  const handleCreateHost = async (values: CreateHostValues) => {
    const nextSort = hostItemsRef.current.length
      ? Math.max(...hostItemsRef.current.map((host) => host.data.sort)) + 1
      : 0;
    setSavingHostUid("create");
    setPendingSelection({
      inboundTag: values.inboundTag,
      remark: values.remark.trim(),
      address: values.address.trim(),
    });
    try {
      const newHost: HostState = {
        uid: createUid(),
        inboundTag: values.inboundTag,
        data: {
          remark: values.remark,
          address: values.address,
          sort: Number.isFinite(values.sort) ? values.sort : nextSort,
          port: values.port,
          path: values.path,
          sni: values.sni,
          host: values.host,
          mux_enable: false,
          allowinsecure: false,
          is_disabled: false,
          fragment_setting: "",
          noise_setting: "",
          random_user_agent: false,
          security: "inbound_default",
          alpn: "",
          fingerprint: "",
          use_sni_as_host: false,
        },
        original: {
          remark: values.remark,
          address: values.address,
          sort: Number.isFinite(values.sort) ? values.sort : nextSort,
          port: values.port,
          path: values.path,
          sni: values.sni,
          host: values.host,
          mux_enable: false,
          allowinsecure: false,
          is_disabled: false,
          fragment_setting: "",
          noise_setting: "",
          random_user_agent: false,
          security: "inbound_default",
          alpn: "",
          fingerprint: "",
          use_sni_as_host: false,
        },
      };

      const nextHosts = sortHosts([...hostItemsRef.current, newHost]);
      applyHostItems(nextHosts);

      const payload = sliceInboundPayload(nextHosts, values.inboundTag);
      await setHosts(payload);
      await fetchHosts();
      toast({
        title: t("hostsPage.created"),
        status: "success",
        isClosable: true,
        position: "top",
      });
      setCreateOpen(false);
    } catch (error) {
      toast({
        title: t("hostsPage.error.create"),
        status: "error",
        isClosable: true,
        position: "top",
      });
    } finally {
      setSavingHostUid(null);
    }
  };


  return (
    <VStack align="stretch" spacing={4}>
      {isSorting ? (
        <VStack align="stretch" spacing={2}>
          <HStack justify="space-between" align="center" wrap="wrap" rowGap={2}>
            <Text fontWeight="semibold">{t("hostsPage.sortingTitle")}</Text>
            <HStack spacing={2}>
              <Button variant="ghost" onClick={cancelSort} isDisabled={savingOrder}>
                {t("hostsPage.cancel")}
              </Button>
              <Button
                colorScheme="primary"
                onClick={handleSaveSort}
                isLoading={savingOrder}
                isDisabled={!orderDirtyState && !savingOrder}
              >
                {t("hostsPage.saveOrder")}
              </Button>
            </HStack>
          </HStack>
          <Text fontSize="sm" color="gray.500" _dark={{ color: "gray.300" }}>
            {t("hostsPage.sortingInstructions")}
          </Text>
          {savingOrder ? (
            <HStack spacing={2} fontSize="sm" color="gray.600" _dark={{ color: "gray.300" }}>
              <Spinner size="xs" />
              <Text>{t("hostsPage.orderSaving")}</Text>
            </HStack>
          ) : orderDirtyState ? (
            <Text fontSize="sm" color="gray.500" _dark={{ color: "gray.300" }}>
              {t("hostsPage.orderDirty")}
            </Text>
          ) : null}
        </VStack>
      ) : (
        <HStack justify="space-between" align="center" wrap="wrap" rowGap={2}>
          <HStack spacing={3}>
            <Button
              colorScheme="primary"
              size="sm"
              onClick={() => setCreateOpen(true)}
              leftIcon={<AddIcon />}
              isDisabled={!inboundOptions.length}
            >
              {t("hostsPage.addHost")}
            </Button>
            <Switch
              isChecked={includeDisabled}
              onChange={(event) => setIncludeDisabled(event.target.checked)}
            >
              {t("hostsPage.showDisabled")}
            </Switch>
          </HStack>
          <Button
            size="sm"
            variant="outline"
            leftIcon={<HandleIcon />}
            onClick={enterSortMode}
            isDisabled={isLoading || !activeHosts.length}
          >
            {t("hostsPage.enterSort")}
          </Button>
        </HStack>
      )}

      {isLoading ? (
        <HStack justify="center" py={10}>
          <Spinner />
        </HStack>
      ) : displayedHosts.length === 0 ? (
        <Box
          border="1px dashed"
          borderRadius="md"
          px={6}
          py={10}
          textAlign="center"
          borderColor="gray.300"
          _dark={{ borderColor: "gray.600" }}
        >
          <Text>{t("hostsPage.emptyState")}</Text>
        </Box>
      ) : isSorting ? (
        <Reorder.Group
          axis="y"
          values={displayedHosts}
          onReorder={handleReorder}
          layoutScroll
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.75rem",
            listStyle: "none",
            padding: 0,
            margin: 0,
          }}
        >
          {(displayedHosts).map((host, index) => (
            <SortRow key={host.uid} host={host} index={index} />
          ))}
        </Reorder.Group>
      ) : (
        <SimpleGrid columns={{ base: 1, md: 2, xl: 3 }} spacing={4}>
          {baseFilteredHosts.map((host, index) => (
            <HostCard
              key={host.uid}
              host={host}
              inboundOptions={inboundOptions}
              orderIndex={orderIndexMap.get(host.uid) ?? index}
              onToggleActive={toggleActive}
              onEdit={setSelectedHostUid}
              onDelete={handleDeleteHost}
              saving={savingHostUid === host.uid && isPostLoading}
              deleting={deletingUid === host.uid && isPostLoading}
            />
          ))}
        </SimpleGrid>
      )}

      <CreateHostModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        inboundOptions={inboundOptions}
        onSubmit={handleCreateHost}
        isSubmitting={savingHostUid === "create" && isPostLoading}
        defaultSort={
          hostItemsRef.current.length
            ? Math.max(...hostItemsRef.current.map((host) => host.data.sort)) + 1
            : 0
        }
      />

      <HostDetailDrawer
        host={selectedHost}
        inboundOptions={inboundOptions}
        isOpen={Boolean(selectedHost)}
        onClose={() => setSelectedHostUid(null)}
        onChange={updateHost}
        onChangeInbound={updateHostInbound}
        onSave={saveHost}
        onReset={resetHost}
        onDelete={handleDeleteHost}
        saving={!!selectedHost && savingHostUid === selectedHost.uid && isPostLoading}
        deleting={!!selectedHost && deletingUid === selectedHost.uid && isPostLoading}
      />

      <AlertDialog
        isOpen={Boolean(confirmDeleteUid)}
        leastDestructiveRef={cancelRef}
        onClose={() => setConfirmDeleteUid(null)}
      >
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              {t("hostsPage.deleteTitle")}
            </AlertDialogHeader>
            <AlertDialogBody>{t("hostsPage.deleteConfirmation")}</AlertDialogBody>
            <AlertDialogFooter>
              <Button ref={cancelRef} onClick={() => setConfirmDeleteUid(null)}>
                {t("hostsPage.cancel")}
              </Button>
              <Button
                colorScheme="red"
                onClick={confirmDelete}
                ml={3}
                isLoading={Boolean(deletingUid)}
              >
                {t("hostsPage.delete")}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </VStack>
  );
};

export default HostsManager;
