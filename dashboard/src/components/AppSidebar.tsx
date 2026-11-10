import { FolderTree, ArrowLeftRight, BellRing, Zap, BookOpen, Briefcase, ChevronDown, ChartColumn, Database, Clock, SquareCode, Settings, Settings2, Terminal, Copy, Bell, FileText, Eye, House, Link, Server, Network, LayoutGrid, CircleUser, Users, Wrench } from "lucide-react";
import logoUrl from "assets/logo.svg";
import useGetUser from "hooks/useGetUser";
import {
	type ElementType,
	type FC,
	type MouseEvent as ReactMouseEvent,
	useCallback,
	useEffect,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { NavLink, useHref, useLocation, useNavigate } from "react-router-dom";
import { SponsorCarousel, type SponsorCarouselItem } from "./SponsorCarousel";
import type { SponsorAsset } from "service/sponsors";
import { AdminRole, AdminSection, AdminSudoScope } from "types/Admin";
import {
	getTutorialManifestUrl,
	getTutorialSeenKey,
	normalizeTutorialLang,
} from "utils/tutorials";

/** Icons keep the sidebar's size without a styled-system wrapper. */
const iconClass = "size-5 shrink-0";

const HomeIconStyled = () => <House className={iconClass} />;
const UsersIconStyled = () => <Users className={iconClass} />;
const BulkActionsIconStyled = () => <Zap className={iconClass} />;
const GroupsIconStyled = () => <FolderTree className={iconClass} />;
const RecentActionsIconStyled = () => <Clock className={iconClass} />;
const SettingsIconStyled = () => <Settings className={iconClass} />;
const MasterSettingsIconStyled = () => <Settings2 className={iconClass} />;
const NodeIconStyled = () => <Server className={iconClass} />;
const AdminIconStyled = () => <Briefcase className={iconClass} />;
const ServicesIconStyled = () => <LayoutGrid className={iconClass} />;
const HostsIconStyled = () => <Link className={iconClass} />;
const HAProxyIconStyled = () => <ArrowLeftRight className={iconClass} />;
const UsageIconStyled = () => <ChartColumn className={iconClass} />;
const MyAccountIconStyled = () => <CircleUser className={iconClass} />;
const NotificationIconStyled = () => <Bell className={iconClass} />;
const InsightsIconStyled = () => <Eye className={iconClass} />;
const TutorialIconStyled = () => <BookOpen className={iconClass} />;
const XraySettingsIconStyled = () => (
	<Wrench className={iconClass} />
);
const XrayLogsIconStyled = () => <FileText className={iconClass} />;
const ApiDocsIconStyled = () => <SquareCode className={iconClass} />;
const PHPMyAdminIconStyled = () => <Database className={iconClass} />;
const ExternalAppsIconStyled = () => <Terminal className={iconClass} />;
const PlaceholderIconStyled = () => <Copy className={iconClass} />;
const MyHostsIconStyled = () => <Network className={iconClass} />;
const TutorialUpdateIconStyled = () => <BellRing className="size-3" />;

interface AppSidebarProps {
	collapsed: boolean;
	sponsors?: SponsorAsset[];
	sidebarBanners?: SponsorAsset[];
	/** when rendered inside a Drawer on mobile */
	inDrawer?: boolean;
	/** optional callback to request the parent to expand the sidebar */
	onRequestExpand?: () => void;
}

type SidebarItem = {
	title: string;
	icon: ElementType;
	url?: string;
	subItems?: {
		title: string;
		url: string;
		icon: ElementType;
	}[];
};
type SidebarSubItems = NonNullable<SidebarItem["subItems"]>;

export const AppSidebar: FC<AppSidebarProps> = ({
	collapsed,
	sponsors = [],
	sidebarBanners = [],
	inDrawer = false,
	onRequestExpand,
}) => {
	const { t, i18n } = useTranslation();
	const location = useLocation();
	const navigate = useNavigate();
	const dashboardRoot = useHref("/");
	const { userData } = useGetUser();
	const currentLanguage = i18n.language || "en";
	const tutorialsUrl = "/tutorials";
	const sectionAccess = userData.permissions?.sections;
	const isFullAccess = userData.role === AdminRole.FullAccess;
	const isPrivilegedAdmin = isFullAccess || userData.role === AdminRole.Sudo;
	const defaultSelfPermissions = {
		self_myaccount: false,
		self_change_password: false,
		self_api_keys: false,
		self_placeholders: false,
		self_my_hosts: false,
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
	const canViewRecentActions =
		isFullAccess ||
		(userData.role === AdminRole.Sudo &&
			Boolean(userData.permissions?.sudo?.[AdminSudoScope.Xray]));
	const canManagePlaceholders =
		isFullAccess ||
		(userData.role === AdminRole.Sudo &&
			Boolean(userData.permissions?.sudo?.[AdminSudoScope.Subscriptions])) ||
		Boolean(baseSelf.self_placeholders);
	// MyHosts is for every admin except sudo admins; sudo can switch it off per admin.
	const canUseMyHosts =
		!isPrivilegedAdmin && Boolean(baseSelf.self_my_hosts);
	const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
	const [hasNewTutorials, setHasNewTutorials] = useState(false);

	const checkTutorialUpdates = useCallback(async () => {
		const langKey = normalizeTutorialLang(i18n.language);
		try {
			const response = await fetch(getTutorialManifestUrl(dashboardRoot), {
				headers: { "Cache-Control": "no-cache" },
			});
			if (!response.ok) {
				throw new Error(`Failed to load tutorial meta: ${response.status}`);
			}
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
		} catch (err) {
			console.error("Failed to check tutorial updates", err);
			setHasNewTutorials(false);
		}
	}, [dashboardRoot, i18n.language]);

	useEffect(() => {
		void checkTutorialUpdates();
	}, [checkTutorialUpdates]);

	const baseSettingsSubItems: SidebarSubItems = [
		isPrivilegedAdmin
			? {
					title: t("diagnostics.menu"),
					url: "/errors",
					icon: InsightsIconStyled,
				}
			: null,
		sectionAccess?.[AdminSection.Hosts]
			? {
					title: t("header.hostSettings"),
					url: "/hosts",
					icon: HostsIconStyled,
				}
			: null,
		sectionAccess?.[AdminSection.Nodes]
			? {
					title: t("header.nodeSettings"),
					url: "/node-settings",
					icon: NodeIconStyled,
				}
			: null,
		sectionAccess?.[AdminSection.Integrations]
			? {
					title: t("header.integrationSettings"),
					url: "/settings",
					icon: MasterSettingsIconStyled,
				}
			: null,
		sectionAccess?.[AdminSection.Xray]
			? {
					title: t("header.xraySettings"),
					url: "/xray-settings",
					icon: XraySettingsIconStyled,
				}
			: null,
		isPrivilegedAdmin
			? {
					title: t("haproxy.title"),
					url: "/haproxy",
					icon: HAProxyIconStyled,
				}
			: null,
		sectionAccess?.[AdminSection.Xray]
			? {
					title: t("pages.xray.logs"),
					url: "/xray-logs",
					icon: XrayLogsIconStyled,
				}
			: null,
		sectionAccess?.[AdminSection.Xray]
			? {
					title: t("header.accessInsights"),
					url: "/access-insights",
					icon: InsightsIconStyled,
				}
			: null,
		canViewRecentActions
			? {
					title: t("recentActions.title"),
					url: "/recent-actions",
					icon: RecentActionsIconStyled,
				}
			: null,
		isPrivilegedAdmin
			? {
					title: t("phpmyadmin.menu"),
					url: "/phpmyadmin",
					icon: PHPMyAdminIconStyled,
				}
			: null,
		isPrivilegedAdmin
			? {
					title: t("externalApps.menu"),
					url: "/external-apps",
					icon: ExternalAppsIconStyled,
				}
			: null,
		isPrivilegedAdmin
			? {
					title: t("apiDocs.menu"),
					url: "/api-docs",
					icon: ApiDocsIconStyled,
				}
			: null,
		canManagePlaceholders
			? {
					title: isPrivilegedAdmin
						? t("placeholders.menu")
						: t("placeholders.settingsMenu"),
					url: "/placeholders",
					icon: PlaceholderIconStyled,
				}
			: null,
		canUseMyHosts
			? {
					title: t("myHosts.menu"),
					url: "/my-hosts",
					icon: MyHostsIconStyled,
				}
			: null,
		{
			title: t("tutorials.menu"),
			url: tutorialsUrl,
			icon: TutorialIconStyled,
		},
	].filter(Boolean) as SidebarSubItems;

	const settingsSubItems: SidebarSubItems = [...baseSettingsSubItems];
	if (canViewServicesSection) {
		settingsSubItems.unshift({
			title: t("services.title"),
			url: "/services",
			icon: ServicesIconStyled,
		});
	}

	const defaultTabByPath: Record<string, string> = {
		"/settings": "panel",
		"/hosts": "inbounds",
		"/usage": "services",
		"/xray-settings": "basic",
	};

	const handleNavClick = (event?: ReactMouseEvent, targetUrl?: string) => {
		if (inDrawer && onRequestExpand) {
			onRequestExpand();
		}
		if (!targetUrl) return;
		const defaultTab = defaultTabByPath[targetUrl];
		if (defaultTab) {
			event?.preventDefault();
			const normalized = targetUrl.startsWith("/")
				? targetUrl
				: `/${targetUrl}`;
			navigate(`${normalized}#${defaultTab}`);
		}
	};

	const items: SidebarItem[] = [
		{ title: t("dashboard"), url: "/", icon: HomeIconStyled },
		{ title: t("users"), url: "/users", icon: UsersIconStyled },
		{ title: t("groups.title"), url: "/groups", icon: GroupsIconStyled },
	];

	items.push({
		title: t("bulkActions.menu"),
		url: "/bulk-actions",
		icon: BulkActionsIconStyled,
	});

	if (selfAccess.self_myaccount) {
		items.splice(1, 0, {
			title: t("myaccount.menu"),
			url: "/myaccount",
			icon: MyAccountIconStyled,
		});
	}

	items.push({
		title: t("notifications.menu"),
		url: "/notifications",
		icon: NotificationIconStyled,
	});

	if (canViewUsage) {
		items.push({
			title: t("usage.menu"),
			url: "/usage",
			icon: UsageIconStyled,
		});
	}
	if (canViewAdmins) {
		items.push({
			title: t("admins"),
			url: "/admins",
			icon: AdminIconStyled,
		});
	}
	if (settingsSubItems.length > 0) {
		items.push({
			title: t("header.settings"),
			icon: SettingsIconStyled,
			subItems: settingsSubItems,
		});
	}

	const directItems = items.filter((item) => item.url);
	const directByUrl = new Map(
		directItems.map((item) => [item.url as string, item]),
	);
	const settingsByUrl = new Map(
		settingsSubItems.map((item) => [item.url, item as SidebarItem]),
	);
	const pickDirect = (url: string) => directByUrl.get(url);
	const pickSetting = (url: string) => settingsByUrl.get(url);
	const compactGroups = [
		{
			title: t("dashboard"),
			items: [pickDirect("/")],
		},
		{
			title: t("users"),
			items: [pickDirect("/users"), pickDirect("/groups"), pickDirect("/bulk-actions")],
		},
		{
			title: t("sidebar.groups.infrastructure"),
			items: [
				pickSetting("/node-settings"),
				pickSetting("/services"),
				pickSetting("/hosts"),
			],
		},
		{
			title: t("admins.admin"),
			items: [
				pickDirect("/admins"),
				pickDirect("/usage"),
				pickDirect("/myaccount"),
				pickDirect("/notifications"),
			],
		},
		{
			title: t("sidebar.groups.system"),
			items: [
				pickSetting("/settings"),
				pickSetting("/xray-settings"),
				pickSetting("/haproxy"),
				pickSetting("/xray-logs"),
				pickSetting("/errors"),
				pickSetting("/access-insights"),
				pickSetting("/recent-actions"),
				pickSetting("/phpmyadmin"),
				pickSetting("/external-apps"),
				pickSetting("/placeholders"),
				pickSetting("/my-hosts"),
				pickSetting("/api-docs"),
				pickSetting(tutorialsUrl),
			],
		},
	].map((group) => ({
		...group,
		items: group.items.filter(Boolean) as SidebarItem[],
	}));

	const isRTL = i18n.dir(currentLanguage) === "rtl";
	const isItemActive = (url: string) =>
		location.pathname === url ||
		(url !== "/" && location.pathname.startsWith(url));
	const groupIsOpen = (group: (typeof compactGroups)[number]) =>
		openGroups[group.title] ??
		(group.items.length <= 4 ||
			group.items.some((item) => isItemActive(item.url as string)));
	const sponsorItems: SponsorCarouselItem[] = [
		{
			id: "rebecca",
			src: logoUrl,
			alt: "Rebecca",
			label: "Rebecca",
		},
		...sponsors.map((asset) => ({
			id: asset.id,
			src: asset.image_url,
			alt: asset.alt || asset.label || "Sponsor",
			href: asset.target_url,
			label: asset.label,
			isSponsor: true,
		})),
	];

	return (
		<aside
			dir={isRTL ? "rtl" : "ltr"}
			data-dir={isRTL ? "rtl" : "ltr"}
			data-collapsed={collapsed ? "true" : "false"}
			className={[
				"flex shrink-0 select-none overflow-hidden bg-panel-sidebar transition-[width] duration-300 ease-out",
				inDrawer
					? "relative h-full w-full"
					: "fixed top-3 h-[calc(100vh-24px)] rounded-2xl border border-panel-border shadow-[0_18px_48px_rgba(15,23,42,0.10)] dark:shadow-[0_18px_48px_rgba(0,0,0,0.32)]",
			].join(" ")}
			style={{
				width: inDrawer ? "100%" : collapsed ? 64 : 224,
				...(inDrawer ? {} : { [isRTL ? "right" : "left"]: 12 }),
			}}
		>
			<div
				className={[
					"flex h-full min-h-0 w-full flex-col justify-between gap-2",
					collapsed ? "p-2" : "p-4",
				].join(" ")}
			>
				<div className="rb-sidebar-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
					{/* Sponsor strip, hidden while collapsed. */}
					<div className="mb-3 rounded-md border border-panel-border bg-panel-elevated px-2 py-2">
						<SponsorCarousel
							items={sponsorItems}
							variant="logo"
							collapsed={collapsed}
						/>
					</div>

					<div className={collapsed ? "flex flex-col gap-1" : "flex flex-col gap-2"}>
						{compactGroups.map((group) => {
							if (group.items.length === 0) return null;
							const isOpen = collapsed || groupIsOpen(group);

							return (
								<div key={group.title}>
									{collapsed ? (
										<div className="mx-2 my-2 border-t border-panel-border" />
									) : (
										<button
											type="button"
											aria-expanded={isOpen}
											onClick={() =>
												setOpenGroups((prev) => ({
													...prev,
													[group.title]: !isOpen,
												}))
											}
											className="mb-1 flex w-full items-center justify-between rounded-[4px] px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-panel-text-muted transition-colors hover:text-panel-text"
										>
											<span>{group.title}</span>
											<ChevronDown
												width={14}
												height={14}
												style={{
													transform: isOpen ? undefined : "rotate(-90deg)",
													transition: "transform 0.15s ease",
												}}
											/>
										</button>
									)}

									<div
										className={[
											"flex flex-col gap-0.5",
											isOpen ? "" : "hidden",
										].join(" ")}
									>
										{group.items.map((item) => {
											if (!item.url) return null;
											const itemUrl = item.url;
											const isActive = isItemActive(itemUrl);
											const Icon = item.icon;
											const showTutorialBadge =
												itemUrl === tutorialsUrl && hasNewTutorials;

											return (
												<NavLink
													key={itemUrl}
													to={itemUrl}
													onClick={(e) => handleNavClick(e, itemUrl)}
													className={[
														"group relative flex min-h-[44px] items-center gap-3 rounded-[4px] border-s-[3px] py-1.5 transition-colors md:min-h-[36px]",
														collapsed ? "justify-center px-2" : "px-3",
														isActive
															? "border-s-panel-accent bg-panel-elevated text-panel-text"
															: "border-s-transparent text-panel-text-secondary hover:bg-panel-elevated hover:text-panel-text",
													].join(" ")}
												>
													<span className="relative inline-flex">
														<Icon />
														{showTutorialBadge && collapsed ? (
															<span className="absolute -end-2 -top-1.5 inline-flex size-4 items-center justify-center rounded-full bg-panel-accent text-white ring-2 ring-panel-sidebar">
																<TutorialUpdateIconStyled />
															</span>
														) : null}
													</span>
													{!collapsed ? (
														<>
															<span
																className={[
																	"truncate text-sm",
																	isActive ? "font-bold" : "font-semibold",
																].join(" ")}
															>
																{item.title}
															</span>
															{showTutorialBadge ? (
																<span className="ms-auto inline-flex size-5 items-center justify-center rounded-full bg-panel-accent text-white">
																	<TutorialUpdateIconStyled />
																</span>
															) : null}
														</>
													) : (
														/* Collapsed rail: the label appears on hover, like
														   the old Tooltip did. */
														<span className="pointer-events-none absolute start-full top-1/2 z-20 ms-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-panel-border bg-panel-elevated px-2 py-1 text-xs text-panel-text opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
															{item.title}
														</span>
													)}
												</NavLink>
											);
										})}
									</div>
								</div>
							);
						})}
					</div>
				</div>

				{!collapsed && sidebarBanners.length > 0 ? (
					<div className="w-full shrink-0">
						<SponsorCarousel
							items={sidebarBanners.map((asset) => ({
								id: asset.id,
								src: asset.image_url,
								alt: asset.alt || asset.label || "Sponsor",
								href: asset.target_url,
								label: asset.label,
								isSponsor: true,
							}))}
							variant="sidebar"
						/>
					</div>
				) : null}
			</div>
		</aside>
	);
};
