import {
	Box,
	Flex,
	HStack,
	Tag,
	TagLabel,
	TagLeftIcon,
	Text,
	VStack,
} from "@chakra-ui/react";
import {
	BoltIcon,
	ClockIcon,
	UserGroupIcon,
} from "@heroicons/react/24/outline";
import { useTranslation } from "react-i18next";
import { Statistics } from "../components/Statistics";

export const DashboardPage = () => {
	const { t } = useTranslation();

	return (
		<VStack spacing={6} align="stretch">
			<Box pt={2} pb={4} px={{ base: 1, md: 2 }}>
				<Flex
					direction={{ base: "column", md: "row" }}
					justify="space-between"
					align={{ base: "flex-start", md: "center" }}
					gap={5}
				>
					<Box>
						<Text
							as="h1"
							fontSize="3xl"
							fontWeight="extrabold"
							color="panel.text"
							letterSpacing="tight"
						>
							{t("dashboard")}
						</Text>
						<Text
							fontSize="sm"
							color="panel.textSecondary"
							mt={1}
							fontWeight="medium"
						>
							{t("dashboard.subtitle")}
						</Text>
					</Box>
					<HStack spacing={3} flexWrap="wrap">
						<Tag
							size="md"
							variant="subtle"
							colorScheme="green"
							borderRadius="full"
							px={4}
							py={2}
						>
							<TagLeftIcon boxSize="14px" as={BoltIcon} />
							<TagLabel fontWeight="bold">
								{t("systemOverview")}: {t("live")}
							</TagLabel>
						</Tag>
						<Tag
							size="md"
							variant="subtle"
							colorScheme="green"
							borderRadius="full"
							px={4}
							py={2}
						>
							<TagLeftIcon boxSize="14px" as={UserGroupIcon} />
							<TagLabel fontWeight="bold">
								{t("usersOverview")}: {t("live")}
							</TagLabel>
						</Tag>
						<Tag
							size="md"
							variant="subtle"
							colorScheme="blue"
							borderRadius="full"
							px={4}
							py={2}
						>
							<TagLeftIcon boxSize="14px" as={ClockIcon} />
							<TagLabel fontWeight="bold">
								{t("dashboard.updateInterval")}: {t("dashboard.every3Seconds")}
							</TagLabel>
						</Tag>
					</HStack>
				</Flex>
			</Box>
			<Statistics />
		</VStack>
	);
};
