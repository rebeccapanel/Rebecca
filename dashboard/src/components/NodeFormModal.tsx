import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalCloseButton,
  ModalBody,
  ModalFooter,
  Box,
  VStack,
  HStack,
  Stack,
  SimpleGrid,
  FormControl,
  FormLabel,
  Checkbox,
  Button,
  Text,
  Switch,
  useToast,
  Collapse,
  IconButton,
  Tooltip,
  Tag,
  useClipboard,
} from "@chakra-ui/react";
import { EyeIcon, EyeSlashIcon, DocumentDuplicateIcon, ArrowDownTrayIcon } from "@heroicons/react/24/outline";
import { zodResolver } from "@hookform/resolvers/zod";
import { FC, useState, useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useQuery } from "react-query";
import { fetch } from "service/http";
import { getPanelSettings } from "service/settings";
import { NodeSchema, getNodeDefaultValues, useNodes } from "contexts/NodesContext";
import { Input } from "./Input";
import { chakra } from "@chakra-ui/react";
import { SizeFormatter } from "../utils/outbound";
import dayjs from "dayjs";

const EyeIconStyled = chakra(EyeIcon, { baseStyle: { w: 4, h: 4 } });
const EyeSlashIconStyled = chakra(EyeSlashIcon, { baseStyle: { w: 4, h: 4 } });
const CopyIconStyled = chakra(DocumentDuplicateIcon, { baseStyle: { w: 4, h: 4 } });
const DownloadIconStyled = chakra(ArrowDownTrayIcon, { baseStyle: { w: 4, h: 4 } });

const BYTES_IN_GB = 1024 * 1024 * 1024;
const DEFAULT_NOBETCI_PORT = 51031;

const getInputError = (error: unknown): string | undefined => {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" ? message : undefined;
  }
  return undefined;
};

interface NodeFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  node?: any;
  mutate: (data: any) => void;
  isLoading: boolean;
  isAddMode?: boolean;
}

export const NodeFormModal: FC<NodeFormModalProps> = ({
  isOpen,
  onClose,
  node,
  mutate,
  isLoading,
  isAddMode = false,
}) => {
  const { t } = useTranslation();
  const toast = useToast();
  const [showCertificate, setShowCertificate] = useState(isAddMode);
  const { fetchNodesUsage } = useNodes();
  const [nodeUsage, setNodeUsage] = useState<{ uplink: number; downlink: number } | null>(null);

  const { data: nodeSettings, isLoading: nodeSettingsLoading } = useQuery({
    queryKey: "node-settings",
    queryFn: () => fetch<{ min_node_version: string; certificate: string }>("/node/settings"),
  });

  const { data: panelSettings } = useQuery({
    queryKey: "panel-settings",
    queryFn: getPanelSettings,
    staleTime: 5 * 60 * 1000,
  });

  const allowNobetci = panelSettings?.use_nobetci ?? true;

  const formatDataLimitForInput = (value?: number | null) => {
    if (value === null || value === undefined) {
      return null;
    }
    const gbValue = value / BYTES_IN_GB;
    if (!Number.isFinite(gbValue)) {
      return null;
    }
    const rounded = Math.round(gbValue * 100) / 100;
    return rounded;
  };

  const convertLimitToBytes = (value?: number | null) =>
    value === null || value === undefined ? null : Math.round(value * BYTES_IN_GB);

  const baseDefaults = isAddMode
    ? { ...getNodeDefaultValues(), add_as_new_host: false }
    : {
        ...getNodeDefaultValues(),
        ...node,
        add_as_new_host: false,
      };

  const form = useForm({
    resolver: zodResolver(NodeSchema),
    defaultValues: {
      ...baseDefaults,
      data_limit: formatDataLimitForInput(baseDefaults.data_limit ?? null),
    },
  });

  const certificateValue = nodeSettings?.certificate ?? "";
  const { onCopy: copyCertificate, hasCopied: certificateCopied } = useClipboard(certificateValue);
  const useNobetci = form.watch("use_nobetci");

  useEffect(() => {
    if (!allowNobetci || !useNobetci) {
      if (form.getValues("nobetci_port") !== null) {
        form.setValue("nobetci_port", null);
      }
      return;
    }
    const currentPort = form.getValues("nobetci_port");
    if (currentPort === null || currentPort === undefined || currentPort === "") {
      form.setValue("nobetci_port", DEFAULT_NOBETCI_PORT);
    }
  }, [useNobetci, form, allowNobetci]);

  useEffect(() => {
    if (panelSettings && !panelSettings.use_nobetci) {
      if (form.getValues("use_nobetci")) {
        form.setValue("use_nobetci", false);
      }
      if (form.getValues("nobetci_port") !== null) {
        form.setValue("nobetci_port", null);
      }
    }
  }, [panelSettings, form]);

  useEffect(() => {
    if (isOpen) {
      const defaults = isAddMode
        ? { ...getNodeDefaultValues(), add_as_new_host: false }
        : {
            ...getNodeDefaultValues(),
            ...node,
            add_as_new_host: false,
          };
      form.reset({
        ...defaults,
        data_limit: formatDataLimitForInput(defaults.data_limit ?? null),
      });
      setShowCertificate(isAddMode && !!certificateValue);
    }
  }, [isOpen, isAddMode, node, form, certificateValue]);

  useEffect(() => {
    if (!isAddMode && node && isOpen) {
      fetchNodesUsage({
        start: dayjs().utc().subtract(30, "day").format("YYYY-MM-DDTHH:00:00"),
      }).then((data: any) => {
        const usage = data.usages[node.id];
        if (usage) {
          setNodeUsage({ uplink: usage.uplink, downlink: usage.downlink });
        }
      });
    } else {
      setNodeUsage(null);
    }
  }, [node, isAddMode, isOpen, fetchNodesUsage]);

  const handleSubmit = form.handleSubmit((data) => {
    const payload = {
      ...data,
      data_limit: convertLimitToBytes(data.data_limit ?? null),
    };
    mutate(payload);
  });

  const handleCopyCertificate = () => {
    if (!certificateValue) return;
    copyCertificate();
    toast({
      title: t("copied"),
      status: "success",
      isClosable: true,
      position: "top",
      duration: 2000,
    });
  };

  const handleDownloadCertificate = () => {
    if (!certificateValue) return;
    const blob = new Blob([certificateValue], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "ssl_client_cert.pem";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleClose = () => {
    setShowCertificate(false);
    setNodeUsage(null);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} size="lg">
      <ModalOverlay bg="blackAlpha.300" backdropFilter="blur(10px)" />
      <ModalContent mx="3" as="form" onSubmit={handleSubmit}>
        <ModalHeader pt={6}>
          <Text fontWeight="semibold" fontSize="lg">
            {isAddMode ? t("nodes.addNewMarzbanNode") : t("nodes.editNode")}
          </Text>
        </ModalHeader>
        <ModalCloseButton mt={3} />
        <ModalBody>
          <Stack spacing={6}>
            {!isAddMode && nodeUsage && (
              <Stack spacing={2}>
                <Text fontWeight="medium">{t("nodes.usage")}</Text>
                <HStack>
                  <Tag colorScheme="green">
                    {t("nodes.uplink")}: {SizeFormatter.sizeFormat(nodeUsage.uplink)}
                  </Tag>
                  <Tag colorScheme="blue">
                    {t("nodes.downlink")}: {SizeFormatter.sizeFormat(nodeUsage.downlink)}
                  </Tag>
                </HStack>
              </Stack>
            )}

            {isAddMode && (
              <Stack spacing={3}>
                <HStack justify="space-between" align="center">
                  <Text fontWeight="medium">{t("nodes.certificate")}</Text>
                  <HStack spacing={2}>
                    <Button
                      size="xs"
                      variant="outline"
                      leftIcon={<CopyIconStyled />}
                      onClick={handleCopyCertificate}
                      isDisabled={!certificateValue}
                    >
                      {certificateCopied ? t("copied") : t("copy")}
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      leftIcon={<DownloadIconStyled />}
                      onClick={handleDownloadCertificate}
                      isDisabled={!certificateValue}
                    >
                      {t("nodes.download-certificate")}
                    </Button>
                    <Tooltip
                      placement="top"
                      label={t(
                        showCertificate ? "nodes.hide-certificate" : "nodes.show-certificate"
                      )}
                    >
                      <IconButton
                        aria-label={t(
                          showCertificate ? "nodes.hide-certificate" : "nodes.show-certificate"
                        )}
                        onClick={() => setShowCertificate((prev) => !prev)}
                        size="xs"
                        variant="ghost"
                      >
                        {showCertificate ? <EyeSlashIconStyled /> : <EyeIconStyled />}
                      </IconButton>
                    </Tooltip>
                  </HStack>
                </HStack>
                <Collapse in={showCertificate && !!certificateValue} animateOpacity>
                  <Box
                    borderWidth="1px"
                    borderRadius="md"
                    p={3}
                    fontFamily="mono"
                    fontSize="xs"
                    maxH="220px"
                    overflow="auto"
                    bg="gray.50"
                    _dark={{ bg: "whiteAlpha.100" }}
                  >
                    {certificateValue || (nodeSettingsLoading ? t("loading") : "")}
                  </Box>
                </Collapse>
                {!certificateValue && !nodeSettingsLoading && (
                  <Text fontSize="xs" color="gray.500" _dark={{ color: "gray.400" }}>
                    {t("nodes.certificateUnavailable", "Certificate not available.")}
                  </Text>
                )}
              </Stack>
            )}

            <Stack spacing={4}>
              <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
                <FormControl>
                  <Input
                    label={t("nodes.nodeName")}
                    size="sm"
                    placeholder="Marzban-S2"
                    {...form.register("name")}
                    error={getInputError(form.formState?.errors?.name)}
                  />
                </FormControl>
                <FormControl>
                  <Input
                    label={t("nodes.nodeAddress")}
                    size="sm"
                    placeholder="51.20.12.13"
                    {...form.register("address")}
                    error={getInputError(form.formState?.errors?.address)}
                  />
                </FormControl>
              </SimpleGrid>
              <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
                <FormControl>
                  <Input
                    label={t("nodes.nodePort")}
                    size="sm"
                    placeholder="62050"
                    {...form.register("port")}
                    error={getInputError(form.formState?.errors?.port)}
                  />
                </FormControl>
                <FormControl>
                  <Input
                    label={t("nodes.nodeAPIPort")}
                    size="sm"
                    placeholder="62051"
                    {...form.register("api_port")}
                    error={getInputError(form.formState?.errors?.api_port)}
                  />
                </FormControl>
              </SimpleGrid>
              <FormControl>
                <Input
                  label={t("nodes.usageCoefficient")}
                  size="sm"
                  placeholder="1"
                  {...form.register("usage_coefficient")}
                  error={getInputError(form.formState?.errors?.usage_coefficient)}
                />
              </FormControl>
              <FormControl>
                <Input
                  label={t("nodes.dataLimitField", "Data Limit (GB)")}
                  size="sm"
                  type="number"
                  step={0.01}
                  min={0}
                  placeholder={t("nodes.dataLimitPlaceholder", "e.g., 500 (empty = unlimited)")}
                  {...form.register("data_limit", {
                    setValueAs: (value) => {
                      if (value === "" || value === null || value === undefined) {
                        return null;
                      }
                      const parsed = Number(value);
                      return Number.isFinite(parsed) ? parsed : Number.NaN;
                    },
                    validate: (value) => {
                      if (value === null || value === undefined) {
                        return true;
                      }
                      if (Number.isNaN(value)) {
                        return t(
                          "nodes.dataLimitValidation",
                          "Data limit must be a valid number"
                        );
                      }
                      return value >= 0 || t(
                        "nodes.dataLimitPositive",
                        "Data limit must be zero or greater"
                      );
                    },
                  })}
                  error={getInputError(form.formState?.errors?.data_limit)}
                />
                <Text fontSize="xs" color="gray.500" mt={1}>
                  {t("nodes.dataLimitHint", "Leave empty for unlimited data.")}
                </Text>
              </FormControl>
              {allowNobetci && (
                <>
                  <FormControl display="flex" alignItems="center">
                    <FormLabel mb={0}>{t("nodes.useNobetci", "Enable Nobetci integration")}</FormLabel>
                    <Controller
                      control={form.control}
                      name="use_nobetci"
                      render={({ field }) => (
                        <Switch
                          isChecked={Boolean(field.value)}
                          onChange={(event) => field.onChange(event.target.checked)}
                        />
                      )}
                    />
                  </FormControl>
                  <Collapse in={Boolean(useNobetci)} animateOpacity>
                    <FormControl mt={useNobetci ? 2 : 0}>
                      <Input
                        label={t("nodes.nobetciPort", "Nobetci port")}
                        size="sm"
                        placeholder="443"
                        {...form.register("nobetci_port", {
                          setValueAs: (value) => {
                            if (value === "" || value === null || value === undefined) {
                              return null;
                            }
                            const parsed = Number(value);
                            return Number.isFinite(parsed) ? parsed : Number.NaN;
                          },
                          validate: (value) => {
                            if (!useNobetci) {
                              return true;
                            }
                            if (value === null || value === undefined) {
                              return t("nodes.nobetciPortRequired", "Port is required when Nobetci is enabled");
                            }
                            if (Number.isNaN(value)) {
                              return t("nodes.nobetciPortInvalid", "Enter a valid port number");
                            }
                            return value >= 1 && value <= 65535
                              ? true
                              : t("nodes.nobetciPortRange", "Port must be between 1 and 65535");
                          },
                        })}
                        error={getInputError(form.formState?.errors?.nobetci_port)}
                      />
                      <Text fontSize="xs" color="gray.500" mt={1}>
                        {t(
                          "nodes.nobetciHint",
                          "Provide the Nobetci listener port. Leave blank to disable."
                        )}
                      </Text>
                    </FormControl>
                  </Collapse>
                </>
              )}
            </Stack>

            {isAddMode && (
              <Box>
                <Checkbox {...form.register("add_as_new_host")}>
                  {t("nodes.addHostForEveryInbound")}
                </Checkbox>
              </Box>
            )}
          </Stack>
        </ModalBody>
        <ModalFooter gap={3}>
          <Button variant="outline" onClick={handleClose}>
            {t("cancel")}
          </Button>
          <Button type="submit" colorScheme="primary" isLoading={isLoading}>
            {isAddMode ? t("nodes.addNode") : t("nodes.editNode")}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

