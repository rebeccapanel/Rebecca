import { Box, VStack, Text } from "@chakra-ui/react";
import { NodesUsage } from "components/NodesUsage";
import { useDashboard } from "contexts/DashboardContext";
import { FC, useEffect } from "react";
import { useTranslation } from "react-i18next";

export const NodesUsagePage: FC = () => {
  const { t } = useTranslation();
  const { onShowingNodesUsage } = useDashboard();

  useEffect(() => {
    onShowingNodesUsage(true);
    return () => onShowingNodesUsage(false);
  }, []);

  return (
    <VStack spacing={4} align="stretch">
      <Text as="h1" fontWeight="semibold" fontSize="2xl">
        {t("header.nodesUsage")}
      </Text>
      <NodesUsage />
    </VStack>
  );
};

export default NodesUsagePage;
