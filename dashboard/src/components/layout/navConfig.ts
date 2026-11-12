import useGetUser from "hooks/useGetUser";
import {
	ArrowLeftRight,
	Bell,
	BookOpen,
	Briefcase,
	ChartColumn,
	CircleUser,
	Clock,
	Copy,
	Database,
	Eye,
	FileText,
	FolderTree,
	House,
	LayoutGrid,
	Link,
	Server,
	Settings,
	Settings2,
	ShieldCheck,
	SquareCode,
	Terminal,
	TriangleAlert,
	Users,
	Wrench,
	Zap,
} from "lucide-react";
import { type ElementType, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useHref } from "react-router-dom";
import { AdminRole, AdminSection, AdminSudoScope } from "types/Admin";
import {
	getTutorialManifestUrl,
	getTutorialSeenKey,
	normalizeTutorialLang,
} from "utils/tutorials";

export const DEFAULT_TAB_BY_PATH: Record<string, string> = {
	"/settings": "panel",
	"/hosts": "inbounds",
	"/usage": "services",
	"/xray-settings": "basic",
};

export type DirectNavItem = {
	type: "direct";
	id: string;
	title: string;
	url: string;
	icon: ElementType<{ className?: string }>;
	visible: boolean;
	badge?: boolean;
};

export type GroupSubItem = {
	id: string;
	title: string;
	url: string;
	icon: ElementType<{ className?: string }>;
	visible: boolean;
};

export type GroupNavItem = {
	type: "group";
	id: string;
	title: string;
	icon: ElementType<{ className?: string }>;
	subItems: GroupSubItem[];
	visible: boolean;
};

export type NavItem = DirectNavItem | GroupNavItem;

export type NavSection = {
	id: string;
	title: string;
	items: NavItem[];
};

export function useNavSections() {
	const { t, i18n } = useTranslation();
	const dashboardRoot = useHref("/");
	const { userData } = useGetUser();
	const tutorialsUrl = "/tutorials";

	const isFullAccess = userData.role === AdminRole.FullAccess;
	const isPrivilegedAdmin = isFullAccess || userData.role === AdminRole.Sudo;
	const sectionAccess = userData.permissions?.sections;

	const defaultSelfPermissions = {
		self_myaccount: false,
		self_change_password: false,
		self_api_keys: false,
		self_placeholders: false,
	};
	const baseSelf =
		userData.permissions?.self_permissions ?? defaultSelfPermissions;
	const selfAccess = isFullAccess
		? { self_myaccount: true, self_change_password: true, self_api_keys: true }
		: baseSelf;

	const canViewUsage = Boolean(sectionAccess?.[AdminSection.Usage]);
	const canViewAdmins = Boolean(sectionAccess?.[AdminSection.Admins]);
	const canViewServicesSection = Boolean(
		sectionAccess?.[AdminSection.Services],
	);
	const canViewHosts =
		isPrivilegedAdmin && Boolean(sectionAccess?.[AdminSection.Hosts]);
	const canViewNodes = Boolean(sectionAccess?.[AdminSection.Nodes]);
	const canViewRecentActions =
		isFullAccess ||
		(userData.role === AdminRole.Sudo &&
			Boolean(userData.permissions?.sudo?.[AdminSudoScope.Xray]));
	const canManagePlaceholders =
		isFullAccess ||
		(userData.role === AdminRole.Sudo &&
			Boolean(userData.permissions?.sudo?.[AdminSudoScope.Subscriptions])) ||
		Boolean(baseSelf.self_placeholders);

	const [hasNewTutorials, setHasNewTutorials] = useState(false);

	const checkTutorialUpdates = useCallback(async () => {
		const langKey = normalizeTutorialLang(i18n.language);
		try {
			const response = await fetch(getTutorialManifestUrl(dashboardRoot), {
				headers: { "Cache-Control": "no-cache" },
			});
			if (!response.ok) return;
			const manifest = (await response.json()) as Record<string, string>;
			const version = manifest[langKey]?.toString().trim();
			if (!version) {
				setHasNewTutorials(false);
				return;
			}
			const seenKey = getTutorialSeenKey(langKey);
			const seenVersion = window.localStorage.getItem(seenKey);
			if (seenVersion === null) {
				window.localStorage.setItem(seenKey, version);
				setHasNewTutorials(false);
				return;
			}
			setHasNewTutorials(seenVersion !== version);
		} catch {
			setHasNewTutorials(false);
		}
	}, [dashboardRoot, i18n.language]);

	useEffect(() => {
		void checkTutorialUpdates();
	}, [checkTutorialUpdates]);

	const navSections: NavSection[] = useMemo(
		() => [
			{
				id: "sec_dashboard",
				title: t("sidebar.sections.dashboard", "Overview"),
				items: [
					{
						type: "direct",
						id: "dashboard",
						title: t("dashboard"),
						url: "/",
						icon: House,
						visible: true,
					},
				],
			},
			{
				id: "sec_users",
				title: t("sidebar.sections.users", "Users & Groups"),
				items: [
					{
						type: "group",
						id: "users_hub",
						title: t("sidebar.groups.userHub", "User Management"),
						icon: Users,
						visible: true,
						subItems: [
							{
								id: "users_list",
								title: t("sidebar.usersList", t("users")),
								url: "/users",
								icon: Users,
								visible: true,
							},
							{
								id: "groups",
								title: t("groups.title"),
								url: "/groups",
								icon: FolderTree,
								visible: true,
							},
							{
								id: "bulk_actions",
								title: t("bulkActions.menu"),
								url: "/bulk-actions",
								icon: Zap,
								visible: true,
							},
						],
					},
				],
			},
			{
				id: "sec_infrastructure",
				title: t("sidebar.sections.infrastructure", "Infrastructure"),
				items: [
					{
						type: "direct",
						id: "nodes",
						title: t("header.nodeSettings"),
						url: "/node-settings",
						icon: Server,
						visible: canViewNodes,
					},
					{
						type: "direct",
						id: "hosts",
						title: t("header.hostSettings"),
						url: "/hosts",
						icon: Link,
						visible: canViewHosts,
					},
					{
						type: "direct",
						id: "services",
						title: t("services.title"),
						url: "/services",
						icon: LayoutGrid,
						visible: canViewServicesSection,
					},
				],
			},
			{
				id: "sec_traffic_admins",
				title: t("sidebar.sections.trafficAndAdmins", "Traffic & Admins"),
				items: [
					{
						type: "direct",
						id: "myaccount",
						title: t("myaccount.menu"),
						url: "/myaccount",
						icon: CircleUser,
						visible: Boolean(selfAccess.self_myaccount),
					},
					{
						type: "direct",
						id: "usage",
						title: t("usage.menu"),
						url: "/usage",
						icon: ChartColumn,
						visible: canViewUsage,
					},
					{
						type: "direct",
						id: "admins",
						title: t("admins"),
						url: "/admins",
						icon: Briefcase,
						visible: canViewAdmins,
					},
				],
			},
			{
				id: "sec_system",
				title: t("sidebar.sections.system", "System & Operations"),
				items: [
					{
						type: "group",
						id: "core_routing",
						title: t("sidebar.groups.coreRouting", "Core & Routing"),
						icon: Wrench,
						visible:
							Boolean(sectionAccess?.[AdminSection.Xray]) || isPrivilegedAdmin,
						subItems: [
							{
								id: "xray_settings",
								title: t("header.xraySettings"),
								url: "/xray-settings",
								icon: Wrench,
								visible: Boolean(sectionAccess?.[AdminSection.Xray]),
							},
							{
								id: "haproxy",
								title: t("haproxy.title"),
								url: "/haproxy",
								icon: ArrowLeftRight,
								visible: isPrivilegedAdmin,
							},
						],
					},
					{
						type: "group",
						id: "system_tools",
						title: t("sidebar.groups.system", "System"),
						icon: Settings,
						visible: true,
						subItems: [
							{
								id: "settings_panel",
								title: t("header.integrationSettings"),
								url: "/settings",
								icon: Settings2,
								visible: Boolean(sectionAccess?.[AdminSection.Integrations]),
							},
							{
								id: "notifications",
								title: t("notifications.menu"),
								url: "/notifications",
								icon: Bell,
								visible: true,
							},
							{
								id: "placeholders",
								title: isPrivilegedAdmin
									? t("placeholders.menu")
									: t("placeholders.settingsMenu"),
								url: "/placeholders",
								icon: Copy,
								visible: canManagePlaceholders,
							},
							{
								id: "phpmyadmin",
								title: t("phpmyadmin.menu"),
								url: "/phpmyadmin",
								icon: Database,
								visible: isPrivilegedAdmin,
							},
							{
								id: "external_apps",
								title: t("externalApps.menu"),
								url: "/external-apps",
								icon: Terminal,
								visible: isPrivilegedAdmin,
							},
						],
					},
					{
						type: "group",
						id: "observability",
						title: t("sidebar.groups.observability", "Monitoring & Logs"),
						icon: ShieldCheck,
						visible:
							Boolean(sectionAccess?.[AdminSection.Xray]) ||
							canViewRecentActions ||
							isPrivilegedAdmin,
						subItems: [
							{
								id: "xray_logs",
								title: t("pages.xray.logs"),
								url: "/xray-logs",
								icon: FileText,
								visible: Boolean(sectionAccess?.[AdminSection.Xray]),
							},
							{
								id: "system_errors",
								title: t("diagnostics.menu"),
								url: "/errors",
								icon: TriangleAlert,
								visible:
									Boolean(sectionAccess?.[AdminSection.Xray]) ||
									isPrivilegedAdmin,
							},
							{
								id: "access_insights",
								title: t("header.accessInsights"),
								url: "/access-insights",
								icon: Eye,
								visible: Boolean(sectionAccess?.[AdminSection.Xray]),
							},
							{
								id: "recent_actions",
								title: t("recentActions.title"),
								url: "/recent-actions",
								icon: Clock,
								visible: canViewRecentActions,
							},
						],
					},
				],
			},
			{
				id: "sec_docs",
				title: t("sidebar.sections.docs", "Resources"),
				items: [
					{
						type: "direct",
						id: "tutorials",
						title: t("sidebar.tutorialsAndFaq", t("tutorials.menu")),
						url: tutorialsUrl,
						icon: BookOpen,
						badge: hasNewTutorials,
						visible: true,
					},
					{
						type: "direct",
						id: "api_docs",
						title: t("apiDocs.menu"),
						url: "/api-docs",
						icon: SquareCode,
						visible: isPrivilegedAdmin,
					},
				],
			},
		],
		[
			t,
			canViewAdmins,
			selfAccess.self_myaccount,
			canViewUsage,
			canViewHosts,
			canViewNodes,
			canViewServicesSection,
			sectionAccess,
			canViewRecentActions,
			isPrivilegedAdmin,
			canManagePlaceholders,
			hasNewTutorials,
		],
	);

	return { navSections, tutorialsUrl, hasNewTutorials };
}

export function filterNavSectionsExcluding(
	sections: NavSection[],
	excludedRoutes: Set<string>,
): NavSection[] {
	const result: NavSection[] = [];

	for (const section of sections) {
		const nextItems: NavItem[] = [];
		for (const item of section.items) {
			if (!item.visible) continue;
			if (item.type === "direct") {
				if (!excludedRoutes.has(item.url)) {
					nextItems.push(item);
				}
			} else {
				const remainingSubs = item.subItems.filter(
					(sub) => sub.visible && !excludedRoutes.has(sub.url),
				);
				if (remainingSubs.length > 0) {
					nextItems.push({
						...item,
						subItems: remainingSubs,
					});
				}
			}
		}
		if (nextItems.length > 0) {
			result.push({
				...section,
				items: nextItems,
			});
		}
	}

	return result;
}
