import logoUrl from "assets/logo.svg";
import {
	Popover,
	PopoverAnchor,
	PopoverContent,
} from "components/ui/popover";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "components/ui/tooltip";
import { AnimatePresence, motion } from "framer-motion";
import { useMediaQuery } from "hooks/useMediaQuery";
import { cn } from "lib/cn";
import { useColorMode } from "lib/color-mode";
import { BellRing, ChevronDown, X } from "lucide-react";
import {
	type FC,
	type MouseEvent as ReactMouseEvent,
	type PointerEvent as ReactPointerEvent,
	memo,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { apiBaseURL } from "service/http";
import type { SponsorAsset } from "service/sponsors";
import {
	DEFAULT_TAB_BY_PATH,
	type GroupNavItem,
	useNavSections,
} from "./layout/navConfig";
import { SidebarSkeletonBody } from "./layout/ShellSkeletons";
import { useUnreadNotifications } from "./NotificationBell";
import { SponsorCarousel } from "./SponsorCarousel";

export interface AppSidebarProps {
	collapsed: boolean;
	loading?: boolean;
	bannerVisible?: boolean;
	sponsors?: SponsorAsset[];
	sidebarBanners?: SponsorAsset[];
	inDrawer?: boolean;
	onRequestExpand?: () => void;
}

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

const SidebarLogoCarousel: FC<SidebarLogoCarouselProps> = memo(
	function SidebarLogoCarousel({
		sponsors = [],
		collapsed,
		inDrawer,
		colorMode,
		isRTL,
		onNavigateRoot,
		onRequestExpand,
	}) {
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
				.filter((s) =>
					Boolean(
						s?.image_url || (s as unknown as { src?: string })?.src,
					),
				)
				.map((s) => {
					const rawSrc =
						s.image_url || (s as unknown as { src?: string })?.src || "";
					const href =
						s.target_url || (s as unknown as { href?: string })?.href;
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

		const logoGraphic = (
			<div className="flex size-[30px] shrink-0 items-center justify-center">
				{currentItem.isSponsor ? (
					<img
						src={currentItem.src}
						alt={currentItem.alt}
						draggable={false}
						onDragStart={(e) => e.preventDefault()}
						onContextMenu={(e) => e.preventDefault()}
						className="pointer-events-none size-[30px] rounded-[8px] object-contain select-none [-webkit-user-drag:none]"
					/>
				) : (
					<img
						src={currentItem.src}
						alt="Rebecca"
						draggable={false}
						style={{
							filter:
								colorMode === "dark"
									? "brightness(0) invert(1)"
									: "brightness(0)",
							transition: "filter 0.25s ease",
						}}
						className="pointer-events-none size-[30px] object-contain select-none [-webkit-user-drag:none]"
					/>
				)}
			</div>
		);

		const slideOffset = isRTL ? "100%" : "-100%";

		return (
			<button
				type="button"
				title={currentItem.label}
				onClick={handleClick}
				onMouseEnter={() => setIsPaused(true)}
				onMouseLeave={() => setIsPaused(false)}
				className="relative flex h-[34px] min-w-0 flex-1 cursor-pointer items-center justify-start overflow-hidden text-start transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] outline-none select-none active:scale-[0.98]"
			>
				<AnimatePresence mode="wait" initial={false}>
					<motion.div
						key={currentItem.id}
						initial={{ transform: `translate3d(${slideOffset}, 0, 0)` }}
						animate={{ transform: "translate3d(0%, 0, 0)" }}
						exit={{ transform: `translate3d(${slideOffset}, 0, 0)` }}
						transition={{ duration: 0.56, ease: [0.22, 1, 0.36, 1] }}
						className={cn(
							"flex h-[34px] w-full items-center justify-start gap-2.5 ps-[18px] transition-[padding] duration-[260ms] ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform",
							collapsed ? "pe-0" : "pe-2.5",
						)}
					>
						{collapsed ? (
							<Tooltip>
								<TooltipTrigger asChild>{logoGraphic}</TooltipTrigger>
								<TooltipContent
									side={isRTL ? "left" : "right"}
									sideOffset={10}
									className="z-[2200] rounded-[10px] border border-panel-border! bg-panel-elevated px-3 py-1.5 text-xs font-semibold text-panel-text shadow-lg"
								>
									{currentItem.label}
								</TooltipContent>
							</Tooltip>
						) : (
							logoGraphic
						)}
						<span
							aria-hidden={collapsed}
							className={cn(
								"min-w-0 flex-1 truncate pt-0.5 text-[17px] font-extrabold tracking-[-0.02em] text-panel-text transition-opacity ease-out",
								collapsed
									? "pointer-events-none opacity-0 duration-150"
									: "opacity-100 delay-[40ms] duration-200",
							)}
						>
							{currentItem.label}
						</span>
					</motion.div>
				</AnimatePresence>
			</button>
		);
	},
);

interface GroupNavRowProps {
	group: GroupNavItem;
	collapsed: boolean;
	isGroupActive: boolean;
	isOpen: boolean;
	flyoutOpen: boolean;
	isRTL: boolean;
	unreadCount: number;
	isItemActive: (url: string) => boolean;
	onToggleOpen: () => void;
	onFlyoutPointerEnter: (id: string, part: "trigger" | "content") => void;
	onFlyoutPointerLeave: (id: string, part: "trigger" | "content") => void;
	onFlyoutOpenChange: (id: string, open: boolean) => void;
	onNavigate: (url: string, event?: ReactMouseEvent) => void;
}

const GroupNavRow: FC<GroupNavRowProps> = ({
	group,
	collapsed,
	isGroupActive,
	isOpen,
	flyoutOpen,
	isRTL,
	unreadCount,
	isItemActive,
	onToggleOpen,
	onFlyoutPointerEnter,
	onFlyoutPointerLeave,
	onFlyoutOpenChange,
	onNavigate,
}) => {
	const isDesktop = useMediaQuery("(min-width: 769px)");
	const triggerRef = useRef<HTMLButtonElement | null>(null);
	const GroupIcon = group.icon;
	const visibleSubs = group.subItems.filter((sub) => sub.visible);

	const handleTriggerPointerEnter = (e: ReactPointerEvent<HTMLButtonElement>) => {
		if (!collapsed || !isDesktop || e.pointerType !== "mouse") return;
		onFlyoutPointerEnter(group.id, "trigger");
	};

	const handleTriggerPointerLeave = (e: ReactPointerEvent<HTMLButtonElement>) => {
		if (!collapsed || !isDesktop || e.pointerType !== "mouse") return;
		onFlyoutPointerLeave(group.id, "trigger");
	};

	const handleContentPointerEnter = (e: ReactPointerEvent<HTMLDivElement>) => {
		if (!collapsed || !isDesktop || e.pointerType !== "mouse") return;
		onFlyoutPointerEnter(group.id, "content");
	};

	const handleContentPointerLeave = (e: ReactPointerEvent<HTMLDivElement>) => {
		if (!collapsed || !isDesktop || e.pointerType !== "mouse") return;
		onFlyoutPointerLeave(group.id, "content");
	};

	const showAccentBar = isGroupActive && (collapsed || !isOpen);

	return (
		<div data-nav-group={group.id}>
			<Popover
				open={collapsed ? flyoutOpen : false}
				onOpenChange={(next) => {
					if (!collapsed) return;
					onFlyoutOpenChange(group.id, next);
				}}
			>
				<PopoverAnchor asChild>
					<button
						ref={triggerRef}
						type="button"
						aria-label={group.title}
						aria-expanded={collapsed ? flyoutOpen : isOpen}
						onPointerEnter={handleTriggerPointerEnter}
						onPointerLeave={handleTriggerPointerLeave}
						onClick={() => {
							if (!collapsed) {
								onToggleOpen();
							} else if (!isDesktop) {
								onFlyoutOpenChange(group.id, !flyoutOpen);
							} else if (visibleSubs[0]?.url) {
								onFlyoutOpenChange(group.id, false);
								onNavigate(visibleSubs[0].url);
							}
						}}
						className={cn(
							"relative flex h-[38px] w-full cursor-pointer items-center justify-start gap-2.5 overflow-hidden rounded-[12px] text-[13px] transition-[padding,background-color,color,transform] duration-[260ms] ease-[cubic-bezier(0.16,1,0.3,1)] outline-none select-none active:scale-[0.98] min-[769px]:hover:bg-panel-elevated",
							collapsed ? "ps-4 pe-4" : "ps-3 pe-2.5",
							showAccentBar
								? "bg-panel-elevated font-bold text-panel-accent"
								: isGroupActive
									? "bg-transparent font-bold text-panel-text"
									: "bg-transparent font-medium text-panel-text-secondary min-[769px]:hover:text-panel-text",
						)}
					>
						{showAccentBar ? (
							<span className="pointer-events-none absolute inset-s-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-panel-accent" />
						) : null}

						<span
							className={cn(
								"inline-flex size-[18px] shrink-0 items-center justify-center",
								isGroupActive && "text-panel-accent",
							)}
						>
							<GroupIcon className="size-[18px] shrink-0" />
						</span>

						<span
							aria-hidden={collapsed}
							className={cn(
								"flex min-w-0 flex-1 items-center justify-between gap-2 overflow-hidden whitespace-nowrap transition-opacity ease-out",
								collapsed
									? "pointer-events-none opacity-0 duration-150"
									: "opacity-100 delay-[40ms] duration-200",
							)}
						>
							<span className="truncate">{group.title}</span>
							<ChevronDown
								className={cn(
									"size-3.5 shrink-0 text-panel-text-muted transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
									isOpen
										? "rotate-0"
										: isRTL
											? "rotate-90"
											: "-rotate-90",
								)}
							/>
						</span>
					</button>
				</PopoverAnchor>
				<PopoverContent
					dir={isRTL ? "rtl" : "ltr"}
					side={isRTL ? "left" : "right"}
					align="start"
					sideOffset={6}
					collisionPadding={12}
					onPointerEnter={handleContentPointerEnter}
					onPointerLeave={handleContentPointerLeave}
					onPointerDownOutside={(e) => {
						if (
							triggerRef.current &&
							e.target instanceof Node &&
							triggerRef.current.contains(e.target)
						) {
							e.preventDefault();
						}
					}}
					onOpenAutoFocus={(e) => e.preventDefault()}
					className="relative z-[2200] w-auto min-w-[196px]! rounded-[16px] border border-panel-border! bg-panel-surface p-1.5 text-panel-text shadow-[0_14px_34px_rgba(0,0,0,0.28)] select-none data-[state=closed]:duration-[75ms] before:pointer-events-auto before:absolute before:inset-y-0 before:w-4 before:content-[''] data-[side=right]:before:-left-4 data-[side=left]:before:-right-4"
				>
					<div className="mb-1 border-b border-panel-border! px-2.5 pt-1 pb-1.5 text-[11px] font-bold tracking-wider uppercase text-panel-text-muted">
						{group.title}
					</div>
					<div className="flex flex-col gap-0.5">
						{visibleSubs.map((sub) => {
							const subActive = isItemActive(sub.url);
							const SubIcon = sub.icon;
							const isNotif = sub.url === "/notifications";
							return (
								<NavLink
									key={sub.id}
									to={sub.url}
									onClick={(e) => {
										onFlyoutOpenChange(group.id, false);
										onNavigate(sub.url, e);
									}}
									className={cn(
										"relative flex h-[34px] items-center gap-2.5 rounded-[10px] px-2.5 text-xs no-underline transition-[background-color,color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98] min-[769px]:hover:bg-panel-elevated",
										subActive
											? "bg-panel-elevated font-bold text-panel-accent"
											: "bg-transparent font-medium text-panel-text-secondary min-[769px]:hover:text-panel-text",
									)}
								>
									<SubIcon className="size-4 shrink-0" />
									<span className="min-w-0 flex-1 truncate">{sub.title}</span>
									{isNotif && unreadCount > 0 ? (
										<span
											dir="ltr"
											className="inline-flex h-[17px] min-w-[17px]! shrink-0 items-center justify-center rounded-full bg-panel-accent px-1 text-[10px] font-bold text-white tabular-nums [unicode-bidi:isolate]"
										>
											{unreadCount > 99 ? "99+" : unreadCount}
										</span>
									) : null}
								</NavLink>
							);
						})}
					</div>
				</PopoverContent>
			</Popover>

			{!collapsed ? (
				<div
					aria-hidden={!isOpen}
					inert={!isOpen ? true : undefined}
					className={cn(
						"grid transition-[grid-template-rows,opacity] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
						isOpen
							? "grid-rows-[1fr] opacity-100"
							: "grid-rows-[0fr] opacity-0",
					)}
				>
					<div className="min-h-0 overflow-hidden">
						<div className="ms-[21px] flex flex-col gap-0.5 border-s border-panel-border! ps-2.5 pt-1 pb-0.5">
							{visibleSubs.map((sub) => {
								const subActive = isItemActive(sub.url);
								const SubIcon = sub.icon;
								const isNotif = sub.url === "/notifications";

								return (
									<NavLink
										key={sub.id}
										to={sub.url}
										onClick={(e) => onNavigate(sub.url, e)}
										className={cn(
											"relative flex h-[34px] items-center gap-2.5 rounded-[10px] px-2.5 text-xs no-underline transition-[background-color,color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] outline-none select-none active:scale-[0.98] min-[769px]:hover:bg-panel-elevated",
											subActive
												? "bg-panel-elevated font-bold text-panel-accent"
												: "bg-transparent font-medium text-panel-text-secondary min-[769px]:hover:text-panel-text",
										)}
									>
										{subActive ? (
											<span className="pointer-events-none absolute -inset-s-[11.5px] top-1/2 h-3.5 w-[2px] -translate-y-1/2 rounded-full bg-panel-accent" />
										) : null}
										<SubIcon className="size-4 shrink-0" />
										<span className="min-w-0 flex-1 truncate">{sub.title}</span>
										{isNotif && unreadCount > 0 ? (
											<span
												dir="ltr"
												className="inline-flex h-[17px] min-w-[17px]! shrink-0 items-center justify-center rounded-full bg-panel-accent px-1 text-[10px] font-bold text-white tabular-nums [unicode-bidi:isolate]"
											>
												{unreadCount > 99 ? "99+" : unreadCount}
											</span>
										) : null}
									</NavLink>
								);
							})}
						</div>
					</div>
				</div>
			) : null}
		</div>
	);
};

interface SidebarBannerSectionProps {
	banners: SponsorAsset[];
	collapsed: boolean;
	inDrawer: boolean;
	visible: boolean;
}

const SidebarBannerSection: FC<SidebarBannerSectionProps> = ({
	banners,
	collapsed,
	inDrawer,
	visible,
}) => {
	if (collapsed || banners.length === 0) return null;

	const carousel = (
		<SponsorCarousel
			items={banners.map((asset) => ({
				id: asset.id,
				src: resolveAssetUrl(asset.image_url),
				alt: asset.alt || asset.label || "Sponsor",
				href: asset.target_url,
				label: asset.label,
				isSponsor: true,
			}))}
			variant="sidebar"
			animateIn={false}
		/>
	);

	if (inDrawer) {
		return (
			<div className="mx-auto w-full max-w-[min(154px,calc(100%-84px))] shrink-0 border-t border-panel-border! pt-2 pb-[calc(env(safe-area-inset-bottom,0px)+8px)]">
				{carousel}
			</div>
		);
	}

	return (
		<div
			aria-hidden={!visible}
			inert={!visible ? true : undefined}
			className={cn(
				"grid w-full shrink-0 transition-[grid-template-rows] duration-[560ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
				visible ? "grid-rows-[1fr]" : "pointer-events-none grid-rows-[0fr]",
			)}
		>
			<div className="min-h-0 overflow-hidden">
				<div className="w-full border-t border-panel-border! pt-2.5 pb-2.5">
					{carousel}
				</div>
			</div>
		</div>
	);
};

export const AppSidebar: FC<AppSidebarProps> = memo(function AppSidebar({
	collapsed,
	loading = false,
	bannerVisible = true,
	sponsors = [],
	sidebarBanners = [],
	inDrawer = false,
	onRequestExpand,
}) {
	const { t, i18n } = useTranslation();
	const location = useLocation();
	const navigate = useNavigate();
	const { colorMode } = useColorMode();
	const isRTL = i18n.dir(i18n.language) === "rtl";
	const { navSections } = useNavSections();
	const unreadNotifications = useUnreadNotifications();
	const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
		users_hub: true,
	});
	const [openFlyoutId, setOpenFlyoutId] = useState<string | null>(null);
	const flyoutCloseTimerRef = useRef<number | null>(null);
	const hoveredFlyoutRef = useRef<{
		id: string;
		part: "trigger" | "content";
	} | null>(null);

	const clearFlyoutCloseTimer = useCallback(() => {
		if (flyoutCloseTimerRef.current !== null) {
			window.clearTimeout(flyoutCloseTimerRef.current);
			flyoutCloseTimerRef.current = null;
		}
	}, []);

	const handleFlyoutPointerEnter = useCallback(
		(id: string, part: "trigger" | "content") => {
			clearFlyoutCloseTimer();
			hoveredFlyoutRef.current = { id, part };
			setOpenFlyoutId(id);
		},
		[clearFlyoutCloseTimer],
	);

	const handleFlyoutPointerLeave = useCallback(
		(id: string, part: "trigger" | "content") => {
			if (
				hoveredFlyoutRef.current?.id === id &&
				hoveredFlyoutRef.current.part === part
			) {
				hoveredFlyoutRef.current = null;
			}
			clearFlyoutCloseTimer();
			flyoutCloseTimerRef.current = window.setTimeout(() => {
				if (!hoveredFlyoutRef.current) {
					setOpenFlyoutId((prev) => (prev === id ? null : prev));
				}
			}, 140);
		},
		[clearFlyoutCloseTimer],
	);

	const handleFlyoutOpenChange = useCallback(
		(id: string, next: boolean) => {
			if (next) {
				clearFlyoutCloseTimer();
				setOpenFlyoutId(id);
				return;
			}
			if (hoveredFlyoutRef.current?.id === id) {
				return;
			}
			setOpenFlyoutId((prev) => (prev === id ? null : prev));
		},
		[clearFlyoutCloseTimer],
	);

	const closeAllFlyoutsImmediate = useCallback(() => {
		hoveredFlyoutRef.current = null;
		clearFlyoutCloseTimer();
		setOpenFlyoutId(null);
	}, [clearFlyoutCloseTimer]);

	useEffect(() => {
		if (!collapsed) {
			closeAllFlyoutsImmediate();
		}
	}, [collapsed, closeAllFlyoutsImmediate]);

	useEffect(() => () => clearFlyoutCloseTimer(), [clearFlyoutCloseTimer]);

	const handleNavigate = useCallback(
		(url: string, event?: ReactMouseEvent) => {
			event?.preventDefault();
			const defaultTab = DEFAULT_TAB_BY_PATH[url];
			const normalized = url.startsWith("/") ? url : `/${url}`;
			navigate(defaultTab ? `${normalized}#${defaultTab}` : normalized);
			if (inDrawer && onRequestExpand) {
				onRequestExpand();
			}
		},
		[inDrawer, navigate, onRequestExpand],
	);

	useEffect(() => {
		const path = location.pathname;
		if (path === "/users" || path === "/groups" || path === "/bulk-actions") {
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
			path.startsWith("/notifications") ||
			path.startsWith("/placeholders") ||
			path.startsWith("/phpmyadmin") ||
			path.startsWith("/external-apps")
		) {
			setOpenGroups((prev) => ({ ...prev, system_tools: true }));
		}
	}, [location.pathname]);

	const dynamicSidebarWidth = useMemo(() => {
		let maxLen = 0;
		for (const section of navSections) {
			for (const item of section.items) {
				if (item.title && item.title.length > maxLen) {
					maxLen = item.title.length;
				}
				if (item.type === "group") {
					for (const sub of item.subItems) {
						if (sub.title && sub.title.length > maxLen) {
							maxLen = sub.title.length;
						}
					}
				}
			}
		}
		if (maxLen > 20) {
			return Math.min(288, Math.round(240 + (maxLen - 20) * 5));
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

	const navScrollRef = useRef<HTMLDivElement | null>(null);

	const handleGroupClick = useCallback(
		(groupId: string) => {
			setOpenGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
		},
		[],
	);

	const isItemActive = useCallback(
		(url: string) =>
			location.pathname === url ||
			(url !== "/" && location.pathname.startsWith(url)),
		[location.pathname],
	);

	return (
		<TooltipProvider delayDuration={180}>
			<aside
				dir={isRTL ? "rtl" : "ltr"}
				data-dir={isRTL ? "rtl" : "ltr"}
				data-collapsed={collapsed ? "true" : "false"}
				style={{
					width: inDrawer
						? "100%"
						: collapsed
							? "68px"
							: `var(--rb-sidebar-width, ${dynamicSidebarWidth}px)`,
					...(inDrawer ? {} : { [isRTL ? "right" : "left"]: 12 }),
				}}
				className={cn(
					"flex shrink-0 overflow-hidden bg-panel-surface select-none [touch-action:manipulation]",
					inDrawer
						? "relative h-full max-h-full w-full"
						: "fixed top-3 z-[200] h-[calc(100dvh-24px)] max-h-[calc(100dvh-24px)] rounded-[20px] border border-panel-border! shadow-[0_1px_2px_rgba(0,0,0,0.03),inset_0_1px_0_0_rgba(255,255,255,0.7)] transition-[width] duration-[260ms] ease-[cubic-bezier(0.16,1,0.3,1)] dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]",
				)}
			>
				{loading ? (
					<SidebarSkeletonBody collapsed={collapsed} />
				) : (
					<div
						className={cn(
							"flex h-full min-h-0 w-full flex-col justify-between px-2 pt-2.5",
							inDrawer ? "pb-2.5" : "pb-0",
						)}
					>
					<div
						className={cn(
							"-mx-2 mb-2 flex min-h-[48px] items-center justify-between border-b border-panel-border! py-2.5 ps-0",
							inDrawer ? "pe-2.5" : "pe-0",
						)}
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

						{inDrawer && onRequestExpand ? (
							<button
								type="button"
								data-drawer-close="true"
								aria-label={t("close")}
								onClick={onRequestExpand}
								className="inline-flex size-9 min-w-9 shrink-0 items-center justify-center rounded-full border border-panel-border! bg-panel-elevated/60 text-panel-text-secondary transition-[background-color,color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] outline-none active:scale-[0.92] min-[769px]:hover:bg-panel-elevated min-[769px]:hover:text-panel-text"
							>
								<X className="size-4" />
							</button>
						) : null}
					</div>

					<div
						ref={navScrollRef}
						dir={isRTL ? "rtl" : "ltr"}
						className={cn(
							"rb-sidebar-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain [overflow-anchor:none] px-0",
							!inDrawer && "pb-2.5",
						)}
					>
						<div
							className={cn(
								"flex flex-col py-1.5",
								collapsed ? "gap-3" : "gap-4",
							)}
						>
							{navSections.map((section) => {
								const visibleItems = section.items.filter(
									(item) => item.visible,
								);
								if (visibleItems.length === 0) return null;

								return (
									<div key={section.id} data-nav-section={section.id}>

										<div
											className={cn(
												"pointer-events-none overflow-hidden whitespace-nowrap transition-[max-height,opacity,margin] duration-[260ms] ease-[cubic-bezier(0.16,1,0.3,1)]",
												collapsed
													? "mb-0 mt-0 max-h-0 opacity-0"
													: "mb-1.5 mt-0 max-h-[26px] opacity-100",
											)}
										>
											<span className="block truncate px-3 text-[10.5px] font-bold tracking-[0.06em] uppercase text-panel-text-muted">
												{section.title}
											</span>
										</div>

										<div className="flex flex-col gap-0.5">
											{visibleItems.map((item) => {
												if (item.type === "direct") {
													const isActive = isItemActive(item.url);
													const ItemIcon = item.icon;
													const showBadge = Boolean(item.badge);

													return (
														<Tooltip
															key={item.id}
															open={collapsed ? undefined : false}
														>
															<TooltipTrigger asChild>
																<NavLink
																	to={item.url}
																	onPointerEnter={(e) => {
																		if (
																			collapsed &&
																			e.pointerType === "mouse"
																		) {
																			closeAllFlyoutsImmediate();
																		}
																	}}
																	onClick={(e) => handleNavigate(item.url, e)}
																	className={cn(
																		"relative flex h-[38px] w-full items-center justify-start gap-2.5 overflow-hidden rounded-[12px] text-[13px] no-underline transition-[padding,background-color,color,transform] duration-[260ms] ease-[cubic-bezier(0.16,1,0.3,1)] outline-none select-none active:scale-[0.98] min-[769px]:hover:bg-panel-elevated",
																		collapsed ? "ps-4 pe-4" : "ps-3 pe-2.5",
																		isActive
																			? "bg-panel-elevated font-bold text-panel-accent"
																			: "bg-transparent font-medium text-panel-text-secondary min-[769px]:hover:text-panel-text",
																	)}
																>
																	{isActive ? (
																		<span className="pointer-events-none absolute inset-s-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-panel-accent" />
																	) : null}

																	<span className="relative inline-flex size-[18px] shrink-0 items-center justify-center">
																		<ItemIcon className="size-[18px]" />
																		{showBadge && collapsed ? (
																			<span className="absolute -top-1 -end-1 size-2 rounded-full border-[1.5px] border-panel-surface bg-panel-accent" />
																		) : null}
																	</span>

																	<span
																		aria-hidden={collapsed}
																		className={cn(
																			"flex min-w-0 flex-1 items-center justify-between gap-2 overflow-hidden whitespace-nowrap transition-opacity ease-out",
																			collapsed
																				? "pointer-events-none opacity-0 duration-150"
																				: "opacity-100 delay-[40ms] duration-200",
																		)}
																	>
																		<span className="truncate">
																			{item.title}
																		</span>
																		{showBadge ? (
																			<span className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-panel-accent text-white">
																				<BellRing className="size-2.5" />
																			</span>
																		) : null}
																	</span>
																</NavLink>
															</TooltipTrigger>
															<TooltipContent
																side={isRTL ? "left" : "right"}
																sideOffset={10}
																className="z-[2200] rounded-[10px] border border-panel-border! bg-panel-elevated px-3 py-1.5 text-xs font-semibold text-panel-text shadow-lg"
															>
																{item.title}
															</TooltipContent>
														</Tooltip>
													);
												}

												const visibleSubs = item.subItems.filter(
													(sub) => sub.visible,
												);
												if (visibleSubs.length === 0) return null;

												const isGroupActive = visibleSubs.some((sub) =>
													isItemActive(sub.url),
												);
												const isOpen = Boolean(openGroups[item.id]);

												return (
													<GroupNavRow
														key={item.id}
														group={item}
														collapsed={collapsed}
														isGroupActive={isGroupActive}
														isOpen={isOpen}
														flyoutOpen={collapsed && openFlyoutId === item.id}
														isRTL={isRTL}
														unreadCount={unreadNotifications}
														isItemActive={isItemActive}
														onToggleOpen={() => handleGroupClick(item.id)}
														onFlyoutPointerEnter={handleFlyoutPointerEnter}
														onFlyoutPointerLeave={handleFlyoutPointerLeave}
														onFlyoutOpenChange={handleFlyoutOpenChange}
														onNavigate={handleNavigate}
													/>
												);
											})}
										</div>
									</div>
								);
							})}
						</div>
					</div>

					<SidebarBannerSection
						banners={sidebarBanners}
						collapsed={collapsed}
						inDrawer={inDrawer}
						visible={bannerVisible}
					/>
				</div>
				)}
			</aside>
		</TooltipProvider>
	);
});

