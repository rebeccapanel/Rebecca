import { Box, VStack, Text } from "@chakra-ui/react";
import { DeleteUserModal } from "components/DeleteUserModal";
import { Filters } from "components/Filters";
import { Pagination } from "components/Pagination";
import { QRCodeDialog } from "components/QRCodeDialog";
import { ResetUserUsageModal } from "components/ResetUserUsageModal";
import { RevokeSubscriptionModal } from "components/RevokeSubscriptionModal";
import { UserDialog } from "components/UserDialog";
import { UsersTable } from "components/UsersTable";
import { fetchInbounds, useDashboard } from "contexts/DashboardContext";
import { FC, useEffect } from "react";
import { useTranslation } from "react-i18next";

export const UsersPage: FC = () => {
  const { t } = useTranslation();
  
  useEffect(() => {
    useDashboard.getState().refetchUsers();
    fetchInbounds();
  }, []);

  return (
    <VStack spacing={4} align="stretch">
      <Text as="h1" fontWeight="semibold" fontSize="2xl">
        {t("users")}
      </Text>
      <Filters />
      <UsersTable />
      <Pagination />
      <UserDialog />
      <DeleteUserModal />
      <QRCodeDialog />
      <ResetUserUsageModal />
      <RevokeSubscriptionModal />
    </VStack>
  );
};

export default UsersPage;
