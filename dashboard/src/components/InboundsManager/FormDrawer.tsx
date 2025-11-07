import {
  Box,
  Button,
  Checkbox,
  CheckboxGroup,
  Flex,
  FormControl,
  FormLabel,
  HStack,
  Input as ChakraInput,
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
} from "react-hook-form";
import { useEffect, FC, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";

import {
  InboundFormValues,
  Protocol,
  protocolOptions,
  streamNetworks,
  streamSecurityOptions,
  sniffingOptions,
  tlsAlpnOptions,
  tlsFingerprintOptions,
  createDefaultInboundForm,
  rawInboundToFormValues,
} from "utils/inbounds";
import { RawInbound } from "utils/inbounds";
import { generateWireguardKeypair } from "utils/wireguard";

type Props = {
  isOpen: boolean;
  mode: "create" | "edit";
  initialValue: RawInbound | null;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (values: InboundFormValues) => Promise<void>;
};

const Input = (props: InputProps) => <ChakraInput size="sm" {...props} />;
const Select = (props: SelectProps) => <ChakraSelect size="sm" {...props} />;
const Textarea = (props: TextareaProps) => <ChakraTextarea size="sm" resize="vertical" {...props} />;

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

  const form = useForm<InboundFormValues>({
    defaultValues: createDefaultInboundForm(),
  });
  const { control, register, handleSubmit, reset, watch } = form;
  const { fields: fallbackFields, append: appendFallback, remove: removeFallback } = useFieldArray({
    control,
    name: "fallbacks",
  });

  useEffect(() => {
    if (initialValue) {
      reset(rawInboundToFormValues(initialValue));
    } else {
      reset(createDefaultInboundForm());
    }
  }, [initialValue, reset, isOpen]);

  const currentProtocol = watch("protocol");
  const streamNetwork = watch("streamNetwork");
  const streamSecurity = watch("streamSecurity");
  const sniffingEnabled = watch("sniffingEnabled");
  const realityPrivateKey = watch("realityPrivateKey");
  const supportsFallback = currentProtocol === "vless" || currentProtocol === "trojan";

  const sectionBorder = useColorModeValue("gray.200", "gray.700");

  const submitForm = async (values: InboundFormValues) => {
    await onSubmit(values);
  };

  const handleGenerateRealityKeypair = useCallback(() => {
    try {
      const { privateKey } = generateWireguardKeypair();
      form.setValue("realityPrivateKey", privateKey, { shouldDirty: true });
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
    if (!realityPrivateKey || !realityPrivateKey.trim()) {
      return "";
    }
    try {
      return generateWireguardKeypair(realityPrivateKey.trim()).publicKey;
    } catch {
      return "";
    }
  }, [realityPrivateKey]);

  const handleAddFallback = () =>
    appendFallback({ dest: "", path: "", type: "", alpn: "", xver: "" });

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
            </Stack>

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
                  {watch("tcpHeaderType") === "http" && (
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
            </Stack>

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
                  <FormLabel>{t("inbounds.tls.alpn", "ALPN")}</FormLabel>
                  <Controller
                    control={control}
                    name="tlsAlpn"
                    render={({ field }) => (
                      <CheckboxGroup {...field}>
                        <HStack spacing={4}>
                          {tlsAlpnOptions.map((option) => (
                            <Checkbox key={option} value={option}>
                              {option}
                            </Checkbox>
                          ))}
                        </HStack>
                      </CheckboxGroup>
                    )}
                  />
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
                  <Textarea {...register("realityPrivateKey", { required: true })} />
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
                <FormControl>
                  <FormLabel>{t("inbounds.reality.dest", "Destination (host:port)")}</FormLabel>
                  <Input {...register("realityDest")} placeholder="example.com:443" />
                </FormControl>
                <FormControl>
                  <FormLabel>{t("inbounds.reality.spiderX", "SpiderX")}</FormLabel>
                  <Input {...register("realitySpiderX")} />
                </FormControl>
                <FormControl>
                  <FormLabel>{t("inbounds.reality.xver", "Xver")}</FormLabel>
                  <Input {...register("realityXver")} />
                </FormControl>
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
                        <CheckboxGroup {...field}>
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
