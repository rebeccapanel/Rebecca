import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalCloseButton,
  ModalBody,
  ModalFooter,
  VStack,
  FormControl,
  FormLabel,
  Input,
  Button,
  Select,
  Textarea,
  Text,
} from "@chakra-ui/react";
import { FC } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

interface RuleModalProps {
  isOpen: boolean;
  onClose: () => void;
  form: any;
  setRoutingRuleData: (data: any[]) => void;
  ruleIndex?: number;
}

export const RuleModal: FC<RuleModalProps> = ({ isOpen, onClose, form, setRoutingRuleData, ruleIndex }) => {
  const { t } = useTranslation();
  const formatList = (value: string[] | string | undefined) => (Array.isArray(value) ? value.join(",") : value ?? "");
  const modalForm = useForm({
    defaultValues: {
      inboundTag: "",
      outboundTag: "",
      domain: "",
      ip: "",
      source: "",
      user: "",
      protocol: "",
      attrs: "",
      port: "",
      sourcePort: "",
      network: "",
    },
  });

  const handleSubmit = modalForm.handleSubmit((data) => {
    const newRule = {
      inboundTag: data.inboundTag ? data.inboundTag.split(",") : [],
      outboundTag: data.outboundTag,
      domain: data.domain ? data.domain.split(",") : [],
      ip: data.ip ? data.ip.split(",") : [],
      source: data.source ? data.source.split(",") : [],
      user: data.user ? data.user.split(",") : [],
      protocol: data.protocol ? data.protocol.split(",") : [],
      attrs: data.attrs ? JSON.parse(data.attrs) : {},
      port: data.port ? data.port.split(",") : [],
      sourcePort: data.sourcePort ? data.sourcePort.split(",") : [],
      network: data.network ? data.network.split(",") : [],
    };

    const currentRules = form.getValues("config.routing.rules") || [];
    if (ruleIndex !== undefined) {
      currentRules[ruleIndex] = newRule;
    } else {
      currentRules.push(newRule);
    }

    form.setValue("config.routing.rules", currentRules, { shouldDirty: true });
    setRoutingRuleData(
      currentRules.map((r: any, index: number) => ({
        key: index,
        ...r,
        domain: formatList(r.domain),
        ip: formatList(r.ip),
        source: formatList(r.source),
        user: formatList(r.user),
        inboundTag: formatList(r.inboundTag),
        protocol: formatList(r.protocol),
        attrs: JSON.stringify(r.attrs, null, 2),
        port: formatList(r.port),
        sourcePort: formatList(r.sourcePort),
        network: formatList(r.network),
      }))
    );
    onClose();
  });

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md">
      <ModalOverlay bg="blackAlpha.300" backdropFilter="blur(10px)" />
      <ModalContent mx="3">
        <ModalHeader pt={6}>
          <Text fontWeight="semibold" fontSize="lg">
            {ruleIndex !== undefined ? t("pages.xray.rules.edit") : t("pages.xray.rules.add")}
          </Text>
        </ModalHeader>
        <ModalCloseButton mt={3} />
        <ModalBody>
          <form onSubmit={handleSubmit}>
            <VStack spacing={4}>
              <FormControl>
                <FormLabel>{t("pages.xray.rules.inboundTag")}</FormLabel>
                <Input {...modalForm.register("inboundTag")} size="sm" placeholder="tag1,tag2" />
              </FormControl>
              <FormControl>
                <FormLabel>{t("pages.xray.rules.outboundTag")}</FormLabel>
                <Input {...modalForm.register("outboundTag")} size="sm" placeholder="outbound-tag" />
              </FormControl>
              <FormControl>
                <FormLabel>{t("pages.xray.rules.domain")}</FormLabel>
                <Input {...modalForm.register("domain")} size="sm" placeholder="example.com,*.example.com" />
              </FormControl>
              <FormControl>
                <FormLabel>{t("pages.xray.rules.ip")}</FormLabel>
                <Input {...modalForm.register("ip")} size="sm" placeholder="1.1.1.1,2.2.2.2" />
              </FormControl>
              <FormControl>
                <FormLabel>{t("pages.xray.rules.source")}</FormLabel>
                <Input {...modalForm.register("source")} size="sm" placeholder="192.168.1.1,10.0.0.1" />
              </FormControl>
              <FormControl>
                <FormLabel>{t("pages.xray.rules.user")}</FormLabel>
                <Input {...modalForm.register("user")} size="sm" placeholder="user1@example.com,user2@example.com" />
              </FormControl>
              <FormControl>
                <FormLabel>{t("pages.xray.rules.protocol")}</FormLabel>
                <Select {...modalForm.register("protocol")} size="sm">
                  <option value="">{t("pages.xray.rules.protocolPlaceholder", { defaultValue: "Select protocol" })}</option>
                  {["http", "https", "ftp", "bittorrent"].map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </Select>
              </FormControl>
              <FormControl>
                <FormLabel>{t("pages.xray.rules.attrs")}</FormLabel>
                <Textarea {...modalForm.register("attrs")} size="sm" placeholder='{"key": "value"}' />
              </FormControl>
              <FormControl>
                <FormLabel>{t("pages.xray.rules.port")}</FormLabel>
                <Input {...modalForm.register("port")} size="sm" placeholder="80,443" />
              </FormControl>
              <FormControl>
                <FormLabel>{t("pages.xray.rules.sourcePort")}</FormLabel>
                <Input {...modalForm.register("sourcePort")} size="sm" placeholder="1024,2048" />
              </FormControl>
              <FormControl>
                <FormLabel>{t("pages.xray.rules.network")}</FormLabel>
                <Input {...modalForm.register("network")} size="sm" placeholder="tcp,udp" />
              </FormControl>
              <Button type="submit" colorScheme="primary" size="sm">
                {ruleIndex !== undefined ? t("pages.xray.rules.edit") : t("pages.xray.rules.add")}
              </Button>
            </VStack>
          </form>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
};
