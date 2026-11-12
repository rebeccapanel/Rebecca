import { buttonVariants } from "components/ui/button";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";

import { cn } from "lib/cn";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { PageLoadingSkeleton } from "components/ui";

type DocsStatus = "checking" | "enabled" | "disabled";

export const ApiDocsPage = () => {
	const { t } = useTranslation();
	const [status, setStatus] = useState<DocsStatus>("checking");
	const panelBg = "bg-white dark:bg-gray-950";
	const borderColor = "border-blackAlpha-200! dark:border-whiteAlpha-200!";
	const mutedColor = "text-gray-600 dark:text-gray-400";
	const frameBg = "bg-gray-50 dark:bg-blackAlpha-300";

	useEffect(() => {
		let cancelled = false;
		void fetch("/openapi.json", {
			headers: { Accept: "application/json" },
			cache: "no-store",
		})
			.then((response) => {
				if (cancelled) return;
				if (response.ok && (response.headers.get("content-type") ?? "").includes("application/json")) {
					setStatus("enabled");
					return;
				}
				setStatus("disabled");
			})
			.catch(() => {
				if (!cancelled) setStatus("disabled");
			});
		return () => {
			cancelled = true;
		};
	}, []);

	if (status === "checking") {
		return <PageLoadingSkeleton variant="frame" />;
	}

	if (status === "disabled") {
		return (
			<div className={cn("flex flex-col items-start gap-4 border rounded-md p-4 md:p-6", borderColor, panelBg)}>
				<h2 className="font-heading font-bold text-[1.25rem] leading-[1.2]">{t("apiDocs.disabledTitle")}</h2>
				<p className={cn(mutedColor)}>
					{t("apiDocs.disabledDescription")}
				</p>
				<a href="/docs/" className={buttonVariants({ variant: "outline" })}>
					{t("apiDocs.openRoute")}
				</a>
			</div>
		);
	}

	return (
		<div className={cn("border rounded-md overflow-hidden min-h-[calc(100vh_-_144px)] md:min-h-[calc(100vh_-_116px)]", borderColor, panelBg)}>
			<iframe title={t("apiDocs.menu")} src="/docs/" className={cn("w-full h-[calc(100vh_-_146px)] md:h-[calc(100vh_-_118px)] min-h-[720px] border-0", frameBg)} />
		</div>
	);
};
