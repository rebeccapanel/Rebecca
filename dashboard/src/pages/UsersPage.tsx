import { Box, Flex, Text, useColorModeValue, VStack } from "@chakra-ui/react";
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
	const borderColor = useColorModeValue("blackAlpha.200", "whiteAlpha.200");
	const panelBg = useColorModeValue("white", "whiteAlpha.50");
	const filterBg = useColorModeValue("gray.50", "whiteAlpha.100");
	const mutedColor = useColorModeValue("gray.600", "gray.400");

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
			<Flex
				borderWidth="1px"
				borderColor={borderColor}
				borderRadius="md"
				bg={panelBg}
				px={{ base: 3, md: 4 }}
				py={4}
				align={{ base: "flex-start", md: "center" }}
				justify="space-between"
				gap={3}
				flexWrap="wrap"
			>
				<Box>
					<Text as="h1" fontWeight="semibold" fontSize="2xl">
						{t("users")}
					</Text>
					<Text fontSize="sm" color={mutedColor}>
						{t("usersPage.subtitle")}
					</Text>
				</Box>
			</Flex>
			<Box
				borderWidth="1px"
				borderColor={borderColor}
				borderRadius="md"
				bg={filterBg}
				p={{ base: 3, md: 4 }}
			>
				<Filters />
			</Box>
			<UsersTable />
			<Pagination />
			<UserDialog />
			<QRCodeDialog />
			<ResetUserUsageModal />
			<RevokeSubscriptionModal />
		</VStack>
	);
};

export default UsersPage;
