import { Tooltip, TooltipContent, TooltipTrigger } from "components/ui/tooltip";
import { Button } from "components/ui/button";
import { Badge } from "components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "components/ui/popover";
import { Checkbox } from "components/ui/checkbox";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { withClass } from "lib/withClass";


import { buttonVariants } from "components/ui/button";
import { Plus, Filter, CircleHelp } from "lucide-react";
import { cn } from "lib/cn";

import { PanelSelect as Select } from "components/common/PanelSelect";
import {
	LabelFilter,
	type LabelFilterValue,
	labelFilterCount,
} from "components/labels/LabelFilter";
import { SearchInput } from "components/common/SearchInput";
import { DataTableSortMenu, type SortOption } from "components/ui/DataTableSortMenu";
import { ADVANCED_FILTER_OPTIONS } from "constants/advancedFilters";
import { useAdminsStore } from "contexts/AdminsContext";
import { useDashboard } from "contexts/DashboardContext";
import { useServicesStore } from "contexts/ServicesContext";
import useGetUser from "hooks/useGetUser";
import type { SortingState } from "@tanstack/react-table";
import debounce from "lodash.debounce";
import type React from "react";
import { type FC, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AdminRole, AdminStatus, UserPermissionToggle } from "types/Admin";
import { canViewUserTraffic, isUserManagementLocked } from "utils/adminTraffic";

const FilterIcon = withClass(Filter, "w-4 h-4");
const HelpIcon = withClass(CircleHelp, "w-4 h-4");

const formatChipCount = (value: number, locale: string) =>
	new Intl.NumberFormat(locale || "en").format(value);

/**
 * Users-only search & filter bar: mobile-first search + advanced filters
 * popover. Intentionally separate from the shared <Filters /> so the
 * Admins page keeps its own untouched toolbar.
 */
export const UsersFilterBar: FC = () => {
	const loading = useDashboard((state) => state.loading);
	const filters = useDashboard((state) => state.filters);
	const onFilterChange = useDashboard((state) => state.onFilterChange);
	const { t, i18n } = useTranslation();
	const locale = i18n.language || "en";
	const [search, setSearch] = useState("");
	const { userData } = useGetUser();
	const hasPrivilegedRole =
		userData.role === AdminRole.Sudo || userData.role === AdminRole.FullAccess;
	const canViewTraffic = canViewUserTraffic(userData);

	const userSortOptions = useMemo<SortOption[]>(
		() => [
			{ id: "username", label: t("username"), type: "text" },
			{ id: "id", label: t("usersTable.userId"), type: "number" },
			{ id: "status", label: t("usersTable.status"), type: "text" },
			{ id: "service", label: t("usersTable.service"), type: "text" },
			{ id: "admin", label: t("usersTable.admin"), type: "text" },
			{ id: "used_traffic", label: t("usersTable.traffic"), type: "number" },
			{ id: "remaining_traffic", label: t("usersTable.remainingTraffic"), type: "number" },
			{ id: "lifetime_used_traffic", label: t("usersTable.lifetimeUsage"), type: "number" },
			{ id: "expire", label: t("usersTable.expire"), type: "date" },
			{ id: "online", label: t("usersTable.online"), type: "date" },
			{ id: "last_connection", label: t("bulkActions.delete.lastOnline"), type: "date" },
		],
		[t],
	);
	const userSortKey = (filters.sort ?? "").replace(/^-/, "");
	const userSorting: SortingState = userSortOptions.some((option) => option.id === userSortKey)
		? [{ id: userSortKey, desc: (filters.sort ?? "").startsWith("-") }]
		: [];
	const handleUserSortChange = (next: SortingState) => {
		const item = next[0];
		onFilterChange({
			sort: item ? `${item.desc ? "-" : ""}${item.id}` : "-created_at",
			offset: 0,
		});
	};
	const activeFilters = filters.advancedFilters ?? [];
	const serviceId = filters.serviceId;
	const ownerFilter = filters.owner;
	const labelFilter: LabelFilterValue = {
		groups: filters.groups ?? [],
		tags: filters.tags ?? [],
		tagMatchAll: Boolean(filters.tagMatchAll),
	};
	const matchOptions = {
		matchCase: Boolean(filters.matchCase),
		matchWholeWord: Boolean(filters.matchWholeWord),
	};
	const rawServiceOptions = useServicesStore((state) => state.serviceOptions);
	const fetchServiceOptions = useServicesStore(
		(state) => state.fetchServiceOptions,
	);
	const serviceOptions = Array.isArray(rawServiceOptions)
		? rawServiceOptions
		: [];
	const adminOptions = useAdminsStore((state) => state.adminOptions);
	const fetchAdminOptions = useAdminsStore((state) => state.fetchAdminOptions);
	const safeAdminOptions = Array.isArray(adminOptions) ? adminOptions : [];

	const debouncedSearchChange = useMemo(
		() =>
			debounce((nextSearch: string) => {
				onFilterChange({
					search: nextSearch,
					offset: 0,
				});
			}, 300),
		[onFilterChange],
	);

	useEffect(() => {
		return () => {
			debouncedSearchChange.cancel();
		};
	}, [debouncedSearchChange]);

	useEffect(() => {
		fetchServiceOptions({ limit: 1000 });
	}, [fetchServiceOptions]);

	useEffect(() => {
		if (hasPrivilegedRole) {
			fetchAdminOptions({ limit: 1000, offset: 0, sort: "username" });
		}
	}, [fetchAdminOptions, hasPrivilegedRole]);

	useEffect(() => {
		setSearch(filters.search ?? "");
	}, [filters.search]);

	const getFilterLabel = (filterKey: string) => {
		const option = ADVANCED_FILTER_OPTIONS.find(
			(item) => item.key === filterKey,
		);
		return option ? t(option.labelKey, option.fallback) : filterKey;
	};

	const toggleAdvancedFilter = (filterKey: string) => {
		const nextFilters = activeFilters.includes(filterKey)
			? activeFilters.filter((item) => item !== filterKey)
			: [...activeFilters, filterKey];
		onFilterChange({
			advancedFilters: nextFilters,
			offset: 0,
		});
	};

	const clearAdvancedFilters = () => {
		if (
			activeFilters.length === 0 &&
			!serviceId &&
			!ownerFilter &&
			labelFilterCount(labelFilter) === 0
		) {
			return;
		}
		onFilterChange({
			advancedFilters: [],
			serviceId: undefined,
			owner: undefined,
			groups: [],
			tags: [],
			tagMatchAll: false,
			offset: 0,
		});
	};

	const handleServiceChange = (value: string) => {
		onFilterChange({
			serviceId: value ? Number(value) : undefined,
			offset: 0,
		});
	};

	const handleAdminChange = (value: string) => {
		onFilterChange({
			owner: value || undefined,
			offset: 0,
		});
	};

	const onSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
		setSearch(event.target.value);
		debouncedSearchChange(event.target.value);
	};

	const clearSearch = () => {
		debouncedSearchChange.cancel();
		setSearch("");
		onFilterChange({
			...filters,
			offset: 0,
			search: "",
		});
	};

	const activeFilterTotal =
		activeFilters.length +
		(serviceId ? 1 : 0) +
		(ownerFilter ? 1 : 0) +
		labelFilterCount(labelFilter);
	const hasClearableFilters = activeFilterTotal > 0;

	return (
		<div className="max-sm:contents sm:flex items-center gap-2 w-full min-w-0!">
			<div className="flex min-w-0 items-center gap-2 max-sm:basis-full sm:flex-[1_1_auto] sm:max-w-[440px]">
			<SearchInput containerProps={{ className: "min-w-0 flex-1" }} placeholder={t("search")} value={search} onChange={onSearchChange} matchOptions={matchOptions} onMatchOptionsChange={(options) =>
					onFilterChange({
						matchCase: options.matchCase,
						matchWholeWord: options.matchWholeWord,
						offset: 0,
					})
				} loading={loading} onClear={clearSearch} rightElement={
					<Tooltip>
<TooltipTrigger asChild>
						<div className="inline-flex items-center text-panel-text-muted px-1">
							<HelpIcon />
						</div>
					</TooltipTrigger>
<TooltipContent>{t("users.searchHelp")}</TooltipContent>
</Tooltip>
				} className="rounded-full border-panel-border! bg-panel-elevated focus-visible:border-primary-400! focus-visible:bg-panel-surface rb-users-search-input" />
			<DataTableSortMenu
				options={userSortOptions}
				sorting={userSorting}
				onSortingChange={handleUserSortChange}
			/>
			</div>

			<Popover>
				<PopoverTrigger asChild>
					<div className="relative shrink-0">
						<Button aria-label={t("filters.advancedButton")} variant="outline" className={cn("size-9 p-0", "rounded-full w-9 h-9")}>{<FilterIcon />}</Button>
						{hasClearableFilters && (
							<Badge className="top-[-4px] rounded-full absolute end-[-4px] text-[0.6rem] px-1.5 pointer-events-none rb-users-filter-badge">
								{formatChipCount(activeFilterTotal, locale)}
							</Badge>
						)}
					</div>
				</PopoverTrigger>
				<PopoverContent collisionPadding={12} className="border-light-border! min-w-[260px]! max-h-[var(--radix-popover-content-available-height)] overflow-y-auto">
					
					
					<div className={cn("p-3 font-semibold", "font-semibold")}>
						{t("filters.advancedTitle")}
					</div>
					<div className="p-3">
						<div className="flex flex-col gap-2">
							{ADVANCED_FILTER_OPTIONS.filter(
								(option) => option.key !== "top_speed" || canViewTraffic,
							).map((option) => (
								<label key={option.key} className="flex cursor-pointer items-center gap-2 text-sm"><Checkbox checked={activeFilters.includes(option.key)} onCheckedChange={() => toggleAdvancedFilter(option.key)} /><span>{getFilterLabel(option.key)}</span></label>
							))}
						</div>
						<div className="flex flex-col gap-3 mt-3">
							<div>
								<p className="text-[0.875rem] font-semibold mb-1">
									{t("filters.advanced.serviceLabel")}
								</p>
								<Select
									value={serviceId ? String(serviceId) : ""}
									onChange={(event) => handleServiceChange(event.target.value)}
									portalled={false}
									size="sm"
								>
									<option value="">{t("filters.advanced.serviceAll")}</option>
									{serviceOptions.map((service) => (
										<option key={service.id} value={String(service.id)}>
											{service.name}
										</option>
									))}
								</Select>
							</div>
							{hasPrivilegedRole && (
								<div>
									<p className="text-[0.875rem] font-semibold mb-1">
										{t("filters.advanced.adminLabel")}
									</p>
									<Select
										value={ownerFilter ?? ""}
										onChange={(event) => handleAdminChange(event.target.value)}
										portalled={false}
										size="sm"
									>
										<option value="">{t("filters.advanced.adminAll")}</option>
										<option value={userData.username}>
											{t("filters.advanced.adminMyUsers")}
										</option>
										{safeAdminOptions.map((record) => (
											<option key={record.username} value={record.username}>
												{record.username}
											</option>
										))}
									</Select>
								</div>
							)}
							<LabelFilter
								type="user"
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
						</div>
						<Button onClick={clearAdvancedFilters} disabled={!hasClearableFilters} variant="ghost" size="sm" className="mt-3 w-full">
							{t("filters.advancedClear")}
						</Button>
					</div>
				</PopoverContent>
			</Popover>

		</div>
	);
};

export const UsersCreateButton: FC = () => {
	const onCreateUser = useDashboard((state) => state.onCreateUser);
	const { t } = useTranslation();
	const { userData } = useGetUser();
	const hasPrivilegedRole =
		userData.role === AdminRole.Sudo || userData.role === AdminRole.FullAccess;
	const canCreateUsers =
		userData.role === AdminRole.FullAccess ||
		Boolean(userData.permissions?.users?.[UserPermissionToggle.Create]);
	const isCurrentAdminDisabled =
		!hasPrivilegedRole && userData.status === AdminStatus.Disabled;
	const showCreateButton =
		canCreateUsers && !isCurrentAdminDisabled && !isUserManagementLocked(userData);

	if (!showCreateButton) return null;

	return (
		<button
			type="button"
			aria-label={t("createUser")}
			onClick={() => onCreateUser(true)}
			className={cn(
				buttonVariants({ size: "default" }),
				"shrink-0 gap-2 bg-panel-accent px-4 font-semibold text-white shadow-xs hover:bg-panel-accent-hover whitespace-nowrap rb-users-create-btn",
			)}
		>
			<Plus className="size-4" />
			{t("createUser")}
		</button>
	);
};
