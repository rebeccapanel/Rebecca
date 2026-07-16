import {
	Badge,
	Box,
	Button,
	HStack,
	Input,
	SimpleGrid,
	Stack,
	Text,
	useDisclosure,
	useToast,
} from "@chakra-ui/react";
import { ChartBox } from "components/common/ChartBox";
import { AppDialog } from "components/dialogs/AppDialog";
import dayjs from "dayjs";
import { QRCodeCanvas } from "qrcode.react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "react-query";
import {
	confirm2FASetup,
	disable2FA,
	listSessions,
	revokeSession,
	start2FASetup,
	type TOTPSetup,
} from "service/auth";
import { clearClientSession } from "utils/session";
import { generateErrorMessage } from "utils/toastHandler";

type Props = {
	totpEnabled: boolean;
	canManageSessions: boolean;
	canManage2FA: boolean;
};

export const AccountSecurity = ({
	totpEnabled,
	canManageSessions,
	canManage2FA,
}: Props) => {
	const { t } = useTranslation();
	const toast = useToast();
	const queryClient = useQueryClient();
	const setupDialog = useDisclosure();
	const disableDialog = useDisclosure();
	const [setup, setSetup] = useState<TOTPSetup | null>(null);
	const [code, setCode] = useState("");
	const [password, setPassword] = useState("");
	const [twoFactorLoading, setTwoFactorLoading] = useState(false);
	const sessions = useQuery(["admin-sessions"], listSessions, {
		enabled: canManageSessions,
	});
	const revoke = useMutation(revokeSession, {
		onSuccess: (_, id) => {
			const current = sessions.data?.find(
				(session) => session.id === id,
			)?.current;
			if (current) {
				clearClientSession();
				window.location.reload();
				return;
			}
			sessions.refetch();
		},
	});

	const beginSetup = async () => {
		setTwoFactorLoading(true);
		try {
			setCode("");
			setSetup(await start2FASetup());
			setupDialog.onOpen();
		} catch (error) {
			generateErrorMessage(error, toast);
		} finally {
			setTwoFactorLoading(false);
		}
	};

	const confirmSetup = async () => {
		setTwoFactorLoading(true);
		try {
			await confirm2FASetup(code);
			setupDialog.onClose();
			setSetup(null);
			setCode("");
			queryClient.invalidateQueries("current-admin");
			toast({
				title: t(
					"myaccount.twoFactorEnabled",
					"Two-factor authentication enabled",
				),
				status: "success",
			});
		} catch (error) {
			generateErrorMessage(error, toast);
		} finally {
			setTwoFactorLoading(false);
		}
	};

	const confirmDisable = async () => {
		setTwoFactorLoading(true);
		try {
			const session = await disable2FA(password, code);
			disableDialog.onClose();
			setPassword("");
			setCode("");
			if (session.state === "setup_required") {
				clearClientSession();
				window.location.reload();
				return;
			}
			queryClient.invalidateQueries("current-admin");
			toast({
				title: t(
					"myaccount.twoFactorDisabled",
					"Two-factor authentication disabled",
				),
				status: "success",
			});
		} catch (error) {
			generateErrorMessage(error, toast);
		} finally {
			setTwoFactorLoading(false);
		}
	};

	return (
		<SimpleGrid columns={{ base: 1, xl: 2 }} spacing={4}>
			{canManage2FA && (
				<ChartBox title={t("myaccount.twoFactor", "Two-factor authentication")}>
					<Stack spacing={4}>
						<HStack justify="space-between">
							<Text>{t("myaccount.twoFactorStatus", "Status")}</Text>
							<Badge colorScheme={totpEnabled ? "green" : "gray"}>
								{totpEnabled
									? t("enabled", "Enabled")
									: t("disabled", "Disabled")}
							</Badge>
						</HStack>
						<Button
							colorScheme="primary"
							isLoading={twoFactorLoading}
							onClick={totpEnabled ? disableDialog.onOpen : beginSetup}
						>
							{totpEnabled
								? t("myaccount.disableTwoFactor", "Disable 2FA")
								: t("myaccount.enableTwoFactor", "Enable 2FA")}
						</Button>
					</Stack>
				</ChartBox>
			)}
			{canManageSessions && (
				<ChartBox title={t("myaccount.sessions", "Login sessions")}>
					<Stack spacing={3}>
						{sessions.data?.map((session) => (
							<Box key={session.id} borderWidth="1px" borderRadius="md" p={3}>
								<HStack justify="space-between" align="start">
									<Box minW={0}>
										<HStack>
											<Text fontWeight="semibold">
												{session.ip_address || "-"}
											</Text>
											{session.current && (
												<Badge colorScheme="green">
													{t("current", "Current")}
												</Badge>
											)}
										</HStack>
										<Text color="gray.500" fontSize="xs" noOfLines={2}>
											{session.user_agent ||
												t("unknownDevice", "Unknown device")}
										</Text>
										<Text color="gray.500" fontSize="xs">
											{dayjs(session.last_seen_at).format("YYYY-MM-DD HH:mm")}
										</Text>
									</Box>
									<Button
										colorScheme="red"
										isLoading={
											revoke.isLoading && revoke.variables === session.id
										}
										onClick={() => revoke.mutate(session.id)}
										size="sm"
										variant="ghost"
									>
										{t("logout", "Log out")}
									</Button>
								</HStack>
							</Box>
						))}
						{!sessions.isLoading && !sessions.data?.length && (
							<Text color="gray.500">{t("noData", "No data")}</Text>
						)}
					</Stack>
				</ChartBox>
			)}

			<AppDialog
				isOpen={setupDialog.isOpen}
				onClose={setupDialog.onClose}
				title={t("myaccount.enableTwoFactor", "Enable 2FA")}
				footer={
					<Button
						colorScheme="primary"
						isDisabled={code.length !== 6}
						isLoading={twoFactorLoading}
						onClick={confirmSetup}
					>
						{t("confirm", "Confirm")}
					</Button>
				}
			>
				<Stack align="center" spacing={4}>
					{setup && (
						<Box bg="white" p={3} borderRadius="md">
							<QRCodeCanvas value={setup.uri} size={200} />
						</Box>
					)}
					<Text fontFamily="mono" fontSize="xs" wordBreak="break-all">
						{setup?.secret}
					</Text>
					<Input
						autoComplete="one-time-code"
						inputMode="numeric"
						maxLength={6}
						textAlign="center"
						value={code}
						onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
					/>
				</Stack>
			</AppDialog>

			<AppDialog
				isOpen={disableDialog.isOpen}
				onClose={disableDialog.onClose}
				title={t("myaccount.disableTwoFactor", "Disable 2FA")}
				footer={
					<Button
						colorScheme="red"
						isDisabled={!password || code.length !== 6}
						isLoading={twoFactorLoading}
						onClick={confirmDisable}
					>
						{t("disable", "Disable")}
					</Button>
				}
			>
				<Stack spacing={3}>
					<Input
						type="password"
						placeholder={t("myaccount.currentPassword", "Current password")}
						value={password}
						onChange={(event) => setPassword(event.target.value)}
					/>
					<Input
						autoComplete="one-time-code"
						inputMode="numeric"
						maxLength={6}
						placeholder={t("login.authenticationCode", "Authentication code")}
						value={code}
						onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
					/>
				</Stack>
			</AppDialog>
		</SimpleGrid>
	);
};
