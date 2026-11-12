import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { Link, LayoutGrid } from "lucide-react";

import { HostsManager } from "components/HostsManager";
import { InboundsManager } from "components/InboundsManager";
import { PageHeader, PageLoadingSkeleton, TabSystem } from "components/ui";
import { fetchInbounds } from "contexts/DashboardContext";
import { useHosts } from "contexts/HostsContext";
import useGetUser from "hooks/useGetUser";
import { type FC, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";

export const HostsPage: FC = () => {
	const location = useLocation();
	const { t } = useTranslation();
	const { userData, getUserIsPending, getUserIsSuccess } = useGetUser();
	const fetchHosts = useHosts((state) => state.fetchHosts);
	const [activeTab, setActiveTab] = useState<number>(0);
	const tabKeys = useMemo(() => ["inbounds", "hosts"], []);
	const hostsTabIndex = 1;
	const canManageHosts =
		getUserIsSuccess && Boolean(userData.permissions?.sections.hosts);
	const readHashTab = useCallback(
		(hash = window.location.hash) => (hash || "").replace(/^#/, "").toLowerCase(),
		[],
	);

	useEffect(() => {
		const syncFromHash = (hash: string) => {
			const idx = tabKeys.indexOf(readHashTab(hash));
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
		syncFromHash(location.hash);
		const onHashChange = () => syncFromHash(window.location.hash);
		window.addEventListener("hashchange", onHashChange);
		return () => window.removeEventListener("hashchange", onHashChange);
	}, [location.hash, readHashTab, tabKeys]);

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
		if (readHashTab() !== key) window.location.hash = key;
	};
	if (getUserIsPending) {
		return <PageLoadingSkeleton variant="settings" />;
	}
	if (!canManageHosts) {
		return (
			<div className="flex flex-col gap-4 items-stretch">
				<PageHeader title={t("header.hostSettings")} />
				<p className="text-[0.875rem] text-gray-500 dark:text-gray-400">
					{t("hostsPage.noPermission")}
				</p>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-4 items-stretch">
			<TabSystem
				tabs={[
					{
						value: "inbounds",
						isActive: activeTab === 0,
						onClick: () => handleTabChange(0),
						label: (
							<div className="flex flex-row items-center gap-2">
								<Link className="w-4 h-4" />
								<span>{t("hostsPage.tabInbounds")}</span>
							</div>
						),
					},
					{
						value: "hosts",
						isActive: activeTab === 1,
						onClick: () => handleTabChange(1),
						label: (
							<div className="flex flex-row items-center gap-2">
								<LayoutGrid className="w-4 h-4" />
								<span>{t("hostsPage.tabHosts")}</span>
							</div>
						),
					},
				]}
			/>
			{activeTab === 0 ? (
				<div className="flex flex-col mt-3 gap-4 items-stretch">
					<InboundsManager />
				</div>
			) : (
				<div className="flex flex-col mt-3 gap-4 items-stretch">
					<HostsManager />
				</div>
			)}
		</div>
	);
};

export default HostsPage;
