import {
  Alert,
  AlertDescription,
  AlertIcon,
  Box,
  Button,
  Checkbox,
  FormControl,
  FormLabel,
  HStack,
  IconButton,
  Input,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Radio,
  RadioGroup,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Tooltip,
  useColorModeValue,
} from "@chakra-ui/react";
import { MinusIcon, PlusIcon, ArrowPathIcon } from "@heroicons/react/24/outline";
import { chakra } from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "react-query";
import { fetch as apiFetch } from "service/http";

type GeoFile = { name: string; url: string };

type GeoTemplate = {
  name: string;
  links?: Record<string, string>;
  files?: GeoFile[];
};

type GeoUpdateDialogProps = {
  isOpen: boolean;
  title: string;
  isSubmitting?: boolean;
  showMasterOptions?: boolean;
  defaultTemplateIndexUrl?: string;
  onSubmit: (payload: {
    mode: "template" | "manual";
    templateIndexUrl: string;
    templateName: string;
    files: GeoFile[];
    persistEnv: boolean;
    applyToNodes: boolean;
  }) => Promise<void>;
  onClose: () => void;
};

const DEFAULT_TEMPLATE_INDEX_URL = "https://raw.githubusercontent.com/ppouria/geo-templates/main/index.json";

const IconMinus = chakra(MinusIcon, { baseStyle: { w: 3.5, h: 3.5 } });
const IconPlus = chakra(PlusIcon, { baseStyle: { w: 3.5, h: 3.5 } });
const IconRefresh = chakra(ArrowPathIcon, { baseStyle: { w: 4, h: 4 } });

export const GeoUpdateDialog = ({
  isOpen,
  title,
  isSubmitting,
  showMasterOptions = false,
  defaultTemplateIndexUrl,
  onSubmit,
  onClose,
}: GeoUpdateDialogProps) => {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"template" | "manual">("template");
  const [templateIndexUrl, setTemplateIndexUrl] = useState(DEFAULT_TEMPLATE_INDEX_URL);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [manualFiles, setManualFiles] = useState<GeoFile[]>([
    { name: "geoip.dat", url: "" },
    { name: "geosite.dat", url: "" },
  ]);
  const [persistEnv, setPersistEnv] = useState(true);
  const [applyToNodes, setApplyToNodes] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setMode("template");
      setTemplateIndexUrl(defaultTemplateIndexUrl || DEFAULT_TEMPLATE_INDEX_URL);
      setSelectedTemplate("");
      setManualFiles([
        { name: "geoip.dat", url: "" },
        { name: "geosite.dat", url: "" },
      ]);
      setPersistEnv(true);
      setApplyToNodes(false);
      setSubmissionError(null);
    }
  }, [isOpen, defaultTemplateIndexUrl]);

  const templatesQuery = useQuery(
    ["geo-templates", templateIndexUrl],
    () =>
      apiFetch<{ templates: GeoTemplate[] }>("/core/geo/templates", {
        query: templateIndexUrl ? { index_url: templateIndexUrl } : undefined,
      }),
    {
      enabled: isOpen && mode === "template" && Boolean(templateIndexUrl),
      staleTime: 10 * 60 * 1000,
    }
  );

  const templates = useMemo(() => templatesQuery.data?.templates ?? [], [templatesQuery.data]);

  useEffect(() => {
    if (templates.length > 0) {
      setSelectedTemplate((current) => current || templates[0].name);
    }
  }, [templates]);

  const manualBg = useColorModeValue("gray.50", "whiteAlpha.50");

  const addManualFile = () => {
    setManualFiles((prev) => [...prev, { name: "", url: "" }]);
  };

  const updateManualFile = (index: number, key: keyof GeoFile, value: string) => {
    setManualFiles((prev) =>
      prev.map((file, idx) => (idx === index ? { ...file, [key]: value } : file))
    );
  };

  const removeManualFile = (index: number) => {
    setManualFiles((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleSubmit = async () => {
    const baseFiles: GeoFile[] =
      mode === "manual"
        ? manualFiles.filter((file) => file.name.trim() && file.url.trim())
        : [];

    if (mode === "template") {
      if (!templateIndexUrl.trim()) {
        setSubmissionError(t("nodes.geoDialog.errors.missingTemplateUrl"));
        return;
      }
      if (!selectedTemplate) {
        setSubmissionError(t("nodes.geoDialog.errors.missingTemplateName"));
        return;
      }
    } else {
      if (baseFiles.length === 0) {
        setSubmissionError(t("nodes.geoDialog.errors.missingFiles"));
        return;
      }
      const invalidFile = baseFiles.find((file) => !file.name.trim() || !file.url.trim());
      if (invalidFile) {
        setSubmissionError(t("nodes.geoDialog.errors.invalidFile"));
        return;
      }
    }

    setSubmissionError(null);
    const resolvedFiles = mode === "manual" ? baseFiles : [];

    try {
      await onSubmit({
        mode,
        templateIndexUrl: templateIndexUrl.trim(),
        templateName: selectedTemplate,
        files: resolvedFiles,
        persistEnv,
        applyToNodes,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("nodes.geoDialog.genericError");
      setSubmissionError(message);
    }
  };

  const renderManualRows = () => (
    <Stack spacing={3} bg={manualBg} p={4} borderRadius="md">
      {manualFiles.map((file, index) => (
        <Box key={`manual-file-${index}`} borderWidth="1px" borderRadius="md" p={3}>
          <SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
            <FormControl isRequired>
              <FormLabel fontSize="sm">
                {t("nodes.geoDialog.fileNameLabel")}
              </FormLabel>
              <Input
                size="sm"
                value={file.name}
                placeholder="geosite.dat"
                onChange={(event) => updateManualFile(index, "name", event.target.value)}
              />
            </FormControl>
            <FormControl isRequired>
              <FormLabel fontSize="sm">
                {t("nodes.geoDialog.fileUrlLabel")}
              </FormLabel>
              <Input
                size="sm"
                value={file.url}
                placeholder="https://example.com/geosite.dat"
                onChange={(event) => updateManualFile(index, "url", event.target.value)}
              />
            </FormControl>
          </SimpleGrid>
          <HStack justify="flex-end" mt={3}>
            <Tooltip label={t("nodes.geoDialog.removeFile")}>
              <IconButton
                aria-label="remove file"
                icon={<IconMinus />}
                variant="ghost"
                size="sm"
                onClick={() => removeManualFile(index)}
                isDisabled={manualFiles.length <= 1}
              />
            </Tooltip>
          </HStack>
        </Box>
      ))}
      <Button
        onClick={addManualFile}
        leftIcon={<IconPlus />}
        size="sm"
        alignSelf="flex-start"
        variant="outline"
      >
        {t("nodes.geoDialog.addFile")}
      </Button>
    </Stack>
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="xl" isCentered>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>{title}</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <Stack spacing={4}>
            <FormControl as="fieldset">
              <FormLabel as="legend" fontSize="sm">
                {t("nodes.geoDialog.modeLabel")}
              </FormLabel>
              <RadioGroup value={mode} onChange={(value) => setMode(value as "template" | "manual")}>
                <HStack spacing={4}>
                  <Radio value="template">{t("nodes.geoDialog.modeTemplate")}</Radio>
                  <Radio value="manual">{t("nodes.geoDialog.modeManual")}</Radio>
                </HStack>
              </RadioGroup>
            </FormControl>

            {mode === "template" ? (
              <Stack spacing={3}>
                <FormControl isRequired>
                  <FormLabel fontSize="sm">
                    {t("nodes.geoDialog.templateIndexLabel")}
                  </FormLabel>
                  <Input
                    size="sm"
                    value={templateIndexUrl}
                    onChange={(event) => setTemplateIndexUrl(event.target.value)}
                  />
                </FormControl>
                <FormControl isRequired>
                  <FormLabel fontSize="sm">
                    {t("nodes.geoDialog.templateNameLabel")}
                  </FormLabel>
                  <HStack align="center" spacing={2}>
                    <Select
                      size="sm"
                      flex={1}
                      value={selectedTemplate}
                      onChange={(event) => setSelectedTemplate(event.target.value)}
                      isDisabled={templatesQuery.isLoading || !templates.length}
                      placeholder={
                        templatesQuery.isLoading
                          ? t("nodes.geoDialog.loadingTemplates")
                          : t("nodes.geoDialog.selectTemplatePlaceholder")
                      }
                    >
                      {templates.map((template) => (
                        <option key={template.name} value={template.name}>
                          {template.name}
                        </option>
                      ))}
                    </Select>
                    <Tooltip label={t("nodes.geoDialog.refreshTemplates")}>
                      <IconButton
                        aria-label="refresh templates"
                        icon={<IconRefresh />}
                        size="sm"
                        variant="outline"
                        onClick={() => templatesQuery.refetch()}
                        isLoading={templatesQuery.isFetching}
                        isDisabled={!templateIndexUrl.trim()}
                      />
                    </Tooltip>
                  </HStack>
                </FormControl>
                {templatesQuery.isError && (
                  <Alert status="error" borderRadius="md" fontSize="sm">
                    <AlertIcon />
                    <AlertDescription>
                      {t("nodes.geoDialog.failedToLoadTemplates")}
                    </AlertDescription>
                  </Alert>
                )}
              </Stack>
            ) : (
              renderManualRows()
            )}

            {showMasterOptions && (
              <Stack spacing={2}>
                <Checkbox isChecked={persistEnv} onChange={(event) => setPersistEnv(event.target.checked)}>
                  {t("nodes.geoDialog.persistAssets")}
                </Checkbox>
                <Checkbox isChecked={applyToNodes} onChange={(event) => setApplyToNodes(event.target.checked)}>
                  {t("nodes.geoDialog.applyToNodes")}
                </Checkbox>
                <Text fontSize="xs" color="gray.500" _dark={{ color: "gray.400" }}>
                  {t("nodes.geoDialog.applyToNodesHint")}
                </Text>
              </Stack>
            )}

            {submissionError && (
              <Alert status="error" borderRadius="md" fontSize="sm">
                <AlertIcon />
                <AlertDescription>{submissionError}</AlertDescription>
              </Alert>
            )}
          </Stack>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" mr={3} onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button colorScheme="primary" onClick={handleSubmit} isLoading={isSubmitting}>
            {t("nodes.geoDialog.confirmUpdate")}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default GeoUpdateDialog;
