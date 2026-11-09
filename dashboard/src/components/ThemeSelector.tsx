import {
	Box,
	Button,
	chakra,
	HStack,
	IconButton,
	Menu,
	MenuButton,
	MenuList,
	Portal,
	SimpleGrid,
	Text,
	useColorMode,
	useColorModeValue,
	useDisclosure,
	VStack,
} from "@chakra-ui/react";
import {
	CheckIcon,
	MoonIcon,
	SunIcon,
	SwatchIcon,
} from "@heroicons/react/24/outline";
import { motion } from "framer-motion";
import {
	type FC,
	type MutableRefObject,
	type MouseEvent as ReactMouseEvent,
	useEffect,
	useMemo,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { updateThemeColor } from "utils/themeColor";

const THEME_KEY = "rb-theme";
const CHAKRA_THEME_KEY = "chakra-ui-color-mode";
const ACCENT_KEY = "rb-accent";
const CUSTOM_THEMES_KEY = "rb-custom-themes";

type ThemeMode = "dark" | "light";

type AccentOption = {
	key: string;
	label: string;
	color: string;
	hover: string;
};

type ThemeSelectorProps = {
	minimal?: boolean;
	portalContainer?: MutableRefObject<HTMLElement | null>;
	trigger?: "icon" | "menu" | "menuItem";
	triggerLabel?: string;
	isOpen?: boolean;
	isPressing?: boolean;
	onToggle?: () => void;
	onClose?: () => void;
	onModalOpen?: () => void;
	onModalClose?: () => void;
};

const CheckIconChakra = chakra(CheckIcon, {
	baseStyle: {
		w: 4,
		h: 4,
	},
});

const MoonIconChakra = chakra(MoonIcon, {
	baseStyle: {
		w: 4,
		h: 4,
	},
});

const SunIconChakra = chakra(SunIcon, {
	baseStyle: {
		w: 4,
		h: 4,
	},
});

const SwatchIconChakra = chakra(SwatchIcon, {
	baseStyle: {
		w: 4,
		h: 4,
	},
});

const ACCENT_OPTIONS: AccentOption[] = [
	{ key: "blue", label: "Blue", color: "#2563eb", hover: "#3b82f6" },
	{
		key: "crimson",
		label: "Red / Crimson",
		color: "#e0003c",
		hover: "#f01446",
	},
	{ key: "green", label: "Green", color: "#16a34a", hover: "#22c55e" },
	{ key: "purple", label: "Purple", color: "#7c3aed", hover: "#8b5cf6" },
	{ key: "orange", label: "Orange", color: "#ea580c", hover: "#f97316" },
];

const THEME_OPTIONS: Array<{
	key: ThemeMode;
	label: string;
	icon: typeof MoonIconChakra;
}> = [
	{ key: "dark", label: "Dark", icon: MoonIconChakra },
	{ key: "light", label: "Light", icon: SunIconChakra },
];

const clamp = (value: number, min = 0, max = 1) =>
	Math.min(max, Math.max(min, value));

const hexToRgb = (hex: string) => {
	const normalized = hex.replace("#", "");
	const bigint = parseInt(normalized, 16);
	if (normalized.length === 3) {
		const r = (bigint >> 8) & 0xf;
		const g = (bigint >> 4) & 0xf;
		const b = bigint & 0xf;
		return {
			r: (r << 4) | r,
			g: (g << 4) | g,
			b: (b << 4) | b,
		};
	}
	return {
		r: (bigint >> 16) & 255,
		g: (bigint >> 8) & 255,
		b: bigint & 255,
	};
};

const rgbToHex = (r: number, g: number, b: number) => {
	const toHex = (value: number) => value.toString(16).padStart(2, "0");
	return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

const rgbToHsl = (r: number, g: number, b: number) => {
	r /= 255;
	g /= 255;
	b /= 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	let h = 0;
	let s = 0;
	const l = (max + min) / 2;
	if (max !== min) {
		const d = max - min;
		s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
		switch (max) {
			case r:
				h = (g - b) / d + (g < b ? 6 : 0);
				break;
			case g:
				h = (b - r) / d + 2;
				break;
			default:
				h = (r - g) / d + 4;
		}
		h /= 6;
	}
	return { h, s, l };
};

const hslToRgb = (h: number, s: number, l: number) => {
	let r: number;
	let g: number;
	let b: number;

	if (s === 0) {
		r = g = b = l;
	} else {
		const hue2rgb = (p: number, q: number, t: number) => {
			if (t < 0) t += 1;
			if (t > 1) t -= 1;
			if (t < 1 / 6) return p + (q - p) * 6 * t;
			if (t < 1 / 2) return q;
			if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
			return p;
		};
		const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
		const p = 2 * l - q;
		r = hue2rgb(p, q, h + 1 / 3);
		g = hue2rgb(p, q, h);
		b = hue2rgb(p, q, h - 1 / 3);
	}

	return {
		r: Math.round(r * 255),
		g: Math.round(g * 255),
		b: Math.round(b * 255),
	};
};

const generatePalette = (baseHex: string) => {
	try {
		const { r, g, b } = hexToRgb(baseHex);
		const { h, s, l } = rgbToHsl(r, g, b);
		const stops: [string, number][] = [
			["50", 0.42],
			["100", 0.32],
			["200", 0.22],
			["300", 0.12],
			["400", 0.06],
			["500", 0],
			["600", -0.06],
			["700", -0.13],
			["800", -0.22],
			["900", -0.32],
		];

		return stops.reduce<Record<string, string>>((acc, [suffix, shift]) => {
			const { r: rr, g: gg, b: bb } = hslToRgb(h, s, clamp(l + shift));
			acc[`--primary-${suffix}`] = rgbToHex(rr, gg, bb);
			return acc;
		}, {});
	} catch {
		return {};
	}
};

const normalizeTheme = (value?: string | null): ThemeMode =>
	value === "light" ? "light" : "dark";

const normalizeAccent = (value?: string | null) =>
	ACCENT_OPTIONS.some((option) => option.key === value) ? value! : "blue";

const getStoredAccent = () => {
	try {
		return normalizeAccent(localStorage.getItem(ACCENT_KEY));
	} catch {
		return "blue";
	}
};

const applyAccent = (accentKey: string) => {
	const accent =
		ACCENT_OPTIONS.find((option) => option.key === accentKey) ??
		ACCENT_OPTIONS[0];
	const root = document.documentElement;
	root.style.setProperty("--rb-panel-accent", accent.color);
	root.style.setProperty("--rb-panel-accent-hover", accent.hover);
	Object.entries(generatePalette(accent.color)).forEach(([key, value]) => {
		root.style.setProperty(key, value);
	});
};

const applyThemeMode = (theme: ThemeMode) => {
	try {
		localStorage.setItem(THEME_KEY, theme);
		localStorage.setItem(CHAKRA_THEME_KEY, theme);
		localStorage.removeItem(CUSTOM_THEMES_KEY);
	} catch {}

	const targets = [document.documentElement, document.body].filter(
		Boolean,
	) as HTMLElement[];
	targets.forEach((target) => {
		target.classList.remove(
			"rb-theme-light",
			"rb-theme-dark",
			"chakra-ui-light",
			"chakra-ui-dark",
		);
		target.classList.add(`rb-theme-${theme}`, `chakra-ui-${theme}`);
		target.dataset.theme = theme;
		target.style.colorScheme = theme;
	});
	updateThemeColor(theme);
};

export const ThemeSelector: FC<ThemeSelectorProps> = ({
	minimal,
	portalContainer,
	trigger = "menu",
	triggerLabel,
	isOpen: controlledIsOpen,
	isPressing = false,
	onToggle: controlledOnToggle,
	onClose: _controlledOnClose,
	onModalOpen,
	onModalClose,
}) => {
	const { t } = useTranslation();
	const { colorMode, setColorMode } = useColorMode();
	const themeMenu = useDisclosure();
	const isControlled = controlledIsOpen !== undefined;
	const isMenuOpen = isControlled ? controlledIsOpen : themeMenu.isOpen;
	const activeTheme = normalizeTheme(colorMode);
	const [activeAccent, setActiveAccent] = useState(getStoredAccent);
	const menuBg = useColorModeValue("panel.surface", "panel.surface");
	const menuBorder = useColorModeValue("panel.border", "panel.border");
	const menuHover = useColorModeValue("panel.elevated", "panel.elevated");
	const textColor = useColorModeValue("panel.text", "panel.text");
	const secondaryText = useColorModeValue(
		"panel.textSecondary",
		"panel.textSecondary",
	);
	const selectedAccentBorder = useColorModeValue("panel.text", "white");
	const selectedAccentRing = useColorModeValue(
		"0 0 0 2px var(--chakra-colors-panel-text)",
		"0 0 0 2px rgba(255, 255, 255, 0.95)",
	);
	const selectedAccentHoverRing = useColorModeValue(
		"0 0 0 3px var(--chakra-colors-panel-text)",
		"0 0 0 3px rgba(255, 255, 255, 0.95)",
	);

	const popperModifiers = useMemo(
		() => [
			{
				name: "preventOverflow",
				options: { boundary: "viewport", padding: 8 },
			},
			{ name: "shift", options: { padding: 8 } },
			{
				name: "flip",
				options: {
					fallbackPlacements: [
						"bottom-start",
						"bottom",
						"bottom-end",
						"top",
						"top-start",
						"top-end",
					],
				},
			},
			{
				name: "offset",
				options: { offset: [0, 8] },
			},
		],
		[],
	);

	useEffect(() => {
		applyThemeMode(activeTheme);
	}, [activeTheme]);

	useEffect(() => {
		applyAccent(activeAccent);
		try {
			localStorage.setItem(ACCENT_KEY, activeAccent);
		} catch {}
	}, [activeAccent]);

	const selectTheme = (theme: ThemeMode) => {
		if (theme !== activeTheme) {
			setColorMode(theme);
		}
	};

	const selectAccent = (accent: string) => {
		if (accent === activeAccent) return;
		setActiveAccent(accent);
	};

	const renderThemeCard = (theme: (typeof THEME_OPTIONS)[number]) => {
		const selected = activeTheme === theme.key;
		const Icon = theme.icon;
		return (
			<Button
				key={theme.key}
				variant="outline"
				h="46px"
				borderRadius="12px"
				borderColor={selected ? "panel.borderStrong" : "panel.border"}
				borderWidth={selected ? "1.5px" : "1px"}
				bg={selected ? "panel.elevated" : "transparent"}
				color={selected ? "panel.text" : "panel.textSecondary"}
				boxShadow={selected ? "0 2px 8px rgba(0, 0, 0, 0.08)" : "none"}
				_hover={{
					md: {
						bg: "panel.elevated",
						color: "panel.text",
						borderColor: "panel.borderStrong",
					},
				}}
				onClick={(event) => {
					event.stopPropagation();
					selectTheme(theme.key);
				}}
				transition="all 0.25s cubic-bezier(0.16, 1, 0.3, 1)"
				position="relative"
				px={3}
			>
				<HStack spacing={2.5} align="center" justify="center" w="full">
					<motion.div
						initial={false}
						animate={{
							rotate: selected ? 360 : 0,
							scale: selected ? 1.12 : 0.95,
							opacity: selected ? 1 : 0.65,
						}}
						transition={{
							rotate: {
								duration: selected ? 0.45 : 0,
								ease: [0.16, 1, 0.3, 1],
							},
							scale: { duration: 0.25, ease: [0.16, 1, 0.3, 1] },
							opacity: { duration: 0.25, ease: [0.16, 1, 0.3, 1] },
						}}
						style={{
							display: "inline-flex",
							alignItems: "center",
							justifyContent: "center",
						}}
					>
						<Icon />
					</motion.div>
					<Text fontSize="13px" fontWeight={selected ? "700" : "500"}>
						{t(`theme.${theme.key}`, theme.label)}
					</Text>
				</HStack>
				{selected ? (
					<Box
						position="absolute"
						top="2.5"
						insetInlineEnd="2.5"
						color="panel.text"
					>
						<CheckIconChakra w="12px" h="12px" />
					</Box>
				) : null}
			</Button>
		);
	};

	const menuList = (
		<MenuList
			data-profile-window="true"
			data-profile-submenu="true"
			data-theme-menu-list="true"
			minW={{ base: "min(300px, calc(100vw - 24px))", sm: "300px" }}
			maxW="calc(100vw - 16px)"
			bg={menuBg}
			borderColor={menuBorder}
			borderWidth="1px"
			borderRadius="20px"
			boxShadow="0 20px 48px rgba(0, 0, 0, 0.35)"
			color={textColor}
			zIndex={9999}
			p={3.5}
			userSelect="none"
			sx={{
				".chakra-menu__menuitem": {
					bg: "transparent !important",
					"&:hover": {
						bg: `${menuHover} !important`,
					},
					"&:active, &:focus-visible": {
						bg: `${menuHover} !important`,
					},
					"&:focus:not(:focus-visible)": {
						bg: "transparent !important",
					},
				},
			}}
		>
			<VStack align="stretch" spacing={3}>
				<Box>
					<Text
						fontSize="11px"
						fontWeight="700"
						color={secondaryText}
						textTransform="uppercase"
						letterSpacing="0.04em"
						mb={2}
					>
						{t("header.theme")}
					</Text>
					<SimpleGrid columns={2} spacing={2}>
						{THEME_OPTIONS.map(renderThemeCard)}
					</SimpleGrid>
				</Box>

				{!minimal ? <Box h="1px" bg="panel.border" my={0.5} /> : null}

				<Box>
					<Text
						fontSize="11px"
						fontWeight="700"
						color={secondaryText}
						textTransform="uppercase"
						letterSpacing="0.04em"
						mb={2.5}
					>
						{t("theme.accent")}
					</Text>
					<SimpleGrid columns={5} spacing={2.5} justifyItems="center">
						{ACCENT_OPTIONS.map((accent) => {
							const selected = activeAccent === accent.key;
							return (
								<IconButton
									key={accent.key}
									aria-label={accent.key}
									icon={
										selected ? (
											<CheckIconChakra w="14px" h="14px" color="white" />
										) : undefined
									}
									size="sm"
									w="36px"
									h="36px"
									minW="36px"
									borderRadius="full"
									borderWidth="2px"
									borderColor={selected ? selectedAccentBorder : "transparent"}
									bg={accent.color}
									boxShadow={
										selected
											? `${selectedAccentRing}, 0 4px 12px ${accent.color}55`
											: "0 2px 6px rgba(0, 0, 0, 0.15)"
									}
									transform={selected ? "scale(1.08)" : "scale(1)"}
									_hover={{
										md: {
											bg: accent.hover,
											transform: "scale(1.15)",
											boxShadow: `${selectedAccentHoverRing}, 0 4px 14px ${accent.color}66`,
										},
									}}
									transition="all 0.22s cubic-bezier(0.16, 1, 0.3, 1)"
									onClick={(event) => {
										event.stopPropagation();
										selectAccent(accent.key);
									}}
								/>
							);
						})}
					</SimpleGrid>
				</Box>
			</VStack>
		</MenuList>
	);

	if (trigger === "menuItem") {
		const handleMenuClose = () => {
			if (!isControlled) {
				themeMenu.onClose();
			}
			onModalClose?.();
		};

		const handleToggle = () => {
			if (isControlled) {
				controlledOnToggle?.();
			} else {
				themeMenu.isOpen ? themeMenu.onClose() : themeMenu.onOpen();
			}
		};

		return (
			<Menu
				placement="auto-start"
				strategy="fixed"
				isLazy={false}
				autoSelect={false}
				gutter={6}
				computePositionOnMount
				modifiers={popperModifiers}
				isOpen={isMenuOpen}
				onOpen={() => {
					if (!isControlled) themeMenu.onOpen();
					onModalOpen?.();
				}}
				onClose={handleMenuClose}
				closeOnSelect={false}
				closeOnBlur={false}
			>
				<MenuButton
					as={Button}
					variant="ghost"
					data-submenu-trigger="true"
					data-theme-trigger="true"
					w="full"
					h="38px"
					justifyContent="flex-start"
					fontWeight="500"
					fontSize="13px"
					borderRadius="12px"
					px={3}
					bg={isPressing || isMenuOpen ? menuHover : "transparent"}
					color={textColor}
					transform={isPressing ? "scale(0.96)" : undefined}
					transition="all 0.12s cubic-bezier(0.2, 0, 0, 1)"
					_hover={{
						md: { bg: menuHover },
					}}
					_active={{ bg: menuHover, transform: "scale(0.96)" }}
					_focusVisible={{ bg: menuHover }}
					onClick={(event: ReactMouseEvent) => {
						event.stopPropagation();
						handleToggle();
					}}
				>
					<HStack justify="space-between" w="full" minW={0}>
						<HStack spacing={2.5} minW={0}>
							<SwatchIconChakra flexShrink={0} />
							<Text noOfLines={1}>{triggerLabel || t("header.theme")}</Text>
						</HStack>
						<Text
							fontSize="11px"
							fontWeight="600"
							color="panel.textMuted"
						>
							{activeTheme === "dark" ? t("theme.dark") : t("theme.light")}
						</Text>
					</HStack>
				</MenuButton>
				{portalContainer ? (
					<Portal containerRef={portalContainer}>{menuList}</Portal>
				) : (
					<Portal>{menuList}</Portal>
				)}
			</Menu>
		);
	}

	const triggerContent =
		trigger === "icon" ? (
			<MenuButton
				as={IconButton}
				size="sm"
				variant="outline"
				icon={<SwatchIconChakra />}
				aria-label={t("header.theme")}
				position="relative"
				type="button"
			/>
		) : (
			<MenuButton
				as={Button}
				w="full"
				justifyContent="space-between"
				variant="ghost"
				rightIcon={<SwatchIconChakra />}
				type="button"
			>
				{triggerLabel || t("header.theme")}
			</MenuButton>
		);

	return (
		<Menu
			placement="auto-start"
			strategy="fixed"
			isLazy
			autoSelect={false}
			gutter={6}
			computePositionOnMount
			modifiers={popperModifiers}
			closeOnSelect={false}
			closeOnBlur={false}
		>
			{triggerContent}
			{portalContainer ? (
				<Portal containerRef={portalContainer}>{menuList}</Portal>
			) : (
				<Portal>{menuList}</Portal>
			)}
		</Menu>
	);
};

export default ThemeSelector;
