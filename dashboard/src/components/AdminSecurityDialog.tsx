import {
	Badge,
	Box,
	Button,
	HStack,
	Stack,
	Text,
	useToast,
} from "@chakra-ui/react";
import { AppDialog } from "components/dialogs/AppDialog";
import dayjs from "dayjs";
import { QRCodeCanvas } from "qrcode.react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	type AdminSessionView,
	disableAdmin2FA,
	listAdminSessions,
	revokeAdminSession,
	setupAdmin2FA,
	type TOTPSetup,
} from "service/auth";
import type { Admin } from "types/Admin";
import { generateErrorMessage } from "utils/toastHandler";

type Props = {
	admin: Admin | null;
	isOpen: boolean;
	onClose: () => void;
	canManageSessions: boolean;
	canManage2FA: boolean;
	onChanged: () => void;
};

export const AdminSecurityDialog = ({
	admin,
	isOpen,
	onClose,
	canManageSessions,
	canManage2FA,
	onChanged,
}: Props) => {
	const { t } = useTranslation();
	const toast = useToast();
	const [sessions, setSessions] = useState<AdminSessionView[]>([]);
	const [setup, setSetup] = useState<TOTPSetup | null>(null);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		if (!isOpen || !admin || !canManageSessions) return;
		listAdminSessions(admin.username)
			.then(setSessions)
			.catch((error) => generateErrorMessage(error, toast));
	}, [admin, canManageSessions, isOpen, toast]);

	const revoke = async (id: number) => {
		if (!admin) return;
		setLoading(true);
		try {
			await revokeAdminSession(admin.username, id);
			setSessions((current) => current.filter((session) => session.id !== id));
		} catch (error) {
			generateErrorMessage(error, toast);
		} finally {
			setLoading(false);
		}
	};

	const enable2FA = async () => {
		if (!admin) return;
		setLoading(true);
		try {
			setSetup(await setupAdmin2FA(admin.username));
			setSessions([]);
			onChanged();
		} catch (error) {
			generateErrorMessage(error, toast);
		} finally {
			setLoading(false);
		}
	};

	const remove2FA = async () => {
		if (!admin) return;
		setLoading(true);
		try {
			await disableAdmin2FA(admin.username);
			setSessions([]);
			setSetup(null);
			onChanged();
		} catch (error) {
			generateErrorMessage(error, toast);
		} finally {
			setLoading(false);
		}
	};

	return (
		<AppDialog
			isOpen={isOpen}
			onClose={onClose}
			title={t("admins.security.title", {
				defaultValue: "Security for {{username}}",
				username: admin?.username ?? "",
			})}
			footer={<Button onClick={onClose}>{t("close", "Close")}</Button>}
		>
			<Stack spacing={5}>
				{canManage2FA && (
					<Box>
						<HStack justify="space-between" mb={3}>
							<Text fontWeight="semibold">
								{t("myaccount.twoFactor", "Two-factor authentication")}
							</Text>
							<Badge colorScheme={admin?.totp_enabled ? "green" : "gray"}>
								{admin?.totp_enabled
									? t("enabled", "Enabled")
									: t("disabled", "Disabled")}
							</Badge>
						</HStack>
						<Button
							colorScheme={admin?.totp_enabled ? "red" : "primary"}
							isLoading={loading}
							onClick={admin?.totp_enabled ? remove2FA : enable2FA}
							size="sm"
						>
							{admin?.totp_enabled
								? t("admins.security.remove2FA", "Remove 2FA")
								: t("admins.security.setup2FA", "Set up 2FA")}
						</Button>
						{setup && (
							<Stack align="center" mt={4} spacing={3}>
								<Box bg="white" borderRadius="md" p={3}>
									<QRCodeCanvas value={setup.uri} size={190} />
								</Box>
								<Text fontFamily="mono" fontSize="xs" wordBreak="break-all">
									{setup.secret}
								</Text>
								<Text color="orange.500" fontSize="xs">
									{t(
										"admins.security.shareSecret",
										"This secret is shown once. Give it to the admin securely.",
									)}
								</Text>
							</Stack>
						)}
					</Box>
				)}
				{canManageSessions && (
					<Box>
						<Text fontWeight="semibold" mb={3}>
							{t("myaccount.sessions", "Login sessions")}
						</Text>
						<Stack spacing={2}>
							{sessions.map((session) => (
								<HStack
									key={session.id}
									borderWidth="1px"
									borderRadius="md"
									justify="space-between"
									p={3}
								>
									<Box minW={0}>
										<Text fontSize="sm" fontWeight="semibold">
											{session.ip_address || "-"}
										</Text>
										<Text color="gray.500" fontSize="xs" noOfLines={1}>
											{session.user_agent || "-"}
										</Text>
										<Text color="gray.500" fontSize="xs">
											{dayjs(session.last_seen_at).format("YYYY-MM-DD HH:mm")}
										</Text>
									</Box>
									<Button
										colorScheme="red"
										isLoading={loading}
										onClick={() => revoke(session.id)}
										size="xs"
										variant="ghost"
									>
										{t("logout", "Log out")}
									</Button>
								</HStack>
							))}
							{!sessions.length && (
								<Text color="gray.500" fontSize="sm">
									{t("noData", "No data")}
								</Text>
							)}
						</Stack>
					</Box>
				)}
			</Stack>
		</AppDialog>
	);
};
