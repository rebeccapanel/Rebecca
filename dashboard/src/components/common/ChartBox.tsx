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
	const borderColor = useColorModeValue("panel.border", "panel.border");
	const bg = useColorModeValue("panel.surface", "panel.surface");
	const headerBg = useColorModeValue("panel.surface", "panel.surface");
	const shadow = useColorModeValue("none", "none");

	return (
		<Box
			borderWidth="1px"
			borderColor={borderColor}
			borderRadius="6px"
			bg={bg}
			boxShadow={shadow}
			overflow="hidden"
			{...props}
		>
			{(title || headerActions) && (
				<Flex
					px={{ base: 3, md: 4 }}
					py={2.5}
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
							color="panel.text"
							flex="1"
							minW={{ base: "full", md: "220px" }}
						>
							{title}
						</Text>
					)}
					{headerActions && <Box maxW="full">{headerActions}</Box>}
				</Flex>
			)}
			<Box p={{ base: 3, md: 3 }}>{children}</Box>
		</Box>
	);
};
