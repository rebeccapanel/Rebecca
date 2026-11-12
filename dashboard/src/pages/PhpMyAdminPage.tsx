import { PageLoadingSkeleton } from "components/ui";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { useColorMode } from "lib/color-mode";

import { cn } from "lib/cn";
import useGetUser from "hooks/useGetUser";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
	getPHPMyAdminEmbedHTML,
	getPHPMyAdminStatus,
	type PHPMyAdminStatus,
} from "service/settings";
import { AdminRole } from "types/Admin";

const defaultStatus: PHPMyAdminStatus = {
	enabled: false,
	supported: false,
	database: "",
	port: 8080,
	path: "/phpmyadmin/",
	public_url: "",
	external_url: "",
	embed_url: "/api/settings/phpmyadmin/embed-html",
	login_mode: "rebecca",
};

export const PhpMyAdminPage = () => {
	const { t } = useTranslation();
	const { colorMode } = useColorMode();
	const { userData } = useGetUser();
	const isFullAccess = userData.role === AdminRole.FullAccess;
	const [preparedTheme, setPreparedTheme] = useState<string | null>(null);
	const panelBg = "bg-panel-elevated";
	const borderColor = "border-panel-border!";
	const mutedColor = "text-panel-text-secondary";
	const frameBg = "bg-white dark:bg-gray-950";

	const statusQuery = useQuery({ queryKey: ["phpmyadmin-status"], queryFn: getPHPMyAdminStatus, refetchOnWindowFocus: false, });
	const status = statusQuery.data ?? defaultStatus;

	const phpMyAdminTheme = colorMode === "dark" ? "blueberry" : "";
	const embedQuery = useQuery({ queryKey: ["phpmyadmin-embed-session", phpMyAdminTheme || "default"], queryFn: () => getPHPMyAdminEmbedHTML(phpMyAdminTheme || undefined), enabled: Boolean(status.enabled && status.supported && isFullAccess),
			refetchOnWindowFocus: false,
			retry: false });

	useEffect(() => {
		if (embedQuery.isSuccess) setPreparedTheme(phpMyAdminTheme || "default");
	}, [embedQuery.isSuccess, phpMyAdminTheme]);
	const frameReady =
		preparedTheme === (phpMyAdminTheme || "default") && embedQuery.isSuccess;

	if (statusQuery.isLoading || (status.supported && status.enabled && isFullAccess && (embedQuery.isLoading || !frameReady) && !embedQuery.isError)) {
		return <PageLoadingSkeleton variant="frame" />;
	}

	return (
		<div className="flex flex-col gap-4">
			<div className={cn("border rounded-md overflow-hidden min-h-[calc(100vh_-_128px)] md:min-h-[calc(100vh_-_112px)]", panelBg, borderColor)}>
				{!status.supported ? (
					<div className="flex flex-col min-h-[360px] items-center justify-center gap-3 p-6">
						<h2 className="font-heading font-bold text-[1rem] leading-[1.2]">
							{t("phpmyadmin.sqliteDisabled")}
						</h2>
						<p className={cn("text-center", mutedColor)}>
							{t("phpmyadmin.sqliteDisabled")}
						</p>
					</div>
				) : !status.enabled ? (
					<div className="flex flex-col min-h-[360px] items-center justify-center gap-3 p-6">
						<h2 className="font-heading font-bold text-[1rem] leading-[1.2]">
							{t("phpmyadmin.notEnabledTitle")}
						</h2>
						<p className={cn("text-center", mutedColor)}>
							{t("phpmyadmin.notEnabledDescription")}
						</p>
					</div>
				) : !isFullAccess ? (
					<div className="flex flex-col min-h-[360px] items-center justify-center gap-3 p-6">
						<h2 className="font-heading font-bold text-[1rem] leading-[1.2]">
							{t("phpmyadmin.fullAccessOnly")}
						</h2>
						<p className={cn("text-center", mutedColor)}>
							{t("phpmyadmin.fullAccessOnlyHint")}
						</p>
					</div>
				) : embedQuery.isError ? (
					<div className="flex flex-col min-h-[360px] items-center justify-center gap-3 p-6">
						<h2 className="font-heading font-bold text-[1rem] leading-[1.2]">
							{t("phpmyadmin.embedFailed")}
						</h2>
						<p className={cn("text-center", mutedColor)}>
							{String((embedQuery.error as Error)?.message || "")}
						</p>
					</div>
				) : (
					<iframe title={t("phpmyadmin.title")} srcDoc={embedQuery.data} sandbox="allow-downloads allow-forms allow-modals allow-popups allow-same-origin allow-scripts" className={cn("w-full h-[calc(100vh_-_128px)] md:h-[calc(100vh_-_112px)] min-h-[520px] md:min-h-[680px] border-0", frameBg)} />
				)}
			</div>
		</div>
	);
};
