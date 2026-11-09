import {
	Box,
	Button,
	chakra,
	Drawer,
	DrawerBody,
	DrawerContent,
	Flex,
	HStack,
	IconButton,
	Menu,
	MenuButton,
	MenuItem,
	MenuList,
	type PlacementWithLogical,
	Popover,
	PopoverBody,
	PopoverContent,
	PopoverTrigger,
	Portal,
	SimpleGrid,
	Text,
	useBreakpointValue,
	useColorModeValue,
	useDisclosure,
	VStack,
} from "@chakra-ui/react";
import {
	ArrowLeftOnRectangleIcon,
	ArrowsRightLeftIcon,
	ArrowUpOnSquareIcon,
	BellIcon,
	BoltIcon,
	BookOpenIcon,
	BriefcaseIcon,
	ChartBarIcon,
	CheckIcon,
	ChevronDownIcon,
	CircleStackIcon,
	ClockIcon,
	CodeBracketSquareIcon,
	Cog6ToothIcon,
	Cog8ToothIcon,
	CommandLineIcon,
	DocumentDuplicateIcon,
	DocumentTextIcon,
	EyeIcon,
	ExclamationTriangleIcon,
	HomeIcon as HeroHomeIcon,
	LanguageIcon,
	LinkIcon,
	ServerStackIcon,
	Squares2X2Icon,
	UserCircleIcon,
	UserGroupIcon,
	WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";
import { AnimatePresence, motion } from "framer-motion";
import useGetUser from "hooks/useGetUser";
import {
	type ElementType,
	type FC,
	type MouseEvent as ReactMouseEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import ReactCountryFlag from "react-country-flag";
import { useTranslation } from "react-i18next";
import { useQuery } from "react-query";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { logout as logoutSession } from "service/auth";
import { getSponsors, type SponsorAsset } from "service/sponsors";
import { AdminRole, AdminSection, AdminSudoScope } from "types/Admin";
import { clearClientSession } from "utils/session";
import { ReactComponent as ImperialIranFlag } from "../assets/imperial-iran-flag.svg";
import { AppSidebar } from "./AppSidebar";
import { useSheetSwipeToClose } from "hooks/useSheetSwipeToClose";
import { GitHubStars } from "./GitHubStars";
import { HeaderCalendar } from "./HeaderCalendar";
import {
	NotificationMenuItem,
	NotificationProvider,
	useNotificationCenter,
} from "./NotificationBell";
import { SponsorCarousel } from "./SponsorCarousel";
import ThemeSelector from "./ThemeSelector";
import {
	Breadcrumb,
	BreadcrumbEllipsisDropdown,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "./ui/breadcrumb";

const iconProps = {
	baseStyle: {
		w: 4,
		h: 4,
	},
};

const LogoutIcon = chakra(ArrowLeftOnRectangleIcon, iconProps);
const LanguageIconStyled = chakra(LanguageIcon, iconProps);
const DocsIcon = chakra(CodeBracketSquareIcon, iconProps);
const PHPMyAdminIcon = chakra(CircleStackIcon, iconProps);
const ExternalAppsIcon = chakra(CommandLineIcon, iconProps);
const PlaceholderIcon = chakra(DocumentDuplicateIcon, iconProps);
const MasterSettingsIcon = chakra(Cog8ToothIcon, iconProps);
const XraySettingsIcon = chakra(WrenchScrewdriverIcon, iconProps);
const ServicesIcon = chakra(Squares2X2Icon, iconProps);
const HostsIcon = chakra(LinkIcon, iconProps);
const HAProxyIcon = chakra(ArrowsRightLeftIcon, iconProps);
const NodesIcon = chakra(ServerStackIcon, iconProps);
const InsightsIcon = chakra(EyeIcon, iconProps);
const SystemErrorsIcon = chakra(ExclamationTriangleIcon, iconProps);
const RecentActionsIcon = chakra(ClockIcon, iconProps);
const ShareIcon = chakra(ArrowUpOnSquareIcon, iconProps);
const TutorialIcon = chakra(BookOpenIcon, iconProps);
const UsageIcon = chakra(ChartBarIcon, iconProps);
const MyAccountIcon = chakra(UserCircleIcon, iconProps);
const AdminIcon = chakra(BriefcaseIcon, iconProps);
const BulkActionsIcon = chakra(BoltIcon, iconProps);
const UsersGroupIcon = chakra(UserGroupIcon, iconProps);
const UsersListIcon = chakra(UserGroupIcon, iconProps);
const NotificationNavIcon = chakra(BellIcon, iconProps);
const XrayLogsIcon = chakra(DocumentTextIcon, iconProps);
const ChevronDownIconStyled = chakra(ChevronDownIcon, {
	baseStyle: { w: 3.5, h: 3.5 },
});

const dockIconStyle = {
	baseStyle: {
		w: "19px",
		h: "19px",
	},
};

const DockHomeIcon = chakra(HeroHomeIcon, dockIconStyle);
const DockUsersIcon = chakra(UserGroupIcon, dockIconStyle);
const DockAdminsIcon = chakra(BriefcaseIcon, dockIconStyle);
const DockNotificationsIcon = chakra(BellIcon, dockIconStyle);
const DockMyAccountIcon = chakra(UserCircleIcon, dockIconStyle);
const DockSettingsIcon = chakra(Cog6ToothIcon, dockIconStyle);

const getDockIcon = (key: string): ElementType => {
	switch (key) {
		case "dashboard":
			return DockHomeIcon;
		case "users":
			return DockUsersIcon;
		case "admins":
			return DockAdminsIcon;
		case "notifications":
			return DockNotificationsIcon;
		case "myaccount":
			return DockMyAccountIcon;
		case "settings":
			return DockSettingsIcon;
		default:
			return DockHomeIcon;
	}
};

const AnimatedHamburger: FC<{ isOpen: boolean; isRTL: boolean }> = ({
	isOpen,
	isRTL,
}) => {
	const x1Mid = isRTL ? (isOpen ? 7 : 2) : 2;
	const x2Mid = isRTL ? 14 : isOpen ? 9 : 14;
	const x1Bot = isRTL ? (isOpen ? 4.5 : 2) : 2;
	const x2Bot = isRTL ? 14 : isOpen ? 11.5 : 14;

	return (
		<Box
			as="svg"
			width="15"
			height="15"
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.25"
			strokeLinecap="round"
			display="block"
		>
			<line x1="2" y1="3.5" x2="14" y2="3.5" />
			<motion.line
				x1={x1Mid}
				y1="8"
				x2={x2Mid}
				y2="8"
				animate={{ x1: x1Mid, x2: x2Mid }}
				transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
			/>
			<motion.line
				x1={x1Bot}
				y1="12.5"
				x2={x2Bot}
				y2="12.5"
				animate={{ x1: x1Bot, x2: x2Bot }}
				transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
			/>
		</Box>
	);
};

type SettingsMenuItem = {
	key: string;
	label: string;
	to: string;
	icon?: ElementType;
};

type BottomNavItem = {
	key: string;
	label: string;
	to?: string;
	kind?: "menu" | "link";
};

let textMeasureCanvas: HTMLCanvasElement | null = null;
const measureBreadcrumbLabel = (text: string, isPage = false): number => {
	if (!text) return 0;
	if (typeof document === "undefined") {
		return Math.ceil(text.length * (isPage ? 8.5 : 8));
	}
	if (!textMeasureCanvas) {
		textMeasureCanvas = document.createElement("canvas");
	}
	const ctx = textMeasureCanvas.getContext("2d");
	if (!ctx) {
		return Math.ceil(text.length * (isPage ? 8.5 : 8));
	}
	ctx.font = `${isPage ? "600" : "500"} 12.5px Vazirmatn, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
	return Math.ceil(ctx.measureText(text).width);
};

function AppLayoutContent() {
	const { unread } = useNotificationCenter();
	const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
	const handleSidebarExpand = useCallback(() => setSidebarCollapsed(false), []);
	const [isMobile, setIsMobile] = useState(() => {
		if (typeof window === "undefined") return false;
		return window.innerWidth < 769;
	});

	useEffect(() => {
		if (typeof window === "undefined") return;
		const mq = window.matchMedia("(max-width: 768.98px)");
		const update = () => setIsMobile(mq.matches);
		update();
		mq.addEventListener("change", update);
		return () => mq.removeEventListener("change", update);
	}, []);

	useEffect(() => {
		if (typeof document === "undefined" || !document.body) return;
		if (sidebarCollapsed && !isMobile) {
			document.body.setAttribute("data-sidebar-collapsed", "true");
		} else {
			document.body.removeAttribute("data-sidebar-collapsed");
		}
		return () => {
			document.body?.removeAttribute("data-sidebar-collapsed");
		};
	}, [sidebarCollapsed, isMobile]);

	const sidebarDrawer = useDisclosure();
	const handleDrawerClose = useCallback(
		() => sidebarDrawer.onClose(),
		[sidebarDrawer.onClose],
	);
	useSheetSwipeToClose();
	const languageMenu = useDisclosure();
	const userMenu = useDisclosure();
	const accountMenu = useDisclosure();
	const settingsMenu = useDisclosure();
	const [activeProfileSubmenu, setActiveProfileSubmenu] = useState<
		"notifications" | "language" | "theme" | "calendar" | null
	>(null);
	const [pressingProfileSubmenu, setPressingProfileSubmenu] = useState<
		"notifications" | "language" | "theme" | "calendar" | null
	>(null);
	const profileSubmenuTimerRef = useRef<number | null>(null);

	useEffect(() => {
		return () => {
			if (profileSubmenuTimerRef.current) {
				window.clearTimeout(profileSubmenuTimerRef.current);
			}
		};
	}, []);

	const toggleProfileSubmenu = useCallback(
		(target: "notifications" | "language" | "theme" | "calendar") => {
			if (profileSubmenuTimerRef.current) {
				window.clearTimeout(profileSubmenuTimerRef.current);
				profileSubmenuTimerRef.current = null;
			}

			if (activeProfileSubmenu === target) {
				languageMenu.onClose();
				setActiveProfileSubmenu(null);
				setPressingProfileSubmenu(null);
				return;
			}

			languageMenu.onClose();
			setPressingProfileSubmenu(target);
			profileSubmenuTimerRef.current = window.setTimeout(() => {
				setPressingProfileSubmenu(null);
				setActiveProfileSubmenu(target);
				if (target === "language") {
					languageMenu.onOpen();
				}
			}, 100);
		},
		[activeProfileSubmenu, languageMenu],
	);
	const { t, i18n } = useTranslation();
	const { userData, getUserIsSuccess } = useGetUser();
	const cachedRole = useMemo(() => {
		try {
			return localStorage.getItem("rb-user-role");
		} catch {
			return null;
		}
	}, []);
	const effectiveRole = getUserIsSuccess
		? userData.role
		: (cachedRole as AdminRole | null);
	const canSeeSponsors =
		effectiveRole === AdminRole.FullAccess || effectiveRole === AdminRole.Sudo;

	useEffect(() => {
		if (getUserIsSuccess && userData.role) {
			try {
				localStorage.setItem("rb-user-role", userData.role);
			} catch {}
		}
	}, [getUserIsSuccess, userData.role]);

	const sponsorsQuery = useQuery("sponsors", getSponsors, {
		staleTime: 5 * 60 * 1000,
		cacheTime: 30 * 60 * 1000,
		retry: false,
		enabled: canSeeSponsors,
		initialData: () => {
			try {
				const raw = sessionStorage.getItem("rb-sponsors-cache");
				return raw ? JSON.parse(raw) : undefined;
			} catch {
				return undefined;
			}
		},
		initialDataUpdatedAt: 0,
		onSuccess: (data) => {
			try {
				sessionStorage.setItem("rb-sponsors-cache", JSON.stringify(data));
			} catch {}
		},
	});
	const sponsorData = canSeeSponsors ? sponsorsQuery.data : undefined;
	const sponsorHeaderItems = useMemo(
		() =>
			(sponsorData?.header ?? []).slice(0, 3).map((asset: SponsorAsset) => ({
				id: asset.id,
				src: asset.image_url,
				alt: asset.alt || asset.label || "Sponsor",
				href: asset.target_url,
				label: asset.label,
				isSponsor: true,
			})),
		[sponsorData?.header],
	);
	const sponsorHeaderMobileItems = useMemo(
		() =>
			(sponsorData?.header_mobile ?? []).slice(0, 3).map((asset: SponsorAsset) => ({
				id: asset.id,
				src: asset.image_url,
				alt: asset.alt || asset.label || "Sponsor",
				href: asset.target_url,
				label: asset.label,
				isSponsor: true,
			})),
		[sponsorData?.header_mobile],
	);
	const sponsorSidebarLogoItems = useMemo(() => {
		const rawLogoList: SponsorAsset[] = [
			...(sponsorData?.sidebar_logo ?? []),
			...((sponsorData as unknown as { sidebarLogo?: SponsorAsset[] })?.sidebarLogo ?? []),
			...(sponsorData?.sidebar ?? []).filter(
				(a: SponsorAsset) => a.placement === "sidebar_logo",
			),
		];
		return rawLogoList
			.filter((a, i, arr) => arr.findIndex((x) => x.id === a.id) === i)
			.slice(0, 5);
	}, [
		sponsorData?.sidebar_logo,
		(sponsorData as unknown as { sidebarLogo?: SponsorAsset[] })?.sidebarLogo,
		sponsorData?.sidebar,
	]);
	const sponsorSidebarBanners = useMemo(
		() =>
			(sponsorData?.sidebar ?? [])
				.filter((a: SponsorAsset) => a.placement !== "sidebar_logo")
				.slice(0, 5),
		[sponsorData?.sidebar],
	);
	const mobileHeaderItems = useMemo(
		() =>
			sponsorHeaderMobileItems.length > 0
				? sponsorHeaderMobileItems
				: sponsorHeaderItems,
		[sponsorHeaderMobileItems, sponsorHeaderItems],
	);
	const navigate = useNavigate();
	const location = useLocation();
	const [activeLocationHash, setActiveLocationHash] = useState(
		() => window.location.hash,
	);
	const isRTL = i18n.dir(i18n.language) === "rtl";
	const tutorialsUrl = "/tutorials";
	const sectionAccess = userData.permissions?.sections;
	const userMenuContentRef = useRef<HTMLDivElement | null>(null);
	const contentRef = useRef<HTMLDivElement | null>(null);
	const [showIosPrompt, setShowIosPrompt] = useState(false);
	const tabContentRefs = useRef<Record<string, HTMLButtonElement | null>>({});
	const [previewTabKey, setPreviewTabKey] = useState<string | null>(null);
	const previewTabKeyRef = useRef<string | null>(null);
	const headerRef = useRef<HTMLDivElement | null>(null);
	const [calendarCompact, setCalendarCompact] = useState(false);
	const [breadcrumbMode, setBreadcrumbMode] = useState<
		"full" | "compact" | "minimal"
	>("full");
	const [bannerShrinkable, setBannerShrinkable] = useState(false);
	const [canTruncateLastCrumbState, setCanTruncateLastCrumbState] =
		useState(false);
	const [bannerDimensions, setBannerDimensions] = useState({
		natural: 220,
		half: 110,
	});
	const canTruncateLastCrumb =
		canTruncateLastCrumbState &&
		calendarCompact &&
		breadcrumbMode === "minimal" &&
		(sponsorHeaderItems.length === 0 || bannerShrinkable);
	const [mobileDockOpenGroups, setMobileDockOpenGroups] = useState<
		Record<string, boolean>
	>({
		users_hub: true,
		core_routing: false,
		system_tools: false,
		observability: false,
	});
	const dockSettingsScrollRef = useRef<HTMLDivElement | null>(null);
	const dockSettingsScrollAnimRef = useRef<number | null>(null);

	useEffect(() => {
		return () => {
			if (dockSettingsScrollAnimRef.current !== null) {
				cancelAnimationFrame(dockSettingsScrollAnimRef.current);
			}
		};
	}, []);

	useEffect(() => {
		const dir = i18n.dir(i18n.language);
		document.documentElement.dir = dir;
		document.documentElement.lang = i18n.language;
		if (document.body) {
			document.body.dir = dir;
		}
		window.dispatchEvent(new Event("resize"));
		const raf = requestAnimationFrame(() => {
			window.dispatchEvent(new Event("resize"));
		});
		return () => cancelAnimationFrame(raf);
	}, [i18n.language, i18n]);
	useEffect(() => {
		if (!isMobile) return;
		const resetScroll = () => {
			if (window.scrollY !== 0 || window.scrollX !== 0) {
				window.scrollTo(0, 0);
			}
		};
		window.addEventListener("scroll", resetScroll, { passive: true });
		resetScroll();
		return () => window.removeEventListener("scroll", resetScroll);
	}, [isMobile]);

	const languagePlacement =
		useBreakpointValue<PlacementWithLogical>({
			base: "bottom-start",
			md: isRTL ? "right-start" : "left-start",
		}) ?? (isRTL ? "right-start" : "left-start");

	const menuBg = useColorModeValue("panel.surface", "panel.surface");
	const menuBorder = useColorModeValue("panel.border", "panel.border");
	const dockBg = useColorModeValue("panel.surface", "panel.surface");
	const dockBorder = useColorModeValue("panel.border", "panel.border");
	const menuShadow = useColorModeValue(
		"0 1px 2px rgba(0, 0, 0, 0.03), inset 0 1px 0 0 rgba(255, 255, 255, 0.8)",
		"inset 0 1px 0 0 rgba(255, 255, 255, 0.08)",
	);
	const dockShadow = menuShadow;
	const dockInactiveText = useColorModeValue("gray.700", "gray.300");
	const dockInactiveIcon = useColorModeValue("gray.600", "gray.400");
	const shellBorder = useColorModeValue("panel.border", "panel.border");
	const shellHeaderBg = useColorModeValue("panel.surface", "panel.surface");
	const shellHeaderShadow = useColorModeValue(
		"0 2px 10px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0, 0, 0, 0.03)",
		"0 4px 16px rgba(0, 0, 0, 0.24), 0 1px 2px rgba(0, 0, 0, 0.12)",
	);
	const headerButtonBg = useColorModeValue("panel.elevated", "panel.elevated");
	const headerButtonHoverBg = useColorModeValue(
		"panel.borderStrong",
		"panel.borderStrong",
	);

	useEffect(() => {
		const syncHash = () => setActiveLocationHash(window.location.hash);
		setActiveLocationHash(location.hash);
		window.addEventListener("hashchange", syncHash);
		return () => window.removeEventListener("hashchange", syncHash);
	}, [location.hash]);

	const setPreviewTabKeySafe = (value: string | null) => {
		previewTabKeyRef.current = value;
		setPreviewTabKey(value);
	};

	const roleLabel = useMemo(() => {
		switch (userData.role) {
			case AdminRole.FullAccess:
				return t("admins.roles.fullAccess");
			case AdminRole.Sudo:
				return t("admins.roles.sudo");
			case AdminRole.Reseller:
				return t("admins.roles.reseller");
			default:
				return t("admins.roles.standard");
		}
	}, [t, userData.role]);

	const languageItems = [
		{ code: "en", label: "English", flag: "US" },
		{ code: "fa", label: "پارسی", flag: "IR" },
		{ code: "zh-cn", label: "中文", flag: "CN" },
		{ code: "ru", label: "Русский", flag: "RU" },
	];

	const isFullAccess = userData.role === AdminRole.FullAccess;
	const isPrivilegedAdmin = isFullAccess || userData.role === AdminRole.Sudo;

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

	const isChangingLanguageRef = useRef(false);

	const changeLanguage = async (lang: string) => {
		isChangingLanguageRef.current = true;
		setSuppressDockTransition(true);
		const nextDir = i18n.dir(lang);

		const userMenuEl = document.getElementById("rb-user-menu");
		const langMenuEl = document.querySelector(
			'[data-language-menu-list="true"]',
		) as HTMLElement | null;
		if (userMenuEl) userMenuEl.style.display = "none";
		if (langMenuEl) langMenuEl.style.display = "none";

		document.documentElement.dir = nextDir;
		document.documentElement.lang = lang;
		if (document.body) {
			document.body.dir = nextDir;
		}

		await i18n.changeLanguage(lang);

		userMenu.onOpen();
		languageMenu.onOpen();
		setActiveProfileSubmenu("language");

		requestAnimationFrame(() => {
			window.dispatchEvent(new Event("resize"));
			isChangingLanguageRef.current = false;
		});
	};

	const closeUserMenu = useCallback(() => {
		if (isChangingLanguageRef.current) return;
		if (profileSubmenuTimerRef.current) {
			window.clearTimeout(profileSubmenuTimerRef.current);
			profileSubmenuTimerRef.current = null;
		}
		userMenu.onClose();
		languageMenu.onClose();
		setActiveProfileSubmenu(null);
		setPressingProfileSubmenu(null);
	}, [userMenu.onClose, languageMenu.onClose]);

	const isAnyProfileMenuOpen =
		userMenu.isOpen ||
		languageMenu.isOpen ||
		activeProfileSubmenu !== null;

	useEffect(() => {
		if (!isAnyProfileMenuOpen) return;
		const handleDocumentPointerDown = (event: MouseEvent | TouchEvent) => {
			if (isChangingLanguageRef.current) return;
			const path =
				typeof event.composedPath === "function" ? event.composedPath() : [];
			const rawTarget = event.target as Node | null;
			const el =
				rawTarget instanceof Element
					? rawTarget
					: rawTarget?.parentElement;

			const isSubmenuNode = (node: Element) =>
				Boolean(
					node.closest?.(
						'[data-profile-submenu="true"], [data-language-menu-list="true"], [data-notification-menu-list="true"], [data-theme-menu-list="true"], [data-calendar-menu-list="true"]',
					),
				);

			const isUserMenuNode = (node: Element) =>
				Boolean(
					node.id === "rb-user-menu" ||
						node.closest?.('#rb-user-menu, [data-profile-menu="true"]'),
				);

			const isSubmenuTrigger = (node: Element) =>
				Boolean(
					node.closest?.(
						'[data-submenu-trigger="true"], [data-theme-trigger="true"], [data-calendar-trigger="true"]',
					),
				);

			const clickedInSubmenu =
				path.some((n) => n instanceof Element && isSubmenuNode(n)) ||
				Boolean(el && isSubmenuNode(el));

			const clickedInUserMenu =
				path.some((n) => n instanceof Element && isUserMenuNode(n)) ||
				Boolean(el && isUserMenuNode(el));

			const clickedInSubmenuTrigger =
				path.some((n) => n instanceof Element && isSubmenuTrigger(n)) ||
				Boolean(el && isSubmenuTrigger(el));

			if (clickedInUserMenu && !clickedInSubmenu && !clickedInSubmenuTrigger) {
				if (activeProfileSubmenu !== null) {
					if (profileSubmenuTimerRef.current) {
						window.clearTimeout(profileSubmenuTimerRef.current);
						profileSubmenuTimerRef.current = null;
					}
					languageMenu.onClose();
					setActiveProfileSubmenu(null);
					setPressingProfileSubmenu(null);
				}
				return;
			}

			const isInside = path.some((node) => {
				if (!(node instanceof Element)) return false;
				return Boolean(
					node.id === "rb-user-menu" ||
						node.closest?.(
							'#rb-user-menu, [data-profile-window="true"], [data-header-profile="true"], [data-profile-submenu="true"], [data-language-menu-list="true"], [data-notification-menu-list="true"], [data-theme-menu-list="true"], [data-calendar-menu-list="true"], [data-profile-menu="true"]',
						),
				);
			});
			const isInsideFallback = Boolean(
				el?.closest?.(
					'#rb-user-menu, [data-profile-window="true"], [data-header-profile="true"], [data-profile-submenu="true"], [data-language-menu-list="true"], [data-notification-menu-list="true"], [data-theme-menu-list="true"], [data-profile-menu="true"]',
				),
			);
			if (isInside || isInsideFallback) {
				return;
			}
			closeUserMenu();
		};
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				closeUserMenu();
			}
		};
		if (typeof window !== "undefined" && "PointerEvent" in window) {
			document.addEventListener("pointerdown", handleDocumentPointerDown, true);
		} else {
			document.addEventListener("mousedown", handleDocumentPointerDown, true);
			document.addEventListener("touchstart", handleDocumentPointerDown, {
				passive: true,
				capture: true,
			});
		}
		document.addEventListener("keydown", handleKeyDown);
		return () => {
			if (typeof window !== "undefined" && "PointerEvent" in window) {
				document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
			} else {
				document.removeEventListener("mousedown", handleDocumentPointerDown, true);
				document.removeEventListener("touchstart", handleDocumentPointerDown, true);
			}
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, [
		isAnyProfileMenuOpen,
		closeUserMenu,
		activeProfileSubmenu,
		languageMenu.onClose,
	]);

	const prevRTLRef = useRef(isRTL);
	const [suppressDockTransition, setSuppressDockTransition] = useState(false);

	if (prevRTLRef.current !== isRTL) {
		prevRTLRef.current = isRTL;
		setSuppressDockTransition(true);
	}

	useEffect(() => {
		if (suppressDockTransition) {
			const timer = setTimeout(() => {
				setSuppressDockTransition(false);
			}, 350);
			return () => clearTimeout(timer);
		}
	}, [suppressDockTransition]);

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

	const hasSettingsMenu = Boolean(
		canViewNodes ||
			canViewHosts ||
			canViewServicesSection ||
			canViewUsage ||
			isPrivilegedAdmin ||
			sectionAccess?.[AdminSection.Xray] ||
			sectionAccess?.[AdminSection.Integrations] ||
			canViewRecentActions ||
			canManagePlaceholders ||
			true,
	);

	const bottomNavItems = useMemo<BottomNavItem[]>(() => {
		const items: BottomNavItem[] = [];
		const canSeeAdmins = Boolean(sectionAccess?.[AdminSection.Admins]);
		items.push({ key: "users", label: t("users"), to: "/users" });
		if (canSeeAdmins) {
			items.push({ key: "admins", label: t("admins"), to: "/admins" });
		}
		if (items.length + 3 + (hasSettingsMenu ? 1 : 0) <= 5) {
			items.push({
				key: "notifications",
				label: t("notifications.menu"),
				to: "/notifications",
			});
		}
		items.push({ key: "myaccount", label: t("myaccount.menu"), to: "/myaccount" });
		if (hasSettingsMenu) {
			items.push({ key: "settings", label: t("header.settings"), kind: "menu" });
		}
		items.splice(Math.floor((items.length + 1) / 2), 0, {
			key: "dashboard",
			label: t("dashboard"),
			to: "/",
		});
		return items;
	}, [t, sectionAccess, hasSettingsMenu]);

	const dockRoutes = useMemo(
		() => new Set(bottomNavItems.map((item) => item.to).filter(Boolean) as string[]),
		[bottomNavItems],
	);

	const mobileDockSections = useMemo(
		() =>
			[
				{
					id: "sec_users",
					title: t("sidebar.sections.users"),
					items: [
						{
							type: "group" as const,
							id: "users_hub",
							title: t("sidebar.groups.userHub"),
							icon: UsersGroupIcon,
							subItems: [
								!dockRoutes.has("/users")
									? {
											id: "users_list",
											title: t("sidebar.usersList"),
											to: "/users",
											icon: UsersListIcon,
										}
									: null,
								!dockRoutes.has("/bulk-actions")
									? {
											id: "bulk-actions",
											title: t("bulkActions.menu"),
											to: "/bulk-actions",
											icon: BulkActionsIcon,
										}
									: null,
							].filter(Boolean) as Array<{
								id: string;
								title: string;
								to: string;
								icon: ElementType;
							}>,
						},
					].filter((item) => item.subItems.length > 0),
				},
				{
					id: "sec_infrastructure",
					title: t("sidebar.sections.infrastructure"),
					items: [
						canViewNodes && !dockRoutes.has("/node-settings")
							? {
									type: "direct" as const,
									key: "node-settings",
									label: t("header.nodeSettings"),
									to: "/node-settings",
									icon: NodesIcon,
								}
							: null,
						canViewHosts && !dockRoutes.has("/hosts")
							? {
									type: "direct" as const,
									key: "hosts",
									label: t("header.hostSettings"),
									to: "/hosts",
									icon: HostsIcon,
								}
							: null,
						canViewServicesSection && !dockRoutes.has("/services")
							? {
									type: "direct" as const,
									key: "services",
									label: t("services.title"),
									to: "/services",
									icon: ServicesIcon,
								}
							: null,
					].filter(Boolean) as Array<{
						type: "direct";
						key: string;
						label: string;
						to: string;
						icon: ElementType;
					}>,
				},
				{
					id: "sec_traffic_admins",
					title: t("sidebar.sections.trafficAndAdmins"),
					items: [
						selfAccess.self_myaccount && !dockRoutes.has("/myaccount")
							? {
									type: "direct" as const,
									key: "myaccount",
									label: t("myaccount.menu"),
									to: "/myaccount",
									icon: MyAccountIcon,
								}
							: null,
						canViewUsage && !dockRoutes.has("/usage")
							? {
									type: "direct" as const,
									key: "usage",
									label: t("usage.menu"),
									to: "/usage",
									icon: UsageIcon,
								}
							: null,
						canViewAdmins && !dockRoutes.has("/admins")
							? {
									type: "direct" as const,
									key: "admins",
									label: t("admins"),
									to: "/admins",
									icon: AdminIcon,
								}
							: null,
					].filter(Boolean) as Array<{
						type: "direct";
						key: string;
						label: string;
						to: string;
						icon: ElementType;
					}>,
				},
				{
					id: "sec_system",
					title: t("sidebar.sections.system"),
					items: [
						{
							type: "group" as const,
							id: "core_routing",
							title: t("sidebar.groups.coreRouting"),
							icon: XraySettingsIcon,
							subItems: [
								sectionAccess?.[AdminSection.Xray] &&
								!dockRoutes.has("/xray-settings")
									? {
											id: "xray-settings",
											title: t("header.xraySettings"),
											to: "/xray-settings",
											icon: XraySettingsIcon,
										}
									: null,
								isPrivilegedAdmin && !dockRoutes.has("/haproxy")
									? {
											id: "haproxy",
											title: t("haproxy.title"),
											to: "/haproxy",
											icon: HAProxyIcon,
										}
									: null,
							].filter(Boolean) as Array<{
								id: string;
								title: string;
								to: string;
								icon: ElementType;
							}>,
						},
						{
							type: "group" as const,
							id: "system_tools",
							title: t("sidebar.groups.system"),
							icon: MasterSettingsIcon,
							subItems: [
								sectionAccess?.[AdminSection.Integrations] &&
								!dockRoutes.has("/settings")
									? {
											id: "settings",
											title: t("header.integrationSettings"),
											to: "/settings",
											icon: MasterSettingsIcon,
										}
									: null,
								!dockRoutes.has("/notifications")
									? {
											id: "notifications",
											title: t("notifications.menu"),
											to: "/notifications",
											icon: NotificationNavIcon,
										}
									: null,
								canManagePlaceholders && !dockRoutes.has("/placeholders")
									? {
											id: "placeholders",
											title: isPrivilegedAdmin
												? t("placeholders.menu")
												: t("placeholders.settingsMenu"),
											to: "/placeholders",
											icon: PlaceholderIcon,
										}
									: null,
								isPrivilegedAdmin && !dockRoutes.has("/phpmyadmin")
									? {
											id: "phpmyadmin",
											title: t("phpmyadmin.menu"),
											to: "/phpmyadmin",
											icon: PHPMyAdminIcon,
										}
									: null,
								isPrivilegedAdmin && !dockRoutes.has("/external-apps")
									? {
											id: "external-apps",
											title: t("externalApps.menu"),
											to: "/external-apps",
											icon: ExternalAppsIcon,
										}
									: null,
							].filter(Boolean) as Array<{
								id: string;
								title: string;
								to: string;
								icon: ElementType;
							}>,
						},
						{
							type: "group" as const,
							id: "observability",
							title: t("sidebar.groups.observability"),
							icon: InsightsIcon,
							subItems: [
								sectionAccess?.[AdminSection.Xray] &&
								!dockRoutes.has("/xray-logs")
									? {
											id: "xray-logs",
											title: t("pages.xray.logs"),
											to: "/xray-logs",
											icon: XrayLogsIcon,
										}
									: null,
								(Boolean(sectionAccess?.[AdminSection.Xray]) ||
									isPrivilegedAdmin) &&
								!dockRoutes.has("/errors")
									? {
											id: "errors",
											title: t("errors.title", "Errors"),
											to: "/errors",
											icon: SystemErrorsIcon,
										}
									: null,
								sectionAccess?.[AdminSection.Xray] &&
								!dockRoutes.has("/access-insights")
									? {
											id: "access-insights",
											title: t("header.accessInsights"),
											to: "/access-insights",
											icon: InsightsIcon,
										}
									: null,
								canViewRecentActions && !dockRoutes.has("/recent-actions")
									? {
											id: "recent-actions",
											title: t("recentActions.title"),
											to: "/recent-actions",
											icon: RecentActionsIcon,
										}
									: null,
							].filter(Boolean) as Array<{
								id: string;
								title: string;
								to: string;
								icon: ElementType;
							}>,
						},
					].filter((item) => item.subItems.length > 0),
				},
				{
					id: "sec_docs",
					title: t("sidebar.sections.docs"),
					items: [
						!dockRoutes.has(tutorialsUrl)
							? {
									type: "direct" as const,
									key: "tutorials",
									label: t("sidebar.tutorialsAndFaq"),
									to: tutorialsUrl,
									icon: TutorialIcon,
								}
							: null,
						isPrivilegedAdmin && !dockRoutes.has("/api-docs")
							? {
									type: "direct" as const,
									key: "api-docs",
									label: t("apiDocs.menu"),
									to: "/api-docs",
									icon: DocsIcon,
								}
							: null,
					].filter(Boolean) as Array<{
						type: "direct";
						key: string;
						label: string;
						to: string;
						icon: ElementType;
					}>,
				},
			].filter((sec) => sec.items.length > 0),
		[
			t,
			dockRoutes,
			canViewNodes,
			canViewHosts,
			canViewServicesSection,
			canViewUsage,
			canViewAdmins,
			canViewRecentActions,
			canManagePlaceholders,
			isPrivilegedAdmin,
			sectionAccess,
			selfAccess.self_myaccount,
		],
	);

	const settingsMenuItems = useMemo<SettingsMenuItem[]>(() => {
		const items: SettingsMenuItem[] = [];
		for (const sec of mobileDockSections) {
			for (const entry of sec.items) {
				if (entry.type === "direct") {
					items.push({
						key: entry.key,
						label: entry.label,
						to: entry.to,
						icon: entry.icon,
					});
				} else if (entry.type === "group") {
					for (const sub of entry.subItems) {
						items.push({
							key: sub.id,
							label: sub.title,
							to: sub.to,
							icon: sub.icon,
						});
					}
				}
			}
		}
		return items;
	}, [mobileDockSections]);

	const activeSettingsItem = useMemo(
		() =>
			settingsMenuItems.find((item) => {
				if (item.to === "/") return location.pathname === "/";
				return location.pathname.startsWith(item.to);
			}),
		[settingsMenuItems, location.pathname],
	);
	const isSettingsRoute = Boolean(activeSettingsItem);
	const popoverModifiers = useMemo(
		() => [
			{
				name: "preventOverflow",
				options: {
					boundary: "viewport",
					padding: 12,
				},
			},
			{
				name: "flip",
				options: {
					boundary: "viewport",
					padding: 12,
				},
			},
		],
		[],
	);

	const resolveActive = useCallback(
		(item: BottomNavItem) => {
			if (item.key === "settings") return isSettingsRoute;
			if (!item.to) return false;
			if (item.to === "/") return location.pathname === "/";
			return location.pathname.startsWith(item.to);
		},
		[isSettingsRoute, location.pathname],
	);

	const activeTabKey = useMemo(() => {
		const activeItem = bottomNavItems.find((item) => resolveActive(item));
		return activeItem?.key ?? null;
	}, [bottomNavItems, resolveActive]);
	const selectedTabKey = previewTabKey ?? activeTabKey;

	const handleNavClick = (to?: string) => {
		if (!to) {
			return;
		}
		handleSettingsMenuClose();
		handleAccountMenuClose();
		if (to !== location.pathname) navigate(to);
	};

	const handleAccountMenuClose = () => {
		accountMenu.onClose();
	};

	const handleSettingsMenuClose = () => {
		settingsMenu.onClose();
		if (previewTabKeyRef.current === "settings") {
			setPreviewTabKeySafe(null);
		}
	};

	const openSettingsMenu = () => {
		accountMenu.onClose();
		settingsMenu.onOpen();
		setPreviewTabKeySafe("settings");
	};

	const handleSettingsMenuToggle = () => {
		if (settingsMenu.isOpen) {
			handleSettingsMenuClose();
			return;
		}
		openSettingsMenu();
	};

	const settingsDefaultTabByPath: Record<string, string> = {
		"/settings": "panel",
		"/hosts": "inbounds",
		"/usage": "services",
		"/xray-settings": "basic",
	};
	const breadcrumbItems = useMemo(() => {
		const path = location.pathname;
		const hashKey = (activeLocationHash || "")
			.replace(/^#/, "")
			.split("?")[0]
			.toLowerCase();

		let items: { label: string; path?: string }[] = [];

		if (path === "/") {
			items = [{ label: t("dashboard"), path: "/" }];
		} else if (path === "/users") {
			items = [
				{ label: t("dashboard"), path: "/" },
				{ label: t("sidebar.groups.userHub") },
				{ label: t("sidebar.usersList"), path: "/users" },
			];
		} else if (path === "/bulk-actions") {
			const bulkActionsTabs: Record<string, string> = {
				edit: t("bulkActions.tabs.edit"),
				delete: t("bulkActions.tabs.delete"),
				permissions: t("bulkActions.tabs.permissions"),
			};
			const activeBulkTab = bulkActionsTabs[hashKey];
			if (activeBulkTab) {
				items = [
					{ label: t("dashboard"), path: "/" },
					{ label: t("sidebar.groups.userHub") },
					{ label: t("bulkActions.menu"), path: "/bulk-actions" },
					{ label: activeBulkTab },
				];
			} else {
				items = [
					{ label: t("dashboard"), path: "/" },
					{ label: t("sidebar.groups.userHub") },
					{ label: t("bulkActions.menu"), path: "/bulk-actions" },
				];
			}
		} else if (path === "/admins") {
			items = [
				{ label: t("dashboard"), path: "/" },
				{ label: t("admins"), path: "/admins" },
			];
		} else if (path === "/myaccount") {
			items = [
				{ label: t("dashboard"), path: "/" },
				{ label: t("myaccount.menu"), path: "/myaccount" },
			];
		} else if (path === "/usage") {
			const usageTabs: Record<string, string> = {
				services: t("usage.tabs.services"),
				admins: t("usage.tabs.admins"),
				nodes: t("usage.tabs.nodes"),
			};
			const activeUsageTab = usageTabs[hashKey] || usageTabs.services;
			items = [
				{ label: t("dashboard"), path: "/" },
				{ label: t("usage.menu"), path: "/usage#services" },
				{ label: activeUsageTab },
			];
		} else if (path === "/hosts") {
			const hostsTabs: Record<string, string> = {
				inbounds: t("hostsPage.tabInbounds"),
				hosts: t("hostsPage.tabHosts"),
			};
			const activeHostsTab = hostsTabs[hashKey] || hostsTabs.inbounds;
			items = [
				{ label: t("dashboard"), path: "/" },
				{ label: t("header.hostSettings"), path: "/hosts#inbounds" },
				{ label: activeHostsTab },
			];
		} else if (path === "/services") {
			items = [
				{ label: t("dashboard"), path: "/" },
				{ label: t("services.title"), path: "/services" },
			];
		} else if (path === "/node-settings") {
			items = [
				{ label: t("dashboard"), path: "/" },
				{ label: t("header.nodeSettings"), path: "/node-settings" },
			];
		} else if (path === "/xray-logs") {
			items = [
				{ label: t("dashboard"), path: "/" },
				{ label: t("sidebar.groups.observability") },
				{ label: t("pages.xray.logs"), path: "/xray-logs" },
			];
		} else if (path === "/access-insights") {
			items = [
				{ label: t("dashboard"), path: "/" },
				{ label: t("sidebar.groups.observability") },
				{ label: t("header.accessInsights"), path: "/access-insights" },
			];
		} else if (path === "/recent-actions") {
			items = [
				{ label: t("dashboard"), path: "/" },
				{ label: t("sidebar.groups.observability") },
				{ label: t("recentActions.title"), path: "/recent-actions" },
			];
		} else if (path === "/xray-settings") {
			const xrayTabs: Record<string, string> = {
				basic: t("pages.xray.basicTemplate"),
				routing: t("pages.xray.Routings"),
				outbounds: t("pages.xray.Outbounds"),
				reverse: t("pages.xray.reverse.title"),
				balancers: t("pages.xray.Balancers"),
				dns: t("DNS"),
				advanced: t("pages.xray.advancedTemplate"),
			};
			const activeXrayTab = xrayTabs[hashKey] || xrayTabs.basic;
			items = [
				{ label: t("dashboard"), path: "/" },
				{ label: t("sidebar.groups.coreRouting") },
				{ label: t("header.xraySettings"), path: "/xray-settings#basic" },
				{ label: activeXrayTab },
			];
		} else if (path === "/haproxy") {
			items = [
				{ label: t("dashboard"), path: "/" },
				{ label: t("sidebar.groups.coreRouting") },
				{ label: t("haproxy.title"), path: "/haproxy" },
			];
		} else if (path === "/notifications") {
			items = [
				{ label: t("dashboard"), path: "/" },
				{ label: t("sidebar.groups.system") },
				{ label: t("notifications.menu"), path: "/notifications" },
			];
		} else if (path === "/settings") {
			const settingsTabs: Record<string, string> = {
				panel: t("settings.panel.tabTitle"),
				telegram: t("settings.telegram"),
				subscriptions: t("settings.subscriptions.tabTitle"),
				ssl: t("settings.ssl.tabTitle"),
			};
			const activeSettingsTab = settingsTabs[hashKey] || settingsTabs.panel;
			items = [
				{ label: t("dashboard"), path: "/" },
				{ label: t("sidebar.groups.system") },
				{ label: t("header.integrationSettings"), path: "/settings#panel" },
				{ label: activeSettingsTab },
			];
		} else if (path === "/placeholders") {
			items = [
				{ label: t("dashboard"), path: "/" },
				{ label: t("sidebar.groups.system") },
				{ label: t("placeholders.menu"), path: "/placeholders" },
			];
		} else if (path === "/phpmyadmin") {
			items = [
				{ label: t("dashboard"), path: "/" },
				{ label: t("sidebar.groups.system") },
				{ label: t("phpmyadmin.menu"), path: "/phpmyadmin" },
			];
		} else if (path === "/external-apps") {
			items = [
				{ label: t("dashboard"), path: "/" },
				{ label: t("sidebar.groups.system") },
				{ label: t("externalApps.menu"), path: "/external-apps" },
			];
		} else if (path === "/api-docs") {
			items = [
				{ label: t("dashboard"), path: "/" },
				{ label: t("apiDocs.menu"), path: "/api-docs" },
			];
		} else if (path === "/tutorials") {
			items = [
				{ label: t("dashboard"), path: "/" },
				{ label: t("sidebar.tutorialsAndFaq"), path: "/tutorials" },
			];
		} else {
			items = [
				{ label: t("dashboard"), path: "/" },
				...path
					.split("/")
					.filter(Boolean)
					.map((part) => ({
						label: part.replace(/[-_]+/g, " "),
					})),
			];
		}

		return items;
	}, [location.pathname, activeLocationHash, t]);

	const navigateToSettingsItem = (target: string) => {
		settingsMenu.onClose();
		setPreviewTabKeySafe("settings");
		const defaultTab = settingsDefaultTabByPath[target];
		if (defaultTab) {
			navigate(`${target}#${defaultTab}`);
			return;
		}
		navigate(target);
	};

	useEffect(() => {
		if (previewTabKeyRef.current && activeTabKey === previewTabKeyRef.current) {
			previewTabKeyRef.current = null;
			setPreviewTabKey(null);
		}
	}, [activeTabKey]);

	useEffect(() => {
		const firstBannerSrc = sponsorHeaderItems[0]?.src;
		if (!firstBannerSrc) return;
		const probe = new Image();
		const update = () => {
			if (probe.naturalWidth && probe.naturalHeight) {
				const natural = Math.round(
					(probe.naturalWidth / probe.naturalHeight) * 40,
				);
				const half = Math.max(90, Math.round(natural / 2));
				setBannerDimensions((prev) => {
					if (prev.natural === natural && prev.half === half) return prev;
					return { natural, half };
				});
			}
		};
		probe.onload = update;
		probe.src = firstBannerSrc;
		if (probe.complete) update();
	}, [sponsorHeaderItems[0]?.src]);

	useEffect(() => {
		const headerEl = headerRef.current;
		if (!headerEl) return;
		const _pathKey = location.pathname + location.hash;
		void _pathKey;
		const checkFit = () => {
			if (!headerRef.current) return;
			const totalWidth = headerRef.current.clientWidth;
			const hasBanner = sponsorHeaderItems.length > 0;
			const bannerImg = headerRef.current.querySelector<HTMLImageElement>(
				"[data-header-banner] img",
			);
			let naturalBannerWidth = 0;
			if (hasBanner) {
				if (bannerImg?.naturalWidth && bannerImg.naturalHeight) {
					naturalBannerWidth = Math.round(
						(bannerImg.naturalWidth / bannerImg.naturalHeight) * 40,
					);
				} else {
					naturalBannerWidth = bannerDimensions.natural;
				}
			}
			const bannerWidth = hasBanner ? naturalBannerWidth + 2 : 0;
			const minBannerWidth = hasBanner
				? Math.max(Math.round(naturalBannerWidth * 0.5), 60)
				: 0;

			const profileEl = headerRef.current.querySelector<HTMLElement>(
				"[data-header-profile]",
			);
			const starsEl = headerRef.current.querySelector<HTMLElement>(
				"[data-github-stars]",
			);
			const profileWidth = profileEl ? profileEl.offsetWidth : 80;
			const starsWidth = starsEl ? starsEl.offsetWidth : 80;
			const isFa = i18n.language?.startsWith("fa");
			const fullCalendarWidth = isFa ? 180 : 196;
			const compactCalendarWidth = 36;
			const compactControlsWidth =
				compactCalendarWidth + 8 + starsWidth + 8 + profileWidth;
			const fullControlsWidth =
				fullCalendarWidth + 8 + starsWidth + 8 + profileWidth;

			const navButtonEl = headerRef.current.querySelector<HTMLElement>(
				"[aria-label='Toggle Sidebar']",
			);
			const navButtonWidth = navButtonEl ? navButtonEl.offsetWidth : 34;
			const isDesktop = window.innerWidth >= 768;
			const headerPadding = isDesktop ? 40 : 24;
			const hstackGap = 12;
			const navDividerGaps = 25;
			const bannerGap = hasBanner ? 10 : 0;

			const fixedOverheadFull =
				headerPadding +
				hstackGap +
				navButtonWidth +
				navDividerGaps +
				bannerGap +
				fullControlsWidth;
			const fixedOverheadCompact =
				headerPadding +
				hstackGap +
				navButtonWidth +
				navDividerGaps +
				bannerGap +
				compactControlsWidth;

			const spaceFullCalendar = totalWidth - fixedOverheadFull;
			const spaceCompactCalendar = totalWidth - fixedOverheadCompact;

			const crumbCount = breadcrumbItems.length;
			const fullBreadcrumbWidth =
				crumbCount === 0
					? 0
					: crumbCount === 1
						? measureBreadcrumbLabel(breadcrumbItems[0]?.label || "", true)
						: breadcrumbItems.reduce((acc, item, idx) => {
								const isLast = idx === crumbCount - 1;
								return (
									acc +
									measureBreadcrumbLabel(item.label || "", isLast) +
									(idx > 0 ? 26 : 0)
								);
							}, 0);

			const compactBreadcrumbWidth =
				crumbCount <= 2
					? fullBreadcrumbWidth
					: measureBreadcrumbLabel(breadcrumbItems[0]?.label || "", false) +
						26 +
						22 +
						26 +
						measureBreadcrumbLabel(
							breadcrumbItems[crumbCount - 1]?.label || "",
							true,
						);

			const minimalBreadcrumbWidth =
				crumbCount <= 1
					? measureBreadcrumbLabel(breadcrumbItems[0]?.label || "", true)
					: 22 +
						26 +
						measureBreadcrumbLabel(
							breadcrumbItems[crumbCount - 1]?.label || "",
							true,
						);

			const buffer = 18;
			const stage1Needed = fullBreadcrumbWidth + bannerWidth + buffer;
			const stage2Needed = fullBreadcrumbWidth + bannerWidth + buffer;
			const stage3Needed = compactBreadcrumbWidth + bannerWidth + buffer;
			const stage4Needed = minimalBreadcrumbWidth + bannerWidth + buffer;
			const stage5Needed = minimalBreadcrumbWidth + minBannerWidth + buffer;

			let nextCalendarCompact = true;
			let nextBreadcrumbMode: "full" | "compact" | "minimal" = "minimal";
			let nextBannerShrinkable = false;
			let nextTruncate = true;

			if (spaceFullCalendar >= stage1Needed) {
				nextCalendarCompact = false;
				nextBreadcrumbMode = "full";
				nextBannerShrinkable = false;
				nextTruncate = false;
			} else if (spaceCompactCalendar >= stage2Needed) {
				nextCalendarCompact = true;
				nextBreadcrumbMode = "full";
				nextBannerShrinkable = false;
				nextTruncate = false;
			} else if (spaceCompactCalendar >= stage3Needed) {
				nextCalendarCompact = true;
				nextBreadcrumbMode = "compact";
				nextBannerShrinkable = false;
				nextTruncate = false;
			} else if (spaceCompactCalendar >= stage4Needed) {
				nextCalendarCompact = true;
				nextBreadcrumbMode = "minimal";
				nextBannerShrinkable = false;
				nextTruncate = false;
			} else if (hasBanner && spaceCompactCalendar >= stage5Needed) {
				nextCalendarCompact = true;
				nextBreadcrumbMode = "minimal";
				nextBannerShrinkable = true;
				nextTruncate = false;
			} else {
				nextCalendarCompact = true;
				nextBreadcrumbMode = "minimal";
				nextBannerShrinkable = hasBanner;
				nextTruncate = true;
			}

			setCalendarCompact((prev) =>
				prev !== nextCalendarCompact ? nextCalendarCompact : prev,
			);
			setBreadcrumbMode((prev) =>
				prev !== nextBreadcrumbMode ? nextBreadcrumbMode : prev,
			);
			setBannerShrinkable((prev) =>
				prev !== nextBannerShrinkable ? nextBannerShrinkable : prev,
			);
			setCanTruncateLastCrumbState((prev) =>
				prev !== nextTruncate ? nextTruncate : prev,
			);
		};
		const timer = setTimeout(checkFit, 20);
		const ro = new ResizeObserver(checkFit);
		ro.observe(headerEl);
		return () => {
			clearTimeout(timer);
			ro.disconnect();
		};
	}, [
		location.pathname,
		location.hash,
		sponsorHeaderItems.length,
		breadcrumbItems,
		i18n.language,
		bannerDimensions.natural,
	]);

	return (
		<>
			<Box display="none" aria-hidden="true">
				<ThemeSelector minimal trigger="icon" />
			</Box>
			<Flex
				minH={{ base: "100dvh", md: "100vh" }}
				maxH={{ base: "100dvh", md: "100vh" }}
				h={{ base: "100dvh", md: "100vh" }}
				overflow="hidden"
				direction={isRTL ? "row-reverse" : "row"}
				dir={isRTL ? "rtl" : "ltr"}
				bg="panel.app"
				sx={{
					"--rb-sidebar-offset": isMobile
						? "0px"
						: sidebarCollapsed
							? "88px"
							: "calc(var(--rb-sidebar-width, 240px) + 20px)",
				}}
			>
				{!isMobile ? (
					<Box
						className="rb-desktop-sidebar"
						display={{ base: "none", md: "block" }}
						data-sidebar-collapsed={sidebarCollapsed ? "true" : undefined}
					>
						<AppSidebar
							collapsed={sidebarCollapsed}
							sponsors={sponsorSidebarLogoItems}
							sidebarBanners={sponsorSidebarBanners}
							onRequestExpand={handleSidebarExpand}
						/>
					</Box>
				) : null}

				<Flex
					ref={contentRef}
					flex="1"
					direction="column"
					minW="0"
					h="full"
					overflow="hidden"
					ml={{
						base: "0",
						md: isRTL
							? "0"
							: sidebarCollapsed
								? "88px"
								: "calc(var(--rb-sidebar-width, 240px) + 20px)",
					}}
					mr={{
						base: "0",
						md: !isRTL
							? "0"
							: sidebarCollapsed
								? "88px"
								: "calc(var(--rb-sidebar-width, 240px) + 20px)",
					}}
					transition={
						suppressDockTransition
							? "none"
							: "margin 0.22s cubic-bezier(0.16, 1, 0.3, 1)"
					}
					bg="panel.main"
					position="relative"
					sx={{
						willChange: isMobile ? undefined : "margin",
					}}
				>
					<Box position="relative" zIndex={100} flexShrink={0}>
						<Box
							ref={headerRef}
							as="header"
							h="52px"
							minH="52px"
							borderWidth="1px"
							borderColor={shellBorder}
							borderRadius="18px"
							bg={shellHeaderBg}
							boxShadow={shellHeaderShadow}
							overflow="hidden"
							mt="3"
							mx={{ base: "3", md: "4" }}
							display="flex"
							alignItems="center"
							px={{ base: 3, md: 5 }}
							justifyContent="space-between"
							userSelect="none"
							gap={3}
							dir={isRTL ? "rtl" : "ltr"}
							sx={{
								transform: "translateZ(0)",
							}}
						>
						<HStack
							spacing={2.5}
							alignItems="center"
							flex="1"
							minW="0"
							h="full"
							overflow="hidden"
						>
							<IconButton
								size="sm"
								w="34px"
								h="34px"
								minW="34px"
								variant="ghost"
								borderRadius={{ base: "full", md: "12px" }}
								borderWidth="1px"
								borderColor={shellBorder}
								aria-label={t("a11y.toggleSidebar")}
								onClick={() => {
									if (isMobile) sidebarDrawer.onOpen();
									else setSidebarCollapsed(!sidebarCollapsed);
								}}
								icon={
									<AnimatedHamburger
										isOpen={isMobile ? sidebarDrawer.isOpen : !sidebarCollapsed}
										isRTL={isRTL}
									/>
								}
								flexShrink={0}
								bg={headerButtonBg}
								color="panel.textSecondary"
								_hover={{
									md: {
										bg: headerButtonHoverBg,
										borderColor: "panel.borderStrong",
										color: "panel.text",
									},
								}}
								_active={{ transform: "scale(0.95)" }}
								transition="all 0.16s cubic-bezier(0.2, 0, 0, 1)"
							/>
							<Box
								w="1px"
								h="16px"
								bg="panel.border"
								mx={0.5}
								flexShrink={0}
								display={{ base: "none", md: "block" }}
							/>
							<Breadcrumb
								data-header-breadcrumb
								display={{ base: "none", md: "flex" }}
								minW={canTruncateLastCrumb ? "0" : "fit-content"}
								overflow={canTruncateLastCrumb ? "hidden" : "visible"}
								dir={isRTL ? "rtl" : "ltr"}
								flexShrink={canTruncateLastCrumb ? 1 : 0}
							>
								<BreadcrumbList
									minW={canTruncateLastCrumb ? "0" : "fit-content"}
								>
									{breadcrumbItems.length === 1 && (
										<BreadcrumbItem
											minW={canTruncateLastCrumb ? "0" : "fit-content"}
											flexShrink={canTruncateLastCrumb ? 1 : 0}
										>
											<BreadcrumbPage isTruncated={canTruncateLastCrumb}>
												{breadcrumbItems[0].label}
											</BreadcrumbPage>
										</BreadcrumbItem>
									)}
									{breadcrumbItems.length === 2 && (
										<>
											{breadcrumbMode === "minimal" ? (
												<>
													<BreadcrumbItem flexShrink={0}>
														<BreadcrumbEllipsisDropdown
															items={[breadcrumbItems[0]]}
															onNavigate={(path) => navigate(path)}
														/>
													</BreadcrumbItem>
													<BreadcrumbSeparator flexShrink={0} />
													<BreadcrumbItem
														minW={canTruncateLastCrumb ? "0" : "fit-content"}
														flexShrink={canTruncateLastCrumb ? 1 : 0}
													>
														<BreadcrumbPage isTruncated={canTruncateLastCrumb}>
															{breadcrumbItems[1].label}
														</BreadcrumbPage>
													</BreadcrumbItem>
												</>
											) : (
												<>
													<BreadcrumbItem flexShrink={0}>
														<BreadcrumbLink
															isClickable={Boolean(breadcrumbItems[0].path)}
															onClick={() => {
																if (breadcrumbItems[0].path) {
																	navigate(breadcrumbItems[0].path);
																}
															}}
														>
															{breadcrumbItems[0].label}
														</BreadcrumbLink>
													</BreadcrumbItem>
													<BreadcrumbSeparator flexShrink={0} />
													<BreadcrumbItem
														minW={canTruncateLastCrumb ? "0" : "fit-content"}
														flexShrink={canTruncateLastCrumb ? 1 : 0}
													>
														<BreadcrumbPage isTruncated={canTruncateLastCrumb}>
															{breadcrumbItems[1].label}
														</BreadcrumbPage>
													</BreadcrumbItem>
												</>
											)}
										</>
									)}
									{breadcrumbItems.length === 3 && (
										<>
											{breadcrumbMode === "full" && (
												<>
													<BreadcrumbItem flexShrink={0}>
														<BreadcrumbLink
															isClickable={Boolean(breadcrumbItems[0].path)}
															onClick={() => {
																if (breadcrumbItems[0].path) {
																	navigate(breadcrumbItems[0].path);
																}
															}}
														>
															{breadcrumbItems[0].label}
														</BreadcrumbLink>
													</BreadcrumbItem>
													<BreadcrumbSeparator flexShrink={0} />
													<BreadcrumbItem flexShrink={0}>
														<BreadcrumbLink
															isClickable={Boolean(breadcrumbItems[1].path)}
															onClick={() => {
																if (breadcrumbItems[1].path) {
																	navigate(breadcrumbItems[1].path);
																}
															}}
														>
															{breadcrumbItems[1].label}
														</BreadcrumbLink>
													</BreadcrumbItem>
													<BreadcrumbSeparator flexShrink={0} />
													<BreadcrumbItem
														minW={canTruncateLastCrumb ? "0" : "fit-content"}
														flexShrink={canTruncateLastCrumb ? 1 : 0}
													>
														<BreadcrumbPage isTruncated={canTruncateLastCrumb}>
															{breadcrumbItems[2].label}
														</BreadcrumbPage>
													</BreadcrumbItem>
												</>
											)}
											{breadcrumbMode === "compact" && (
												<>
													<BreadcrumbItem flexShrink={0}>
														<BreadcrumbLink
															isClickable={Boolean(breadcrumbItems[0].path)}
															onClick={() => {
																if (breadcrumbItems[0].path) {
																	navigate(breadcrumbItems[0].path);
																}
															}}
														>
															{breadcrumbItems[0].label}
														</BreadcrumbLink>
													</BreadcrumbItem>
													<BreadcrumbSeparator flexShrink={0} />
													<BreadcrumbItem flexShrink={0}>
														<BreadcrumbEllipsisDropdown
															items={[breadcrumbItems[1]]}
															onNavigate={(path) => navigate(path)}
														/>
													</BreadcrumbItem>
													<BreadcrumbSeparator flexShrink={0} />
													<BreadcrumbItem
														minW={canTruncateLastCrumb ? "0" : "fit-content"}
														flexShrink={canTruncateLastCrumb ? 1 : 0}
													>
														<BreadcrumbPage isTruncated={canTruncateLastCrumb}>
															{breadcrumbItems[2].label}
														</BreadcrumbPage>
													</BreadcrumbItem>
												</>
											)}
											{breadcrumbMode === "minimal" && (
												<>
													<BreadcrumbItem flexShrink={0}>
														<BreadcrumbEllipsisDropdown
															items={[breadcrumbItems[0], breadcrumbItems[1]]}
															onNavigate={(path) => navigate(path)}
														/>
													</BreadcrumbItem>
													<BreadcrumbSeparator flexShrink={0} />
													<BreadcrumbItem
														minW={canTruncateLastCrumb ? "0" : "fit-content"}
														flexShrink={canTruncateLastCrumb ? 1 : 0}
													>
														<BreadcrumbPage isTruncated={canTruncateLastCrumb}>
															{breadcrumbItems[2].label}
														</BreadcrumbPage>
													</BreadcrumbItem>
												</>
											)}
										</>
									)}
									{breadcrumbItems.length === 4 && (
										<>
											{breadcrumbMode === "full" && (
												<>
													<BreadcrumbItem flexShrink={0}>
														<BreadcrumbLink
															isClickable={Boolean(breadcrumbItems[0].path)}
															onClick={() => {
																if (breadcrumbItems[0].path) {
																	navigate(breadcrumbItems[0].path);
																}
															}}
														>
															{breadcrumbItems[0].label}
														</BreadcrumbLink>
													</BreadcrumbItem>
													<BreadcrumbSeparator flexShrink={0} />
													<BreadcrumbItem flexShrink={0}>
														<BreadcrumbLink
															isClickable={Boolean(breadcrumbItems[1].path)}
															onClick={() => {
																if (breadcrumbItems[1].path) {
																	navigate(breadcrumbItems[1].path);
																}
															}}
														>
															{breadcrumbItems[1].label}
														</BreadcrumbLink>
													</BreadcrumbItem>
													<BreadcrumbSeparator flexShrink={0} />
													<BreadcrumbItem flexShrink={0}>
														<BreadcrumbLink
															isClickable={Boolean(breadcrumbItems[2].path)}
															onClick={() => {
																if (breadcrumbItems[2].path) {
																	navigate(breadcrumbItems[2].path);
																}
															}}
														>
															{breadcrumbItems[2].label}
														</BreadcrumbLink>
													</BreadcrumbItem>
													<BreadcrumbSeparator flexShrink={0} />
													<BreadcrumbItem
														minW={canTruncateLastCrumb ? "0" : "fit-content"}
														flexShrink={canTruncateLastCrumb ? 1 : 0}
													>
														<BreadcrumbPage isTruncated={canTruncateLastCrumb}>
															{breadcrumbItems[3].label}
														</BreadcrumbPage>
													</BreadcrumbItem>
												</>
											)}
											{breadcrumbMode === "compact" && (
												<>
													<BreadcrumbItem flexShrink={0}>
														<BreadcrumbLink
															isClickable={Boolean(breadcrumbItems[0].path)}
															onClick={() => {
																if (breadcrumbItems[0].path) {
																	navigate(breadcrumbItems[0].path);
																}
															}}
														>
															{breadcrumbItems[0].label}
														</BreadcrumbLink>
													</BreadcrumbItem>
													<BreadcrumbSeparator flexShrink={0} />
													<BreadcrumbItem flexShrink={0}>
														<BreadcrumbEllipsisDropdown
															items={[breadcrumbItems[1], breadcrumbItems[2]]}
															onNavigate={(path) => navigate(path)}
														/>
													</BreadcrumbItem>
													<BreadcrumbSeparator flexShrink={0} />
													<BreadcrumbItem
														minW={canTruncateLastCrumb ? "0" : "fit-content"}
														flexShrink={canTruncateLastCrumb ? 1 : 0}
													>
														<BreadcrumbPage isTruncated={canTruncateLastCrumb}>
															{breadcrumbItems[3].label}
														</BreadcrumbPage>
													</BreadcrumbItem>
												</>
											)}
											{breadcrumbMode === "minimal" && (
												<>
													<BreadcrumbItem flexShrink={0}>
														<BreadcrumbEllipsisDropdown
															items={[
																breadcrumbItems[0],
																breadcrumbItems[1],
																breadcrumbItems[2],
															]}
															onNavigate={(path) => navigate(path)}
														/>
													</BreadcrumbItem>
													<BreadcrumbSeparator flexShrink={0} />
													<BreadcrumbItem
														minW={canTruncateLastCrumb ? "0" : "fit-content"}
														flexShrink={canTruncateLastCrumb ? 1 : 0}
													>
														<BreadcrumbPage isTruncated={canTruncateLastCrumb}>
															{breadcrumbItems[3].label}
														</BreadcrumbPage>
													</BreadcrumbItem>
												</>
											)}
										</>
									)}
									{breadcrumbItems.length > 4 && (
										<>
											{breadcrumbMode === "minimal" ? (
												<>
													<BreadcrumbItem flexShrink={0}>
														<BreadcrumbEllipsisDropdown
															items={breadcrumbItems.slice(0, -1)}
															onNavigate={(path) => navigate(path)}
														/>
													</BreadcrumbItem>
													<BreadcrumbSeparator flexShrink={0} />
													<BreadcrumbItem
														minW={canTruncateLastCrumb ? "0" : "fit-content"}
														flexShrink={canTruncateLastCrumb ? 1 : 0}
													>
														<BreadcrumbPage isTruncated={canTruncateLastCrumb}>
															{
																breadcrumbItems[breadcrumbItems.length - 1]
																	.label
															}
														</BreadcrumbPage>
													</BreadcrumbItem>
												</>
											) : (
												<>
													<BreadcrumbItem flexShrink={0}>
														<BreadcrumbLink
															isClickable={Boolean(breadcrumbItems[0].path)}
															onClick={() => {
																if (breadcrumbItems[0].path) {
																	navigate(breadcrumbItems[0].path);
																}
															}}
														>
															{breadcrumbItems[0].label}
														</BreadcrumbLink>
													</BreadcrumbItem>
													<BreadcrumbSeparator flexShrink={0} />
													<BreadcrumbItem flexShrink={0}>
														<BreadcrumbEllipsisDropdown
															items={breadcrumbItems.slice(1, -1)}
															onNavigate={(path) => navigate(path)}
														/>
													</BreadcrumbItem>
													<BreadcrumbSeparator flexShrink={0} />
													<BreadcrumbItem
														minW={canTruncateLastCrumb ? "0" : "fit-content"}
														flexShrink={canTruncateLastCrumb ? 1 : 0}
													>
														<BreadcrumbPage isTruncated={canTruncateLastCrumb}>
															{
																breadcrumbItems[breadcrumbItems.length - 1]
																	.label
															}
														</BreadcrumbPage>
													</BreadcrumbItem>
												</>
											)}
										</>
									)}
								</BreadcrumbList>
							</Breadcrumb>

							<AnimatePresence mode="wait">
								{mobileHeaderItems.length > 0 && (
									<motion.div
										key={mobileHeaderItems[0]?.id || "mobile-banner"}
										initial={{ opacity: 0, y: -80 }}
										animate={{ opacity: 1, y: 0 }}
										exit={{ opacity: 0, y: -80 }}
										transition={{
											duration: 0.5,
											delay: 0.7,
											ease: [0.16, 1, 0.3, 1],
										}}
										style={{
											minWidth: 40,
											maxWidth: "100%",
											display: isMobile ? "flex" : "none",
											alignItems: "center",
											justifyContent: "flex-start",
											flexShrink: 1,
										}}
									>
										<Box
											data-header-mobile-banner="true"
											maxW="100%"
											minW="40px"
											maxH="40px"
											display="flex"
											alignItems="center"
											justifyContent="flex-start"
											flexShrink={1}
											overflow="hidden"
										>
											<SponsorCarousel
												items={mobileHeaderItems}
												variant="banner"
												animateIn={false}
											/>
										</Box>
									</motion.div>
								)}
							</AnimatePresence>
							<AnimatePresence mode="wait">
								{sponsorHeaderItems.length > 0 && (
									<motion.div
										key={sponsorHeaderItems[0]?.id || "desktop-banner"}
										initial={{ opacity: 0, y: -80 }}
										animate={{ opacity: 1, y: 0 }}
										exit={{ opacity: 0, y: -80 }}
										transition={{
											duration: 0.5,
											delay: 0.7,
											ease: [0.16, 1, 0.3, 1],
										}}
										style={{
											minWidth: bannerShrinkable
												? Math.max(
														Math.round(bannerDimensions.natural * 0.5),
														60,
													)
												: bannerDimensions.natural,
											maxWidth: bannerDimensions.natural,
											width: bannerShrinkable ? "100%" : bannerDimensions.natural,
											flexShrink: bannerShrinkable ? 1 : 0,
											display: isMobile ? "none" : "flex",
											alignItems: "center",
										}}
									>
										<Box
											data-header-banner="true"
											w={
												bannerShrinkable
													? "100%"
													: `${bannerDimensions.natural}px`
											}
											maxW={`${bannerDimensions.natural}px`}
											minW={
												bannerShrinkable
													? `${Math.max(
															Math.round(bannerDimensions.natural * 0.5),
															60,
														)}px`
													: `${bannerDimensions.natural}px`
											}
											maxH="40px"
											display={{ base: "none", md: "flex" }}
											alignItems="center"
											justifyContent="center"
											flexShrink={bannerShrinkable ? 1 : 0}
											overflow="hidden"
										>
											<SponsorCarousel
												items={sponsorHeaderItems}
												variant="banner"
												animateIn={false}
											/>
										</Box>
									</motion.div>
								)}
							</AnimatePresence>
						</HStack>

						<HStack
							data-header-controls="true"
							spacing={{ base: 1.5, sm: 2 }}
							alignItems="center"
							flexShrink={0}
							h="full"
						>
							<Box display={{ base: "none", md: "inline-flex" }}>
								<HeaderCalendar isCompact={calendarCompact} />
							</Box>
							<GitHubStars />

							{getUserIsSuccess && userData.username && (
								<Menu
									key={`user-menu-${isRTL ? "rtl" : "ltr"}`}
									placement={isRTL ? "bottom-start" : "bottom-end"}
									strategy="fixed"
									gutter={8}
									computePositionOnMount
									isLazy={false}
									autoSelect={false}
									closeOnSelect={false}
									closeOnBlur={false}
									isOpen={userMenu.isOpen}
									onOpen={userMenu.onOpen}
									onClose={() => {}}
								>
									<MenuButton
										as={Button}
										data-header-profile="true"
										size="sm"
										variant="outline"
										h="34px"
										w={{ base: "34px", md: "auto" }}
										minW={{ base: "34px", md: "auto" }}
										p={{ base: 0, md: "6px 12px" }}
										borderRadius={{ base: "full", md: "12px" }}
										borderColor={shellBorder}
										bg="panel.surface"
										color="panel.text"
										boxShadow="0 1px 3px rgba(0, 0, 0, 0.04)"
										_hover={{
											md: {
												bg: "panel.elevated",
												borderColor: "panel.borderStrong",
												boxShadow: "0 4px 14px rgba(0, 0, 0, 0.08)",
											},
										}}
										_active={{ bg: "panel.elevated", transform: "scale(0.98)" }}
										aria-label={t("a11y.userMenu")}
										display="inline-flex"
										alignItems="center"
										justifyContent="center"
										transition="all 0.16s cubic-bezier(0.2, 0, 0, 1)"
										onClick={() => {
											if (userMenu.isOpen) {
												if (activeProfileSubmenu !== null) {
													if (profileSubmenuTimerRef.current) {
														window.clearTimeout(profileSubmenuTimerRef.current);
														profileSubmenuTimerRef.current = null;
													}
													languageMenu.onClose();
													setActiveProfileSubmenu(null);
													setPressingProfileSubmenu(null);
													return;
												}
												closeUserMenu();
											} else {
												userMenu.onOpen();
											}
										}}
									>
										<HStack
											spacing={2}
											align="center"
											justify="center"
											dir={isRTL ? "rtl" : "ltr"}
										>
											<Box position="relative" display="inline-flex">
												<Flex
													w="18px"
													h="18px"
													align="center"
													justify="center"
													color="panel.text"
													flexShrink={0}
												>
													<UserCircleIcon style={{ width: "18px", height: "18px" }} />
												</Flex>
												{unread > 0 && (
													<Box
														position="absolute"
														top="-1px"
														insetInlineEnd="-1px"
														w="7px"
														h="7px"
														borderRadius="full"
														bg="var(--chakra-colors-accent)"
														border="1.5px solid var(--chakra-colors-panel-surface)"
													/>
												)}
											</Box>
											<Text
												display={{ base: "none", md: "inline" }}
												maxW={{ base: "100px", md: "140px" }}
												fontSize="12px"
												fontWeight="600"
												lineHeight="normal"
												color="panel.text"
												isTruncated
												dir="ltr"
												sx={{ unicodeBidi: "isolate" }}
											>
												{userData.username}
											</Text>
										</HStack>
									</MenuButton>
									<Portal>
										<MenuList
											dir={isRTL ? "rtl" : "ltr"}
											ref={userMenuContentRef}
											id="rb-user-menu"
											data-profile-window="true"
											data-profile-menu="true"
											w="240px"
											minW="240px"
											maxW="240px"
											p={2}
											borderRadius="20px"
											borderWidth="1px"
											borderColor="panel.border"
											bg="panel.surface"
											boxShadow={menuShadow}
											zIndex={9999}
											userSelect="none"
											sx={{
												".chakra-menu__menuitem:not(.rb-logout-menu-item)": {
													bg: "transparent !important",
													borderRadius: "10px",
													h: "38px",
													px: "12px",
													my: "2px",
													fontSize: "13px",
													fontWeight: "500",
													transition: "all 0.18s cubic-bezier(0.16, 1, 0.3, 1)",
													"@media (min-width: 769px)": {
														"&:hover": {
															bg: "var(--rb-panel-elevated) !important",
														},
													},
													"&:active, &:focus-visible": {
														bg: "var(--rb-panel-elevated) !important",
													},
													"&:focus:not(:focus-visible)": {
														bg: "transparent !important",
													},
												},
												".rb-logout-menu-item, .chakra-menu__menuitem.rb-logout-menu-item": {
													color: "red.400 !important",
													fontWeight: "600 !important",
													bg: "transparent !important",
													borderRadius: "10px !important",
													h: "38px !important",
													px: "12px !important",
													my: "2px !important",
													fontSize: "13px !important",
													"--menu-bg": "transparent !important",
													transition:
														"all 0.16s cubic-bezier(0.16, 1, 0.3, 1) !important",
													"@media (min-width: 769px)": {
														"&:hover, &[data-hover]": {
															color: "red.400 !important",
															bg: "rgba(239, 68, 68, 0.14) !important",
															"--menu-bg": "rgba(239, 68, 68, 0.14) !important",
														},
													},
													"&:active, &[data-active]": {
														color: "red.400 !important",
														bg: "rgba(239, 68, 68, 0.22) !important",
														"--menu-bg": "rgba(239, 68, 68, 0.22) !important",
														transform: "scale(0.98) !important",
													},
													"&:focus-visible, &[data-focus]": {
														bg: "rgba(239, 68, 68, 0.14) !important",
														"--menu-bg": "rgba(239, 68, 68, 0.14) !important",
													},
													"&:focus:not(:focus-visible):not(:hover):not(:active):not([data-hover]):not([data-focus])":
														{
															bg: "transparent !important",
															"--menu-bg": "transparent !important",
														},
												},
											}}
										>
											<Flex
												align="center"
												gap={3}
												p={2.5}
												mb={1.5}
												borderRadius="14px"
												bg="panel.elevated"
												borderWidth="1px"
												borderColor="panel.border"
											>
												<Flex
													w="32px"
													h="32px"
													borderRadius="10px"
													align="center"
													justify="center"
													bg="panel.surface"
													borderWidth="1px"
													borderColor="panel.border"
													color="panel.text"
													flexShrink={0}
												>
													<UserCircleIcon style={{ width: "18px", height: "18px" }} />
												</Flex>
												<VStack align="flex-start" spacing={0} minW={0}>
													<Text
														fontWeight="700"
														fontSize="13px"
														color="panel.text"
														isTruncated
													>
														{userData.username}
													</Text>
													<Text
														fontSize="11px"
														fontWeight="500"
														color="panel.textMuted"
														isTruncated
													>
														{roleLabel}
													</Text>
												</VStack>
											</Flex>

											{isMobile && (
												<Box display={{ base: "block", md: "none" }} w="full">
													<HeaderCalendar
														key={`cal-menu-${isRTL ? "rtl" : "ltr"}`}
														inMenu={true}
														placement={languagePlacement}
														isOpen={activeProfileSubmenu === "calendar"}
														isPressing={pressingProfileSubmenu === "calendar"}
														onToggle={() => toggleProfileSubmenu("calendar")}
														onClose={() => {
															if (activeProfileSubmenu === "calendar") {
																setActiveProfileSubmenu(null);
															}
														}}
													/>
												</Box>
											)}

											<NotificationMenuItem
												key={`notif-menu-${isRTL ? "rtl" : "ltr"}`}
												placement={languagePlacement}
												onNavigate={closeUserMenu}
												isOpen={activeProfileSubmenu === "notifications"}
												isPressing={pressingProfileSubmenu === "notifications"}
												onToggle={() => toggleProfileSubmenu("notifications")}
												onClose={() => {}}
											/>

											<Menu
												key={`lang-menu-${isRTL ? "rtl" : "ltr"}`}
												placement={languagePlacement}
												strategy="fixed"
												isOpen={
													activeProfileSubmenu === "language" ||
													languageMenu.isOpen
												}
												onOpen={() => {
													languageMenu.onOpen();
													setActiveProfileSubmenu("language");
												}}
												onClose={() => {}}
												closeOnSelect={false}
												closeOnBlur={false}
												isLazy={false}
												autoSelect={false}
											>
												<MenuButton
													as={Button}
													leftIcon={<LanguageIconStyled />}
													variant="ghost"
													data-submenu-trigger="true"
													w="full"
													h="38px"
													justifyContent="flex-start"
													fontWeight="500"
													fontSize="13px"
													borderRadius="12px"
													px={3}
													bg={
														pressingProfileSubmenu === "language" ||
														activeProfileSubmenu === "language" ||
														languageMenu.isOpen
															? "panel.elevated"
															: "transparent"
													}
													color="panel.text"
													transform={
														pressingProfileSubmenu === "language"
															? "scale(0.96)"
															: undefined
													}
													transition="all 0.12s cubic-bezier(0.2, 0, 0, 1)"
													_hover={{ md: { bg: "panel.elevated" } }}
													_active={{
														bg: "panel.elevated",
														transform: "scale(0.96)",
													}}
													_focusVisible={{ bg: "panel.elevated" }}
													onClick={(e: ReactMouseEvent) => {
														e.stopPropagation();
														toggleProfileSubmenu("language");
													}}
												>
													<HStack justify="space-between" w="full" minW={0}>
														<Text color="panel.text">
															{t("header.language")}
														</Text>
														<Text
															fontSize="11px"
															fontWeight="600"
															color="panel.textMuted"
														>
															{languageItems.find(
																(item) => item.code === i18n.language,
															)?.label || "English"}
														</Text>
													</HStack>
												</MenuButton>
												<Portal>
													<MenuList
														dir={isRTL ? "rtl" : "ltr"}
														data-profile-window="true"
														data-profile-submenu="true"
														data-language-menu-list="true"
														minW="170px"
														p={1.5}
														borderRadius="20px"
														borderWidth="1px"
														borderColor="panel.border"
														bg="panel.surface"
														boxShadow="0 20px 48px rgba(0, 0, 0, 0.35)"
														zIndex={10005}
														userSelect="none"
														sx={{
															".chakra-menu__menuitem": {
																bg: "transparent !important",
																borderRadius: "8px",
																h: "36px",
																px: "10px",
																my: "1px",
																fontSize: "12px",
																fontWeight: "500",
																"@media (min-width: 769px)": {
																	"&:hover": {
																		bg: "panel.elevated !important",
																	},
																},
																"&:active, &:focus-visible": {
																	bg: "panel.elevated !important",
																},
																"&:focus:not(:focus-visible)": {
																	bg: "transparent !important",
																},
															},
														}}
													>
														{languageItems.map(({ code, label, flag }) => {
															const isActiveLang = i18n.language === code;
															return (
																<MenuItem
																	key={code}
																	onClick={(e: ReactMouseEvent) => {
																		e.preventDefault();
																		e.stopPropagation();
																		changeLanguage(code);
																	}}
																>
																	<HStack justify="space-between" w="full">
																		<HStack spacing={2.5}>
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
																			<Text
																				fontWeight={
																					isActiveLang ? "700" : "500"
																				}
																			>
																				{label}
																			</Text>
																		</HStack>
																		{isActiveLang && (
																			<CheckIcon
																				width={15}
																				color="panel.text"
																			/>
																		)}
																	</HStack>
																</MenuItem>
															);
														})}
													</MenuList>
												</Portal>
											</Menu>

											<ThemeSelector
												key={`theme-menu-${isRTL ? "rtl" : "ltr"}`}
												trigger="menuItem"
												triggerLabel={t("header.theme")}
												isOpen={activeProfileSubmenu === "theme"}
												isPressing={pressingProfileSubmenu === "theme"}
												onToggle={() => toggleProfileSubmenu("theme")}
												onClose={() => {}}
											/>

											<MenuItem
												className="rb-logout-menu-item"
												icon={<LogoutIcon />}
												color="red.400"
												transition="all 0.16s cubic-bezier(0.16, 1, 0.3, 1)"
												_hover={{
													md: {
														bg: "rgba(239, 68, 68, 0.14) !important",
														color: "red.400 !important",
													},
												}}
												_focus={{
													bg: "rgba(239, 68, 68, 0.14) !important",
													color: "red.400 !important",
												}}
												_active={{
													bg: "rgba(239, 68, 68, 0.22) !important",
													color: "red.400 !important",
													transform: "scale(0.98)",
												}}
												onClick={async () => {
													try {
														await logoutSession();
													} finally {
														clearClientSession();
														navigate("/login");
													}
												}}
											>
												{t("header.logout")}
											</MenuItem>
										</MenuList>
									</Portal>
								</Menu>
							)}
						</HStack>
					</Box>
					<Box
						position="absolute"
						left="0"
						right="0"
						bottom="-16px"
						h="16px"
						pointerEvents="none"
						bg="linear-gradient(180deg, var(--rb-panel-main) 0%, transparent 100%)"
						zIndex={99}
					/>
				</Box>
				<Box
					as="main"
					flex="1"
					p={{ base: 3, md: 4 }}
					pt={{ base: 2.5, md: 3 }}
					pb={{ base: "40", md: "4" }}
					overflow="auto"
					minH="0"
					bg="transparent"
					sx={{
						transform: "translateZ(0)",
						overscrollBehavior: "contain",
					}}
				>
					<Outlet />
				</Box>
			</Flex>

				{isMobile && (
					<Drawer
						isOpen={sidebarDrawer.isOpen}
						placement={isRTL ? "right" : "left"}
						onClose={sidebarDrawer.onClose}
						size="full"
						autoFocus={false}
						returnFocusOnClose={false}
						trapFocus={false}
						blockScrollOnMount={false}
						preserveScrollBarGap={false}
					>
						<DrawerContent
							maxW="100vw"
							w="100vw"
							h="100dvh"
							maxH="100dvh"
							bg="panel.surface"
							boxShadow="none"
							borderRadius="0"
							zIndex={17000}
						>
							<DrawerBody p={0} overflow="hidden" bg="panel.surface">
								<AppSidebar
									collapsed={false}
									sponsors={sponsorSidebarLogoItems}
									sidebarBanners={sponsorSidebarBanners}
									inDrawer
									onRequestExpand={handleDrawerClose}
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
									bg={menuBg}
									borderRadius="20px"
									borderWidth="1px"
									borderColor={menuBorder}
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
											{t("pwa.ios.title")}
										</Text>
										<Text
											fontSize="xs"
											color="gray.600"
											_dark={{ color: "gray.300" }}
										>
											{t("pwa.ios.body")}
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
										{t("pwa.ios.dismiss")}
									</Button>
								</Box>
							</Box>
						)}
						<Box
							className="rb-mobile-dock"
							display={{
								base: sidebarDrawer.isOpen ? "none" : "block",
								md: "none",
							}}
							position="fixed"
							left="0"
							right="0"
							bottom="calc(env(safe-area-inset-bottom, 0px) + 12px)"
							zIndex={1500}
							px="3"
							pointerEvents="none"
						>
							<Box
								pointerEvents="auto"
								bg={dockBg}
								borderColor={dockBorder}
								boxShadow={dockShadow}
								borderWidth="1px"
								borderRadius="24px"
								px="2"
								py="1.5"
								maxW="min(440px, calc(100vw - 20px))"
								mx="auto"
							>
								<Box position="relative" w="full">
									{(() => {
										const dockItemCount = bottomNavItems.length;
										const activeDockIndex = bottomNavItems.findIndex(
											(it) => it.key === selectedTabKey,
										);
										if (activeDockIndex < 0 || dockItemCount === 0) return null;
										return (
											<Box
												position="absolute"
												top="0"
												bottom="0"
												width={`calc(100% / ${dockItemCount})`}
												left={isRTL ? undefined : "0px"}
												right={isRTL ? "0px" : undefined}
												transform={
													isRTL
														? `translateX(calc(-${activeDockIndex * 100}%))`
														: `translateX(calc(${activeDockIndex * 100}%))`
												}
												transition={
													suppressDockTransition
														? "none !important"
														: "transform 0.28s cubic-bezier(0.16, 1, 0.3, 1)"
												}
												p="2px"
												pointerEvents="none"
												zIndex={0}
												sx={{
													willChange: "transform",
												}}
											>
												<Box
													w="full"
													h="full"
													borderRadius="16px"
													bg="panel.elevated"
													borderWidth="1px"
													borderColor="panel.borderStrong"
													boxShadow="0 2px 8px rgba(0, 0, 0, 0.12)"
												/>
											</Box>
										);
									})()}

									<SimpleGrid
										columns={bottomNavItems.length}
										spacing={0}
										w="full"
										position="relative"
										alignItems="center"
										dir={isRTL ? "rtl" : "ltr"}
										zIndex={1}
									>
										{bottomNavItems.map((item) => {
											const isActive = resolveActive(item);
											const isSelected = selectedTabKey === item.key;
											const isSettings = item.key === "settings";
											const currentSettingsItem = isSettings ? activeSettingsItem : null;
											const DisplayIcon = currentSettingsItem?.icon || getDockIcon(item.key);
											const displayLabel = currentSettingsItem?.label || item.label;
											const navContent = (
												<Box
													w="full"
													display="flex"
													flexDirection="column"
													alignItems="center"
													justifyContent="center"
													minW="0"
													py="1"
													px="0.5"
													position="relative"
													zIndex={1}
													overflow="hidden"
												>
													<Box
														w="22px"
														h="22px"
														display="grid"
														placeItems="center"
														position="relative"
														color={
															isSelected
																? "var(--rb-panel-accent)"
																: dockInactiveIcon
														}
														transform={
															isSelected
																? "scale(1.05) translateY(-0.5px)"
																: "scale(1) translateY(0)"
														}
														transition="all 0.2s cubic-bezier(0.16, 1, 0.3, 1)"
													>
														<DisplayIcon />
														{item.key === "notifications" && unread > 0 && (
															<Box
																position="absolute"
																top="-1px"
																insetInlineEnd="-1px"
																w="6px"
																h="6px"
																borderRadius="full"
																bg="var(--chakra-colors-accent)"
															/>
														)}
													</Box>
													<Text
														fontSize="10px"
														lineHeight="1.2"
														fontWeight={isSelected ? "600" : "500"}
														textAlign="center"
														whiteSpace="nowrap"
														overflow="hidden"
														textOverflow="ellipsis"
														maxW="100%"
														px="1"
														mt="2px"
														title={displayLabel}
														color={isSelected ? "panel.text" : dockInactiveText}
														transition="color 0.2s ease"
													>
														{displayLabel}
													</Text>
												</Box>
											);

											if (item.key === "settings") {
												return (
													<Popover
														key={item.key}
														isOpen={settingsMenu.isOpen}
														onClose={handleSettingsMenuClose}
														placement="top"
														gutter={12}
														closeOnBlur
														modifiers={popoverModifiers}
														strategy="fixed"
													>
														<PopoverTrigger>
															<Button
																variant="ghost"
																size="sm"
																ref={(node) => {
																	tabContentRefs.current[item.key] = node;
																}}
																onClick={() => {
																	handleSettingsMenuToggle();
																}}
																color={isActive ? "primary.500" : "gray.600"}
																_dark={{
																	color: isActive ? "primary.300" : "gray.300",
																}}
																w="full"
																minW="0"
																minH="46px"
																h="auto"
																px="0"
																borderRadius="full"
																position="relative"
																overflow="hidden"
																zIndex={1}
																sx={{ touchAction: "manipulation" }}
																userSelect="none"
																transition="transform 0.16s cubic-bezier(0.2, 0, 0, 1)"
																_hover={{ bg: "transparent" }}
																_active={{
																	bg: "transparent",
																	transform: "scale(0.96)",
																}}
																_focus={{ bg: "transparent" }}
															>
																{navContent}
															</Button>
														</PopoverTrigger>
														<Portal>
															<PopoverContent
																ref={dockSettingsScrollRef}
																w="min(270px, calc(100vw - 24px))"
																maxW="calc(100vw - 24px)"
																maxH="calc(100vh - 130px)"
																overflowY="auto"
																borderRadius="20px"
																bg="panel.surface"
																borderColor="panel.border"
																borderWidth="1px"
																boxShadow={menuShadow}
																p={2.5}
																dir={isRTL ? "rtl" : "ltr"}
															>
																<PopoverBody p={0}>
																	<Box
																		px={2.5}
																		pt={1.5}
																		pb={1}
																		borderBottomWidth="1px"
																		borderColor="panel.border"
																		mb={2}
																	>
																		<Text
																			fontSize="11px"
																			fontWeight="700"
																			color="panel.textMuted"
																			textTransform="uppercase"
																			letterSpacing="0.06em"
																		>
																			{t("header.settings")}
																		</Text>
																	</Box>
																	<VStack align="stretch" spacing={2.5}>
																		{mobileDockSections.map((sec) => (
																			<Box key={sec.id} data-dock-section={sec.id}>
																				<Text
																					px={2}
																					py={0.5}
																					fontSize="10.5px"
																					fontWeight="600"
																					color="panel.textMuted"
																					textTransform="uppercase"
																					letterSpacing="0.06em"
																				>
																					{sec.title}
																				</Text>
																				<VStack
																					align="stretch"
																					spacing={1}
																					mt={0.5}
																				>
																					{sec.items.map((entry) => {
																						if (entry.type === "direct") {
																							const ItemIcon = entry.icon;
																							const isSelected =
																								location.pathname ===
																									entry.to ||
																								(entry.to !== "/" &&
																									location.pathname.startsWith(
																										entry.to,
																									));
																							return (
																								<Button
																									key={entry.key}
																									variant="ghost"
																									size="sm"
																									w="full"
																									h="36px"
																									borderRadius="10px"
																									px={2.5}
																									justifyContent="flex-start"
																									leftIcon={<ItemIcon />}
																									bg={
																										isSelected
																											? "panel.elevated"
																											: "transparent"
																									}
																									color={
																										isSelected
																											? "panel.text"
																											: "panel.textSecondary"
																									}
																									fontWeight={
																										isSelected ? "600" : "500"
																									}
																									fontSize="12.5px"
																									borderInlineStartWidth={
																										isSelected ? "3px" : "0px"
																									}
																									borderInlineStartColor="var(--rb-panel-accent)"
																									_hover={{
																										md: {
																											bg: "panel.elevated",
																											color: "panel.text",
																										},
																									}}
																									_active={{
																										bg: "panel.elevated",
																									}}
																									onClick={() => {
																										navigateToSettingsItem(
																											entry.to,
																										);
																									}}
																								>
																									{entry.label}
																								</Button>
																							);
																						}

																						const GroupIcon = entry.icon;
																						const isGroupOpen = Boolean(
																							mobileDockOpenGroups[entry.id],
																						);
																						const isGroupActive =
																							entry.subItems.some(
																								(s) =>
																									location.pathname === s.to ||
																									(s.to !== "/" &&
																										location.pathname.startsWith(
																											s.to,
																										)),
																							);

																						return (
																							<Box key={entry.id} data-dock-group={entry.id}>
																								<Flex
																									align="center"
																									justify="space-between"
																									w="full"
																									h="36px"
																									px={2.5}
																									borderRadius="10px"
																									bg={
																										isGroupActive &&
																										!isGroupOpen
																											? "panel.elevated"
																											: "transparent"
																									}
																									color={
																										isGroupActive
																											? "panel.text"
																											: "panel.textSecondary"
																									}
																									fontWeight={
																										isGroupActive
																											? "600"
																											: "500"
																									}
																									fontSize="12.5px"
																									cursor="pointer"
																									borderInlineStartWidth={
																										isGroupActive &&
																										!isGroupOpen
																											? "3px"
																											: "0px"
																									}
																									borderInlineStartColor="var(--rb-panel-accent)"
																									onClick={(e: ReactMouseEvent) => {
																										const willOpen =
																											!mobileDockOpenGroups[
																												entry.id
																											];
																										if (
																											willOpen &&
																											dockSettingsScrollRef.current
																										) {
																											const triggerEl =
																												e.currentTarget as HTMLElement;
																											const groupWrapper =
																												triggerEl.closest(
																													"[data-dock-group]",
																												);
																											let anchorEl: HTMLElement | null =
																												null;
																											if (groupWrapper) {
																												const nextSibling =
																													groupWrapper.nextElementSibling as HTMLElement | null;
																												if (nextSibling) {
																													anchorEl = nextSibling;
																												} else {
																													const section =
																														groupWrapper.closest(
																															"[data-dock-section]",
																														);
																													if (section) {
																														anchorEl =
																															section.nextElementSibling as HTMLElement | null;
																													}
																												}
																											}

																											if (anchorEl) {
																												if (
																													dockSettingsScrollAnimRef.current !==
																													null
																												) {
																													cancelAnimationFrame(
																														dockSettingsScrollAnimRef.current,
																													);
																													dockSettingsScrollAnimRef.current =
																														null;
																												}
																												const scrollEl = dockSettingsScrollRef.current;
																												const initialTop =
																													anchorEl.getBoundingClientRect()
																														.top;
																												const startTime =
																													performance.now();
																												setMobileDockOpenGroups(
																													(prev) => ({
																														...prev,
																														[entry.id]: true,
																													}),
																												);
																												const adjustScroll = (
																													now: number,
																												) => {
																													if (
																														!dockSettingsScrollRef.current ||
																														!anchorEl
																													)
																														return;
																													const currentTop =
																														anchorEl.getBoundingClientRect()
																															.top;
																													const delta =
																														currentTop -
																														initialTop;
																													if (
																														Math.abs(delta) >=
																														0.5
																													) {
																														scrollEl.scrollTop +=
																															delta;
																													}
																													if (
																														now - startTime <
																														300
																													) {
																														dockSettingsScrollAnimRef.current =
																															requestAnimationFrame(
																																adjustScroll,
																															);
																													} else {
																														const finalTop =
																															anchorEl.getBoundingClientRect()
																																.top;
																														const finalDelta =
																															finalTop -
																															initialTop;
																														if (
																															Math.abs(finalDelta) >=
																															0.5
																														) {
																															scrollEl.scrollTop +=
																																finalDelta;
																														}
																														dockSettingsScrollAnimRef.current =
																															null;
																													}
																												};
																												dockSettingsScrollAnimRef.current =
																													requestAnimationFrame(
																														adjustScroll,
																													);
																												return;
																											}
																										}
																										setMobileDockOpenGroups(
																											(prev) => ({
																												...prev,
																												[entry.id]: willOpen,
																											}),
																										);
																									}}
																									_hover={{
																										md: {
																											bg: "panel.elevated",
																											color: "panel.text",
																										},
																									}}
																									_active={{
																										bg: "panel.elevated",
																									}}
																								>
																									<HStack
																										spacing={2}
																										align="center"
																									>
																										<Box
																											as="span"
																											color={
																												isGroupActive
																													? "var(--rb-panel-accent)"
																													: "inherit"
																											}
																										>
																											<GroupIcon />
																										</Box>
																										<Text noOfLines={1}>
																											{entry.title}
																										</Text>
																									</HStack>
																									<ChevronDownIconStyled
																										color="panel.textMuted"
																										transform={
																											isGroupOpen
																												? "rotate(180deg)"
																												: "rotate(0deg)"
																										}
																										transition="transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)"
																									/>
																								</Flex>

																								<AnimatePresence
																									initial={false}
																								>
																									{isGroupOpen && (
																										<motion.div
																											initial={{
																												opacity: 0,
																												height: 0,
																											}}
																											animate={{
																												opacity: 1,
																												height: "auto",
																											}}
																											exit={{
																												opacity: 0,
																												height: 0,
																											}}
																											transition={{
																												duration: 0.24,
																												ease: [0.16, 1, 0.3, 1],
																											}}
																											style={{
																												overflow: "hidden",
																											}}
																										>
																											<Box
																												ms="14px"
																												ps="8px"
																												my={1}
																												borderInlineStart="1.5px solid"
																												borderColor="panel.border"
																											>
																												<VStack
																													align="stretch"
																													spacing={0.5}
																												>
																													{entry.subItems.map(
																														(sub) => {
																															const isSubActive =
																																location.pathname ===
																																	sub.to ||
																																(sub.to !==
																																	"/" &&
																																	location.pathname.startsWith(
																																		sub.to,
																																	));
																															const SubIcon =
																																sub.icon;
																															return (
																																<Button
																																	key={sub.id}
																																	variant="ghost"
																																	size="sm"
																																	w="full"
																																	h="32px"
																																	borderRadius="10px"
																																	px={2}
																																	justifyContent="flex-start"
																																	leftIcon={
																																		<SubIcon />
																																	}
																																	bg={
																																		isSubActive
																																			? "panel.elevated"
																																			: "transparent"
																																	}
																																	color={
																																		isSubActive
																																			? "panel.text"
																																			: "panel.textSecondary"
																																	}
																																	fontWeight={
																																		isSubActive
																																			? "600"
																																			: "400"
																																	}
																																	fontSize="12px"
																																	borderInlineStartWidth={
																																		isSubActive
																																			? "2.5px"
																																			: "0px"
																																	}
																																	borderInlineStartColor="var(--rb-panel-accent)"
																																	_hover={{
																																		md: {
																																			bg: "panel.elevated",
																																			color:
																																				"panel.text",
																																		},
																																	}}
																																	_active={{
																																		bg: "panel.elevated",
																																	}}
																																	onClick={() => {
																																		navigateToSettingsItem(
																																			sub.to,
																																		);
																																	}}
																																>
																																	{sub.title}
																																</Button>
																															);
																														},
																													)}
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
																		))}
																	</VStack>
																</PopoverBody>
															</PopoverContent>
														</Portal>
													</Popover>
												);
											}

											if (item.key === "myaccount") {
												return (
													<Popover
														key={item.key}
														isOpen={accountMenu.isOpen}
														onClose={handleAccountMenuClose}
														autoFocus={false}
														placement="top"
														gutter={12}
														closeOnBlur
														modifiers={popoverModifiers}
														strategy="fixed"
													>
														<PopoverTrigger>
															<Button
																variant="ghost"
																size="sm"
																ref={(node) => {
																	tabContentRefs.current[item.key] = node;
																}}
																onClick={() => {
																	handleAccountMenuClose();
																	handleNavClick(item.to);
																}}
																color={isActive ? "primary.500" : "gray.600"}
																_dark={{
																	color: isActive ? "primary.300" : "gray.300",
																}}
																w="full"
																minW="0"
																minH="46px"
																h="auto"
																px="0"
																borderRadius="full"
																position="relative"
																zIndex={1}
																sx={{ touchAction: "manipulation" }}
																userSelect="none"
																transition="transform 0.16s cubic-bezier(0.2, 0, 0, 1)"
																_hover={{ bg: "transparent" }}
																_active={{
																	bg: "transparent",
																	transform: "scale(0.96)",
																}}
																_focus={{ bg: "transparent" }}
															>
																{navContent}
															</Button>
														</PopoverTrigger>
														<Portal>
															<PopoverContent
																w="min(200px, calc(100vw - 24px))"
																maxW="calc(100vw - 24px)"
																borderRadius="20px"
																bg="panel.surface"
																borderColor="panel.border"
																borderWidth="1px"
																boxShadow={menuShadow}
																p={2}
															>
																<PopoverBody p={0}>
																	<Button
																		variant="ghost"
																		size="sm"
																		w="full"
																		h="38px"
																		borderRadius="10px"
																		justifyContent="flex-start"
																		leftIcon={<LogoutIcon />}
																		color="red.400"
																		_hover={{
																			md: {
																				bg: "rgba(239, 68, 68, 0.12)",
																				color: "red.400",
																			},
																		}}
																		_active={{ bg: "rgba(239, 68, 68, 0.18)" }}
																		_focus={{ bg: "transparent" }}
																		_focusVisible={{
																			bg: "rgba(239, 68, 68, 0.12)",
																		}}
																		onClick={async () => {
																			try {
																				await logoutSession();
																			} finally {
																				clearClientSession();
																				handleAccountMenuClose();
																				navigate("/login");
																			}
																		}}
																	>
																		{t("header.logout")}
																	</Button>
																</PopoverBody>
															</PopoverContent>
														</Portal>
													</Popover>
												);
											}

											return (
												<Button
													key={item.key}
													variant="ghost"
													size="sm"
													ref={(node) => {
														tabContentRefs.current[item.key] = node;
													}}
													onClick={() => {
														if (item.to) {
															handleNavClick(item.to);
														}
													}}
													color={isActive ? "primary.500" : "gray.600"}
													_dark={{
														color: isActive ? "primary.300" : "gray.300",
													}}
													w="full"
													minW="0"
													minH="46px"
													h="auto"
													px="0"
													borderRadius="full"
													position="relative"
													zIndex={1}
													userSelect="none"
													transition="transform 0.16s cubic-bezier(0.2, 0, 0, 1)"
													_hover={{ bg: "transparent" }}
													_active={{
														bg: "transparent",
														transform: "scale(0.96)",
													}}
													_focus={{ bg: "transparent" }}
												>
													{navContent}
												</Button>
											);
										})}
									</SimpleGrid>
								</Box>
							</Box>
						</Box>
					</>
				)}
			</Flex>
		</>
	);
}

export function AppLayout() {
	return (
		<NotificationProvider>
			<AppLayoutContent />
		</NotificationProvider>
	);
}
