import { Skeleton } from "components/ui/skeleton";
import { cn } from "lib/cn";
import { useRegisterShellLoading } from "lib/shellLoading";
import type { FC } from "react";

export interface PageLoadingSkeletonProps {
	variant?: "box" | "dashboard" | "entity" | "settings" | "frame";
	canSeeGlobal?: boolean;
	isRTL?: boolean;
	syncShell?: boolean;
	className?: string;
}

const ENTITY_ROWS = ["row-1", "row-2", "row-3", "row-4", "row-5", "row-6"] as const;
const DASHBOARD_KPI_CARDS = ["cpu", "memory", "swap", "disk"] as const;
const DASHBOARD_USER_ROWS = [
	{ id: "total", labelWidth: "w-16", valWidth: "w-10", pill: false },
	{ id: "active", labelWidth: "w-14", valWidth: "w-10", pill: true },
	{ id: "online", labelWidth: "w-16", valWidth: "w-10", pill: true },
	{ id: "onhold", labelWidth: "w-20", valWidth: "w-8", pill: false },
	{ id: "limited", labelWidth: "w-18", valWidth: "w-8", pill: false },
	{ id: "expired", labelWidth: "w-20", valWidth: "w-8", pill: false },
] as const;

const cardShellClass = "rb-stat-card";

export const PageLoadingSkeleton: FC<PageLoadingSkeletonProps> = ({
	variant = "entity",
	canSeeGlobal = true,
	isRTL = false,
	syncShell = true,
	className,
}) => {
	useRegisterShellLoading(
		syncShell,
		variant === "box" ? "route-suspense" : "page-loading",
	);

	if (variant === "box") {
		return (
			<div
				aria-busy="true"
				aria-live="polite"
				className={cn("flex w-full flex-1 flex-col", className)}
			>
				<div
					className={cn(
						cardShellClass,
						"rb-skeleton-sweep min-h-[calc(100dvh-172px)] w-full rounded-[20px] min-[769px]:min-h-[calc(100vh-104px)]",
					)}
				/>
			</div>
		);
	}

	if (variant === "frame") {
		return (
			<div
				aria-busy="true"
				aria-live="polite"
				className={cn("flex w-full flex-1 flex-col", className)}
			>
				<div
					className={cn(
						cardShellClass,
						"flex min-h-[calc(100dvh-172px)] w-full flex-col overflow-hidden rounded-[20px] min-[769px]:min-h-[calc(100vh-104px)]",
					)}
				>
					<div className="flex items-center justify-between gap-3 border-b border-panel-border! px-4 py-3.5 min-[769px]:px-6">
						<div className="flex items-center gap-2.5">
							<Skeleton className="size-7 rounded-[9px] page-skeleton" />
							<Skeleton className="h-4 w-32 rounded-md page-skeleton" />
						</div>
						<Skeleton className="h-8 w-20 rounded-[10px] page-skeleton" />
					</div>
					<div className="flex flex-1 flex-col gap-4 p-4 min-[769px]:p-6">
						<Skeleton className="h-6 w-52 rounded-md page-skeleton" />
						<Skeleton className="h-4 w-full max-w-2xl rounded-xs page-skeleton" />
						<Skeleton className="h-4 w-4/5 max-w-xl rounded-xs page-skeleton" />
						<Skeleton className="mt-2 min-h-[240px] w-full flex-1 rounded-[16px] page-skeleton" />
					</div>
				</div>
			</div>
		);
	}

	if (variant === "settings") {
		return (
			<div
				dir={isRTL ? "rtl" : "ltr"}
				aria-busy="true"
				aria-live="polite"
				className={cn(
					"flex w-full flex-col items-stretch gap-4 min-[769px]:gap-5",
					className,
				)}
			>
				<div className="flex flex-col gap-3 min-[769px]:flex-row min-[769px]:items-center min-[769px]:justify-between">
					<div className="flex items-center gap-1.5 overflow-hidden rounded-[12px] border border-panel-border! bg-panel-surface p-1">
						{["tab-1", "tab-2", "tab-3", "tab-4"].map((id, idx) => (
							<Skeleton
								key={id}
								className={cn(
									"h-8 rounded-[9px] page-skeleton",
									idx === 0 ? "w-24" : "w-20",
								)}
							/>
						))}
					</div>
					<Skeleton className="h-9 w-28 rounded-[12px] page-skeleton" />
				</div>

				{["sec-1", "sec-2"].map((sec) => (
					<div key={sec} className={cardShellClass}>
						<div className="flex items-center justify-between gap-3 border-b border-panel-border! px-4 py-3.5 sm:px-5 min-[769px]:px-6">
							<div className="flex items-center gap-2.5">
								<Skeleton className="size-7 rounded-[9px] page-skeleton" />
								<Skeleton className="h-4 w-36 rounded-md page-skeleton" />
							</div>
							<Skeleton className="h-7 w-20 rounded-[10px] page-skeleton" />
						</div>
						<div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 sm:p-5 min-[769px]:p-6">
							{["f-1", "f-2", "f-3", "f-4"].map((field) => (
								<div key={field} className="flex flex-col gap-2">
									<Skeleton className="h-3 w-24 rounded-xs page-skeleton" />
									<Skeleton className="h-10 w-full rounded-[10px] page-skeleton" />
								</div>
							))}
						</div>
						<div className="flex justify-end gap-2 border-t border-panel-border/70! px-4 py-3 sm:px-5 min-[769px]:px-6">
							<Skeleton className="h-9 w-24 rounded-[12px] page-skeleton" />
						</div>
					</div>
				))}
			</div>
		);
	}

	if (variant === "dashboard") {
		return (
			<div
				dir={isRTL ? "rtl" : "ltr"}
				aria-busy="true"
				aria-live="polite"
				className={cn("flex w-full flex-col gap-4 min-[769px]:gap-5", className)}
			>
				<div className="flex flex-wrap items-center justify-between gap-3 px-1 py-0.5">
					<div className="flex flex-col items-start gap-2">
						<Skeleton className="h-6 w-36 rounded-[8px] page-skeleton sm:w-44" />
						<div className="flex flex-wrap items-center gap-2">
							<Skeleton className="h-[18px] w-16 rounded-full page-skeleton" />
							<Skeleton className="h-[18px] w-20 rounded-full page-skeleton" />
							<Skeleton className="h-[18px] w-14 rounded-full page-skeleton" />
						</div>
					</div>
					<div className="grid w-full grid-cols-2 gap-2 min-[769px]:flex min-[769px]:w-auto min-[769px]:items-center">
						<Skeleton className="col-span-2 h-9 w-full rounded-[12px] page-skeleton min-[769px]:col-span-1 min-[769px]:h-8 min-[769px]:w-28" />
						<Skeleton className="h-9 w-full rounded-[12px] page-skeleton min-[769px]:h-8 min-[769px]:w-24" />
						<Skeleton className="h-9 w-full rounded-[12px] page-skeleton min-[769px]:h-8 min-[769px]:w-28" />
					</div>
				</div>

				<div className="rb-dashboard-grid-guard grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 xl:grid-cols-4 min-[769px]:gap-4">
					{DASHBOARD_KPI_CARDS.map((cardKey, index) => (
						<div
							key={cardKey}
							className={cn(cardShellClass, "flex flex-col justify-between p-4 sm:p-5")}
						>
							<div>
								<div className="mb-3 flex items-center justify-between gap-2">
									<div className="flex items-center gap-2.5">
										<Skeleton className="size-8 rounded-[10px] page-skeleton" />
										<Skeleton className="h-3.5 w-24 rounded-md page-skeleton" />
									</div>
									{index < 2 && <Skeleton className="h-[22px] w-16 rounded-full page-skeleton" />}
								</div>
								<div className="mb-2 flex items-baseline gap-2">
									<Skeleton className="h-7 w-20 rounded-md page-skeleton" />
									<Skeleton className="h-4 w-16 rounded-md page-skeleton" />
								</div>
							</div>
							<div className="mt-3.5 flex flex-col gap-2">
								<Skeleton className="h-3 w-10 rounded-xs page-skeleton" />
								<Skeleton className="h-[6px] w-full rounded-full page-skeleton" />
								<div className="mt-1 flex items-center justify-between border-t border-panel-border/70! pt-2">
									<Skeleton className="h-3 w-20 rounded-xs page-skeleton" />
									<Skeleton className="h-3 w-16 rounded-xs page-skeleton" />
								</div>
							</div>
						</div>
					))}
				</div>

				<div className="rb-dashboard-grid-guard grid grid-cols-1 gap-3 min-[769px]:grid-cols-2 min-[769px]:gap-4">
					{["bandwidth", "uptime"].map((sectionKey, idx) => (
						<div key={sectionKey} className={cardShellClass}>
							<div className="flex items-center justify-between border-b border-panel-border! px-4 py-3.5 sm:px-5 min-[769px]:px-6">
								<div className="flex items-center gap-2.5">
									<Skeleton
										className={cn(
											"page-skeleton",
											idx === 0
												? "size-6 rounded-[8px] sm:size-7 sm:rounded-[9px]"
												: "size-7 rounded-[9px]",
										)}
									/>
									<Skeleton className="h-4 w-28 rounded-md page-skeleton" />
								</div>
								{idx === 0 && (
									<div className="flex items-center gap-1.5 sm:gap-2">
										{canSeeGlobal && (
											<Skeleton className="h-[22px] w-20 rounded-[9px] page-skeleton" />
										)}
										<Skeleton className="h-[22px] w-16 rounded-full page-skeleton" />
									</div>
								)}
							</div>
							<div className="flex flex-col gap-3 px-4 py-4 sm:px-5 min-[769px]:px-6">
								{[0, 1].map((row) => (
									<div key={row} className="flex items-center justify-between gap-3">
										<div className="flex items-center gap-2.5">
											<Skeleton className="size-7 rounded-[10px] page-skeleton" />
											<Skeleton className="h-3.5 w-24 rounded-xs page-skeleton" />
										</div>
										<Skeleton className="h-4 w-20 rounded-xs page-skeleton" />
									</div>
								))}
							</div>
						</div>
					))}
				</div>

				<div className={cardShellClass}>
					<div className="flex items-center justify-between border-b border-panel-border! px-4 py-3.5 sm:px-5 min-[769px]:px-6">
						<div className="flex items-center gap-2.5">
							<Skeleton className="size-7 rounded-[9px] page-skeleton" />
							<Skeleton className="h-4 w-32 rounded-md page-skeleton" />
						</div>
						<Skeleton className="h-[22px] w-20 rounded-full page-skeleton" />
					</div>
					<div className="grid grid-cols-1 gap-3 px-4 py-4 min-[480px]:grid-cols-2 sm:px-5 min-[769px]:gap-4 min-[769px]:px-6">
						{["panel-cpu", "panel-ram"].map((itemKey) => (
							<div
								key={itemKey}
								className="rb-stat-card flex flex-col justify-between p-4 sm:p-5"
							>
								<div className="mb-3 flex items-center gap-2.5">
									<Skeleton className="size-8 rounded-[10px] page-skeleton" />
									<Skeleton className="h-4 w-28 rounded-md page-skeleton" />
								</div>
								<Skeleton className="mb-3 h-7 w-24 rounded-md page-skeleton" />
								<Skeleton className="h-[6px] w-full rounded-full page-skeleton" />
							</div>
						))}
					</div>
				</div>

				<div className={cardShellClass}>
					<div className="flex items-center justify-between border-b border-panel-border! px-4 py-3.5 sm:px-5 min-[769px]:px-6">
						<div className="flex items-center gap-2.5">
							<Skeleton className="size-7 rounded-[9px] page-skeleton" />
							<Skeleton className="h-4 w-24 rounded-md page-skeleton" />
						</div>
						{canSeeGlobal && <Skeleton className="h-[26px] w-32 rounded-[10px] page-skeleton" />}
					</div>
					<div className="flex flex-col divide-y divide-panel-border/80 px-4 py-2 sm:px-5 min-[769px]:px-6">
						{DASHBOARD_USER_ROWS.map((row) => (
							<div key={row.id} className="flex items-center justify-between py-2.5">
								<div className="flex items-center gap-2.5">
									<Skeleton className="size-[7px] rounded-full page-skeleton" />
									<Skeleton className={cn("h-3.5 rounded-xs page-skeleton", row.labelWidth)} />
									{row.pill && <Skeleton className="h-4 w-10 rounded-full page-skeleton" />}
								</div>
								<Skeleton className={cn("h-4 rounded-xs page-skeleton", row.valWidth)} />
							</div>
						))}
					</div>
				</div>

				{canSeeGlobal && (
					<div className={cardShellClass}>
						<div className="flex items-center justify-between border-b border-panel-border! px-4 py-3.5 sm:px-5 min-[769px]:px-6">
							<div className="flex items-center gap-2.5">
								<Skeleton className="size-7 rounded-[9px] page-skeleton" />
								<Skeleton className="h-4 w-24 rounded-md page-skeleton" />
							</div>
						</div>
						<div className="flex flex-col divide-y divide-panel-border/80 px-4 py-2 sm:px-5 min-[769px]:px-6">
							{["total", "full", "sudo", "standard", "top"].map((rowKey) => (
								<div key={rowKey} className="flex items-center justify-between py-2.5">
									<div className="flex items-center gap-2.5">
										<Skeleton className="size-[7px] rounded-full page-skeleton" />
										<Skeleton className="h-3.5 w-24 rounded-xs page-skeleton" />
									</div>
									<Skeleton className="h-4 w-12 rounded-xs page-skeleton" />
								</div>
							))}
						</div>
					</div>
				)}
			</div>
		);
	}

	return (
		<div
			aria-busy="true"
			aria-live="polite"
			className={cn("flex w-full flex-col items-stretch gap-4 min-[769px]:gap-5", className)}
		>
			<div className={cn(cardShellClass, "flex flex-col gap-4 p-4 min-[769px]:p-5")}>
				<div className="flex flex-col items-stretch justify-between gap-4 xl:flex-row xl:items-center">
					<div className="flex flex-col items-start gap-2">
						<Skeleton className="h-5 w-40 min-[769px]:w-52 rounded-md page-skeleton" />
						<div className="flex flex-row items-center gap-2">
							<Skeleton className="h-5 w-20 rounded-full page-skeleton" />
							<Skeleton className="h-5 w-24 rounded-full page-skeleton" />
							<Skeleton className="h-5 w-20 rounded-full page-skeleton" />
						</div>
					</div>
					<div className="grid grid-cols-2 gap-2 min-[769px]:grid-cols-4">
						{["act-1", "act-2", "act-3", "act-4"].map((id) => (
							<Skeleton
								key={id}
								className="h-9 w-full min-[769px]:w-28 rounded-[12px] page-skeleton"
							/>
						))}
					</div>
				</div>
				<div className="h-px w-full bg-panel-border/60" />
				<div className="grid grid-cols-1 gap-2 min-[769px]:grid-cols-4">
					{["flt-1", "flt-2", "flt-3", "flt-4"].map((id) => (
						<Skeleton key={id} className="h-9 w-full rounded-[12px] page-skeleton" />
					))}
				</div>
			</div>

			<div className={cardShellClass}>
				<div className="hidden gap-4 border-b border-panel-border! px-5 py-3.5 min-[769px]:flex">
					{["col-1", "col-2", "col-3", "col-4", "col-5", "col-6", "col-7"].map((id, index) => (
						<Skeleton
							key={id}
							className={cn(
								"h-3 rounded-xs page-skeleton",
								index === 0 ? "w-5" : index === 1 ? "w-28" : index === 6 ? "w-12" : "w-20",
							)}
						/>
					))}
				</div>
				{ENTITY_ROWS.map((row, index) => (
					<div
						key={row}
						className={cn(
							"border-panel-border! px-4 py-4 min-[769px]:px-5 min-[769px]:py-4.5",
							index === ENTITY_ROWS.length - 1 ? "border-b-0" : "border-b",
						)}
					>
						<div className="hidden items-center gap-4 min-[769px]:flex">
							<Skeleton className="size-4 rounded-xs page-skeleton" />
							<Skeleton className="h-4 w-28 rounded-xs page-skeleton" />
							<Skeleton className="h-5 w-20 rounded-full page-skeleton" />
							<Skeleton className="h-4 w-32 rounded-xs page-skeleton" />
							<Skeleton className="h-4 w-24 rounded-xs page-skeleton" />
							<Skeleton className="h-4 max-w-60 flex-1 rounded-xs page-skeleton" />
							<Skeleton className="h-7 w-28 rounded-[10px] page-skeleton" />
							<Skeleton className="h-5 w-10 rounded-xs page-skeleton" />
						</div>
						<div className="flex flex-col gap-3 min-[769px]:hidden">
							<div className="flex items-center justify-between gap-3">
								<div className="flex min-w-0 items-center gap-2.5">
									<Skeleton className="size-4 rounded-xs page-skeleton" />
									<Skeleton className="h-4 w-32 rounded-xs page-skeleton" />
								</div>
								<Skeleton className="h-5 w-20 rounded-full page-skeleton" />
							</div>
							<div className="flex justify-between gap-3">
								<Skeleton className="h-3.5 w-24 rounded-xs page-skeleton" />
								<Skeleton className="h-3.5 w-28 rounded-xs page-skeleton" />
							</div>
							<Skeleton className="h-7 w-full rounded-[10px] page-skeleton" />
						</div>
					</div>
				))}
			</div>
		</div>
	);
};
