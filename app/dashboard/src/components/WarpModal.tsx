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
  Text,
} from "@chakra-ui/react";
import { FC } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Outbound } from "../utils/outbound";

interface WarpModalProps {
  isOpen: boolean;
  onClose: () => void;
  form: any;
}

export const WarpModal: FC<WarpModalProps> = ({ isOpen, onClose, form }) => {
  const { t } = useTranslation();
  const modalForm = useForm({
    defaultValues: {
      tag: "warp",
      protocol: "wireguard",
      settings: {
        privateKey: "",
        publicKey: "",
        endpoint: "",
        reserved: "",
      },
    },
  });

  const handleSubmit = modalForm.handleSubmit((data) => {
    const newOutbound = Outbound.fromJson({
      tag: data.tag,
      protocol: data.protocol,
      settings: {
        peers: [
          {
            publicKey: data.settings.publicKey,
            endpoint: data.settings.endpoint,
            reserved: data.settings.reserved ? data.settings.reserved.split(",").map(Number) : [],
          },
        ],
        privateKey: data.settings.privateKey,
      },
    });
    const newOutbounds = [...form.getValues("config.outbounds"), newOutbound.toJson()];
    form.setValue("config.outbounds", newOutbounds, { shouldDirty: true });
    onClose();
  });

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="sm">
      <ModalOverlay bg="blackAlpha.300" backdropFilter="blur(10px)" />
      <ModalContent mx="3">
        <ModalHeader pt={6}>
          <Text fontWeight="semibold" fontSize="lg">
            {t("pages.xray.warpRouting")}
          </Text>
        </ModalHeader>
        <ModalCloseButton mt={3} />
        <ModalBody>
          <form onSubmit={handleSubmit}>
            <VStack spacing={4}>
              <FormControl>
                <FormLabel>{t("pages.xray.outbound.tag")}</FormLabel>
                <Input {...modalForm.register("tag")} size="sm" />
              </FormControl>
              <FormControl>
                <FormLabel>{t("pages.xray.warp.privateKey")}</FormLabel>
                <Input {...modalForm.register("settings.privateKey")} size="sm" />
              </FormControl>
              <FormControl>
                <FormLabel>{t("pages.xray.warp.publicKey")}</FormLabel>
                <Input {...modalForm.register("settings.publicKey")} size="sm" />
              </FormControl>
              <FormControl>
                <FormLabel>{t("pages.xray.warp.endpoint")}</FormLabel>
                <Input {...modalForm.register("settings.endpoint")} size="sm" placeholder="engage.cloudflareclient.com:2408" />
              </FormControl>
              <FormControl>
                <FormLabel>{t("pages.xray.warp.reserved")}</FormLabel>
                <Input {...modalForm.register("settings.reserved")} size="sm" placeholder="1,2,3" />
              </FormControl>
              <Button type="submit" colorScheme="primary" size="sm">
                {t("pages.xray.warpRouting")}
              </Button>
            </VStack>
          </form>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
};
