import { Button } from "components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "components/ui/dropdown-menu";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "components/ui/popover";
import { ToggleRow } from "components/ui/toggle-row";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "components/ui/tooltip";
import { useDisclosure } from "hooks/useDisclosure";
import { useMediaQuery } from "hooks/useMediaQuery";
import { cn } from "lib/cn";
import { useColorMode } from "lib/color-mode";
import {
	ENTITY_PAGE_LABELS,
	ENTITY_PAGE_SECTIONS,
	useEntityPagePrefs,
} from "lib/entityPages";
import { Check, Moon, Sun, SwatchBook } from "lucide-react";
import {
	type CSSProperties,
	type FC,
	type MouseEvent as ReactMouseEvent,
	type MutableRefObject,
	useEffect,
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

export type ThemeSelectorProps = {
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

const THEME_OPTIONS: Array<{
	key: ThemeMode;
	label: string;
	icon: typeof Moon;
}> = [
	{ key: "dark", label: "Dark", icon: Moon },
	{ key: "light", label: "Light", icon: Sun },
];

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

const clamp = (value: number, min = 0, max = 1) =>
	Math.min(max, Math.max(min, value));

const hexToRgb = (hex: string) => {
	const normalized = hex.replace("#", "");
	const bigint = Number.parseInt(normalized, 16);
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
	const rn = r / 255;
	const gn = g / 255;
	const bn = b / 255;
	const max = Math.max(rn, gn, bn);
	const min = Math.min(rn, gn, bn);
	let h = 0;
	let s = 0;
	const l = (max + min) / 2;
	if (max !== min) {
		const d = max - min;
		s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
		switch (max) {
			case rn:
				h = (gn - bn) / d + (gn < bn ? 6 : 0);
				break;
			case gn:
				h = (bn - rn) / d + 2;
				break;
			default:
				h = (rn - gn) / d + 4;
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
			let tn = t;
			if (tn < 0) tn += 1;
			if (tn > 1) tn -= 1;
			if (tn < 1 / 6) return p + (q - p) * 6 * tn;
			if (tn < 1 / 2) return q;
			if (tn < 2 / 3) return p + (q - p) * (2 / 3 - tn) * 6;
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
	ACCENT_OPTIONS.some((option) => option.key === value)
		? (value as string)
		: "blue";

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
	for (const [key, value] of Object.entries(generatePalette(accent.color))) {
		root.style.setProperty(key, value);
	}
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
	for (const target of targets) {
		target.classList.remove(
			"rb-theme-light",
			"rb-theme-dark",
			"chakra-ui-light",
			"chakra-ui-dark",
		);
		target.classList.add(`rb-theme-${theme}`, `chakra-ui-${theme}`);
		target.dataset.theme = theme;
		target.style.colorScheme = theme;
	}
	updateThemeColor(theme);
};

type ThemePanelProps = {
	minimal: boolean;
	activeTheme: ThemeMode;
	activeAccent: string;
	onSelectTheme: (theme: ThemeMode) => void;
	onSelectAccent: (accent: string) => void;
};

const EntityPageToggles: FC<{ minimal?: boolean }> = ({ minimal }) => {
	const { t } = useTranslation();
	const pages = useEntityPagePrefs((state) => state.pages);
	const setPage = useEntityPagePrefs((state) => state.setPage);

	return (
		<>
			{!minimal ? (
				<hr className="my-1.5 border-0 border-b border-panel-border! opacity-70" />
			) : null}
			<div>
				<p className="mb-2 text-[11px] font-bold tracking-wider uppercase text-panel-text-muted">
					{t("entityPages.title", "Open as page")}
				</p>
				<div className="flex flex-col gap-1.5">
					{ENTITY_PAGE_SECTIONS.map((section) => (
						<ToggleRow
							key={section}
							title={t(`entityPages.${section}`, ENTITY_PAGE_LABELS[section])}
							checked={Boolean(pages[section])}
							onChange={(next) => setPage(section, next)}
						/>
					))}
				</div>
			</div>
		</>
	);
};

const ThemePanel: FC<ThemePanelProps> = ({
	minimal,
	activeTheme,
	activeAccent,
	onSelectTheme,
	onSelectAccent,
}) => {
	const { t, i18n } = useTranslation();
	const isRTL = i18n.dir(i18n.language) === "rtl";

	return (
		<TooltipProvider delayDuration={250}>
			<div
				dir={isRTL ? "rtl" : "ltr"}
				className="flex flex-col gap-3 text-panel-text select-none"
			>
				<div>
					<p className="mb-2 text-[11px] font-bold tracking-wider uppercase text-panel-text-muted">
						{t("header.theme")}
					</p>
					<div className="grid grid-cols-2 gap-2">
						{THEME_OPTIONS.map((theme) => {
							const selected = activeTheme === theme.key;
							const Icon = theme.icon;
							return (
								<button
									key={theme.key}
									type="button"
									onClick={() => onSelectTheme(theme.key)}
									className={cn(
										"relative flex h-[64px] flex-col items-center justify-center gap-1.5 rounded-[12px] px-3 text-panel-text transition-[background-color,border-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] outline-none active:scale-[0.97] min-[769px]:hover:bg-panel-elevated",
										selected
											? "border-2 border-panel-accent! bg-panel-elevated"
											: "border border-panel-border! bg-panel-surface min-[769px]:hover:border-panel-border-strong!",
									)}
								>
									<Icon className="size-4 text-panel-text" />
									<span className="text-center text-xs font-bold leading-none">
										{t(`theme.${theme.key}`, theme.label)}
									</span>
									{selected ? (
										<span className="absolute top-1.5 end-1.5 text-panel-accent">
											<Check className="size-3.5" />
										</span>
									) : null}
								</button>
							);
						})}
					</div>
				</div>

				{!minimal ? (
					<hr className="my-0.5 border-0 border-b border-panel-border! opacity-70" />
				) : null}

				<div>
					<p className="mb-2 text-[11px] font-bold tracking-wider uppercase text-panel-text-muted">
						{t("theme.accent")}
					</p>
					<div className="grid grid-cols-5 gap-2">
						{ACCENT_OPTIONS.map((accent) => {
							const selected = activeAccent === accent.key;
							const label = t(`theme.accent.${accent.key}`, accent.label);
							return (
								<Tooltip key={accent.key}>
									<TooltipTrigger asChild>
										<button
											type="button"
											aria-label={label}
											onClick={() => onSelectAccent(accent.key)}
											style={
												{
													"--swatch": accent.color,
													"--swatch-hover": accent.hover,
												} as CSSProperties
											}
											className={cn(
												"inline-flex h-[34px] min-w-[34px]! items-center justify-center rounded-[10px] bg-[var(--swatch)] text-white transition-[background-color,border-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] outline-none active:scale-[0.94] focus-visible:ring-2 focus-visible:ring-panel-accent min-[769px]:hover:border-panel-text! min-[769px]:hover:bg-[var(--swatch-hover)]",
												selected
													? "border-2 border-panel-text! shadow-[0_2px_8px_rgba(0,0,0,0.22)]"
													: "border border-panel-border!",
											)}
										>
											{selected ? <Check className="size-4 text-white" /> : null}
										</button>
									</TooltipTrigger>
									<TooltipContent className="z-[10020]">{label}</TooltipContent>
								</Tooltip>
							);
						})}
					</div>
				</div>

				<EntityPageToggles minimal={minimal} />
			</div>
		</TooltipProvider>
	);
};

export const ThemeSelector: FC<ThemeSelectorProps> = ({
	minimal = false,
	trigger = "icon",
	triggerLabel,
	isOpen: controlledIsOpen,
	isPressing = false,
	onToggle: controlledOnToggle,
	onClose: controlledOnClose,
	onModalClose,
}) => {
	const { t, i18n } = useTranslation();
	const { colorMode, setColorMode } = useColorMode();
	const localDisclosure = useDisclosure();
	const isDesktop = useMediaQuery("(min-width: 769px)");
	const isRTL = i18n.dir(i18n.language) === "rtl";
	const activeTheme = normalizeTheme(colorMode);
	const [activeAccent, setActiveAccent] = useState(getStoredAccent);

	const isControlled = controlledIsOpen !== undefined;
	const isOpen = isControlled ? controlledIsOpen : localDisclosure.isOpen;

	const handleOpenChange = (nextOpen: boolean) => {
		if (isControlled) {
			if (nextOpen) controlledOnToggle?.();
			else controlledOnClose?.();
			return;
		}
		if (nextOpen) localDisclosure.onOpen();
		else localDisclosure.onClose();
	};

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

	const panel = (
		<ThemePanel
			minimal={minimal}
			activeTheme={activeTheme}
			activeAccent={activeAccent}
			onSelectTheme={selectTheme}
			onSelectAccent={selectAccent}
		/>
	);

	const panelSurfaceClass =
		"z-[10005] w-[min(312px,calc(100vw-24px))] max-w-[calc(100vw-16px)] max-h-[min(calc(var(--radix-popover-content-available-height,72dvh)-8px),calc(100dvh-24px))] overflow-y-auto overscroll-contain rounded-[20px] border border-panel-border! bg-panel-surface p-3.5 text-panel-text shadow-[0_20px_48px_rgba(0,0,0,0.35)]";

	if (trigger === "menuItem") {
		return (
			<Popover open={isOpen} onOpenChange={handleOpenChange}>
				<PopoverTrigger asChild>
					<button
						type="button"
						data-submenu-trigger="true"
						data-theme-trigger="true"
						onClick={(event: ReactMouseEvent) => {
							event.stopPropagation();
							if (controlledOnToggle) controlledOnToggle();
							else handleOpenChange(!isOpen);
						}}
						className={cn(
							"flex h-[38px] w-full items-center justify-between gap-2.5 rounded-[12px] px-3 text-[13px] font-medium text-panel-text transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] outline-none select-none active:scale-[0.97] active:bg-panel-elevated focus-visible:bg-panel-elevated min-[769px]:hover:bg-panel-elevated",
							isPressing || isOpen ? "bg-panel-elevated" : "bg-transparent",
							isPressing && "scale-[0.97]",
						)}
					>
						<span className="flex min-w-0 items-center gap-2.5">
							<SwatchBook
								className="size-4 shrink-0 text-panel-text"
								strokeWidth={1.75}
							/>
							<span className="truncate">
								{triggerLabel || t("header.theme")}
							</span>
						</span>
						<span className="text-[11px] font-semibold text-panel-text-muted">
							{t(`theme.${activeTheme}`, activeTheme === "dark" ? "Dark" : "Light")}
						</span>
					</button>
				</PopoverTrigger>
				<PopoverContent
					dir={isRTL ? "rtl" : "ltr"}
					data-profile-window="true"
					data-profile-submenu="true"
					data-theme-menu-list="true"
					side={isDesktop ? (isRTL ? "left" : "right") : "bottom"}
					align={isDesktop ? "start" : "center"}
					sideOffset={8}
					collisionPadding={12}
					className={panelSurfaceClass}
				>
					{panel}
				</PopoverContent>
			</Popover>
		);
	}

	const triggerButton =
		trigger === "icon" ? (
			<Button
				type="button"
				aria-label={t("header.theme")}
				variant="outline"
				size="icon"
				className="relative size-[34px] rounded-[12px] border-panel-border! bg-panel-surface text-panel-text"
			>
				<SwatchBook className="size-4" />
			</Button>
		) : (
			<Button
				type="button"
				variant="ghost"
				className="w-full justify-between"
			>
				{triggerLabel || t("header.theme")}
				<SwatchBook className="size-4" />
			</Button>
		);

	return (
		<DropdownMenu modal={false}>
			<DropdownMenuTrigger asChild>{triggerButton}</DropdownMenuTrigger>
			<DropdownMenuContent className={panelSurfaceClass}>
				{panel}
			</DropdownMenuContent>
		</DropdownMenu>
	);
};

export default ThemeSelector;

