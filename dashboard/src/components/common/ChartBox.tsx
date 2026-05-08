import {
	Box,
	type BoxProps,
	Flex,
	Text,
	useColorModeValue,
} from "@chakra-ui/react";
import type { FC, ReactNode } from "react";

export type ChartBoxProps = Omit<BoxProps, "title"> & {
	title?: ReactNode;
	children: ReactNode;
	headerActions?: ReactNode;
};

export const ChartBox: FC<ChartBoxProps> = ({
	title,
	children,
	headerActions,
	...props
}) => {
	const borderColor = useColorModeValue("blackAlpha.200", "whiteAlpha.200");
	const bg = useColorModeValue("white", "whiteAlpha.50");
	const headerBg = useColorModeValue("gray.50", "whiteAlpha.100");
	const shadow = useColorModeValue("sm", "none");

	return (
		<Box
			borderWidth="1px"
			borderColor={borderColor}
			borderRadius="md"
			bg={bg}
			boxShadow={shadow}
			overflow="hidden"
			{...props}
		>
			{(title || headerActions) && (
				<Flex
					px={{ base: 3, md: 4 }}
					py={3}
					borderBottomWidth="1px"
					borderBottomColor={borderColor}
					bg={headerBg}
					justifyContent="space-between"
					alignItems={{ base: "stretch", md: "center" }}
					gap={3}
					flexWrap="wrap"
				>
					{title && (
						<Text
							fontWeight="semibold"
							fontSize={{ base: "sm", md: "md" }}
							flex="1"
							minW={{ base: "full", md: "220px" }}
						>
							{title}
						</Text>
					)}
					{headerActions && <Box maxW="full">{headerActions}</Box>}
				</Flex>
			)}
			<Box p={{ base: 3, md: 4 }}>{children}</Box>
		</Box>
	);
};
