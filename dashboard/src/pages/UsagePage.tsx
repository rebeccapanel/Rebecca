import { Box, Flex, Spinner, Text, VStack } from "@chakra-ui/react";
import AdminsUsage from "components/AdminsUsage";
import NodesUsageAnalytics from "components/NodesUsageAnalytics";
import ServiceUsageAnalytics from "components/ServiceUsageAnalytics";
import { PageHeader, ResourceListCard, TabSystem } from "components/ui";
import { useServicesStore } from "contexts/ServicesContext";
import useGetUser from "hooks/useGetUser";
import { type FC, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "react-query";
import { getRuntimeSettings } from "service/settings";

export const UsagePage: FC = () => {
	const { t } = useTranslation();
	const { userData, getUserIsSuccess } = useGetUser();
	const canViewUsage = Boolean(
		getUserIsSuccess && userData.permissions?.sections.usage,
	);
	const { data: runtimeSettings, isLoading: isRuntimeSettingsLoading } =
		useQuery("runtime-settings", getRuntimeSettings, {
			refetchOnWindowFocus: false,
			enabled: canViewUsage,
		});
	const recordNodeUsage = runtimeSettings?.record_node_usage ?? true;
	const recordNodeUserUsages = runtimeSettings?.record_node_user_usages ?? true;

	const services = useServicesStore((state) => state.services);
	const fetchServices = useServicesStore((state) => state.fetchServices);
	const [activeTab, setActiveTab] = useState<number>(0);
	const tabKeys = useMemo(() => ["services", "admins", "nodes"], []);
	const readHashTab = useCallback(
		() => (window.location.hash || "").replace(/^#/, "").toLowerCase(),
		[],
	);

	useEffect(() => {
		const syncFromHash = () => {
			const idx = tabKeys.indexOf(readHashTab());
			if (idx >= 0) {
				setActiveTab(idx);
			} else {
				setActiveTab(0);
				window.history.replaceState(
					null,
					"",
					`${window.location.pathname}${window.location.search}#${tabKeys[0]}`,
				);
			}
		};
		syncFromHash();
		window.addEventListener("hashchange", syncFromHash);
		return () => window.removeEventListener("hashchange", syncFromHash);
	}, [readHashTab, tabKeys]);

	useEffect(() => {
		if (!runtimeSettings) {
			return;
		}
		const tabEnabled = (index: number) =>
			index === 2 ? recordNodeUsage : recordNodeUserUsages;
		if (tabEnabled(activeTab)) {
			return;
		}
		const nextIndex = tabKeys.findIndex((_, index) => tabEnabled(index));
		setActiveTab(nextIndex >= 0 ? nextIndex : 0);
	}, [
		activeTab,
		recordNodeUsage,
		recordNodeUserUsages,
		runtimeSettings,
		tabKeys,
	]);

	const handleTabChange = (index: number) => {
		setActiveTab(index);
		const key = tabKeys[index] || "";
		if (readHashTab() !== key) window.location.hash = key;
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

	if (isRuntimeSettingsLoading) {
		return (
			<Flex justify="center" align="center" py={10}>
				<Spinner />
			</Flex>
		);
	}

	if (!recordNodeUsage && !recordNodeUserUsages) {
		return (
			<VStack spacing={4} align="stretch">
				<Text as="h1" fontWeight="semibold" fontSize="2xl">
					{t("usage.title", "Usage Analytics")}
				</Text>
				<Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }}>
					{t(
						"usage.recordingDisabled",
						"Usage recording is disabled from Settings.",
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
					...(recordNodeUserUsages
						? [
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
							]
						: []),
					...(recordNodeUsage
						? [
								{
									value: "nodes",
									isActive: activeTab === 2,
									onClick: () => handleTabChange(2),
									label: t("usage.tabs.nodes", "Nodes"),
								},
							]
						: []),
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
