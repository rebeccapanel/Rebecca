import {
	Button,
	Modal,
	ModalBody,
	ModalCloseButton,
	ModalContent,
	ModalFooter,
	ModalHeader,
	ModalOverlay,
	Text,
	useToast,
} from "@chakra-ui/react";
import { DEFAULT_ADMIN_PERMISSIONS } from "constants/adminPermissions";
import { useAdminsStore } from "contexts/AdminsContext";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Admin, AdminPermissions } from "types/Admin";
import { AdminRole } from "types/Admin";
import {
	generateErrorMessage,
	generateSuccessMessage,
} from "utils/toastHandler";
import AdminPermissionsEditor from "./AdminPermissionsEditor";

type AdminPermissionsModalProps = {
	isOpen: boolean;
	onClose: () => void;
	admin: Admin | null;
};

export const AdminPermissionsModal = ({
	isOpen,
	onClose,
	admin,
}: AdminPermissionsModalProps) => {
	const { t } = useTranslation();
	const toast = useToast();
	const updateAdmin = useAdminsStore((state) => state.updateAdmin);
	const [permissionsDraft, setPermissionsDraft] = useState<AdminPermissions>(
		admin?.permissions ?? DEFAULT_ADMIN_PERMISSIONS,
	);
	const [maxDataLimitValue, setMaxDataLimitValue] = useState<string>("");
	const [saving, setSaving] = useState(false);
	const isFullAccess = admin?.role === AdminRole.FullAccess;

	useEffect(() => {
		if (admin) {
			setPermissionsDraft(admin.permissions ?? DEFAULT_ADMIN_PERMISSIONS);
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
			setPermissionsDraft(DEFAULT_ADMIN_PERMISSIONS);
			setMaxDataLimitValue("");
		}
	}, [admin]);

	const handleSave = async () => {
		if (!admin) return;
		if (isFullAccess) return;
		setSaving(true);
		try {
			await updateAdmin(admin.username, {
				permissions: permissionsDraft,
			});
			generateSuccessMessage(
				t("admins.permissions.updateSuccess", "Permissions updated"),
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
		<Modal isOpen={isOpen} onClose={onClose} size="lg">
			<ModalOverlay />
			<ModalContent>
				<ModalHeader>
					{t("admins.permissions.modalTitle", {
						username: admin?.username ?? "",
					})}
				</ModalHeader>
				<ModalCloseButton />
				<ModalBody>
					{isFullAccess && (
						<Text color="gray.500" mb={3}>
							{t("admins.permissions.fullAccessLocked")}
						</Text>
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
						hideExtendedSections={admin?.role === AdminRole.Standard}
						isReadOnly={isFullAccess}
					/>
				</ModalBody>
				<ModalFooter>
					<Button variant="ghost" mr={3} onClick={onClose}>
						{t("cancel")}
					</Button>
					<Button
						colorScheme="primary"
						onClick={handleSave}
						isLoading={saving}
						isDisabled={!admin || isFullAccess}
					>
						{t("save")}
					</Button>
				</ModalFooter>
			</ModalContent>
		</Modal>
	);
};

export default AdminPermissionsModal;
