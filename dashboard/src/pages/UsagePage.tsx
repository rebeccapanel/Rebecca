import {
	Box,
	Flex,
	Spinner,
	Text,
	VStack,
} from "@chakra-ui/react";
import AdminsUsage from "components/AdminsUsage";
import NodesUsageAnalytics from "components/NodesUsageAnalytics";
import ServiceUsageAnalytics from "components/ServiceUsageAnalytics";
import { PageHeader, ResourceListCard, TabSystem } from "components/ui";
import { useServicesStore } from "contexts/ServicesContext";
import useGetUser from "hooks/useGetUser";
import { type FC, useCallback, useEffect, useMemo, useState } from "react";
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
	const tabKeys = useMemo(() => ["services", "admins", "nodes"], []);
	const splitHash = useCallback(() => {
		const hash = window.location.hash || "";
		const idx = hash.indexOf("#", 1);
		return {
			base: idx >= 0 ? hash.slice(0, idx) : hash,
			tab: idx >= 0 ? hash.slice(idx + 1) : "",
		};
	}, []);

	useEffect(() => {
		const syncFromHash = () => {
			const { tab } = splitHash();
			const idx = tabKeys.indexOf(tab.toLowerCase());
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
	}, [splitHash, tabKeys]);

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
			<ResourceListCard
				title={
					<PageHeader
						title={t("usage.title", "Usage Analytics")}
						description={t(
							"usage.description",
							"Track usage trends across services, admins, and nodes from a single place.",
						)}
					/>
				}
			/>

			<TabSystem
				overflowX="auto"
				overflowY="hidden"
				maxW="full"
				sx={{
					WebkitOverflowScrolling: "touch",
					scrollbarWidth: "none",
					"&::-webkit-scrollbar": { display: "none" },
					button: { flexShrink: 0 },
				}}
				tabs={[
					{
						value: "services",
						isActive: activeTab === 0,
						onClick: () => handleTabChange(0),
						label: t("usage.tabs.services", "Services"),
					},
					{
						value: "admins",
						isActive: activeTab === 1,
						onClick: () => handleTabChange(1),
						label: t("usage.tabs.admins", "Admins"),
					},
					{
						value: "nodes",
						isActive: activeTab === 2,
						onClick: () => handleTabChange(2),
						label: t("usage.tabs.nodes", "Nodes"),
					},
				]}
			/>
			<Box mt={3} display={activeTab === 0 ? "block" : "none"}>
				<ServiceUsageAnalytics services={services} />
			</Box>
			<Box mt={3} display={activeTab === 1 ? "block" : "none"}>
				<AdminsUsage />
			</Box>
			<Box mt={3} display={activeTab === 2 ? "block" : "none"}>
				<NodesUsageAnalytics />
			</Box>
		</VStack>
	);
};

export default UsagePage;
