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
			<Text fontWeight="semibold">{title}</Text>
		) : (
			<Box w="full">{title}</Box>
		);

	return (
		<Stack
			spacing={3}
			w="full"
			borderWidth="1px"
			borderColor="panel.border"
			borderRadius="md"
			bg="panel.surface"
			p={3}
			{...props}
		>
			<Stack
				direction={{ base: "column", xl: "row" }}
				spacing={3}
				align={{ base: "stretch", xl: "flex-start" }}
				justify="space-between"
			>
				<VStack align="flex-start" spacing={1} minW={{ base: "0", xl: "210px" }}>
					{titleContent}
					{summaryItems.length > 0 && (
						<HStack spacing={2} flexWrap="wrap">
							{summaryItems.map((item) => {
								const tag = (
									<Tag
										key={item.label}
										size="sm"
										colorScheme={item.colorScheme ?? "gray"}
										variant="subtle"
									>
										{item.label}: {item.value}
									</Tag>
								);
								return item.helper ? (
									<Tooltip key={item.label} label={item.helper} hasArrow>
										{tag}
									</Tooltip>
								) : (
									tag
								);
							})}
						</HStack>
					)}
				</VStack>
				{actions}
			</Stack>

			{hasFooter && (
				<>
					<Divider />
					<Stack
						direction={{ base: "column", xl: "row" }}
						spacing={3}
						align={{ base: "stretch", xl: "center" }}
						justify="space-between"
					>
						<Stack flex="1" minW={0} className="rb-resource-card-controls">
							{children}
						</Stack>
						{footerActions && (
							<HStack
								spacing={1.5}
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
		<IconButton variant="ghost" size="sm" icon={icon} {...props} />
	);

	return label ? (
		<Tooltip label={label}>
			<span>{button}</span>
		</Tooltip>
	) : (
		button
	);
};
