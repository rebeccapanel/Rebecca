import {
	Box,
	Collapse,
	chakra,
	HStack,
	Text,
	Tooltip,
	useColorMode,
	VStack,
} from "@chakra-ui/react";
import {
	ChartPieIcon,
	ChevronDownIcon,
	Cog6ToothIcon,
	GlobeAltIcon,
	HomeIcon,
	BookOpenIcon,
	ServerIcon,
	ShieldCheckIcon,
	Square3Stack3DIcon,
	Squares2X2Icon,
	UserCircleIcon,
	UsersIcon,
} from "@heroicons/react/24/outline";
import logoUrl from "assets/logo.svg";
import useAds from "hooks/useAds";
import useGetUser from "hooks/useGetUser";
import {
	type ElementType,
	type FC,
	type MouseEvent as ReactMouseEvent,
	useEffect,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { AdminRole, AdminSection } from "types/Admin";
import { pickLocalizedAd } from "utils/ads";
import { AdvertisementCard } from "./AdvertisementCard";

const iconProps = {
	baseStyle: {
		w: 5,
		h: 5,
	},
};

const HomeIconStyled = chakra(HomeIcon, iconProps);
const UsersIconStyled = chakra(UsersIcon, iconProps);
const ServerIconStyled = chakra(ServerIcon, iconProps);
const SettingsIconStyled = chakra(Cog6ToothIcon, iconProps);
const NetworkIconStyled = chakra(Square3Stack3DIcon, iconProps);
const AdminIconStyled = chakra(ShieldCheckIcon, iconProps);
const ChevronDownIconStyled = chakra(ChevronDownIcon, iconProps);
const ServicesIconStyled = chakra(Squares2X2Icon, iconProps);
const UsageIconStyled = chakra(ChartPieIcon, iconProps);
const MyAccountIconStyled = chakra(UserCircleIcon, iconProps);
const InsightsIconStyled = chakra(GlobeAltIcon, iconProps);
const TutorialIconStyled = chakra(BookOpenIcon, iconProps);
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
	subItems?: { title: string; url: string; icon: ElementType }[];
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
	const { colorMode } = useColorMode();
	const { userData, getUserIsSuccess } = useGetUser();
	const shouldShowAds = getUserIsSuccess;
	const { data: adsData } = useAds(shouldShowAds);
	const currentLanguage = i18n.language || "en";
	const sidebarAd = shouldShowAds
		? pickLocalizedAd(adsData, "sidebar", currentLanguage)
		: undefined;
	const sectionAccess = userData.permissions?.sections;
	const isFullAccess = userData.role === AdminRole.FullAccess;
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

	const baseSettingsSubItems: SidebarSubItems = [
		sectionAccess?.[AdminSection.Hosts]
			? {
					title: t("header.hostSettings"),
					url: "/hosts",
					icon: ServerIconStyled,
				}
			: null,
		sectionAccess?.[AdminSection.Nodes]
			? {
					title: t("header.nodeSettings"),
					url: "/node-settings",
					icon: NetworkIconStyled,
				}
			: null,
		sectionAccess?.[AdminSection.Integrations]
			? {
					title: t("header.integrationSettings", "Master Settings"),
					url: "/integrations",
					icon: SettingsIconStyled,
				}
			: null,
		sectionAccess?.[AdminSection.Xray]
			? {
					title: t("header.xraySettings"),
					url: "/xray-settings",
					icon: SettingsIconStyled,
				}
			: null,
		sectionAccess?.[AdminSection.Xray]
			? {
					title: t("header.accessInsights", "Access insights"),
					url: "/access-insights",
					icon: InsightsIconStyled,
				}
			: null,
	].filter(Boolean) as SidebarSubItems;

	const settingsSubItems: SidebarSubItems = [...baseSettingsSubItems];
	if (canViewServicesSection) {
		settingsSubItems.unshift({
			title: t("services.menu", "Services"),
			url: "/services",
			icon: ServicesIconStyled,
		});
	}

	const isSettingsRoute = settingsSubItems.some(
		(sub) => location.pathname === sub.url,
	);
	const [isSettingsOpen, setSettingsOpen] = useState(isSettingsRoute);

	useEffect(() => {
		if (isSettingsRoute) {
			setSettingsOpen(true);
		}
	}, [isSettingsRoute]);

	const defaultTabByPath: Record<string, string> = {
		"/integrations": "panel",
		"/hosts": "inbounds",
		"/usage": "services",
		"/xray-settings": "basic",
	};

	const handleNavClick = (
		event?: ReactMouseEvent,
		targetUrl?: string,
	) => {
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
	items.push({
		title: t("tutorials.menu", "Tutorials"),
		url: "/tutorials",
		icon: TutorialIconStyled,
	});
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

	const isRTL = currentLanguage === "fa";

	return (
		<Box
			w={inDrawer ? "full" : collapsed ? "16" : "60"}
			h={inDrawer ? "100%" : "100vh"}
			maxH={inDrawer ? "100%" : "100vh"}
			bg="surface.light"
			borderRight={inDrawer || isRTL ? undefined : "1px"}
			borderLeft={inDrawer || !isRTL ? undefined : "1px"}
			borderColor={inDrawer ? undefined : "light-border"}
			_dark={{
				bg: "surface.dark",
				borderColor: inDrawer ? undefined : "whiteAlpha.200",
			}}
			transition="width 0.3s"
			position={inDrawer ? "relative" : "fixed"}
			top={inDrawer ? undefined : "0"}
			left={inDrawer || isRTL ? undefined : "0"}
			right={inDrawer || !isRTL ? undefined : "0"}
			overflowY="auto"
			overflowX="hidden"
			flexShrink={0}
			userSelect="none"
		>
			<VStack
				spacing={2}
				p={collapsed ? 2 : 4}
				align="stretch"
				h="100%"
				justify="space-between"
			>
				<Box flex="1" overflowY="auto">
					{!collapsed ? (
						<HStack spacing={3} align="center" mb={6} px={2}>
							<LogoIcon
								src={logoUrl}
								alt="Rebecca"
								filter={
									colorMode === "dark" ? "brightness(0) invert(1)" : "none"
								}
							/>
							<Text
								fontSize="lg"
								fontWeight="bold"
								color="primary.600"
								_dark={{ color: "primary.300" }}
							>
								{t("menu")}
							</Text>
						</HStack>
					) : (
						<HStack justify="center" mb={6}>
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
					{items.map((item) => {
						const itemUrl = item.url;
						const isActive =
							(typeof itemUrl === "string" && location.pathname === itemUrl) ||
							(typeof itemUrl === "string" &&
								itemUrl !== "/" &&
								location.pathname.startsWith(itemUrl)) ||
							item.subItems?.some((sub) => location.pathname === sub.url);
						const Icon = item.icon;

						return (
							<Box key={item.title}>
								{item.subItems ? (
									<>
										<Tooltip
											label={collapsed ? item.title : ""}
											placement="right"
											hasArrow
										>
											<HStack
												spacing={3}
												px={3}
												py={2}
												borderRadius="md"
												cursor="pointer"
												bg={isActive ? "primary.50" : "transparent"}
												color={isActive ? "primary.600" : "gray.700"}
												_dark={{
													bg: isActive ? "primary.900" : "transparent",
													color: isActive ? "primary.200" : "gray.300",
												}}
												_hover={{
													bg: isActive ? "primary.50" : "gray.50",
													_dark: {
														bg: isActive ? "primary.900" : "gray.700",
													},
												}}
												transition="all 0.2s"
												justifyContent={collapsed ? "center" : "space-between"}
												onClick={() => {
													if (collapsed) {
														// request parent to expand the sidebar and open settings
														onRequestExpand?.();
														setSettingsOpen(true);
													} else {
														setSettingsOpen(!isSettingsOpen);
													}
												}}
											>
												<HStack spacing={3}>
													<Icon
														w={collapsed ? 5 : undefined}
														h={collapsed ? 5 : undefined}
													/>
													{!collapsed && (
														<Text
															fontSize="sm"
															fontWeight={isActive ? "semibold" : "normal"}
														>
															{item.title}
														</Text>
													)}
												</HStack>
												{!collapsed && (
													<ChevronDownIconStyled
														transform={
															isSettingsOpen ? "rotate(180deg)" : "rotate(0deg)"
														}
													/>
												)}
											</HStack>
										</Tooltip>
										{!collapsed && (
											<Collapse in={isSettingsOpen} animateOpacity>
												<VStack align="stretch" pl={6} spacing={1} mt={2}>
													{item.subItems.map((subItem) => {
														const isSubActive =
															location.pathname === subItem.url;
														const SubIcon = subItem.icon;
														return (
															<NavLink
																key={subItem.url}
																to={subItem.url}
																onClick={(e) =>
																	handleNavClick(e, subItem.url)
																}
															>
																<HStack
																	spacing={3}
																	px={3}
																	py={2}
																	borderRadius="md"
																	cursor="pointer"
																	bg={
																		isSubActive ? "primary.50" : "transparent"
																	}
																	color={
																		isSubActive ? "primary.600" : "gray.700"
																	}
																	_dark={{
																		bg: isSubActive
																			? "primary.900"
																			: "transparent",
																		color: isSubActive
																			? "primary.200"
																			: "gray.300",
																	}}
																	_hover={{
																		bg: isSubActive ? "primary.50" : "gray.50",
																		_dark: {
																			bg: isSubActive
																				? "primary.900"
																				: "gray.700",
																		},
																	}}
																	transition="all 0.2s"
																>
																	<SubIcon
																		w={collapsed ? 5 : undefined}
																		h={collapsed ? 5 : undefined}
																	/>
																	<Text
																		fontSize="sm"
																		fontWeight={
																			isSubActive ? "semibold" : "normal"
																		}
																	>
																		{subItem.title}
																	</Text>
																</HStack>
															</NavLink>
														);
													})}
												</VStack>
											</Collapse>
										)}
									</>
								) : item.url ? (
									<NavLink
										to={item.url}
										onClick={(e) => handleNavClick(e, item.url)}
									>
										<Tooltip
											label={collapsed ? item.title : ""}
											placement="right"
											hasArrow
										>
											<HStack
												spacing={3}
												px={3}
												py={2}
												borderRadius="md"
												cursor="pointer"
												bg={isActive ? "primary.50" : "transparent"}
												color={isActive ? "primary.600" : "gray.700"}
												_dark={{
													bg: isActive ? "primary.900" : "transparent",
													color: isActive ? "primary.200" : "gray.300",
												}}
												_hover={{
													bg: isActive ? "primary.50" : "gray.50",
													_dark: {
														bg: isActive ? "primary.900" : "gray.700",
													},
												}}
												transition="all 0.2s"
												justifyContent={collapsed ? "center" : "flex-start"}
											>
												<Icon
													w={collapsed ? 5 : undefined}
													h={collapsed ? 5 : undefined}
												/>
												{!collapsed && (
													<Text
														fontSize="sm"
														fontWeight={isActive ? "semibold" : "normal"}
													>
														{item.title}
													</Text>
												)}
											</HStack>
										</Tooltip>
									</NavLink>
								) : null}
							</Box>
						);
					})}
				</Box>
				{sidebarAd && !collapsed && (
					<Box px={collapsed ? 2 : 2.5} py={2.5} mt={4} w="full">
						<AdvertisementCard ad={sidebarAd} maxSize={440} />
					</Box>
				)}
			</VStack>
		</Box>
	);
};
