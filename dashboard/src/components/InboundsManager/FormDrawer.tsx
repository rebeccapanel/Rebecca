import {
  Box,
  Button,
  Checkbox,
  CheckboxGroup,
  Collapse,
  Flex,
  FormControl,
  FormLabel,
  HStack,
  Input as ChakraInput,
  NumberInput,
  NumberInputField,
  Text,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Select as ChakraSelect,
  SimpleGrid,
  Stack,
  Switch,
  Textarea as ChakraTextarea,
  Tooltip,
  VStack,
  useColorModeValue,
  useToast,
} from "@chakra-ui/react";
import type { InputProps, SelectProps, TextareaProps } from "@chakra-ui/react";
import { QuestionMarkCircleIcon } from "@heroicons/react/24/outline";
import {
  Controller,
  useFieldArray,
  useForm,
  useWatch,
} from "react-hook-form";
import { useEffect, FC, useMemo, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  InboundFormValues,
  Protocol,
  protocolOptions,
  streamNetworks,
  streamSecurityOptions,
  sniffingOptions,
  tlsFingerprintOptions,
  createDefaultInboundForm,
  rawInboundToFormValues,
  SockoptFormValues,
} from "utils/inbounds";
import { RawInbound } from "utils/inbounds";
import { generateWireguardKeypair } from "utils/wireguard";
import { getVlessEncAuthBlocks, VlessEncAuthBlock } from "service/xray";

import { forwardRef } from "react";

type Props = {
  isOpen: boolean;
  mode: "create" | "edit";
  initialValue: RawInbound | null;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (values: InboundFormValues) => Promise<void>;
};

const Input = forwardRef<HTMLInputElement, InputProps>((props, ref) => (
  <ChakraInput size="sm" ref={ref} {...props} />
));
Input.displayName = "InboundFormInput";

const Select = forwardRef<HTMLSelectElement, SelectProps>((props, ref) => (
  <ChakraSelect size="sm" ref={ref} {...props} />
));
Select.displayName = "InboundFormSelect";

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>((props, ref) => (
  <ChakraTextarea size="sm" resize="vertical" ref={ref} {...props} />
));
Textarea.displayName = "InboundFormTextarea";

const formatRealityKeyForDisplay = (value?: string | null) =>
  (value ?? "").replace(/\s+/g, "").replace(/=+$/, "");

const prepareRealityKeyForDerivation = (value?: string | null) => {
  const trimmed = (value ?? "").replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!trimmed) {
    return "";
  }
  const remainder = trimmed.length % 4;
  return remainder === 0 ? trimmed : `${trimmed}${"=".repeat(4 - remainder)}`;
};

const DOMAIN_STRATEGY_OPTIONS = [
  "AsIs",
  "UseIP",
  "UseIPv6v4",
  "UseIPv6",
  "UseIPv4v6",
  "UseIPv4",
  "ForceIP",
  "ForceIPv6v4",
  "ForceIPv6",
  "ForceIPv4v6",
  "ForceIPv4",
];

const TCP_CONGESTION_OPTIONS = ["bbr", "cubic", "reno"];
const TPROXY_OPTIONS: Array<"" | "off" | "redirect" | "tproxy"> = [
  "off",
  "redirect",
  "tproxy",
];
const XHTTP_MODE_OPTIONS: Array<InboundFormValues["xhttpMode"]> = [
  "auto",
  "packet-up",
  "stream-up",
  "stream-one",
];

export const InboundFormModal: FC<Props> = ({
  isOpen,
  mode,
  initialValue,
  isSubmitting,
  onClose,
  onSubmit,
}) => {
  const { t } = useTranslation();
  const toast = useToast();
  const [vlessAuthOptions, setVlessAuthOptions] = useState<VlessEncAuthBlock[]>([]);
  const [vlessAuthLoading, setVlessAuthLoading] = useState(false);

  const form = useForm<InboundFormValues>({
    defaultValues: createDefaultInboundForm(),
  });
  const { control, register, handleSubmit, reset, watch } = form;
  const { fields: fallbackFields, append: appendFallback, remove: removeFallback } = useFieldArray({
    control,
    name: "fallbacks",
  });
  const {
    fields: httpAccountFields,
    append: appendHttpAccount,
    remove: removeHttpAccount,
  } = useFieldArray({
    control,
    name: "httpAccounts",
  });
  const {
    fields: socksAccountFields,
    append: appendSocksAccount,
    remove: removeSocksAccount,
  } = useFieldArray({
    control,
    name: "socksAccounts",
  });
  const {
    fields: xhttpHeaderFields,
    append: appendXhttpHeader,
    remove: removeXhttpHeader,
  } = useFieldArray({
    control,
    name: "xhttpHeaders",
  });

  const currentProtocol = useWatch({ control, name: "protocol" }) || watch("protocol");
  const streamNetwork = useWatch({ control, name: "streamNetwork" }) || watch("streamNetwork");
  const streamSecurity = useWatch({ control, name: "streamSecurity" }) || watch("streamSecurity");
  const sniffingEnabled = useWatch({ control, name: "sniffingEnabled" }) ?? watch("sniffingEnabled");
  const realityPrivateKey = useWatch({ control, name: "realityPrivateKey" }) || watch("realityPrivateKey");
  const tcpHeaderType = useWatch({ control, name: "tcpHeaderType" }) || watch("tcpHeaderType");
  const sockoptEnabled = useWatch({ control, name: "sockoptEnabled" }) ?? false;
  const vlessSelectedAuth = useWatch({ control, name: "vlessSelectedAuth" }) || "";
  const socksAuth = useWatch({ control, name: "socksAuth" }) || watch("socksAuth") || "noauth";
  const socksUdpEnabled =
    useWatch({ control, name: "socksUdpEnabled" }) ?? watch("socksUdpEnabled") ?? false;
  const xhttpMode = useWatch({ control, name: "xhttpMode" }) || watch("xhttpMode") || "auto";
  const supportsStreamSettings = currentProtocol !== "http" && currentProtocol !== "socks";
  const defaultVlessAuthLabels = useMemo(
    () => ["X25519, not Post-Quantum", "ML-KEM-768, Post-Quantum"],
    []
  );
  const computedVlessAuthOptions = useMemo(() => {
    const labels = [...defaultVlessAuthLabels, ...vlessAuthOptions.map((option) => option.label)].filter(Boolean);
    const unique = Array.from(new Set(labels));
    return unique.map((label) => ({ label, value: label }));
  }, [defaultVlessAuthLabels, vlessAuthOptions]);

  useEffect(() => {
    if (isOpen) {
      if (initialValue) {
        const formValues = rawInboundToFormValues(initialValue);
        reset(formValues);
      } else {
        reset(createDefaultInboundForm());
      }
    }
  }, [initialValue, reset, isOpen]);

  const renderSockoptNumberInput = useCallback(
    (name: keyof SockoptFormValues, label: string) => (
      <FormControl>
        <FormLabel>{label}</FormLabel>
        <Controller
          control={control}
          name={`sockopt.${name}` as const}
          render={({ field }) => {
            const numberInputValue: string | number | undefined =
              typeof field.value === "number" || typeof field.value === "string" ? field.value : undefined;
            return (
              <NumberInput
                min={0}
                value={numberInputValue ?? ""}
                onChange={(valueString) => field.onChange(valueString)}
              >
                <NumberInputField />
              </NumberInput>
            );
          }}
        />
      </FormControl>
    ),
    [control]
  );

  const renderSockoptSwitch = useCallback(
    (name: keyof SockoptFormValues, label: string) => (
      <FormControl display="flex" alignItems="center">
        <FormLabel mb={0}>{label}</FormLabel>
        <Controller
          control={control}
          name={`sockopt.${name}` as const}
          render={({ field }) => (
            <Switch
              isChecked={typeof field.value === "boolean" ? field.value : Boolean(field.value)}
              onChange={(event) => field.onChange(event.target.checked)}
            />
          )}
        />
      </FormControl>
    ),
    [control]
  );

  const renderSockoptTextInput = useCallback(
    (name: keyof SockoptFormValues, label: string, placeholder?: string) => (
      <FormControl>
        <FormLabel>{label}</FormLabel>
        <Input {...register(`sockopt.${name}` as const)} placeholder={placeholder} />
      </FormControl>
    ),
    [register]
  );
  
  const supportsFallback = currentProtocol === "vless" || currentProtocol === "trojan";

  const sectionBorder = useColorModeValue("gray.200", "gray.700");

  const submitForm = async (values: InboundFormValues) => {
    await onSubmit(values);
  };

  const handleGenerateRealityKeypair = useCallback(() => {
    try {
      const { privateKey } = generateWireguardKeypair();
      form.setValue("realityPrivateKey", formatRealityKeyForDisplay(privateKey), {
        shouldDirty: true,
      });
    } catch (error) {
      toast({
        status: "error",
        title: t("inbounds.reality.generateError", "Unable to generate key pair"),
        description: error instanceof Error ? error.message : undefined,
      });
    }
  }, [form, toast, t]);

  const handleGenerateShortId = useCallback(() => {
    try {
      const cryptoObj = typeof window === "undefined" ? undefined : window.crypto;
      if (!cryptoObj?.getRandomValues) {
        throw new Error("Crypto API is not available in this environment.");
      }
      const buffer = new Uint8Array(4);
      cryptoObj.getRandomValues(buffer);
      const shortId = Array.from(buffer)
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      const currentValue = form.getValues("realityShortIds") || "";
      const entries = currentValue
        .split(/[\s,]+/)
        .map((entry) => entry.trim())
        .filter(Boolean);
      entries.push(shortId);
      form.setValue("realityShortIds", entries.join("\n"), { shouldDirty: true });
    } catch (error) {
      toast({
        status: "error",
        title: t("inbounds.reality.shortIdError", "Unable to generate short ID"),
        description: error instanceof Error ? error.message : undefined,
      });
    }
  }, [form, toast, t]);

  const derivedRealityPublicKey = useMemo(() => {
    const normalized = prepareRealityKeyForDerivation(realityPrivateKey);
    if (!normalized) {
      return "";
    }
    try {
      const { publicKey } = generateWireguardKeypair(normalized);
      return formatRealityKeyForDisplay(publicKey);
    } catch {
      return "";
    }
  }, [realityPrivateKey]);

  const handleAddFallback = () =>
    appendFallback({ dest: "", path: "", type: "", alpn: "", xver: "" });

  const fetchVlessAuthBlocks = useCallback(async () => {
    setVlessAuthLoading(true);
    try {
      const response = await getVlessEncAuthBlocks();
      const blocks = response?.auths ?? [];
      setVlessAuthOptions(blocks);
      return blocks;
    } catch (error) {
      console.error(error);
      toast({
        status: "error",
        title: t("inbounds.vless.getKeysError", "Unable to fetch VLESS keys"),
      });
      return [];
    } finally {
      setVlessAuthLoading(false);
    }
  }, [toast, t]);

  const ensureVlessAuthBlocks = useCallback(async () => {
    if (vlessAuthOptions.length) {
      return vlessAuthOptions;
    }
    return fetchVlessAuthBlocks();
  }, [fetchVlessAuthBlocks, vlessAuthOptions]);

  const applyVlessAuthBlock = useCallback(
    (label: string, blocks: VlessEncAuthBlock[]) => {
      const match = blocks.find((block) => block.label === label);
      if (!match) {
        toast({
          status: "warning",
          title: t("inbounds.vless.authNotFound", "Authentication block not available"),
        });
        return;
      }
      form.setValue("vlessDecryption", match.decryption ?? "", { shouldDirty: true });
      form.setValue("vlessEncryption", match.encryption ?? "", { shouldDirty: true });
    },
    [form, t, toast]
  );

  const handleAuthSelection = useCallback(
    async (label: string) => {
      if (!label) {
        form.setValue("vlessDecryption", "", { shouldDirty: true });
        form.setValue("vlessEncryption", "", { shouldDirty: true });
        return;
      }
      const blocks = await ensureVlessAuthBlocks();
      if (blocks.length) {
        applyVlessAuthBlock(label, blocks);
      }
    },
    [applyVlessAuthBlock, ensureVlessAuthBlocks, form]
  );

  const handleFetchAuthClick = useCallback(async () => {
    const label = form.getValues("vlessSelectedAuth");
    if (!label) {
      toast({
        status: "info",
        title: t("inbounds.vless.selectAuthFirst", "Select an authentication option first"),
      });
      return;
    }
    const blocks = await fetchVlessAuthBlocks();
    if (blocks.length) {
      applyVlessAuthBlock(label, blocks);
    }
  }, [applyVlessAuthBlock, fetchVlessAuthBlocks, form, t, toast]);

  const handleClearAuth = useCallback(() => {
    form.setValue("vlessSelectedAuth", "", { shouldDirty: true });
    form.setValue("vlessDecryption", "", { shouldDirty: true });
    form.setValue("vlessEncryption", "", { shouldDirty: true });
  }, [form]);

  useEffect(() => {
    if (isOpen && currentProtocol === "vless") {
      ensureVlessAuthBlocks();
    }
  }, [currentProtocol, ensureVlessAuthBlocks, isOpen]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="5xl"
      scrollBehavior="inside"
      isCentered
    >
      <ModalOverlay />
      <ModalContent maxW={{ base: "95vw", md: "4xl" }}>
        <ModalHeader>
          {mode === "create"
            ? t("inbounds.add", "Add inbound")
            : t("inbounds.edit", "Edit inbound")}
        </ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <VStack align="stretch" spacing={6}>
            <Stack
              spacing={4}
              borderWidth="1px"
              borderColor={sectionBorder}
              borderRadius="lg"
              p={4}
            >
              <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
                <FormControl isRequired>
                  <FormLabel>{t("inbounds.tag", "Tag")}</FormLabel>
                  <Input
                    {...register("tag", { required: true })}
                    isDisabled={mode === "edit"}
                  />
                </FormControl>
                <FormControl>
                  <FormLabel>{t("inbounds.listen", "Listen address")}</FormLabel>
                  <Input placeholder="0.0.0.0" {...register("listen")} />
                </FormControl>
              </SimpleGrid>
              <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
                <FormControl isRequired>
                  <FormLabel>{t("inbounds.port", "Port")}</FormLabel>
                  <Input placeholder="443" {...register("port", { required: true })} />
                </FormControl>
                <FormControl isRequired>
                  <FormLabel>{t("inbounds.protocol", "Protocol")}</FormLabel>
                  <Select
                    {...register("protocol", { required: true })}
                    isDisabled={mode === "edit"}
                  >
                    {protocolOptions.map((option) => (
                      <option key={option} value={option}>
                        {option.toUpperCase()}
                      </option>
                    ))}
                  </Select>
                </FormControl>
              </SimpleGrid>
              {currentProtocol === "vmess" && (
                <FormControl display="flex" alignItems="center">
                  <FormLabel mb={0}>{t("inbounds.vmess.disableInsecure", "Disable insecure encryption")}</FormLabel>
                  <Switch {...register("disableInsecureEncryption")} />
                </FormControl>
              )}
              {currentProtocol === "shadowsocks" && (
                <FormControl>
                  <FormLabel>{t("inbounds.shadowsocks.network", "Allowed networks")}</FormLabel>
                  <Input {...register("shadowsocksNetwork")} />
                </FormControl>
              )}
              {currentProtocol === "vless" && (
                <Stack spacing={3}>
                  <Controller
                    control={control}
                    name="vlessSelectedAuth"
                    render={({ field }) => (
                      <FormControl>
                        <FormLabel>{t("inbounds.vless.authentication", "Authentication")}</FormLabel>
                        <ChakraSelect
                          placeholder={t("inbounds.vless.authPlaceholder", "Select authentication")}
                          value={field.value || ""}
                          onChange={async (event) => {
                            const value = event.target.value;
                            field.onChange(value);
                            await handleAuthSelection(value);
                          }}
                        >
                          <option value="">{t("common.none", "None")}</option>
                          {computedVlessAuthOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </ChakraSelect>
                      </FormControl>
                    )}
                  />
                  <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
                    <FormControl>
                      <FormLabel>{t("inbounds.vless.decryption", "Decryption")}</FormLabel>
                      <Input {...register("vlessDecryption")} />
                    </FormControl>
                    <FormControl>
                      <FormLabel>{t("inbounds.vless.encryption", "Encryption")}</FormLabel>
                      <Input {...register("vlessEncryption")} />
                    </FormControl>
                  </SimpleGrid>
                  <HStack spacing={3}>
                    <Button
                      size="sm"
                      onClick={handleFetchAuthClick}
                      isLoading={vlessAuthLoading}
                      isDisabled={!vlessSelectedAuth}
                    >
                      {t("inbounds.vless.getKeys", "Get new keys")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={handleClearAuth}>
                      {t("inbounds.vless.clearKeys", "Clear")}
                    </Button>
                  </HStack>
                </Stack>
              )}
              {currentProtocol === "http" && (
                <Stack spacing={3}>
                  <Flex justify="space-between" align="center">
                    <Text fontWeight="medium">
                      {t("inbounds.http.accounts", "HTTP accounts")}
                    </Text>
                    <Button
                      size="xs"
                      onClick={() => appendHttpAccount({ user: "", pass: "" })}
                    >
                      {t("inbounds.accounts.add", "Add account")}
                    </Button>
                  </Flex>
                  <Stack spacing={3}>
                    {httpAccountFields.map((field, index) => (
                      <Box
                        key={field.id}
                        borderWidth="1px"
                        borderRadius="md"
                        borderColor={sectionBorder}
                        p={3}
                      >
                        <Flex justify="space-between" align="center" mb={3}>
                          <Text fontWeight="semibold">
                            {t("inbounds.accounts.label", "Account")} #{index + 1}
                          </Text>
                          <Button
                            size="xs"
                            variant="ghost"
                            colorScheme="red"
                            onClick={() => removeHttpAccount(index)}
                          >
                            {t("hostsPage.delete", "Delete")}
                          </Button>
                        </Flex>
                        <SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
                          <FormControl>
                            <FormLabel>{t("username", "Username")}</FormLabel>
                            <Input {...register(`httpAccounts.${index}.user` as const)} />
                          </FormControl>
                          <FormControl>
                            <FormLabel>{t("password", "Password")}</FormLabel>
                            <Input {...register(`httpAccounts.${index}.pass` as const)} />
                          </FormControl>
                        </SimpleGrid>
                      </Box>
                    ))}
                    {!httpAccountFields.length && (
                      <Text fontSize="sm" color="gray.500">
                        {t("inbounds.http.noAccountsHint", "Add at least one username/password pair.")}
                      </Text>
                    )}
                  </Stack>
                  <FormControl display="flex" alignItems="center">
                    <FormLabel mb={0}>
                      {t("inbounds.http.allowTransparent", "Allow transparent proxy")}
                    </FormLabel>
                    <Switch {...register("httpAllowTransparent")} />
                  </FormControl>
                </Stack>
              )}
              {currentProtocol === "socks" && (
                <Stack spacing={3}>
                  <FormControl display="flex" alignItems="center">
                    <FormLabel mb={0}>{t("inbounds.socks.udp", "Enable UDP")}</FormLabel>
                    <Switch {...register("socksUdpEnabled")} />
                  </FormControl>
                  {socksUdpEnabled && (
                    <FormControl>
                      <FormLabel>{t("inbounds.socks.udpIp", "UDP bind IP")}</FormLabel>
                      <Input {...register("socksUdpIp")} placeholder="127.0.0.1" />
                    </FormControl>
                  )}
                  <FormControl display="flex" alignItems="center">
                    <FormLabel mb={0}>
                      {t("inbounds.socks.auth", "Require authentication")}
                    </FormLabel>
                    <Controller
                      control={control}
                      name="socksAuth"
                      render={({ field }) => (
                        <Switch
                          isChecked={field.value === "password"}
                          onChange={(event) =>
                            field.onChange(event.target.checked ? "password" : "noauth")
                          }
                        />
                      )}
                    />
                  </FormControl>
                  {socksAuth === "password" && (
                    <Stack spacing={3}>
                      <Flex justify="space-between" align="center">
                        <Text fontWeight="medium">
                          {t("inbounds.socks.accounts", "SOCKS accounts")}
                        </Text>
                        <Button
                          size="xs"
                          onClick={() => appendSocksAccount({ user: "", pass: "" })}
                        >
                          {t("inbounds.accounts.add", "Add account")}
                        </Button>
                      </Flex>
                      {socksAccountFields.map((field, index) => (
                        <Box
                          key={field.id}
                          borderWidth="1px"
                          borderRadius="md"
                          borderColor={sectionBorder}
                          p={3}
                        >
                          <Flex justify="space-between" align="center" mb={3}>
                            <Text fontWeight="semibold">
                              {t("inbounds.accounts.label", "Account")} #{index + 1}
                            </Text>
                            <Button
                              size="xs"
                              variant="ghost"
                              colorScheme="red"
                              onClick={() => removeSocksAccount(index)}
                            >
                              {t("hostsPage.delete", "Delete")}
                            </Button>
                          </Flex>
                          <SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
                            <FormControl>
                              <FormLabel>{t("username", "Username")}</FormLabel>
                              <Input {...register(`socksAccounts.${index}.user` as const)} />
                            </FormControl>
                            <FormControl>
                              <FormLabel>{t("password", "Password")}</FormLabel>
                              <Input {...register(`socksAccounts.${index}.pass` as const)} />
                            </FormControl>
                          </SimpleGrid>
                        </Box>
                      ))}
                      {!socksAccountFields.length && (
                        <Text fontSize="sm" color="gray.500">
                          {t("inbounds.socks.noAccountsHint", "Add at least one account for password mode.")}
                        </Text>
                      )}
                    </Stack>
                  )}
                </Stack>
              )}
            </Stack>

            {supportsStreamSettings && (
              <Stack
                spacing={4}
                borderWidth="1px"
                borderColor={sectionBorder}
                borderRadius="lg"
                p={4}
              >
              <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
                <FormControl>
                  <FormLabel>{t("inbounds.network", "Network")}</FormLabel>
                  <Select {...register("streamNetwork")}>
                    {streamNetworks.map((network) => (
                      <option key={network} value={network}>
                        {network}
                      </option>
                    ))}
                  </Select>
                </FormControl>
                <FormControl>
                  <FormLabel>{t("inbounds.security", "Security")}</FormLabel>
                  <Select {...register("streamSecurity")}>
                    {streamSecurityOptions.map((security) => (
                      <option key={security} value={security}>
                        {security}
                      </option>
                    ))}
                  </Select>
                </FormControl>
              </SimpleGrid>

              {streamNetwork === "ws" && (
                <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
                  <FormControl>
                    <FormLabel>{t("inbounds.ws.path", "WebSocket path")}</FormLabel>
                    <Input {...register("wsPath")} placeholder="/ws" />
                  </FormControl>
                  <FormControl>
                    <FormLabel>{t("inbounds.ws.host", "WebSocket host header")}</FormLabel>
                    <Input {...register("wsHost")} />
                  </FormControl>
                </SimpleGrid>
              )}

              {streamNetwork === "tcp" && (
                <Stack spacing={3}>
                  <FormControl>
                    <FormLabel>{t("inbounds.tcp.headerType", "TCP header type")}</FormLabel>
                    <Select {...register("tcpHeaderType")}>
                      <option value="none">none</option>
                      <option value="http">http</option>
                    </Select>
                  </FormControl>
                  {tcpHeaderType === "http" && (
                    <SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
                      <FormControl>
                        <FormLabel>{t("inbounds.tcp.host", "HTTP host list")}</FormLabel>
                        <Textarea {...register("tcpHttpHosts")} placeholder="example.com" />
                      </FormControl>
                      <FormControl>
                        <FormLabel>{t("inbounds.tcp.path", "HTTP path")}</FormLabel>
                        <Input {...register("tcpHttpPath")} />
                      </FormControl>
                    </SimpleGrid>
                  )}
                </Stack>
              )}

              {streamNetwork === "grpc" && (
                <SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
                  <FormControl>
                    <FormLabel>{t("inbounds.grpc.serviceName", "Service name")}</FormLabel>
                    <Input {...register("grpcServiceName")} />
                  </FormControl>
                  <FormControl>
                    <FormLabel>{t("inbounds.grpc.authority", "Authority")}</FormLabel>
                    <Input {...register("grpcAuthority")} />
                  </FormControl>
                  <FormControl display="flex" alignItems="center">
                    <FormLabel mb={0}>{t("inbounds.grpc.multiMode", "Multi mode")}</FormLabel>
                    <Switch {...register("grpcMultiMode")} />
                  </FormControl>
                </SimpleGrid>
              )}

              {streamNetwork === "kcp" && (
                <SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
                  <FormControl>
                    <FormLabel>{t("inbounds.kcp.headerType", "mKCP header")}</FormLabel>
                    <Input {...register("kcpHeaderType")} />
                  </FormControl>
                  <FormControl>
                    <FormLabel>{t("inbounds.kcp.seed", "mKCP seed")}</FormLabel>
                    <Input {...register("kcpSeed")} />
                  </FormControl>
                </SimpleGrid>
              )}

              {streamNetwork === "quic" && (
                <SimpleGrid columns={{ base: 1, md: 3 }} spacing={3}>
                  <FormControl>
                    <FormLabel>{t("inbounds.quic.security", "QUIC security")}</FormLabel>
                    <Input {...register("quicSecurity")} />
                  </FormControl>
                  <FormControl>
                    <FormLabel>{t("inbounds.quic.key", "QUIC key")}</FormLabel>
                    <Input {...register("quicKey")} />
                  </FormControl>
                  <FormControl>
                    <FormLabel>{t("inbounds.quic.headerType", "QUIC header type")}</FormLabel>
                    <Input {...register("quicHeaderType")} />
                  </FormControl>
                </SimpleGrid>
              )}

              {streamNetwork === "httpupgrade" && (
                <SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
                  <FormControl>
                    <FormLabel>{t("inbounds.httpUpgrade.path", "Path")}</FormLabel>
                    <Input {...register("httpupgradePath")} />
                  </FormControl>
                  <FormControl>
                    <FormLabel>{t("inbounds.httpUpgrade.host", "Host")}</FormLabel>
                    <Input {...register("httpupgradeHost")} />
                  </FormControl>
                </SimpleGrid>
              )}

              {streamNetwork === "splithttp" && (
                <SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
                  <FormControl>
                    <FormLabel>{t("inbounds.splitHttp.path", "Path")}</FormLabel>
                    <Input {...register("splithttpPath")} />
                  </FormControl>
                  <FormControl>
                    <FormLabel>{t("inbounds.splitHttp.host", "Host")}</FormLabel>
                    <Input {...register("splithttpHost")} />
                  </FormControl>
                </SimpleGrid>
              )}

              {streamNetwork === "xhttp" && (
                <Stack spacing={3}>
                  <SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
                    <FormControl>
                      <FormLabel>{t("inbounds.xhttp.host", "Host")}</FormLabel>
                      <Input {...register("xhttpHost")} placeholder="example.com" />
                    </FormControl>
                    <FormControl>
                      <FormLabel>{t("inbounds.xhttp.path", "Path")}</FormLabel>
                      <Input {...register("xhttpPath")} placeholder="/" />
                    </FormControl>
                  </SimpleGrid>
                  <Stack spacing={2}>
                    <Flex justify="space-between" align="center">
                      <Text fontWeight="medium">
                        {t("inbounds.xhttp.headers", "Custom headers")}
                      </Text>
                      <Button size="xs" onClick={() => appendXhttpHeader({ name: "", value: "" })}>
                        {t("inbounds.accounts.add", "Add")}
                      </Button>
                    </Flex>
                    {xhttpHeaderFields.map((field, index) => (
                      <HStack key={field.id} spacing={2} align="flex-start">
                        <FormControl>
                          <Input
                            {...register(`xhttpHeaders.${index}.name` as const)}
                            placeholder={t("inbounds.xhttp.headerName", "Header name")}
                          />
                        </FormControl>
                        <FormControl>
                          <Input
                            {...register(`xhttpHeaders.${index}.value` as const)}
                            placeholder={t("inbounds.xhttp.headerValue", "Header value")}
                          />
                        </FormControl>
                        <Button
                          size="xs"
                          variant="ghost"
                          colorScheme="red"
                          onClick={() => removeXhttpHeader(index)}
                        >
                          {t("hostsPage.delete", "Delete")}
                        </Button>
                      </HStack>
                    ))}
                  </Stack>
                  <SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
                    <FormControl>
                      <FormLabel>{t("inbounds.xhttp.mode", "Mode")}</FormLabel>
                      <Select {...register("xhttpMode")}>
                        {XHTTP_MODE_OPTIONS.map((mode) => (
                          <option key={mode} value={mode}>
                            {mode}
                          </option>
                        ))}
                      </Select>
                    </FormControl>
                    <FormControl>
                      <FormLabel>{t("inbounds.xhttp.paddingBytes", "Padding bytes")}</FormLabel>
                      <Input {...register("xhttpPaddingBytes")} placeholder="100-1000" />
                    </FormControl>
                  </SimpleGrid>
                  {xhttpMode === "packet-up" && (
                    <SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
                      <FormControl>
                        <FormLabel>{t("inbounds.xhttp.maxBuffered", "Max buffered upload")}</FormLabel>
                        <Input {...register("xhttpScMaxBufferedPosts")} placeholder="30" />
                      </FormControl>
                      <FormControl>
                        <FormLabel>
                          {t("inbounds.xhttp.maxUploadBytes", "Max upload size (bytes)")}
                        </FormLabel>
                        <Input {...register("xhttpScMaxEachPostBytes")} placeholder="1000000" />
                      </FormControl>
                    </SimpleGrid>
                  )}
                  {xhttpMode === "stream-up" && (
                    <FormControl>
                      <FormLabel>
                        {t("inbounds.xhttp.streamUp", "Stream-up server seconds")}
                      </FormLabel>
                      <Input {...register("xhttpScStreamUpServerSecs")} placeholder="20-80" />
                    </FormControl>
                  )}
                  <FormControl display="flex" alignItems="center">
                    <FormLabel mb={0}>{t("inbounds.xhttp.noSSE", "Disable SSE header")}</FormLabel>
                    <Switch {...register("xhttpNoSSEHeader")} />
                  </FormControl>
                </Stack>
              )}
              <FormControl display="flex" alignItems="center">
                <FormLabel mb={0}>{t("inbounds.sockopt.enable", "Enable sockopt")}</FormLabel>
                <Controller
                  control={control}
                  name="sockoptEnabled"
                  render={({ field }) => (
                    <Switch
                      isChecked={Boolean(field.value)}
                      onChange={(event) => field.onChange(event.target.checked)}
                    />
                  )}
                />
              </FormControl>
              <Collapse in={Boolean(sockoptEnabled)} animateOpacity>
                <Stack
                  spacing={4}
                  borderWidth="1px"
                  borderColor={sectionBorder}
                  borderRadius="md"
                  p={4}
                  mt={2}
                >
                  <SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
                    {renderSockoptNumberInput("mark", t("inbounds.sockopt.routeMark", "Route mark"))}
                    {renderSockoptNumberInput(
                      "tcpKeepAliveInterval",
                      t("inbounds.sockopt.tcpKeepAliveInterval", "TCP keep alive interval")
                    )}
                    {renderSockoptNumberInput(
                      "tcpKeepAliveIdle",
                      t("inbounds.sockopt.tcpKeepAliveIdle", "TCP keep alive idle")
                    )}
                    {renderSockoptNumberInput(
                      "tcpMaxSeg",
                      t("inbounds.sockopt.tcpMaxSeg", "TCP max segment")
                    )}
                    {renderSockoptNumberInput(
                      "tcpUserTimeout",
                      t("inbounds.sockopt.tcpUserTimeout", "TCP user timeout")
                    )}
                    {renderSockoptNumberInput(
                      "tcpWindowClamp",
                      t("inbounds.sockopt.tcpWindowClamp", "TCP window clamp")
                    )}
                  </SimpleGrid>
                  <SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
                    {renderSockoptTextInput(
                      "dialerProxy",
                      t("inbounds.sockopt.dialerProxy", "Dialer proxy"),
                      "proxy"
                    )}
                    {renderSockoptTextInput(
                      "interfaceName",
                      t("inbounds.sockopt.interfaceName", "Interface name")
                    )}
                  </SimpleGrid>
                  <SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
                    <FormControl>
                      <FormLabel>{t("inbounds.sockopt.domainStrategy", "Domain strategy")}</FormLabel>
                      <Controller
                        control={control}
                        name="sockopt.domainStrategy"
                        render={({ field }) => (
                          <ChakraSelect {...field}>
                            <option value="">{t("common.none", "None")}</option>
                            {DOMAIN_STRATEGY_OPTIONS.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </ChakraSelect>
                        )}
                      />
                    </FormControl>
                    <FormControl>
                      <FormLabel>{t("inbounds.sockopt.tcpCongestion", "TCP congestion")}</FormLabel>
                      <Controller
                        control={control}
                        name="sockopt.tcpcongestion"
                        render={({ field }) => (
                          <ChakraSelect {...field}>
                            <option value="">{t("common.none", "None")}</option>
                            {TCP_CONGESTION_OPTIONS.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </ChakraSelect>
                        )}
                      />
                    </FormControl>
                    <FormControl>
                      <FormLabel>{t("inbounds.sockopt.tproxy", "TProxy")}</FormLabel>
                      <Controller
                        control={control}
                        name="sockopt.tproxy"
                        render={({ field }) => (
                          <ChakraSelect {...field}>
                            {TPROXY_OPTIONS.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </ChakraSelect>
                        )}
                      />
                    </FormControl>
                  </SimpleGrid>
                  <SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
                    {renderSockoptSwitch(
                      "acceptProxyProtocol",
                      t("inbounds.sockopt.acceptProxyProtocol", "Accept proxy protocol")
                    )}
                    {renderSockoptSwitch(
                      "tcpFastOpen",
                      t("inbounds.sockopt.tcpFastOpen", "TCP fast open")
                    )}
                    {renderSockoptSwitch(
                      "tcpMptcp",
                      t("inbounds.sockopt.tcpMptcp", "Multipath TCP")
                    )}
                    {renderSockoptSwitch("penetrate", t("inbounds.sockopt.penetrate", "Penetrate"))}
                    {renderSockoptSwitch("V6Only", t("inbounds.sockopt.v6Only", "IPv6 only"))}
                  </SimpleGrid>
                </Stack>
              </Collapse>
            </Stack>
            )}
            {streamSecurity === "tls" && (
              <Stack
                spacing={4}
                borderWidth="1px"
                borderColor={sectionBorder}
                borderRadius="lg"
                p={4}
              >
                <FormControl>
                  <FormLabel>{t("inbounds.tls.serverName", "Server name (SNI)")}</FormLabel>
                  <Input {...register("tlsServerName")} placeholder="example.com" />
                </FormControl>
                <FormControl>
                  <FormLabel>{t("inbounds.tls.fingerprint", "uTLS fingerprint")}</FormLabel>
                  <Select {...register("tlsFingerprint")}>
                    <option value="">{t("common.none", "None")}</option>
                    {tlsFingerprintOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </Select>
                </FormControl>
                <FormControl display="flex" alignItems="center">
                  <FormLabel mb={0}>{t("inbounds.tls.allowInsecure", "Allow insecure")}</FormLabel>
                  <Switch {...register("tlsAllowInsecure")} />
                </FormControl>
              </Stack>
            )}

            {streamSecurity === "reality" && (
              <Stack
                spacing={4}
                borderWidth="1px"
                borderColor={sectionBorder}
                borderRadius="lg"
                p={4}
              >
                <FormControl isRequired>
                  <FormLabel>{t("inbounds.reality.privateKey", "Reality private key")}</FormLabel>
                  <Textarea rows={3} {...register("realityPrivateKey", { required: true })} />
                  <Button
                    size="xs"
                    mt={2}
                    variant="outline"
                    onClick={handleGenerateRealityKeypair}
                    alignSelf="flex-start"
                  >
                    {t("inbounds.reality.generateKeys", "Generate key pair")}
                  </Button>
                </FormControl>
                <FormControl>
                  <FormLabel>{t("inbounds.reality.publicKey", "Reality public key")}</FormLabel>
                  <Input
                    value={derivedRealityPublicKey}
                    isReadOnly
                    placeholder={t("inbounds.reality.publicKeyPlaceholder", "Derived automatically")}
                  />
                </FormControl>
                <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
                  <FormControl>
                    <FormLabel>{t("inbounds.reality.serverNames", "Server names")}</FormLabel>
                    <Textarea
                      rows={2}
                      {...register("realityServerNames")}
                      placeholder="domain.com"
                    />
                    <Box fontSize="sm" color="gray.500">
                      {t("inbounds.serverNamesHint", "Separate entries with commas or new lines.")}
                    </Box>
                  </FormControl>
                  <FormControl>
                    <FormLabel>{t("inbounds.reality.dest", "Destination (host:port)")}</FormLabel>
                    <Input {...register("realityDest")} placeholder="example.com:443" />
                  </FormControl>
                </SimpleGrid>
                <FormControl>
                  <FormLabel>{t("inbounds.reality.shortIds", "Short IDs")}</FormLabel>
                  <Textarea rows={2} {...register("realityShortIds")} />
                  <Button
                    size="xs"
                    mt={2}
                    variant="outline"
                    onClick={handleGenerateShortId}
                    alignSelf="flex-start"
                  >
                    {t("inbounds.reality.generateShortId", "Generate short ID")}
                  </Button>
                  <Box fontSize="sm" color="gray.500">
                    {t("inbounds.shortIdsHint", "Separate entries with commas or new lines.")}
                  </Box>
                </FormControl>
                <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
                  <FormControl>
                    <FormLabel>{t("inbounds.reality.spiderX", "SpiderX")}</FormLabel>
                    <Input {...register("realitySpiderX")} />
                  </FormControl>
                  <FormControl>
                    <FormLabel>{t("inbounds.reality.xver", "Xver")}</FormLabel>
                    <Input {...register("realityXver")} />
                  </FormControl>
                </SimpleGrid>
              </Stack>
            )}

            {supportsFallback && (
              <Stack
                spacing={3}
                borderWidth="1px"
                borderColor={sectionBorder}
                borderRadius="lg"
                p={4}
              >
                <Flex align="center" justify="space-between">
                  <Box fontWeight="medium">{t("inbounds.fallbacks", "Fallbacks")}</Box>
                  <Button size="xs" onClick={handleAddFallback}>
                    {t("inbounds.fallbacks.add", "Add fallback")}
                  </Button>
                </Flex>
                {fallbackFields.length === 0 ? (
                  <Text fontSize="sm" color="gray.500">
                    {t("inbounds.fallbacks.empty", "No fallbacks configured yet.")}
                  </Text>
                ) : (
                  fallbackFields.map((field, index) => (
                    <Box
                      key={field.id}
                      borderWidth="1px"
                      borderRadius="md"
                      borderColor={sectionBorder}
                      p={3}
                    >
                      <Flex justify="space-between" align="center" mb={3}>
                        <Text fontWeight="semibold">
                          {t("inbounds.fallbacks.type", "Fallback")} #{index + 1}
                        </Text>
                        <Button
                          size="xs"
                          variant="ghost"
                          colorScheme="red"
                          onClick={() => removeFallback(index)}
                        >
                          {t("hostsPage.delete", "Delete")}
                        </Button>
                      </Flex>
                      <SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
                        <FormControl>
                          <FormLabel>{t("inbounds.fallbacks.dest", "Destination (host:port)")}</FormLabel>
                          <Input
                            placeholder="example.com:443"
                            {...register(`fallbacks.${index}.dest` as const)}
                          />
                        </FormControl>
                        <FormControl>
                          <FormLabel>{t("inbounds.fallbacks.path", "Path")}</FormLabel>
                          <Input {...register(`fallbacks.${index}.path` as const)} placeholder="/" />
                        </FormControl>
                        <FormControl>
                          <FormLabel>{t("inbounds.fallbacks.type", "Type")}</FormLabel>
                          <Input {...register(`fallbacks.${index}.type` as const)} placeholder="none" />
                        </FormControl>
                        <FormControl>
                          <FormLabel>{t("inbounds.fallbacks.alpn", "ALPN")}</FormLabel>
                          <Input {...register(`fallbacks.${index}.alpn` as const)} placeholder="h2,http/1.1" />
                        </FormControl>
                        <FormControl>
                          <FormLabel>Xver</FormLabel>
                          <Input {...register(`fallbacks.${index}.xver` as const)} placeholder="0" />
                        </FormControl>
                      </SimpleGrid>
                    </Box>
                  ))
                )}
              </Stack>
            )}

            <Stack
              spacing={4}
              borderWidth="1px"
              borderColor={sectionBorder}
              borderRadius="lg"
              p={4}
            >
              <Flex align="center" justify="space-between">
                <HStack spacing={2}>
                  <Box fontWeight="medium">{t("inbounds.sniffing", "Sniffing")}</Box>
                  <Tooltip label={t("inbounds.sniffingHint", "It is recommended to keep the default.")}>
                    <QuestionMarkCircleIcon width={16} height={16} />
                  </Tooltip>
                </HStack>
                <Switch {...register("sniffingEnabled")} />
              </Flex>
              {sniffingEnabled && (
                <Stack spacing={3}>
                  <FormControl>
                    <FormLabel>{t("inbounds.sniffingDestinations", "Protocols to sniff")}</FormLabel>
                    <Controller
                      control={control}
                      name="sniffingDestinations"
                      render={({ field }) => (
                      <CheckboxGroup value={field.value ?? []} onChange={field.onChange}>
                        <HStack spacing={4}>
                          {sniffingOptions.map((option) => (
                            <Checkbox key={option.value} value={option.value}>
                              {option.label}
                            </Checkbox>
                            ))}
                          </HStack>
                        </CheckboxGroup>
                      )}
                    />
                  </FormControl>
                  <FormControl display="flex" alignItems="center">
                    <FormLabel mb={0}>
                      {t("inbounds.sniffingRouteOnly", "Route only")}
                    </FormLabel>
                    <Switch {...register("sniffingRouteOnly")} />
                  </FormControl>
                  <FormControl display="flex" alignItems="center">
                    <FormLabel mb={0}>
                      {t("inbounds.sniffingMetadataOnly", "Metadata only")}
                    </FormLabel>
                    <Switch {...register("sniffingMetadataOnly")} />
                  </FormControl>
                </Stack>
              )}
            </Stack>
          </VStack>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" mr={3} onClick={onClose}>
            {t("hostsPage.cancel", "Cancel")}
          </Button>
          <Button
            colorScheme="primary"
            isLoading={isSubmitting}
            onClick={handleSubmit(submitForm)}
          >
            {mode === "create" ? t("common.create", "Create") : t("common.save", "Save")}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};
