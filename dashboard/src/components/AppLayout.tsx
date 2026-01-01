import {
	Box,
	Button,
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	chakra,
	Drawer,
	DrawerBody,
	DrawerContent,
	DrawerOverlay,
	Flex,
	HStack,
	IconButton,
	Menu,
	MenuButton,
	MenuItem,
	MenuList,
	Portal,
	Text,
	useBreakpointValue,
	useColorModeValue,
	useDisclosure,
	VStack,
} from "@chakra-ui/react";
import {
	ArrowLeftOnRectangleIcon,
	Bars3Icon,
	CheckIcon,
	LanguageIcon,
	UserCircleIcon,
} from "@heroicons/react/24/outline";
import { useAppleEmoji } from "hooks/useAppleEmoji";
import useGetUser from "hooks/useGetUser";
import {
	type MouseEvent as ReactMouseEvent,
	useMemo,
	useRef,
	useState,
} from "react";
import ReactCountryFlag from "react-country-flag";
import { useTranslation } from "react-i18next";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { AdminRole } from "types/Admin";
import { ReactComponent as ImperialIranFlag } from "../assets/imperial-iran-flag.svg";
import { AppSidebar } from "./AppSidebar";
import { HeaderCalendar } from "./HeaderCalendar";
import { GitHubStars } from "./GitHubStars";
import ThemeSelector from "./ThemeSelector";

const iconProps = {
	baseStyle: {
		w: 4,
		h: 4,
	},
};

const LogoutIcon = chakra(ArrowLeftOnRectangleIcon, iconProps);
const MenuIcon = chakra(Bars3Icon, iconProps);
const LanguageIconStyled = chakra(LanguageIcon, iconProps);
const UserIcon = chakra(UserCircleIcon, iconProps);

export function AppLayout() {
	const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
	const isMobile = useBreakpointValue({ base: true, md: false });
	const sidebarDrawer = useDisclosure();
	const languageMenu = useDisclosure();
	const userMenu = useDisclosure();
	const { t, i18n } = useTranslation();
	const { userData, getUserIsSuccess } = useGetUser();
	const navigate = useNavigate();
	const location = useLocation();
	useAppleEmoji();
	const isRTL = i18n.language === "fa";
	const userMenuContentRef = useRef<HTMLDivElement | null>(null);
	const [isThemeModalOpen, setIsThemeModalOpen] = useState(false);

	const menuBg = useColorModeValue("white", "gray.800");
	const menuBorder = useColorModeValue("gray.200", "gray.700");
	const menuHover = useColorModeValue("gray.100", "gray.700");
	const textColor = useColorModeValue("gray.800", "gray.100");
	const secondaryTextColor = useColorModeValue("gray.600", "gray.400");

	const roleLabel = useMemo(() => {
		switch (userData.role) {
			case AdminRole.FullAccess:
				return t("admins.roles.fullAccess", "Full access");
			case AdminRole.Sudo:
				return t("admins.roles.sudo", "Sudo");
			case AdminRole.Reseller:
				return t("admins.roles.reseller", "Reseller");
			default:
				return t("admins.roles.standard", "Standard");
		}
	}, [t, userData.role]);

	const languageItems = [
		{ code: "en", label: "English", flag: "US" },
		{ code: "fa", label: "پارسی", flag: "IR" },
		{ code: "zh-cn", label: "中文", flag: "CN" },
		{ code: "ru", label: "Русский", flag: "RU" },
	];

	const changeLanguage = (lang: string) => {
		i18n.changeLanguage(lang);
	};

	const closeUserMenu = () => {
		userMenu.onClose();
		languageMenu.onClose();
	};

	const handleUserMenuClose = () => {
		if (isThemeModalOpen) return;
		closeUserMenu();
	};

	const handleThemeModalOpen = () => setIsThemeModalOpen(true);
	const handleThemeModalClose = () => setIsThemeModalOpen(false);

	type BreadcrumbEntry = {
		href: string;
		labelKey?: string;
		defaultLabel?: string;
		label?: string;
	};

	const breadcrumbs = useMemo(() => {
		let pathKey =
			location.pathname !== "/" ? location.pathname.replace(/\/+$/, "") : "/";
		if (pathKey === "/" && typeof window !== "undefined") {
			const rawHashPath = window.location.hash || "";
			if (rawHashPath.startsWith("#/")) {
				const withoutHash = rawHashPath.slice(1);
				const firstSplit = withoutHash.split("#")[0] || "";
				if (firstSplit) {
					pathKey = firstSplit.startsWith("/") ? firstSplit : `/${firstSplit}`;
				}
			}
		}
		if (pathKey !== "/" && pathKey.endsWith("/")) {
			pathKey = pathKey.replace(/\/+$/, "");
		}
		let rawTabHash = (location.hash || "").replace(/^#/, "");
		if (!rawTabHash && typeof window !== "undefined") {
			const rawHash = window.location.hash || "";
			const secondIdx = rawHash.indexOf("#", 1);
			if (secondIdx >= 0 && secondIdx + 1 < rawHash.length) {
				rawTabHash = rawHash.slice(secondIdx + 1);
			}
		}
		const tabHash = rawTabHash.toLowerCase();
		const tabLabelForHash = (labels: Record<string, string>) => {
			if (!tabHash) return null;
			return labels[tabHash] || null;
		};
		const buildTabCrumb = (label?: string): BreadcrumbEntry[] => {
			if (!label) return [];
			const href = `${pathKey}${location.search || ""}${
				rawTabHash ? `#${rawTabHash}` : ""
			}`;
			return [{ href, label }];
		};

		const base: BreadcrumbEntry = {
			href: "/",
			labelKey: "breadcrumbs.dashboard",
			defaultLabel: "Dashboard",
		};
		const usageTabLabels = {
			services: t("usage.tabs.services", "Services"),
			admins: t("usage.tabs.admins", "Admins"),
			nodes: t("usage.tabs.nodes", "Nodes"),
		};
		const hostsTabLabels = {
			inbounds: t("hostsPage.tabInbounds", "Inbounds"),
			hosts: t("hostsPage.tabHosts", "Hosts"),
		};
		const integrationsTabLabels = {
			panel: t("settings.panel.tabTitle"),
			telegram: t("settings.telegram"),
			subscriptions: t("settings.subscriptions.tabTitle", "Subscriptions"),
		};
		const xrayTabLabels = {
			basic: t("pages.xray.basicTemplate"),
			routing: t("pages.xray.Routings"),
			outbounds: t("pages.xray.Outbounds"),
			balancers: t("pages.xray.Balancers"),
			dns: "DNS",
			advanced: t("pages.xray.advancedTemplate"),
			logs: t("pages.xray.logs"),
		};
		const defaultTabByPath: Record<string, string> = {
			"/usage": "services",
			"/hosts": "inbounds",
			"/integrations": "panel",
			"/xray-settings": "basic",
		};
		const hrefWithDefaultTab = (path: string) => {
			const tab = defaultTabByPath[path];
			return tab ? `${path}#${tab}` : path;
		};

		switch (pathKey) {
			case "/users":
				return [
					base,
					{
						href: "/users",
						labelKey: "breadcrumbs.users",
						defaultLabel: "Users",
					},
				];
			case "/admins":
				return [
					base,
					{
						href: "/admins",
						labelKey: "breadcrumbs.admins",
						defaultLabel: "Admins",
					},
				];
			case "/myaccount":
				return [
					base,
					{
						href: "/myaccount",
						labelKey: "breadcrumbs.myAccount",
						defaultLabel: "My Account",
					},
				];
			case "/usage":
				return [
					base,
					{
						href: hrefWithDefaultTab("/usage"),
						labelKey: "breadcrumbs.usage",
						defaultLabel: "Usage",
					},
					...buildTabCrumb(tabLabelForHash(usageTabLabels) || undefined),
				];
			case "/tutorials":
				return [
					base,
					{
						href: "/tutorials",
						labelKey: "breadcrumbs.tutorials",
						defaultLabel: "Tutorials",
					},
				];
			case "/services":
				return [
					base,
					{
						href: "/services",
						labelKey: "breadcrumbs.services",
						defaultLabel: "Services",
					},
				];
			case "/hosts":
				return [
					base,
					{
						href: hrefWithDefaultTab("/hosts"),
						labelKey: "breadcrumbs.hosts",
						defaultLabel: "Hosts",
					},
					...buildTabCrumb(tabLabelForHash(hostsTabLabels) || undefined),
				];
			case "/node-settings":
				return [
					base,
					{
						href: "/node-settings",
						labelKey: "breadcrumbs.nodeSettings",
						defaultLabel: "Node Settings",
					},
				];
			case "/integrations":
				return [
					base,
					{
						href: hrefWithDefaultTab("/integrations"),
						labelKey: "breadcrumbs.integrations",
						defaultLabel: "Integration Settings",
					},
					...buildTabCrumb(tabLabelForHash(integrationsTabLabels) || undefined),
				];
			case "/xray-settings":
				return [
					base,
					{
						href: hrefWithDefaultTab("/xray-settings"),
						labelKey: "breadcrumbs.xraySettings",
						defaultLabel: "Xray Settings",
					},
					...buildTabCrumb(tabLabelForHash(xrayTabLabels) || undefined),
				];
			case "/xray-logs":
				return [
					base,
					{
						href: "/xray-logs",
						labelKey: "breadcrumbs.xrayLogs",
						defaultLabel: "Xray Logs",
					},
				];
			case "/access-insights":
				return [
					base,
					{
						href: "/access-insights",
						labelKey: "breadcrumbs.accessInsights",
						defaultLabel: "Access insights",
					},
				];
			default:
				return [base];
		}
	}, [location.pathname, location.hash, t, location.search]);

	return (
		<>
			<Box display="none" aria-hidden="true">
				<ThemeSelector minimal trigger="icon" />
			</Box>
			<Flex
				minH="100vh"
				maxH="100vh"
				overflow="hidden"
				direction={isRTL ? "row-reverse" : "row"}
				dir={isRTL ? "rtl" : "ltr"}
			>
				{/* persistent sidebar on md+; drawer on mobile */}
				{!isMobile ? (
					<AppSidebar
						collapsed={sidebarCollapsed}
						onRequestExpand={() => setSidebarCollapsed(false)}
					/>
				) : null}

				<Flex
					flex="1"
					direction="column"
					minW="0"
					overflow="hidden"
					ml={isMobile || isRTL ? "0" : sidebarCollapsed ? "16" : "60"}
					mr={isMobile || !isRTL ? "0" : sidebarCollapsed ? "16" : "60"}
					transition={isRTL ? "margin-right 0.3s" : "margin-left 0.3s"}
				>
					<Box
						as="header"
						h="16"
						minH="16"
						borderBottom="1px"
						borderColor="light-border"
						bg="surface.light"
						_dark={{ borderColor: "whiteAlpha.200", bg: "surface.dark" }}
						display="flex"
						alignItems="center"
						px="6"
						justifyContent="space-between"
						flexShrink={0}
						position="sticky"
						top={0}
						zIndex={100}
						userSelect="none"
						gap={4}
					>
						<HStack spacing={3} alignItems="center" flex="1" minW="0">
							<IconButton
								size="sm"
								variant="ghost"
								aria-label="toggle sidebar"
								onClick={() => {
									if (isMobile) sidebarDrawer.onOpen();
									else setSidebarCollapsed(!sidebarCollapsed);
								}}
								icon={<MenuIcon />}
								flexShrink={0}
							/>
							<Breadcrumb
								separator={
									<Text color="gray.500" _dark={{ color: "gray.400" }}>
										&gt;
									</Text>
								}
								fontSize="sm"
								color="gray.600"
								_dark={{ color: "gray.300" }}
								display={{ base: "none", md: "flex" }}
								dir={isRTL ? "rtl" : "ltr"}
								minW="0"
								flex="1"
							>
								{breadcrumbs.map((crumb, index) => {
									const isLast = index === breadcrumbs.length - 1;
									const label = String(
										crumb.label ??
											(crumb.labelKey
												? t(crumb.labelKey, {
														defaultValue: crumb.defaultLabel || "",
													})
												: crumb.defaultLabel ?? ""),
									);
									return (
										<BreadcrumbItem key={crumb.href} isCurrentPage={isLast}>
											<BreadcrumbLink
												as={Link}
												to={crumb.href}
												fontWeight={isLast ? "semibold" : "medium"}
												color={isLast ? "primary.600" : undefined}
												_dark={isLast ? { color: "primary.200" } : undefined}
											>
												{label}
											</BreadcrumbLink>
										</BreadcrumbItem>
									);
								})}
							</Breadcrumb>
						</HStack>
						<HStack spacing={2} alignItems="center" flexShrink={0}>
							<HeaderCalendar />
							<GitHubStars />

							{/* User Menu */}
							{getUserIsSuccess && userData.username && (
								<Menu
									placement="bottom-end"
									isLazy
									closeOnSelect={false}
									isOpen={userMenu.isOpen}
									onOpen={userMenu.onOpen}
									onClose={handleUserMenuClose}
								>
									<MenuButton
										as={Button}
										size="sm"
										variant="ghost"
										leftIcon={<UserIcon />}
										aria-label="user menu"
										fontSize="sm"
										fontWeight="medium"
										onClick={() => {
											if (userMenu.isOpen) {
												handleUserMenuClose();
											} else {
												userMenu.onOpen();
											}
										}}
									>
										<Text
											display={{ base: "none", sm: "inline" }}
											maxW={{ base: "100px", sm: "150px" }}
											isTruncated
										>
											{userData.username}
										</Text>
									</MenuButton>
									<MenuList
										dir={isRTL ? "rtl" : "ltr"}
										ref={userMenuContentRef}
										minW="220px"
										bg={menuBg}
										borderColor={menuBorder}
										color={textColor}
										zIndex={9999}
										userSelect="none"
										sx={{
											".chakra-menu__menuitem": {
												bg: "transparent !important",
												"&:hover": {
													bg: `${menuHover} !important`,
												},
												"&:active, &:focus": {
													bg: `${menuHover} !important`,
												},
											},
										}}
									>
										{/* User Info */}
										<Box
											px={3}
											py={2}
											borderBottom="1px"
											borderColor={menuBorder}
										>
											<VStack align="flex-start" spacing={1}>
												<HStack spacing={2}>
													<UserIcon />
													<Text fontWeight="medium" fontSize="sm">
														{userData.username}
													</Text>
												</HStack>
												<Text fontSize="xs" color={secondaryTextColor}>
													{roleLabel}
												</Text>
											</VStack>
										</Box>

										{/* Language Selector */}
										<Menu
											placement={isRTL ? "left-start" : "right-start"}
											strategy="fixed"
											isOpen={languageMenu.isOpen}
											onOpen={languageMenu.onOpen}
											onClose={languageMenu.onClose}
											closeOnSelect={false}
											isLazy
										>
											<MenuButton
												as={MenuItem}
												icon={<LanguageIconStyled />}
												onClick={(e: ReactMouseEvent) => {
													e.stopPropagation();
													languageMenu.isOpen
														? languageMenu.onClose()
														: languageMenu.onOpen();
												}}
											>
												<HStack justify="space-between" w="full">
													<Text>{t("header.language", "Language")}</Text>
													<Text fontSize="xs" color={secondaryTextColor}>
														{languageItems.find(
															(item) => item.code === i18n.language,
														)?.label || "English"}
													</Text>
												</HStack>
											</MenuButton>
											<Portal containerRef={userMenuContentRef}>
												<MenuList
													dir={isRTL ? "rtl" : "ltr"}
													minW="160px"
													bg={menuBg}
													borderColor={menuBorder}
													color={textColor}
													zIndex={9999}
													userSelect="none"
													sx={{
														".chakra-menu__menuitem": {
															bg: "transparent !important",
															"&:hover": {
																bg: `${menuHover} !important`,
															},
															"&:active, &:focus": {
																bg: `${menuHover} !important`,
															},
														},
													}}
												>
													{languageItems.map(({ code, label, flag }) => {
														const isActiveLang = i18n.language === code;
														return (
															<MenuItem
																key={code}
																onClick={() => {
																	changeLanguage(code);
																	languageMenu.onClose();
																}}
															>
																<HStack justify="space-between" w="full">
																	<HStack spacing={2}>
																		{code === "fa" ? (
																			<ImperialIranFlag
																				style={{
																					width: "16px",
																					height: "12px",
																				}}
																			/>
																		) : (
																			<ReactCountryFlag
																				countryCode={flag}
																				svg
																				style={{
																					width: "16px",
																					height: "12px",
																				}}
																			/>
																		)}
																		<Text>{label}</Text>
																	</HStack>
																	{isActiveLang && <CheckIcon width={16} />}
																</HStack>
															</MenuItem>
														);
													})}
												</MenuList>
											</Portal>
										</Menu>

										{/* Theme Selector */}
										<ThemeSelector
											trigger="menuItem"
											triggerLabel={t("header.theme", "Theme")}
											portalContainer={userMenuContentRef}
											onModalOpen={handleThemeModalOpen}
											onModalClose={handleThemeModalClose}
										/>

										{/* Logout */}
										<MenuItem
											icon={<LogoutIcon />}
											color="red.500"
											bg="transparent"
											_hover={{ bg: menuHover }}
											_active={{ bg: menuHover }}
											_focus={{ bg: menuHover }}
											onClick={() => {
												navigate("/login");
											}}
										>
											{t("header.logout", "Log out")}
										</MenuItem>
									</MenuList>
								</Menu>
							)}
						</HStack>
					</Box>
					<Box as="main" flex="1" p="6" overflow="auto" minH="0">
						<Outlet />
					</Box>
				</Flex>

				{/* mobile drawer */}
				{isMobile && (
					<Drawer
						isOpen={sidebarDrawer.isOpen}
						placement={isRTL ? "right" : "left"}
						onClose={sidebarDrawer.onClose}
						size="xs"
					>
						<DrawerOverlay />
						<DrawerContent bg="surface.light" _dark={{ bg: "surface.dark" }}>
							<DrawerBody p={0}>
								<AppSidebar
									collapsed={false}
									inDrawer
									onRequestExpand={sidebarDrawer.onClose}
								/>
							</DrawerBody>
						</DrawerContent>
					</Drawer>
				)}
			</Flex>
		</>
	);
}
