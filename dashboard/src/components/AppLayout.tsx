import {
	Box,
	Button,
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
	Popover,
	PopoverBody,
	PopoverContent,
	PopoverTrigger,
	Portal,
	Text,
	useBreakpointValue,
	useColorModeValue,
	useDisclosure,
	VStack,
	type PlacementWithLogical,
} from "@chakra-ui/react";
import {
	ArrowLeftOnRectangleIcon,
	Bars3Icon,
	CheckIcon,
	LanguageIcon,
	ShieldCheckIcon,
	Squares2X2Icon,
	UserCircleIcon,
	UserGroupIcon,
} from "@heroicons/react/24/outline";
import { ArrowUpOnSquareIcon } from "@heroicons/react/24/outline";
import { useAppleEmoji } from "hooks/useAppleEmoji";
import useGetUser from "hooks/useGetUser";
import {
	type MouseEvent as ReactMouseEvent,
	useMemo,
	useRef,
	useState,
	useEffect,
	useLayoutEffect,
} from "react";
import ReactCountryFlag from "react-country-flag";
import { useTranslation } from "react-i18next";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
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
const HomeIcon = chakra(Squares2X2Icon, iconProps);
const UsersIcon = chakra(UserGroupIcon, iconProps);
const AdminsIcon = chakra(ShieldCheckIcon, iconProps);
const ShareIcon = chakra(ArrowUpOnSquareIcon, iconProps);

export function AppLayout() {
	const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
	const isMobile = useBreakpointValue({ base: true, md: false });
	const sidebarDrawer = useDisclosure();
	const languageMenu = useDisclosure();
	const userMenu = useDisclosure();
	const accountMenu = useDisclosure();
	const { t, i18n } = useTranslation();
	const { userData, getUserIsSuccess } = useGetUser();
	const navigate = useNavigate();
	const location = useLocation();
	useAppleEmoji();
	const isRTL = i18n.language === "fa";
	const userMenuContentRef = useRef<HTMLDivElement | null>(null);
	const [isThemeModalOpen, setIsThemeModalOpen] = useState(false);
	const contentRef = useRef<HTMLDivElement | null>(null);
	const [showIosPrompt, setShowIosPrompt] = useState(false);
	const accountHoldTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
	const accountHoldOpened = useRef(false);
	const accountHoldStartPoint = useRef<{ x: number; y: number } | null>(null);
	const tabContentRefs = useRef<Record<string, HTMLDivElement | null>>({});
	const navContainerRef = useRef<HTMLDivElement | null>(null);
	const [activeSelector, setActiveSelector] = useState({
		x: 0,
		y: 0,
		width: 0,
		height: 0,
		visible: false,
	});
	const languagePlacement =
		useBreakpointValue<PlacementWithLogical>({
			base: "bottom-start",
			md: isRTL ? "left-start" : "right-start",
		}) ?? "bottom-start";

	const menuBg = useColorModeValue("white", "gray.800");
	const menuBorder = useColorModeValue("gray.200", "gray.700");
	const menuHover = useColorModeValue("gray.100", "gray.700");
	const textColor = useColorModeValue("gray.800", "gray.100");
	const secondaryTextColor = useColorModeValue("gray.600", "gray.400");
	const glassPanelBg = useColorModeValue(
		"rgba(255, 255, 255, 0.45)",
		"rgba(18, 18, 22, 0.35)",
	);
	const glassPanelFallbackBg = useColorModeValue(
		"rgba(255, 255, 255, 0.85)",
		"rgba(24, 24, 28, 0.75)",
	);
	const glassPanelBorder = useColorModeValue(
		"rgba(255, 255, 255, 0.35)",
		"rgba(255, 255, 255, 0.14)",
	);
	const glassPanelShadow = useColorModeValue(
		"0 12px 32px rgba(15, 23, 42, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.45)",
		"0 12px 32px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.12)",
	);
	const glassPanelRefraction = useColorModeValue(
		"radial-gradient(closest-side at 28% 20%, rgba(255, 255, 255, 0.75), rgba(255, 255, 255, 0.2) 55%, transparent 70%), radial-gradient(closest-side at 78% 70%, rgba(255, 255, 255, 0.35), transparent 60%), radial-gradient(closest-side at 52% 58%, rgba(255, 255, 255, 0.28), rgba(255, 255, 255, 0.05) 60%, transparent 78%), conic-gradient(from 180deg at 50% 50%, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0) 30%, rgba(255, 255, 255, 0.18) 55%, rgba(255, 255, 255, 0) 78%, rgba(255, 255, 255, 0.12))",
		"radial-gradient(closest-side at 28% 20%, rgba(255, 255, 255, 0.35), rgba(255, 255, 255, 0.12) 55%, transparent 70%), radial-gradient(closest-side at 78% 70%, rgba(255, 255, 255, 0.2), transparent 60%), radial-gradient(closest-side at 52% 58%, rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0.06) 60%, transparent 78%), conic-gradient(from 180deg at 50% 50%, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0) 30%, rgba(255, 255, 255, 0.12) 55%, rgba(255, 255, 255, 0) 78%, rgba(255, 255, 255, 0.08))",
	);
	const glassPanelInnerShadow = useColorModeValue(
		"inset 0 0 0 1px rgba(255, 255, 255, 0.28), inset 0 -14px 28px rgba(255, 255, 255, 0.14), inset 0 12px 28px rgba(0, 0, 0, 0.06)",
		"inset 0 0 0 1px rgba(255, 255, 255, 0.1), inset 0 -14px 28px rgba(255, 255, 255, 0.07), inset 0 12px 28px rgba(0, 0, 0, 0.28)",
	);
	const activePillBg = useColorModeValue(
		"rgba(0, 0, 0, 0.14)",
		"rgba(255, 255, 255, 0.12)",
	);
	const activePillShadow = useColorModeValue(
		"0 6px 18px rgba(0, 0, 0, 0.16)",
		"0 6px 18px rgba(0, 0, 0, 0.16)",
	);

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

	useEffect(() => {
		if (!isMobile) return;
		const ua = window.navigator.userAgent || "";
		const isIOS = /iphone|ipad|ipod/i.test(ua);
		const isStandalone =
			"standalone" in window.navigator
				? Boolean(window.navigator.standalone)
				: window.matchMedia("(display-mode: standalone)").matches;
		const hasShown = localStorage.getItem("ios-pwa-tip-shown") === "1";
		if (isIOS && !isStandalone && !hasShown) {
			setShowIosPrompt(true);
			localStorage.setItem("ios-pwa-tip-shown", "1");
		}
	}, [isMobile]);

	useEffect(() => {
		const node = contentRef.current;
		if (!node || !isMobile) return;
		let startX = 0;
		let startY = 0;
		let tracking = false;
		const edgeSize = 24;
		const minSwipe = 60;

		const isFormField = (target: EventTarget | null) => {
			if (!(target instanceof HTMLElement)) return false;
			const tag = target.tagName.toLowerCase();
			return (
				tag === "input" ||
				tag === "textarea" ||
				tag === "select" ||
				target.isContentEditable
			);
		};

		const handleTouchStart = (event: TouchEvent) => {
			if (!isMobile || sidebarDrawer.isOpen) return;
			if (event.touches.length !== 1) return;
			if (isFormField(event.target)) return;
			const touch = event.touches[0];
			startX = touch.clientX;
			startY = touch.clientY;
			const isEdgeStart = isRTL
				? window.innerWidth - startX <= edgeSize
				: startX <= edgeSize;
			tracking = isEdgeStart;
		};

		const handleTouchMove = (event: TouchEvent) => {
			if (!tracking) return;
			const touch = event.touches[0];
			const dx = touch.clientX - startX;
			const dy = touch.clientY - startY;
			if (Math.abs(dy) > 20 && Math.abs(dy) > Math.abs(dx)) {
				tracking = false;
				return;
			}
			const shouldOpen = isRTL ? dx < -minSwipe : dx > minSwipe;
			if (shouldOpen) {
				tracking = false;
				sidebarDrawer.onOpen();
			}
		};

		const handleTouchEnd = () => {
			tracking = false;
		};

		node.addEventListener("touchstart", handleTouchStart, { passive: true });
		node.addEventListener("touchmove", handleTouchMove, { passive: true });
		node.addEventListener("touchend", handleTouchEnd);
		node.addEventListener("touchcancel", handleTouchEnd);
		return () => {
			node.removeEventListener("touchstart", handleTouchStart);
			node.removeEventListener("touchmove", handleTouchMove);
			node.removeEventListener("touchend", handleTouchEnd);
			node.removeEventListener("touchcancel", handleTouchEnd);
		};
	}, [isMobile, isRTL, sidebarDrawer]);

	const bottomNavItems = useMemo(() => {
		const items = [
			{ key: "dashboard", label: t("nav.dashboard", "Dashboard"), to: "/" },
			{ key: "users", label: t("nav.users", "Users"), to: "/users" },
		];
		const canSeeAdmins =
			userData.role === AdminRole.Sudo || userData.role === AdminRole.FullAccess;
		if (canSeeAdmins) {
			items.push({
				key: "admins",
				label: t("nav.admins", "Admins"),
				to: "/admins",
			});
		}
		items.push({
			key: "myaccount",
			label: t("nav.myaccount", "My account"),
			to: "/myaccount",
		});
		return items;
	}, [t, userData.role]);

	const resolveActive = (to: string) => {
		if (to === "/") return location.pathname === "/";
		return location.pathname.startsWith(to);
	};

	const activeTabKey = useMemo(() => {
		const activeItem = bottomNavItems.find((item) => resolveActive(item.to));
		return activeItem?.key ?? null;
	}, [bottomNavItems, location.pathname]);

	const updateActiveSelector = () => {
		if (!isMobile) return;
		const container = navContainerRef.current;
		if (!container || !activeTabKey) {
			setActiveSelector((prev) => ({ ...prev, visible: false }));
			return;
		}
		const target = tabContentRefs.current[activeTabKey];
		if (!target) return;
		const containerRect = container.getBoundingClientRect();
		const targetRect = target.getBoundingClientRect();
		setActiveSelector({
			x: targetRect.left - containerRect.left,
			y: targetRect.top - containerRect.top,
			width: targetRect.width,
			height: targetRect.height,
			visible: true,
		});
	};

	useLayoutEffect(() => {
		updateActiveSelector();
	}, [activeTabKey, isMobile, i18n.language]);

	useEffect(() => {
		if (!isMobile) return;
		const handleResize = () => updateActiveSelector();
		window.addEventListener("resize", handleResize);
		return () => window.removeEventListener("resize", handleResize);
	}, [isMobile, activeTabKey]);

	const clearAccountHoldTimer = () => {
		if (accountHoldTimeout.current) {
			window.clearTimeout(accountHoldTimeout.current);
			accountHoldTimeout.current = null;
		}
	};

	const handleAccountHoldStart = () => {
		if (!isMobile) return;
		clearAccountHoldTimer();
		accountHoldOpened.current = false;
		accountHoldTimeout.current = window.setTimeout(() => {
			accountHoldOpened.current = true;
			accountMenu.onOpen();
		}, 560);
	};

	const handleAccountHoldEnd = () => {
		clearAccountHoldTimer();
		accountHoldStartPoint.current = null;
	};

	const handleAccountHoldMove = (clientX: number, clientY: number) => {
		const start = accountHoldStartPoint.current;
		if (!start || accountHoldOpened.current) return;
		const dx = clientX - start.x;
		const dy = clientY - start.y;
		if (Math.hypot(dx, dy) > 12) {
			clearAccountHoldTimer();
		}
	};

	const handleAccountMenuClose = () => {
		accountHoldOpened.current = false;
		accountMenu.onClose();
	};

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
					ref={contentRef}
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
											placement={languagePlacement}
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
					<Box
						as="main"
						flex="1"
						p="6"
						pb={{ base: "28", md: "6" }}
						overflow="auto"
						minH="0"
					>
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
				{isMobile && (
					<>
						{showIosPrompt && (
							<Box
								position="fixed"
								left="0"
								right="0"
								bottom={{ base: "86px", sm: "90px" }}
								px="4"
								zIndex={2000}
							>
								<Box
									bg="whiteAlpha.800"
									_dark={{ bg: "whiteAlpha.200" }}
									backdropFilter="blur(16px)"
									borderRadius="20px"
									borderWidth="1px"
									borderColor="whiteAlpha.300"
									px="4"
									py="3"
									display="flex"
									alignItems="center"
									gap="3"
									boxShadow="lg"
								>
									<Box
										w="8"
										h="8"
										borderRadius="full"
										bg="whiteAlpha.600"
										_dark={{ bg: "whiteAlpha.300" }}
										display="flex"
										alignItems="center"
										justifyContent="center"
									>
										<ShareIcon />
									</Box>
									<Box flex="1">
										<Text fontWeight="semibold" fontSize="sm">
											{t("pwa.ios.title", "Add to Home Screen")}
										</Text>
										<Text fontSize="xs" color="gray.600" _dark={{ color: "gray.300" }}>
											{t(
												"pwa.ios.body",
												"Tap Share and then Add to Home Screen for a faster app-like experience.",
											)}
										</Text>
									</Box>
									<Button
										size="sm"
										variant="ghost"
										onClick={() => {
											setShowIosPrompt(false);
											localStorage.setItem("ios-pwa-tip-shown", "1");
										}}
									>
										{t("pwa.ios.dismiss", "Got it")}
									</Button>
								</Box>
							</Box>
						)}
						<Box
							position="fixed"
							left="0"
							right="0"
							bottom="0"
							zIndex={1500}
							px="4"
							pb="6px"
							pt="1"
						>
							<Box
								bg={glassPanelBg}
								borderColor={glassPanelBorder}
								boxShadow={glassPanelShadow}
								borderWidth="1px"
								backdropFilter="blur(20px) saturate(1.35)"
								borderRadius="26px"
								px="3"
								pt="2"
								pb="calc(env(safe-area-inset-bottom) + 6px)"
								maxW="min(520px, 100%)"
								mx="auto"
								sx={{
									WebkitBackdropFilter: "blur(20px) saturate(1.35)",
									position: "relative",
									overflow: "hidden",
									"@supports not ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px)))": {
										backgroundColor: glassPanelFallbackBg,
									},
									"&::before": {
										content: '""',
										position: "absolute",
										inset: "-40%",
										background: glassPanelRefraction,
										filter: "blur(0.2px) contrast(1.15) saturate(1.1)",
										mixBlendMode: "screen",
										opacity: 0.7,
										pointerEvents: "none",
									},
									"&::after": {
										content: '""',
										position: "absolute",
										inset: "0",
										borderRadius: "inherit",
										boxShadow: glassPanelInnerShadow,
										pointerEvents: "none",
									},
								}}
							>
								<HStack
									justify="space-between"
									position="relative"
									align="center"
									ref={navContainerRef}
								>
									<Box
										position="absolute"
										top="0"
										left="0"
										width={`${activeSelector.width}px`}
										height={`${activeSelector.height}px`}
										transform={`translate3d(${activeSelector.x}px, ${activeSelector.y}px, 0)`}
										transition="transform 220ms cubic-bezier(0.2, 0.9, 0.2, 1), width 220ms, height 220ms, opacity 160ms"
										opacity={activeSelector.visible ? 1 : 0}
										borderRadius="22px"
										bg={activePillBg}
										boxShadow={activePillShadow}
										filter="blur(0.15px)"
										zIndex={0}
										pointerEvents="none"
									/>
									{bottomNavItems.map((item) => {
										const isActive = resolveActive(item.to);
										const icon =
											item.key === "dashboard" ? (
												<HomeIcon />
											) : item.key === "users" ? (
												<UsersIcon />
											) : item.key === "admins" ? (
												<AdminsIcon />
											) : (
												<UserIcon />
											);
										const iconStack = (
											<Box position="relative" w="full" display="flex" justifyContent="center">
												<Box
													position="relative"
													display="inline-flex"
													flexDirection="column"
													alignItems="center"
													justifyContent="center"
													px="3"
													py="1.5"
													ref={(node) => {
														tabContentRefs.current[item.key] = node;
													}}
												>
													<VStack spacing={1} align="center" position="relative" zIndex={1}>
														<Box
															position="relative"
															w="8"
															h="8"
															display="grid"
															placeItems="center"
														>
															<Box position="relative" zIndex={1}>
																{icon}
															</Box>
														</Box>
														<Text
															fontSize="9px"
															lineHeight="1"
															fontWeight="medium"
															textAlign="center"
															noOfLines={1}
															maxW="64px"
														>
															{item.label}
														</Text>
													</VStack>
												</Box>
											</Box>
										);

										if (item.key === "myaccount") {
											return (
													<Popover
														key={item.key}
														isOpen={accountMenu.isOpen}
														onClose={handleAccountMenuClose}
														placement="top"
														gutter={12}
														closeOnBlur
													>
														<PopoverTrigger>
															<Button
																variant="ghost"
																size="sm"
																onClick={() => {
																	if (accountHoldOpened.current) return;
																	handleAccountMenuClose();
																	navigate(item.to);
																}}
																onPointerDown={(event) => {
																	if (event.pointerType === "mouse") return;
																	accountHoldStartPoint.current = {
																		x: event.clientX,
																		y: event.clientY,
																	};
																	handleAccountHoldStart();
																}}
																onPointerMove={(event) => {
																	if (event.pointerType === "mouse") return;
																	handleAccountHoldMove(event.clientX, event.clientY);
																}}
																onPointerUp={handleAccountHoldEnd}
																onPointerCancel={handleAccountHoldEnd}
																onPointerLeave={handleAccountHoldEnd}
																onContextMenu={(event) => {
																	if (isMobile) event.preventDefault();
																}}
																color={isActive ? "primary.500" : "gray.600"}
															_dark={{
																color: isActive ? "primary.300" : "gray.300",
															}}
															flex="1"
															minW="0"
															minH="44px"
															position="relative"
															zIndex={1}
															sx={{ touchAction: "manipulation" }}
															userSelect="none"
															_hover={{ bg: "transparent" }}
															_active={{ bg: "transparent" }}
															_focus={{ bg: "transparent" }}
															>
																{iconStack}
															</Button>
														</PopoverTrigger>
														<PopoverContent
														w="180px"
															borderRadius="18px"
															bg={glassPanelBg}
															borderColor={glassPanelBorder}
															borderWidth="1px"
															boxShadow={glassPanelShadow}
															backdropFilter="blur(18px) saturate(1.3)"
															sx={{
																WebkitBackdropFilter: "blur(18px) saturate(1.3)",
																position: "relative",
																overflow: "hidden",
																"@supports not ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px)))": {
																	backgroundColor: glassPanelFallbackBg,
																},
																"&::before": {
																	content: '""',
																	position: "absolute",
																	inset: "-40%",
																	background: glassPanelRefraction,
																	filter: "blur(0.2px) contrast(1.15) saturate(1.1)",
																	mixBlendMode: "screen",
																	opacity: 0.7,
																	pointerEvents: "none",
																},
																"&::after": {
																	content: '""',
																position: "absolute",
																inset: "0",
																borderRadius: "inherit",
																boxShadow: glassPanelInnerShadow,
																pointerEvents: "none",
															},
														}}
													>
														<PopoverBody position="relative" zIndex={1} p="2">
															<Button
																variant="ghost"
																size="sm"
																w="full"
																justifyContent="flex-start"
																leftIcon={<LogoutIcon />}
																color="red.500"
																_hover={{ bg: menuHover }}
																_active={{ bg: menuHover }}
																_focus={{ bg: menuHover }}
																onClick={() => {
																	handleAccountMenuClose();
																	navigate("/login");
																}}
															>
																{t("header.logout", "Log out")}
															</Button>
														</PopoverBody>
													</PopoverContent>
												</Popover>
											);
										}

										return (
											<Button
												key={item.key}
												variant="ghost"
												size="sm"
												onClick={() => navigate(item.to)}
												color={isActive ? "primary.500" : "gray.600"}
											_dark={{ color: isActive ? "primary.300" : "gray.300" }}
											flex="1"
											minW="0"
											minH="44px"
											position="relative"
											zIndex={1}
											userSelect="none"
											_hover={{ bg: "transparent" }}
											_active={{ bg: "transparent" }}
											_focus={{ bg: "transparent" }}
											>
												{iconStack}
											</Button>
										);
									})}
								</HStack>
							</Box>
						</Box>
					</>
				)}
			</Flex>
		</>
	);
}
