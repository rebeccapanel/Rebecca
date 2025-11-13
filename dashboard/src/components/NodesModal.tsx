import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalCloseButton,
  ModalBody,
  ModalFooter,
  VStack,
  HStack,
  FormControl,
  FormLabel,
  Checkbox,
  Button,
  Text,
  useToast,
  Collapse,
  IconButton,
  Tooltip,
  Input as ChakraInput,
  InputGroup,
  InputRightAddon,
  FormErrorMessage,
} from "@chakra-ui/react";
import { EyeIcon, EyeSlashIcon } from "@heroicons/react/24/outline";
import { zodResolver } from "@hookform/resolvers/zod";
import { FC, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useQuery } from "react-query";
import { fetch } from "service/http";
import { NodeSchema, getNodeDefaultValues } from "contexts/NodesContext";
import { Input } from "./Input";
import { chakra } from "@chakra-ui/react";

type LegacyTextRange = { moveToElementText: (el: Element) => void; select: () => void };

const EyeIconStyled = chakra(EyeIcon, { baseStyle: { w: 4, h: 4 } });
const EyeSlashIconStyled = chakra(EyeSlashIcon, { baseStyle: { w: 4, h: 4 } });

const BYTES_IN_GB = 1024 ** 3;

const formatDataLimitInput = (bytes?: number | null) => {
  if (bytes === null || bytes === undefined || bytes <= 0) {
    return "";
  }
  const gbValue = bytes / BYTES_IN_GB;
  if (!Number.isFinite(gbValue)) {
    return "";
  }
  return (Math.round(gbValue * 100) / 100).toString();
};

const parseDataLimitInput = (value: string): number | null | undefined => {
  const trimmed = value.trim();
  if (!trimmed.length) {
    return null;
  }
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return undefined;
  }
  if (numeric === 0) {
    return null;
  }
  return Math.round(numeric * BYTES_IN_GB);
};

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
  const [showCertificate, setShowCertificate] = useState(false);
  const [dataLimitInput, setDataLimitInput] = useState("");
  const [dataLimitError, setDataLimitError] = useState<string | undefined>(undefined);

  const { data: nodeSettings, isLoading: nodeSettingsLoading } = useQuery({
    queryKey: "node-settings",
    queryFn: () => fetch<{ min_node_version: string; certificate: string }>("/node/settings"),
  });

  const form = useForm({
    resolver: zodResolver(NodeSchema),
    defaultValues: isAddMode ? { ...getNodeDefaultValues(), add_as_new_host: false } : node,
  });

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    if (isAddMode) {
      form.reset({ ...getNodeDefaultValues(), add_as_new_host: false });
      setDataLimitInput("");
    } else if (node) {
      form.reset(node);
      setDataLimitInput(formatDataLimitInput(node?.data_limit ?? null));
    }
    setDataLimitError(undefined);
  }, [isAddMode, isOpen, node, form]);

  const handleSubmit = form.handleSubmit((data) => {
    const parsedLimit = parseDataLimitInput(dataLimitInput);
    if (parsedLimit === undefined) {
      setDataLimitError(t("nodes.dataLimitValidation", "Data limit must be a non-negative number"));
      return;
    }
    setDataLimitError(undefined);
    
    const submitData = {
      ...data,
      data_limit: parsedLimit,
    };
    
    mutate(submitData);
  });

  function selectText(node: HTMLElement) {
    const body = document.body as unknown as { createTextRange?: () => LegacyTextRange };
    if (body?.createTextRange) {
      const range = body.createTextRange();
      range.moveToElementText(node);
      range.select();
    } else if (window.getSelection) {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(node);
      selection!.removeAllRanges();
      selection!.addRange(range);
    } else {
      console.warn("Could not select text in node: Unsupported browser.");
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="sm">
      <ModalOverlay bg="blackAlpha.300" backdropFilter="blur(10px)" />
      <ModalContent mx="3">
        <ModalHeader pt={6}>
          <Text fontWeight="semibold" fontSize="lg">
            {isAddMode ? t("nodes.addNewRebeccaNode") : t("nodes.editNode")}
          </Text>
        </ModalHeader>
        <ModalCloseButton mt={3} />
        <ModalBody>
          <form onSubmit={handleSubmit}>
            <VStack spacing={4}>
              {isAddMode && nodeSettings?.certificate && (
                <VStack w="full" spacing={2}>
                  <Collapse in={showCertificate} animateOpacity style={{ width: "100%" }}>
                    <Text
                      bg="rgba(255,255,255,.5)"
                      _dark={{ bg: "rgba(255,255,255,.2)" }}
                      rounded="md"
                      p="2"
                      lineHeight="1.2"
                      fontSize="10px"
                      fontFamily="Courier"
                      whiteSpace="pre"
                      overflow="auto"
                      onClick={(e) => selectText(e.target as HTMLElement)}
                    >
                      {nodeSettings.certificate}
                    </Text>
                  </Collapse>
                  <HStack justify="end" py={2} w="full">
                    <Button
                      as="a"
                      colorScheme="primary"
                      size="xs"
                      download="ssl_client_cert.pem"
                      href={URL.createObjectURL(
                        new Blob([nodeSettings.certificate], { type: "text/plain" })
                      )}
                    >
                      {t("nodes.download-certificate")}
                    </Button>
                    <Tooltip
                      placement="top"
                      label={t(
                        !showCertificate ? "nodes.show-certificate" : "nodes.hide-certificate"
                      )}
                    >
                      <IconButton
                        aria-label={t(
                          !showCertificate ? "nodes.show-certificate" : "nodes.hide-certificate"
                        )}
                        onClick={() => setShowCertificate(!showCertificate)}
                        colorScheme="whiteAlpha"
                        color="primary"
                        size="xs"
                      >
                        {showCertificate ? <EyeSlashIconStyled /> : <EyeIconStyled />}
                      </IconButton>
                    </Tooltip>
                  </HStack>
                </VStack>
              )}
              <FormControl>
                  <Input
                    label={t("nodes.nodeName")}
                    size="sm"
                    placeholder="Rebecca-S2"
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
              <HStack w="full">
                <FormControl>
                  <Input
                    label={t("nodes.nodePort")}
                    size="sm"
                    type="text"
                    inputMode="numeric"
                    placeholder="62050"
                    {...form.register("port")}
                    error={getInputError(form.formState?.errors?.port)}
                  />
                </FormControl>
                <FormControl>
                  <Input
                    label={t("nodes.nodeAPIPort")}
                    size="sm"
                    type="text"
                    inputMode="numeric"
                    placeholder="62051"
                    {...form.register("api_port")}
                    error={getInputError(form.formState?.errors?.api_port)}
                  />
                </FormControl>
              </HStack>
              <FormControl>
                  <Input
                    label={t("nodes.usageCoefficient")}
                    size="sm"
                    type="text"
                    inputMode="decimal"
                    placeholder="1"
                    {...form.register("usage_coefficient")}
                    error={getInputError(form.formState?.errors?.usage_coefficient)}
                />
              </FormControl>
              <FormControl isInvalid={!!dataLimitError}>
                <FormLabel fontSize="xs" mb={1.5}>
                  {t("nodes.dataLimitField", "Data limit (GB)")}
                </FormLabel>
                <InputGroup size="sm">
                  <ChakraInput
                    type="text"
                    inputMode="decimal"
                    value={dataLimitInput}
                    onChange={(e) => {
                      setDataLimitInput(e.target.value);
                      if (dataLimitError) {
                        setDataLimitError(undefined);
                      }
                    }}
                    placeholder={t("nodes.dataLimitPlaceholder", "e.g., 500 (empty = unlimited)")}
                    borderRightRadius={0}
                  />
                  <InputRightAddon borderLeftRadius={0}>GB</InputRightAddon>
                </InputGroup>
                {dataLimitError && <FormErrorMessage>{dataLimitError}</FormErrorMessage>}
              </FormControl>
              {isAddMode && (
                <FormControl>
                  <Checkbox {...form.register("add_as_new_host")}>
                    <FormLabel m={0}>{t("nodes.addHostForEveryInbound")}</FormLabel>
                  </Checkbox>
                </FormControl>
              )}
              <Button type="submit" colorScheme="primary" size="sm" isLoading={isLoading}>
                {isAddMode ? t("nodes.addNode") : t("nodes.editNode")}
              </Button>
            </VStack>
          </form>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
};
