import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "components/ui/dropdown-menu";
import { ChevronDown, LoaderCircle, RefreshCw } from "lucide-react";

import { buttonVariants } from "components/ui/button";
import { cn } from "lib/cn";
import type { FC } from "react";
import { useTranslation } from "react-i18next";

type RefreshSplitButtonProps = {
	onRefresh: () => void;
	loading?: boolean;
	interval: number;
	onIntervalChange: (interval: number) => void;
};

export const AUTO_REFRESH_INTERVALS = [3_000, 5_000, 10_000, 30_000] as const;

export const RefreshSplitButton: FC<RefreshSplitButtonProps> = ({
	onRefresh,
	loading: isLoading,
	interval,
	onIntervalChange,
}) => {
	const { t, i18n } = useTranslation();

	const active = interval > 0;
	const intervalLabel = active ? t("usersTable.autoRefreshEvery", { seconds: interval / 1000 }) : t("usersTable.autoRefreshOff");

	return (
		<div className="inline-flex h-9 items-stretch overflow-hidden rounded-full bg-panel-elevated shadow-xs ring-1 ring-inset ring-panel-border">
			<button
				type="button"
				onClick={onRefresh}
				disabled={isLoading}
				aria-label={t("refresh")}
				title={t("refresh")}
				className={cn(
					buttonVariants({ variant: "ghost", size: "icon" }),
					"rounded-none text-panel-text-secondary hover:bg-whiteAlpha-100 hover:text-panel-text",
				)}
			>
				{isLoading ? (
					<LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
				) : (
					<RefreshCw className="size-4" />
				)}
			</button>
			<span aria-hidden="true" className="my-2 w-px bg-panel-border" />

			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<button
						type="button"
						aria-label={`${t("usersTable.autoRefresh")}: ${intervalLabel}`}
						title={`${t("usersTable.autoRefresh")}: ${intervalLabel}`}
						className={cn(
							buttonVariants({ variant: "ghost", size: "icon" }),
							"relative rounded-none text-panel-text-secondary hover:bg-whiteAlpha-100 hover:text-panel-text",
						)}
					>
						<ChevronDown className="size-4" />
						{active ? (
							<span
								aria-hidden="true"
								className="absolute end-1.5 top-1.5 size-1.5 rounded-full bg-panel-accent ring-2 ring-panel-elevated"
							/>
						) : null}
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent className={cn(i18n.dir() === "rtl" ? "items-start" : "items-end", "min-w-52")}>
					<DropdownMenuLabel>{t("usersTable.autoRefresh")}</DropdownMenuLabel>
					<DropdownMenuSeparator />
					<DropdownMenuItem onSelect={() => onIntervalChange(0)} className={cn(!active && "font-semibold")}>
						{t("usersTable.autoRefreshOff")}
					</DropdownMenuItem>
					{AUTO_REFRESH_INTERVALS.map((value) => (
						<DropdownMenuItem key={value} onSelect={() => onIntervalChange(value)} className={cn(interval === value && "font-semibold text-panel-text")}>
							{t("usersTable.autoRefreshEvery", { seconds: value / 1000 })}
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
};
