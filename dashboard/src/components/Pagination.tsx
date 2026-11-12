import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "components/ui/dropdown-menu";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { withClass } from "lib/withClass";
import { MoveLeft, MoveRight, ChevronDown } from "lucide-react";
import { Button as KitButton } from "components/ui/button";
import { useBreakpointValue } from "hooks/useBreakpointValue";

import { cn } from "lib/cn";
import { useAdminsStore } from "contexts/AdminsContext";
import { useDashboard } from "contexts/DashboardContext";
import { type FC, useMemo } from "react";

import { useTranslation } from "react-i18next";
import {
	setAdminsPerPageLimitSize,
	setUsersPerPageLimitSize,
} from "utils/userPreferenceStorage";

const PrevIcon = withClass(MoveLeft, "w-4 h-4");
const NextIcon = withClass(MoveRight, "w-4 h-4");
const ChevronIcon = withClass(ChevronDown, "w-4 h-4");

export type PaginationProps = {
	for?: "users" | "admins" | "services";
	total?: number;
	limit?: number;
	offset?: number;
	onPageChange?: (page: number) => void;
	onPageSizeChange?: (pageSize: number) => void;
};

const MINIMAL_PAGE_ITEM_COUNT = 5;
const PAGE_SIZE_OPTIONS = [10, 20, 30, 50, 100];

function generatePageItems(total: number, current: number, width: number) {
	if (width < MINIMAL_PAGE_ITEM_COUNT) {
		throw new Error(
			`Must allow at least ${MINIMAL_PAGE_ITEM_COUNT} page items`,
		);
	}
	if (width % 2 === 0) {
		throw new Error(`Must allow odd number of page items`);
	}
	if (total < width) {
		return [...new Array(total).keys()];
	}
	const left = Math.max(
		0,
		Math.min(total - width, current - Math.floor(width / 2)),
	);
	const items: (string | number)[] = new Array(width);
	for (let i = 0; i < width; i += 1) {
		items[i] = i + left;
	}
	if (typeof items[0] === "number" && items[0] > 0) {
		items[0] = 0;
		items[1] = "prev-more";
	}
	if ((items[items.length - 1] as number) < total - 1) {
		items[items.length - 1] = total - 1;
		items[items.length - 2] = "next-more";
	}
	return items;
}

export const Pagination: FC<PaginationProps> = ({
	for: target = "users",
	total: controlledTotal,
	limit: controlledLimit,
	offset: controlledOffset,
	onPageChange,
	onPageSizeChange,
}) => {
	const userFilters = useDashboard((state) => state.filters);
	const onUserFilterChange = useDashboard((state) => state.onFilterChange);
	const usersTotal = useDashboard((state) => state.users.total);

	const adminFilters = useAdminsStore((state) => state.filters);
	const onAdminFilterChange = useAdminsStore((state) => state.onFilterChange);
	const adminsTotal = useAdminsStore((state) => state.total);

	const { t, i18n } = useTranslation();
	const direction = i18n.dir(i18n.language);
	const isRTL = direction === "rtl";

	const storedPagination = useMemo(() => {
		if (target === "admins") {
			return {
				filters: adminFilters,
				total: adminsTotal,
				onFilterChange: onAdminFilterChange,
			};
		}
		return {
			filters: userFilters,
			total: usersTotal,
			onFilterChange: onUserFilterChange,
		};
	}, [
		target,
		adminFilters,
		adminsTotal,
		onAdminFilterChange,
		userFilters,
		usersTotal,
		onUserFilterChange,
	]);
	const isControlled =
		controlledTotal !== undefined &&
		controlledLimit !== undefined &&
		controlledOffset !== undefined;
	const filters = isControlled
		? { limit: controlledLimit ?? 10, offset: controlledOffset ?? 0 }
		: storedPagination.filters;
	const total = controlledTotal ?? storedPagination.total;

	const { limit, offset } = filters;

	const perPageNum = Number(limit || 10);
	const offsetNum = Number(offset || 0);

	const page = Math.floor(offsetNum / perPageNum);
	const noPages = Math.ceil(total / perPageNum);
	const isCompactPagination =
		useBreakpointValue({ base: true, md: false }) ?? false;
	const pages = isCompactPagination ? [] : generatePageItems(noPages, page, 7);

	const changePage = (p: number) => {
		if (isControlled) {
			onPageChange?.(p);
			return;
		}
		storedPagination.onFilterChange({
			...filters,
			offset: p * perPageNum,
		});
	};

	const handlePageSizeSelect = (next: number) => {
		if (isControlled) {
			onPageSizeChange?.(next);
			return;
		}
		storedPagination.onFilterChange({
			...filters,
			limit: next,
			offset: 0,
		});
		if (target === "users") setUsersPerPageLimitSize(String(next));
		if (target === "admins") setAdminsPerPageLimitSize(String(next));
	};

	const canPrev = useMemo(() => page > 0 && noPages > 0, [page, noPages]);
	const canNext = useMemo(
		() => page + 1 < noPages && noPages > 0,
		[page, noPages],
	);

	return (
		<div className="items-center gap-2 justify-between mt-4 w-full max-w-full flex lg:gap-x-4 md:gap-x-0 md:gap-y-0 gap-y-4 md:flex-row flex-col rb-data-table-pagination">
			<div className="order-2 md:order-1 w-full md:w-auto">
				<div className="flex flex-row items-center gap-2 justify-center md:justify-start min-w-0!">
					<DropdownMenu>
						<DropdownMenuTrigger asChild><KitButton size="sm" variant="outline" className="min-w-[104px]! md:min-w-[112px]! max-w-[104px] md:max-w-[120px] justify-between px-3">
							{perPageNum}
						{<ChevronIcon />}</KitButton></DropdownMenuTrigger>
						
							<DropdownMenuContent className="z-[1800] min-w-[104px]! md:min-w-[112px]! max-w-[104px] md:max-w-[120px] py-1 rounded-lg shadow-2xl bg-panel-surface border-panel-border! overflow-hidden">
								{PAGE_SIZE_OPTIONS.map((option) => {
									const isSelected = option === perPageNum;
									return (
										<DropdownMenuItem key={option} onSelect={() => handlePageSizeSelect(option)} className={cn("text-[0.875rem]", isSelected ? "font-bold" : "font-medium", isSelected ? "bg-primary-500" : "bg-transparent", isSelected ? "text-white" : "text-inherit", isSelected ? "hover:bg-primary-600" : "hover:bg-panel-hover", isSelected ? "focus:bg-primary-600" : "focus:bg-panel-hover")}>
											{option}
										</DropdownMenuItem>
									);
								})}
							</DropdownMenuContent>
						
					</DropdownMenu>
					<p className="whitespace-nowrap text-[0.875rem]">
						{t("itemsPerPage")}
					</p>
				</div>
			</div>

			{noPages > 1 && (
				/* Pagination controls: the panel's own button row (Previous, numbered
				   pages, Next), separated by the attached group's seams. */
				<div className="order-1 md:order-2 w-full md:w-auto max-w-full inline-flex items-center gap-1">
					<KitButton variant="outline" size="sm" onClick={() => changePage(page - 1)} disabled={!canPrev} className="rounded-md flex-[1_1_0] md:flex-[0_0_auto] px-2 md:px-3">
						{isRTL ? <NextIcon /> : <PrevIcon />}
						{t("previous")}
					</KitButton>

					{isCompactPagination ? (
						<KitButton variant="outline" size="sm" disabled className="rounded-md flex-[0_0_auto] px-3">
							{page + 1} / {noPages}
						</KitButton>
					) : (
						pages.map((pageIndex) =>
							typeof pageIndex === "string" ? (
								<KitButton variant="outline" size="sm" key={pageIndex} className="rounded-md" disabled>
									…
								</KitButton>
							) : (
								<KitButton
									size="sm"
									key={pageIndex}
									variant={pageIndex === page ? "default" : "outline"}
									onClick={() => changePage(pageIndex)}
									className="rounded-md"
								>
									{pageIndex + 1}
								</KitButton>
							),
						)
					)}

					<KitButton variant="outline" size="sm" onClick={() => changePage(page + 1)} disabled={!canNext} className="rounded-md flex-[1_1_0] md:flex-[0_0_auto] px-2 md:px-3">
						{t("next")}
						{isRTL ? <PrevIcon /> : <NextIcon />}
					</KitButton>
				</div>
			)}

		</div>
	);
};
