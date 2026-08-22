import {
	Box,
	Divider,
	HStack,
	IconButton,
	Stack,
	Tag,
	Text,
	Tooltip,
	VStack,
	type StackProps,
} from "@chakra-ui/react";
import type { FC, ReactElement, ReactNode } from "react";

export type ResourceSummaryItem = {
	label: string;
	value: string | number;
	helper?: string;
	colorScheme?: string;
};

type ResourceListCardProps = Omit<StackProps, "title"> & {
	title: ReactNode;
	summaryItems?: ResourceSummaryItem[];
	actions?: ReactNode;
	footerActions?: ReactNode;
	children?: ReactNode;
};

export const ResourceListCard: FC<ResourceListCardProps> = ({
	title,
	summaryItems = [],
	actions,
	footerActions,
	children,
	...props
}) => {
	const hasFooter = Boolean(children || footerActions);
	const titleContent =
		typeof title === "string" || typeof title === "number" ? (
			<Text fontWeight="bold" fontSize="lg">{title}</Text>
		) : (
			<Box w="full">{title}</Box>
		);

	return (
		<Stack
			spacing={4}
			w="full"
			borderWidth="1px"
			borderColor="panel.border"
			borderRadius="xl"
			bg="panel.surface"
			p={{ base: 4, md: 5 }}
			transition="all 0.25s ease"
			_hover={{ "@media (min-width: 768px)": { boxShadow: "sm" } }}
			{...props}
		>
			<Stack
				direction={{ base: "column", xl: "row" }}
				spacing={4}
				align={{ base: "stretch", xl: "flex-start" }}
				justify="space-between"
			>
				<VStack align="flex-start" spacing={3} minW={{ base: "0", xl: "210px" }}>
					{titleContent}
					{summaryItems.length > 0 && (
						<HStack spacing={2} flexWrap="wrap">
							{summaryItems.map((item) => {
								const tag = (
									<Tag
										key={item.label}
										size="md"
										borderRadius="full"
										px={3}
										py={1}
										colorScheme={item.colorScheme ?? "gray"}
										variant="subtle"
										fontWeight="medium"
									>
										{item.label}: <Text as="span" fontWeight="bold" ms={1}>{item.value}</Text>
									</Tag>
								);
								return item.helper ? (
									<Tooltip key={item.label} label={item.helper} hasArrow placement="top">
										{tag}
									</Tooltip>
								) : (
									tag
								);
							})}
						</HStack>
					)}
				</VStack>
				{actions && <Box>{actions}</Box>}
			</Stack>

			{hasFooter && (
				<>
					<Divider borderColor="panel.border" />
					<Stack
						direction={{ base: "column", xl: "row" }}
						spacing={4}
						align={{ base: "stretch", xl: "center" }}
						justify="space-between"
					>
						<Stack flex="1" minW={0} className="rb-resource-card-controls">
							{children}
						</Stack>
						{footerActions && (
							<HStack
								spacing={2}
								flexWrap="wrap"
								justify={{ base: "flex-start", xl: "flex-end" }}
							>
								{footerActions}
							</HStack>
						)}
					</Stack>
				</>
			)}
		</Stack>
	);
};

export const ResourceRefreshButton: FC<{
	"aria-label": string;
	icon: ReactElement;
	label?: ReactNode;
	isLoading?: boolean;
	onClick: () => void;
}> = ({ icon, label, ...props }) => {
	const button = (
		<IconButton variant="ghost" size="sm" borderRadius="md" icon={icon} {...props} />
	);

	return label ? (
		<Tooltip label={label} hasArrow placement="top">
			<span>{button}</span>
		</Tooltip>
	) : (
		button
	);
};
