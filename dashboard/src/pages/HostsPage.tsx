import { VStack, Text } from "@chakra-ui/react";
import { HostsManager } from "components/HostsManager";
import { FC } from "react";
import { useTranslation } from "react-i18next";

export const HostsPage: FC = () => {
  const { t } = useTranslation();

  return (
    <VStack spacing={4} align="stretch">
      <Text as="h1" fontWeight="semibold" fontSize="2xl">
        {t("header.hostSettings")}
      </Text>
      <HostsManager />
    </VStack>
  );
};

export default HostsPage;
