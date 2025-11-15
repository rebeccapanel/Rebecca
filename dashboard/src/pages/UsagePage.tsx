import {
  Flex,
  Spinner,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Text,
  VStack,
} from "@chakra-ui/react";
import { FC, useEffect } from "react";
import { useTranslation } from "react-i18next";
import useGetUser from "hooks/useGetUser";

import AdminsUsage from "components/AdminsUsage";
import ServiceUsageAnalytics from "components/ServiceUsageAnalytics";
import NodesUsageAnalytics from "components/NodesUsageAnalytics";
import { useServicesStore } from "contexts/ServicesContext";

export const UsagePage: FC = () => {
  const { t } = useTranslation();
  const { userData, getUserIsSuccess } = useGetUser();
  const canViewUsage = Boolean(
    getUserIsSuccess && userData.permissions?.sections.usage
  );

  const services = useServicesStore((state) => state.services);
  const fetchServices = useServicesStore((state) => state.fetchServices);

  useEffect(() => {
    if (canViewUsage) {
      fetchServices({ limit: 500 });
    }
  }, [fetchServices, canViewUsage]);

  if (!getUserIsSuccess) {
    return (
      <Flex justify="center" align="center" py={10}>
        <Spinner />
      </Flex>
    );
  }

  if (!canViewUsage) {
    return (
      <VStack spacing={4} align="stretch">
        <Text as="h1" fontWeight="semibold" fontSize="2xl">
          {t("usage.title", "Usage Analytics")}
        </Text>
        <Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }}>
          {t("usage.noPermission", "You do not have permission to view usage analytics.")}
        </Text>
      </VStack>
    );
  }

  return (
    <VStack spacing={4} align="stretch">
      <Text as="h1" fontWeight="semibold" fontSize="2xl">
        {t("usage.title", "Usage Analytics")}
      </Text>
      <Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }}>
        {t(
          "usage.description",
          "Track usage trends across services, admins, and nodes from a single place."
        )}
      </Text>

      <Tabs variant="enclosed" colorScheme="primary">
        <TabList>
          <Tab>{t("usage.tabs.services", "Services")}</Tab>
          <Tab>{t("usage.tabs.admins", "Admins")}</Tab>
          <Tab>{t("usage.tabs.nodes", "Nodes")}</Tab>
        </TabList>
        <TabPanels>
          <TabPanel px={0}>
            <ServiceUsageAnalytics services={services} />
          </TabPanel>
          <TabPanel px={0}>
            <AdminsUsage />
          </TabPanel>
          <TabPanel px={0}>
            <NodesUsageAnalytics />
          </TabPanel>
        </TabPanels>
      </Tabs>
    </VStack>
  );
};

export default UsagePage;
