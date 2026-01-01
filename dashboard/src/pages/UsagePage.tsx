import {
	Flex,
	Spinner,
	Tab,
	TabList,
	TabPanel,
	TabPanels,
	Tabs,
	Text,
	VStack,
} from "@chakra-ui/react";
import AdminsUsage from "components/AdminsUsage";
import NodesUsageAnalytics from "components/NodesUsageAnalytics";
import ServiceUsageAnalytics from "components/ServiceUsageAnalytics";
import { useServicesStore } from "contexts/ServicesContext";
import useGetUser from "hooks/useGetUser";
import { type FC, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export const UsagePage: FC = () => {
	const { t } = useTranslation();
	const { userData, getUserIsSuccess } = useGetUser();
	const canViewUsage = Boolean(
		getUserIsSuccess && userData.permissions?.sections.usage,
	);

	const services = useServicesStore((state) => state.services);
	const fetchServices = useServicesStore((state) => state.fetchServices);
	const [activeTab, setActiveTab] = useState<number>(0);
	const tabKeys = ["services", "admins", "nodes"];
	const splitHash = () => {
		const hash = window.location.hash || "";
		const idx = hash.indexOf("#", 1);
		return {
			base: idx >= 0 ? hash.slice(0, idx) : hash,
			tab: idx >= 0 ? hash.slice(idx + 1) : "",
		};
	};

	useEffect(() => {
		const syncFromHash = () => {
			const { tab } = splitHash();
			const idx = tabKeys.findIndex((key) => key === tab.toLowerCase());
			if (idx >= 0) {
				setActiveTab(idx);
			} else {
				setActiveTab(0);
				const { base } = splitHash();
				window.location.hash = `${base || "#"}#${tabKeys[0]}`;
			}
		};
		syncFromHash();
		window.addEventListener("hashchange", syncFromHash);
		return () => window.removeEventListener("hashchange", syncFromHash);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const handleTabChange = (index: number) => {
		setActiveTab(index);
		const key = tabKeys[index] || "";
		const { base } = splitHash();
		window.location.hash = `${base || "#"}#${key}`;
	};

	useEffect(() => {
		if (canViewUsage) {
			fetchServices({ limit: 500 });
		}
	}, [fetchServices, canViewUsage]);

	if (!getUserIsSuccess) {
		return (
			<Flex justify="center" align="center" py={10}>
				<Spinner />
			</Flex>
		);
	}

	if (!canViewUsage) {
		return (
			<VStack spacing={4} align="stretch">
				<Text as="h1" fontWeight="semibold" fontSize="2xl">
					{t("usage.title", "Usage Analytics")}
				</Text>
				<Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }}>
					{t(
						"usage.noPermission",
						"You do not have permission to view usage analytics.",
					)}
				</Text>
			</VStack>
		);
	}

	return (
		<VStack spacing={4} align="stretch">
			<Text as="h1" fontWeight="semibold" fontSize="2xl">
				{t("usage.title", "Usage Analytics")}
			</Text>
			<Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }}>
				{t(
					"usage.description",
					"Track usage trends across services, admins, and nodes from a single place.",
				)}
			</Text>

			<Tabs
				variant="enclosed"
				colorScheme="primary"
				index={activeTab}
				onChange={handleTabChange}
			>
				<TabList>
					<Tab>{t("usage.tabs.services", "Services")}</Tab>
					<Tab>{t("usage.tabs.admins", "Admins")}</Tab>
					<Tab>{t("usage.tabs.nodes", "Nodes")}</Tab>
				</TabList>
				<TabPanels>
					<TabPanel px={0}>
						<ServiceUsageAnalytics services={services} />
					</TabPanel>
					<TabPanel px={0}>
						<AdminsUsage />
					</TabPanel>
					<TabPanel px={0}>
						<NodesUsageAnalytics />
					</TabPanel>
				</TabPanels>
			</Tabs>
		</VStack>
	);
};

export default UsagePage;
