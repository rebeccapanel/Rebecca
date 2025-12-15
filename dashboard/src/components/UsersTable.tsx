import {
	Accordion,
	AccordionButton,
	AccordionItem,
	AccordionPanel,
	Box,
	Button,
	chakra,
	type ExpandedIndex,
	Flex,
	HStack,
	IconButton,
	Select,
	Skeleton,
	SkeletonText,
	Slider,
	SliderFilledTrack,
	type SliderProps,
	SliderTrack,
	type SystemStyleObject,
	Table,
	type TableProps,
	Tbody,
	Td,
	Text,
	Th,
	Thead,
	Tooltip,
	Tr,
	useBreakpointValue,
	VStack,
} from "@chakra-ui/react";
import {
	CheckIcon,
	ChevronDownIcon,
	ClipboardIcon,
	LinkIcon,
	PencilIcon,
	QrCodeIcon,
} from "@heroicons/react/24/outline";
import { LockClosedIcon } from "@heroicons/react/24/solid";
import { ReactComponent as AddFileIcon } from "assets/add_file.svg";
import classNames from "classnames";
import { resetStrategy, statusColors } from "constants/UserSettings";
import { type FilterType, useDashboard } from "contexts/DashboardContext";
import useGetUser from "hooks/useGetUser";
import { t } from "i18next";
import {
	type ChangeEvent,
	type FC,
	Fragment,
	useEffect,
	useState,
} from "react";
import CopyToClipboard from "react-copy-to-clipboard";
import { useTranslation } from "react-i18next";
import { AdminRole, AdminStatus, UserPermissionToggle } from "types/Admin";
import type { User, UserListItem } from "types/User";
import { formatBytes } from "utils/formatByte";
import { OnlineBadge } from "./OnlineBadge";
import { OnlineStatus } from "./OnlineStatus";
import { StatusBadge } from "./StatusBadge";

const EmptySectionIcon = chakra(AddFileIcon);

const iconProps = {
	baseStyle: {
		w: {
			base: 4,
			md: 5,
		},
		h: {
			base: 4,
			md: 5,
		},
	},
};
const CopyIcon = chakra(ClipboardIcon, iconProps);
const AccordionArrowIcon = chakra(ChevronDownIcon, iconProps);
const CopiedIcon = chakra(CheckIcon, iconProps);
const SubscriptionLinkIcon = chakra(LinkIcon, iconProps);
const QRIcon = chakra(QrCodeIcon, iconProps);
const EditIcon = chakra(PencilIcon, iconProps);
const SortIcon = chakra(ChevronDownIcon, {
	baseStyle: {
		width: "15px",
		height: "15px",
	},
});
const LockOverlayIcon = chakra(LockClosedIcon, {
	baseStyle: {
		width: {
			base: 16,
			md: 20,
		},
		height: {
			base: 16,
			md: 20,
		},
	},
});
type UsageSliderProps = {
	used: number;
	total: number | null;
	dataLimitResetStrategy: string | null;
	totalUsedTraffic: number;
	isRTL?: boolean;
} & SliderProps;

const getResetStrategy = (strategy: string): string => {
	const entry = resetStrategy.find((item) => item.value === strategy);
	return entry?.title ?? "No";
};
const UsageSliderCompact: FC<UsageSliderProps> = (props) => {
	const { used, total } = props;
	const isUnlimited = total === 0 || total === null;
	return (
		<HStack
			justifyContent="space-between"
			fontSize="xs"
			fontWeight="medium"
			color="gray.600"
			_dark={{
				color: "gray.400",
			}}
		>
			<Text whiteSpace="nowrap">
				<chakra.span dir="ltr" sx={{ unicodeBidi: "isolate" }}>
					{formatBytes(used)} /{" "}
					{isUnlimited ? (
						<Text as="span" fontFamily="system-ui">
							∞
						</Text>
					) : (
						formatBytes(total)
					)}
				</chakra.span>
			</Text>
		</HStack>
	);
};
const UsageSlider: FC<UsageSliderProps> = (props) => {
	const {
		used,
		total,
		dataLimitResetStrategy,
		totalUsedTraffic,
		isRTL = false,
		...restOfProps
	} = props;
	const isUnlimited = total === 0 || total === null;
	const isReached = !isUnlimited && (used / total) * 100 >= 100;
	return (
		<>
			<Slider
				orientation="horizontal"
				value={isUnlimited ? 100 : Math.min((used / total) * 100, 100)}
				colorScheme={isReached ? "red" : "primary"}
				{...restOfProps}
			>
				<SliderTrack h="6px" borderRadius="full">
					<SliderFilledTrack borderRadius="full" />
				</SliderTrack>
			</Slider>
			<Flex
				justify="space-between"
				align="center"
				fontSize="xs"
				fontWeight="medium"
				color="gray.600"
				gap={3}
				flexWrap="wrap"
				dir={isRTL ? "rtl" : "ltr"}
				w="full"
				_dark={{
					color: "gray.400",
				}}
			>
				<Text whiteSpace="nowrap">
					<chakra.span dir="ltr" sx={{ unicodeBidi: "isolate" }}>
						{formatBytes(used)} /{" "}
						{isUnlimited ? (
							<Text as="span" fontFamily="system-ui">
								∞
							</Text>
						) : (
							formatBytes(total)
						)}
					</chakra.span>{" "}
					{!isUnlimited &&
						dataLimitResetStrategy &&
						dataLimitResetStrategy !== "no_reset" &&
						t(
							"userDialog.resetStrategy" +
								getResetStrategy(dataLimitResetStrategy),
						)}
				</Text>
				<Flex align="center" gap={1} whiteSpace="nowrap">
					<Text>{t("usersTable.total")}:</Text>
					<chakra.span dir="ltr" sx={{ unicodeBidi: "isolate" }}>
						{formatBytes(totalUsedTraffic)}
					</chakra.span>
				</Flex>
			</Flex>
		</>
	);
};
export type SortType = {
	sort: string;
	column: string;
};
export const Sort: FC<SortType> = ({ sort, column }) => {
	if (sort.includes(column))
		return (
			<SortIcon
				transform={sort.startsWith("-") ? undefined : "rotate(180deg)"}
			/>
		);
	return null;
};
type UsersTableProps = {} & TableProps;
export const UsersTable: FC<UsersTableProps> = (props) => {
	const {
		filters,
		users: { users, total },
		onEditingUser,
		onFilterChange,
		loading,
	} = useDashboard();

	const { t, i18n } = useTranslation();
	const isRTL = i18n.dir(i18n.language) === "rtl";
	const [selectedRow, setSelectedRow] = useState<ExpandedIndex | undefined>(
		undefined,
	);
	const { className, sx, ...restProps } = props;
	const rtlTableBaseSx: SystemStyleObject | undefined = isRTL
		? {
				"& th": { textAlign: "start" },
				"& td": { textAlign: "start" },
				tableLayout: "fixed",
			}
		: undefined;
	const normalizedSx: SystemStyleObject | undefined = Array.isArray(sx)
		? Object.assign({}, ...sx)
		: (sx as SystemStyleObject | undefined);
	const combinedTableSx: SystemStyleObject | undefined = rtlTableBaseSx
		? { ...rtlTableBaseSx, ...(normalizedSx || {}) }
		: normalizedSx;
	const tableClassName = isRTL
		? classNames(className, "rb-rtl-table")
		: className;
	const tableDir = isRTL ? "rtl" : "ltr";
	const tableProps = {
		...restProps,
		className: tableClassName,
		dir: tableDir,
		sx: combinedTableSx,
	};

	const useTable = useBreakpointValue({ base: false, md: true });

	const { userData } = useGetUser();
	const hasElevatedRole =
		userData.role === AdminRole.Sudo || userData.role === AdminRole.FullAccess;
	const isAdminDisabled = Boolean(
		!hasElevatedRole && userData.status === AdminStatus.Disabled,
	);
	const canCreateUsers =
		hasElevatedRole ||
		Boolean(userData.permissions?.users?.[UserPermissionToggle.Create]);
	const _canDeleteUsers =
		hasElevatedRole ||
		Boolean(userData.permissions?.users?.[UserPermissionToggle.Delete]);
	const _canResetUsage =
		hasElevatedRole ||
		Boolean(userData.permissions?.users?.[UserPermissionToggle.ResetUsage]);
	const _canRevokeSubscription =
		hasElevatedRole ||
		Boolean(userData.permissions?.users?.[UserPermissionToggle.Revoke]);
	const disabledReason = userData.disabled_reason;

	const isFiltered = users.length !== total;

	const rowsToRender = filters.limit || 10;

	const handleSort = (column: string) => {
		let newSort = filters.sort;
		if (newSort.includes(column)) {
			if (newSort.startsWith("-")) {
				newSort = "-created_at";
			} else {
				newSort = `-${column}`;
			}
		} else {
			newSort = column;
		}
		onFilterChange({
			sort: newSort,
		});
	};
	const handleStatusFilter = (e: ChangeEvent<HTMLSelectElement>) => {
		const nextStatus = (e.target.value.length > 0
			? e.target.value
			: undefined) as FilterType["status"];
		onFilterChange({
			status: nextStatus,
		});
	};

	const toggleAccordion = (index: number) => {
		setSelectedRow(index === selectedRow ? undefined : index);
	};

	return (
		<Box position="relative" w="full">
			<Box
				id="users-table"
				overflowX={{ base: "auto", md: "auto" }}
				w="full"
				className="users-table-container"
				sx={{
					containerType: "inline-size",
					"@container (max-width: 1100px)": {
						".col-service": {
							display: "none",
						},
					},
				}}
				filter={isAdminDisabled ? "blur(4px)" : undefined}
				pointerEvents={isAdminDisabled ? "none" : undefined}
				aria-hidden={isAdminDisabled ? true : undefined}
			>
				<Accordion
					allowMultiple
					display={{ base: "block", md: "none" }}
					index={selectedRow}
				>
					<Table orientation="vertical" zIndex="docked" {...tableProps}>
						<Thead zIndex="docked" position="relative">
							<Tr>
								<Th
									minW="120px"
									pl={4}
									pr={4}
									cursor={"pointer"}
									onClick={handleSort.bind(null, "username")}
								>
									<HStack>
										<span>{t("users")}</span>
										<Sort sort={filters.sort} column="username" />
									</HStack>
								</Th>
								<Th minW="50px" pl={0} pr={0} w="140px" cursor={"pointer"}>
									<HStack spacing={0} position="relative">
										<Text
											position="absolute"
											_dark={{
												bg: "gray.750",
											}}
											_light={{
												bg: "#F9FAFB",
											}}
											userSelect="none"
											pointerEvents="none"
											zIndex={1}
											w="100%"
										>
											{t("usersTable.status")}
											{filters.status ? `: ${filters.status}` : ""}
										</Text>
										<Select
											value={filters.status ?? ""}
											fontSize="xs"
											fontWeight="extrabold"
											textTransform="uppercase"
											cursor="pointer"
											p={0}
											border={0}
											h="auto"
											w="auto"
											icon={<span />}
											_focusVisible={{
												border: "0 !important",
											}}
											onChange={handleStatusFilter}
										>
											<option value=""></option>
											<option value="active">active</option>
											<option value="on_hold">on_hold</option>
											<option value="disabled">disabled</option>
											<option value="limited">limited</option>
											<option value="expired">expired</option>
										</Select>
									</HStack>
								</Th>
								<Th
									minW="100px"
									cursor={"pointer"}
									pr={0}
									onClick={handleSort.bind(null, "used_traffic")}
								>
									<HStack>
										<span>{t("usersTable.dataUsage")}</span>
										<Sort sort={filters.sort} column="used_traffic" />
									</HStack>
								</Th>
								<Th minW="32px" w="32px" p={0} cursor={"pointer"}></Th>
							</Tr>
						</Thead>
						<Tbody>
							{!useTable &&
								(loading
									? Array.from(
											{ length: rowsToRender },
											(_, idx) => `skeleton-${idx}`,
										).map((skeletonKey) => (
											<Fragment key={skeletonKey}>
												<Tr>
													<Td borderBottom={0} minW="100px" pl={4} pr={4}>
														<SkeletonText noOfLines={1} width="40%" />
													</Td>
													<Td borderBottom={0} minW="50px" pl={0} pr={0}>
														<Skeleton height="16px" width="64px" />
													</Td>
													<Td borderBottom={0} minW="100px" pr={0}>
														<Skeleton height="16px" width="120px" />
													</Td>
													<Td p={0} borderBottom={0} w="32px" minW="32px">
														<Skeleton height="16px" width="16px" />
													</Td>
												</Tr>
												<Tr className="collapsible">
													<Td p={0} colSpan={4}>
														<Box px={6} py={3}>
															<SkeletonText noOfLines={3} />
														</Box>
													</Td>
												</Tr>
											</Fragment>
										))
									: users?.map((user, i) => {
											return (
												<Fragment key={user.username}>
													<Tr
														onClick={toggleAccordion.bind(null, i)}
														cursor="pointer"
													>
														<Td
															borderBottom={0}
															minW="100px"
															pl={4}
															pr={4}
															maxW="calc(100vw - 50px - 32px - 100px - 48px)"
														>
															<div className="flex-status">
																<OnlineBadge
																	lastOnline={user.online_at ?? null}
																/>
																<Text isTruncated>{user.username}</Text>
															</div>
														</Td>
														<Td borderBottom={0} minW="50px" pl={0} pr={0}>
															<StatusBadge
																compact
																showDetail={false}
																expiryDate={user.expire}
																status={user.status}
															/>
														</Td>
														<Td borderBottom={0} minW="100px" pr={0}>
															<UsageSliderCompact
																totalUsedTraffic={user.lifetime_used_traffic}
																dataLimitResetStrategy={
																	user.data_limit_reset_strategy
																}
																used={user.used_traffic}
																total={user.data_limit}
																isRTL={isRTL}
																colorScheme={
																	statusColors[user.status].bandWidthColor
																}
															/>
														</Td>
														<Td p={0} borderBottom={0} w="32px" minW="32px">
															<AccordionArrowIcon
																color="gray.600"
																_dark={{
																	color: "gray.400",
																}}
																transition="transform .2s ease-out"
																transform={
																	selectedRow === i ? "rotate(180deg)" : "0deg"
																}
															/>
														</Td>
													</Tr>
													<Tr
														className="collapsible"
														onClick={toggleAccordion.bind(null, i)}
													>
														<Td p={0} colSpan={4}>
															<AccordionItem border={0}>
																<AccordionButton display="none"></AccordionButton>
																<AccordionPanel
																	border={0}
																	cursor="pointer"
																	px={6}
																	py={3}
																>
																	<VStack
																		justifyContent="space-between"
																		spacing="4"
																	>
																		<VStack
																			alignItems="flex-start"
																			w="full"
																			spacing={-1}
																		>
																			<Text
																				textTransform="capitalize"
																				fontSize="xs"
																				fontWeight="bold"
																				color="gray.600"
																				_dark={{
																					color: "gray.400",
																				}}
																			>
																				{t("usersTable.dataUsage")}
																			</Text>
																			<Box width="full" minW="230px">
																				<UsageSlider
																					totalUsedTraffic={
																						user.lifetime_used_traffic
																					}
																					dataLimitResetStrategy={
																						user.data_limit_reset_strategy
																					}
																					used={user.used_traffic}
																					total={user.data_limit}
																					isRTL={isRTL}
																					colorScheme={
																						statusColors[user.status]
																							.bandWidthColor
																					}
																				/>
																			</Box>
																		</VStack>
																		<VStack
																			alignItems="flex-start"
																			w="full"
																			spacing={1}
																		>
																			<Text
																				textTransform="capitalize"
																				fontSize="xs"
																				fontWeight="bold"
																				color="gray.600"
																				_dark={{
																					color: "gray.400",
																				}}
																			>
																				{t("usersTable.service", "Service")}
																			</Text>
																			<Text
																				fontSize="sm"
																				color={
																					user.service_name
																						? "gray.700"
																						: "gray.500"
																				}
																				_dark={{
																					color: user.service_name
																						? "gray.200"
																						: "gray.500",
																				}}
																			>
																				{user.service_name ??
																					t(
																						"usersTable.defaultService",
																						"Default",
																					)}
																			</Text>
																		</VStack>
																		<HStack
																			w="full"
																			justifyContent="space-between"
																		>
																			<Box width="full">
																				<StatusBadge
																					compact
																					expiryDate={user.expire}
																					status={user.status}
																				/>
																				<OnlineStatus
																					lastOnline={user.online_at ?? null}
																				/>
																			</Box>
																			<HStack>
																				<ActionButtons user={user} />
																				{canCreateUsers && (
																					<Tooltip
																						label={t("userDialog.editUser")}
																						placement="top"
																					>
																						<IconButton
																							p="0 !important"
																							aria-label="Edit user"
																							bg="transparent"
																							_dark={{
																								_hover: {
																									bg: "gray.700",
																								},
																							}}
																							size={{
																								base: "sm",
																								md: "md",
																							}}
																							onClick={(e) => {
																								e.stopPropagation();
																								onEditingUser(user);
																							}}
																						>
																							<EditIcon />
																						</IconButton>
																					</Tooltip>
																				)}
																			</HStack>
																		</HStack>
																	</VStack>
																</AccordionPanel>
															</AccordionItem>
														</Td>
													</Tr>
												</Fragment>
											);
										}))}
							{!loading && !useTable && users.length === 0 && (
								<Tr>
									<Td colSpan={4} border={0}>
										<EmptySection
											isFiltered={isFiltered}
											isCreateDisabled={isAdminDisabled}
										/>
									</Td>
								</Tr>
							)}
						</Tbody>
					</Table>
				</Accordion>
				<Box overflowX="auto" w="full" display={{ base: "none", md: "block" }}>
					<Table
						orientation="vertical"
						display={{ base: "none", md: "table" }}
						minW={{ base: "100%", md: "800px" }}
						tableLayout="fixed"
						{...tableProps}
					>
						<Thead position="relative" zIndex="docked">
							{(() => {
								const headerCells: Record<string, JSX.Element> = {
									username: (
										<Th
											minW="220px"
											cursor={"pointer"}
											onClick={handleSort.bind(null, "username")}
											textAlign="start"
											whiteSpace="nowrap"
										>
											<HStack
												direction={isRTL ? "row-reverse" : "row"}
												justify={isRTL ? "flex-end" : "flex-start"}
											>
												<span>{t("username")}</span>
												<Sort sort={filters.sort} column="username" />
											</HStack>
										</Th>
									),
									status: (
										<Th
											width="400px"
											minW="150px"
											cursor={"pointer"}
											textAlign="start"
											px={4}
										>
											<HStack
												gap={3}
												align="center"
												justify={isRTL ? "flex-end" : "space-between"}
												flexWrap="wrap"
												dir={isRTL ? "rtl" : "ltr"}
											>
												<HStack
													spacing={2}
													align="center"
													flex="1"
													onClick={handleSort.bind(null, "expire")}
													cursor="pointer"
													flexWrap="wrap"
													dir={isRTL ? "rtl" : "ltr"}
												>
													<Text>
														{t("usersTable.status")}
														{filters.status ? `: ${filters.status}` : ""}
													</Text>
													<Text>/</Text>
													<Text>{t("usersTable.sortByExpire", "Sort by expire")}</Text>
													<Sort sort={filters.sort} column="expire" />
												</HStack>
												<Select
													fontSize="xs"
													fontWeight="extrabold"
													textTransform="uppercase"
													cursor="pointer"
													p={1}
													border={0}
													h="auto"
													w="auto"
													icon={<span />}
													_focusVisible={{
														border: "0 !important",
													}}
													value={filters.status ?? ""}
													onChange={handleStatusFilter}
												>
													<option></option>
													<option>active</option>
													<option>on_hold</option>
													<option>disabled</option>
													<option>limited</option>
													<option>expired</option>
												</Select>
											</HStack>
										</Th>
									),
									service: (
										<Th
											minW="120px"
											maxW="180px"
											textAlign="start"
											display={{ base: "none", lg: "table-cell" }}
											whiteSpace="nowrap"
											overflow="hidden"
											textOverflow="ellipsis"
											className="col-service"
										>
											<span>{t("usersTable.service", "Service")}</span>
										</Th>
									),
									usage: (
										<Th
											width="350px"
											minW="230px"
											cursor={"pointer"}
											onClick={handleSort.bind(null, "used_traffic")}
											textAlign="start"
											px={4}
										>
											<HStack
												direction={isRTL ? "row-reverse" : "row"}
												justify={isRTL ? "flex-end" : "flex-start"}
											>
												<span>{t("usersTable.dataUsage")}</span>
												<Sort sort={filters.sort} column="used_traffic" />
											</HStack>
										</Th>
									),
									actions: (
										<Th
											width="200px"
											minW="180px"
											data-actions="true"
											textAlign="end"
										/>
									),
								};

								const order: Array<keyof typeof headerCells> = isRTL
									? ["actions", "usage", "service", "status", "username"]
									: ["username", "status", "service", "usage", "actions"];

								return (
									<Tr>
										{order.map((key) => headerCells[key])}
									</Tr>
								);
							})()}
						</Thead>
						<Tbody>
							{useTable &&
								(loading
									? Array.from(
											{ length: rowsToRender },
											(_, idx) => `skeleton-desktop-${idx}`,
										).map((skeletonKey) => {
											const cells = {
												username: (
													<Td minW="220px" textAlign="start">
														<SkeletonText noOfLines={1} width="40%" />
													</Td>
												),
												status: (
													<Td width="400px" minW="150px" textAlign="start">
														<Skeleton height="16px" width="120px" />
													</Td>
												),
												service: (
													<Td
														minW="120px"
														maxW="180px"
														textAlign="start"
														display={{ base: "none", lg: "table-cell" }}
														className="col-service"
													>
														<SkeletonText noOfLines={1} width="60%" />
													</Td>
												),
												usage: (
													<Td width="350px" minW="230px" textAlign="start">
														<Skeleton height="16px" width="200px" />
													</Td>
												),
												actions: (
													<Td width="200px" minW="180px" textAlign="end">
														<Skeleton height="16px" width="64px" />
													</Td>
												),
											};
											const order: Array<keyof typeof cells> = isRTL
												? ["actions", "usage", "service", "status", "username"]
												: ["username", "status", "service", "usage", "actions"];
											return <Tr key={skeletonKey}>{order.map((key) => cells[key])}</Tr>;
										})
									: users?.map((user, i) => {
											const cells = {
												username: (
													<Td minW="220px" textAlign="start">
														<Box
															display="grid"
															gridTemplateColumns={{
																base: "1fr",
																md: "minmax(0,1fr) auto",
															}}
															gridTemplateRows={{ base: "auto auto", md: "auto" }}
															alignItems="center"
															gap={2}
															dir={isRTL ? "rtl" : "ltr"}
														>
															<HStack
																className="flex-status"
																spacing={2}
																justify="flex-start"
																minW={0}
															>
																<OnlineBadge lastOnline={user.online_at ?? null} />
																<Text
																	as="span"
																	dir="ltr"
																	sx={{ unicodeBidi: "isolate" }}
																	noOfLines={1}
																	minW={0}
																	overflow="hidden"
																	textOverflow="ellipsis"
																	whiteSpace="nowrap"
																>
																	{user.username}
																</Text>
															</HStack>
															<Box
																gridRow={{ base: 2, md: "auto" }}
																justifySelf={isRTL ? "start" : "end"}
																textAlign={isRTL ? "start" : "end"}
																whiteSpace="nowrap"
															>
																<OnlineStatus lastOnline={user.online_at ?? null} />
															</Box>
														</Box>
													</Td>
												),
												status: (
													<Td
														width="400px"
														minW="150px"
														textAlign="start"
													>
														<StatusBadge
															expiryDate={user.expire}
															status={user.status}
														/>
													</Td>
												),
												service: (
													<Td
														minW="120px"
														maxW="180px"
														textAlign="start"
														display={{ base: "none", lg: "table-cell" }}
														minWidth={0}
														className="col-service"
													>
														<Text
															fontSize="sm"
															color={
																user.service_name ? "gray.700" : "gray.500"
															}
															_dark={{
																color: user.service_name
																	? "gray.200"
																	: "gray.500",
															}}
															noOfLines={1}
															minWidth={0}
															whiteSpace="nowrap"
															overflow="hidden"
															textOverflow="ellipsis"
														>
															{user.service_name ??
																t("usersTable.defaultService", "Default")}
														</Text>
													</Td>
												),
												usage: (
													<Td
														width="350px"
														minW="230px"
														textAlign="start"
													>
														<UsageSlider
															totalUsedTraffic={user.lifetime_used_traffic}
															dataLimitResetStrategy={
																user.data_limit_reset_strategy
															}
															used={user.used_traffic}
															total={user.data_limit}
															isRTL={isRTL}
															colorScheme={
																statusColors[user.status].bandWidthColor
															}
														/>
													</Td>
												),
												actions: (
													<Td
														width="200px"
														minW="180px"
														data-actions="true"
														textAlign="end"
													>
														<ActionButtons user={user} />
													</Td>
												),
											};
											const order: Array<keyof typeof cells> = isRTL
												? ["actions", "usage", "service", "status", "username"]
												: ["username", "status", "service", "usage", "actions"];
											return (
												<Tr
													key={user.username}
													className={classNames("interactive", {
														"last-row": i === users.length - 1,
													})}
													onClick={() => {
														if (canCreateUsers) {
															onEditingUser(user);
														}
													}}
													cursor={canCreateUsers ? "pointer" : "default"}
												>
													{order.map((key) => cells[key])}
												</Tr>
											);
										}))}
							{!loading && users.length === 0 && (
								<Tr>
									<Td colSpan={5}>
										<EmptySection
											isFiltered={isFiltered}
											isCreateDisabled={isAdminDisabled || !canCreateUsers}
										/>
									</Td>
								</Tr>
							)}
						</Tbody>
					</Table>
				</Box>
			</Box>
			{isAdminDisabled && (
				<Flex
					position="absolute"
					inset={0}
					align="center"
					justify="center"
					direction="column"
					textAlign="center"
					px={6}
					py={8}
					bg="rgba(255, 255, 255, 0.85)"
					_dark={{ bg: "rgba(15, 23, 42, 0.9)" }}
					zIndex="overlay"
				>
					<LockOverlayIcon color="red.400" mb={6} />
					<Text fontSize="xl" fontWeight="bold" mb={3}>
						{t("usersTable.adminDisabledTitle", "Your account is disabled")}
					</Text>
					<Text maxW="480px" color="gray.600" _dark={{ color: "gray.200" }}>
						{disabledReason ||
							t(
								"usersTable.adminDisabledDescription",
								"Please contact the sudo admin to regain access.",
							)}
					</Text>
				</Flex>
			)}
		</Box>
	);
};

type ActionButtonsUser = User | UserListItem;
type ActionButtonsProps = {
	user: ActionButtonsUser;
};

// Helper function to generate links from templates and link_data
const generateUserLinks = (
	user: ActionButtonsUser,
	linkTemplates?: Record<string, string[]>,
): string[] => {
	// If user has link_data and link_templates, generate links from them
	if ((user as User).link_data && linkTemplates && user.status === "active") {
		const links: string[] = [];
		let dataIndex = 0;

		// Iterate through templates in order and match with link_data
		for (const [protocol, templates] of Object.entries(linkTemplates)) {
			for (const template of templates) {
				// Find matching link_data for this template
				const linkDataList = (user as User).link_data;
				if (linkDataList && dataIndex < linkDataList.length) {
					const linkData = linkDataList[dataIndex];

					// Only process if protocol matches
					if (linkData.protocol === protocol) {
						let link = template;

						// Replace placeholders
						if (linkData.uuid) {
							link = link.replace(/{UUID}/g, linkData.uuid);
						} else if (linkData.password) {
							link = link.replace(
								/{PASSWORD}/g,
								encodeURIComponent(linkData.password),
							);
						} else if (linkData.password_b64) {
							link = link.replace(/{PASSWORD_B64}/g, linkData.password_b64);
						}

						links.push(link);
						dataIndex++;
					}
				}
			}
		}

		if (links.length > 0) {
			return links;
		}
	}

	// Fallback to user.links if available
	const legacyLinks = (user as Partial<User>).links;
	return legacyLinks || [];
};

const ActionButtons: FC<ActionButtonsProps> = ({ user }) => {
	const { setQRCode, setSubLink, linkTemplates } = useDashboard();

	// Generate links from templates or use existing links
	const userLinks = generateUserLinks(user, linkTemplates);
	const proxyLinks = userLinks.join("\r\n");
	const formatLink = (link?: string | null) => {
		if (!link) return "";
		return link.startsWith("/") ? window.location.origin + link : link;
	};
	// Priority: key-based URL if credential_key exists, else legacy token-based URL
	// subscription_url now contains the correct URL based on whether user has key or not
	const subscriptionLink = formatLink(user.subscription_url);

	const [copied, setCopied] = useState([-1, false]);
	useEffect(() => {
		if (copied[1]) {
			setTimeout(() => {
				setCopied([-1, false]);
			}, 1000);
		}
	}, [copied]);
	return (
		<HStack
			justifyContent="flex-end"
			onClick={(e) => {
				e.preventDefault();
				e.stopPropagation();
			}}
		>
			<CopyToClipboard
				text={subscriptionLink}
				onCopy={() => {
					setCopied([0, true]);
				}}
			>
				<div>
					<Tooltip
						label={
							copied[0] === 0 && copied[1]
								? t("usersTable.copied")
								: t("usersTable.copyLink")
						}
						placement="top"
					>
						<IconButton
							p="0 !important"
							aria-label="copy subscription link"
							bg="transparent"
							_dark={{
								_hover: {
									bg: "gray.700",
								},
							}}
							size={{
								base: "sm",
								md: "md",
							}}
						>
							{copied[0] === 0 && copied[1] ? (
								<CopiedIcon />
							) : (
								<SubscriptionLinkIcon />
							)}
						</IconButton>
					</Tooltip>
				</div>
			</CopyToClipboard>
			<CopyToClipboard
				text={proxyLinks}
				onCopy={() => {
					setCopied([1, true]);
				}}
			>
				<div>
					<Tooltip
						label={
							copied[0] === 1 && copied[1]
								? t("usersTable.copied")
								: t("usersTable.copyConfigs")
						}
						placement="top"
					>
						<IconButton
							p="0 !important"
							aria-label="copy configs"
							bg="transparent"
							_dark={{
								_hover: {
									bg: "gray.700",
								},
							}}
							size={{
								base: "sm",
								md: "md",
							}}
						>
							{copied[0] === 1 && copied[1] ? <CopiedIcon /> : <CopyIcon />}
						</IconButton>
					</Tooltip>
				</div>
			</CopyToClipboard>
			<Tooltip label="QR Code" placement="top">
				<IconButton
					p="0 !important"
					aria-label="qr code"
					bg="transparent"
					_dark={{
						_hover: {
							bg: "gray.700",
						},
					}}
					size={{
						base: "sm",
						md: "md",
					}}
					onClick={() => {
						const userLinks = generateUserLinks(user, linkTemplates);
						setQRCode(userLinks);
						setSubLink(subscriptionLink);
					}}
				>
					<QRIcon />
				</IconButton>
			</Tooltip>
		</HStack>
	);
};

type EmptySectionProps = {
	isFiltered: boolean;
	isCreateDisabled: boolean;
};

const EmptySection: FC<EmptySectionProps> = ({
	isFiltered,
	isCreateDisabled,
}) => {
	const { onCreateUser } = useDashboard();
	const handleCreate = () => {
		if (isCreateDisabled) {
			return;
		}
		onCreateUser(true);
	};
	return (
		<Box
			padding="5"
			py="8"
			display="flex"
			alignItems="center"
			flexDirection="column"
			gap={4}
			w="full"
		>
			<EmptySectionIcon
				maxHeight="200px"
				maxWidth="200px"
				_dark={{
					'path[fill="#fff"]': {
						fill: "gray.800",
					},
					'path[fill="#f2f2f2"], path[fill="#e6e6e6"], path[fill="#ccc"]': {
						fill: "gray.700",
					},
					'circle[fill="#3182CE"]': {
						fill: "primary.300",
					},
				}}
				_light={{
					'path[fill="#f2f2f2"], path[fill="#e6e6e6"], path[fill="#ccc"]': {
						fill: "gray.300",
					},
					'circle[fill="#3182CE"]': {
						fill: "primary.500",
					},
				}}
			/>
			<Text fontWeight="medium" color="gray.600" _dark={{ color: "gray.400" }}>
				{isFiltered ? t("usersTable.noUserMatched") : t("usersTable.noUser")}
			</Text>
			{!isFiltered && !isCreateDisabled && (
				<Button size="sm" colorScheme="primary" onClick={handleCreate}>
					{t("createUser")}
				</Button>
			)}
		</Box>
	);
};
