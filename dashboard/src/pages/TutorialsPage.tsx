import { PageLoadingSkeleton } from "components/ui";
import { cn } from "lib/cn";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useHref, useSearchParams } from "react-router-dom";
import { getTutorialsUrl } from "utils/tutorials";

type TutorialStatus = "checking" | "available" | "unavailable";

const PANEL_SHELL_MARKER = 'id="root"';

export const TutorialsPage = () => {
	const { t, i18n } = useTranslation();
	const dashboardRoot = useHref("/");
	const [searchParams] = useSearchParams();
	const [isLoaded, setIsLoaded] = useState(false);
	const [status, setStatus] = useState<TutorialStatus>("checking");
	const borderColor = "border-panel-border!";
	const frameBg = "bg-panel-surface";
	const frameSrc = getTutorialsUrl(
		dashboardRoot,
		i18n.language,
		searchParams.get("doc") || "",
	);

	useEffect(() => {
		let cancelled = false;
		setStatus("checking");
		setIsLoaded(false);
		fetch(frameSrc, { cache: "no-store" })
			.then(async (response) => {
				if (cancelled) return;
				const body = response.ok ? await response.text() : "";
				setStatus(
					response.ok && !body.includes(PANEL_SHELL_MARKER)
						? "available"
						: "unavailable",
				);
			})
			.catch(() => {
				if (!cancelled) setStatus("unavailable");
			});
		return () => {
			cancelled = true;
		};
	}, [frameSrc]);

	if (status === "checking") {
		return <PageLoadingSkeleton variant="frame" />;
	}

	if (status === "unavailable") {
		return (
			<div className={cn("flex flex-col items-start gap-4 border rounded-md p-4 md:p-6", borderColor, frameBg)}>
				<h2 className="font-heading font-bold text-[1.25rem] leading-[1.2]">
					{t("tutorials.unavailableTitle")}
				</h2>
				<p className="text-panel-text-muted">
					{t("tutorials.unavailableDescription")}
				</p>
			</div>
		);
	}

	return (
		<div className={cn("border rounded-md overflow-hidden relative h-[calc(100dvh_-_172px)] md:h-[calc(100dvh_-_96px)] min-h-[420px] md:min-h-[560px]", borderColor, frameBg)}>
			{!isLoaded ? (
				<div className="absolute inset-0">
					<PageLoadingSkeleton variant="frame" syncShell={false} />
				</div>
			) : null}
			<iframe title={t("tutorials.menu")} src={frameSrc} onLoad={() => setIsLoaded(true)} className={cn("w-full h-full border-0", frameBg, isLoaded ? "opacity-100" : "opacity-0")} />
		</div>
	);
};
