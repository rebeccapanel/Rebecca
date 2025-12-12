import { Box, Text, VStack } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { Statistics } from "../components/Statistics";

export const DashboardPage = () => {
	const { t } = useTranslation();

	return (
		<VStack spacing={6} align="stretch">
			<Box>
				<Text as="h1" fontWeight="semibold" fontSize="2xl" mb={4}>
					{t("dashboard")}
				</Text>
				<Statistics />
			</Box>
		</VStack>
	);
};
