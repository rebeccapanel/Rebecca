import {
	LabelFilter,
	type LabelFilterValue,
	labelFilterCount,
} from "components/labels/LabelFilter";
import type { SortingState } from "@tanstack/react-table";
import debounce from "lodash.debounce";
import { ListFilter, Plus } from "lucide-react";
import { type FC, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SearchInput } from "components/common/SearchInput";
import { buttonVariants } from "components/ui/button";
import { DataTableSortMenu, type SortOption } from "components/ui/DataTableSortMenu";
import { Popover, PopoverContent, PopoverTrigger } from "components/ui/popover";
import { Select, SelectContent, SelectItem, SelectItemText, SelectTrigger, SelectValue } from "components/ui/select";
import { useAdminsStore } from "contexts/AdminsContext";
import useGetUser from "hooks/useGetUser";
import { cn } from "lib/cn";
import { AdminManagementPermission, AdminRole } from "types/Admin";

const ALL = "all";

export const AdminsFilterBar: FC = () => {
	const { t } = useTranslation();
	const filters = useAdminsStore((state) => state.filters);
	const onFilterChange = useAdminsStore((state) => state.onFilterChange);

	const [search, setSearch] = useState(filters.search ?? "");
	const debouncedSearch = useMemo(
		() => debounce((nextSearch: string) => onFilterChange({ search: nextSearch, offset: 0 }), 300),
		[onFilterChange],
	);
	useEffect(() => () => debouncedSearch.cancel(), [debouncedSearch]);

	const sortOptions = useMemo<SortOption[]>(
		() => [
			{ id: "username", label: t("username"), type: "text" },
			{ id: "status", label: t("status"), type: "text" },
			{ id: "role", label: t("core.role"), type: "text" },
			{ id: "users_count", label: t("admins.details.activeLabel"), type: "number" },
			{ id: "online", label: t("admins.details.onlineLabel"), type: "number" },
			{ id: "services", label: t("services.title"), type: "number" },
			{ id: "data_usage", label: t("usersTable.traffic"), type: "number" },
			{ id: "remaining_traffic", label: t("usersTable.remainingTraffic"), type: "number" },
			{ id: "expire", label: t("expire"), type: "date" },
		],
		[t],
	);
	const sorting: SortingState = filters.sort
		? [{ id: filters.sort.replace(/^-/, ""), desc: filters.sort.startsWith("-") }]
		: [];
	const handleSortChange = (next: SortingState) => {
		const item = next[0];
		onFilterChange({ sort: item ? `${item.desc ? "-" : ""}${item.id}` : "username", offset: 0 });
	};

	const labelFilter: LabelFilterValue = {
		groups: filters.groups ?? [],
		tags: filters.tags ?? [],
		tagMatchAll: Boolean(filters.tagMatchAll),
	};
	const activeFilterCount =
		(filters.roleFilter ? 1 : 0) + (filters.statusFilter ? 1 : 0) + labelFilterCount(labelFilter);
	const roleOptions = [
		{ value: "full_access", label: t("admins.filters.roleFullAccess") },
		{ value: "sudo", label: t("admins.filters.roleSudo") },
		{ value: "reseller", label: t("admins.filters.roleReseller") },
		{ value: "standard", label: t("admins.filters.roleStandard") },
	];
	const statusOptions = [
		{ value: "active", label: t("admins.filters.statusActive") },
		{ value: "disabled", label: t("admins.filters.statusDisabled") },
		{ value: "expired", label: t("admins.filters.statusExpired") },
		{ value: "limited", label: t("admins.filters.statusLimited") },
	];

	const renderFilterSelect = (
		label: string,
		value: string,
		options: { value: string; label: string }[],
		onChange: (next: string) => void,
	) => (
		<div className="flex flex-col gap-1.5">
			<span className="text-xs font-medium text-panel-text-muted">{label}</span>
			<Select value={value || ALL} onValueChange={(next) => onChange(next === ALL ? "" : next)}>
				<SelectTrigger>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value={ALL}>
						<SelectItemText>{t("admins.filters.all")}</SelectItemText>
					</SelectItem>
					{options.map((option) => (
						<SelectItem key={option.value} value={option.value}>
							<SelectItemText>{option.label}</SelectItemText>
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);

	return (
		<div className="max-sm:contents sm:flex items-center gap-2 w-full min-w-0!">
			<div className="flex min-w-0 items-center gap-2 max-sm:basis-full sm:flex-[1_1_auto] sm:max-w-[440px]">
			<SearchInput
				containerProps={{ className: "min-w-0 flex-1" }}
				placeholder={t("admins.searchPlaceholder")}
				value={search}
				onChange={(event) => {
					setSearch(event.target.value);
					debouncedSearch(event.target.value);
				}}
				matchOptions={{
					matchCase: Boolean(filters.matchCase),
					matchWholeWord: Boolean(filters.matchWholeWord),
				}}
				onMatchOptionsChange={(options) => onFilterChange({ ...options, offset: 0 })}
				onClear={() => {
					setSearch("");
					onFilterChange({ search: "", offset: 0 });
				}}
				loading={false}
			/>
			<DataTableSortMenu options={sortOptions} sorting={sorting} onSortingChange={handleSortChange} />
			</div>

			<Popover>
				<PopoverTrigger asChild>
					<button
						type="button"
						aria-label={t("admins.filters.title")}
						className={cn(buttonVariants({ variant: "outline", size: "icon" }), "relative shrink-0 rounded-full")}
					>
						<ListFilter />
						{activeFilterCount > 0 ? (
							<span className="absolute -end-1 -top-1 rounded-full bg-primary px-1.5 text-[0.6rem] leading-4 text-primary-foreground">
								{activeFilterCount}
							</span>
						) : null}
					</button>
				</PopoverTrigger>
				<PopoverContent align="start" collisionPadding={12} className="w-64 max-h-[var(--radix-popover-content-available-height)] overflow-y-auto">
					<div className="flex flex-col gap-3">
						<span className="text-sm font-semibold">{t("admins.filters.title")}</span>
						{renderFilterSelect(t("admins.filters.role"), filters.roleFilter ?? "", roleOptions, (next) =>
							onFilterChange({ roleFilter: next, offset: 0 }),
						)}
						{renderFilterSelect(t("admins.filters.status"), filters.statusFilter ?? "", statusOptions, (next) =>
							onFilterChange({ statusFilter: next, offset: 0 }),
						)}
						<LabelFilter
							type="admin"
							value={labelFilter}
							onChange={(next) =>
								onFilterChange({
									groups: next.groups,
									tags: next.tags,
									tagMatchAll: next.tagMatchAll,
									offset: 0,
								})
							}
						/>
						<button
							type="button"
							disabled={activeFilterCount === 0}
							onClick={() =>
								onFilterChange({
									roleFilter: "",
									statusFilter: "",
									groups: [],
									tags: [],
									tagMatchAll: false,
									offset: 0,
								})
							}
							className={buttonVariants({ variant: "ghost", size: "sm" })}
						>
							{t("admins.filters.clear")}
						</button>
					</div>
				</PopoverContent>
			</Popover>
		</div>
	);
};

export const AdminsCreateButton: FC = () => {
	const { t } = useTranslation();
	const openAdminDialog = useAdminsStore((state) => state.openAdminDialog);
	const { userData } = useGetUser();
	const canManageAdmins = Boolean(
		userData.permissions?.admin_management?.[AdminManagementPermission.Edit] ||
			userData.role === AdminRole.FullAccess,
	);

	if (!canManageAdmins) return null;

	return (
		<button
			type="button"
			aria-label={t("admins.addAdmin")}
			onClick={() => openAdminDialog()}
			className={cn(
				buttonVariants({ size: "default" }),
				"shrink-0 bg-panel-accent text-white shadow-xs hover:bg-panel-accent-hover",
				"gap-2 px-4 font-semibold whitespace-nowrap",
			)}
		>
			<Plus className="size-4" />
			{t("admins.addAdmin")}
		</button>
	);
};
