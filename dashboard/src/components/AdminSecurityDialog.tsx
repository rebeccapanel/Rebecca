import { toneClass } from "lib/tone";
import { Button } from "components/ui/button";
import { Badge } from "components/ui/badge";
import { toast } from "components/ui/sonner";
import { cn } from "lib/cn";


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
	open: boolean;
	onClose: () => void;
	canManageSessions: boolean;
	canManage2FA: boolean;
	onChanged: () => void;
};

export const AdminSecurityDialog = ({
	admin,
	open: isOpen,
	onClose,
	canManageSessions,
	canManage2FA,
	onChanged,
}: Props) => {
	const { t } = useTranslation();
	
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
			open={isOpen}
			onClose={onClose}
			title={t("admins.security.title", { username: admin?.username ?? "" })}
			footer={<Button onClick={onClose}>{t("close")}</Button>}
		>
			<div className="flex flex-col gap-5">
				{canManage2FA && (
					<div>
						<div className="flex flex-row items-center gap-2 justify-between mb-3">
							<p className="font-semibold">
								{t("myaccount.twoFactor")}
							</p>
							<Badge className={toneClass(admin?.totp_enabled ? "green" : "gray")}>
								{admin?.totp_enabled
									? t("nodes.enabled")
									: t("disabled")}
							</Badge>
						</div>
						<Button onClick={admin?.totp_enabled ? remove2FA : enable2FA} variant={admin?.totp_enabled ? "destructive" : "default"} size="sm" loading={loading}>
							{admin?.totp_enabled
								? t("admins.security.remove2FA")
								: t("admins.security.setup2FA")}
						</Button>
						{setup && (
							<div className="flex flex-col items-center mt-4 gap-3">
								<div className="bg-white rounded-md p-3">
									<QRCodeCanvas value={setup.uri} size={190} />
								</div>
								<p className="font-mono text-[0.75rem] break-all">
									{setup.secret}
								</p>
								<p className="text-orange-500 text-[0.75rem]">
									{t("admins.security.shareSecret")}
								</p>
							</div>
						)}
					</div>
				)}
				{canManageSessions && (
					<div>
						<p className="font-semibold mb-3">
							{t("myaccount.sessions")}
						</p>
						<div className="flex flex-col gap-2">
							{sessions.map((session) => (
								<div key={session.id} className="flex flex-row items-center gap-2 border rounded-md justify-between p-3">
									<div className="min-w-0!">
										<p className="text-[0.875rem] font-semibold">
											{session.ip_address || "-"}
										</p>
										<p className="text-gray-500 text-[0.75rem] truncate">
											{session.user_agent || "-"}
										</p>
										<p className="text-gray-500 text-[0.75rem]">
											{dayjs(session.last_seen_at).format("YYYY-MM-DD HH:mm")}
										</p>
									</div>
									<Button onClick={() => revoke(session.id)} variant="ghost" size="xs" loading={loading} className="text-destructive hover:bg-destructive/10">
										{t("header.logout")}
									</Button>
								</div>
							))}
							{!sessions.length && (
								<p className="text-gray-500 text-[0.875rem]">
									{t("noData")}
								</p>
							)}
						</div>
					</div>
				)}
			</div>
		</AppDialog>
	);
};
