import { Skeleton } from "components/ui/skeleton";
import { cn } from "lib/cn";
import type { FC } from "react";

const SIDEBAR_SKELETON_SECTIONS = [
	{
		id: "overview",
		titleWidth: "w-14",
		items: [{ id: "dash", labelWidth: "w-20", isGroup: false, subWidths: [] }],
	},
	{
		id: "users",
		titleWidth: "w-20",
		items: [
			{
				id: "users-hub",
				labelWidth: "w-24",
				isGroup: true,
				subWidths: ["w-20", "w-16", "w-24"],
			},
			{ id: "admins", labelWidth: "w-16", isGroup: false, subWidths: [] },
			{ id: "usage", labelWidth: "w-20", isGroup: false, subWidths: [] },
		],
	},
	{
		id: "infra",
		titleWidth: "w-24",
		items: [
			{ id: "core-routing", labelWidth: "w-28", isGroup: true, subWidths: [] },
			{ id: "hosts", labelWidth: "w-20", isGroup: false, subWidths: [] },
			{ id: "nodes", labelWidth: "w-20", isGroup: false, subWidths: [] },
			{ id: "services", labelWidth: "w-24", isGroup: false, subWidths: [] },
		],
	},
	{
		id: "system",
		titleWidth: "w-16",
		items: [
			{ id: "sys-tools", labelWidth: "w-24", isGroup: true, subWidths: [] },
			{ id: "obs", labelWidth: "w-24", isGroup: true, subWidths: [] },
		],
	},
	{
		id: "help",
		titleWidth: "w-14",
		items: [
			{ id: "api-docs", labelWidth: "w-20", isGroup: false, subWidths: [] },
			{ id: "tutorials", labelWidth: "w-28", isGroup: false, subWidths: [] },
		],
	},
] as const;

export const SidebarSkeletonBody: FC<{ collapsed?: boolean }> = ({
	collapsed = false,
}) => (
	<div
		aria-hidden="true"
		className="rb-skeleton-sweep flex h-full min-h-0 w-full flex-col justify-between px-2 py-2.5"
	>
		<div className="-mx-2 mb-2 flex min-h-[48px] items-center justify-between border-b border-panel-border! py-2.5 ps-0 pe-0">
			<div
				className={cn(
					"flex h-[34px] min-w-0 flex-1 items-center justify-start gap-2.5 ps-[18px]",
					collapsed ? "pe-0" : "pe-2.5",
				)}
			>
				<Skeleton className="size-[30px] shrink-0 rounded-[8px] page-skeleton" />
				{!collapsed ? (
					<Skeleton className="h-4 w-24 rounded-md page-skeleton" />
				) : null}
			</div>
		</div>

		<div className="min-h-0 flex-1 overflow-hidden px-0">
			<div
				className={cn(
					"flex flex-col py-1.5",
					collapsed ? "gap-3" : "gap-4",
				)}
			>
				{SIDEBAR_SKELETON_SECTIONS.map((section) => (
					<div key={section.id}>
						{!collapsed ? (
							<div className="mb-1.5 px-3">
								<Skeleton
									className={cn("h-2.5 rounded-full page-skeleton", section.titleWidth)}
								/>
							</div>
						) : null}
						<div className="flex flex-col gap-0.5">
							{section.items.map((item) => (
								<div key={item.id} className="flex flex-col">
									<div
										className={cn(
											"flex h-[38px] w-full items-center justify-start gap-2.5 rounded-[12px]",
											collapsed ? "ps-4 pe-4" : "ps-3 pe-2.5",
										)}
									>
										<Skeleton className="size-[18px] shrink-0 rounded-[5px] page-skeleton" />
										{!collapsed ? (
											<div className="flex min-w-0 flex-1 items-center justify-between gap-2">
												<Skeleton
													className={cn("h-3.5 rounded-md page-skeleton", item.labelWidth)}
												/>
												{item.isGroup ? (
													<Skeleton className="size-3 shrink-0 rounded-xs page-skeleton" />
												) : null}
											</div>
										) : null}
									</div>
									{!collapsed && item.subWidths.length > 0 ? (
										<div className="ms-[21px] flex flex-col gap-0.5 border-s border-panel-border/70! ps-2.5 pt-1 pb-0.5">
											{item.subWidths.map((subWidth, subIdx) => (
												<div
													key={`${item.id}-${subIdx}`}
													className="flex h-[34px] items-center gap-2.5 px-2.5"
												>
													<Skeleton className="size-4 shrink-0 rounded-[5px] page-skeleton" />
													<Skeleton
														className={cn("h-3 rounded-md page-skeleton", subWidth)}
													/>
												</div>
											))}
										</div>
									) : null}
								</div>
							))}
						</div>
					</div>
				))}
			</div>
		</div>
	</div>
);

export const HeaderSkeletonContent: FC<{
	isMobile: boolean;
	breadcrumbCount?: number;
}> = ({ isMobile, breadcrumbCount = 1 }) => {
	const segs = Math.max(1, Math.min(3, breadcrumbCount));

	return (
		<div
			aria-hidden="true"
			className="flex h-full w-full items-center justify-between gap-3"
		>
			<div className="flex h-full min-w-0 flex-1 items-center gap-2.5 overflow-hidden">
				<Skeleton className="size-[34px] shrink-0 rounded-full min-[769px]:rounded-[12px] page-skeleton" />
				<span
					aria-hidden="true"
					className="mx-0.5 hidden h-4 w-px shrink-0 bg-panel-border min-[769px]:block"
				/>
				<div className="hidden min-[769px]:flex items-center gap-2">
					<Skeleton className="h-3.5 w-16 rounded-md page-skeleton" />
					{segs >= 2 ? (
						<>
							<Skeleton className="size-3 rounded-xs page-skeleton" />
							<Skeleton className="h-3.5 w-24 rounded-md page-skeleton" />
						</>
					) : null}
					{segs >= 3 ? (
						<>
							<Skeleton className="size-3 rounded-xs page-skeleton" />
							<Skeleton className="h-3.5 w-20 rounded-md page-skeleton" />
						</>
					) : null}
				</div>
			</div>

			<div className="flex h-full shrink-0 items-center gap-1.5 sm:gap-2">
				{!isMobile ? (
					<>
						<Skeleton className="hidden h-[34px] w-[164px] rounded-[12px] min-[1120px]:block page-skeleton" />
						<Skeleton className="block size-[34px] rounded-[12px] min-[1120px]:hidden page-skeleton" />
						<Skeleton className="h-[34px] w-[84px] rounded-[12px] page-skeleton" />
						<Skeleton className="size-[34px] rounded-[12px] page-skeleton" />
						<Skeleton className="h-[34px] w-[96px] rounded-[12px] page-skeleton" />
					</>
				) : (
					<>
						<Skeleton className="size-[34px] rounded-full page-skeleton" />
						<Skeleton className="size-[34px] rounded-full page-skeleton" />
					</>
				)}
			</div>
		</div>
	);
};

const DOCK_SKELETON_KEYS = ["d-1", "d-2", "d-3", "d-4", "d-5"] as const;

export const MobileDockSkeletonContent: FC<{ count?: number }> = ({
	count = 5,
}) => {
	const safeCount = Math.max(3, Math.min(6, count));
	return (
		<div
			aria-hidden="true"
			className="flex w-full items-center justify-between py-0.5"
		>
			{DOCK_SKELETON_KEYS.slice(0, safeCount).map((key) => (
				<div
					key={key}
					className="flex min-w-0 flex-1 flex-col items-center gap-1.5 py-1.5"
				>
					<Skeleton className="size-5 rounded-[6px] page-skeleton" />
					<Skeleton className="h-2 w-8 rounded-full page-skeleton" />
				</div>
			))}
		</div>
	);
};
