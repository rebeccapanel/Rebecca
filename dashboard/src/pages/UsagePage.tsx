import AdminsUsage from "components/AdminsUsage";
import NodesUsageAnalytics from "components/NodesUsageAnalytics";
import ServiceUsageAnalytics from "components/ServiceUsageAnalytics";
import { PageLoadingSkeleton, TabSystem } from "components/ui";
import {
	Card,
	CardDescription,
	CardHeader,
	CardTitle,
} from "components/ui/card";
import { useServicesStore } from "contexts/ServicesContext";
import useGetUser from "hooks/useGetUser";
import { type FC, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { getRuntimeSettings } from "service/settings";

export const UsagePage: FC = () => {
	const { t } = useTranslation();
	const { userData, getUserIsSuccess } = useGetUser();
	const canViewUsage = Boolean(
		getUserIsSuccess && userData.permissions?.sections.usage,
	);
	const { data: runtimeSettings, isLoading: isRuntimeSettingsLoading } =
		useQuery({ queryKey: ["runtime-settings"], queryFn: getRuntimeSettings, refetchOnWindowFocus: false,
			enabled: canViewUsage, });
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
		return <PageLoadingSkeleton variant="settings" />;
	}

	if (!canViewUsage) {
		return (
			<div className="flex flex-col gap-4 items-stretch">
				<h1 className="font-semibold text-[1.5rem]">
					{t("usage.title")}
				</h1>
				<p className="text-[0.875rem] text-gray-500 dark:text-gray-400">
					{t("usage.noPermission")}
				</p>
			</div>
		);
	}

	if (isRuntimeSettingsLoading) {
		return <PageLoadingSkeleton />;
	}

	if (!recordNodeUsage && !recordNodeUserUsages) {
		// First surface on a stock shadcn block: the tokens come from the alias
		// layer in tailwind.css, so no class here is panel-specific.
		return (
			<div className="flex flex-col gap-4 items-stretch">
				<h1 className="font-semibold text-[1.5rem]">{t("usage.title")}</h1>
				<Card className="py-5">
					<CardHeader>
						<CardTitle>{t("usage.title")}</CardTitle>
						<CardDescription>{t("usage.recordingDisabled")}</CardDescription>
					</CardHeader>
				</Card>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-4 items-stretch">
			<TabSystem tabs={[
					...(recordNodeUserUsages
						? [
								{
									value: "services",
									isActive: activeTab === 0,
									onClick: () => handleTabChange(0),
									label: t("usage.tabs.services"),
								},
								{
									value: "admins",
									isActive: activeTab === 1,
									onClick: () => handleTabChange(1),
									label: t("usage.tabs.admins"),
								},
							]
						: []),
					...(recordNodeUsage
						? [
								{
									value: "nodes",
									isActive: activeTab === 2,
									onClick: () => handleTabChange(2),
									label: t("usage.tabs.nodes"),
								},
							]
						: []),
				]} className="overflow-x-auto overflow-y-hidden max-w-full" />
			{activeTab === 0 && (
				<div className="mt-3">
					<ServiceUsageAnalytics services={services} />
				</div>
			)}
			{activeTab === 1 && (
				<div className="mt-3">
					<AdminsUsage />
				</div>
			)}
			{activeTab === 2 && (
				<div className="mt-3">
					<NodesUsageAnalytics />
				</div>
			)}
		</div>
	);
};

export default UsagePage;
