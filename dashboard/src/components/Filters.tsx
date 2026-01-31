import {
	Box,
	type BoxProps,
	Button,
	Checkbox,
	chakra,
	Grid,
	GridItem,
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
	Select,
	Spinner,
	Stack,
	Tooltip,
	Tag,
	TagCloseButton,
	TagLabel,
	Text,
	useBreakpointValue,
	VStack,
	Wrap,
} from "@chakra-ui/react";
import {
	ArrowPathIcon,
	FunnelIcon,
	MagnifyingGlassIcon,
	PlusIcon,
	XMarkIcon,
	QuestionMarkCircleIcon,
} from "@heroicons/react/24/outline";
import classNames from "classnames";
import { useAdminsStore } from "contexts/AdminsContext";
import { useDashboard } from "contexts/DashboardContext";
import { useServicesStore } from "contexts/ServicesContext";
import useGetUser from "hooks/useGetUser";
import debounce from "lodash.debounce";
import type React from "react";
import { type FC, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	AdminManagementPermission,
	AdminRole,
	AdminStatus,
	UserPermissionToggle,
} from "types/Admin";
import AdvancedUserActions from "./AdvancedUserActions";

const iconProps = {
	baseStyle: {
		w: 4,
		h: 4,
	},
};

const SearchIcon = chakra(MagnifyingGlassIcon, iconProps);
const FilterIcon = chakra(FunnelIcon, iconProps);
const ClearIcon = chakra(XMarkIcon, iconProps);
export const ReloadIcon = chakra(ArrowPathIcon, iconProps);
const PlusIconStyled = chakra(PlusIcon, iconProps);
const HelpIcon = chakra(QuestionMarkCircleIcon, iconProps);

type AdvancedFilterOption = {
	key: string;
	labelKey: string;
	fallback: string;
};

const ADVANCED_FILTER_OPTIONS: AdvancedFilterOption[] = [
	{
		key: "online",
		labelKey: "filters.advanced.online",
		fallback: "Online right now",
	},
	{
		key: "offline",
		labelKey: "filters.advanced.offline",
		fallback: "Offline for 24h",
	},
	{
		key: "sub_not_updated",
		labelKey: "filters.advanced.subNotUpdated",
		fallback: "Sub link stale for 24h",
	},
	{
		key: "sub_never_updated",
		labelKey: "filters.advanced.subNeverUpdated",
		fallback: "Sub link never updated",
	},
	{
		key: "limit",
		labelKey: "filters.advanced.limit",
		fallback: "Has data limit",
	},
	{
		key: "unlimited",
		labelKey: "filters.advanced.unlimited",
		fallback: "Unlimited users",
	},
	{
		key: "finished",
		labelKey: "filters.advanced.finished",
		fallback: "Finished (limited or expired)",
	},
	{
		key: "expired",
		labelKey: "filters.advanced.statusExpired",
		fallback: "Expired users",
	},
	{
		key: "limited",
		labelKey: "filters.advanced.statusLimited",
		fallback: "Limited users",
	},
	{
		key: "disabled",
		labelKey: "filters.advanced.statusDisabled",
		fallback: "Disabled users",
	},
	{
		key: "on_hold",
		labelKey: "filters.advanced.statusOnHold",
		fallback: "On-hold users",
	},
];

export type FilterProps = { for?: "users" | "admins" } & BoxProps;

const setSearchField = debounce(
	(search: string, target: "users" | "admins") => {
		if (target === "users") {
			useDashboard.getState().onFilterChange({
				search,
				offset: 0,
			});
		} else {
			useAdminsStore.getState().onFilterChange({
				search,
				offset: 0,
			});
		}
	},
	300,
);

export const Filters: FC<FilterProps> = ({
	for: target = "users",
	...props
}) => {
	const {
		loading: usersLoading,
		filters: userFilters,
		onFilterChange: onUserFilterChange,
		refetchUsers,
		onCreateUser,
	} = useDashboard();
	const {
		loading: adminsLoading,
		filters: adminFilters,
		onFilterChange: onAdminFilterChange,
		fetchAdmins,
		openAdminDialog,
		admins: adminList,
	} = useAdminsStore();
	const { t } = useTranslation();
	const [search, setSearch] = useState("");
	const { userData } = useGetUser();
	const hasElevatedRole =
		userData.role === AdminRole.Sudo || userData.role === AdminRole.FullAccess;
	const isCurrentAdminDisabled =
		!hasElevatedRole && userData.status === AdminStatus.Disabled;
	const canManageAdmins = Boolean(
		userData.permissions?.admin_management?.[AdminManagementPermission.Edit] ||
			userData.role === AdminRole.FullAccess,
	);
	const canCreateUsers =
		hasElevatedRole ||
		Boolean(userData.permissions?.users?.[UserPermissionToggle.Create]);
	const showCreateButton =
		target === "users"
			? canCreateUsers && !isCurrentAdminDisabled
			: canManageAdmins;

	const loading = target === "users" ? usersLoading : adminsLoading;
	const isUserFilters = target === "users";
	const filters = isUserFilters ? userFilters : adminFilters;
	const userFiltersOnly = isUserFilters ? userFilters : undefined;
	const showAdvancedFilters = Boolean(userFiltersOnly);
	const activeFilters: string[] = userFiltersOnly?.advancedFilters ?? [];
	const serviceId = userFiltersOnly?.serviceId;
	const ownerFilter = userFiltersOnly?.owner;
	const { services, fetchServices } = useServicesStore();

	useEffect(() => {
		fetchServices({ limit: 500 });
	}, [fetchServices]);

	useEffect(() => {
		if (hasElevatedRole) {
			fetchAdmins({ limit: 200, offset: 0 });
		}
	}, [fetchAdmins, hasElevatedRole]);

	useEffect(() => {
		const nextSearch = isUserFilters
			? (userFilters.search ?? "")
			: (adminFilters.search ?? "");
		setSearch(nextSearch);
	}, [isUserFilters, userFilters.search, adminFilters.search]);

	const getFilterLabel = (filterKey: string) => {
		const option = ADVANCED_FILTER_OPTIONS.find(
			(item) => item.key === filterKey,
		);
		return option ? t(option.labelKey, option.fallback) : filterKey;
	};

	const toggleAdvancedFilter = (filterKey: string) => {
		if (!showAdvancedFilters) {
			return;
		}
		const nextFilters = activeFilters.includes(filterKey)
			? activeFilters.filter((item) => item !== filterKey)
			: [...activeFilters, filterKey];
		onUserFilterChange({
			advancedFilters: nextFilters,
			offset: 0,
		});
	};

	const clearAdvancedFilters = () => {
		if (!showAdvancedFilters || activeFilters.length === 0) {
			return;
		}
		onUserFilterChange({
			advancedFilters: [],
			offset: 0,
		});
	};

	const handleServiceChange = (value: string) => {
		onUserFilterChange({
			serviceId: value ? Number(value) : undefined,
			offset: 0,
		});
	};

	const handleAdminChange = (value: string) => {
		onUserFilterChange({
			owner: value || undefined,
			offset: 0,
		});
	};

	const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		setSearch(e.target.value);
		setSearchField(e.target.value, target);
	};
	const clear = () => {
		setSearch("");
		if (isUserFilters) {
			onUserFilterChange({
				...userFilters,
				offset: 0,
				search: "",
			});
		} else {
			onAdminFilterChange({
				search: "",
				offset: 0,
			});
		}
	};

	const handleRefresh = () => {
		if (target === "users") {
			refetchUsers(true);
		} else {
			fetchAdmins();
		}
	};

	const handleCreate = () => {
		if (target === "users") {
			if (isCurrentAdminDisabled || !canCreateUsers) {
				return;
			}
			onCreateUser(true);
		} else {
			if (canManageAdmins) {
				openAdminDialog();
			}
		}
	};

	const isMobile = useBreakpointValue({ base: true, sm: false }) ?? false;

	return (
		<Grid
			id="filters"
			templateColumns={{
				lg: "repeat(3, 1fr)",
				md: "repeat(2, 1fr)",
				base: "1fr",
			}}
			mx="0"
			rowGap={4}
			gap={{
				lg: 4,
				md: 4,
				base: 4,
			}}
			py={4}
			{...props}
		>
			<GridItem colSpan={{ base: 1, md: 1, lg: 1 }} order={{ base: 2, md: 1 }}>
				<VStack spacing={2} align="stretch" w="full">
					{isUserFilters && (
						<HStack spacing={1} align="center">
							<Text fontSize="xs" color="gray.500">
								{t("users.searchHelpLabel", "Search tips")}
							</Text>
							<Tooltip
								label={t(
									"users.searchHelp",
									"Search by username, key, token, UUID, config link, or subscription URL.",
								)}
								placement="top"
								hasArrow
							>
								<Box display="inline-flex" alignItems="center">
									<HelpIcon />
								</Box>
							</Tooltip>
						</HStack>
					)}
					<HStack spacing={2} align="center" w="full" flexWrap="wrap">
						<InputGroup
							flex={{ base: "1 1 100%", sm: "1 1 auto" }}
							minW={{ base: "100%", sm: "200px" }}
							maxW={{ base: "100%", sm: "none" }}
						>
							<InputLeftElement pointerEvents="none">
								<SearchIcon />
							</InputLeftElement>
							<Input
								placeholder={
									target === "users"
										? t("search")
										: t("admins.searchPlaceholder", "Search admins...")
								}
								value={search}
								borderColor="light-border"
								w="full"
								onChange={onChange}
							/>

							<InputRightElement>
								{loading && <Spinner size="xs" />}
								{filters.search && filters.search.length > 0 && (
									<IconButton
										onClick={clear}
										aria-label="clear"
										size="xs"
										variant="ghost"
									>
										<ClearIcon />
									</IconButton>
								)}
							</InputRightElement>
						</InputGroup>
						{showAdvancedFilters && (
							<Popover placement="bottom-start">
								<PopoverTrigger>
									<Button
										leftIcon={<FilterIcon />}
										size={isMobile ? "sm" : "md"}
										variant="outline"
										minW={isMobile ? "auto" : "8rem"}
										h={isMobile ? "36px" : undefined}
										fontSize={isMobile ? "xs" : "sm"}
										flex={{ base: "1 1 auto", sm: "0 1 auto" }}
									>
										{t("filters.advancedButton", "Filters")}
									</Button>
								</PopoverTrigger>
								<PopoverContent borderColor="light-border" minW="250px">
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
													onChange={(event) =>
														handleServiceChange(event.target.value)
													}
													size="sm"
												>
													<option value="">
														{t("filters.advanced.serviceAll", "All services")}
													</option>
													{services.map((service) => (
														<option key={service.id} value={String(service.id)}>
															{service.name}
														</option>
													))}
												</Select>
											</Box>
											{hasElevatedRole && (
												<Box>
													<Text fontSize="sm" fontWeight="semibold" mb={1}>
														{t("filters.advanced.adminLabel", "Admin filter")}
													</Text>
													<Select
														value={ownerFilter ?? ""}
														onChange={(event) =>
															handleAdminChange(event.target.value)
														}
														size="sm"
													>
														<option value="">
															{t("filters.advanced.adminAll", "All admins")}
														</option>
														<option value={userData.username}>
															{t("filters.advanced.adminMyUsers", "My users")}
														</option>
														{adminList.map((record) => (
															<option
																key={record.username}
																value={record.username}
															>
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
											isDisabled={activeFilters.length === 0}
										>
											{t("filters.advancedClear", "Clear filters")}
										</Button>
									</PopoverBody>
								</PopoverContent>
							</Popover>
						)}
						<Button
							aria-label="refresh"
							isDisabled={loading}
							onClick={handleRefresh}
							size={isMobile ? "sm" : "md"}
							variant="outline"
							leftIcon={
								<ReloadIcon
									className={classNames({
										"animate-spin": loading,
									})}
								/>
							}
							minW={isMobile ? "auto" : "8rem"}
							h={isMobile ? "36px" : undefined}
							fontSize={isMobile ? "xs" : "sm"}
							flex={{ base: "1 1 auto", sm: "0 1 auto" }}
						>
							{t("refresh", "Refresh")}
						</Button>
					</HStack>
					{showAdvancedFilters &&
						(activeFilters.length > 0 ||
							Boolean(serviceId) ||
							Boolean(ownerFilter)) && (
							<Wrap mt={2} spacing={2}>
								{activeFilters.map((filterKey) => (
									<Tag
										key={filterKey}
										size="sm"
										borderRadius="full"
										variant="solid"
										colorScheme="primary"
									>
										<TagLabel>{getFilterLabel(filterKey)}</TagLabel>
										<TagCloseButton
											onClick={(event) => {
												event.preventDefault();
												event.stopPropagation();
												toggleAdvancedFilter(filterKey);
											}}
										/>
									</Tag>
								))}
								{serviceId && (
									<Tag
										key="service"
										size="sm"
										borderRadius="full"
										variant="solid"
										colorScheme="primary"
									>
										<TagLabel>
											{t("filters.advanced.serviceTag", "Service: {{name}}", {
												name:
													services.find((service) => service.id === serviceId)
														?.name ?? serviceId,
											})}
										</TagLabel>
										<TagCloseButton
											onClick={(event) => {
												event.preventDefault();
												event.stopPropagation();
												handleServiceChange("");
											}}
										/>
									</Tag>
								)}
								{ownerFilter && (
									<Tag
										key="owner"
										size="sm"
										borderRadius="full"
										variant="solid"
										colorScheme="primary"
									>
										<TagLabel>
											{ownerFilter === userData.username
												? t("filters.advanced.adminTagMine", "My users")
												: ownerFilter}
										</TagLabel>
										<TagCloseButton
											onClick={(event) => {
												event.preventDefault();
												event.stopPropagation();
												handleAdminChange("");
											}}
										/>
									</Tag>
								)}
							</Wrap>
						)}
				</VStack>
			</GridItem>
			<GridItem colSpan={{ base: 1, md: 1, lg: 2 }} order={{ base: 1, md: 2 }}>
				<Stack
					direction={{ base: "column", sm: "row" }}
					spacing={{ base: 2, sm: 3 }}
					justifyContent={{ base: "flex-start", md: "flex-end" }}
					alignItems={{ base: "stretch", sm: "center" }}
					w="full"
					flexWrap="wrap"
				>
					{target === "users" && <AdvancedUserActions />}
					{showCreateButton && (
						<Button
							colorScheme="primary"
							size={isMobile ? "sm" : "md"}
							onClick={handleCreate}
							isDisabled={target === "admins" && !canManageAdmins}
							leftIcon={isMobile ? undefined : <PlusIconStyled />}
							h={isMobile ? "36px" : undefined}
							minW={isMobile ? "auto" : "8.5rem"}
							fontSize={isMobile ? "xs" : "sm"}
							fontWeight="semibold"
							whiteSpace="nowrap"
							w={{ base: "full", sm: "auto" }}
						>
							{target === "users"
								? t("createUser")
								: t("admins.addAdmin", "Add admin")}
						</Button>
					)}
				</Stack>
			</GridItem>
		</Grid>
	);
};
