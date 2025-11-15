import {
  VStack,
  Text,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  HStack,
  Icon,
} from "@chakra-ui/react";
import { HostsManager } from "components/HostsManager";
import { InboundsManager } from "components/InboundsManager";
import { FC } from "react";
import { useTranslation } from "react-i18next";
import { LinkIcon, Squares2X2Icon } from "@heroicons/react/24/outline";
import useGetUser from "hooks/useGetUser";

export const HostsPage: FC = () => {
  const { t } = useTranslation();
  const { userData, getUserIsSuccess } = useGetUser();
  const canManageHosts =
    getUserIsSuccess && Boolean(userData.permissions?.sections.hosts);

  if (!canManageHosts) {
    return (
      <VStack spacing={4} align="stretch">
        <Text as="h1" fontWeight="semibold" fontSize="2xl">
          {t("header.hostSettings", "Inbounds & Hosts")}
        </Text>
        <Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }}>
          {t(
            "hostsPage.noPermission",
            "You do not have permission to manage host or inbound settings."
          )}
        </Text>
      </VStack>
    );
  }

  return (
    <VStack spacing={4} align="stretch">
      <Text as="h1" fontWeight="semibold" fontSize="2xl">
        {t("header.hostSettings", "Inbounds & Hosts")}
      </Text>
      <Tabs colorScheme="primary" isLazy>
        <TabList>
          <Tab>
            <HStack spacing={2}>
              <Icon as={LinkIcon} w={4} h={4} />
              <span>{t("hostsPage.tabInbounds", "Inbounds")}</span>
            </HStack>
          </Tab>
          <Tab>
            <HStack spacing={2}>
              <Icon as={Squares2X2Icon} w={4} h={4} />
              <span>{t("hostsPage.tabHosts", "Hosts")}</span>
            </HStack>
          </Tab>
        </TabList>
        <TabPanels>
          <TabPanel px={0}>
            <VStack spacing={4} align="stretch">
              <Text color="gray.500" fontSize="sm">
                {t(
                  "hostsPage.tabInboundsDescription",
                  "Manage and customize Xray inbounds, transport layers, security, and sniffing options."
                )}
              </Text>
              <InboundsManager />
            </VStack>
          </TabPanel>
          <TabPanel px={0}>
            <VStack spacing={4} align="stretch">
              <Text color="gray.500" fontSize="sm">
                {t(
                  "hostsPage.tabHostsDescription",
                  "Assign hosts to inbounds, adjust ordering, and fine-tune SNI, paths, and transport overrides."
                )}
              </Text>
              <HostsManager />
            </VStack>
          </TabPanel>
        </TabPanels>
      </Tabs>
    </VStack>
  );
};

export default HostsPage;
