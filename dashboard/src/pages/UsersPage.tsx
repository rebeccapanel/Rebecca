import {
	Box,
	Flex,
	Text,
	useColorModeValue,
	VStack,
} from "@chakra-ui/react";
import { ReloadIcon } from "components/Filters";
import { Pagination } from "components/Pagination";
import { QRCodeDialog } from "components/QRCodeDialog";
import { ResetUserUsageModal } from "components/ResetUserUsageModal";
import { RevokeSubscriptionModal } from "components/RevokeSubscriptionModal";
import { UserDialog } from "components/UserDialog";
import { UsersTable } from "components/UsersTable";
import { ResourceRefreshButton } from "components/ui";
import { UsersFilterBar } from "components/users";
import { fetchInbounds, useDashboard } from "contexts/DashboardContext";
import { type FC, useEffect } from "react";
import { useTranslation } from "react-i18next";

export const UsersPage: FC = () => {
	const { t, i18n } = useTranslation();
	const isRTL = i18n.dir(i18n.language) === "rtl";
	const borderColor = useColorModeValue("panel.border", "panel.border");
	const panelBg = useColorModeValue("panel.surface", "panel.surface");
	const mutedColor = useColorModeValue("panel.textSecondary", "panel.textSecondary");
	const { loading, refetchUsers } = useDashboard();

	useEffect(() => {
		useDashboard.getState().refetchUsers(true);
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
		<VStack
			className="rb-users-section"
			spacing={5}
			align="stretch"
			dir={isRTL ? "rtl" : "ltr"}
		>
			<Flex
				className="rb-users-header"
				borderWidth="1px"
				borderColor={borderColor}
				borderRadius="6px"
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
			<UsersTable
				toolbar={<UsersFilterBar />}
				headerActions={
					<ResourceRefreshButton
						aria-label={t("refresh", "Refresh")}
						label={t("refresh", "Refresh")}
						icon={<ReloadIcon />}
						onClick={() => refetchUsers(true)}
						isLoading={loading}
					/>
				}
			/>
			<Pagination />
			<UserDialog />
			<QRCodeDialog />
			<ResetUserUsageModal />
			<RevokeSubscriptionModal />
		</VStack>
	);
};

export default UsersPage;
