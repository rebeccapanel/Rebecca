import { VStack } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { Statistics } from "../components/Statistics";
import { PageHeader, ResourceListCard } from "../components/ui";

export const DashboardPage = () => {
	const { t } = useTranslation();

	return (
		<VStack spacing={5} align="stretch">
			<ResourceListCard
				title={
					<PageHeader
						title={t("dashboard")}
						description={t(
							"dashboard.subtitle",
							"Live panel health, user activity, and traffic overview.",
						)}
					/>
				}
				summaryItems={[
					{ label: t("systemOverview"), value: t("live", "Live"), colorScheme: "green" },
					{ label: t("usersOverview"), value: t("live", "Live"), colorScheme: "green" },
					{ label: t("panelUsage"), value: "3s", colorScheme: "blue" },
				]}
			/>
			<Statistics />
		</VStack>
	);
};
