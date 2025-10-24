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
} from "@chakra-ui/react";
import { EyeIcon, EyeSlashIcon } from "@heroicons/react/24/outline";
import { zodResolver } from "@hookform/resolvers/zod";
import { FC, useState } from "react";
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

  const { data: nodeSettings, isLoading: nodeSettingsLoading } = useQuery({
    queryKey: "node-settings",
    queryFn: () => fetch<{ min_node_version: string; certificate: string }>("/node/settings"),
  });

  const form = useForm({
    resolver: zodResolver(NodeSchema),
    defaultValues: isAddMode ? { ...getNodeDefaultValues(), add_as_new_host: false } : node,
  });

  const handleSubmit = form.handleSubmit((data) => {
    mutate(data);
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
            {isAddMode ? t("nodes.addNewMarzbanNode") : t("nodes.editNode")}
          </Text>
        </ModalHeader>
        <ModalCloseButton mt={3} />
        <ModalBody>
          <form onSubmit={handleSubmit}>
            <VStack spacing={4}>
              {isAddMode && nodeSettings?.certificate && (
                <Collapse in={showCertificate} animateOpacity>
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
                  <HStack justify="end" py={2}>
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
                </Collapse>
              )}
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
              <HStack w="full">
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
              </HStack>
              <FormControl>
                  <Input
                    label={t("nodes.usageCoefficient")}
                    size="sm"
                    placeholder="1"
                    {...form.register("usage_coefficient")}
                    error={getInputError(form.formState?.errors?.usage_coefficient)}
                />
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
