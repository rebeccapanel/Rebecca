import {
  Badge,
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
import { AdminRole } from "types/Admin";

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
  const onHoldUsers = admin?.on_hold_users ?? 0;
  const disabledUsers = admin?.disabled_users ?? 0;

  const usedBytes = admin?.users_usage ?? 0;
  const dataLimitBytes = admin?.data_limit ?? null;
  const remainingBytes =
    dataLimitBytes && dataLimitBytes > 0
      ? Math.max(dataLimitBytes - usedBytes, 0)
      : null;
  const lifetimeUsageBytes = admin?.lifetime_usage ?? null;
  const dataLimitAllocated = admin?.data_limit_allocated ?? 0;
  const resetBytes = admin?.reset_bytes ?? 0;
  const unlimitedUsersUsage = admin?.unlimited_users_usage ?? 0;

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
              {admin && (
                <Badge
                  fontSize="xs"
                  px={2}
                  py={0.5}
                  borderRadius="full"
                  colorScheme={
                    admin.role === AdminRole.FullAccess
                      ? "orange"
                      : admin.role === AdminRole.Sudo
                      ? "purple"
                      : "gray"
                  }
                >
                  {admin.role === AdminRole.FullAccess
                    ? t("admins.roles.fullAccess", "Full access")
                    : admin.role === AdminRole.Sudo
                    ? t("admins.roles.sudo", "Sudo")
                    : t("admins.roles.standard", "Standard")}
                </Badge>
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
                    valueColor="blue.600"
                  />
                  <StatCard
                    label={t("admins.details.onlineLabel", "Online")}
                    value={String(onlineUsers)}
                    valueColor="green.600"
                  />
                  <StatCard
                    label={t("admins.details.limitedLabel", "Limited")}
                    value={String(limitedUsers)}
                    valueColor="orange.600"
                  />
                  <StatCard
                    label={t("status.expired", "Expired")}
                    value={String(expiredUsers)}
                    valueColor="red.600"
                  />
                  <StatCard
                    label={t("status.on_hold", "On hold")}
                    value={String(onHoldUsers)}
                    valueColor="yellow.600"
                  />
                  <StatCard
                    label={t("status.disabled", "Disabled")}
                    value={String(disabledUsers)}
                    valueColor="gray.600"
                  />
                </SimpleGrid>
                <SimpleGrid columns={{ base: 2, md: 2 }} spacing={4} mt={3}>
                  <StatCard
                    label={t("admins.details.totalUsers", "Total users")}
                    value={String(admin.users_count ?? 0)}
                    valueColor="blue.600"
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
              <Box>
                <Text fontWeight="semibold" mb={3}>
                  {t("admins.details.allocationSection", "Data allocation")}
                </Text>
                <SimpleGrid columns={{ base: 2, md: 3 }} spacing={4}>
                  <StatCard
                    label={t("admins.details.dataAllocated", "Allocated data")}
                    value={formatBytes(dataLimitAllocated, 2)}
                  />
                  <StatCard
                    label={t("admins.details.resetVolume", "Reset volume")}
                    value={formatBytes(resetBytes, 2)}
                  />
                  <StatCard
                    label={t("admins.details.unlimitedUsage", "Unlimited users usage")}
                    value={formatBytes(unlimitedUsersUsage, 2)}
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

const StatCard = ({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) => {
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
      <Text fontWeight="semibold" color={valueColor || undefined}>
        {value}
      </Text>
    </Box>
  );
};

export default AdminDetailsDrawer;
