import {
  Box,
  Button,
  Checkbox,
  CheckboxGroup,
  Divider,
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
  Select,
  Stack,
  Text,
  Textarea,
  useColorModeValue,
  Wrap,
  WrapItem,
} from "@chakra-ui/react";
import { PlusIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { FC, useEffect, useMemo } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

type AttributePair = {
  key: string;
  value: string;
};

type RuleFormValues = {
  type: string;
  domainMatcher: string;
  outboundTag: string;
  balancerTag: string;
  inboundTags: string[];
  networks: string[];
  protocols: string[];
  sourceIps: string;
  sourcePort: string;
  domain: string;
  ip: string;
  user: string;
  port: string;
  attrs: AttributePair[];
};

export type RoutingRule = {
  type?: string;
  domainMatcher?: string;
  outboundTag?: string;
  balancerTag?: string;
  inboundTag?: string[];
  network?: string[];
  protocol?: string[];
  source?: string[];
  sourcePort?: string[];
  domain?: string[];
  ip?: string[];
  user?: string[];
  port?: string[];
  attrs?: Record<string, string>;
};

export interface RuleModalProps {
  isOpen: boolean;
  mode: "create" | "edit";
  initialRule?: RoutingRule | null;
  availableInboundTags: string[];
  availableOutboundTags: string[];
  availableBalancerTags: string[];
  onSubmit: (rule: RoutingRule) => void;
  onClose: () => void;
}

const NETWORK_OPTIONS = ["tcp", "udp", "http", "quic", "grpc"];
const PROTOCOL_OPTIONS = ["http", "tls", "bittorrent", "quic"];
const TYPE_OPTIONS = ["field", "chained"];
const DOMAIN_MATCHER_OPTIONS = ["", "hybrid", "linear"];

const defaultFormValues: RuleFormValues = {
  type: "field",
  domainMatcher: "",
  outboundTag: "",
  balancerTag: "",
  inboundTags: [],
  networks: [],
  protocols: [],
  sourceIps: "",
  sourcePort: "",
  domain: "",
  ip: "",
  user: "",
  port: "",
  attrs: [],
};

const toDelimitedString = (value?: string[]) =>
  Array.isArray(value) ? value.join(", ") : "";

const splitStringList = (value: string) =>
  value
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);

const ruleToFormValues = (rule?: RoutingRule | null): RuleFormValues => {
  if (!rule) {
    return { ...defaultFormValues };
  }

  const attrs: AttributePair[] = rule.attrs
    ? Object.entries(rule.attrs).map(([key, value]) => ({
        key,
        value: value == null ? "" : String(value),
      }))
    : [];

  return {
    type: rule.type ?? "field",
    domainMatcher: rule.domainMatcher ?? "",
    outboundTag: rule.outboundTag ?? "",
    balancerTag: rule.balancerTag ?? "",
    inboundTags: Array.isArray(rule.inboundTag) ? rule.inboundTag : [],
    networks: Array.isArray(rule.network) ? rule.network : [],
    protocols: Array.isArray(rule.protocol) ? rule.protocol : [],
    sourceIps: toDelimitedString(rule.source),
    sourcePort: toDelimitedString(rule.sourcePort),
    domain: toDelimitedString(rule.domain),
    ip: toDelimitedString(rule.ip),
    user: toDelimitedString(rule.user),
    port: toDelimitedString(rule.port),
    attrs,
  };
};

const formValuesToRule = (values: RuleFormValues): RoutingRule => {
  const rule: RoutingRule = {};

  if (values.type) rule.type = values.type;
  if (values.domainMatcher) rule.domainMatcher = values.domainMatcher;
  if (values.outboundTag) rule.outboundTag = values.outboundTag;
  if (values.balancerTag) rule.balancerTag = values.balancerTag;
  if (values.inboundTags.length) rule.inboundTag = values.inboundTags;
  if (values.networks.length) rule.network = values.networks;
  if (values.protocols.length) rule.protocol = values.protocols;

  const source = splitStringList(values.sourceIps);
  if (source.length) rule.source = source;

  const sourcePort = splitStringList(values.sourcePort);
  if (sourcePort.length) rule.sourcePort = sourcePort;

  const domain = splitStringList(values.domain);
  if (domain.length) rule.domain = domain;

  const ip = splitStringList(values.ip);
  if (ip.length) rule.ip = ip;

  const user = splitStringList(values.user);
  if (user.length) rule.user = user;

  const port = splitStringList(values.port);
  if (port.length) rule.port = port;

  if (values.attrs.length) {
    const attrs: Record<string, string> = {};
    values.attrs.forEach(({ key, value }) => {
      if (!key.trim()) return;
      attrs[key.trim()] = value;
    });
    if (Object.keys(attrs).length) {
      rule.attrs = attrs;
    }
  }

  if (!rule.type) {
    rule.type = "field";
  }

  return rule;
};

export const RuleModal: FC<RuleModalProps> = ({
  isOpen,
  mode,
  initialRule,
  availableInboundTags,
  availableOutboundTags,
  availableBalancerTags,
  onSubmit,
  onClose,
}) => {
  const { t } = useTranslation();
  const formBg = useColorModeValue("white", "gray.900");

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm<RuleFormValues>({
    defaultValues: defaultFormValues,
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "attrs",
  });

  useEffect(() => {
    if (isOpen) {
      reset(ruleToFormValues(initialRule));
    }
  }, [isOpen, initialRule, reset]);

  const onAddAttribute = () => append({ key: "", value: "" });

  const handleClose = () => {
    onClose();
  };

  const handleSave = handleSubmit((values) => {
    const rule = formValuesToRule(values);
    onSubmit(rule);
    handleClose();
  });

  const title = useMemo(
    () =>
      mode === "edit"
        ? t("pages.xray.rules.edit", "Edit Rule")
        : t("pages.xray.rules.add", "Add Rule"),
    [mode, t]
  );

  return (
    <Modal isOpen={isOpen} onClose={handleClose} size="xl" scrollBehavior="inside">
      <ModalOverlay bg="blackAlpha.300" backdropFilter="blur(10px)" />
      <ModalContent as="form" onSubmit={handleSave} bg={formBg}>
        <ModalHeader>{title}</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <Stack spacing={5}>
            <FormControl>
              <FormLabel>{t("pages.xray.rules.type", "Rule Type")}</FormLabel>
              <Select {...register("type")} size="sm">
                {TYPE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option || t("core.none", "None")}
                  </option>
                ))}
              </Select>
            </FormControl>

            <FormControl>
              <FormLabel>
                {t("pages.xray.rules.outboundTag", "Outbound Tag")}
              </FormLabel>
              <Select {...register("outboundTag")} size="sm" placeholder={t("core.none", "None")}>
                {availableOutboundTags.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </Select>
            </FormControl>

            <FormControl>
              <FormLabel>
                {t("pages.xray.rules.balancer", "Balancer Tag")}
              </FormLabel>
              <Select {...register("balancerTag")} size="sm" placeholder={t("core.none", "None")}>
                {availableBalancerTags.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </Select>
            </FormControl>

            <FormControl>
              <FormLabel>
                {t("pages.xray.rules.inboundTag", "Inbound Tags")}
              </FormLabel>
              <Controller
                control={control}
                name="inboundTags"
                render={({ field }) => (
                  <CheckboxGroup {...field}>
                    <Wrap spacing={3}>
                      {availableInboundTags.map((tag) => (
                        <WrapItem key={tag}>
                          <Checkbox value={tag}>{tag}</Checkbox>
                        </WrapItem>
                      ))}
                    </Wrap>
                  </CheckboxGroup>
                )}
              />
            </FormControl>

            <Divider />

            <FormControl>
              <FormLabel>
                {t("pages.xray.rules.domainMatcher", "Domain Matcher")}
              </FormLabel>
              <Select {...register("domainMatcher")} size="sm">
                {DOMAIN_MATCHER_OPTIONS.map((option) => (
                  <option key={option || "empty"} value={option}>
                    {option ? option : t("core.default", "Default")}
                  </option>
                ))}
              </Select>
            </FormControl>

            <FormControl>
              <FormLabel>
                {t("pages.xray.rules.network", "Network")}
              </FormLabel>
              <Controller
                control={control}
                name="networks"
                render={({ field }) => (
                  <CheckboxGroup {...field}>
                    <Wrap spacing={3}>
                      {NETWORK_OPTIONS.map((network) => (
                        <WrapItem key={network}>
                          <Checkbox value={network}>{network}</Checkbox>
                        </WrapItem>
                      ))}
                    </Wrap>
                  </CheckboxGroup>
                )}
              />
            </FormControl>

            <FormControl>
              <FormLabel>
                {t("pages.xray.rules.protocol", "Protocol")}
              </FormLabel>
              <Controller
                control={control}
                name="protocols"
                render={({ field }) => (
                  <CheckboxGroup {...field}>
                    <Wrap spacing={3}>
                      {PROTOCOL_OPTIONS.map((protocol) => (
                        <WrapItem key={protocol}>
                          <Checkbox value={protocol}>{protocol}</Checkbox>
                        </WrapItem>
                      ))}
                    </Wrap>
                  </CheckboxGroup>
                )}
              />
            </FormControl>

            <FormControl>
              <FormLabel>
                {t("pages.xray.rules.source", "Source IPs")}
              </FormLabel>
              <Textarea
                {...register("sourceIps")}
                size="sm"
                placeholder={t("pages.xray.rules.useComma", "Comma or space separated")}
              />
            </FormControl>

            <FormControl>
              <FormLabel>
                {t("pages.xray.rules.sourcePort", "Source Ports")}
              </FormLabel>
              <Textarea
                {...register("sourcePort")}
                size="sm"
                placeholder={t("pages.xray.rules.useComma", "Comma or space separated")}
              />
            </FormControl>

            <FormControl>
              <FormLabel>{t("pages.xray.rules.ip", "Destination IPs")}</FormLabel>
              <Textarea
                {...register("ip")}
                size="sm"
                placeholder={t("pages.xray.rules.useComma", "Comma or space separated")}
              />
            </FormControl>

            <FormControl>
              <FormLabel>{t("pages.xray.rules.domain", "Domains")}</FormLabel>
              <Textarea
                {...register("domain")}
                size="sm"
                placeholder={t("pages.xray.rules.useComma", "Comma or space separated")}
              />
            </FormControl>

            <FormControl>
              <FormLabel>{t("pages.xray.rules.user", "Users")}</FormLabel>
              <Textarea
                {...register("user")}
                size="sm"
                placeholder={t("pages.xray.rules.useComma", "Comma or space separated")}
              />
            </FormControl>

            <FormControl>
              <FormLabel>{t("pages.xray.rules.port", "Ports")}</FormLabel>
              <Textarea
                {...register("port")}
                size="sm"
                placeholder={t("pages.xray.rules.useComma", "Comma or space separated")}
              />
            </FormControl>

            <Divider />

            <Box>
              <FormControl>
                <FormLabel>
                  {t("pages.xray.rules.attrs", "Attributes")}
                </FormLabel>
                <Button
                  onClick={onAddAttribute}
                  size="xs"
                  leftIcon={<PlusIcon width={16} />}
                  variant="outline"
                  colorScheme="primary"
                >
                  {t("core.add", "Add")}
                </Button>
              </FormControl>
              <Stack spacing={2} mt={3}>
                {fields.length === 0 && (
                  <Text fontSize="sm" color="gray.500">
                    {t("pages.xray.rules.attrsHelper", "No custom attributes defined.")}
                  </Text>
                )}
                {fields.map((field, index) => (
                  <HStack key={field.id} spacing={2} align="flex-start">
                    <Input
                      size="sm"
                      placeholder={t("pages.inbounds.stream.general.name", "Key")}
                      {...register(`attrs.${index}.key` as const)}
                    />
                    <Input
                      size="sm"
                      placeholder={t("pages.inbounds.stream.general.value", "Value")}
                      {...register(`attrs.${index}.value` as const)}
                    />
                    <IconButton
                      aria-label="Remove attribute"
                      icon={<XMarkIcon width={16} />}
                      size="sm"
                      variant="ghost"
                      onClick={() => remove(index)}
                    />
                  </HStack>
                ))}
              </Stack>
            </Box>
          </Stack>
        </ModalBody>
        <ModalFooter gap={3}>
          <Button variant="outline" onClick={handleClose}>
            {t("cancel")}
          </Button>
          <Button colorScheme="primary" type="submit" isLoading={isSubmitting}>
            {mode === "edit"
              ? t("pages.xray.rules.edit", "Save Changes")
              : t("pages.xray.rules.add", "Add Rule")}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};
