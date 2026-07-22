import {
	Button,
	FormControl,
	FormErrorMessage,
	FormHelperText,
	FormLabel,
	HStack,
	SimpleGrid,
	Stack,
	Switch,
	Text,
	Tooltip,
} from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import {
	AdminManagementPermission,
	type AdminPermissions,
	AdminSection,
	AdminSudoScope,
	SelfPermissionToggle,
	UserPermissionToggle,
} from "types/Admin";
import { NumericInput } from "./common/NumericInput";

type AdminPermissionsEditorProps = {
	value: AdminPermissions;
	onChange: (next: AdminPermissions) => void;
	maxDataLimitValue?: string;
	onMaxDataLimitChange?: (value: string) => void;
	maxDataLimitError?: string;
	showReset?: boolean;
	onReset?: () => void;
	hideExtendedSections?: boolean;
	isReadOnly?: boolean;
	forceDesktopLayout?: boolean;
};

const userPermissionKeys: Array<{ key: UserPermissionToggle; label: string }> =
	[
		{
			key: UserPermissionToggle.Create,
			label: "admins.permissions.createUser",
		},
		{
			key: UserPermissionToggle.Delete,
			label: "admins.permissions.deleteUser",
		},
		{
			key: UserPermissionToggle.ResetUsage,
			label: "admins.permissions.resetUsage",
		},
		{ key: UserPermissionToggle.Revoke, label: "admins.permissions.revoke" },
		{
			key: UserPermissionToggle.CreateOnHold,
			label: "admins.permissions.createOnHold",
		},
		{
			key: UserPermissionToggle.AllowUnlimitedData,
			label: "admins.permissions.unlimitedData",
		},
		{
			key: UserPermissionToggle.AllowUnlimitedExpire,
			label: "admins.permissions.unlimitedExpire",
		},
		{
			key: UserPermissionToggle.AllowNextPlan,
			label: "admins.permissions.nextPlan",
		},
		{
			key: UserPermissionToggle.AdvancedActions,
			label: "admins.permissions.advancedActions",
		},
		{
			key: UserPermissionToggle.SetFlow,
			label: "admins.permissions.setFlow",
		},
		{
			key: UserPermissionToggle.AllowCustomKey,
			label: "admins.permissions.customKey",
		},
	];

const adminManagementKeys: Array<{
	key: AdminManagementPermission;
	label: string;
}> = [
	{
		key: AdminManagementPermission.View,
		label: "admins.permissions.viewAdmins",
	},
	{
		key: AdminManagementPermission.Edit,
		label: "admins.permissions.editAdmins",
	},
	{
		key: AdminManagementPermission.ManageSudo,
		label: "admins.permissions.manageSudo",
	},
	{ key: AdminManagementPermission.ManageSessions, label: "admins.permissions.manageSessions" },
	{ key: AdminManagementPermission.Manage2FA, label: "admins.permissions.manage2FA" },
];

const sectionPermissionKeys: Array<{ key: AdminSection; label: string }> = [
	{ key: AdminSection.Usage, label: "admins.sections.usage" },
	{ key: AdminSection.Admins, label: "admins.sections.admins" },
	{ key: AdminSection.Services, label: "admins.sections.services" },
	{ key: AdminSection.Hosts, label: "admins.sections.hosts" },
	{ key: AdminSection.Nodes, label: "admins.sections.nodes" },
	{ key: AdminSection.Integrations, label: "admins.sections.integrations" },
	{ key: AdminSection.Xray, label: "admins.sections.xray" },
];

const selfPermissionKeys: Array<{ key: SelfPermissionToggle; label: string }> =
	[
		{ key: SelfPermissionToggle.SelfMyAccount, label: "admins.self.myaccount" },
		{
			key: SelfPermissionToggle.SelfChangePassword,
			label: "admins.self.changePassword",
		},
		{ key: SelfPermissionToggle.SelfApiKeys, label: "admins.self.apiKeys" },
		{ key: SelfPermissionToggle.SelfSessions, label: "admins.self.sessions" },
		{ key: SelfPermissionToggle.Self2FA, label: "admins.self.twoFactor" },
	];

const sudoPermissionKeys: Array<{ key: AdminSudoScope; label: string }> = [
	{ key: AdminSudoScope.Nodes, label: "admins.sudo.nodes" },
	{ key: AdminSudoScope.Xray, label: "admins.sudo.xray" },
	{ key: AdminSudoScope.Settings, label: "admins.sudo.settings" },
	{ key: AdminSudoScope.Subscriptions, label: "admins.sudo.subscriptions" },
	{ key: AdminSudoScope.Backups, label: "admins.sudo.backups" },
	{ key: AdminSudoScope.Maintenance, label: "admins.sudo.maintenance" },
	{ key: AdminSudoScope.PHPMyAdmin, label: "admins.sudo.phpmyadmin" },
];

type PermissionKeyMap = {
	users: UserPermissionToggle;
	admin_management: AdminManagementPermission;
	sections: AdminSection;
	self_permissions: SelfPermissionToggle;
	sudo: AdminSudoScope;
};

export const AdminPermissionsEditor = ({
	value,
	onChange,
	maxDataLimitValue,
	onMaxDataLimitChange,
	maxDataLimitError,
	showReset = false,
	onReset,
	hideExtendedSections = false,
	isReadOnly = false,
	forceDesktopLayout = false,
}: AdminPermissionsEditorProps) => {
	const { t } = useTranslation();
	const gridColumns = forceDesktopLayout ? 2 : { base: 1, md: 2 };

	const updatePermissions = <T extends keyof PermissionKeyMap>(
		section: T,
		key: PermissionKeyMap[T],
		next: boolean,
	) => {
		if (isReadOnly) return;
		const updatedSection = {
			...value[section],
			[key]: next,
		} as AdminPermissions[T];
		const updated: AdminPermissions = {
			...value,
			[section]: updatedSection,
		};

		// If allow_unlimited_data is enabled, clear max_data_limit_per_user
		if (
			section === "users" &&
			key === UserPermissionToggle.AllowUnlimitedData &&
			next
		) {
			updated.users.max_data_limit_per_user = null;
			onMaxDataLimitChange?.("");
		}

		onChange(updated);
	};

	const handleMaxDataLimitChange = (value: string) => {
		onMaxDataLimitChange?.(value);
	};

	return (
		<Stack spacing={6}>
			<HStack justify="space-between" align="center">
				<Text fontWeight="semibold">
					{t("admins.permissions.userCapabilities")}
				</Text>
				{showReset && onReset && (
					<Button
						size="xs"
						variant="ghost"
						onClick={onReset}
						isDisabled={isReadOnly}
					>
						{t("admins.permissions.resetToDefaults")}
					</Button>
				)}
			</HStack>
			<SimpleGrid columns={gridColumns} spacing={3}>
				{userPermissionKeys.map(({ key, label }) => (
					<HStack
						key={key}
						justify="space-between"
						align="center"
						borderWidth="1px"
						borderRadius="md"
						px={3}
						py={2}
						minW={0}
					>
						<Text fontSize="sm" flex="1" minW={0} lineHeight="short">
							{t(label)}
						</Text>
						<Switch
							flexShrink={0}
							isChecked={Boolean(value.users[key])}
							isDisabled={isReadOnly}
							onChange={(event) =>
								updatePermissions("users", key, event.target.checked)
							}
						/>
					</HStack>
				))}
			</SimpleGrid>
			<FormControl isInvalid={Boolean(maxDataLimitError)}>
				<FormLabel>
					{t("admins.permissions.maxDataPerUser")}
				</FormLabel>
				<Tooltip
					label={t("admins.permissions.unlimitedEnabledHint")}
					isDisabled={!value.users.allow_unlimited_data}
					hasArrow
					openDelay={200}
					placement="top"
					gutter={6}
					shouldWrapChildren
				>
					<NumericInput
						min={0}
						step={1}
						placeholder={t("admins.permissions.maxDataHint")}
						value={maxDataLimitValue}
						onChange={handleMaxDataLimitChange}
						isDisabled={value.users.allow_unlimited_data || isReadOnly}
					/>
				</Tooltip>
				{maxDataLimitError ? (
					<FormErrorMessage>{maxDataLimitError}</FormErrorMessage>
				) : (
					<FormHelperText>
						{value.users.allow_unlimited_data
							? t("admins.permissions.unlimitedEnabledHint")
							: t("admins.permissions.maxDataDescription")}
					</FormHelperText>
				)}
			</FormControl>
			{!hideExtendedSections && (
				<Stack spacing={3}>
					<Text fontWeight="semibold">{t("admins.sudo.title")}</Text>
					<SimpleGrid columns={gridColumns} spacing={3}>
						{sudoPermissionKeys.map(({ key, label }) => (
							<HStack key={key} justify="space-between" align="center" borderWidth="1px" borderRadius="md" px={3} py={2} minW={0}>
								<Text fontSize="sm" flex="1" minW={0}>{t(label)}</Text>
								<Switch isChecked={Boolean(value.sudo?.[key])} isDisabled={isReadOnly} onChange={(event) => updatePermissions("sudo", key, event.target.checked)} />
							</HStack>
						))}
					</SimpleGrid>
				</Stack>
			)}
			{!hideExtendedSections && (
				<Stack spacing={3}>
					<Text fontWeight="semibold">
						{t("admins.permissions.manageAdminsTitle")}
					</Text>
					<SimpleGrid columns={gridColumns} spacing={3}>
						{adminManagementKeys.map(({ key, label }) => (
							<HStack
								key={key}
								justify="space-between"
								align="center"
								borderWidth="1px"
								borderRadius="md"
								px={3}
								py={2}
								minW={0}
							>
								<Text fontSize="sm" flex="1" minW={0} lineHeight="short">
									{t(label)}
								</Text>
								<Switch
									flexShrink={0}
									isChecked={Boolean(value.admin_management[key])}
									isDisabled={isReadOnly}
									onChange={(event) =>
										updatePermissions(
											"admin_management",
											key,
											event.target.checked,
										)
									}
								/>
							</HStack>
						))}
					</SimpleGrid>
				</Stack>
			)}
			{!hideExtendedSections && (
				<Stack spacing={3}>
					<Text fontWeight="semibold">
						{t("admins.permissions.sectionAccess")}
					</Text>
					<SimpleGrid columns={gridColumns} spacing={3}>
						{sectionPermissionKeys.map(({ key, label }) => (
							<HStack
								key={key}
								justify="space-between"
								align="center"
								borderWidth="1px"
								borderRadius="md"
								px={3}
								py={2}
								minW={0}
							>
								<Text fontSize="sm" flex="1" minW={0} lineHeight="short">
									{t(label)}
								</Text>
								<Switch
									flexShrink={0}
									isChecked={Boolean(value.sections[key])}
									isDisabled={isReadOnly}
									onChange={(event) =>
										updatePermissions("sections", key, event.target.checked)
									}
								/>
							</HStack>
						))}
					</SimpleGrid>
				</Stack>
			)}
			<Stack spacing={3}>
				<Text fontWeight="semibold">{t("admins.permissions.self.title")}</Text>
				<SimpleGrid columns={gridColumns} spacing={3}>
					{selfPermissionKeys.map(({ key, label }) => (
						<HStack
							key={key}
							justify="space-between"
							align="center"
							borderWidth="1px"
							borderRadius="md"
							px={3}
							py={2}
							minW={0}
						>
							<Text fontSize="sm" flex="1" minW={0} lineHeight="short">
								{t(label)}
							</Text>
							<Switch
								flexShrink={0}
								isChecked={Boolean(value.self_permissions?.[key])}
								isDisabled={isReadOnly}
								onChange={(event) =>
									updatePermissions(
										"self_permissions",
										key,
										event.target.checked,
									)
								}
							/>
						</HStack>
					))}
				</SimpleGrid>
			</Stack>
		</Stack>
	);
};

export default AdminPermissionsEditor;
