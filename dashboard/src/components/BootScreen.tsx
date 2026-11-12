import {
	HeaderSkeletonContent,
	MobileDockSkeletonContent,
	SidebarSkeletonBody,
} from "components/layout/ShellSkeletons";
import { PageLoadingSkeleton } from "components/ui/PageLoadingSkeleton";
import { useMediaQuery } from "hooks/useMediaQuery";
import { cn } from "lib/cn";
import { useTranslation } from "react-i18next";

export const BootScreen = () => {
	const { i18n } = useTranslation();
	const isMobile = !useMediaQuery("(min-width: 769px)");
	const isRTL =
		i18n.dir(i18n.language) === "rtl" ||
		(typeof document !== "undefined" && document.documentElement.dir === "rtl");
	const breadcrumbDepth =
		typeof window !== "undefined"
			? Math.max(1, Math.min(3, window.location.pathname.split("/").filter(Boolean).length))
			: 1;

	return (
		<div
			dir={isRTL ? "rtl" : "ltr"}
			className={cn(
				"flex h-[100dvh] max-h-[100dvh] min-h-[100dvh] overflow-hidden bg-panel-app min-[769px]:h-[100vh] min-[769px]:max-h-[100vh] min-[769px]:min-h-[100vh]",
				isRTL ? "flex-row-reverse" : "flex-row",
			)}
		>
			{!isMobile ? (
				<aside
					dir={isRTL ? "rtl" : "ltr"}
					style={{
						width: "240px",
						[isRTL ? "right" : "left"]: 12,
					}}
					className="fixed top-3 z-[200] flex h-[calc(100dvh-24px)] max-h-[calc(100dvh-24px)] shrink-0 overflow-hidden rounded-[20px] border border-panel-border! bg-panel-surface shadow-[0_1px_2px_rgba(0,0,0,0.03),inset_0_1px_0_0_rgba(255,255,255,0.7)] select-none dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]"
				>
					<SidebarSkeletonBody />
				</aside>
			) : null}

			<div
				className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-panel-main"
				style={{
					marginLeft: isMobile || isRTL ? "0px" : "260px",
					marginRight: isMobile || !isRTL ? "0px" : "260px",
				}}
			>
				<div className="relative z-[100] shrink-0">
					<header
						dir={isRTL ? "rtl" : "ltr"}
						className="mx-3 mt-3 flex h-[52px] min-h-[52px] items-center justify-between gap-3 overflow-hidden rounded-[18px] border border-panel-border! bg-panel-surface px-3 shadow-[0_1px_2px_rgba(0,0,0,0.03),inset_0_1px_0_0_rgba(255,255,255,0.75)] select-none min-[769px]:mx-4 min-[769px]:px-5 dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]"
					>
						<HeaderSkeletonContent
							isMobile={isMobile}
							breadcrumbCount={breadcrumbDepth}
						/>
					</header>
				</div>

				<main className="min-h-0 flex-1 overflow-auto overscroll-contain bg-transparent p-3 pt-2.5 pb-[calc(env(safe-area-inset-bottom,0px)+88px)] min-[769px]:p-4 min-[769px]:pt-3 min-[769px]:pb-4">
					<PageLoadingSkeleton variant="box" syncShell={false} />
				</main>
			</div>

			{isMobile ? (
				<div className="rb-mobile-dock pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+12px)] z-[1500] px-3 min-[769px]:hidden">
					<div className="pointer-events-auto mx-auto max-w-[min(440px,calc(100vw-20px))] rounded-[24px] border border-panel-border! bg-panel-surface/95 px-2 py-1.5 shadow-[0_12px_32px_rgba(15,23,42,0.16)] dark:shadow-[0_12px_32px_rgba(0,0,0,0.48)]">
						<MobileDockSkeletonContent />
					</div>
				</div>
			) : null}
		</div>
	);
};
