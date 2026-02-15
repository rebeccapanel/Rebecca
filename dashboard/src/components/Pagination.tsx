import {
	Box,
	Button,
	ButtonGroup,
	chakra,
	HStack,
	Select,
	Text,
} from "@chakra-ui/react";
import {
	ArrowLongLeftIcon,
	ArrowLongRightIcon,
} from "@heroicons/react/24/outline";
import { useAdminsStore } from "contexts/AdminsContext";
import { useDashboard } from "contexts/DashboardContext";
import { type ChangeEvent, type FC, useMemo } from "react";

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

export type PaginationProps = {
	for?: "users" | "admins";
};

const MINIMAL_PAGE_ITEM_COUNT = 5;

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

	const { t } = useTranslation();

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
	const pages = generatePageItems(noPages, page, 7);

	const changePage = (p: number) => {
		onFilterChange({
			...filters,
			offset: p * perPageNum,
		});
	};

	const handlePageSizeChange = (e: ChangeEvent<HTMLSelectElement>) => {
		const next = parseInt(e.target.value, 10);
		onFilterChange({
			...filters,
			limit: next,
			offset: 0,
		});
		if (target === "users") setUsersPerPageLimitSize(e.target.value);
		if (target === "admins") setAdminsPerPageLimitSize(e.target.value);
	};

	const canPrev = useMemo(() => page > 0 && noPages > 0, [page, noPages]);
	const canNext = useMemo(
		() => page + 1 < noPages && noPages > 0,
		[page, noPages],
	);

	if (total <= perPageNum && page === 0) {
		return null;
	}

	return (
		<HStack
			justifyContent="space-between"
			mt={4}
			w="full"
			display="flex"
			columnGap={{ lg: 4, md: 0 }}
			rowGap={{ md: 0, base: 4 }}
			flexDirection={{ md: "row", base: "column" }}
		>
			<Box order={{ base: 2, md: 1 }}>
				<HStack>
					<Select
						minW="60px"
						value={String(perPageNum)}
						onChange={handlePageSizeChange}
						size="sm"
						rounded="md"
					>
						<option value="10">10</option>
						<option value="20">20</option>
						<option value="30">30</option>
						<option value="50">50</option>
						<option value="100">100</option>
					</Select>
					<Text whiteSpace="nowrap" fontSize="sm">
						{t("itemsPerPage")}
					</Text>
				</HStack>
			</Box>

			<ButtonGroup
				size="sm"
				isAttached
				variant="outline"
				order={{ base: 1, md: 2 }}
			>
				<Button
					leftIcon={<PrevIcon />}
					onClick={() => changePage(page - 1)}
					isDisabled={!canPrev}
				>
					{t("previous")}
				</Button>

				{pages.map((pageIndex) => {
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
				})}

				<Button
					rightIcon={<NextIcon />}
					onClick={() => changePage(page + 1)}
					isDisabled={!canNext}
				>
					{t("next")}
				</Button>
			</ButtonGroup>
		</HStack>
	);
};
