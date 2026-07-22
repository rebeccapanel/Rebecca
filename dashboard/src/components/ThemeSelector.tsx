import {
	Box,
	Button,
	chakra,
	HStack,
	IconButton,
	Menu,
	MenuButton,
	MenuDivider,
	MenuList,
	Portal,
	SimpleGrid,
	Text,
	Tooltip,
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
	{
		key: "crimson",
		label: "Red / Crimson",
		color: "#e0003c",
		hover: "#f01446",
	},
	{ key: "blue", label: "Blue", color: "#2563eb", hover: "#3b82f6" },
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
	ACCENT_OPTIONS.some((option) => option.key === value) ? value! : "crimson";

const getStoredAccent = () => {
	try {
		return normalizeAccent(localStorage.getItem(ACCENT_KEY));
	} catch {
		return "crimson";
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
	minimal = false,
	portalContainer,
	trigger = "icon",
	triggerLabel,
	onModalClose,
}) => {
	const { t } = useTranslation();
	const { colorMode, setColorMode } = useColorMode();
	const themeMenu = useDisclosure();
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
		onModalClose?.();
	}, [onModalClose]);

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
		if (theme !== activeTheme) setColorMode(theme);
	};

	const selectAccent = (accent: string) => {
		setActiveAccent(accent);
	};

	const renderThemeCard = (theme: (typeof THEME_OPTIONS)[number]) => {
		const selected = activeTheme === theme.key;
		const Icon = theme.icon;
		return (
			<Button
				key={theme.key}
				variant="outline"
				h="72px"
				borderRadius="6px"
				borderColor={selected ? "panel.accent" : "panel.border"}
				borderWidth={selected ? "2px" : "1px"}
				bg={selected ? "panel.elevated" : "transparent"}
				color="panel.text"
				_hover={{ bg: menuHover, borderColor: "panel.accent" }}
				onClick={() => selectTheme(theme.key)}
				position="relative"
				px={3}
			>
				<VStack spacing={2} align="center" justify="center" w="full">
					<Icon />
					<Text textAlign="center" fontWeight="700" lineHeight="1">
						{t(`theme.${theme.key}`, theme.label)}
					</Text>
				</VStack>
				{selected ? (
					<Box
						position="absolute"
						top="2"
						insetInlineEnd="2"
						color="panel.accent"
					>
						<CheckIconChakra />
					</Box>
				) : null}
			</Button>
		);
	};

	const menuList = (
		<MenuList
			minW={{ base: "min(320px, calc(100vw - 24px))", sm: "320px" }}
			maxW="calc(100vw - 16px)"
			bg={menuBg}
			borderColor={menuBorder}
			color={textColor}
			zIndex={9999}
			p={3}
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
						fontSize="xs"
						fontWeight="700"
						color={secondaryText}
						textTransform="uppercase"
						mb={2}
					>
						{t("header.theme")}
					</Text>
					<SimpleGrid columns={2} spacing={2}>
						{THEME_OPTIONS.map(renderThemeCard)}
					</SimpleGrid>
				</Box>

				{!minimal ? <MenuDivider borderColor={menuBorder} /> : null}

				<Box>
					<Text
						fontSize="xs"
						fontWeight="700"
						color={secondaryText}
						textTransform="uppercase"
						mb={2}
					>
						{t("theme.accent")}
					</Text>
					<SimpleGrid columns={{ base: 5 }} spacing={2}>
						{ACCENT_OPTIONS.map((accent) => {
							const selected = activeAccent === accent.key;
							return (
								<Tooltip
									key={accent.key}
									label={t(`theme.accent.${accent.key}`, accent.label)}
									hasArrow
								>
									<IconButton
										aria-label={t(`theme.accent.${accent.key}`, accent.label)}
										icon={selected ? <CheckIconChakra /> : undefined}
										size="sm"
										h="34px"
										minW="34px"
										borderRadius="6px"
										borderWidth={selected ? "2px" : "1px"}
										borderColor={selected ? "panel.text" : "panel.border"}
										bg={accent.color}
										color="white"
										_hover={{
											bg: accent.hover,
											borderColor: "panel.text",
										}}
										_focusVisible={{
											boxShadow: "0 0 0 2px var(--rb-panel-accent)",
										}}
										onClick={() => selectAccent(accent.key)}
									/>
								</Tooltip>
							);
						})}
					</SimpleGrid>
				</Box>
			</VStack>
		</MenuList>
	);

	if (trigger === "menuItem") {
		return (
			<Menu
				placement="auto-start"
				strategy="fixed"
				isLazy
				autoSelect={false}
				gutter={6}
				computePositionOnMount
				modifiers={popperModifiers}
				isOpen={themeMenu.isOpen}
				onOpen={themeMenu.onOpen}
				onClose={themeMenu.onClose}
				closeOnSelect={false}
			>
				<MenuButton
					as={Button}
					variant="ghost"
					w="full"
					h="40px"
					justifyContent="flex-start"
					fontWeight="500"
					borderRadius="md"
					px={3}
					bg="transparent"
					color={textColor}
					_hover={{ bg: menuHover }}
					_active={{ bg: menuHover }}
					_focusVisible={{ bg: menuHover }}
					onClick={(event: ReactMouseEvent) => {
						event.stopPropagation();
						themeMenu.isOpen ? themeMenu.onClose() : themeMenu.onOpen();
					}}
				>
					<HStack justify="flex-start" spacing={3} w="full" minW={0}>
						<SwatchIconChakra flexShrink={0} />
						<Text noOfLines={1}>
							{triggerLabel || t("header.theme")}
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
