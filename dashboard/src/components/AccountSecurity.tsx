import { toneClass } from "lib/tone";
import { createElement } from "react";
import { Button } from "components/ui/button";
import { Badge } from "components/ui/badge";
import { Spinner } from "components/ui/spinner";
import { Input } from "components/ui/input";
import { toast } from "components/ui/sonner";
import { LogIn, Key, ShieldCheck } from "lucide-react";

import { useDisclosure } from "hooks/useDisclosure";

import { cn } from "lib/cn";
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
		color: "var(--color-gray-400)",
	};
	if (/windows/i.test(ua)) {
		os = { name: "Windows", icon: FaWindows, color: "#0078D4" };
	} else if (/iphone|ipad|ipod/i.test(ua)) {
		os = {
			name: /ipad/i.test(ua) ? "iPadOS" : "iOS",
			icon: FaApple,
			color: "var(--rb-panel-text)",
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
			color: "var(--rb-panel-text)",
		};
	} else if (/linux/i.test(ua)) {
		os = { name: "Linux", icon: FaLinux, color: "#FCC624" };
	}

	let browser: AgentDetail = {
		name: "Unknown browser",
		icon: FiGlobe,
		color: "var(--color-gray-400)",
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
	
	const queryClient = useQueryClient();
	const setupDialog = useDisclosure();
	const disableDialog = useDisclosure();
	const [setup, setSetup] = useState<TOTPSetup | null>(null);
	const [code, setCode] = useState("");
	const [password, setPassword] = useState("");
	const [twoFactorLoading, setTwoFactorLoading] = useState(false);
	const sessions = useQuery({ queryKey: ["admin-sessions"], queryFn: listSessions, enabled: canManageSessions, });
	const revoke = useMutation({ mutationFn: revokeSession, onSuccess: (_, id) => {
			const current = sessions.data?.find(
				(session) => session.id === id,
			)?.current;
			if (current) {
				clearClientSession();
				window.location.reload();
				return;
			}
			sessions.refetch();
		}, });

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
			queryClient.invalidateQueries({ queryKey: ["current-admin"] });
			toast.success(t("myaccount.twoFactorEnabled"));
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
			queryClient.invalidateQueries({ queryKey: ["current-admin"] });
			toast.success(t("myaccount.twoFactorDisabled"));
		} catch (error) {
			generateErrorMessage(error, toast);
		} finally {
			setTwoFactorLoading(false);
		}
	};

	return (
		<div className="flex flex-col gap-4 w-full max-w-[960px] mx-auto">
			{(canChangePassword || canManage2FA) && (
				<ChartBox title={t("myaccount.securityControls")}>
					<div className="flex flex-col gap-0 divide-y divide-panel-border">
						{canChangePassword && (
							<div className="flex-col sm:flex-row flex items-stretch sm:items-center justify-between gap-3 py-2">
								<div className="flex flex-row min-w-0! gap-3 items-start">
									<div aria-hidden="true" className="flex items-center justify-center w-9 h-9 shrink-0 rounded-[6px] bg-panel-elevated text-panel-accent">
										<Key className="w-[18px]" />
									</div>
									<div className="min-w-0!">
										<p className="font-semibold text-[0.875rem]">
											{t("myaccount.changePasswordCard")}
										</p>
										<p className="text-panel-text-secondary text-[0.75rem] mt-0.5">
											{t("myaccount.changePasswordHint")}
										</p>
									</div>
								</div>
								<Button onClick={onChangePassword} variant="outline" size="sm" className="h-10 self-end sm:self-center">
									{t("myaccount.changePassword")}
								</Button>
							</div>
						)}

						{canManage2FA && (
							<div className="flex-col sm:flex-row flex items-stretch sm:items-center justify-between gap-3 py-2">
								<div className="flex flex-row min-w-0! gap-3 items-start">
									<div aria-hidden="true" className={cn("flex items-center justify-center w-9 h-9 shrink-0 rounded-[6px] bg-panel-elevated", totpEnabled ? "text-green-400" : "text-panel-text-muted")}>
										<ShieldCheck className="w-[18px]" />
									</div>
									<div className="min-w-0!">
										<div className="flex flex-row items-center gap-2 flex-wrap">
											<p className="font-semibold text-[0.875rem]">
												{t("myaccount.twoFactor")}
											</p>
											<Badge className={toneClass(totpEnabled ? "green" : "gray")}>
												{totpEnabled
													? t("nodes.enabled")
													: t("disabled")}
											</Badge>
										</div>
										<p className="text-panel-text-secondary text-[0.75rem] mt-0.5">
											{totpEnabled
												? t("myaccount.twoFactorEnabledHint")
												: t("myaccount.twoFactorDisabledHint")}
										</p>
									</div>
								</div>
								<Button onClick={totpEnabled ? disableDialog.onOpen : beginSetup} variant={totpEnabled ? "destructive" : "default"} size="sm" loading={twoFactorLoading} className="h-10 sm:min-w-[112px]! self-end sm:self-center">
									{totpEnabled
										? t("myaccount.disableTwoFactor")
										: t("myaccount.enableTwoFactor")}
								</Button>
							</div>
						)}
					</div>
				</ChartBox>
			)}
			{canManageSessions && (
				<ChartBox title={t("myaccount.sessions")}>
					<div className="flex flex-col gap-3">
						{sessions.isLoading && (
							<div className="flex justify-center py-6">
								<Spinner />
							</div>
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
								<article key={session.id} className="border border-panel-border! rounded-[6px] p-3">
									<div className="flex-col sm:flex-row flex justify-between items-stretch sm:items-center gap-3">
										<div className="flex flex-row min-w-0! gap-3 items-start">
											<div style={{ color: client.os.color }} aria-hidden="true" className="flex items-center justify-center w-10 h-10 shrink-0 rounded-[6px] bg-panel-elevated">
												{createElement(iconAs(client.os.icon), { className: "size-5" })}
											</div>
											<div className="min-w-0!">
												<div className="flex flex-row items-center gap-2 flex-wrap">
													{createElement(iconAs(client.browser.icon), { style: { color: client.browser.color }, "aria-hidden": "true", className: "size-4" })}
													<p className="font-bold text-[1rem]">
														{browserLabel}
													</p>
													{session.current && (
														<Badge className="bg-green-600 text-white">
															{t("current")}
														</Badge>
													)}
												</div>
												<div className="flex flex-row items-center gap-1.5 text-panel-text-secondary text-[0.875rem] flex-wrap">
													{createElement(iconAs(client.deviceIcon), { "aria-hidden": "true" })}
													<p>{osLabel}</p>
													<p aria-hidden="true">·</p>
													<p>
														{t(
															`myaccount.device.${client.device}`,
															client.device,
														)}
													</p>
												</div>
												<p className="text-panel-text-muted text-[0.75rem] mt-1">
													{session.ip_address || "-"} ·{" "}
													{t("myaccount.lastSeen")}{" "}
													{dayjs(session.last_seen_at).format(
														"YYYY-MM-DD HH:mm",
													)}
												</p>
											</div>
										</div>
										<Button onClick={() => revoke.mutate(session.id)} aria-label={`${t("header.logout")} ${browserLabel}`} variant="ghost" size="sm" loading={
												revoke.isPending && revoke.variables === session.id
											} className={cn("text-destructive hover:bg-destructive/10", "self-end sm:self-center")}>{<LogIn className="w-[16px]" />}
											{t("header.logout")}
										</Button>
									</div>
								</article>
							);
						})}
						{!sessions.isLoading && !sessions.data?.length && (
							<p className="text-gray-500">{t("noData")}</p>
						)}
					</div>
				</ChartBox>
			)}

			<AppDialog
				open={setupDialog.isOpen}
				onClose={setupDialog.onClose}
				title={t("myaccount.enableTwoFactor")}
				footer={
					<Button disabled={code.length !== 6} onClick={confirmSetup} loading={twoFactorLoading}>
						{t("confirm")}
					</Button>
				}
			>
				<div className="flex flex-col items-center gap-4">
					{setup && (
						<div className="bg-white p-3 rounded-md">
							<QRCodeCanvas value={setup.uri} size={200} />
						</div>
					)}
					<p className="font-mono text-[0.75rem] break-all">
						{setup?.secret}
					</p>
					<Input autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} className="text-center" />
				</div>
			</AppDialog>

			<AppDialog
				open={disableDialog.isOpen}
				onClose={disableDialog.onClose}
				title={t("myaccount.disableTwoFactor")}
				footer={
					<Button disabled={!password || code.length !== 6} onClick={confirmDisable} variant="destructive" loading={twoFactorLoading}>
						{t("phpmyadmin.disableAction")}
					</Button>
				}
			>
				<div className="flex flex-col gap-3">
					<Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
					<Input autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} />
				</div>
			</AppDialog>
		</div>
	);
};
