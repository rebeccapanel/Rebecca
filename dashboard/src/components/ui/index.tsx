import {
	Box,
	Button,
	Flex,
	IconButton,
	SimpleGrid,
	Skeleton,
	Table,
	Tbody,
	Td,
	Text,
	Th,
	Thead,
	Tr,
	type BoxProps,
	type ButtonProps,
	type IconButtonProps,
} from "@chakra-ui/react";
import type { ComponentProps, FC, PropsWithChildren, ReactNode } from "react";

export { BulkActionBar } from "./BulkActionBar";
export { DataTable } from "./DataTable";
export {
	ResourceListCard,
	ResourceRefreshButton,
	type ResourceSummaryItem,
} from "./ResourceListCard";
export { RowActionsMenu } from "./DataTableRowActions";
export type { RowActionItem } from "./DataTableRowActions";
export { StatusBadge } from "./StatusBadge";
export type {
	DataTableBulkAction,
	DataTableColumn,
	DataTableProps,
	DataTableRowAction,
} from "./DataTable.types";

export const AppShell: FC<PropsWithChildren<BoxProps>> = ({
	children,
	...props
}) => (
	<Box minH="100vh" bg="panel.app" color="panel.text" {...props}>
		{children}
	</Box>
);

export const AppTopbar: FC<PropsWithChildren<BoxProps>> = ({
	children,
	...props
}) => (
	<Box
		bg="panel.surface"
		borderBottomWidth="1px"
		borderColor="panel.border"
		{...props}
	>
		{children}
	</Box>
);

type PageHeaderProps = PropsWithChildren<
	Omit<BoxProps, "title"> & {
		title?: ReactNode;
		description?: ReactNode;
		actions?: ReactNode;
	}
>;

export const PageHeader: FC<PageHeaderProps> = ({
	children,
	title,
	description,
	actions,
	...props
}) => {
	if (!title && !description && !actions) {
		return (
			<Box w="full" color="panel.text" {...props}>
				{children}
			</Box>
		);
	}

	return (
		<Box w="full" color="panel.text" {...props}>
			<Flex
				align={{ base: "flex-start", md: "center" }}
				justify="space-between"
				gap={3}
				flexWrap="wrap"
			>
				<Box minW={0}>
					{title && (
						<Text as="h1" fontSize="2xl" fontWeight="semibold">
							{title}
						</Text>
					)}
					{description && (
						<Text
							fontSize="sm"
							color="panel.textSecondary"
							mt={title ? 1 : 0}
						>
							{description}
						</Text>
					)}
					{children}
				</Box>
				{actions && <Box flexShrink={0}>{actions}</Box>}
			</Flex>
		</Box>
	);
};

type PageTabItem = {
	label: ReactNode;
	value: string;
	isActive?: boolean;
	onClick?: () => void;
};

type TabSystemProps = BoxProps & {
	tabs: PageTabItem[];
};

export const TabSystem: FC<TabSystemProps> = ({ tabs, ...props }) => (
	<Box
		className="rb-tab-system"
		display="flex"
		gap={6}
		minH="10"
		px={{ base: 2, md: 3 }}
		overflowX="auto"
		overflowY="hidden"
		maxW="full"
		whiteSpace="nowrap"
		sx={{
			WebkitOverflowScrolling: "touch",
			scrollbarWidth: "none",
			"&::-webkit-scrollbar": { display: "none" },
			"& > button": { flex: "0 0 auto" },
		}}
		{...props}
	>
		{tabs.map((tab) => (
			<Button
				key={tab.value}
				variant="ghost"
				size="sm"
				px={0}
				h="10"
				borderRadius="0"
				borderBottomWidth="2px"
				borderColor={tab.isActive ? "panel.accent" : "transparent"}
				color={tab.isActive ? "panel.accent" : "panel.text"}
				fontWeight="700"
				_hover={{ bg: "transparent", color: "panel.accentHover" }}
				onClick={tab.onClick}
			>
				{tab.label}
			</Button>
		))}
	</Box>
);

export const PageTabs = TabSystem;

export type StatsStripItem = {
	label: ReactNode;
	value: ReactNode;
	helper?: ReactNode;
	accentColor?: string;
};

type StatsStripProps = Omit<ComponentProps<typeof SimpleGrid>, "children"> & {
	items: StatsStripItem[];
};

export const StatsStrip: FC<StatsStripProps> = ({
	items,
	columns,
	spacing = 3,
	...props
}) => (
	<SimpleGrid
		columns={
			columns ?? { base: 1, md: 2, xl: Math.min(Math.max(items.length, 1), 5) }
		}
		spacing={spacing}
		{...props}
	>
		{items.map((item, index) => (
			<Box
				key={`stats-strip-${index}`}
				position="relative"
				overflow="hidden"
				borderWidth="1px"
				borderColor="panel.border"
				borderRadius="6px"
				bg="panel.surface"
				px={3}
				py={2.5}
			>
				<Box
					position="absolute"
					insetInlineStart={0}
					top={0}
					bottom={0}
					w="3px"
					bg={item.accentColor ?? "panel.accent"}
				/>
				<Text fontSize="xs" color="panel.textMuted" fontWeight="semibold">
					{item.label}
				</Text>
				<Text mt={1} fontWeight="semibold" fontSize="lg" lineHeight="1.2">
					{item.value}
				</Text>
				{item.helper && (
					<Text mt={1} fontSize="xs" color="panel.textMuted">
						{item.helper}
					</Text>
				)}
			</Box>
		))}
	</SimpleGrid>
);

export const TableToolbar: FC<PropsWithChildren<BoxProps>> = ({
	children,
	...props
}) => (
	<Box
		display="flex"
		alignItems={{ base: "stretch", md: "center" }}
		justifyContent="space-between"
		gap={3}
		w="full"
		flexWrap="wrap"
		{...props}
	>
		{children}
	</Box>
);

type DataTableHeaderProps = ComponentProps<typeof Th>;
type DataTableRowProps = ComponentProps<typeof Tr> & { isSelected?: boolean };

export const DataTableHeader: FC<PropsWithChildren<DataTableHeaderProps>> = ({
	children,
	...props
}) => (
	<Th
		color="panel.text"
		fontSize="11px"
		fontWeight="800"
		letterSpacing="0"
		textTransform="none"
		{...props}
	>
		{children}
	</Th>
);

export const DataTableRow: FC<PropsWithChildren<DataTableRowProps>> = ({
	children,
	isSelected,
	...props
}) => (
	<Tr
		className="rb-data-table-row"
		data-selected={isSelected ? "true" : undefined}
		{...props}
	>
		{children}
	</Tr>
);

export const EmptyState: FC<PropsWithChildren<BoxProps>> = ({
	children,
	...props
}) => (
	<Box
		borderWidth="1px"
		borderColor="panel.border"
		bg="panel.surface"
		borderRadius="6px"
		px={4}
		py={8}
		textAlign="center"
		color="panel.textMuted"
		{...props}
	>
		{children}
	</Box>
);

export const TableSkeleton: FC<{ rows?: number; columns?: number }> = ({
	rows = 5,
	columns = 5,
}) => (
	<Table size="sm">
		<Thead>
			<Tr>
				{Array.from({ length: columns }, (_, index) => (
					<Th key={`table-skeleton-head-${index}`}>
						<Skeleton h="3" />
					</Th>
				))}
			</Tr>
		</Thead>
		<Tbody>
			{Array.from({ length: rows }, (_, rowIndex) => (
				<Tr key={`table-skeleton-row-${rowIndex}`}>
					{Array.from({ length: columns }, (_, columnIndex) => (
						<Td key={`table-skeleton-cell-${rowIndex}-${columnIndex}`}>
							<Skeleton h="4" />
						</Td>
					))}
				</Tr>
			))}
		</Tbody>
	</Table>
);

export const AppButton: FC<ButtonProps> = (props) => (
	<Button borderRadius="4px" fontWeight="700" size="sm" {...props} />
);

export const AppIconButton: FC<IconButtonProps> = (props) => (
	<IconButton borderRadius="4px" size="sm" {...props} />
);
