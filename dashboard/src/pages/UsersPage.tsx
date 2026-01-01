import { Box, Text, VStack } from "@chakra-ui/react";
import { DeleteUserModal } from "components/DeleteUserModal";
import { Filters } from "components/Filters";
import { Pagination } from "components/Pagination";
import { QRCodeDialog } from "components/QRCodeDialog";
import { ResetUserUsageModal } from "components/ResetUserUsageModal";
import { RevokeSubscriptionModal } from "components/RevokeSubscriptionModal";
import { UserDialog } from "components/UserDialog";
import { UsersTable } from "components/UsersTable";
import { fetchInbounds, useDashboard } from "contexts/DashboardContext";
import { type FC, useEffect } from "react";
import { useTranslation } from "react-i18next";

export const UsersPage: FC = () => {
	const { t, i18n } = useTranslation();
	const isRTL = i18n.dir(i18n.language) === "rtl";

	useEffect(() => {
		useDashboard.getState().refetchUsers();
		fetchInbounds();
	}, []);

	useEffect(() => {
		const shouldOpenCreate = sessionStorage.getItem("openCreateUser");
		if (shouldOpenCreate === "true") {
			sessionStorage.removeItem("openCreateUser");
			useDashboard.getState().onCreateUser(true);
		}
	}, []);

	return (
		<VStack spacing={6} align="stretch" dir={isRTL ? "rtl" : "ltr"}>
			<VStack spacing={1} align="flex-start">
				<Text as="h1" fontWeight="semibold" fontSize="2xl">
					{t("users")}
				</Text>
				<Text fontSize="sm" color="gray.600" _dark={{ color: "gray.400" }}>
					{t("usersPage.subtitle")}
				</Text>
			</VStack>
			<Box
				borderWidth="1px"
				borderColor="light-border"
				borderRadius="xl"
				bg="surface.light"
				_dark={{ bg: "surface.dark", borderColor: "whiteAlpha.200" }}
				p={{ base: 3, md: 4 }}
			>
				<Filters />
			</Box>
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
