import {
	Box,
	HStack,
	Icon,
	Text,
	useColorModeValue,
	VStack,
} from "@chakra-ui/react";
import { LinkIcon, Squares2X2Icon } from "@heroicons/react/24/outline";
import { HostsManager } from "components/HostsManager";
import { InboundsManager } from "components/InboundsManager";
import { TabSystem } from "components/ui";
import { fetchInbounds } from "contexts/DashboardContext";
import { useHosts } from "contexts/HostsContext";
import useGetUser from "hooks/useGetUser";
import { type FC, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

export const HostsPage: FC = () => {
	const { t } = useTranslation();
	const { userData, getUserIsSuccess } = useGetUser();
	const { fetchHosts } = useHosts();
	const panelBg = useColorModeValue("gray.50", "whiteAlpha.50");
	const panelBorder = useColorModeValue("blackAlpha.200", "whiteAlpha.200");
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
				<Box
					borderWidth="1px"
					borderColor={panelBorder}
					borderRadius="md"
					bg={panelBg}
					p={4}
				>
					<Text as="h1" fontWeight="semibold" fontSize="2xl">
						{t("header.hostSettings", "Inbounds & Hosts")}
					</Text>
					<Text
						fontSize="sm"
						color="gray.500"
						_dark={{ color: "gray.400" }}
						mt={2}
					>
						{t(
							"hostsPage.noPermission",
							"You do not have permission to manage host or inbound settings.",
						)}
					</Text>
				</Box>
			</VStack>
		);
	}

	return (
		<VStack spacing={4} align="stretch">
			<Box
				borderWidth="1px"
				borderColor={panelBorder}
				borderRadius="md"
				bg={panelBg}
				p={4}
			>
				<Text as="h1" fontWeight="semibold" fontSize="2xl">
					{t("header.hostSettings", "Inbounds & Hosts")}
				</Text>
				<Text
					fontSize="sm"
					color="gray.600"
					_dark={{ color: "gray.300" }}
					mt={2}
				>
					{t(
						"hostsPage.pageDescription",
						"Manage inbound listeners and host rules from one focused workspace.",
					)}
				</Text>
			</Box>
			<TabSystem
				tabs={[
					{
						value: "inbounds",
						isActive: activeTab === 0,
						onClick: () => handleTabChange(0),
						label: (
							<HStack spacing={2}>
								<Icon as={LinkIcon} w={4} h={4} />
								<span>{t("hostsPage.tabInbounds", "Inbounds")}</span>
							</HStack>
						),
					},
					{
						value: "hosts",
						isActive: activeTab === 1,
						onClick: () => handleTabChange(1),
						label: (
							<HStack spacing={2}>
								<Icon as={Squares2X2Icon} w={4} h={4} />
								<span>{t("hostsPage.tabHosts", "Hosts")}</span>
							</HStack>
						),
					},
				]}
			/>
			{activeTab === 0 ? (
				<VStack mt={3} spacing={4} align="stretch">
					<InboundsManager />
				</VStack>
			) : (
				<VStack mt={3} spacing={4} align="stretch">
					<HostsManager />
				</VStack>
			)}
		</VStack>
	);
};

export default HostsPage;
