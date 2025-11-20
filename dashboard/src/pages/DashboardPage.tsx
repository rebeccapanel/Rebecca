import { Box, Text, VStack, SimpleGrid } from "@chakra-ui/react";
import { Statistics } from "../components/Statistics";
import { useTranslation } from "react-i18next";

export const DashboardPage = () => {
  const { t } = useTranslation();

  return (
    <VStack spacing={6} align="stretch">
      <Box>
        <Text as="h1" fontWeight="semibold" fontSize="2xl" mb={4}>
          {t("dashboard")}
        </Text>
        <Statistics />
      </Box>
    </VStack>
  );
};
