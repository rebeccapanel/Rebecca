import {
	Button,
	FormControl,
	FormErrorMessage,
	FormHelperText,
	FormLabel,
	HStack,
	IconButton,
	Input,
	InputGroup,
	InputRightElement,
	Modal,
	ModalBody,
	ModalCloseButton,
	ModalContent,
	ModalFooter,
	ModalHeader,
	ModalOverlay,
	Radio,
	RadioGroup,
	SimpleGrid,
	Tab,
	TabList,
	TabPanel,
	TabPanels,
	Tabs,
	Text,
	useToast,
	VStack,
} from "@chakra-ui/react";
import {
	EyeIcon,
	EyeSlashIcon,
	SparklesIcon,
} from "@heroicons/react/24/outline";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAdminsStore } from "contexts/AdminsContext";
import useGetUser from "hooks/useGetUser";
import { type FC, useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import type {
	AdminCreatePayload,
	AdminPermissions,
	AdminUpdatePayload,
} from "types/Admin";
import { AdminRole, AdminStatus } from "types/Admin";
import {
	generateErrorMessage,
	generateSuccessMessage,
} from "utils/toastHandler";
import { z } from "zod";
import AdminPermissionsEditor from "./AdminPermissionsEditor";
import AdminPermissionsModal from "./AdminPermissionsModal";

const GB_IN_BYTES = 1024 * 1024 * 1024;

const ROLE_PERMISSION_PRESETS: Record<AdminRole, AdminPermissions> = {
	[AdminRole.Standard]: {
		users: {
			create: true,
			delete: true,
			reset_usage: true,
			revoke: true,
			create_on_hold: true,
			allow_unlimited_data: true,
			allow_unlimited_expire: true,
			allow_next_plan: true,
			advanced_actions: true,
			set_flow: false,
			allow_custom_key: false,
			max_data_limit_per_user: null,
		},
		admin_management: {
			can_view: false,
			can_edit: false,
			can_manage_sudo: false,
		},
		self_permissions: {
			self_myaccount: true,
			self_change_password: true,
			self_api_keys: true,
		},
		sections: {
			usage: false,
			admins: false,
			services: false,
			hosts: false,
			nodes: false,
			integrations: false,
			xray: false,
		},
	},
	[AdminRole.Reseller]: {
		users: {
			create: true,
			delete: true,
			reset_usage: true,
			revoke: true,
			create_on_hold: true,
			allow_unlimited_data: true,
			allow_unlimited_expire: true,
			allow_next_plan: true,
			advanced_actions: true,
			set_flow: false,
			allow_custom_key: false,
			max_data_limit_per_user: null,
		},
		admin_management: {
			can_view: false,
			can_edit: false,
			can_manage_sudo: false,
		},
		self_permissions: {
			self_myaccount: true,
			self_change_password: true,
			self_api_keys: true,
		},
		sections: {
			usage: false,
			admins: false,
			services: false,
			hosts: false,
			nodes: false,
			integrations: false,
			xray: false,
		},
	},
	[AdminRole.Sudo]: {
		users: {
			create: true,
			delete: true,
			reset_usage: true,
			revoke: true,
			create_on_hold: true,
			allow_unlimited_data: true,
			allow_unlimited_expire: true,
			allow_next_plan: true,
			advanced_actions: true,
			set_flow: true,
			allow_custom_key: true,
			max_data_limit_per_user: null,
		},
		admin_management: {
			can_view: true,
			can_edit: true,
			can_manage_sudo: false,
		},
		self_permissions: {
			self_myaccount: true,
			self_change_password: true,
			self_api_keys: true,
		},
		sections: {
			usage: true,
			admins: true,
			services: true,
			hosts: true,
			nodes: true,
			integrations: true,
			xray: true,
		},
	},
	[AdminRole.FullAccess]: {
		users: {
			create: true,
			delete: true,
			reset_usage: true,
			revoke: true,
			create_on_hold: true,
			allow_unlimited_data: true,
			allow_unlimited_expire: true,
			allow_next_plan: true,
			advanced_actions: true,
			set_flow: true,
			allow_custom_key: true,
			max_data_limit_per_user: null,
		},
		admin_management: {
			can_view: true,
			can_edit: true,
			can_manage_sudo: true,
		},
		self_permissions: {
			self_myaccount: true,
			self_change_password: true,
			self_api_keys: true,
		},
		sections: {
			usage: true,
			admins: true,
			services: true,
			hosts: true,
			nodes: true,
			integrations: true,
			xray: true,
		},
	},
};

const clonePermissions = (role: AdminRole): AdminPermissions =>
	JSON.parse(JSON.stringify(ROLE_PERMISSION_PRESETS[role]));

const formatBytesToGbString = (value?: number | null) =>
	value && value > 0 ? String(Math.floor(value / GB_IN_BYTES)) : "";

const adminPermissionsSchema: z.ZodType<AdminPermissions> = z.object({
	users: z.object({
		create: z.boolean(),
		delete: z.boolean(),
		reset_usage: z.boolean(),
		revoke: z.boolean(),
		create_on_hold: z.boolean(),
		allow_unlimited_data: z.boolean(),
		allow_unlimited_expire: z.boolean(),
		allow_next_plan: z.boolean(),
		advanced_actions: z.boolean(),
		set_flow: z.boolean(),
		allow_custom_key: z.boolean(),
		max_data_limit_per_user: z.number().nullable(),
	}),
	admin_management: z.object({
		can_view: z.boolean(),
		can_edit: z.boolean(),
		can_manage_sudo: z.boolean(),
	}),
	self_permissions: z.object({
		self_myaccount: z.boolean(),
		self_change_password: z.boolean(),
		self_api_keys: z.boolean(),
	}),
	sections: z.object({
		usage: z.boolean(),
		admins: z.boolean(),
		services: z.boolean(),
		hosts: z.boolean(),
		nodes: z.boolean(),
		integrations: z.boolean(),
		xray: z.boolean(),
	}),
});

type AdminFormValues = {
	username: string;
	password?: string;
	telegram_id?: string;
	role: AdminRole;
	permissions: AdminPermissions;
	maxDataLimitPerUserGb?: string;
	data_limit?: string;
	users_limit?: string;
};

export const AdminDialog: FC = () => {
	const { t } = useTranslation();
	const { userData } = useGetUser();
	const canCreateFullAccess = userData.role === AdminRole.FullAccess;
	const toast = useToast();
	const {
		admins,
		adminInDialog: adminFromStore,
		isAdminDialogOpen: isOpen,
		closeAdminDialog,
		createAdmin,
		updateAdmin,
	} = useAdminsStore();
	const admin = useMemo(() => {
		if (!adminFromStore) {
			return null;
		}
		return (
			admins.find((item) => item.username === adminFromStore.username) ??
			adminFromStore
		);
	}, [adminFromStore, admins]);

	const mode = useMemo(() => (admin ? "edit" : "create"), [admin]);
	const statusLabels = useMemo(
		() => ({
			[AdminStatus.Active]: t("admins.statusActive", "Active"),
			[AdminStatus.Disabled]: t("admins.statusDisabled", "Disabled"),
			[AdminStatus.Deleted]: t("admins.statusDeleted", "Deleted"),
		}),
		[t],
	);
	const statusLabel = admin
		? (statusLabels[admin.status] ?? admin.status)
		: t("admins.statusNew", "New admin");

	const schema = useMemo(() => {
		const base = z
			.object({
				username:
					mode === "create"
						? z
								.string()
								.trim()
								.min(3, { message: t("admins.validation.usernameMin") })
						: z.string().optional(),
				password: z
					.string()
					.trim()
					.optional()
					.transform((value) => (value === "" ? undefined : value))
					.refine(
						(value) => !value || value.length >= 6,
						t("admins.validation.passwordMin"),
					),
				telegram_id: z
					.string()
					.trim()
					.optional()
					.transform((value) => (value === "" ? undefined : value))
					.refine(
						(value) => value === undefined || /^\d+$/.test(value),
						t("admins.validation.telegramNumeric"),
					),
				role: z.nativeEnum(AdminRole).optional(),
				data_limit: z
					.string()
					.trim()
					.optional()
					.transform((value) => (value === "" ? undefined : value))
					.refine(
						(value) => value === undefined || /^\d+$/.test(value),
						t(
							"admins.validation.dataLimitNumeric",
							"Data limit must be a number",
						),
					),
				users_limit: z
					.string()
					.trim()
					.optional()
					.transform((value) => (value === "" ? undefined : value))
					.refine(
						(value) => value === undefined || /^\d+$/.test(value),
						t(
							"admins.validation.usersLimitNumeric",
							"Users limit must be a number",
						),
					),
				maxDataLimitPerUserGb: z
					.string()
					.trim()
					.optional()
					.transform((value) => (value === "" ? undefined : value)),
				permissions: adminPermissionsSchema,
			})
			.superRefine((values, ctx) => {
				if (mode === "create" && !values.password) {
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						path: ["password"],
						message: t("admins.validation.passwordRequired"),
					});
				}
			});
		return base as z.ZodType<AdminFormValues>;
	}, [mode, t]);

	const form = useForm<AdminFormValues>({
		resolver: zodResolver(schema),
		defaultValues: {
			username: "",
			password: "",
			telegram_id: "",
			role: AdminRole.Standard,
			permissions: clonePermissions(AdminRole.Standard),
			maxDataLimitPerUserGb: "",
			data_limit: "",
			users_limit: "",
		},
	});

	const {
		register,
		handleSubmit,
		reset,
		formState,
		setValue,
		watch,
		setError,
	} = form;

	const [showPassword, setShowPassword] = useState(false);
	const [permissionsModalOpen, setPermissionsModalOpen] = useState(false);

	const generateRandomString = useCallback((length: number) => {
		const characters =
			"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
		const charactersLength = characters.length;

		if (typeof window !== "undefined" && window.crypto?.getRandomValues) {
			const randomValues = new Uint32Array(length);
			window.crypto.getRandomValues(randomValues);
			return Array.from(
				randomValues,
				(value) => characters[value % charactersLength],
			).join("");
		}

		return Array.from({ length }, () => {
			const index = Math.floor(Math.random() * charactersLength);
			return characters[index];
		}).join("");
	}, []);

	const handleGenerateUsername = useCallback(() => {
		if (mode === "edit") return;
		const randomUsername = generateRandomString(8);
		setValue("username", randomUsername, {
			shouldDirty: true,
			shouldValidate: true,
		});
	}, [generateRandomString, mode, setValue]);

	const handleGeneratePassword = useCallback(() => {
		const randomPassword = generateRandomString(12);
		setValue("password", randomPassword, {
			shouldDirty: true,
			shouldValidate: true,
		});
	}, [generateRandomString, setValue]);
	const { errors, isSubmitting } = formState;
	const watchRole = watch("role");
	const _hideExtendedPermissions = watchRole === AdminRole.Standard;
	const permissionsValue = watch("permissions");
	const maxDataLimitValue = watch("maxDataLimitPerUserGb") ?? "";

	const resetPermissionsToRole = useCallback(() => {
		const role = watchRole ?? AdminRole.Standard;
		setValue("permissions", clonePermissions(role), { shouldDirty: true });
		setValue("maxDataLimitPerUserGb", "", { shouldDirty: true });
	}, [setValue, watchRole]);

	const handlePermissionsChange = useCallback(
		(next: AdminPermissions) => {
			setValue("permissions", next, { shouldDirty: true });
		},
		[setValue],
	);

	const handleMaxDataLimitChange = useCallback(
		(value: string) => {
			setValue("maxDataLimitPerUserGb", value, { shouldDirty: true });
		},
		[setValue],
	);

	useEffect(() => {
		register("maxDataLimitPerUserGb");
		register("permissions");
	}, [register]);

	useEffect(() => {
		if (isOpen) {
			const nextRole: AdminRole = admin?.role ?? AdminRole.Standard;
			const nextPermissions = admin
				? (JSON.parse(JSON.stringify(admin.permissions)) ??
					clonePermissions(nextRole))
				: clonePermissions(nextRole);
			reset({
				username: admin?.username ?? "",
				password: "",
				telegram_id:
					admin?.telegram_id !== undefined && admin?.telegram_id !== null
						? String(admin.telegram_id)
						: "",
				role: nextRole,
				permissions: nextPermissions,
				maxDataLimitPerUserGb: formatBytesToGbString(
					nextPermissions.users.max_data_limit_per_user,
				),
				data_limit:
					admin?.data_limit !== undefined && admin?.data_limit !== null
						? String(Math.floor(admin.data_limit / GB_IN_BYTES))
						: "",
				users_limit:
					admin?.users_limit !== undefined && admin?.users_limit !== null
						? String(admin.users_limit)
						: "",
			});
		}
	}, [admin, isOpen, reset]);

	useEffect(() => {
		if (!isOpen) {
			setPermissionsModalOpen(false);
		}
	}, [isOpen]);

	const handleFormSubmit = handleSubmit(async (values) => {
		const selectedRole: AdminRole = values.role ?? AdminRole.Standard;
		let permissionPayload: AdminPermissions | undefined;

		if (mode === "create") {
			const computedPermissions: AdminPermissions = JSON.parse(
				JSON.stringify(values.permissions ?? clonePermissions(selectedRole)),
			);
			const maxLimitInput = values.maxDataLimitPerUserGb?.trim();
			if (maxLimitInput) {
				const parsed = Number(maxLimitInput);
				if (Number.isNaN(parsed) || parsed < 0) {
					setError("maxDataLimitPerUserGb", {
						type: "manual",
						message: t(
							"admins.validation.invalidMaxDataLimit",
							"Enter a positive number or leave empty.",
						),
					});
					return;
				}
				computedPermissions.users.max_data_limit_per_user =
					parsed === 0 ? null : Math.round(parsed * GB_IN_BYTES);
			} else {
				computedPermissions.users.max_data_limit_per_user = null;
			}
			permissionPayload = computedPermissions;
		}

		if (mode === "edit" && admin) {
			const currentActive = admin.active_users ?? 0;
			if (values.users_limit) {
				const requestedLimit = Number(values.users_limit);
				if (
					!Number.isNaN(requestedLimit) &&
					requestedLimit > 0 &&
					requestedLimit < currentActive
				) {
					setError("users_limit", {
						type: "manual",
						message: t("admins.validation.usersLimitTooLow", {
							active: currentActive,
						}),
					});
					return;
				}
			}
		}
		try {
			if (mode === "create") {
				const payload: AdminCreatePayload = {
					username: values.username.trim(),
					password: values.password ?? "",
					role: selectedRole,
					permissions: permissionPayload ?? clonePermissions(selectedRole),
					telegram_id: values.telegram_id
						? Number(values.telegram_id)
						: undefined,
					data_limit: values.data_limit
						? Number(values.data_limit) * GB_IN_BYTES
						: undefined,
					users_limit: values.users_limit
						? Number(values.users_limit)
						: undefined,
				};
				await createAdmin(payload);
				generateSuccessMessage(
					t("admins.createSuccess", "Admin created"),
					toast,
				);
			} else if (admin) {
				const payload: AdminUpdatePayload = {
					role: selectedRole,
					telegram_id: values.telegram_id
						? Number(values.telegram_id)
						: undefined,
					data_limit: values.data_limit
						? Number(values.data_limit) * GB_IN_BYTES
						: undefined,
					users_limit: values.users_limit
						? Number(values.users_limit)
						: undefined,
				};
				if (values.password) {
					payload.password = values.password;
				}
				await updateAdmin(admin.username, payload);
				generateSuccessMessage(
					t("admins.updateSuccess", "Admin updated"),
					toast,
				);
			}
			closeAdminDialog();
		} catch (error) {
			generateErrorMessage(error, toast, form);
		}
	});

	const detailsForm = (
		<VStack spacing={4} align="stretch">
			{mode === "edit" && admin?.id !== undefined && (
				<FormControl>
					<FormLabel>{t("admins.idLabel", "Admin ID")}</FormLabel>
					<Input value={String(admin.id)} isReadOnly />
				</FormControl>
			)}
			{mode === "edit" && (
				<FormControl>
					<FormLabel>{t("admins.status", "Status")}</FormLabel>
					<Input value={statusLabel} isReadOnly />
				</FormControl>
			)}
			<FormControl isInvalid={!!errors.username}>
				<FormLabel>{t("username")}</FormLabel>
				<InputGroup>
					<Input
						placeholder={t("admins.usernamePlaceholder", "Admin username")}
						{...register("username")}
						isDisabled={mode === "edit"}
					/>
					{mode === "create" && (
						<InputRightElement>
							<IconButton
								aria-label={t("admins.generateUsername", "Random")}
								size="sm"
								variant="ghost"
								icon={<SparklesIcon width={20} />}
								onClick={handleGenerateUsername}
							/>
						</InputRightElement>
					)}
				</InputGroup>
				<FormErrorMessage>
					{errors.username?.message as string}
				</FormErrorMessage>
			</FormControl>
			<FormControl isInvalid={!!errors.password}>
				<FormLabel>{t("password")}</FormLabel>
				<HStack spacing={2}>
					<InputGroup>
						<Input
							placeholder={t("admins.passwordPlaceholder", "Password")}
							type={showPassword ? "text" : "password"}
							{...register("password")}
						/>
						<InputRightElement>
							<IconButton
								aria-label={
									showPassword
										? t("admins.hidePassword", "Hide")
										: t("admins.showPassword", "Show")
								}
								size="sm"
								variant="ghost"
								icon={
									showPassword ? (
										<EyeSlashIcon width={16} />
									) : (
										<EyeIcon width={16} />
									)
								}
								onClick={() => setShowPassword(!showPassword)}
							/>
						</InputRightElement>
					</InputGroup>
					<IconButton
						aria-label={t("admins.generatePassword", "Random")}
						size="md"
						variant="outline"
						icon={<SparklesIcon width={20} />}
						onClick={handleGeneratePassword}
					/>
				</HStack>
				<FormErrorMessage>
					{errors.password?.message as string}
				</FormErrorMessage>
				{mode === "edit" && (
					<Text fontSize="xs" color="gray.500" mt={1}>
						{t(
							"admins.passwordOptionalHint",
							"Leave empty to keep current password.",
						)}
					</Text>
				)}
			</FormControl>
			<FormControl>
				<FormLabel>{t("admins.roleLabel", "Admin role")}</FormLabel>
				<RadioGroup
					value={watchRole ?? AdminRole.Standard}
					onChange={(value) =>
						setValue("role", value as AdminRole, { shouldDirty: true })
					}
				>
					<VStack align="flex-start" spacing={2}>
						<Radio value={AdminRole.Standard}>
							<Text fontWeight="medium">
								{t("admins.roles.standard", "Standard")}
							</Text>
							<FormHelperText m={0}>
								{t(
									"admins.roles.standardDescription",
									"Can manage own users; only user-related permissions are available.",
								)}
							</FormHelperText>
						</Radio>
						<Radio value={AdminRole.Reseller}>
							<Text fontWeight="medium">
								{t("admins.roles.reseller", "Reseller")}
							</Text>
							<FormHelperText m={0}>
								{t(
									"admins.roles.resellerDescription",
									"Can create and manage their own admins.",
								)}
							</FormHelperText>
						</Radio>
						<Radio value={AdminRole.Sudo}>
							<Text fontWeight="medium">{t("admins.roles.sudo", "Sudo")}</Text>
							<FormHelperText m={0}>
								{t(
									"admins.roles.sudoDescription",
									"Extended access to settings and other admins.",
								)}
							</FormHelperText>
						</Radio>
						{canCreateFullAccess && (
							<Radio value={AdminRole.FullAccess}>
								<Text fontWeight="medium">
									{t("admins.roles.fullAccess", "Full access")}
								</Text>
								<FormHelperText m={0}>
									{t(
										"admins.roles.fullAccessDescription",
										"Complete control, including other sudo admins.",
									)}
								</FormHelperText>
							</Radio>
						)}
					</VStack>
				</RadioGroup>
			</FormControl>
			{mode === "edit" &&
				(admin?.role === AdminRole.FullAccess ? (
					<Text fontSize="sm" color="gray.500">
						{t("admins.permissions.fullAccessLocked")}
					</Text>
				) : (
					<Button
						alignSelf="flex-start"
						onClick={() => setPermissionsModalOpen(true)}
						variant="outline"
					>
						{t("admins.editPermissionsButton", "Edit permissions")}
					</Button>
				))}
			<FormControl isInvalid={!!errors.telegram_id}>
				<FormLabel>{t("admins.telegramId", "Telegram ID")}</FormLabel>
				<Input
					placeholder={t(
						"admins.telegramPlaceholder",
						"Optional numeric Telegram ID",
					)}
					inputMode="numeric"
					{...register("telegram_id")}
				/>
				<FormErrorMessage>
					{errors.telegram_id?.message as string}
				</FormErrorMessage>
			</FormControl>
			<SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
				<FormControl isInvalid={!!errors.data_limit}>
					<FormLabel>{t("admins.dataLimit", "Data Limit (GB)")}</FormLabel>
					<Input
						placeholder={t(
							"admins.dataLimitPlaceholder",
							"e.g., 100 for 100GB (empty = unlimited)",
						)}
						inputMode="numeric"
						{...register("data_limit")}
					/>
					<FormErrorMessage>
						{errors.data_limit?.message as string}
					</FormErrorMessage>
					<Text fontSize="xs" color="gray.500" mt={1}>
						{t("admins.dataLimitHint", "Leave empty for unlimited data")}
					</Text>
				</FormControl>
				<FormControl isInvalid={!!errors.users_limit}>
					<FormLabel>{t("admins.usersLimit", "Users Limit")}</FormLabel>
					<Input
						placeholder={t(
							"admins.usersLimitPlaceholder",
							"e.g., 100 (empty = unlimited)",
						)}
						inputMode="numeric"
						{...register("users_limit")}
					/>
					<FormErrorMessage>
						{errors.users_limit?.message as string}
					</FormErrorMessage>
					<Text fontSize="xs" color="gray.500" mt={1}>
						{t("admins.usersLimitHint", "Leave empty for unlimited users")}
					</Text>
				</FormControl>
			</SimpleGrid>
		</VStack>
	);

	return (
		<>
			<Modal isOpen={isOpen} onClose={closeAdminDialog} size="lg">
				<ModalOverlay />
				<ModalContent>
					<ModalHeader>
						{mode === "create"
							? t("admins.addAdminTitle", "Add admin")
							: t("admins.editAdminTitle", "Edit admin")}
					</ModalHeader>
					<ModalCloseButton />
					<ModalBody>
						{mode === "create" ? (
							<Tabs colorScheme="primary" isFitted variant="enclosed">
								<TabList>
									<Tab>{t("admins.detailsTabLabel", "Details")}</Tab>
									<Tab>{t("admins.permissionsTabLabel", "Permissions")}</Tab>
								</TabList>
								<TabPanels>
									<TabPanel px={0}>{detailsForm}</TabPanel>
									<TabPanel px={0}>
										<AdminPermissionsEditor
											value={
												permissionsValue ??
												clonePermissions(watchRole ?? AdminRole.Standard)
											}
											onChange={handlePermissionsChange}
											showReset
											onReset={resetPermissionsToRole}
											maxDataLimitValue={maxDataLimitValue}
											onMaxDataLimitChange={handleMaxDataLimitChange}
											maxDataLimitError={
												errors.maxDataLimitPerUserGb?.message as
													| string
													| undefined
											}
											hideExtendedSections={watchRole === AdminRole.Standard}
											isReadOnly={watchRole === AdminRole.FullAccess}
										/>
									</TabPanel>
								</TabPanels>
							</Tabs>
						) : (
							detailsForm
						)}
					</ModalBody>
					<ModalFooter>
						<HStack spacing={3}>
							<Button variant="ghost" onClick={closeAdminDialog}>
								{t("cancel")}
							</Button>
							<Button
								colorScheme="primary"
								onClick={handleFormSubmit}
								isLoading={isSubmitting}
							>
								{mode === "create"
									? t("admins.addAdmin", "Create")
									: t("save", "Save")}
							</Button>
						</HStack>
					</ModalFooter>
				</ModalContent>
			</Modal>
			<AdminPermissionsModal
				isOpen={permissionsModalOpen}
				onClose={() => setPermissionsModalOpen(false)}
				admin={admin}
			/>
		</>
	);
};
