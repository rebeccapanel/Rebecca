import {
	HStack,
	Icon,
	Tab,
	TabList,
	TabPanel,
	TabPanels,
	Tabs,
	Text,
	VStack,
} from "@chakra-ui/react";
import { LinkIcon, Squares2X2Icon } from "@heroicons/react/24/outline";
import { HostsManager } from "components/HostsManager";
import { InboundsManager } from "components/InboundsManager";
import { fetchInbounds } from "contexts/DashboardContext";
import { useHosts } from "contexts/HostsContext";
import useGetUser from "hooks/useGetUser";
import { type FC, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

export const HostsPage: FC = () => {
	const { t } = useTranslation();
	const { userData, getUserIsSuccess } = useGetUser();
	const { fetchHosts } = useHosts();
	const [activeTab, setActiveTab] = useState<number>(0);
	const tabKeys = useMemo(() => ["inbounds", "hosts"], []);
	const hostsTabIndex = 1;
	const canManageHosts =
		getUserIsSuccess && Boolean(userData.permissions?.sections.hosts);
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

	useEffect(() => {
		if (activeTab !== hostsTabIndex) {
			return;
		}
		if (!canManageHosts) {
			return;
		}
		fetchInbounds();
		fetchHosts();
	}, [activeTab, canManageHosts, fetchHosts]);

	const handleTabChange = (index: number) => {
		setActiveTab(index);
		const key = tabKeys[index] || "";
		const { base } = splitHash();
		window.location.hash = `${base || "#"}#${key}`;
	};
	if (!canManageHosts) {
		return (
			<VStack spacing={4} align="stretch">
				<Text as="h1" fontWeight="semibold" fontSize="2xl">
					{t("header.hostSettings", "Inbounds & Hosts")}
				</Text>
				<Text fontSize="sm" color="gray.500" _dark={{ color: "gray.400" }}>
					{t(
						"hostsPage.noPermission",
						"You do not have permission to manage host or inbound settings.",
					)}
				</Text>
			</VStack>
		);
	}

	return (
		<VStack spacing={4} align="stretch">
			<Text as="h1" fontWeight="semibold" fontSize="2xl">
				{t("header.hostSettings", "Inbounds & Hosts")}
			</Text>
			<Tabs
				colorScheme="primary"
				isLazy
				index={activeTab}
				onChange={handleTabChange}
			>
				<TabList>
					<Tab>
						<HStack spacing={2}>
							<Icon as={LinkIcon} w={4} h={4} />
							<span>{t("hostsPage.tabInbounds", "Inbounds")}</span>
						</HStack>
					</Tab>
					<Tab>
						<HStack spacing={2}>
							<Icon as={Squares2X2Icon} w={4} h={4} />
							<span>{t("hostsPage.tabHosts", "Hosts")}</span>
						</HStack>
					</Tab>
				</TabList>
				<TabPanels>
					<TabPanel px={0}>
						<VStack spacing={4} align="stretch">
							<Text color="gray.500" fontSize="sm">
								{t(
									"hostsPage.tabInboundsDescription",
									"Manage and customize Xray inbounds, transport layers, security, and sniffing options.",
								)}
							</Text>
							<InboundsManager />
						</VStack>
					</TabPanel>
					<TabPanel px={0}>
						<VStack spacing={4} align="stretch">
							<Text color="gray.500" fontSize="sm">
								{t(
									"hostsPage.tabHostsDescription",
									"Assign hosts to inbounds, adjust ordering, and fine-tune SNI, paths, and transport overrides.",
								)}
							</Text>
							<HostsManager />
						</VStack>
					</TabPanel>
				</TabPanels>
			</Tabs>
		</VStack>
	);
};

export default HostsPage;
