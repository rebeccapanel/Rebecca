import {
	Badge,
	Box,
	Button,
	Checkbox,
	chakra,
	Flex,
	HStack,
	IconButton,
	Input,
	InputGroup,
	InputLeftElement,
	InputRightElement,
	Popover,
	PopoverArrow,
	PopoverBody,
	PopoverCloseButton,
	PopoverContent,
	PopoverHeader,
	PopoverTrigger,
	Spinner,
	Stack,
	Text,
	Tooltip,
	useBreakpointValue,
} from "@chakra-ui/react";
import {
	FunnelIcon,
	MagnifyingGlassIcon,
	PlusIcon,
	QuestionMarkCircleIcon,
	XMarkIcon,
} from "@heroicons/react/24/outline";
import { PanelSelect as Select } from "components/common/PanelSelect";
import { ADVANCED_FILTER_OPTIONS } from "components/Filters";
import { useAdminsStore } from "contexts/AdminsContext";
import { useDashboard } from "contexts/DashboardContext";
import { useServicesStore } from "contexts/ServicesContext";
import useGetUser from "hooks/useGetUser";
import debounce from "lodash.debounce";
import type React from "react";
import { type FC, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AdminRole, AdminStatus, UserPermissionToggle } from "types/Admin";
import { isUserManagementLocked } from "utils/adminTraffic";

const iconProps = {
	baseStyle: {
		w: 4,
		h: 4,
	},
};

const SearchIcon = chakra(MagnifyingGlassIcon, iconProps);
const FilterIcon = chakra(FunnelIcon, iconProps);
const ClearIcon = chakra(XMarkIcon, iconProps);
const PlusIconStyled = chakra(PlusIcon, iconProps);
const HelpIcon = chakra(QuestionMarkCircleIcon, iconProps);

const formatChipCount = (value: number, locale: string) =>
	new Intl.NumberFormat(locale || "en").format(value);

/**
 * Users-only search & filter bar: mobile-first search + advanced filters
 * popover. Intentionally separate from the shared <Filters /> so the
 * Admins page keeps its own untouched toolbar.
 */
export const UsersFilterBar: FC = () => {
	const { loading, filters, onFilterChange, onCreateUser } = useDashboard();
	const { t, i18n } = useTranslation();
	const locale = i18n.language || "en";
	const [search, setSearch] = useState("");
	const { userData } = useGetUser();
	const hasPrivilegedRole =
		userData.role === AdminRole.Sudo || userData.role === AdminRole.FullAccess;
	const hasFullAccess = userData.role === AdminRole.FullAccess;
	const userManagementLocked = isUserManagementLocked(userData);
	const isCurrentAdminDisabled =
		!hasPrivilegedRole && userData.status === AdminStatus.Disabled;
	const canCreateUsers =
		hasFullAccess ||
		Boolean(userData.permissions?.users?.[UserPermissionToggle.Create]);
	const showCreateButton =
		canCreateUsers && !isCurrentAdminDisabled && !userManagementLocked;

	const activeFilters = filters.advancedFilters ?? [];
	const serviceId = filters.serviceId;
	const ownerFilter = filters.owner;
	const { serviceOptions: rawServiceOptions, fetchServiceOptions } =
		useServicesStore();
	const serviceOptions = Array.isArray(rawServiceOptions)
		? rawServiceOptions
		: [];
	const { adminOptions, fetchAdminOptions } = useAdminsStore();
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
		if (activeFilters.length === 0 && !serviceId && !ownerFilter) {
			return;
		}
		onFilterChange({
			advancedFilters: [],
			serviceId: undefined,
			owner: undefined,
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

	const handleCreate = () => {
		if (!showCreateButton) return;
		onCreateUser(true);
	};

	const isMobile = useBreakpointValue({ base: true, sm: false }) ?? false;

	const activeFilterTotal =
		activeFilters.length + (serviceId ? 1 : 0) + (ownerFilter ? 1 : 0);
	const hasClearableFilters = activeFilterTotal > 0;

	return (
		<Flex align="center" gap={2} w="full" minW={0}>
			<InputGroup
				flex="1 1 auto"
				minW={0}
				// Capped so the search field stays balanced inside the header
				// card instead of swallowing the whole row on wide screens.
				maxW={{ base: "100%", sm: "340px" }}
			>
				<InputLeftElement pointerEvents="none" h="full">
					<SearchIcon color="panel.textMuted" />
				</InputLeftElement>
				<Input
					className="rb-users-search-input"
					placeholder={t("search")}
					value={search}
					onChange={onSearchChange}
					borderRadius="full"
					borderColor="panel.border"
					bg="panel.elevated"
					_focusVisible={{
						borderColor: "primary.400",
						bg: "panel.surface",
					}}
				/>
				<InputRightElement w="auto" pe={1.5} h="full">
					<HStack spacing={0.5}>
						{loading && <Spinner size="xs" color="panel.textMuted" />}
						{filters.search && filters.search.length > 0 && (
							<IconButton
								onClick={clearSearch}
								aria-label={t("usersFilter.clearSearch", "Clear search")}
								size="xs"
								variant="ghost"
								borderRadius="full"
							>
								<ClearIcon />
							</IconButton>
						)}
						<Tooltip
							label={t(
								"users.searchHelp",
								"Search by username, 3x-ui subaddress, key, token, UUID, config link, or subscription URL.",
							)}
							placement="top"
							hasArrow
						>
							<Box
								display="inline-flex"
								alignItems="center"
								color="panel.textMuted"
								px={1}
							>
								<HelpIcon />
							</Box>
						</Tooltip>
					</HStack>
				</InputRightElement>
			</InputGroup>

			<Popover placement="bottom-end">
				<PopoverTrigger>
					<Box position="relative" flexShrink={0}>
						<IconButton
							aria-label={t("filters.advancedButton", "Filters")}
							icon={<FilterIcon />}
							variant="outline"
							borderRadius="full"
							w="40px"
							h="40px"
						/>
						{hasClearableFilters && (
							<Badge
								className="rb-users-filter-badge"
								colorScheme="primary"
								variant="solid"
								borderRadius="full"
								position="absolute"
								top="-4px"
								insetInlineEnd="-4px"
								fontSize="0.6rem"
								px={1.5}
								pointerEvents="none"
							>
								{formatChipCount(activeFilterTotal, locale)}
							</Badge>
						)}
					</Box>
				</PopoverTrigger>
				<PopoverContent borderColor="light-border" minW="260px">
					<PopoverArrow />
					<PopoverCloseButton />
					<PopoverHeader fontWeight="semibold">
						{t("filters.advancedTitle", "Advanced filters")}
					</PopoverHeader>
					<PopoverBody>
						<Stack spacing={2}>
							{ADVANCED_FILTER_OPTIONS.map((option) => (
								<Checkbox
									key={option.key}
									isChecked={activeFilters.includes(option.key)}
									onChange={() => toggleAdvancedFilter(option.key)}
								>
									{getFilterLabel(option.key)}
								</Checkbox>
							))}
						</Stack>
						<Stack spacing={3} mt={3}>
							<Box>
								<Text fontSize="sm" fontWeight="semibold" mb={1}>
									{t("filters.advanced.serviceLabel", "Service filter")}
								</Text>
								<Select
									value={serviceId ? String(serviceId) : ""}
									onChange={(event) => handleServiceChange(event.target.value)}
									size="sm"
								>
									<option value="">
										{t("filters.advanced.serviceAll", "All services")}
									</option>
									{serviceOptions.map((service) => (
										<option key={service.id} value={String(service.id)}>
											{service.name}
										</option>
									))}
								</Select>
							</Box>
							{hasPrivilegedRole && (
								<Box>
									<Text fontSize="sm" fontWeight="semibold" mb={1}>
										{t("filters.advanced.adminLabel", "Admin filter")}
									</Text>
									<Select
										value={ownerFilter ?? ""}
										onChange={(event) => handleAdminChange(event.target.value)}
										size="sm"
									>
										<option value="">
											{t("filters.advanced.adminAll", "All admins")}
										</option>
										<option value={userData.username}>
											{t("filters.advanced.adminMyUsers", "My users")}
										</option>
										{safeAdminOptions.map((record) => (
											<option key={record.username} value={record.username}>
												{record.username}
											</option>
										))}
									</Select>
								</Box>
							)}
						</Stack>
						<Button
							variant="ghost"
							size="sm"
							mt={3}
							w="full"
							onClick={clearAdvancedFilters}
							isDisabled={!hasClearableFilters}
						>
							{t("filters.advancedClear", "Clear filters")}
						</Button>
					</PopoverBody>
				</PopoverContent>
			</Popover>

			{/* On desktop the bulk/create actions sit at the end of the row;
				on mobile they stay compact next to the search field. */}
			{!isMobile && <Box flex="1 1 auto" minW={0} />}
			{showCreateButton &&
				(isMobile ? (
					<IconButton
						className="rb-users-create-btn"
						aria-label={t("createUser")}
						icon={<PlusIconStyled w={5} h={5} />}
						colorScheme="primary"
						borderRadius="full"
						w="40px"
						h="40px"
						flexShrink={0}
						onClick={handleCreate}
					/>
				) : (
					<Button
						className="rb-users-create-btn"
						colorScheme="primary"
						leftIcon={<PlusIconStyled />}
						borderRadius="full"
						h="40px"
						px={5}
						fontSize="sm"
						fontWeight="semibold"
						whiteSpace="nowrap"
						flexShrink={0}
						onClick={handleCreate}
					>
						{t("createUser")}
					</Button>
				))}
		</Flex>
	);
};
