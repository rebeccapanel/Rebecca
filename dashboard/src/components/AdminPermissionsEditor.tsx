import { Button } from "components/ui/button";
import { Switch } from "components/ui/switch";
import { Field, FieldDescription, FieldError, FieldLabel } from "components/ui/field";
import { Tooltip, TooltipContent, TooltipTrigger } from "components/ui/tooltip";
import { cn } from "lib/cn";

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
	minDataLimitValue?: string;
	onMinDataLimitChange?: (value: string) => void;
	minDataLimitError?: string;
	maxSpeedLimitValue?: string;
	onMaxSpeedLimitChange?: (value: string) => void;
	maxSpeedLimitError?: string;
	maxIPLimitValue?: string;
	onMaxIPLimitChange?: (value: string) => void;
	maxIPLimitError?: string;
	showReset?: boolean;
	onReset?: () => void;
	hideExtendedSections?: boolean;
	readOnly?: boolean;
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
		{
			key: UserPermissionToggle.PeriodicUsageReset,
			label: "admins.permissions.periodicUsageReset",
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
		{
			key: UserPermissionToggle.ManageSpeedLimit,
			label: "admins.permissions.manageSpeedLimit",
		},
		{
			key: UserPermissionToggle.ManageIPLimit,
			label: "admins.permissions.manageIPLimit",
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
	{
		key: AdminManagementPermission.ManageSessions,
		label: "admins.permissions.manageSessions",
	},
	{
		key: AdminManagementPermission.Manage2FA,
		label: "admins.permissions.manage2FA",
	},
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
		{
			key: SelfPermissionToggle.SelfPlaceholders,
			label: "admins.self.placeholders",
		},
	];

const sudoPermissionKeys: Array<{ key: AdminSudoScope; label: string }> = [
	{ key: AdminSudoScope.Nodes, label: "admins.sudo.nodes" },
	{ key: AdminSudoScope.Xray, label: "admins.sudo.xray" },
	{ key: AdminSudoScope.Settings, label: "admins.sudo.settings" },
	{ key: AdminSudoScope.Subscriptions, label: "admins.sudo.subscriptions" },
	{ key: AdminSudoScope.Backups, label: "admins.sudo.backups" },
	{ key: AdminSudoScope.Maintenance, label: "admins.sudo.maintenance" },
	{ key: AdminSudoScope.PHPMyAdmin, label: "admins.sudo.phpmyadmin" },
	{ key: AdminSudoScope.Notes, label: "admins.sudo.notes" },
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
	minDataLimitValue,
	onMinDataLimitChange,
	minDataLimitError,
	maxSpeedLimitValue,
	onMaxSpeedLimitChange,
	maxSpeedLimitError,
	maxIPLimitValue,
	onMaxIPLimitChange,
	maxIPLimitError,
	showReset = false,
	onReset,
	hideExtendedSections = false,
	readOnly: isReadOnly,
	forceDesktopLayout = false,
}: AdminPermissionsEditorProps) => {
	const { t } = useTranslation();
	const gridColumns = forceDesktopLayout ? "grid-cols-2" : "grid-cols-1 md:grid-cols-2";

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

	const handleMinDataLimitChange = (value: string) => {
		onMinDataLimitChange?.(value);
	};

	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-row gap-2 justify-between items-center">
				<p className="font-semibold">
					{t("admins.permissions.userCapabilities")}
				</p>
				{showReset && onReset && (
					<Button onClick={onReset} disabled={isReadOnly} variant="ghost" size="xs">
						{t("admins.permissions.resetToDefaults")}
					</Button>
				)}
			</div>
			<div className={cn("grid gap-3", gridColumns)}>
				{userPermissionKeys.map(({ key, label }) => (
					<div key={key} className="flex flex-row gap-2 justify-between items-center border rounded-md px-3 py-2 min-w-0!">
						<p className="text-[0.875rem] flex-1 min-w-0! leading-[1.375]">
							{t(label)}
						</p>
						<Switch checked={Boolean(value.users[key])} disabled={isReadOnly} onCheckedChange={(checked: boolean) => updatePermissions("users", key, checked)} className="shrink-0" />
					</div>
				))}
			</div>
			<Field data-invalid={Boolean(maxDataLimitError)}>
				<FieldLabel>{t("admins.permissions.maxDataPerUser")}</FieldLabel>
				<Tooltip>
<TooltipTrigger asChild>
					<NumericInput
						min={0}
						step={1}
						value={maxDataLimitValue}
						onChange={handleMaxDataLimitChange}
						disabled={value.users.allow_unlimited_data || isReadOnly}
					/>
				</TooltipTrigger>
<TooltipContent>{t("admins.permissions.unlimitedEnabledHint")}</TooltipContent>
</Tooltip>
				{maxDataLimitError ? (
					<FieldError>{maxDataLimitError}</FieldError>
				) : (
					<FieldDescription>
						{value.users.allow_unlimited_data
							? t("admins.permissions.unlimitedEnabledHint")
							: t("admins.permissions.maxDataDescription")}
					</FieldDescription>
				)}
			</Field>
							<Field data-invalid={Boolean(maxSpeedLimitError)}>
					<FieldLabel>{t("admins.permissions.maxSpeedPerUser")}</FieldLabel>
			<Field data-invalid={Boolean(minDataLimitError)}>
				<FieldLabel>{t("admins.permissions.minDataPerUser")}</FieldLabel>
				<NumericInput
					min={0}
					step={1}
					placeholder={t("admins.permissions.minDataHint")}
					value={minDataLimitValue ?? ""}
					onChange={handleMinDataLimitChange}
					disabled={isReadOnly}
				/>
				{minDataLimitError ? (
					<FieldError>{minDataLimitError}</FieldError>
				) : (
					<FieldDescription>{t("admins.permissions.minDataDescription")}</FieldDescription>
				)}
			</Field>
					<NumericInput
						min={0}
						step={1}
						value={maxSpeedLimitValue ?? ""}
						onChange={(nextValue) => onMaxSpeedLimitChange?.(nextValue)}
						disabled={!value.users.manage_speed_limit || isReadOnly}
					/>
					{maxSpeedLimitError ? (
						<FieldError>{maxSpeedLimitError}</FieldError>
					) : (
						<FieldDescription>{t("admins.permissions.maxSpeedDescription")}</FieldDescription>
					)}
				</Field>
				<Field data-invalid={Boolean(maxIPLimitError)}>
					<FieldLabel>{t("admins.permissions.maxIPPerUser")}</FieldLabel>
					<NumericInput
						min={0}
						step={1}
						value={maxIPLimitValue ?? ""}
						onChange={(nextValue) => onMaxIPLimitChange?.(nextValue)}
						disabled={!value.users.manage_ip_limit || isReadOnly}
					/>
					{maxIPLimitError ? (
						<FieldError>{maxIPLimitError}</FieldError>
					) : (
						<FieldDescription>{t("admins.permissions.maxIPDescription")}</FieldDescription>
					)}
				</Field>
{!hideExtendedSections && (
				<div className="flex flex-col gap-3">
					<p className="font-semibold">{t("admins.sudo.title")}</p>
					<div className={cn("grid gap-3", gridColumns)}>
						{sudoPermissionKeys.map(({ key, label }) => (
							<div key={key} className="flex flex-row gap-2 justify-between items-center border rounded-md px-3 py-2 min-w-0!">
								<p className="text-[0.875rem] flex-1 min-w-0!">
									{t(label)}
								</p>
								<Switch checked={Boolean(value.sudo?.[key])} disabled={isReadOnly} onCheckedChange={(checked: boolean) => updatePermissions("sudo", key, checked)} />
							</div>
						))}
					</div>
				</div>
			)}
			{!hideExtendedSections && (
				<div className="flex flex-col gap-3">
					<p className="font-semibold">
						{t("admins.permissions.manageAdminsTitle")}
					</p>
					<div className={cn("grid gap-3", gridColumns)}>
						{adminManagementKeys.map(({ key, label }) => (
							<div key={key} className="flex flex-row gap-2 justify-between items-center border rounded-md px-3 py-2 min-w-0!">
								<p className="text-[0.875rem] flex-1 min-w-0! leading-[1.375]">
									{t(label)}
								</p>
								<Switch checked={Boolean(value.admin_management[key])} disabled={isReadOnly} onCheckedChange={(checked: boolean) => updatePermissions(
											"admin_management",
											key,
											checked,
										)} className="shrink-0" />
							</div>
						))}
					</div>
				</div>
			)}
			{!hideExtendedSections && (
				<div className="flex flex-col gap-3">
					<p className="font-semibold">
						{t("admins.permissions.sectionAccess")}
					</p>
					<div className={cn("grid gap-3", gridColumns)}>
						{sectionPermissionKeys.map(({ key, label }) => (
							<div key={key} className="flex flex-row gap-2 justify-between items-center border rounded-md px-3 py-2 min-w-0!">
								<p className="text-[0.875rem] flex-1 min-w-0! leading-[1.375]">
									{t(label)}
								</p>
								<Switch checked={Boolean(value.sections[key])} disabled={isReadOnly} onCheckedChange={(checked: boolean) => updatePermissions("sections", key, checked)} className="shrink-0" />
							</div>
						))}
					</div>
				</div>
			)}
			<div className="flex flex-col gap-3">
				<p className="font-semibold">{t("admins.permissions.self.title")}</p>
				<div className={cn("grid gap-3", gridColumns)}>
					{selfPermissionKeys.map(({ key, label }) => (
						<div key={key} className="flex flex-row gap-2 justify-between items-center border rounded-md px-3 py-2 min-w-0!">
							<p className="text-[0.875rem] flex-1 min-w-0! leading-[1.375]">
								{t(label)}
							</p>
							<Switch checked={Boolean(value.self_permissions?.[key])} disabled={isReadOnly} onCheckedChange={(checked: boolean) => updatePermissions(
										"self_permissions",
										key,
										checked,
									)} className="shrink-0" />
						</div>
					))}
				</div>
			</div>
		</div>
	);
};

export default AdminPermissionsEditor;
