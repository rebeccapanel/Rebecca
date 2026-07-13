import {
	Box,
	chakra,
	HStack,
	Text,
	Tooltip,
	useColorMode,
	useColorModeValue,
	VStack,
} from "@chakra-ui/react";
import {
	BellAlertIcon,
	BookOpenIcon,
	BriefcaseIcon,
	ChartBarIcon,
	CircleStackIcon,
	CodeBracketSquareIcon,
	Cog6ToothIcon,
	Cog8ToothIcon,
	DocumentTextIcon,
	EyeIcon,
	HomeIcon,
	LinkIcon,
	ServerStackIcon,
	Squares2X2Icon,
	UserCircleIcon,
	UserGroupIcon,
	WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";
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
import { AdminRole, AdminSection } from "types/Admin";
import {
	getTutorialManifestUrl,
	getTutorialSeenKey,
	normalizeTutorialLang,
} from "utils/tutorials";

const iconProps = {
	baseStyle: {
		w: 5,
		h: 5,
	},
};

const HomeIconStyled = chakra(HomeIcon, iconProps);
const UsersIconStyled = chakra(UserGroupIcon, iconProps);
const SettingsIconStyled = chakra(Cog6ToothIcon, iconProps);
const MasterSettingsIconStyled = chakra(Cog8ToothIcon, iconProps);
const NodeIconStyled = chakra(ServerStackIcon, iconProps);
const AdminIconStyled = chakra(BriefcaseIcon, iconProps);
const ServicesIconStyled = chakra(Squares2X2Icon, iconProps);
const HostsIconStyled = chakra(LinkIcon, iconProps);
const UsageIconStyled = chakra(ChartBarIcon, iconProps);
const MyAccountIconStyled = chakra(UserCircleIcon, iconProps);
const InsightsIconStyled = chakra(EyeIcon, iconProps);
const TutorialIconStyled = chakra(BookOpenIcon, iconProps);
const XraySettingsIconStyled = chakra(WrenchScrewdriverIcon, iconProps);
const XrayLogsIconStyled = chakra(DocumentTextIcon, iconProps);
const ApiDocsIconStyled = chakra(CodeBracketSquareIcon, iconProps);
const PHPMyAdminIconStyled = chakra(CircleStackIcon, iconProps);
const TutorialUpdateIconStyled = chakra(BellAlertIcon, {
	baseStyle: {
		w: 3,
		h: 3,
	},
});
interface AppSidebarProps {
	collapsed: boolean;
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

const LogoIcon = chakra("img", {
	baseStyle: {
		w: 8,
		h: 8,
	},
});

export const AppSidebar: FC<AppSidebarProps> = ({
	collapsed,
	inDrawer = false,
	onRequestExpand,
}) => {
	const { t, i18n } = useTranslation();
	const location = useLocation();
	const navigate = useNavigate();
	const dashboardRoot = useHref("/");
	const { colorMode } = useColorMode();
	const { userData } = useGetUser();
	const currentLanguage = i18n.language || "en";
	const tutorialsUrl = "/tutorials";
	const sectionAccess = userData.permissions?.sections;
	const isFullAccess = userData.role === AdminRole.FullAccess;
	const isPrivilegedAdmin = isFullAccess || userData.role === AdminRole.Sudo;
	const sidebarBg = useColorModeValue("panel.sidebar", "panel.sidebar");
	const sidebarBorderColor = useColorModeValue("panel.border", "panel.border");
	const sidebarPanelBg = useColorModeValue("panel.elevated", "panel.elevated");
	const sidebarPanelBorder = useColorModeValue("panel.border", "panel.border");
	const itemColor = useColorModeValue(
		"panel.textSecondary",
		"panel.textSecondary",
	);
	const activeItemBg = useColorModeValue("panel.elevated", "panel.elevated");
	const activeItemColor = useColorModeValue("panel.text", "panel.text");
	const hoverItemBg = useColorModeValue("panel.elevated", "panel.elevated");
	const subNavBorder = useColorModeValue("panel.border", "panel.border");
	const logoTextColor = useColorModeValue("panel.text", "panel.text");
	const defaultSelfPermissions = {
		self_myaccount: false,
		self_change_password: false,
		self_api_keys: false,
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
					title: t("header.integrationSettings", "Settings"),
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
		sectionAccess?.[AdminSection.Xray]
			? {
					title: t("pages.xray.logs", "Xray Logs"),
					url: "/xray-logs",
					icon: XrayLogsIconStyled,
				}
			: null,
		sectionAccess?.[AdminSection.Xray]
			? {
					title: t("header.accessInsights", "Access insights"),
					url: "/access-insights",
					icon: InsightsIconStyled,
				}
			: null,
		isPrivilegedAdmin
			? {
					title: t("apiDocs.menu", "API Docs"),
					url: "/api-docs",
					icon: ApiDocsIconStyled,
				}
			: null,
		isPrivilegedAdmin
			? {
					title: t("phpmyadmin.menu", "phpMyAdmin"),
					url: "/phpmyadmin",
					icon: PHPMyAdminIconStyled,
				}
			: null,
		{
			title: t("tutorials.menu", "Tutorials"),
			url: tutorialsUrl,
			icon: TutorialIconStyled,
		},
	].filter(Boolean) as SidebarSubItems;

	const settingsSubItems: SidebarSubItems = [...baseSettingsSubItems];
	if (canViewServicesSection) {
		settingsSubItems.unshift({
			title: t("services.menu", "Services"),
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
	];

	if (selfAccess.self_myaccount) {
		items.splice(1, 0, {
			title: t("myaccount.menu"),
			url: "/myaccount",
			icon: MyAccountIconStyled,
		});
	}

	if (canViewUsage) {
		items.push({
			title: t("usage.menu", "Usage"),
			url: "/usage",
			icon: UsageIconStyled,
		});
	}
	if (canViewAdmins) {
		items.push({
			title: t("admins", "Admins"),
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
			title: t("sidebar.groups.dashboard", "Dashboard"),
			items: [pickDirect("/")],
		},
		{
			title: t("sidebar.groups.users", "Users"),
			items: [pickDirect("/users")],
		},
		{
			title: t("sidebar.groups.infrastructure", "Infrastructure"),
			items: [
				pickSetting("/node-settings"),
				pickSetting("/services"),
				pickSetting("/hosts"),
			],
		},
		{
			title: t("sidebar.groups.admin", "Admin"),
			items: [
				pickDirect("/admins"),
				pickDirect("/usage"),
				pickDirect("/myaccount"),
			],
		},
		{
			title: t("sidebar.groups.system", "System"),
			items: [
				pickSetting("/settings"),
				pickSetting("/xray-settings"),
				pickSetting("/xray-logs"),
				pickSetting("/access-insights"),
				pickSetting("/api-docs"),
				pickSetting("/phpmyadmin"),
				pickSetting(tutorialsUrl),
			],
		},
	].map((group) => ({
		...group,
		items: group.items.filter(Boolean) as SidebarItem[],
	}));

	const isRTL = i18n.dir(currentLanguage) === "rtl";

	return (
		<Box
			w={inDrawer ? "full" : collapsed ? "16" : "60"}
			h={inDrawer ? "100%" : "100vh"}
			maxH={inDrawer ? "100%" : "100vh"}
			bg={sidebarBg}
			borderRight={inDrawer || isRTL ? undefined : "1px"}
			borderLeft={inDrawer || !isRTL ? undefined : "1px"}
			borderColor={inDrawer ? undefined : sidebarBorderColor}
			transition="width 0.3s"
			position={inDrawer ? "relative" : "fixed"}
			top={inDrawer ? undefined : "0"}
			left={inDrawer || isRTL ? undefined : "0"}
			right={inDrawer || !isRTL ? undefined : "0"}
			overflow="hidden"
			flexShrink={0}
			userSelect="none"
		>
			<VStack
				spacing={2}
				p={collapsed ? 2 : 4}
				align="stretch"
				h="100%"
				minH={0}
				justify="space-between"
			>
				<Box
					flex="1"
					minH={0}
					overflowY="auto"
					overflowX="hidden"
					className="rb-sidebar-scroll"
					data-dir={isRTL ? "rtl" : "ltr"}
					data-collapsed={collapsed ? "true" : "false"}
					dir={isRTL ? "rtl" : "ltr"}
				>
					{!collapsed ? (
						<HStack
							spacing={3}
							align="center"
							mb={5}
							px={3}
							py={3}
							borderWidth="1px"
							borderColor={sidebarPanelBorder}
							borderRadius="md"
							bg={sidebarPanelBg}
						>
							<LogoIcon
								src={logoUrl}
								alt="Rebecca"
								filter={
									colorMode === "dark" ? "brightness(0) invert(1)" : "none"
								}
							/>
							<Text fontSize="lg" fontWeight="bold" color={logoTextColor}>
								{t("menu")}
							</Text>
						</HStack>
					) : (
						<HStack
							justify="center"
							mb={5}
							borderWidth="1px"
							borderColor={sidebarPanelBorder}
							borderRadius="md"
							bg={sidebarPanelBg}
							py={2}
						>
							<Tooltip label="Rebecca" placement="right" hasArrow>
								<LogoIcon
									src={logoUrl}
									alt="Rebecca"
									filter={
										colorMode === "dark" ? "brightness(0) invert(1)" : "none"
									}
								/>
							</Tooltip>
						</HStack>
					)}
					<VStack align="stretch" spacing={4}>
						{compactGroups.map((group) => {
							if (group.items.length === 0) return null;

							return (
								<Box key={group.title}>
									{collapsed ? (
										<Box
											borderTopWidth="1px"
											borderColor={subNavBorder}
											my={2}
											mx={2}
										/>
									) : (
										<Text
											px={3}
											mb={2}
											fontSize="11px"
											fontWeight="700"
											color="panel.textMuted"
											textTransform="uppercase"
										>
											{group.title}
										</Text>
									)}
									<VStack align="stretch" spacing={1}>
										{group.items.map((item) => {
											if (!item.url) return null;
											const itemUrl = item.url;
											const isActive =
												location.pathname === itemUrl ||
												(itemUrl !== "/" &&
													location.pathname.startsWith(itemUrl));
											const Icon = item.icon;
											const showTutorialBadge =
												itemUrl === tutorialsUrl && hasNewTutorials;
											const navItem = (
												<Tooltip
													key={itemUrl}
													label={collapsed ? item.title : ""}
													placement="right"
													hasArrow
												>
													<HStack
														spacing={3}
														px={collapsed ? 2 : 3}
														py={2}
														minH="40px"
														borderRadius="4px"
														cursor="pointer"
														bg={isActive ? activeItemBg : "transparent"}
														color={isActive ? activeItemColor : itemColor}
														borderInlineStartWidth="3px"
														borderInlineStartColor={
															isActive ? "panel.accent" : "transparent"
														}
														_hover={{
															bg: isActive ? activeItemBg : hoverItemBg,
															color: activeItemColor,
														}}
														transition="background 0.15s ease, color 0.15s ease"
														justifyContent={collapsed ? "center" : "flex-start"}
													>
														{showTutorialBadge && collapsed ? (
															<Box position="relative" display="inline-flex">
																<Icon
																	w={collapsed ? 5 : undefined}
																	h={collapsed ? 5 : undefined}
																/>
																<Box
																	position="absolute"
																	top="-6px"
																	right="-7px"
																	w="4"
																	h="4"
																	borderRadius="full"
																	bg="panel.accent"
																	color="white"
																	border="2px solid"
																	borderColor={sidebarBg}
																	display="inline-flex"
																	alignItems="center"
																	justifyContent="center"
																>
																	<TutorialUpdateIconStyled />
																</Box>
															</Box>
														) : (
															<Icon
																w={collapsed ? 5 : undefined}
																h={collapsed ? 5 : undefined}
															/>
														)}
														{!collapsed && (
															<>
																<Text
																	fontSize="sm"
																	fontWeight={isActive ? "700" : "600"}
																	noOfLines={1}
																>
																	{item.title}
																</Text>
																{showTutorialBadge ? (
																	<Box
																		ml="auto"
																		w="5"
																		h="5"
																		borderRadius="full"
																		bg="panel.accent"
																		color="white"
																		display="inline-flex"
																		alignItems="center"
																		justifyContent="center"
																	>
																		<TutorialUpdateIconStyled />
																	</Box>
																) : null}
															</>
														)}
													</HStack>
												</Tooltip>
											);

											return (
												<NavLink
													key={itemUrl}
													to={itemUrl}
													onClick={(e) => handleNavClick(e, itemUrl)}
												>
													{navItem}
												</NavLink>
											);
										})}
									</VStack>
								</Box>
							);
						})}
					</VStack>
				</Box>
			</VStack>
		</Box>
	);
};
