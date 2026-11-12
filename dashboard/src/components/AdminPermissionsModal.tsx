import { Button } from "components/ui/button";
import { Switch } from "components/ui/switch";
import { toast } from "components/ui/sonner";


import { AppDialog } from "components/dialogs/AppDialog";
import { DEFAULT_ADMIN_PERMISSIONS } from "constants/adminPermissions";
import { useAdminsStore } from "contexts/AdminsContext";
import { useEffect, useState } from "react";
import useGetUser from "hooks/useGetUser";
import { useTranslation } from "react-i18next";
import type { Admin, AdminPermissions } from "types/Admin";
import { AdminManagementPermission, AdminRole } from "types/Admin";
import {
	generateErrorMessage,
	generateSuccessMessage,
} from "utils/toastHandler";
import AdminPermissionsEditor from "./AdminPermissionsEditor";

type AdminPermissionsModalProps = {
	open: boolean;
	onClose: () => void;
	admin: Admin | null;
};

export const AdminPermissionsModal = ({
	open: isOpen,
	onClose,
	admin,
}: AdminPermissionsModalProps) => {
	const { t } = useTranslation();
	
	const updateAdmin = useAdminsStore((state) => state.updateAdmin);
	const { userData } = useGetUser();
	const [permissionsDraft, setPermissionsDraft] = useState<AdminPermissions>(
		admin?.permissions ?? DEFAULT_ADMIN_PERMISSIONS,
	);
	const [maxDataLimitValue, setMaxDataLimitValue] = useState<string>("");
	const [minDataLimitValue, setMinDataLimitValue] = useState<string>("");
	const [maxSpeedLimitValue, setMaxSpeedLimitValue] = useState<string>("");
	const [maxIPLimitValue, setMaxIPLimitValue] = useState<string>("");
	const [saving, setSaving] = useState(false);
	const [require2FA, setRequire2FA] = useState(false);
	const isFullAccess = admin?.role === AdminRole.FullAccess;
	const canManage2FA =
		userData.role === AdminRole.FullAccess ||
		Boolean(userData.permissions.admin_management[AdminManagementPermission.Manage2FA]);

	useEffect(() => {
		if (admin) {
			setRequire2FA(Boolean(admin.require_2fa));
			setMaxSpeedLimitValue(
				admin.permissions.users.max_speed_limit_per_user
					? String(admin.permissions.users.max_speed_limit_per_user / 1000)
					: "",
			);
			setMaxIPLimitValue(
				admin.permissions.users.max_ip_limit_per_user
					? String(admin.permissions.users.max_ip_limit_per_user)
					: "",
			);
			setPermissionsDraft(admin.permissions ?? DEFAULT_ADMIN_PERMISSIONS);
			setMinDataLimitValue(
				admin.permissions.users.min_data_limit_per_user
					? String(
							Number(
								(admin.permissions.users.min_data_limit_per_user / (1024 * 1024 * 1024)).toFixed(2),
							),
						)
					: "",
			);
			setMaxDataLimitValue(
				admin.permissions.users.max_data_limit_per_user
					? String(
							Math.floor(
								admin.permissions.users.max_data_limit_per_user /
									(1024 * 1024 * 1024),
							),
						)
					: "",
			);
		} else {
			setRequire2FA(false);
			setPermissionsDraft(DEFAULT_ADMIN_PERMISSIONS);
			setMaxDataLimitValue("");
			setMinDataLimitValue("");
		}
	}, [admin]);

	const handleSave = async () => {
		if (!admin) return;
		setSaving(true);
		try {
			await updateAdmin(admin.username, {
				...(isFullAccess ? {} : { permissions: permissionsDraft }),
				...(canManage2FA ? { require_2fa: require2FA } : {}),
			});
			generateSuccessMessage(
				t("admins.permissions.updateSuccess"),
				toast,
			);
			onClose();
		} catch (error) {
			generateErrorMessage(error, toast);
		} finally {
			setSaving(false);
		}
	};

	return (
		<AppDialog open={isOpen} onClose={onClose} size="4xl" title={t("admins.permissions.modalTitle", {
				username: admin?.username ?? "",
			})} contentProps={{ className: "max-w-[100vw] md:max-w-[calc(100vw_-_24px)] lg:max-w-[960px] h-[100dvh] md:h-auto max-h-[100dvh] md:max-h-[calc(100dvh_-_7.5rem)] my-0 md:my-[3.75rem] rounded-[0px] md:rounded-md" }} headerProps={{ className: "pr-12 text-[1.25rem] md:text-[1.5rem]" }} bodyProps={{ className: "overflow-x-hidden overflow-y-auto" }} footerProps={{ className: "gap-3" }} footer={
				<>
					<Button onClick={onClose} variant="ghost">
						{t("cancel")}
					</Button>
					<Button onClick={handleSave} disabled={!admin || (isFullAccess && !canManage2FA)} loading={saving}>
						{t("save")}
					</Button>
				</>
			}>
					{isFullAccess && (
						<p className="text-gray-500 mb-3">
							{t("admins.permissions.fullAccessLocked")}
						</p>
					)}
					<AdminPermissionsEditor
						value={permissionsDraft}
						onChange={setPermissionsDraft}
						showReset={!isFullAccess}
						onReset={() => setPermissionsDraft(DEFAULT_ADMIN_PERMISSIONS)}
						maxDataLimitValue={maxDataLimitValue}
						onMaxDataLimitChange={(value) => {
							setMaxDataLimitValue(value);
							const parsed = Number(value);
							setPermissionsDraft((prev) => ({
								...prev,
								users: {
									...prev.users,
									max_data_limit_per_user:
										!value || Number.isNaN(parsed)
											? null
											: Math.max(0, parsed) * 1024 * 1024 * 1024,
								},
							}));
						}}
						minDataLimitValue={minDataLimitValue}
						onMinDataLimitChange={(value) => {
							setMinDataLimitValue(value);
							const parsed = Number(value);
							setPermissionsDraft((prev) => ({
								...prev,
								users: {
									...prev.users,
									min_data_limit_per_user:
										!value || Number.isNaN(parsed)
											? null
											: Math.max(0, parsed) * 1024 * 1024 * 1024,
								},
							}));
						}}
						maxSpeedLimitValue={maxSpeedLimitValue}
						onMaxSpeedLimitChange={(value) => {
							setMaxSpeedLimitValue(value);
							const parsed = Number(value);
							setPermissionsDraft((prev) => ({
								...prev,
								users: {
									...prev.users,
									max_speed_limit_per_user:
										!value || Number.isNaN(parsed)
											? null
											: Math.max(0, Math.round(parsed * 1000)),
								},
							}));
						}}
						maxIPLimitValue={maxIPLimitValue}
						onMaxIPLimitChange={(value) => {
							setMaxIPLimitValue(value);
							const parsed = Number(value);
							setPermissionsDraft((prev) => ({
								...prev,
								users: {
									...prev.users,
									max_ip_limit_per_user:
										!value || Number.isNaN(parsed)
											? null
											: Math.max(0, Math.floor(parsed)),
								},
							}));
						}}
						hideExtendedSections={false}
						readOnly={isFullAccess}
					/>
					<div className="flex flex-row items-center gap-2 border rounded-md justify-between mt-5 p-3">
						<p>{t("admins.security.require2FA")}</p>
						<Switch checked={require2FA} disabled={!canManage2FA} onCheckedChange={(checked: boolean) => setRequire2FA(checked)} />
					</div>
		</AppDialog>
	);
};

export default AdminPermissionsModal;
