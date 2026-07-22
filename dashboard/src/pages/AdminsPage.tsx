import {
	Text,
	VStack,
} from "@chakra-ui/react";
import AdminDetailsDrawer from "components/AdminDetailsDrawer";
import { AdminDialog } from "components/AdminDialog";
import { AdminsTable } from "components/AdminsTable";
import { Filters, ReloadIcon } from "components/Filters";
import { Pagination } from "components/Pagination";
import { PageHeader, ResourceRefreshButton } from "components/ui";
import { useAdminsStore } from "contexts/AdminsContext";
import useGetUser from "hooks/useGetUser";
import { type FC, useEffect } from "react";
import { useTranslation } from "react-i18next";

export const AdminsPage: FC = () => {
	const { t } = useTranslation();
	const fetchAdmins = useAdminsStore((s) => s.fetchAdmins);
	const adminsLoading = useAdminsStore((s) => s.loading);
	const openAdminDialog = useAdminsStore((s) => s.openAdminDialog);
	const { userData, getUserIsSuccess } = useGetUser();
	const canViewAdmins =
		getUserIsSuccess && Boolean(userData.permissions?.sections.admins);
	useEffect(() => {
		if (canViewAdmins) {
			fetchAdmins(undefined, { force: true });
		}
	}, [fetchAdmins, canViewAdmins]);

	useEffect(() => {
		if (!canViewAdmins) return;
		const shouldOpenCreate = sessionStorage.getItem("openCreateAdmin");
		if (shouldOpenCreate === "true") {
			sessionStorage.removeItem("openCreateAdmin");
			openAdminDialog();
		}
	}, [canViewAdmins, openAdminDialog]);

	if (!canViewAdmins) {
		return (
			<VStack spacing={4} align="stretch">
				<PageHeader
					title={t("admins")}
					description={t("admins.pageDescription")}
				/>
				<Text color="panel.textMuted">
					{t("admins.noPermission")}
				</Text>
			</VStack>
		);
	}

	return (
		<VStack spacing={4} align="stretch">
			<PageHeader
				title={t("admins")}
				description={t("admins.pageDescription")}
			/>
			<AdminsTable
				toolbar={<Filters for="admins" py={0} showRefresh={false} />}
				footerActions={
					<ResourceRefreshButton
						aria-label={t("refresh")}
						label={t("refresh")}
						icon={<ReloadIcon />}
						onClick={() => fetchAdmins(undefined, { force: true })}
						isLoading={adminsLoading}
					/>
				}
			/>
			<Pagination for="admins" />
			<AdminDialog />
			<AdminDetailsDrawer />
		</VStack>
	);
};

export default AdminsPage;
