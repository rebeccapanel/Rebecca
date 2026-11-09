import {
	Box,
	chakra,
	Flex,
	HStack,
	Icon,
	IconButton,
	Image,
	Popover,
	PopoverBody,
	PopoverContent,
	PopoverHeader,
	PopoverTrigger,
	Portal,
	Text,
	Tooltip,
	useBreakpointValue,
	useColorMode,
	useColorModeValue,
	VStack,
} from "@chakra-ui/react";
import {
	ArrowsRightLeftIcon,
	BoltIcon,
	BookOpenIcon,
	BriefcaseIcon,
	ChartBarIcon,
	ChevronDownIcon,
	CircleStackIcon,
	ClockIcon,
	CodeBracketSquareIcon,
	Cog6ToothIcon,
	Cog8ToothIcon,
	CommandLineIcon,
	DocumentDuplicateIcon,
	BellIcon,
	DocumentTextIcon,
	EyeIcon,
	ExclamationTriangleIcon,
	HomeIcon,
	LinkIcon,
	ServerStackIcon,
	ShieldCheckIcon,
	Squares2X2Icon,
	UserCircleIcon,
	UserGroupIcon,
	WrenchScrewdriverIcon,
	XMarkIcon,
} from "@heroicons/react/24/outline";
import logoUrl from "assets/logo.svg";
import { AnimatePresence, motion } from "framer-motion";
import useGetUser from "hooks/useGetUser";
import {
	type ElementType,
	type FC,
	type MouseEvent as ReactMouseEvent,
	memo,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { NavLink, useHref, useLocation, useNavigate } from "react-router-dom";
import type { SponsorAsset } from "service/sponsors";
import { apiBaseURL } from "service/http";
import { AdminRole, AdminSection, AdminSudoScope } from "types/Admin";
import {
	getTutorialManifestUrl,
	getTutorialSeenKey,
	normalizeTutorialLang,
} from "utils/tutorials";
import { SponsorCarousel } from "./SponsorCarousel";

const iconProps = {
	baseStyle: {
		w: "18px",
		h: "18px",
	},
};

const subIconProps = {
	baseStyle: {
		w: "16px",
		h: "16px",
	},
};

const HomeIconStyled = chakra(HomeIcon, iconProps);
const UsersIconStyled = chakra(UserGroupIcon, iconProps);
const BulkActionsIconStyled = chakra(BoltIcon, subIconProps);
const UsersListIconStyled = chakra(UserGroupIcon, subIconProps);
const RecentActionsIconStyled = chakra(ClockIcon, subIconProps);
const SettingsIconStyled = chakra(Cog6ToothIcon, iconProps);
const MasterSettingsIconStyled = chakra(Cog8ToothIcon, subIconProps);
const NodeIconStyled = chakra(ServerStackIcon, iconProps);
const AdminIconStyled = chakra(BriefcaseIcon, iconProps);
const ServicesIconStyled = chakra(Squares2X2Icon, iconProps);
const HostsIconStyled = chakra(LinkIcon, iconProps);
const HAProxyIconStyled = chakra(ArrowsRightLeftIcon, subIconProps);
const UsageIconStyled = chakra(ChartBarIcon, iconProps);
const MyAccountIconStyled = chakra(UserCircleIcon, iconProps);
const NotificationSubIconStyled = chakra(BellIcon, subIconProps);
const InsightsIconStyled = chakra(EyeIcon, subIconProps);
const SystemErrorsIconStyled = chakra(ExclamationTriangleIcon, subIconProps);
const TutorialIconStyled = chakra(BookOpenIcon, iconProps);
const XraySettingsIconStyled = chakra(WrenchScrewdriverIcon, subIconProps);
const XrayLogsIconStyled = chakra(DocumentTextIcon, subIconProps);
const ApiDocsIconStyled = chakra(CodeBracketSquareIcon, iconProps);
const PHPMyAdminIconStyled = chakra(CircleStackIcon, subIconProps);
const ExternalAppsIconStyled = chakra(CommandLineIcon, subIconProps);
const PlaceholderIconStyled = chakra(DocumentDuplicateIcon, subIconProps);
const ObservabilityIconStyled = chakra(ShieldCheckIcon, iconProps);
const InfrastructureIconStyled = chakra(WrenchScrewdriverIcon, iconProps);

const LogoIcon = chakra("img", {
	baseStyle: {
		w: "30px",
		h: "30px",
		objectFit: "contain",
	},
});

interface AppSidebarProps {
	collapsed: boolean;
	sponsors?: SponsorAsset[];
	sidebarBanners?: SponsorAsset[];
	inDrawer?: boolean;
	onRequestExpand?: () => void;
}

type DirectNavItem = {
	type: "direct";
	id: string;
	title: string;
	url: string;
	icon: ElementType;
	visible: boolean;
	badge?: boolean;
};

type GroupSubItem = {
	id: string;
	title: string;
	url: string;
	icon: ElementType;
	visible: boolean;
};

type GroupNavItem = {
	type: "group";
	id: string;
	title: string;
	icon: ElementType;
	subItems: GroupSubItem[];
	visible: boolean;
};

type NavItem = DirectNavItem | GroupNavItem;

type NavSection = {
	id: string;
	title: string;
	items: NavItem[];
};

interface SidebarBannerSectionProps {
	banners: SponsorAsset[];
	collapsed: boolean;
	inDrawer: boolean;
}

const SidebarBannerSection: FC<SidebarBannerSectionProps> = ({
	banners,
	collapsed,
	inDrawer,
}) => {
	const [isInitialMount, setIsInitialMount] = useState(true);

	const isExpanded = !collapsed;
	const animDuration = isInitialMount ? 0.5 : 0.26;
	const animDelay = isInitialMount ? 0.7 : 0;

	return (
		<motion.div
			initial={{ opacity: 0, y: 24 }}
			animate={{
				opacity: isExpanded ? 1 : 0,
				y: isExpanded ? 0 : 24,
			}}
			transition={{
				duration: animDuration,
				delay: animDelay,
				ease: [0.16, 1, 0.3, 1],
			}}
			onAnimationComplete={() => {
				if (isInitialMount) setIsInitialMount(false);
			}}
			style={{
				width: "100%",
				flexShrink: 0,
				overflow: "hidden",
				display: isExpanded ? "block" : "none",
			}}
		>
			<Box
				w="full"
				maxW={inDrawer ? "min(220px, calc(100% - 48px))" : "full"}
				mx={inDrawer ? "auto" : undefined}
				pt={2}
				pb={inDrawer ? "calc(env(safe-area-inset-bottom, 0px) + 8px)" : 0}
				pointerEvents={isExpanded ? "auto" : "none"}
				borderTopWidth="1px"
				borderColor="panel.border"
			>
				<SponsorCarousel
					items={banners.map((asset) => ({
						id: asset.id,
						src: asset.image_url,
						alt: asset.alt || asset.label || "Sponsor",
						href: asset.target_url,
						label: asset.label,
						isSponsor: true,
					}))}
					variant="sidebar"
					animateIn={false}
				/>
			</Box>
		</motion.div>
	);
};

const resolveAssetUrl = (rawUrl?: string): string => {
	if (!rawUrl) return "";
	if (
		rawUrl.startsWith("http://") ||
		rawUrl.startsWith("https://") ||
		rawUrl.startsWith("data:") ||
		rawUrl.startsWith("blob:")
	) {
		return rawUrl;
	}
	if (rawUrl.startsWith("/") && !rawUrl.startsWith("//") && apiBaseURL) {
		const base = apiBaseURL.replace(/\/+$/, "");
		const cleanPath = rawUrl.startsWith("/api") ? rawUrl.slice(4) : rawUrl;
		return `${base}${cleanPath.startsWith("/") ? cleanPath : `/${cleanPath}`}`;
	}
	return rawUrl;
};

interface SidebarLogoCarouselProps {
	sponsors?: SponsorAsset[];
	collapsed: boolean;
	inDrawer: boolean;
	colorMode: string;
	isRTL: boolean;
	onNavigateRoot: () => void;
	onRequestExpand?: () => void;
}

const SidebarLogoCarousel: FC<SidebarLogoCarouselProps> = memo(({
	sponsors = [],
	collapsed,
	inDrawer,
	colorMode,
	isRTL,
	onNavigateRoot,
	onRequestExpand,
}) => {
	const [activeIndex, setActiveIndex] = useState(0);
	const [isPaused, setIsPaused] = useState(false);

	const items = useMemo(() => {
		const rebeccaItem = {
			id: "rebecca",
			src: logoUrl,
			alt: "Rebecca",
			label: "Rebecca",
			isSponsor: false,
			href: undefined as string | undefined,
		};
		const validSponsors = (sponsors || [])
			.filter((s) => Boolean(s?.image_url || (s as unknown as { src?: string })?.src))
			.map((s) => {
				const rawSrc = s.image_url || (s as unknown as { src?: string })?.src || "";
				const href = s.target_url || (s as unknown as { href?: string })?.href;
				return {
					id: s.id,
					src: resolveAssetUrl(rawSrc),
					alt: s.alt || s.label || "Sponsor",
					label: s.label
						? s.label.charAt(0).toUpperCase() + s.label.slice(1)
						: s.alt || "Sponsor",
					isSponsor: true,
					href,
				};
			});
		if (validSponsors.length === 0) {
			return [rebeccaItem];
		}
		const result: typeof rebeccaItem[] = [];
		for (const sp of validSponsors) {
			result.push(rebeccaItem, sp);
		}
		return result;
	}, [sponsors]);

	useEffect(() => {
		if (activeIndex >= items.length) {
			setActiveIndex(0);
		}
	}, [activeIndex, items.length]);

	useEffect(() => {
		if (isPaused || items.length < 2) return;
		const current = items[activeIndex];
		const delay = current?.isSponsor ? 7000 : 10000;
		const timer = window.setTimeout(() => {
			setActiveIndex((prev) => (prev + 1) % items.length);
		}, delay);
		return () => window.clearTimeout(timer);
	}, [isPaused, items, activeIndex]);

	const currentItem = items[activeIndex] || items[0];

	const handleClick = (e: ReactMouseEvent) => {
		e.stopPropagation();
		if (currentItem.isSponsor && currentItem.href) {
			window.open(currentItem.href, "_blank", "noopener,noreferrer");
		} else {
			onNavigateRoot();
			if (inDrawer && onRequestExpand) {
				onRequestExpand();
			}
		}
	};

	if (items.length <= 1) {
		return (
			<Box
				position="relative"
				h="34px"
				flex="1"
				minW="0"
				marginInlineStart={collapsed ? 0 : "-22px"}
				paddingInlineStart={collapsed ? 0 : "22px"}
				cursor="pointer"
				userSelect="none"
				onClick={handleClick}
				transition="transform 0.16s cubic-bezier(0.2, 0, 0, 1)"
				_active={{ transform: "scale(0.98)" }}
				title="Rebecca"
			>
				<HStack h="34px" w="full" spacing={2.5} align="center" flexShrink={0}>
					<Tooltip
						label="Rebecca"
						placement={isRTL ? "left" : "right"}
						isDisabled={!collapsed}
						hasArrow
						openDelay={250}
					>
						<Box
							w="30px"
							h="30px"
							flexShrink={0}
							display="flex"
							alignItems="center"
							justifyContent="center"
						>
							<LogoIcon
								src={logoUrl}
								alt="Rebecca"
								style={{
									filter:
										colorMode === "dark"
											? "brightness(0) invert(1)"
											: "brightness(0)",
									transition: "filter 0.3s ease",
								}}
							/>
						</Box>
					</Tooltip>
					<Box
						flex="1"
						minW="0"
						overflow="hidden"
						whiteSpace="nowrap"
						opacity={collapsed ? 0 : 1}
						maxW={collapsed ? "0px" : "full"}
						transform={
							collapsed
								? isRTL
									? "translateX(10px)"
									: "translateX(-10px)"
								: "translateX(0)"
						}
						transition="max-width 0.26s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1), transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)"
						pointerEvents={collapsed ? "none" : "auto"}
					>
						<Text
							fontSize="17px"
							fontWeight="800"
							letterSpacing="-0.02em"
							color="panel.text"
							pt="3px"
							isTruncated
						>
							Rebecca
						</Text>
					</Box>
				</HStack>
			</Box>
		);
	}

	return (
		<Box
			position="relative"
			h="34px"
			overflow="hidden"
			flex="1"
			minW="0"
			marginInlineStart={collapsed ? 0 : "-22px"}
			paddingInlineStart={collapsed ? 0 : "22px"}
			cursor={currentItem.isSponsor && currentItem.href ? "pointer" : "default"}
			userSelect="none"
			onMouseEnter={() => {
				if (window.matchMedia?.("(hover: hover)").matches) {
					setIsPaused(true);
				}
			}}
			onMouseLeave={() => setIsPaused(false)}
			onClick={handleClick}
			transition="transform 0.16s cubic-bezier(0.2, 0, 0, 1)"
			_active={{ transform: "scale(0.98)" }}
			title={currentItem.isSponsor ? currentItem.label : "Rebecca"}
		>
			<AnimatePresence mode="wait" initial={false}>
				<motion.div
					key={`${currentItem.id}-${activeIndex}`}
					initial={{ x: isRTL ? 150 : -150 }}
					animate={{ x: 0 }}
					exit={{ x: isRTL ? 150 : -150 }}
					transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
					style={{
						display: "flex",
						alignItems: "center",
						width: "100%",
						height: "34px",
					}}
				>
					<HStack h="34px" w="full" spacing={2.5} align="center" flexShrink={0}>
						<Tooltip
							label={currentItem.label}
							placement={isRTL ? "left" : "right"}
							isDisabled={!collapsed}
							hasArrow
							openDelay={250}
						>
							<Box
								w="34px"
								h="34px"
								flexShrink={0}
								display="flex"
								alignItems="center"
								justifyContent="center"
							>
								{currentItem.isSponsor ? (
									<Image
										src={currentItem.src}
										alt={currentItem.alt}
										w="34px"
										h="34px"
										maxW="34px"
										maxH="34px"
										objectFit="contain"
										draggable={false}
										loading="eager"
										borderRadius="8px"
										userSelect="none"
										sx={{
											WebkitUserDrag: "none",
											pointerEvents: "none",
										}}
									/>
								) : (
									<LogoIcon
										src={currentItem.src}
										alt="Rebecca"
										style={{
											filter:
												colorMode === "dark"
													? "brightness(0) invert(1)"
													: "brightness(0)",
											transition: "filter 0.3s ease",
										}}
									/>
								)}
							</Box>
						</Tooltip>
						<Box
							flex="1"
							minW="0"
							overflow="hidden"
							whiteSpace="nowrap"
							opacity={collapsed ? 0 : 1}
							maxW={collapsed ? "0px" : "full"}
							pointerEvents={collapsed ? "none" : "auto"}
						>
							<Text
								fontSize="17px"
								fontWeight="800"
								letterSpacing="-0.02em"
								color="panel.text"
								pt="3px"
								isTruncated
							>
								{currentItem.label}
							</Text>
						</Box>
					</HStack>
				</motion.div>
			</AnimatePresence>
		</Box>
	);
});

export const AppSidebar: FC<AppSidebarProps> = memo(({
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
	const { colorMode } = useColorMode();
	const { userData } = useGetUser();
	const isRTL = i18n.dir(i18n.language) === "rtl";
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
	const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
		users_hub: true,
	});

	const sidebarBg = "panel.surface";
	const sidebarBorderColor = useColorModeValue("panel.border", "panel.border");
	const activeItemBg = useColorModeValue("panel.elevated", "panel.elevated");
	const activeItemColor = "var(--rb-panel-accent)";
	const normalItemColor = useColorModeValue("gray.700", "gray.200");
	const sectionTitleColor = useColorModeValue("gray.600", "gray.400");
	const tooltipBg = useColorModeValue("gray.900", "panel.surface");
	const tooltipColor = useColorModeValue("white", "panel.text");
	const tooltipBorder = useColorModeValue("gray.800", "panel.border");
	const hoverItemBg = useColorModeValue("panel.elevated", "panel.elevated");
	const sidebarShadow = useColorModeValue(
		"0 1px 2px rgba(0, 0, 0, 0.03), inset 0 1px 0 0 rgba(255, 255, 255, 0.8)",
		"inset 0 1px 0 0 rgba(255, 255, 255, 0.08)",
	);
	const popoverTrigger = (useBreakpointValue({ base: "click", md: "hover" }) ||
		"hover") as "click" | "hover";

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
		} catch {
			setHasNewTutorials(false);
		}
	}, [dashboardRoot, i18n.language]);

	useEffect(() => {
		void checkTutorialUpdates();
	}, [checkTutorialUpdates]);

	const defaultTabByPath: Record<string, string> = {
		"/settings": "panel",
		"/hosts": "inbounds",
		"/usage": "services",
		"/xray-settings": "basic",
	};

	const handleNavigate = (url: string, event?: ReactMouseEvent) => {
		event?.preventDefault();
		const defaultTab = defaultTabByPath[url];
		const normalized = url.startsWith("/") ? url : `/${url}`;
		navigate(defaultTab ? `${normalized}#${defaultTab}` : normalized);
		if (inDrawer && onRequestExpand) {
			onRequestExpand();
		}
	};

	const navSections: NavSection[] = useMemo(
		() => [
			{
				id: "sec_dashboard",
				title: t("sidebar.sections.dashboard"),
				items: [
					{
						type: "direct",
						id: "dashboard",
						title: t("dashboard"),
						url: "/",
						icon: HomeIconStyled,
						visible: true,
					},
				],
			},
			{
				id: "sec_users",
				title: t("sidebar.sections.users"),
				items: [
					{
						type: "group",
						id: "users_hub",
						title: t("sidebar.groups.userHub"),
						icon: UsersIconStyled,
						visible: true,
						subItems: [
							{
								id: "users_list",
								title: t("sidebar.usersList"),
								url: "/users",
								icon: UsersListIconStyled,
								visible: true,
							},
							{
								id: "bulk_actions",
								title: t("bulkActions.menu"),
								url: "/bulk-actions",
								icon: BulkActionsIconStyled,
								visible: true,
							},
						],
					},
				],
			},
			{
				id: "sec_infrastructure",
				title: t("sidebar.sections.infrastructure"),
				items: [
					{
						type: "direct",
						id: "nodes",
						title: t("header.nodeSettings"),
						url: "/node-settings",
						icon: NodeIconStyled,
						visible: canViewNodes,
					},
					{
						type: "direct",
						id: "hosts",
						title: t("header.hostSettings"),
						url: "/hosts",
						icon: HostsIconStyled,
						visible: canViewHosts,
					},
					{
						type: "direct",
						id: "services",
						title: t("services.title"),
						url: "/services",
						icon: ServicesIconStyled,
						visible: canViewServicesSection,
					},
				],
			},
			{
				id: "sec_traffic_admins",
				title: t("sidebar.sections.trafficAndAdmins"),
				items: [
					{
						type: "direct",
						id: "myaccount",
						title: t("myaccount.menu"),
						url: "/myaccount",
						icon: MyAccountIconStyled,
						visible: Boolean(selfAccess.self_myaccount),
					},
					{
						type: "direct",
						id: "usage",
						title: t("usage.menu"),
						url: "/usage",
						icon: UsageIconStyled,
						visible: canViewUsage,
					},
					{
						type: "direct",
						id: "admins",
						title: t("admins"),
						url: "/admins",
						icon: AdminIconStyled,
						visible: canViewAdmins,
					},
				],
			},
			{
				id: "sec_system",
				title: t("sidebar.sections.system"),
				items: [
					{
						type: "group",
						id: "core_routing",
						title: t("sidebar.groups.coreRouting"),
						icon: InfrastructureIconStyled,
						visible:
							Boolean(sectionAccess?.[AdminSection.Xray]) || isPrivilegedAdmin,
						subItems: [
							{
								id: "xray_settings",
								title: t("header.xraySettings"),
								url: "/xray-settings",
								icon: XraySettingsIconStyled,
								visible: Boolean(sectionAccess?.[AdminSection.Xray]),
							},
							{
								id: "haproxy",
								title: t("haproxy.title"),
								url: "/haproxy",
								icon: HAProxyIconStyled,
								visible: isPrivilegedAdmin,
							},
						],
					},
					{
						type: "group",
						id: "system_tools",
						title: t("sidebar.groups.system"),
						icon: SettingsIconStyled,
						visible: true,
						subItems: [
							{
								id: "settings_panel",
								title: t("header.integrationSettings"),
								url: "/settings",
								icon: MasterSettingsIconStyled,
								visible: Boolean(sectionAccess?.[AdminSection.Integrations]),
							},
							{
								id: "notifications",
								title: t("notifications.menu"),
								url: "/notifications",
								icon: NotificationSubIconStyled,
								visible: true,
							},
							{
								id: "placeholders",
								title: isPrivilegedAdmin
									? t("placeholders.menu")
									: t("placeholders.settingsMenu"),
								url: "/placeholders",
								icon: PlaceholderIconStyled,
								visible: canManagePlaceholders,
							},
							{
								id: "phpmyadmin",
								title: t("phpmyadmin.menu"),
								url: "/phpmyadmin",
								icon: PHPMyAdminIconStyled,
								visible: isPrivilegedAdmin,
							},
							{
								id: "external_apps",
								title: t("externalApps.menu"),
								url: "/external-apps",
								icon: ExternalAppsIconStyled,
								visible: isPrivilegedAdmin,
							},
						],
					},
					{
						type: "group",
						id: "observability",
						title: t("sidebar.groups.observability"),
						icon: ObservabilityIconStyled,
						visible:
							Boolean(sectionAccess?.[AdminSection.Xray]) ||
							canViewRecentActions,
						subItems: [
							{
								id: "xray_logs",
								title: t("pages.xray.logs"),
								url: "/xray-logs",
								icon: XrayLogsIconStyled,
								visible: Boolean(sectionAccess?.[AdminSection.Xray]),
							},
							{
								id: "system_errors",
								title: t("errors.title", "Errors"),
								url: "/errors",
								icon: SystemErrorsIconStyled,
								visible:
									Boolean(sectionAccess?.[AdminSection.Xray]) ||
									isPrivilegedAdmin,
							},
							{
								id: "access_insights",
								title: t("header.accessInsights"),
								url: "/access-insights",
								icon: InsightsIconStyled,
								visible: Boolean(sectionAccess?.[AdminSection.Xray]),
							},
							{
								id: "recent_actions",
								title: t("recentActions.title"),
								url: "/recent-actions",
								icon: RecentActionsIconStyled,
								visible: canViewRecentActions,
							},
						],
					},
				],
			},
			{
				id: "sec_docs",
				title: t("sidebar.sections.docs"),
				items: [
					{
						type: "direct",
						id: "tutorials",
						title: t("sidebar.tutorialsAndFaq"),
						url: tutorialsUrl,
						icon: TutorialIconStyled,
						badge: hasNewTutorials,
						visible: true,
					},
					{
						type: "direct",
						id: "api_docs",
						title: t("apiDocs.menu"),
						url: "/api-docs",
						icon: ApiDocsIconStyled,
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

	useEffect(() => {
		const path = location.pathname;
		if (path === "/users" || path === "/bulk-actions") {
			setOpenGroups((prev) => ({ ...prev, users_hub: true }));
		} else if (
			path.startsWith("/xray-logs") ||
			path.startsWith("/errors") ||
			path.startsWith("/access-insights") ||
			path.startsWith("/recent-actions")
		) {
			setOpenGroups((prev) => ({ ...prev, observability: true }));
		} else if (
			path.startsWith("/xray-settings") ||
			path.startsWith("/haproxy")
		) {
			setOpenGroups((prev) => ({ ...prev, core_routing: true }));
		} else if (
			path.startsWith("/settings") ||
			path.startsWith("/placeholders") ||
			path.startsWith("/phpmyadmin") ||
			path.startsWith("/external-apps")
		) {
			setOpenGroups((prev) => ({ ...prev, system_tools: true }));
		}
	}, [location.pathname]);

	const navScrollRef = useRef<HTMLDivElement | null>(null);
	const scrollAnimRef = useRef<number | null>(null);

	useEffect(() => {
		return () => {
			if (scrollAnimRef.current !== null) {
				cancelAnimationFrame(scrollAnimRef.current);
			}
		};
	}, []);

	const handleGroupClick = (group: GroupNavItem, triggerEl?: HTMLElement | null) => {
		if (scrollAnimRef.current !== null) {
			cancelAnimationFrame(scrollAnimRef.current);
			scrollAnimRef.current = null;
		}

		const isCurrentlyOpen = Boolean(openGroups[group.id]);
		if (!isCurrentlyOpen && navScrollRef.current && triggerEl) {
			const groupWrapper = triggerEl.closest("[data-nav-group]");
			let anchorEl: HTMLElement | null = null;
			if (groupWrapper) {
				const nextSibling = groupWrapper.nextElementSibling as HTMLElement | null;
				if (nextSibling) {
					anchorEl = nextSibling;
				} else {
					const section = groupWrapper.closest("[data-nav-section]");
					if (section) {
						anchorEl = section.nextElementSibling as HTMLElement | null;
					}
				}
			}

			if (anchorEl) {
				const scrollEl = navScrollRef.current;
				const initialTop = anchorEl.getBoundingClientRect().top;
				const startTime = performance.now();
				setOpenGroups((prev) => ({ ...prev, [group.id]: true }));

				const adjustScroll = (now: number) => {
					if (!navScrollRef.current || !anchorEl) return;
					const currentTop = anchorEl.getBoundingClientRect().top;
					const delta = currentTop - initialTop;
					if (Math.abs(delta) >= 0.5) {
						scrollEl.scrollTop += delta;
					}
					if (now - startTime < 320) {
						scrollAnimRef.current = requestAnimationFrame(adjustScroll);
					} else {
						const finalTop = anchorEl.getBoundingClientRect().top;
						const finalDelta = finalTop - initialTop;
						if (Math.abs(finalDelta) >= 0.5) {
							scrollEl.scrollTop += finalDelta;
						}
						scrollAnimRef.current = null;
					}
				};
				scrollAnimRef.current = requestAnimationFrame(adjustScroll);
				return;
			}
		}

		setOpenGroups((prev) => ({ ...prev, [group.id]: !isCurrentlyOpen }));
	};

	const dynamicSidebarWidth = useMemo(() => {
		let maxLen = 0;
		for (const section of navSections) {
			for (const it of section.items) {
				if (it.title && it.title.length > maxLen) {
					maxLen = it.title.length;
				}
				if (it.type === "group" && it.subItems) {
					for (const sub of it.subItems) {
						if (sub.title && sub.title.length > maxLen) {
							maxLen = sub.title.length;
						}
					}
				}
			}
		}
		if (maxLen > 20) {
			return Math.min(300, Math.round(240 + (maxLen - 20) * 5.5));
		}
		return 240;
	}, [navSections]);

	useEffect(() => {
		if (typeof document !== "undefined") {
			document.documentElement.style.setProperty(
				"--rb-sidebar-width",
				`${dynamicSidebarWidth}px`,
			);
		}
	}, [dynamicSidebarWidth]);

	return (
		<Box
			w={
				inDrawer
					? "full"
					: collapsed
						? "68px"
						: `var(--rb-sidebar-width, ${dynamicSidebarWidth}px)`
			}
			h={inDrawer ? "100%" : "calc(100vh - 24px)"}
			maxH={inDrawer ? "100%" : "calc(100vh - 24px)"}
			bg={sidebarBg}
			borderWidth={inDrawer ? undefined : "1px"}
			borderColor={inDrawer ? undefined : sidebarBorderColor}
			borderRadius={inDrawer ? undefined : "20px"}
			boxShadow={inDrawer ? undefined : sidebarShadow}
			transition={
				inDrawer ? "none" : "width 0.26s cubic-bezier(0.16, 1, 0.3, 1)"
			}
			position={inDrawer ? "relative" : "fixed"}
			top={inDrawer ? undefined : "12px"}
			left={inDrawer || isRTL ? undefined : "12px"}
			right={inDrawer || !isRTL ? undefined : "12px"}
			overflow="hidden"
			flexShrink={0}
			userSelect="none"
			zIndex={inDrawer ? "auto" : 200}
			sx={{
				contain: inDrawer ? undefined : "layout style",
				transform: inDrawer ? undefined : "translateZ(0)",
				touchAction: "manipulation",
			}}
		>
			<Flex
				direction="column"
				h="full"
				justify="space-between"
				p={collapsed ? 2 : 3}
			>
				<Flex
					align="center"
					justify="space-between"
					px="10px"
					py={2.5}
					mb={2}
					minH="48px"
					borderBottomWidth="1px"
					borderColor="panel.border"
				>
					<SidebarLogoCarousel
						sponsors={sponsors}
						collapsed={collapsed}
						inDrawer={inDrawer}
						colorMode={colorMode}
						isRTL={isRTL}
						onNavigateRoot={() => navigate("/")}
						onRequestExpand={onRequestExpand}
					/>

					{inDrawer && onRequestExpand && (
						<IconButton
							size="xs"
							variant="ghost"
							borderRadius="full"
							w="34px"
							h="34px"
							minW="34px"
							aria-label="Close sidebar"
							icon={<XMarkIcon width={16} height={16} />}
							onClick={onRequestExpand}
							color="panel.textSecondary"
							transition="all 0.16s cubic-bezier(0.2, 0, 0, 1)"
							_hover={{ md: { bg: "panel.elevated", color: "panel.text" } }}
							_active={{ transform: "scale(0.95)" }}
						/>
					)}
				</Flex>

				<Box
					ref={navScrollRef}
					flex="1"
					minH={0}
					overflowY="auto"
					overflowX="hidden"
					className="rb-sidebar-scroll"
					dir={isRTL ? "rtl" : "ltr"}
					px={collapsed ? 0 : 1}
				>
					<VStack align="stretch" spacing={2} py={1}>
						{navSections.map((section, secIdx) => {
							const visibleItems = section.items.filter((item) => item.visible);
							if (visibleItems.length === 0) return null;

							return (
								<Box key={section.id} data-nav-section={section.id}>
									{secIdx > 0 && (
										<Box
											h="1px"
											bg="panel.border"
											mx={2}
											my={1.5}
											opacity={collapsed ? 0.6 : 0}
											display={collapsed ? "block" : "none"}
											transition="opacity 0.25s ease"
										/>
									)}

									<Box
										overflow="hidden"
										whiteSpace="nowrap"
										maxH={collapsed ? "0px" : "28px"}
										opacity={collapsed ? 0 : 1}
										mb={collapsed ? 0 : 1}
										mt={secIdx === 0 ? 0 : 1.5}
										transition="max-height 0.3s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease, margin 0.3s ease"
										pointerEvents="none"
									>
										<Text
											px={3}
											fontSize="10.5px"
											fontWeight="600"
											color={sectionTitleColor}
											textTransform="uppercase"
											letterSpacing="0.06em"
											userSelect="none"
										>
											{section.title}
										</Text>
									</Box>

									<VStack align="stretch" spacing={1}>
										{visibleItems.map((entry) => {
											if (entry.type === "direct") {
												const isCurrent =
													location.pathname === entry.url ||
													(entry.url !== "/" &&
														location.pathname.startsWith(entry.url));
												const IconEl = entry.icon;

												const btnContent = (
													<Flex
														align="center"
														justify="flex-start"
														w="full"
														h={inDrawer ? "42px" : "38px"}
														px={collapsed ? "7px" : "11px"}
														borderRadius="10px"
														bg={isCurrent ? activeItemBg : "transparent"}
														color={isCurrent ? "panel.text" : normalItemColor}
														fontWeight={isCurrent ? "600" : "500"}
														fontSize="13px"
														position="relative"
														cursor="pointer"
														transition="all 0.24s cubic-bezier(0.16, 1, 0.3, 1)"
														borderInlineStart="3px solid"
														borderInlineStartColor={
															isCurrent
																? "var(--rb-panel-accent)"
																: "transparent"
														}
														borderInlineEnd={
															collapsed ? "3px solid transparent" : "none"
														}
														_hover={{
															md: {
																bg: isCurrent ? activeItemBg : hoverItemBg,
																color: "panel.text",
															},
														}}
														_active={{
															transform: "scale(0.98)",
														}}
													>
														<Box
															w="30px"
															h="30px"
															flexShrink={0}
															display="flex"
															alignItems="center"
															justifyContent="center"
															color={isCurrent ? activeItemColor : "inherit"}
															transition="color 0.2s ease"
														>
															<IconEl />
														</Box>

														<Box
															flex="1"
															minW="0"
															ms={collapsed ? 0 : 2.5}
															overflow="hidden"
															whiteSpace="nowrap"
															opacity={collapsed ? 0 : 1}
															maxW={
																collapsed ? "0px" : "full"
															}
															transform={
																collapsed
																	? isRTL
																		? "translateX(8px)"
																		: "translateX(-8px)"
																	: "translateX(0)"
															}
															transition={
																collapsed
																	? "max-width 0.26s cubic-bezier(0.16, 1, 0.3, 1), margin 0.26s cubic-bezier(0.16, 1, 0.3, 1), transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.18s cubic-bezier(0.16, 1, 0.3, 1) 0.12s"
																	: "max-width 0.26s cubic-bezier(0.16, 1, 0.3, 1), margin 0.26s cubic-bezier(0.16, 1, 0.3, 1), transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.22s cubic-bezier(0.16, 1, 0.3, 1)"
															}
															pointerEvents={collapsed ? "none" : "auto"}
														>
															<Text
																noOfLines={1}
																color={
																	isCurrent ? "panel.text" : normalItemColor
																}
																fontSize="13px"
																fontWeight={isCurrent ? "600" : "500"}
																lineHeight="normal"
															>
																{entry.title}
															</Text>
														</Box>

														{!collapsed && entry.badge && (
															<Box
																w="6px"
																h="6px"
																borderRadius="full"
																bg="var(--rb-panel-accent)"
																boxShadow="0 0 6px var(--rb-panel-accent)"
																flexShrink={0}
															/>
														)}

														{collapsed && entry.badge && (
															<Box
																position="absolute"
																top="6px"
																insetInlineEnd="6px"
																w="5px"
																h="5px"
																borderRadius="full"
																bg="var(--rb-panel-accent)"
															/>
														)}
													</Flex>
												);

												return collapsed ? (
													<Tooltip
														key={entry.id}
														label={entry.title}
														placement={isRTL ? "left" : "right"}
														hasArrow
														bg={tooltipBg}
														color={tooltipColor}
														borderColor={tooltipBorder}
														borderWidth="1px"
														borderRadius="6px"
														fontSize="11px"
														fontWeight="600"
														px="9px"
														py="4px"
														boxShadow="none"
														openDelay={60}
													>
														<Box
															as={NavLink}
															to={entry.url}
															onClick={(e: ReactMouseEvent) =>
																handleNavigate(entry.url, e)
															}
															display="block"
														>
															{btnContent}
														</Box>
													</Tooltip>
												) : (
													<Box
														key={entry.id}
														as={NavLink}
														to={entry.url}
														onClick={(e: ReactMouseEvent) =>
															handleNavigate(entry.url, e)
														}
														display="block"
													>
														{btnContent}
													</Box>
												);
											}

											const visibleSubs = entry.subItems.filter(
												(s) => s.visible,
											);
											if (visibleSubs.length === 0) return null;

											const isGroupActive = visibleSubs.some(
												(s) =>
													location.pathname === s.url ||
													(s.url !== "/" &&
														location.pathname.startsWith(s.url)),
											);
											const isOpen = Boolean(openGroups[entry.id]);
											const GroupIcon = entry.icon;

											const groupTriggerContent = (
												<Flex
													align="center"
													justify="flex-start"
													w="full"
													h={inDrawer ? "42px" : "38px"}
													px={collapsed ? "7px" : "11px"}
													borderRadius="10px"
													bg={
														isGroupActive && (!isOpen || collapsed)
															? activeItemBg
															: "transparent"
													}
													color={isGroupActive ? "panel.text" : normalItemColor}
													fontWeight={isGroupActive ? "600" : "500"}
													fontSize="13px"
													cursor="pointer"
													transition="all 0.24s cubic-bezier(0.16, 1, 0.3, 1)"
													borderInlineStart="3px solid"
													borderInlineStartColor={
														isGroupActive
															? "var(--rb-panel-accent)"
															: "transparent"
													}
													borderInlineEnd={
														collapsed ? "3px solid transparent" : "none"
													}
													onClick={(e: ReactMouseEvent) => {
														if (!collapsed) {
															handleGroupClick(entry, e.currentTarget as HTMLElement);
														}
													}}
													_hover={{
														md: {
															bg: hoverItemBg,
															color: "panel.text",
														},
													}}
													_active={{
														transform: "scale(0.98)",
													}}
												>
													<Box
														w="30px"
														h="30px"
														flexShrink={0}
														display="flex"
														alignItems="center"
														justifyContent="center"
														color={isGroupActive ? activeItemColor : "inherit"}
														transition="color 0.2s ease"
													>
														<GroupIcon />
													</Box>

													<Box
														flex="1"
														minW="0"
														ms={collapsed ? 0 : 2.5}
														overflow="hidden"
														whiteSpace="nowrap"
														opacity={collapsed ? 0 : 1}
														maxW={
															collapsed ? "0px" : "full"
														}
														transform={
															collapsed
																? isRTL
																	? "translateX(8px)"
																	: "translateX(-8px)"
																: "translateX(0)"
														}
														transition={
															collapsed
																? "max-width 0.26s cubic-bezier(0.16, 1, 0.3, 1), margin 0.26s cubic-bezier(0.16, 1, 0.3, 1), transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.18s cubic-bezier(0.16, 1, 0.3, 1) 0.12s"
																: "max-width 0.26s cubic-bezier(0.16, 1, 0.3, 1), margin 0.26s cubic-bezier(0.16, 1, 0.3, 1), transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.22s cubic-bezier(0.16, 1, 0.3, 1)"
														}
														pointerEvents={collapsed ? "none" : "auto"}
													>
														<Text
															noOfLines={1}
															color={
																isGroupActive ? "panel.text" : normalItemColor
															}
															fontSize="13px"
															fontWeight={isGroupActive ? "600" : "500"}
															lineHeight="normal"
														>
															{entry.title}
														</Text>
													</Box>

													<Flex
														align="center"
														justify="center"
														h="30px"
														w={collapsed ? "0px" : "20px"}
														flexShrink={0}
														ms="auto"
														overflow="hidden"
														opacity={collapsed ? 0 : 1}
														maxW={collapsed ? "0px" : "20px"}
														transition="max-width 0.24s cubic-bezier(0.16, 1, 0.3, 1), width 0.24s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease"
													>
														<Icon
															as={ChevronDownIcon}
															w="14px"
															h="14px"
															display="block"
															color={
																isGroupActive ? "panel.text" : "panel.textMuted"
															}
															transform={
																isOpen && !collapsed
																	? "rotate(180deg)"
																	: "rotate(0deg)"
															}
															transition="transform 0.24s cubic-bezier(0.16, 1, 0.3, 1)"
														/>
													</Flex>
												</Flex>
											);

											return (
												<Box key={entry.id} data-nav-group={entry.id}>
													{collapsed ? (
														<Popover
															trigger={popoverTrigger}
															placement={isRTL ? "left-start" : "right-start"}
															isLazy
															gutter={8}
															openDelay={0}
															closeDelay={60}
														>
															<PopoverTrigger>
																{groupTriggerContent}
															</PopoverTrigger>
															<Portal>
																<PopoverContent
																	bg="panel.surface"
																	borderColor="panel.border"
																	borderWidth="1px"
																	borderRadius="18px"
																	p="6px"
																	minW="160px"
																	maxW="200px"
																	boxShadow={sidebarShadow}
																	dir={isRTL ? "rtl" : "ltr"}
																	zIndex={9999}
																	_focus={{ outline: "none" }}
																>
																	<PopoverHeader
																		borderBottomWidth="1px"
																		borderColor="panel.border"
																		px={2.5}
																		py={1.5}
																		fontSize="11px"
																		fontWeight="700"
																		color="panel.text"
																	>
																		{entry.title}
																	</PopoverHeader>
																	<PopoverBody p={0} pt="3px">
																		<VStack align="stretch" spacing="2px">
																			{visibleSubs.map((sub) => {
																				const isSubActive =
																					location.pathname === sub.url ||
																					(sub.url !== "/" &&
																						location.pathname.startsWith(
																							sub.url,
																						));
																				const SubIcon = sub.icon;

																				return (
																					<Box
																						key={sub.id}
																						as={NavLink}
																						to={sub.url}
																						onClick={(e: ReactMouseEvent) =>
																							handleNavigate(sub.url, e)
																						}
																						display="block"
																					>
																						<Flex
																							align="center"
																							gap={2}
																							px={2}
																							py={1.5}
																							h={inDrawer ? "34px" : "30px"}
																							borderRadius="8px"
																							fontSize="11.5px"
																							fontWeight={
																								isSubActive ? "600" : "500"
																							}
																							bg={
																								isSubActive
																									? activeItemBg
																									: "transparent"
																							}
																							color={
																								isSubActive
																									? "panel.text"
																									: normalItemColor
																							}
																							borderInlineStart="2.5px solid"
																							borderInlineStartColor={
																								isSubActive
																									? "var(--rb-panel-accent)"
																									: "transparent"
																							}
																							transition="all 0.16s cubic-bezier(0.2, 0, 0, 1)"
																							_hover={{
																								md: {
																									bg: hoverItemBg,
																									color: "panel.text",
																								},
																							}}
																							_active={{
																								transform: "scale(0.98)",
																							}}
																						>
																							<Box
																								as="span"
																								color={
																									isSubActive
																										? activeItemColor
																										: "inherit"
																								}
																								fontSize="13px"
																							>
																								<SubIcon />
																							</Box>
																							<Text
																								noOfLines={1}
																								color={
																									isSubActive
																										? "panel.text"
																										: normalItemColor
																								}
																							>
																								{sub.title}
																							</Text>
																						</Flex>
																					</Box>
																				);
																			})}
																		</VStack>
																	</PopoverBody>
																</PopoverContent>
															</Portal>
														</Popover>
													) : (
														groupTriggerContent
													)}

													<AnimatePresence initial={false}>
														{isOpen && !collapsed && (
															<motion.div
																initial={{ opacity: 0, height: 0 }}
																animate={{ opacity: 1, height: "auto" }}
																exit={{ opacity: 0, height: 0 }}
																transition={{
																	duration: 0.28,
																	ease: [0.16, 1, 0.3, 1],
																}}
																style={{ overflow: "hidden" }}
															>
																<Box
																	ms="16px"
																	ps="10px"
																	my={1}
																	borderInlineStart="1.5px solid"
																	borderColor="panel.border"
																>
																	<VStack align="stretch" spacing={0.5}>
																		{visibleSubs.map((sub) => {
																			const isSubActive =
																				location.pathname === sub.url ||
																				(sub.url !== "/" &&
																					location.pathname.startsWith(
																						sub.url,
																					));
																			const SubIcon = sub.icon;

																			return (
																				<Box
																					key={sub.id}
																					as={NavLink}
																					to={sub.url}
																					onClick={(e: ReactMouseEvent) =>
																						handleNavigate(sub.url, e)
																					}
																					display="block"
																				>
																					<Flex
																						align="center"
																						justify="space-between"
																						w="full"
																						h="32px"
																						px={2.5}
																						borderRadius="8px"
																						bg={
																							isSubActive
																								? activeItemBg
																								: "transparent"
																						}
																						color={
																							isSubActive
																								? "panel.text"
																								: normalItemColor
																						}
																						fontWeight={
																							isSubActive ? "600" : "400"
																						}
																						fontSize="12px"
																						cursor="pointer"
																						transition="all 0.16s cubic-bezier(0.2, 0, 0, 1)"
																						borderInlineStart="2.5px solid"
																						borderInlineStartColor={
																							isSubActive
																								? "var(--rb-panel-accent)"
																								: "transparent"
																						}
																						_hover={{
																							md: {
																								bg: isSubActive
																									? activeItemBg
																									: hoverItemBg,
																								color: "panel.text",
																							},
																						}}
																						_active={{
																							transform: "scale(0.98)",
																						}}
																					>
																						<HStack spacing={2} align="center">
																							<Box
																								as="span"
																								display="inline-flex"
																								alignItems="center"
																								justifyContent="center"
																								color={
																									isSubActive
																										? activeItemColor
																										: "inherit"
																								}
																								opacity={isSubActive ? 1 : 0.8}
																							>
																								<SubIcon />
																							</Box>
																							<Text
																								noOfLines={1}
																								color={
																									isSubActive
																										? "panel.text"
																										: normalItemColor
																								}
																							>
																								{sub.title}
																							</Text>
																						</HStack>
																					</Flex>
																				</Box>
																			);
																		})}
																	</VStack>
																</Box>
															</motion.div>
														)}
													</AnimatePresence>
												</Box>
											);
										})}
									</VStack>
								</Box>
							);
						})}
					</VStack>
				</Box>
				{sidebarBanners.length > 0 && (
					<SidebarBannerSection
						banners={sidebarBanners}
						collapsed={collapsed}
						inDrawer={inDrawer}
					/>
				)}
			</Flex>
		</Box>
	);
});
