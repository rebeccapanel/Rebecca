import {
  Box,
  Button,
  HStack,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  SimpleGrid,
  Stack,
  Text,
  useColorModeValue,
} from "@chakra-ui/react";
import { useAdminsStore } from "contexts/AdminsContext";
import { useTranslation } from "react-i18next";
import { formatBytes } from "utils/formatByte";

const formatLimit = (limit?: number | null, unlimitedLabel?: string) => {
  if (!limit || limit <= 0) {
    return unlimitedLabel ?? "∞";
  }
  return `${limit}`;
};

const formatBytesOrUnlimited = (
  value?: number | null,
  unlimitedLabel?: string
) => {
  if (!value || value <= 0) {
    return unlimitedLabel ?? "∞";
  }
  return formatBytes(value, 2);
};

export const AdminDetailsDrawer = () => {
  const { t } = useTranslation();
  const {
    isAdminDetailsOpen,
    adminInDetails: admin,
    closeAdminDetails,
  } = useAdminsStore((state) => ({
    isAdminDetailsOpen: state.isAdminDetailsOpen,
    adminInDetails: state.adminInDetails,
    closeAdminDetails: state.closeAdminDetails,
  }));

  const headerBg = useColorModeValue("gray.50", "whiteAlpha.50");

  const activeUsers = admin?.active_users ?? 0;
  const usersLimit = admin?.users_limit ?? null;
  const unlimitedLabel = t("admins.details.unlimited", "Unlimited");
  const usersLimitLabel =
    usersLimit && usersLimit > 0 ? String(usersLimit) : unlimitedLabel;
  const totalUsers = admin?.users_count ?? 0;
  const limitedUsers = admin?.limited_users ?? 0;
  const expiredUsers = admin?.expired_users ?? 0;
  const onlineUsers = admin?.online_users ?? 0;

  const usedBytes = admin?.users_usage ?? 0;
  const dataLimitBytes = admin?.data_limit ?? null;
  const remainingBytes =
    dataLimitBytes && dataLimitBytes > 0
      ? Math.max(dataLimitBytes - usedBytes, 0)
      : null;
  const lifetimeUsageBytes = admin?.lifetime_usage ?? null;

  return (
    <Modal
      isCentered
      isOpen={isAdminDetailsOpen}
      onClose={closeAdminDetails}
      scrollBehavior="inside"
      size="xl"
    >
      <ModalOverlay />
      <ModalContent>
        <ModalHeader bg={headerBg}>
          <Stack spacing={1}>
            <HStack spacing={2}>
              <Text fontWeight="semibold" fontSize="lg">
                {admin?.username ?? t("admins.details.title", "Admin details")}
              </Text>
              {admin?.is_sudo && (
                <Box
                  as="span"
                  fontSize="xs"
                  px={2}
                  py={0.5}
                  borderRadius="full"
                  bg="purple.500"
                  color="white"
                >
                  {t("admins.sudoBadge", "Sudo")}
                </Box>
              )}
            </HStack>
            {admin && (
              <Text fontSize="sm" color="gray.500">
                {t("admins.details.summary", {
                  active: activeUsers,
                  limit: usersLimitLabel,
                })}
              </Text>
            )}
          </Stack>
        </ModalHeader>
        <ModalCloseButton />

        <ModalBody>
          {admin ? (
            <Stack spacing={8}>
              <Box>
                <Text fontWeight="semibold" mb={3}>
                  {t("admins.details.usersSection", "Users")}
                </Text>
                <SimpleGrid columns={{ base: 2, md: 3 }} spacing={4}>
                  <StatCard
                    label={t("admins.details.activeLabel", "Active")}
                    value={String(activeUsers)}
                  />
                  <StatCard
                    label={t("admins.details.onlineLabel", "Online")}
                    value={String(onlineUsers)}
                  />
                  <StatCard
                    label={t("admins.details.limitedLabel", "Limited")}
                    value={String(limitedUsers)}
                  />
                  <StatCard
                    label={t("admins.details.expiredLabel", "Expired")}
                    value={String(expiredUsers)}
                  />
                  <StatCard
                    label={t("admins.details.totalUsers", "Total users")}
                    value={String(totalUsers)}
                  />
                  <StatCard
                    label={t("admins.details.usersLimit", "Users limit")}
                    value={formatLimit(usersLimit, unlimitedLabel)}
                  />
                </SimpleGrid>
              </Box>

              <Box>
                <Text fontWeight="semibold" mb={3}>
                  {t("admins.details.dataSection", "Data usage")}
                </Text>
                <SimpleGrid columns={{ base: 2, md: 4 }} spacing={4}>
                  <StatCard
                    label={t("admins.details.used", "Used")}
                    value={formatBytes(usedBytes, 2)}
                  />
                  <StatCard
                    label={t("admins.details.limit", "Limit")}
                    value={formatBytesOrUnlimited(
                      dataLimitBytes,
                      unlimitedLabel
                    )}
                  />
                  <StatCard
                    label={t("admins.details.remaining", "Remaining")}
                    value={formatBytesOrUnlimited(
                      remainingBytes,
                      unlimitedLabel
                    )}
                  />
                  <StatCard
                    label={t("admins.details.lifetime", "Lifetime usage")}
                    value={formatBytesOrUnlimited(lifetimeUsageBytes, undefined)}
                  />
                </SimpleGrid>
              </Box>
            </Stack>
          ) : (
            <Box py={8}>
              <Text color="gray.500">
                {t("admins.details.empty", "Select an admin to view details.")}
              </Text>
            </Box>
          )}
        </ModalBody>

        <ModalFooter>
          <Button variant="outline" mr={3} onClick={closeAdminDetails}>
            {t("close", "Close")}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

const StatCard = ({ label, value }: { label: string; value: string }) => {
  return (
    <Box
      borderWidth="1px"
      borderRadius="md"
      px={3}
      py={2}
      minH="64px"
      display="flex"
      flexDirection="column"
      justifyContent="center"
    >
      <Text fontSize="xs" textTransform="uppercase" color="gray.500">
        {label}
      </Text>
      <Text fontWeight="semibold">{value}</Text>
    </Box>
  );
};

export default AdminDetailsDrawer;
