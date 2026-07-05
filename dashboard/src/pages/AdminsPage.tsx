import {
	Box,
	Button,
	Checkbox,
	CheckboxGroup,
	Collapse,
	HStack,
	SimpleGrid,
	Stack,
	Text,
	useToast,
	VStack,
} from "@chakra-ui/react";
import { AdjustmentsHorizontalIcon } from "@heroicons/react/24/outline";
import AdminDetailsDrawer from "components/AdminDetailsDrawer";
import { AdminDialog } from "components/AdminDialog";
import { AdminsTable } from "components/AdminsTable";
import { Filters, ReloadIcon } from "components/Filters";
import { Pagination } from "components/Pagination";
import { PageHeader, ResourceRefreshButton } from "components/ui";
import { useAdminsStore } from "contexts/AdminsContext";
import useGetUser from "hooks/useGetUser";
import { type FC, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	AdminManagementPermission,
	AdminRole,
	UserPermissionToggle,
} from "types/Admin";
import {
	generateErrorMessage,
	generateSuccessMessage,
} from "utils/toastHandler";

export const AdminsPage: FC = () => {
	const { t } = useTranslation();
	const toast = useToast();
	const fetchAdmins = useAdminsStore((s) => s.fetchAdmins);
	const adminsLoading = useAdminsStore((s) => s.loading);
	const openAdminDialog = useAdminsStore((s) => s.openAdminDialog);
	const bulkUpdateStandardPermissions = useAdminsStore(
		(s) => s.bulkUpdateStandardPermissions,
	);
	const { userData, getUserIsSuccess } = useGetUser();
	const canViewAdmins =
		getUserIsSuccess && Boolean(userData.permissions?.sections.admins);
	const hasFullAccess = userData.role === AdminRole.FullAccess;
	const canEditAdmins = Boolean(
		userData.permissions?.admin_management?.[AdminManagementPermission.Edit] ||
			hasFullAccess,
	);
	const [isBulkPanelOpen, setBulkPanelOpen] = useState(false);
	const [bulkPermissions, setBulkPermissions] = useState<UserPermissionToggle[]>([
		UserPermissionToggle.Create,
		UserPermissionToggle.Delete,
		UserPermissionToggle.ResetUsage,
		UserPermissionToggle.Revoke,
	]);
	const [isBulkUpdating, setBulkUpdating] = useState(false);

	const bulkPermissionOptions = useMemo(
		() => [
			{
				key: UserPermissionToggle.Create,
				label: t("admins.bulkPermissions.create", "Create users"),
			},
			{
				key: UserPermissionToggle.Delete,
				label: t("admins.bulkPermissions.delete", "Delete users"),
			},
			{
				key: UserPermissionToggle.ResetUsage,
				label: t("admins.bulkPermissions.resetUsage", "Reset usage"),
			},
			{
				key: UserPermissionToggle.Revoke,
				label: t("admins.bulkPermissions.revoke", "Revoke subscriptions"),
			},
			{
				key: UserPermissionToggle.CreateOnHold,
				label: t("admins.bulkPermissions.createOnHold", "Create on hold"),
			},
			{
				key: UserPermissionToggle.AllowUnlimitedData,
				label: t("admins.bulkPermissions.allowUnlimitedData", "Unlimited data"),
			},
			{
				key: UserPermissionToggle.AllowUnlimitedExpire,
				label: t(
					"admins.bulkPermissions.allowUnlimitedExpire",
					"Unlimited expire",
				),
			},
			{
				key: UserPermissionToggle.AllowNextPlan,
				label: t("admins.bulkPermissions.allowNextPlan", "Next plan"),
			},
			{
				key: UserPermissionToggle.AdvancedActions,
				label: t("admins.bulkPermissions.advancedActions", "Advanced actions"),
			},
			{
				key: UserPermissionToggle.SetFlow,
				label: t("admins.bulkPermissions.setFlow", "Set flow"),
			},
			{
				key: UserPermissionToggle.AllowCustomKey,
				label: t("admins.bulkPermissions.allowCustomKey", "Custom key"),
			},
		],
		[t],
	);

	const handleBulkPermissions = async (mode: "disable" | "restore") => {
		if (!bulkPermissions.length) {
			generateErrorMessage(
				t(
					"admins.bulkPermissions.selectAtLeastOne",
					"Select at least one permission.",
				),
				toast,
			);
			return;
		}
		setBulkUpdating(true);
		try {
			const result = await bulkUpdateStandardPermissions({
				mode,
				permissions: bulkPermissions,
			});
			const updatedCount = result?.updated ?? 0;
			generateSuccessMessage(
				t(
					"admins.bulkPermissions.success",
					"Updated permissions for {{count}} standard admins.",
					{ count: updatedCount },
				),
				toast,
			);
		} catch (_error) {
			generateErrorMessage(
				t("admins.bulkPermissions.error", "Failed to update standard admins."),
				toast,
			);
		} finally {
			setBulkUpdating(false);
		}
	};

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
					title={t("admins.manageTab", "Admins")}
					description={t(
						"admins.pageDescription",
						"View and manage admin accounts. Use this page to create, edit and review admin permissions and recent usage.",
					)}
				/>
				<Text color="panel.textMuted">
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
			<PageHeader
				title={t("admins.manageTab", "Admins")}
				description={t(
					"admins.pageDescription",
					"View and manage admin accounts. Use this page to create, edit and review admin permissions and recent usage.",
				)}
			/>
			<AdminsTable
				toolbar={
					<Box>
						<Filters
							for="admins"
							py={0}
							showRefresh={false}
							actionsSlot={
								canEditAdmins ? (
									<Button
										size="sm"
										variant="outline"
										leftIcon={<AdjustmentsHorizontalIcon width={16} />}
										onClick={() => setBulkPanelOpen((prev) => !prev)}
										h="36px"
										px={3}
										borderRadius="4px"
										whiteSpace="nowrap"
									>
										{isBulkPanelOpen
											? t("admins.bulkPermissions.hide", "Hide")
											: t("admins.bulkPermissions.show", "Manage")}
									</Button>
								) : undefined
							}
						/>
						{canEditAdmins && (
							<Collapse in={isBulkPanelOpen} animateOpacity>
								<Box
									mt={3}
									borderWidth="1px"
									borderRadius="6px"
									borderColor="panel.border"
									bg="panel.surface"
									p={{ base: 3, md: 4 }}
								>
									<Stack spacing={4}>
										<Stack spacing={0}>
											<Text fontWeight="semibold">
												{t(
													"admins.bulkPermissions.title",
													"Standard admin bulk permissions",
												)}
											</Text>
											<Text fontSize="sm" color="panel.textMuted">
												{t(
													"admins.bulkPermissions.subtitle",
													"Quickly disable or restore selected permissions for all standard admins.",
												)}
											</Text>
										</Stack>
										<CheckboxGroup
											value={bulkPermissions}
											onChange={(values) =>
												setBulkPermissions(values as UserPermissionToggle[])
											}
										>
											<SimpleGrid columns={{ base: 2, md: 3 }} spacing={3}>
												{bulkPermissionOptions.map((option) => (
													<Checkbox key={option.key} value={option.key}>
														{option.label}
													</Checkbox>
												))}
											</SimpleGrid>
										</CheckboxGroup>
										<HStack spacing={3} flexWrap="wrap">
											<Button
												size="sm"
												colorScheme="red"
												onClick={() => handleBulkPermissions("disable")}
												isLoading={isBulkUpdating}
											>
												{t("admins.bulkPermissions.disable", "Disable selected")}
											</Button>
											<Button
												size="sm"
												variant="outline"
												onClick={() => handleBulkPermissions("restore")}
												isLoading={isBulkUpdating}
											>
												{t("admins.bulkPermissions.restore", "Restore defaults")}
											</Button>
										</HStack>
									</Stack>
								</Box>
							</Collapse>
						)}
					</Box>
				}
				footerActions={
					<ResourceRefreshButton
						aria-label={t("refresh", "Refresh")}
						label={t("refresh", "Refresh")}
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
