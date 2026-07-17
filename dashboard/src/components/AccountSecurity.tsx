import {
	Badge,
	Box,
	Button,
	Flex,
	HStack,
	Icon,
	Input,
	Spinner,
	Stack,
	StackDivider,
	Text,
	useDisclosure,
	useToast,
} from "@chakra-ui/react";
import {
	ArrowRightStartOnRectangleIcon,
	KeyIcon,
	ShieldCheckIcon,
} from "@heroicons/react/24/outline";
import { ChartBox } from "components/common/ChartBox";
import { AppDialog } from "components/dialogs/AppDialog";
import dayjs from "dayjs";
import { QRCodeCanvas } from "qrcode.react";
import { type ElementType, useState } from "react";
import { useTranslation } from "react-i18next";
import type { IconType } from "react-icons";
import {
	FaAndroid,
	FaApple,
	FaChrome,
	FaEdge,
	FaFirefoxBrowser,
	FaLinux,
	FaSafari,
	FaWindows,
} from "react-icons/fa";
import { FiGlobe, FiMonitor, FiSmartphone, FiTablet } from "react-icons/fi";
import { SiOpera, SiSamsung } from "react-icons/si";
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
	canChangePassword: boolean;
	canManageSessions: boolean;
	canManage2FA: boolean;
	onChangePassword: () => void;
};

type AgentDetail = {
	name: string;
	version?: string;
	icon: IconType;
	color: string;
};

type SessionClient = {
	browser: AgentDetail;
	os: AgentDetail;
	device: "desktop" | "mobile" | "tablet";
	deviceIcon: IconType;
};

const iconAs = (icon: IconType) => icon as unknown as ElementType;

const versionFrom = (userAgent: string, pattern: RegExp) => {
	const match = userAgent.match(pattern);
	return match?.[1]?.replace(/_/g, ".");
};

const parseSessionClient = (userAgent = ""): SessionClient => {
	const ua = userAgent.trim();
	let os: AgentDetail = {
		name: "Unknown OS",
		icon: FiMonitor,
		color: "gray.400",
	};
	if (/windows/i.test(ua)) {
		os = { name: "Windows", icon: FaWindows, color: "#0078D4" };
	} else if (/iphone|ipad|ipod/i.test(ua)) {
		os = {
			name: /ipad/i.test(ua) ? "iPadOS" : "iOS",
			icon: FaApple,
			color: "panel.text",
		};
	} else if (/android/i.test(ua)) {
		os = {
			name: "Android",
			icon: FaAndroid,
			color: "#3DDC84",
		};
	} else if (/macintosh|mac os x/i.test(ua)) {
		os = {
			name: "macOS",
			icon: FaApple,
			color: "panel.text",
		};
	} else if (/linux/i.test(ua)) {
		os = { name: "Linux", icon: FaLinux, color: "#FCC624" };
	}

	let browser: AgentDetail = {
		name: "Unknown browser",
		icon: FiGlobe,
		color: "gray.400",
	};
	if (/Edg(?:A|iOS)?\//i.test(ua) || /\bEdge\b/i.test(ua)) {
		browser = {
			name: "Microsoft Edge",
			version: versionFrom(ua, /Edg(?:A|iOS)?\/([\d.]+)/i),
			icon: FaEdge,
			color: "#0AA7B5",
		};
	} else if (/OPR\//i.test(ua) || /\bOpera\b/i.test(ua)) {
		browser = {
			name: "Opera",
			version: versionFrom(ua, /OPR\/([\d.]+)/i),
			icon: SiOpera,
			color: "#FF1B2D",
		};
	} else if (/SamsungBrowser\//i.test(ua)) {
		browser = {
			name: "Samsung Internet",
			version: versionFrom(ua, /SamsungBrowser\/([\d.]+)/i),
			icon: SiSamsung,
			color: "#1428A0",
		};
	} else if (/Firefox\//i.test(ua) || /FxiOS\//i.test(ua)) {
		browser = {
			name: "Firefox",
			version: versionFrom(ua, /(?:Firefox|FxiOS)\/([\d.]+)/i),
			icon: FaFirefoxBrowser,
			color: "#FF7139",
		};
	} else if (
		/Chrome\//i.test(ua) ||
		/CriOS\//i.test(ua) ||
		/\bChrome\b/i.test(ua)
	) {
		browser = {
			name: "Google Chrome",
			version: versionFrom(ua, /(?:Chrome|CriOS)\/([\d.]+)/i),
			icon: FaChrome,
			color: "#4285F4",
		};
	} else if (/Safari\//i.test(ua) || /\bSafari\b/i.test(ua)) {
		browser = {
			name: "Safari",
			version: versionFrom(ua, /Version\/([\d.]+)/i),
			icon: FaSafari,
			color: "#0FB5EE",
		};
	}

	if (/ipad|tablet/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua))) {
		return { browser, os, device: "tablet", deviceIcon: FiTablet };
	}
	if (/iphone|ipod|android|mobile/i.test(ua)) {
		return { browser, os, device: "mobile", deviceIcon: FiSmartphone };
	}
	return { browser, os, device: "desktop", deviceIcon: FiMonitor };
};

export const AccountSecurity = ({
	totpEnabled,
	canChangePassword,
	canManageSessions,
	canManage2FA,
	onChangePassword,
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
		<Stack spacing={4} w="full" maxW="960px" mx="auto">
			{(canChangePassword || canManage2FA) && (
				<ChartBox title={t("myaccount.securityControls", "Sign-in security")}>
					<Stack
						spacing={0}
						divider={<StackDivider borderColor="panel.border" />}
					>
						{canChangePassword && (
							<Flex
								align={{ base: "stretch", sm: "center" }}
								justify="space-between"
								direction={{ base: "column", sm: "row" }}
								gap={3}
								py={2}
							>
								<HStack minW={0} spacing={3} align="start">
									<Flex
										align="center"
										justify="center"
										w="9"
										h="9"
										flexShrink={0}
										borderRadius="6px"
										bg="panel.elevated"
										color="panel.accent"
										aria-hidden="true"
									>
										<KeyIcon width={18} />
									</Flex>
									<Box minW={0}>
										<Text fontWeight="semibold" fontSize="sm">
											{t("myaccount.changePasswordCard", "Change password")}
										</Text>
										<Text color="panel.textSecondary" fontSize="xs" mt={0.5}>
											{t("myaccount.changePasswordHint")}
										</Text>
									</Box>
								</HStack>
								<Button
									size="sm"
									h="10"
									variant="outline"
									onClick={onChangePassword}
									alignSelf={{ base: "flex-end", sm: "center" }}
								>
									{t("myaccount.changePassword", "Change")}
								</Button>
							</Flex>
						)}

						{canManage2FA && (
							<Flex
								align={{ base: "stretch", sm: "center" }}
								justify="space-between"
								direction={{ base: "column", sm: "row" }}
								gap={3}
								py={2}
							>
								<HStack minW={0} spacing={3} align="start">
									<Flex
										align="center"
										justify="center"
										w="9"
										h="9"
										flexShrink={0}
										borderRadius="6px"
										bg="panel.elevated"
										color={totpEnabled ? "green.400" : "panel.textMuted"}
										aria-hidden="true"
									>
										<ShieldCheckIcon width={18} />
									</Flex>
									<Box minW={0}>
										<HStack spacing={2} flexWrap="wrap">
											<Text fontWeight="semibold" fontSize="sm">
												{t("myaccount.twoFactor", "Two-factor authentication")}
											</Text>
											<Badge colorScheme={totpEnabled ? "green" : "gray"}>
												{totpEnabled
													? t("enabled", "Enabled")
													: t("disabled", "Disabled")}
											</Badge>
										</HStack>
										<Text color="panel.textSecondary" fontSize="xs" mt={0.5}>
											{totpEnabled
												? t("myaccount.twoFactorEnabledHint")
												: t("myaccount.twoFactorDisabledHint")}
										</Text>
									</Box>
								</HStack>
								<Button
									size="sm"
									h="10"
									minW={{ sm: "112px" }}
									variant="outline"
									colorScheme={totpEnabled ? "red" : "primary"}
									isLoading={twoFactorLoading}
									onClick={totpEnabled ? disableDialog.onOpen : beginSetup}
									alignSelf={{ base: "flex-end", sm: "center" }}
								>
									{totpEnabled
										? t("myaccount.disableTwoFactor", "Disable 2FA")
										: t("myaccount.enableTwoFactor", "Enable 2FA")}
								</Button>
							</Flex>
						)}
					</Stack>
				</ChartBox>
			)}
			{canManageSessions && (
				<ChartBox title={t("myaccount.sessions", "Login sessions")}>
					<Stack spacing={3}>
						{sessions.isLoading && (
							<Flex justify="center" py={6}>
								<Spinner size="sm" />
							</Flex>
						)}
						{sessions.data?.map((session) => {
							const client = parseSessionClient(session.user_agent);
							const browserLabel = client.browser.version
								? `${client.browser.name} ${client.browser.version}`
								: client.browser.name;
							const osLabel = client.os.version
								? `${client.os.name} ${client.os.version}`
								: client.os.name;
							return (
								<Box
									as="article"
									key={session.id}
									borderWidth="1px"
									borderColor="panel.border"
									borderRadius="6px"
									p={3}
								>
									<Flex
										justify="space-between"
										align={{ base: "stretch", sm: "center" }}
										gap={3}
										direction={{ base: "column", sm: "row" }}
									>
										<HStack minW={0} spacing={3} align="start">
											<Flex
												align="center"
												justify="center"
												w="10"
												h="10"
												flexShrink={0}
												borderRadius="6px"
												bg="panel.elevated"
												color={client.os.color}
												aria-hidden="true"
											>
												<Icon as={iconAs(client.os.icon)} boxSize={5} />
											</Flex>
											<Box minW={0}>
												<HStack spacing={2} flexWrap="wrap">
													<Icon
														as={iconAs(client.browser.icon)}
														boxSize={4}
														color={client.browser.color}
														aria-hidden="true"
													/>
													<Text fontWeight="700" fontSize="md">
														{browserLabel}
													</Text>
													{session.current && (
														<Badge colorScheme="green">
															{t("current", "Current")}
														</Badge>
													)}
												</HStack>
												<HStack
													spacing={1.5}
													color="panel.textSecondary"
													fontSize="sm"
													flexWrap="wrap"
												>
													<Icon
														as={iconAs(client.deviceIcon)}
														aria-hidden="true"
													/>
													<Text>{osLabel}</Text>
													<Text aria-hidden="true">·</Text>
													<Text>
														{t(
															`myaccount.device.${client.device}`,
															client.device,
														)}
													</Text>
												</HStack>
												<Text color="panel.textMuted" fontSize="xs" mt={1}>
													{session.ip_address || "-"} ·{" "}
													{t("myaccount.lastSeen", "Last seen")}{" "}
													{dayjs(session.last_seen_at).format(
														"YYYY-MM-DD HH:mm",
													)}
												</Text>
											</Box>
										</HStack>
										<Button
											colorScheme="red"
											isLoading={
												revoke.isLoading && revoke.variables === session.id
											}
											onClick={() => revoke.mutate(session.id)}
											size="sm"
											variant="ghost"
											leftIcon={<ArrowRightStartOnRectangleIcon width={16} />}
											alignSelf={{ base: "flex-end", sm: "center" }}
											aria-label={`${t("logout", "Log out")} ${browserLabel}`}
										>
											{t("logout", "Log out")}
										</Button>
									</Flex>
								</Box>
							);
						})}
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
		</Stack>
	);
};
