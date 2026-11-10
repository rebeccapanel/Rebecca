import { Button } from "components/ui/button";
import { toast } from "components/ui/sonner";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	currentPermission,
	disablePush,
	enablePush,
	getBrowserSubscription,
	isIosDevice,
	isStandalone,
	pushSupported,
	syncPushSubscription,
} from "service/pushNotifications";
import {
	clearInstallPrompt,
	getInstallPrompt,
	subscribeInstallPrompt,
} from "utils/dashboardBase";

export const BrowserNotificationsCard = () => {
	const { t } = useTranslation();
	const [permission, setPermission] = useState(currentPermission());
	const [subscribed, setSubscribed] = useState(false);
	const [busy, setBusy] = useState(false);
	const [installable, setInstallable] = useState(Boolean(getInstallPrompt()));

	useEffect(() => subscribeInstallPrompt(() => setInstallable(Boolean(getInstallPrompt()))), []);

	const refresh = useCallback(async () => {
		setPermission(currentPermission());
		if (!pushSupported()) return;
		try {
			if (Notification.permission === "granted") await syncPushSubscription();
			setSubscribed(Boolean(await getBrowserSubscription()));
		} catch {
			setSubscribed(false);
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const toggle = async () => {
		setBusy(true);
		try {
			if (subscribed) {
				await disablePush();
			} else {
				await enablePush();
			}
		} catch {
			toast.error(t("notifications.push.failed"));
		} finally {
			await refresh();
			setBusy(false);
		}
	};

	const install = async () => {
		const prompt = getInstallPrompt();
		if (!prompt) return;
		await prompt.prompt();
		clearInstallPrompt();
	};

	const supported = pushSupported();
	const needsInstall = !supported && isIosDevice() && !isStandalone();
	let status = t("notifications.push.description");
	if (!supported) {
		status = needsInstall ? t("notifications.push.iosInstall") : t("notifications.push.unsupported");
	} else if (permission === "denied") {
		status = t("notifications.push.denied");
	} else if (subscribed) {
		status = t("notifications.push.enabled");
	}

	return (
		<div className="p-4 rounded-md border flex flex-col gap-3" data-testid="browser-notifications">
			<div className="flex flex-row items-center gap-2 justify-between flex-wrap">
				<p className="font-semibold">{t("notifications.push.title")}</p>
				<div className="flex flex-row items-center gap-2">
					{installable && !isStandalone() && (
						<Button variant="outline" size="sm" onClick={install}>
							{t("notifications.push.install")}
						</Button>
					)}
					{supported && permission !== "denied" && (
						<Button size="sm" variant={subscribed ? "outline" : "default"} loading={busy} onClick={toggle}>
							{subscribed ? t("notifications.push.disable") : t("notifications.push.enable")}
						</Button>
					)}
				</div>
			</div>
			<p className="text-[0.875rem] text-gray-500">{status}</p>
		</div>
	);
};
