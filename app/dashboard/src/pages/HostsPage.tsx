import { Box, VStack, Text } from "@chakra-ui/react";
import { HostsDialog } from "components/HostsDialog";
import { useDashboard } from "contexts/DashboardContext";
import { FC, useEffect } from "react";
import { useTranslation } from "react-i18next";

export const HostsPage: FC = () => {
  const { t } = useTranslation();
  const { onEditingHosts } = useDashboard();

  useEffect(() => {
    onEditingHosts(true);
    return () => onEditingHosts(false);
  }, []);

  return (
    <VStack spacing={4} align="stretch">
      <Text as="h1" fontWeight="semibold" fontSize="2xl">
        {t("header.hostSettings")}
      </Text>
      <HostsDialog />
    </VStack>
  );
};

export default HostsPage;
