import {
	Box,
	Flex,
	SimpleGrid,
	Text,
	useColorModeValue,
	VStack,
} from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { Statistics } from "../components/Statistics";

export const DashboardPage = () => {
	const { t } = useTranslation();
	const borderColor = useColorModeValue("blackAlpha.200", "whiteAlpha.200");
	const panelBg = useColorModeValue("white", "whiteAlpha.50");
	const mutedColor = useColorModeValue("gray.600", "gray.400");
	const accentBg = useColorModeValue("primary.50", "whiteAlpha.100");
	const accentColor = useColorModeValue("primary.600", "primary.200");

	return (
		<VStack spacing={6} align="stretch">
			<Flex
				borderWidth="1px"
				borderColor={borderColor}
				borderRadius="md"
				bg={panelBg}
				px={{ base: 3, md: 4 }}
				py={4}
				align={{ base: "flex-start", md: "center" }}
				justify="space-between"
				gap={4}
				flexWrap="wrap"
			>
				<Box>
					<Text as="h1" fontWeight="semibold" fontSize="2xl">
						{t("dashboard")}
					</Text>
					<Text fontSize="sm" color={mutedColor}>
						{t(
							"dashboard.subtitle",
							"Live panel health, user activity, and traffic overview.",
						)}
					</Text>
				</Box>
				<SimpleGrid
					columns={{ base: 2, sm: 3 }}
					gap={2}
					minW={{ base: "full", md: "360px" }}
				>
					<Box borderRadius="md" bg={accentBg} px={3} py={2}>
						<Text fontSize="xs" color={mutedColor}>
							{t("systemOverview")}
						</Text>
						<Text fontSize="sm" fontWeight="semibold" color={accentColor}>
							{t("live", "Live")}
						</Text>
					</Box>
					<Box borderRadius="md" bg={accentBg} px={3} py={2}>
						<Text fontSize="xs" color={mutedColor}>
							{t("usersOverview")}
						</Text>
						<Text fontSize="sm" fontWeight="semibold" color={accentColor}>
							{t("live", "Live")}
						</Text>
					</Box>
					<Box borderRadius="md" bg={accentBg} px={3} py={2}>
						<Text fontSize="xs" color={mutedColor}>
							{t("panelUsage")}
						</Text>
						<Text fontSize="sm" fontWeight="semibold" color={accentColor}>
							3s
						</Text>
					</Box>
				</SimpleGrid>
			</Flex>
			<Statistics />
		</VStack>
	);
};
