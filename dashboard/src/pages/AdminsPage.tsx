import { Text, VStack } from "@chakra-ui/react";
import AdminDetailsDrawer from "components/AdminDetailsDrawer";
import { AdminDialog } from "components/AdminDialog";
import { AdminsTable } from "components/AdminsTable";
import { Filters } from "components/Filters";
import { Pagination } from "components/Pagination";
import { useAdminsStore } from "contexts/AdminsContext";
import useGetUser from "hooks/useGetUser";
import { type FC, useEffect } from "react";
import { useTranslation } from "react-i18next";

export const AdminsPage: FC = () => {
	const { t } = useTranslation();
	const fetchAdmins = useAdminsStore((s) => s.fetchAdmins);
	const openAdminDialog = useAdminsStore((s) => s.openAdminDialog);
	const { userData, getUserIsSuccess } = useGetUser();
	const canViewAdmins =
		getUserIsSuccess && Boolean(userData.permissions?.sections.admins);

	useEffect(() => {
		if (canViewAdmins) {
			fetchAdmins();
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
				<Text as="h1" fontWeight="semibold" fontSize="2xl">
					{t("admins.manageTab", "Admins")}
				</Text>
				<Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }}>
					{t(
						"admins.pageDescription",
						"View and manage admin accounts. Use this page to create, edit and review admin permissions and recent usage.",
					)}
				</Text>
				<Text>
					{t(
						"admins.noPermission",
						"You don't have permission to manage admins.",
					)}
				</Text>
			</VStack>
		);
	}

	return (
		<VStack spacing={4} align="stretch">
			<Text as="h1" fontWeight="semibold" fontSize="2xl">
				{t("admins.manageTab", "Admins")}
			</Text>
			<Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }}>
				{t(
					"admins.pageDescription",
					"View and manage admin accounts. Use this page to create, edit and review admin permissions and recent usage.",
				)}
			</Text>
			<Filters for="admins" />
			<AdminsTable />
			<Pagination for="admins" />
			<AdminDialog />
			<AdminDetailsDrawer />
		</VStack>
	);
};

export default AdminsPage;
