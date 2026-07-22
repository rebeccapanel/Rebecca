import {
	Box,
	Button,
	ButtonGroup,
	chakra,
	HStack,
	Menu,
	MenuButton,
	MenuItem,
	MenuList,
	Portal,
	Text,
	useBreakpointValue,
} from "@chakra-ui/react";
import {
	ArrowLongLeftIcon,
	ArrowLongRightIcon,
	ChevronDownIcon,
} from "@heroicons/react/24/outline";
import { useAdminsStore } from "contexts/AdminsContext";
import { useDashboard } from "contexts/DashboardContext";
import { type FC, useMemo } from "react";

import { useTranslation } from "react-i18next";
import {
	setAdminsPerPageLimitSize,
	setUsersPerPageLimitSize,
} from "utils/userPreferenceStorage";

const PrevIcon = chakra(ArrowLongLeftIcon, {
	baseStyle: {
		w: 4,
		h: 4,
	},
});
const NextIcon = chakra(ArrowLongRightIcon, {
	baseStyle: {
		w: 4,
		h: 4,
	},
});
const ChevronIcon = chakra(ChevronDownIcon, {
	baseStyle: {
		w: 4,
		h: 4,
	},
});

export type PaginationProps = {
	for?: "users" | "admins";
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

export const Pagination: FC<PaginationProps> = ({ for: target = "users" }) => {
	const {
		filters: userFilters,
		onFilterChange: onUserFilterChange,
		users: { total: usersTotal },
	} = useDashboard();

	const {
		filters: adminFilters,
		onFilterChange: onAdminFilterChange,
		total: adminsTotal,
	} = useAdminsStore();

	const { t, i18n } = useTranslation();
	const direction = i18n.dir(i18n.language);
	const isRTL = direction === "rtl";

	const { filters, total, onFilterChange } = useMemo(() => {
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

	const { limit, offset } = filters;

	const perPageNum = Number(limit || 10);
	const offsetNum = Number(offset || 0);

	const page = Math.floor(offsetNum / perPageNum);
	const noPages = Math.ceil(total / perPageNum);
	const isCompactPagination =
		useBreakpointValue({ base: true, md: false }) ?? false;
	const pages = isCompactPagination ? [] : generatePageItems(noPages, page, 7);

	const changePage = (p: number) => {
		onFilterChange({
			...filters,
			offset: p * perPageNum,
		});
	};

	const handlePageSizeSelect = (next: number) => {
		onFilterChange({
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
		<HStack
			className="rb-data-table-pagination"
			justifyContent="space-between"
			mt={4}
			w="full"
			maxW="full"
			display="flex"
			columnGap={{ lg: 4, md: 0 }}
			rowGap={{ md: 0, base: 4 }}
			flexDirection={{ md: "row", base: "column" }}
		>
			<Box order={{ base: 2, md: 1 }} w={{ base: "full", md: "auto" }}>
				<HStack justify={{ base: "center", md: "flex-start" }} minW={0}>
					<Menu
						placement={isRTL ? "top-end" : "top-start"}
						strategy="fixed"
						gutter={8}
						isLazy
					>
						<MenuButton
							as={Button}
							size="sm"
							variant="outline"
							minW={{ base: "104px", md: "112px" }}
							maxW={{ base: "104px", md: "120px" }}
							rightIcon={<ChevronIcon />}
							justifyContent="space-between"
							px={3}
						>
							{perPageNum}
						</MenuButton>
						<Portal>
							<MenuList
								dir={direction}
								zIndex={1800}
								minW={{ base: "104px", md: "112px" }}
								maxW={{ base: "104px", md: "120px" }}
								py={1}
								borderRadius="lg"
								boxShadow="2xl"
								bg="panel.surface"
								borderColor="panel.border"
								overflow="hidden"
							>
								{PAGE_SIZE_OPTIONS.map((option) => {
									const isSelected = option === perPageNum;
									return (
										<MenuItem
											key={option}
											onClick={() => handlePageSizeSelect(option)}
											fontSize="sm"
											fontWeight={isSelected ? "700" : "500"}
											bg={isSelected ? "primary.500" : "transparent"}
											color={isSelected ? "white" : "inherit"}
											_hover={{
												bg: isSelected ? "primary.600" : "panel.hover",
											}}
											_focus={{
												bg: isSelected ? "primary.600" : "panel.hover",
											}}
										>
											{option}
										</MenuItem>
									);
								})}
							</MenuList>
						</Portal>
					</Menu>
					<Text whiteSpace="nowrap" fontSize="sm">
						{t("itemsPerPage")}
					</Text>
				</HStack>
			</Box>

			{noPages > 1 && (
				<ButtonGroup
					size="sm"
					isAttached
					variant="outline"
					order={{ base: 1, md: 2 }}
					w={{ base: "full", md: "auto" }}
					maxW="full"
				>
					<Button
						leftIcon={isRTL ? <NextIcon /> : <PrevIcon />}
						onClick={() => changePage(page - 1)}
						isDisabled={!canPrev}
						flex={{ base: "1 1 0", md: "0 0 auto" }}
						px={{ base: 2, md: 3 }}
					>
						{t("previous")}
					</Button>

					{isCompactPagination ? (
						<Button
							isDisabled
							flex={{ base: "0 0 auto", md: "0 0 auto" }}
							px={{ base: 3, md: 3 }}
						>
							{page + 1} / {noPages}
						</Button>
					) : (
						pages.map((pageIndex) => {
							if (typeof pageIndex === "string")
								return <Button key={pageIndex}>...</Button>;
							return (
								<Button
									key={pageIndex}
									variant={pageIndex === page ? "solid" : "outline"}
									onClick={() => changePage(pageIndex)}
								>
									{pageIndex + 1}
								</Button>
							);
						})
					)}

					<Button
						rightIcon={isRTL ? <PrevIcon /> : <NextIcon />}
						onClick={() => changePage(page + 1)}
						isDisabled={!canNext}
						flex={{ base: "1 1 0", md: "0 0 auto" }}
						px={{ base: 2, md: 3 }}
					>
						{t("next")}
					</Button>
				</ButtonGroup>
			)}
		</HStack>
	);
};
