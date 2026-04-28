import {
	Accordion,
	AccordionButton,
	AccordionIcon,
	AccordionItem,
	AccordionPanel,
	Alert,
	AlertDescription,
	AlertIcon,
	Badge,
	Box,
	Button,
	Divider,
	Flex,
	FormControl,
	FormHelperText,
	FormLabel,
	HStack,
	IconButton,
	Input,
	Select,
	SimpleGrid,
	Spinner,
	Stack,
	Switch,
	Text,
	VStack,
	useToast,
} from "@chakra-ui/react";
import {
	ArrowPathIcon,
	EyeIcon,
	PlusIcon,
	TrashIcon,
	XMarkIcon,
} from "@heroicons/react/24/outline";
import {
	type ChangeEvent,
	type DragEvent,
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import debounce from "lodash.debounce";
import { Rnd } from "react-rnd";
import { useTranslation } from "react-i18next";
import {
	getSubscriptionTemplateContent,
	type SubscriptionTemplateContentResponse,
	updateSubscriptionTemplateContent,
} from "service/settings";
import { generateErrorMessage, generateSuccessMessage } from "utils/toastHandler";

const TEMPLATE_KEY = "subscription_page_template";
const BUILDER_MARKER_PREFIX = "<!-- REBECCA_TEMPLATE_BUILDER_CONFIG:";
const BUILDER_MARKER_SUFFIX = "-->";
const BUILDER_CONFIG_SCRIPT_ID = "rb-builder-config";
const BUILDER_BG_IMAGE_SCRIPT_ID = "rb-builder-bg-image";
const DRAG_MIME = "application/x-rebecca-template-widget";

type WidgetSize = "half" | "full";
type WidgetType =
	| "usage_summary"
	| "username"
	| "status"
	| "online_status"
	| "expire_details"
	| "subscription_url"
	| "links"
	| "usage_chart"
	| "app_imports";

type BuilderWidget = {
	id: string;
	type: WidgetType;
	size: WidgetSize;
	bounds: WidgetBounds;
};

type RawBuilderWidget = {
	id?: unknown;
	type?: unknown;
	size?: unknown;
	bounds?: unknown;
	x?: unknown;
	y?: unknown;
	width?: unknown;
	height?: unknown;
};

type BuilderTemplatePayload = {
	version?: unknown;
	widgets?: RawBuilderWidget[];
	options?: unknown;
};

type WidgetBounds = {
	x: number;
	y: number;
	width: number;
	height: number;
};

type ConfigLinksOptions = {
	showConfigNames: boolean;
	enableQrModal: boolean;
};

type ChartOptions = {
	enableDateControls: boolean;
	showQuickRanges: boolean;
	showCalendar: boolean;
	defaultRangeDays: number;
};

type PreferencesOptions = {
	defaultLanguage: "browser" | "en" | "fa" | "ru" | "zh";
	defaultTheme: "system" | "light" | "dark";
};

type AppImportOs = "windows" | "macos" | "ios" | "android" | "linux";

type AppImportDeepLinkKey =
	| "v2rayng"
	| "singbox"
	| "v2box"
	| "streisand"
	| "nekobox"
	| "clash"
	| "shadowrocket"
	| "foxray"
	| "custom";

type AppImportApp = {
	id: string;
	label: string;
	recommended: boolean;
	supportedOS: AppImportOs[];
	deepLinkKey: AppImportDeepLinkKey;
	customDeepLinkTemplate?: string;
};

type AppImportsOptions = {
	showRecommendedFirst: boolean;
	showAllButtons: boolean;
	osOrder: AppImportOs[];
	apps: AppImportApp[];
};

type HeaderOverlayText = {
	id: string;
	text: string;
	x: number;
	y: number;
	color: string;
	fontSize: number;
	fontWeight: 400 | 500 | 600 | 700;
};

type BuilderOptions = {
	canvas: {
		width: number;
		height: number;
	};
	configLinks: ConfigLinksOptions;
	chart: ChartOptions;
	preferences: PreferencesOptions;
	appearance: {
		pageTitle: string;
		pageSubtitle: string;
		titlePlacement: "left" | "center" | "hidden";
		titleOffsetX: number;
		titleOffsetY: number;
		headerBackgroundLight: string;
		headerBackgroundDark: string;
		headerOpacity: number;
		headerTransparent: boolean;
		headerTexts: HeaderOverlayText[];
		backgroundMode: "solid" | "gradient" | "image";
		backgroundLight: string;
		backgroundDark: string;
		gradientLight: string;
		gradientDark: string;
		backgroundImageDataUrl: string | null;
		accentColor: string;
	};
	activity: {
		onlineThresholdMinutes: number;
	};
	appImports: AppImportsOptions;
};

type WidgetDef = {
	type: WidgetType;
	label: string;
	description: string;
	defaultSize: WidgetSize;
	preview: string;
};

type CreatorProps = {
	onSaved?: () => void;
};

type PreviewDevice = "desktop" | "tablet" | "mobile";

const WIDGETS: WidgetDef[] = [
	{
		type: "usage_summary",
		label: "Usage Summary",
		description: "Used, total and progress bar",
		defaultSize: "full",
		preview: "14.2 GB / 40 GB",
	},
	{
		type: "username",
		label: "Username",
		description: "Account username card",
		defaultSize: "half",
		preview: "demo-user",
	},
	{
		type: "status",
		label: "Status",
		description: "Status badge (active/limited/...)",
		defaultSize: "half",
		preview: "active",
	},
	{
		type: "online_status",
		label: "Online Status",
		description: "Online/offline + last online",
		defaultSize: "half",
		preview: "Online now / Last seen 2m ago",
	},
	{
		type: "expire_details",
		label: "Expire Details",
		description: "Remaining days, expire date, created at",
		defaultSize: "full",
		preview: "12 days left - 2026-03-01",
	},
	{
		type: "subscription_url",
		label: "Subscription URL",
		description: "Current subscription URL + copy",
		defaultSize: "full",
		preview: "https://panel/sub/...",
	},
	{
		type: "links",
		label: "Config Links",
		description: "Generated vmess/vless links",
		defaultSize: "full",
		preview: "vmess://..., vless://...",
	},
	{
		type: "usage_chart",
		label: "Usage Chart",
		description: "Loads usage data from usage API",
		defaultSize: "full",
		preview: "Last 14 days",
	},
	{
		type: "app_imports",
		label: "Add To Apps",
		description: "Direct import buttons for common clients",
		defaultSize: "full",
		preview: "v2rayNG, sing-box, Clash Verge...",
	},
];

const DEFAULT_LAYOUT: WidgetType[] = [
	"usage_summary",
	"username",
	"status",
	"online_status",
	"expire_details",
	"subscription_url",
	"links",
	"usage_chart",
	"app_imports",
];

const TYPE_SET = new Set<WidgetType>(WIDGETS.map((entry) => entry.type));

const DEFAULT_CANVAS_WIDTH = 1280;
const DEFAULT_CANVAS_HEIGHT = 860;
const MIN_CANVAS_WIDTH = 640;
const MAX_CANVAS_WIDTH = 3840;
const MIN_CANVAS_HEIGHT = 480;
const MAX_CANVAS_HEIGHT = 8000;
const MIN_WIDGET_WIDTH = 170;
const MIN_WIDGET_HEIGHT = 84;
const INTERACTION_GRID_SNAP = 8;
const CANVAS_PADDING = 16;
const CANVAS_AUTO_GROW_STEP = 120;
const MIN_CANVAS_SCALE = 0.72;
const OUTPUT_OVERLAP_GAP = 16;
const PREVIEW_DEVICES: Readonly<
	Record<
		PreviewDevice,
		{
			label: string;
			width: string;
			height: string;
		}
	>
> = {
	desktop: { label: "Desktop", width: "min(1320px, 100%)", height: "100%" },
	tablet: { label: "Tablet", width: "min(820px, 100%)", height: "100%" },
	mobile: { label: "Mobile", width: "min(390px, 100%)", height: "100%" },
};

const SETTINGS_CARD_RADIUS = "md";
const SETTINGS_CARD_PADDING = 3;
const SETTINGS_SECTION_GAP = 3;
const SETTINGS_CONTROL_SIZE = "sm";
const HEADER_TEXT_MAX_ITEMS = 16;
const HEADER_TEXT_MAX_LEN = 120;

const APP_IMPORT_OS_VALUES: AppImportOs[] = [
	"windows",
	"macos",
	"ios",
	"android",
	"linux",
];

const APP_IMPORT_DEEPLINK_KEYS: AppImportDeepLinkKey[] = [
	"v2rayng",
	"singbox",
	"v2box",
	"streisand",
	"nekobox",
	"clash",
	"shadowrocket",
	"foxray",
	"custom",
];

const APP_IMPORT_DEEPLINK_LABELS: Record<AppImportDeepLinkKey, string> = {
	v2rayng: "v2rayNG",
	singbox: "sing-box",
	v2box: "v2Box",
	streisand: "Streisand",
	nekobox: "NekoBox",
	clash: "Clash",
	shadowrocket: "Shadowrocket",
	foxray: "FoXray",
	custom: "Custom",
};

const APP_IMPORT_DEFAULT_APP_BY_KEY: Record<
	Exclude<AppImportDeepLinkKey, "custom">,
	{ label: string; supportedOS: AppImportOs[] }
> = {
	v2rayng: { label: "v2rayNG", supportedOS: ["android"] },
	singbox: { label: "sing-box", supportedOS: ["android", "ios", "macos", "windows", "linux"] },
	v2box: { label: "v2Box", supportedOS: ["ios"] },
	streisand: { label: "Streisand", supportedOS: ["ios"] },
	nekobox: { label: "NekoBox", supportedOS: ["android"] },
	clash: { label: "Clash", supportedOS: ["windows", "macos", "linux"] },
	shadowrocket: { label: "Shadowrocket", supportedOS: ["ios"] },
	foxray: { label: "FoXray", supportedOS: ["ios"] },
};

const DEFAULT_APP_IMPORT_APPS: AppImportApp[] = [
	{
		id: "v2rayng",
		label: "v2rayNG",
		recommended: true,
		supportedOS: ["android"],
		deepLinkKey: "v2rayng",
	},
	{
		id: "singbox",
		label: "sing-box",
		recommended: true,
		supportedOS: ["android", "ios", "macos", "windows", "linux"],
		deepLinkKey: "singbox",
	},
	{
		id: "v2box",
		label: "v2Box",
		recommended: true,
		supportedOS: ["ios"],
		deepLinkKey: "v2box",
	},
	{
		id: "streisand",
		label: "Streisand",
		recommended: true,
		supportedOS: ["ios"],
		deepLinkKey: "streisand",
	},
	{
		id: "nekobox",
		label: "NekoBox",
		recommended: false,
		supportedOS: ["android"],
		deepLinkKey: "nekobox",
	},
	{
		id: "clash",
		label: "Clash",
		recommended: false,
		supportedOS: ["windows", "macos", "linux"],
		deepLinkKey: "clash",
	},
	{
		id: "shadowrocket",
		label: "Shadowrocket",
		recommended: false,
		supportedOS: ["ios"],
		deepLinkKey: "shadowrocket",
	},
	{
		id: "foxray",
		label: "FoXray",
		recommended: false,
		supportedOS: ["ios"],
		deepLinkKey: "foxray",
	},
];

const APP_IMPORT_OS_LABEL_KEYS: Record<AppImportOs, string> = {
	windows: "settings.templates.osWindows",
	macos: "settings.templates.osMacos",
	ios: "settings.templates.osIos",
	android: "settings.templates.osAndroid",
	linux: "settings.templates.osLinux",
};

const WIDGET_MIN_DIMENSIONS: Readonly<
	Record<WidgetType, { width: number; height: number }>
> = {
	usage_summary: { width: 280, height: 150 },
	username: { width: 180, height: 96 },
	status: { width: 170, height: 92 },
	online_status: { width: 190, height: 96 },
	expire_details: { width: 340, height: 164 },
	subscription_url: { width: 260, height: 110 },
	links: { width: 300, height: 145 },
	usage_chart: { width: 320, height: 180 },
	app_imports: { width: 300, height: 150 },
};

const WIDGET_MAX_DIMENSIONS: Readonly<
	Partial<Record<WidgetType, { width: number; height: number }>>
> = {
	usage_summary: { width: 1200, height: 360 },
	username: { width: 620, height: 280 },
	status: { width: 520, height: 240 },
	online_status: { width: 620, height: 280 },
	expire_details: { width: 1200, height: 360 },
	subscription_url: { width: 1200, height: 260 },
	links: { width: 1200, height: 560 },
	usage_chart: { width: 1200, height: 620 },
	app_imports: { width: 1200, height: 560 },
};

const clamp = (value: number, min: number, max: number): number =>
	Math.max(min, Math.min(max, value));

const getPointerClientY = (event: {
	clientY?: number;
	touches?: ArrayLike<{ clientY: number }>;
	changedTouches?: ArrayLike<{ clientY: number }>;
}): number | null => {
	const touches = event.touches;
	if (touches && touches.length > 0) {
		return touches[0].clientY;
	}
	const changedTouches = event.changedTouches;
	if (changedTouches && changedTouches.length > 0) {
		return changedTouches[0].clientY;
	}
	return typeof event.clientY === "number" ? event.clientY : null;
};

const escapeRegExp = (value: string): string =>
	value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const isHexColor = (value: string): boolean =>
	/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);

const hexToRgba = (hex: string, alpha: number): string => {
	const raw = hex.replace("#", "");
	const normalized =
		raw.length === 3
			? raw
					.split("")
					.map((char) => char + char)
					.join("")
			: raw;
	if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
		return `rgba(15,23,42,${alpha})`;
	}
	const r = Number.parseInt(normalized.slice(0, 2), 16);
	const g = Number.parseInt(normalized.slice(2, 4), 16);
	const b = Number.parseInt(normalized.slice(4, 6), 16);
	return `rgba(${r},${g},${b},${alpha})`;
};

const createHeaderOverlayText = (
	seed?: Partial<HeaderOverlayText>,
): HeaderOverlayText => ({
	id:
		seed?.id && seed.id.trim()
			? slugifyAppId(seed.id, `header-text-${Date.now()}`)
			: `header-text-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
	text: (seed?.text || "New text").trim().slice(0, HEADER_TEXT_MAX_LEN),
	x:
		typeof seed?.x === "number" && Number.isFinite(seed.x)
			? clamp(Math.round(seed.x), 0, 860)
			: 10,
	y:
		typeof seed?.y === "number" && Number.isFinite(seed.y)
			? clamp(Math.round(seed.y), 0, 120)
			: 10,
	color:
		typeof seed?.color === "string" && isHexColor(seed.color)
			? seed.color
			: "#ffffff",
	fontSize:
		typeof seed?.fontSize === "number" && Number.isFinite(seed.fontSize)
			? clamp(Math.round(seed.fontSize), 10, 36)
			: 13,
	fontWeight:
		seed?.fontWeight === 400 ||
		seed?.fontWeight === 500 ||
		seed?.fontWeight === 600 ||
		seed?.fontWeight === 700
			? seed.fontWeight
			: 600,
});

const cloneDefaultAppImports = (): AppImportsOptions => ({
	showRecommendedFirst: DEFAULT_OPTIONS.appImports.showRecommendedFirst,
	showAllButtons: DEFAULT_OPTIONS.appImports.showAllButtons,
	osOrder: [...DEFAULT_OPTIONS.appImports.osOrder],
	apps: DEFAULT_OPTIONS.appImports.apps.map((app) => ({
		...app,
		supportedOS: [...app.supportedOS],
	})),
});

const slugifyAppId = (value: string, fallback: string): string => {
	const slug = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug || fallback;
};

const isAppImportDeepLinkKey = (value: unknown): value is AppImportDeepLinkKey =>
	typeof value === "string" &&
	APP_IMPORT_DEEPLINK_KEYS.includes(value as AppImportDeepLinkKey);

const normalizeAppImportOsValue = (value: unknown): AppImportOs | null => {
	if (typeof value !== "string") {
		return null;
	}
	const normalized = value.trim().toLowerCase();
	if (normalized === "windows" || normalized === "win") return "windows";
	if (
		normalized === "macos" ||
		normalized === "mac" ||
		normalized === "darwin" ||
		normalized === "osx" ||
		normalized === "mac os"
	)
		return "macos";
	if (
		normalized === "ios" ||
		normalized === "iphone" ||
		normalized === "ipad" ||
		normalized === "ipados"
	)
		return "ios";
	if (normalized === "android") return "android";
	if (normalized === "linux" || normalized === "gnu/linux") return "linux";
	return null;
};

const isAppImportOs = (value: unknown): value is AppImportOs =>
	normalizeAppImportOsValue(value) !== null;

const uniqueOsList = (items: AppImportOs[]): AppImportOs[] => {
	const seen = new Set<AppImportOs>();
	const result: AppImportOs[] = [];
	items.forEach((os) => {
		if (!seen.has(os)) {
			seen.add(os);
			result.push(os);
		}
	});
	return result;
};

const normalizeAppImportOsList = (
	candidate: unknown,
	fallback: AppImportOs[],
): AppImportOs[] => {
	if (!Array.isArray(candidate)) {
		return [...fallback];
	}
	const parsed = uniqueOsList(
		candidate
			.map((entry) => normalizeAppImportOsValue(entry))
			.filter((entry): entry is AppImportOs => Boolean(entry)),
	);
	return parsed.length ? parsed : [...fallback];
};

const normalizeAppImportOsOrder = (candidate: unknown): AppImportOs[] => {
	const fromInput = Array.isArray(candidate)
		? uniqueOsList(
				candidate
					.map((entry) => normalizeAppImportOsValue(entry))
					.filter((entry): entry is AppImportOs => Boolean(entry)),
		  )
		: [];
	const base = fromInput.length ? fromInput : [...APP_IMPORT_OS_VALUES];
	const remainder = APP_IMPORT_OS_VALUES.filter((os) => !base.includes(os));
	return [...base, ...remainder];
};

const defaultAppImportMeta = (
	key: AppImportDeepLinkKey,
): { label: string; supportedOS: AppImportOs[] } => {
	if (key === "custom") {
		return { label: "Custom App", supportedOS: ["android"] };
	}
	return {
		label: APP_IMPORT_DEFAULT_APP_BY_KEY[key].label,
		supportedOS: [...APP_IMPORT_DEFAULT_APP_BY_KEY[key].supportedOS],
	};
};

const serializeForInlineJsonScript = (value: unknown): string =>
	JSON.stringify(value)
		.replace(/</g, "\\u003c")
		.replace(/>/g, "\\u003e")
		.replace(/&/g, "\\u0026")
		.replace(/\u2028/g, "\\u2028")
		.replace(/\u2029/g, "\\u2029");

const extractScriptContentById = (content: string, id: string): string | null => {
	const pattern = new RegExp(
		`<script[^>]*\\bid=["']${escapeRegExp(id)}["'][^>]*>([\\s\\S]*?)<\\/script>`,
		"i",
	);
	const match = content.match(pattern);
	return match ? match[1].trim() : null;
};

const getWidgetMinDimensions = (type: WidgetType): { width: number; height: number } =>
	WIDGET_MIN_DIMENSIONS[type] || {
		width: MIN_WIDGET_WIDTH,
		height: MIN_WIDGET_HEIGHT,
	};

const getWidgetMaxDimensions = (
	type: WidgetType,
	canvasWidth: number,
	canvasHeight: number,
): { width: number; height: number } => {
	const fallback = {
		width: Math.max(MIN_WIDGET_WIDTH, Math.min(canvasWidth, 1200)),
		height: Math.max(MIN_WIDGET_HEIGHT, Math.min(canvasHeight, 620)),
	};
	const configured = WIDGET_MAX_DIMENSIONS[type];
	if (!configured) {
		return fallback;
	}
	return {
		width: Math.max(
			getWidgetMinDimensions(type).width,
			Math.min(canvasWidth, configured.width),
		),
		height: Math.max(
			getWidgetMinDimensions(type).height,
			Math.min(canvasHeight, configured.height),
		),
	};
};

const applyWidgetSizeConstraints = (
	type: WidgetType,
	bounds: WidgetBounds,
	canvasWidth: number,
	canvasHeight: number,
): WidgetBounds => {
	const min = getWidgetMinDimensions(type);
	const max = getWidgetMaxDimensions(type, canvasWidth, canvasHeight);
	return {
		...bounds,
		width: clamp(bounds.width, min.width, max.width),
		height: clamp(bounds.height, min.height, max.height),
	};
};

const getDefaultWidgetDimensions = (
	type: WidgetType,
	canvasWidth: number,
): { width: number; height: number } => {
	const halfWidth = Math.floor((canvasWidth - CANVAS_PADDING * 3) / 2);
	const fullWidth = canvasWidth - CANVAS_PADDING * 2;

	switch (type) {
		case "usage_summary":
			return { width: fullWidth, height: 170 };
		case "expire_details":
			return { width: fullWidth, height: 170 };
		case "subscription_url":
			return { width: fullWidth, height: 120 };
		case "links":
			return { width: fullWidth, height: 220 };
		case "usage_chart":
			return { width: fullWidth, height: 250 };
		case "app_imports":
			return { width: fullWidth, height: 210 };
		case "username":
		case "status":
		case "online_status":
			return { width: halfWidth, height: 136 };
		default:
			return { width: halfWidth, height: 140 };
	}
};

const clampBoundsToCanvas = (
	bounds: WidgetBounds,
	canvasWidth: number,
	canvasHeight: number,
): WidgetBounds => {
	const rawWidth = Number.isFinite(bounds.width) ? Math.round(bounds.width) : MIN_WIDGET_WIDTH;
	const rawHeight = Number.isFinite(bounds.height) ? Math.round(bounds.height) : MIN_WIDGET_HEIGHT;
	const safeWidth = clamp(rawWidth, MIN_WIDGET_WIDTH, canvasWidth);
	const safeHeight = clamp(rawHeight, MIN_WIDGET_HEIGHT, canvasHeight);
	const rawX = Number.isFinite(bounds.x) ? Math.round(bounds.x) : 0;
	const rawY = Number.isFinite(bounds.y) ? Math.round(bounds.y) : 0;
	const safeX = clamp(rawX, 0, Math.max(0, canvasWidth - safeWidth));
	const safeY = clamp(rawY, 0, Math.max(0, canvasHeight - safeHeight));

	return {
		x: safeX,
		y: safeY,
		width: safeWidth,
		height: safeHeight,
	};
};

const boundsOverlap = (a: WidgetBounds, b: WidgetBounds): boolean =>
	a.x < b.x + b.width &&
	a.x + a.width > b.x &&
	a.y < b.y + b.height &&
	a.y + a.height > b.y;

const clampOutputBounds = (
	type: WidgetType,
	bounds: WidgetBounds,
	canvasWidth: number,
	canvasHeight: number,
): WidgetBounds => {
	const constrained = applyWidgetSizeConstraints(
		type,
		bounds,
		canvasWidth,
		canvasHeight,
	);
	const width = clamp(Math.round(constrained.width), MIN_WIDGET_WIDTH, canvasWidth);
	const height = Math.max(MIN_WIDGET_HEIGHT, Math.round(constrained.height));
	return {
		x: clamp(Math.round(constrained.x), 0, Math.max(0, canvasWidth - width)),
		y: Math.max(0, Math.round(constrained.y)),
		width,
		height,
	};
};

const resolveOverlapsForOutput = (
	inputWidgets: BuilderWidget[],
	canvasWidth: number,
	canvasHeight: number,
	gapPx = OUTPUT_OVERLAP_GAP,
): BuilderWidget[] => {
	const byPlacementOrder = (a: BuilderWidget, b: BuilderWidget): number =>
		a.bounds.y - b.bounds.y ||
		a.bounds.x - b.bounds.x ||
		String(a.id).localeCompare(String(b.id));
	const isWideWidget = (bounds: WidgetBounds): boolean =>
		bounds.width >= canvasWidth * 0.82;

	const horizontalOverlapRatio = (a: WidgetBounds, b: WidgetBounds): number => {
		const overlap =
			Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
		if (overlap <= 0) {
			return 0;
		}
		const base = Math.max(1, Math.min(a.width, b.width));
		return overlap / base;
	};

	type OutputColumnGroup = {
		items: BuilderWidget[];
	};

	const sorted = [...inputWidgets]
		.map((widget) => ({
			...widget,
			bounds: clampOutputBounds(widget.type, widget.bounds, canvasWidth, canvasHeight),
		}))
		.sort(byPlacementOrder);

	const groups: OutputColumnGroup[] = [];
	for (const widget of sorted) {
		let targetGroup: OutputColumnGroup | null = null;
		let bestRatio = 0;

		if (!isWideWidget(widget.bounds)) {
			for (const group of groups) {
				const ratio = group.items.reduce((maxRatio, existing) => {
					if (isWideWidget(existing.bounds)) {
						return maxRatio;
					}
					return Math.max(
						maxRatio,
						horizontalOverlapRatio(widget.bounds, existing.bounds),
					);
				}, 0);
				if (ratio >= 0.6 && ratio > bestRatio) {
					bestRatio = ratio;
					targetGroup = group;
				}
			}
		}

		if (!targetGroup) {
			targetGroup = { items: [] };
			groups.push(targetGroup);
		}
		targetGroup.items.push(widget);
	}

	const columnStacked: BuilderWidget[] = [];
	for (const group of groups) {
		const ordered = [...group.items].sort(byPlacementOrder);
		let previousBottom = -Infinity;
		for (const widget of ordered) {
			const minY = Number.isFinite(previousBottom)
				? previousBottom + gapPx
				: widget.bounds.y;
			const nextY = Math.max(widget.bounds.y, minY);
			const nextBounds = {
				...widget.bounds,
				y: nextY,
			};
			columnStacked.push({
				...widget,
				bounds: nextBounds,
			});
			previousBottom = nextBounds.y + nextBounds.height;
		}
	}

	const placed: BuilderWidget[] = [];
	const globallyOrdered = [...columnStacked].sort(byPlacementOrder);

	for (const widget of globallyOrdered) {
		let candidate = { ...widget.bounds };
		let guard = 0;

		while (guard < 500) {
			const collisions = placed.filter((entry) => boundsOverlap(candidate, entry.bounds));
			if (collisions.length === 0) {
				break;
			}
			const pushDownTo = Math.max(
				...collisions.map((entry) => entry.bounds.y + entry.bounds.height + gapPx),
			);
			candidate = {
				...candidate,
				y: pushDownTo > candidate.y ? pushDownTo : candidate.y + gapPx,
			};
			guard += 1;
		}

		placed.push({
			...widget,
			bounds: candidate,
		});
	}

	return placed.sort(byPlacementOrder);
};

const widgetsHaveAnyOverlap = (
	inputWidgets: BuilderWidget[],
	canvasWidth: number,
	canvasHeight: number,
): boolean => {
	const normalized = inputWidgets.map((widget) =>
		clampWidgetBoundsToCanvas(widget.type, widget.bounds, canvasWidth, canvasHeight),
	);
	for (let i = 0; i < normalized.length; i += 1) {
		for (let j = i + 1; j < normalized.length; j += 1) {
			if (boundsOverlap(normalized[i], normalized[j])) {
				return true;
			}
		}
	}
	return false;
};

const buildDefaultBoundsByType = (
	layout: WidgetType[],
	canvasWidth: number,
	canvasHeight: number,
): Record<WidgetType, WidgetBounds> => {
	const positions = {} as Record<WidgetType, WidgetBounds>;
	const leftColX = CANVAS_PADDING;
	const colWidth = Math.floor((canvasWidth - CANVAS_PADDING * 3) / 2);
	const rightColX = leftColX + colWidth + CANVAS_PADDING;
	let cursorY = CANVAS_PADDING;
	let rowHeight = 0;
	let rowIndex = 0;

	for (const type of layout) {
		const { width, height } = getDefaultWidgetDimensions(type, canvasWidth);

		const isFull = width >= canvasWidth - CANVAS_PADDING * 2 - 4;
		if (isFull) {
			if (rowIndex > 0) {
				cursorY += rowHeight + CANVAS_PADDING;
				rowHeight = 0;
				rowIndex = 0;
			}
			positions[type] = clampBoundsToCanvas(
				{
					x: leftColX,
					y: cursorY,
					width,
					height,
				},
				canvasWidth,
				canvasHeight,
			);
			cursorY += height + CANVAS_PADDING;
			continue;
		}

		const x = rowIndex % 2 === 0 ? leftColX : rightColX;
		positions[type] = clampBoundsToCanvas(
			{
				x,
				y: cursorY,
				width,
				height,
			},
			canvasWidth,
			canvasHeight,
		);
		rowHeight = Math.max(rowHeight, height);
		rowIndex += 1;
		if (rowIndex % 2 === 0) {
			cursorY += rowHeight + CANVAS_PADDING;
			rowHeight = 0;
			rowIndex = 0;
		}
	}

	return positions;
};

const DEFAULT_OPTIONS: BuilderOptions = {
	canvas: {
		width: DEFAULT_CANVAS_WIDTH,
		height: DEFAULT_CANVAS_HEIGHT,
	},
	configLinks: {
		showConfigNames: true,
		enableQrModal: true,
	},
	chart: {
		enableDateControls: true,
		showQuickRanges: true,
		showCalendar: true,
		defaultRangeDays: 30,
	},
	preferences: {
		defaultLanguage: "browser",
		defaultTheme: "system",
	},
	appearance: {
		pageTitle: "Subscription Dashboard",
		pageSubtitle: "Manage your subscription links and usage",
		titlePlacement: "left",
		titleOffsetX: 0,
		titleOffsetY: 0,
		headerBackgroundLight: "#0f172a",
		headerBackgroundDark: "#0b1227",
		headerOpacity: 92,
		headerTransparent: true,
		headerTexts: [],
		backgroundMode: "gradient",
		backgroundLight: "#f4f7fb",
		backgroundDark: "#0f172a",
		gradientLight: "radial-gradient(circle at 10% -5%, #dbeafe, #f4f7fb 45%)",
		gradientDark: "radial-gradient(circle at 12% -8%, #1e3a8a, #0f172a 48%)",
		backgroundImageDataUrl: null,
		accentColor: "#2563eb",
	},
	activity: {
		onlineThresholdMinutes: 5,
	},
	appImports: {
		showRecommendedFirst: true,
		showAllButtons: true,
		osOrder: [...APP_IMPORT_OS_VALUES],
		apps: DEFAULT_APP_IMPORT_APPS.map((app) => ({
			...app,
			supportedOS: [...app.supportedOS],
		})),
	},
};

const buildWidgetTemplate = (
	type: WidgetType,
	options: BuilderOptions,
): string => {
	if (type === "usage_summary") {
		return `
<h3 data-i18n="usageSummaryTitle">Usage Summary</h3>
{% set rb_total_limit = user.data_limit or 0 %}
{% set rb_usage_percent = ((user.used_traffic / rb_total_limit) * 100) if rb_total_limit > 0 else 0 %}
<div class="rb-metrics">
	<div><span data-i18n="usedLabel">Used</span><strong>{{ user.used_traffic | bytesformat }}</strong></div>
	<div><span data-i18n="totalLabel">Total</span><strong>{% if user.data_limit %}{{ user.data_limit | bytesformat }}{% else %}∞{% endif %}</strong></div>
	<div><span data-i18n="progressLabel">Progress</span><strong>{% if rb_total_limit > 0 %}{{ rb_usage_percent | round(0, "floor") | int }}%{% else %}∞{% endif %}</strong></div>
</div>
<div class="rb-progress"><span style="width:{% if rb_total_limit > 0 %}{{ rb_usage_percent | round(0, "floor") | int }}{% else %}0{% endif %}%"></span></div>`;
	}

	if (type === "username") {
		return `
<h3 data-i18n="usernameTitle">Username</h3>
<p class="rb-value rb-username-value">{{ user.username }}</p>`;
	}

	if (type === "status") {
		return `
<h3 data-i18n="statusTitle">Status</h3>
<p><span class="rb-status rb-status-{{ user.status.value }}">{{ user.status.value }}</span></p>`;
	}

	if (type === "online_status") {
		return `
<h3 data-i18n="onlineStatusTitle">Online Status</h3>
<div class="rb-online" data-online-card data-online-at="{% if user.online_at %}{{ user.online_at.isoformat() }}{% endif %}">
	<p class="rb-value"><span class="rb-online-pill" data-online-pill data-i18n="offlineNow">Offline</span></p>
	<p class="rb-foot" data-online-last data-hide-on="mini" data-i18n="neverOnline">No online activity yet.</p>
</div>`;
	}

	if (type === "expire_details") {
		return `
<h3 data-i18n="expireDetailsTitle">Expiration Details</h3>
<div class="rb-kv" data-expire-card data-expire-ts="{% if user.expire %}{{ user.expire }}{% endif %}" data-created-iso="{% if user.created_at %}{{ user.created_at.isoformat() }}{% endif %}">
	<div class="rb-kv-days"><span data-i18n="daysLeftLabel">Days Left</span><strong data-expire-days>-</strong></div>
	<div class="rb-kv-expire" data-hide-on="mini"><span data-i18n="expireAtLabel">Expire At</span><strong data-expire-date>-</strong></div>
	<div class="rb-kv-created" data-hide-on="mini"><span data-i18n="createdAtLabel">Created At</span><strong data-created-at>-</strong></div>
</div>
<p class="rb-foot" data-expire-meta data-hide-on="mini">-</p>`;
	}

	if (type === "subscription_url") {
		return `
<h3 data-i18n="subscriptionUrlTitle">Subscription URL</h3>
<div class="rb-row">
	<input class="rb-input" data-current-url data-hide-on="mini" readonly>
	<button class="rb-btn" data-copy-current-url data-copy-label="Copy URL" data-i18n="copyUrlButton">Copy URL</button>
</div>`;
	}

	if (type === "links") {
		const copyIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V6a2 2 0 0 1 2-2h9"></path></svg>`;
		const qrIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h6v6H4z"></path><path d="M14 4h6v6h-6z"></path><path d="M4 14h6v6H4z"></path><path d="M14 14h2v2h-2z"></path><path d="M18 14h2v2h-2z"></path><path d="M14 18h2v2h-2z"></path><path d="M18 18h2v2h-2z"></path></svg>`;
		const qrButton = options.configLinks.enableQrModal
			? `<button class="rb-btn rb-icon-btn" data-open-config-qr data-hide-on="mini" data-copy-label="QR" data-i18n-title="qrButton" title="QR" aria-label="QR"><span class="rb-sr" data-i18n="qrButton">QR</span>${qrIcon}</button>`
			: "";

		return `
<h3 data-i18n="configLinksTitle">Config Links</h3>
{% if user.links %}
<ul class="rb-list" data-config-list>
	{% for link in user.links %}
	<li class="rb-config-item" data-config-link="{{ link }}" data-config-index="{{ loop.index0 }}">
		<div class="rb-config-row">
			<span class="rb-config-name" data-config-name>Config {{ loop.index }}</span>
			<div class="rb-config-actions">
				<button class="rb-btn rb-icon-btn" data-copy-target="{{ link }}" data-copy-icon="1" data-copy-label="Copy" data-i18n-title="copyButton" title="Copy" aria-label="Copy"><span class="rb-sr" data-i18n="copyButton">Copy</span>${copyIcon}</button>
				${qrButton}
			</div>
		</div>
	</li>
	{% endfor %}
</ul>
{% else %}
<p class="rb-empty" data-i18n="noLinks">No links available.</p>
{% endif %}`;
	}

	if (type === "usage_chart") {
		const quickRanges = options.chart.showQuickRanges
			? `<div class="rb-ranges">
	<button class="rb-btn rb-range-btn" data-range-days="7">7D</button>
	<button class="rb-btn rb-range-btn" data-range-days="14">14D</button>
	<button class="rb-btn rb-range-btn" data-range-days="30">30D</button>
	<button class="rb-btn rb-range-btn" data-range-days="90">90D</button>
</div>`
			: "";

		const calendar = options.chart.showCalendar
			? `<div class="rb-calendar">
	<input class="rb-input rb-date-input" type="date" data-range-start>
	<input class="rb-input rb-date-input" type="date" data-range-end>
	<button class="rb-btn" data-apply-range data-i18n="applyButton">Apply</button>
</div>`
			: "";

		const controls = options.chart.enableDateControls
			? `<div class="rb-chart-controls" data-hide-on="mini">${quickRanges}${calendar}</div>`
			: "";

		return `
<h3 data-i18n="usageChartTitle">Usage Chart</h3>
${controls}
<div class="rb-chart" data-usage-chart data-default-days="${options.chart.defaultRangeDays}">
	<p class="rb-empty" data-i18n="loadingUsage">Loading usage data...</p>
</div>`;
	}

	if (type === "app_imports") {
		return `
<h3 data-i18n="appImportsTitle">Add To Apps</h3>
<p class="rb-empty" data-hide-on="mini" data-i18n="appImportsHint">Tap an app to import this subscription directly.</p>
	<div class="rb-app-imports" data-app-imports>
		<div class="rb-app-tabs" data-app-tabs role="tablist"></div>
		<div class="rb-app-grid" data-app-grid></div>
		<p class="rb-empty" data-app-empty data-i18n="noAppsSelected" hidden>No app button is enabled.</p>
</div>`;
	}

	return "";
};

const createId = (): string => {
	if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
		return globalThis.crypto.randomUUID();
	}
	return `widget-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
};

const createWidget = (
	type: WidgetType,
	canvasWidth: number,
	canvasHeight: number,
	bounds?: WidgetBounds,
): BuilderWidget => ({
	id: createId(),
	type,
	size: WIDGETS.find((entry) => entry.type === type)?.defaultSize ?? "half",
	bounds: clampBoundsToCanvas(
		applyWidgetSizeConstraints(
			type,
			bounds || {
				x: CANVAS_PADDING,
				y: CANVAS_PADDING,
				...getDefaultWidgetDimensions(type, canvasWidth),
			},
			canvasWidth,
			canvasHeight,
		),
		canvasWidth,
		canvasHeight,
	),
});

const clampWidgetBoundsToCanvas = (
	type: WidgetType,
	bounds: WidgetBounds,
	canvasWidth: number,
	canvasHeight: number,
): WidgetBounds =>
	clampBoundsToCanvas(
		applyWidgetSizeConstraints(type, bounds, canvasWidth, canvasHeight),
		canvasWidth,
		canvasHeight,
	);

const defaultWidgets = (
	canvasWidth = DEFAULT_CANVAS_WIDTH,
	canvasHeight = DEFAULT_CANVAS_HEIGHT,
): BuilderWidget[] => {
	const byType = buildDefaultBoundsByType(DEFAULT_LAYOUT, canvasWidth, canvasHeight);
	return DEFAULT_LAYOUT.map((type) =>
		createWidget(type, canvasWidth, canvasHeight, byType[type]),
	);
};

const isWidgetType = (value: unknown): value is WidgetType =>
	typeof value === "string" && TYPE_SET.has(value as WidgetType);

const normalizeOptions = (raw: unknown): BuilderOptions => {
	const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
	const canvasRaw =
		value.canvas && typeof value.canvas === "object"
			? (value.canvas as Record<string, unknown>)
			: {};
	const configRaw =
		value.configLinks && typeof value.configLinks === "object"
			? (value.configLinks as Record<string, unknown>)
			: {};
	const chartRaw =
		value.chart && typeof value.chart === "object"
			? (value.chart as Record<string, unknown>)
			: {};
	const prefRaw =
		value.preferences && typeof value.preferences === "object"
			? (value.preferences as Record<string, unknown>)
			: {};
	const appearanceRaw =
		value.appearance && typeof value.appearance === "object"
			? (value.appearance as Record<string, unknown>)
			: {};
	const activityRaw =
		value.activity && typeof value.activity === "object"
			? (value.activity as Record<string, unknown>)
			: {};
	const appImportsRaw =
		value.appImports && typeof value.appImports === "object"
			? (value.appImports as Record<string, unknown>)
			: {};

	const defaultRangeDays = Number(chartRaw.defaultRangeDays);
	const normalizedRangeDays = Number.isFinite(defaultRangeDays)
		? Math.min(120, Math.max(1, Math.round(defaultRangeDays)))
		: DEFAULT_OPTIONS.chart.defaultRangeDays;

	const defaultLanguage = prefRaw.defaultLanguage;
	const normalizedLanguage =
		defaultLanguage === "en" ||
		defaultLanguage === "fa" ||
		defaultLanguage === "ru" ||
		defaultLanguage === "zh" ||
		defaultLanguage === "browser"
			? defaultLanguage
			: DEFAULT_OPTIONS.preferences.defaultLanguage;

	const defaultTheme = prefRaw.defaultTheme;
	const normalizedTheme =
		defaultTheme === "system" || defaultTheme === "light" || defaultTheme === "dark"
			? defaultTheme
			: DEFAULT_OPTIONS.preferences.defaultTheme;

	const normalizeString = (candidate: unknown, fallback: string, maxLength = 500): string => {
		if (typeof candidate !== "string") {
			return fallback;
		}
		const trimmed = candidate.trim();
		if (!trimmed) {
			return fallback;
		}
		return trimmed.slice(0, maxLength);
	};

	const normalizeHexColor = (candidate: unknown, fallback: string): string => {
		const value = normalizeString(candidate, fallback, 32);
		return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value) ? value : fallback;
	};

	const backgroundMode = appearanceRaw.backgroundMode;
	const normalizedBackgroundMode =
		backgroundMode === "solid" || backgroundMode === "gradient" || backgroundMode === "image"
			? backgroundMode
			: DEFAULT_OPTIONS.appearance.backgroundMode;
	const titlePlacement = appearanceRaw.titlePlacement;
	const normalizedTitlePlacement =
		titlePlacement === "left" ||
		titlePlacement === "center" ||
		titlePlacement === "hidden"
			? titlePlacement
			: DEFAULT_OPTIONS.appearance.titlePlacement;

	const backgroundImageDataUrl =
		typeof appearanceRaw.backgroundImageDataUrl === "string" &&
		appearanceRaw.backgroundImageDataUrl.startsWith("data:image/")
			? appearanceRaw.backgroundImageDataUrl
			: DEFAULT_OPTIONS.appearance.backgroundImageDataUrl;
	const titleOffsetXRaw = Number(appearanceRaw.titleOffsetX);
	const titleOffsetYRaw = Number(appearanceRaw.titleOffsetY);
	const normalizedTitleOffsetX = Number.isFinite(titleOffsetXRaw)
		? Math.min(180, Math.max(-180, Math.round(titleOffsetXRaw)))
		: DEFAULT_OPTIONS.appearance.titleOffsetX;
	const normalizedTitleOffsetY = Number.isFinite(titleOffsetYRaw)
		? Math.min(120, Math.max(-80, Math.round(titleOffsetYRaw)))
		: DEFAULT_OPTIONS.appearance.titleOffsetY;
	const headerOpacityRaw = Number(appearanceRaw.headerOpacity);
	const normalizedHeaderOpacity = Number.isFinite(headerOpacityRaw)
		? clamp(Math.round(headerOpacityRaw), 0, 100)
		: DEFAULT_OPTIONS.appearance.headerOpacity;
	const normalizedHeaderTransparent =
		typeof appearanceRaw.headerTransparent === "boolean"
			? appearanceRaw.headerTransparent
			: DEFAULT_OPTIONS.appearance.headerTransparent;
	const headerTextRawList = Array.isArray(appearanceRaw.headerTexts)
		? appearanceRaw.headerTexts.slice(0, HEADER_TEXT_MAX_ITEMS)
		: [];
	const normalizedHeaderTexts = headerTextRawList
		.map((entry, index) => {
			if (!entry || typeof entry !== "object") {
				return null;
			}
			const raw = entry as Record<string, unknown>;
			const text = normalizeString(raw.text, "", HEADER_TEXT_MAX_LEN);
			if (!text) {
				return null;
			}
			const id = slugifyAppId(
				normalizeString(raw.id, `header-text-${index + 1}`, 64),
				`header-text-${index + 1}`,
			);
			const xRaw = Number(raw.x);
			const yRaw = Number(raw.y);
			const fontSizeRaw = Number(raw.fontSize);
			const fontWeightRaw = Number(raw.fontWeight);
			const color = normalizeHexColor(raw.color, "#ffffff");
			const fontWeight =
				fontWeightRaw === 400 ||
				fontWeightRaw === 500 ||
				fontWeightRaw === 600 ||
				fontWeightRaw === 700
					? (fontWeightRaw as 400 | 500 | 600 | 700)
					: 600;
			return createHeaderOverlayText({
				id,
				text,
				x: Number.isFinite(xRaw) ? clamp(Math.round(xRaw), 0, 860) : 10,
				y: Number.isFinite(yRaw) ? clamp(Math.round(yRaw), 0, 120) : 10,
				color,
				fontSize: Number.isFinite(fontSizeRaw)
					? clamp(Math.round(fontSizeRaw), 10, 36)
					: 13,
				fontWeight,
			});
		})
		.filter((item): item is HeaderOverlayText => Boolean(item));

	const onlineThresholdMinutes = Number(activityRaw.onlineThresholdMinutes);
	const normalizedOnlineThresholdMinutes = Number.isFinite(onlineThresholdMinutes)
		? Math.min(1440, Math.max(1, Math.round(onlineThresholdMinutes)))
		: DEFAULT_OPTIONS.activity.onlineThresholdMinutes;

	const canvasWidthRaw = Number(canvasRaw.width);
	const canvasHeightRaw = Number(canvasRaw.height);
	const normalizedCanvasWidth = Number.isFinite(canvasWidthRaw)
		? Math.min(MAX_CANVAS_WIDTH, Math.max(MIN_CANVAS_WIDTH, Math.round(canvasWidthRaw)))
		: DEFAULT_OPTIONS.canvas.width;
	const normalizedCanvasHeight = Number.isFinite(canvasHeightRaw)
		? Math.min(MAX_CANVAS_HEIGHT, Math.max(MIN_CANVAS_HEIGHT, Math.round(canvasHeightRaw)))
		: DEFAULT_OPTIONS.canvas.height;
	const defaultAppImports = cloneDefaultAppImports();
	const normalizedShowRecommendedFirst =
		typeof appImportsRaw.showRecommendedFirst === "boolean"
			? appImportsRaw.showRecommendedFirst
			: defaultAppImports.showRecommendedFirst;
	const normalizedShowAllButtons =
		typeof appImportsRaw.showAllButtons === "boolean"
			? appImportsRaw.showAllButtons
			: defaultAppImports.showAllButtons;
	const normalizedOsOrder = normalizeAppImportOsOrder(appImportsRaw.osOrder);
	const appRawList = Array.isArray(appImportsRaw.apps)
		? appImportsRaw.apps.slice(0, 64)
		: [];
	const parsedApps: AppImportApp[] = appRawList
		.map((candidate, index) => {
			if (!candidate || typeof candidate !== "object") {
				return null;
			}
			const appRaw = candidate as Record<string, unknown>;
			const deepLinkKey = isAppImportDeepLinkKey(appRaw.deepLinkKey)
				? appRaw.deepLinkKey
				: "v2rayng";
			const defaults = defaultAppImportMeta(deepLinkKey);
			const label = normalizeString(appRaw.label, defaults.label, 80);
			const idSeed = normalizeString(
				appRaw.id,
				label || `${deepLinkKey}-${index + 1}`,
				80,
			);
			const id = slugifyAppId(idSeed, `${deepLinkKey}-${index + 1}`);
			const supportedOS = normalizeAppImportOsList(
				appRaw.supportedOS,
				defaults.supportedOS,
			);
			const recommended =
				typeof appRaw.recommended === "boolean" ? appRaw.recommended : false;
			const customDeepLinkTemplate =
				deepLinkKey === "custom"
					? normalizeString(appRaw.customDeepLinkTemplate, "", 500)
					: "";
			return {
				id,
				label,
				recommended,
				supportedOS,
				deepLinkKey,
				...(deepLinkKey === "custom" && customDeepLinkTemplate
					? { customDeepLinkTemplate }
					: {}),
			} as AppImportApp;
		})
		.filter((entry): entry is AppImportApp => Boolean(entry));
	const appSource =
		parsedApps.length > 0
			? parsedApps
			: defaultAppImports.apps.map((app) => ({
					...app,
					supportedOS: [...app.supportedOS],
			  }));
	const usedIds = new Map<string, number>();
	const normalizedApps = appSource.map((app, index) => {
		const baseId = slugifyAppId(app.id || app.label, `app-${index + 1}`);
		const count = usedIds.get(baseId) ?? 0;
		usedIds.set(baseId, count + 1);
		const uniqueId = count === 0 ? baseId : `${baseId}-${count + 1}`;
		return {
			...app,
			id: uniqueId,
			supportedOS: normalizeAppImportOsList(app.supportedOS, ["android"]),
		};
	});

	return {
		canvas: {
			width: normalizedCanvasWidth,
			height: normalizedCanvasHeight,
		},
		configLinks: {
			showConfigNames:
				typeof configRaw.showConfigNames === "boolean"
					? configRaw.showConfigNames
					: DEFAULT_OPTIONS.configLinks.showConfigNames,
			enableQrModal:
				typeof configRaw.enableQrModal === "boolean"
					? configRaw.enableQrModal
					: DEFAULT_OPTIONS.configLinks.enableQrModal,
		},
		chart: {
			enableDateControls:
				typeof chartRaw.enableDateControls === "boolean"
					? chartRaw.enableDateControls
					: DEFAULT_OPTIONS.chart.enableDateControls,
			showQuickRanges:
				typeof chartRaw.showQuickRanges === "boolean"
					? chartRaw.showQuickRanges
					: DEFAULT_OPTIONS.chart.showQuickRanges,
			showCalendar:
				typeof chartRaw.showCalendar === "boolean"
					? chartRaw.showCalendar
					: DEFAULT_OPTIONS.chart.showCalendar,
			defaultRangeDays: normalizedRangeDays,
		},
		preferences: {
			defaultLanguage: normalizedLanguage,
			defaultTheme: normalizedTheme,
		},
		appearance: {
			pageTitle: normalizeString(
				appearanceRaw.pageTitle,
				DEFAULT_OPTIONS.appearance.pageTitle,
				120,
			),
			pageSubtitle: normalizeString(
				appearanceRaw.pageSubtitle,
				DEFAULT_OPTIONS.appearance.pageSubtitle,
				220,
			),
			titlePlacement: normalizedTitlePlacement,
			titleOffsetX: normalizedTitleOffsetX,
			titleOffsetY: normalizedTitleOffsetY,
			headerBackgroundLight: normalizeHexColor(
				appearanceRaw.headerBackgroundLight,
				DEFAULT_OPTIONS.appearance.headerBackgroundLight,
			),
			headerBackgroundDark: normalizeHexColor(
				appearanceRaw.headerBackgroundDark,
				DEFAULT_OPTIONS.appearance.headerBackgroundDark,
			),
			headerOpacity: normalizedHeaderOpacity,
			headerTransparent: normalizedHeaderTransparent,
			headerTexts: normalizedHeaderTexts,
			backgroundMode: normalizedBackgroundMode,
			backgroundLight: normalizeHexColor(
				appearanceRaw.backgroundLight,
				DEFAULT_OPTIONS.appearance.backgroundLight,
			),
			backgroundDark: normalizeHexColor(
				appearanceRaw.backgroundDark,
				DEFAULT_OPTIONS.appearance.backgroundDark,
			),
			gradientLight: normalizeString(
				appearanceRaw.gradientLight,
				DEFAULT_OPTIONS.appearance.gradientLight,
				500,
			),
			gradientDark: normalizeString(
				appearanceRaw.gradientDark,
				DEFAULT_OPTIONS.appearance.gradientDark,
				500,
			),
			backgroundImageDataUrl,
			accentColor: normalizeHexColor(
				appearanceRaw.accentColor,
				DEFAULT_OPTIONS.appearance.accentColor,
			),
		},
		activity: {
			onlineThresholdMinutes: normalizedOnlineThresholdMinutes,
		},
		appImports: {
			showRecommendedFirst: normalizedShowRecommendedFirst,
			showAllButtons: normalizedShowAllButtons,
			osOrder: normalizedOsOrder,
			apps: normalizedApps,
		},
	};
};

const parseBuilderPayload = (
	payload: BuilderTemplatePayload,
	backgroundImageDataUrl?: string | null,
): { widgets: BuilderWidget[] | null; options: BuilderOptions; isBuilder: boolean } => {
	const options = normalizeOptions(payload.options);
	if (backgroundImageDataUrl && backgroundImageDataUrl.startsWith("data:image/")) {
		options.appearance.backgroundImageDataUrl = backgroundImageDataUrl;
	}
	if (!Array.isArray(payload.widgets)) {
		return { widgets: null, options, isBuilder: true };
	}
	const defaultByType = buildDefaultBoundsByType(
		DEFAULT_LAYOUT,
		options.canvas.width,
		options.canvas.height,
	);
	const widgets = payload.widgets
		.map((entry, index) => {
			if (!isWidgetType(entry.type)) {
				return null;
			}
			const rawBounds =
				entry.bounds && typeof entry.bounds === "object"
					? (entry.bounds as Record<string, unknown>)
					: null;
			const fallback = defaultByType[entry.type] || {
				x: CANVAS_PADDING + index * 10,
				y: CANVAS_PADDING + index * 10,
				...getDefaultWidgetDimensions(entry.type, options.canvas.width),
			};
			const parsedBounds = clampWidgetBoundsToCanvas(
				entry.type,
				{
					x: Number(rawBounds?.x ?? entry.x ?? fallback.x),
					y: Number(rawBounds?.y ?? entry.y ?? fallback.y),
					width: Number(rawBounds?.width ?? entry.width ?? fallback.width),
					height: Number(rawBounds?.height ?? entry.height ?? fallback.height),
				},
				options.canvas.width,
				options.canvas.height,
			);
			return {
				id:
					typeof entry.id === "string" && entry.id.trim()
						? entry.id.trim()
						: createId(),
				type: entry.type,
				size: entry.size === "full" ? "full" : "half",
				bounds: parsedBounds,
			} as BuilderWidget;
		})
		.filter((entry): entry is BuilderWidget => entry !== null);
	return widgets.length > 0
		? { widgets, options, isBuilder: true }
		: { widgets: null, options, isBuilder: true };
};

const parseBuilderTemplate = (
	content: string,
): { widgets: BuilderWidget[] | null; options: BuilderOptions; isBuilder: boolean } => {
	const configScript = extractScriptContentById(content, BUILDER_CONFIG_SCRIPT_ID);
	if (configScript) {
		try {
			const payload = JSON.parse(configScript) as BuilderTemplatePayload;
			const bgScript = extractScriptContentById(content, BUILDER_BG_IMAGE_SCRIPT_ID);
			let backgroundImageDataUrl: string | null = null;
			if (bgScript) {
				try {
					const parsedBg = JSON.parse(bgScript) as unknown;
					if (typeof parsedBg === "string" && parsedBg.startsWith("data:image/")) {
						backgroundImageDataUrl = parsedBg;
					}
				} catch {
					backgroundImageDataUrl = null;
				}
			}
			return parseBuilderPayload(payload, backgroundImageDataUrl);
		} catch {
			return { widgets: null, options: DEFAULT_OPTIONS, isBuilder: true };
		}
	}

	const start = content.indexOf(BUILDER_MARKER_PREFIX);
	if (start < 0) {
		return { widgets: null, options: DEFAULT_OPTIONS, isBuilder: false };
	}
	const end = content.indexOf(BUILDER_MARKER_SUFFIX, start + BUILDER_MARKER_PREFIX.length);
	if (end < 0) {
		return { widgets: null, options: DEFAULT_OPTIONS, isBuilder: false };
	}
	const raw = content.slice(start + BUILDER_MARKER_PREFIX.length, end).trim();
	if (!raw) {
		return { widgets: null, options: DEFAULT_OPTIONS, isBuilder: true };
	}
	try {
		const payload = JSON.parse(raw) as BuilderTemplatePayload;
		return parseBuilderPayload(payload);
	} catch {
		return { widgets: null, options: DEFAULT_OPTIONS, isBuilder: true };
	}
};

const buildTemplateHtml = (widgets: BuilderWidget[], options: BuilderOptions): string => {
	const canvasWidth = Math.min(
		MAX_CANVAS_WIDTH,
		Math.max(MIN_CANVAS_WIDTH, Math.round(options.canvas.width)),
	);
	const canvasHeight = Math.min(
		MAX_CANVAS_HEIGHT,
		Math.max(MIN_CANVAS_HEIGHT, Math.round(options.canvas.height)),
	);
	const optionsWithImage: BuilderOptions = {
		...options,
		appearance: {
			...options.appearance,
			backgroundImageDataUrl: options.appearance.backgroundImageDataUrl || null,
		},
	};
	const boundedWidgets = widgets.map((widget) => ({
		...widget,
		bounds: clampWidgetBoundsToCanvas(
			widget.type,
			widget.bounds,
			canvasWidth,
			canvasHeight,
		),
	}));
	const normalizedWidgets = resolveOverlapsForOutput(
		boundedWidgets.map((widget) => ({
			...widget,
			bounds: clampOutputBounds(widget.type, widget.bounds, canvasWidth, canvasHeight),
		})),
		canvasWidth,
		canvasHeight,
	);
	const outputLayoutHeight = Math.max(
		canvasHeight,
		normalizedWidgets.reduce(
			(maxHeight, widget) => Math.max(maxHeight, widget.bounds.y + widget.bounds.height),
			0,
		) + CANVAS_PADDING,
	);

	const optionsForEmbeddedConfig: BuilderOptions = {
		...optionsWithImage,
		appearance: {
			...optionsWithImage.appearance,
			backgroundImageDataUrl: null,
		},
	};
	const builderConfigPayload: BuilderTemplatePayload = {
		version: 5,
		widgets: boundedWidgets.map((widget) => ({
			id: widget.id,
			type: widget.type,
			size: widget.size,
			bounds: clampWidgetBoundsToCanvas(
				widget.type,
				widget.bounds,
				canvasWidth,
				canvasHeight,
			),
		})),
		options: optionsForEmbeddedConfig,
	};
	const builderConfigScript = `<script id="${BUILDER_CONFIG_SCRIPT_ID}" type="application/json">${serializeForInlineJsonScript(builderConfigPayload)}</script>`;
	const builderBgImageScript = optionsWithImage.appearance.backgroundImageDataUrl
		? `<script id="${BUILDER_BG_IMAGE_SCRIPT_ID}" type="application/json">${serializeForInlineJsonScript(optionsWithImage.appearance.backgroundImageDataUrl)}</script>`
		: "";

	const scriptConfig = serializeForInlineJsonScript(optionsWithImage);
	const sections = normalizedWidgets
		.map((widget, index) => {
			const bounds = clampOutputBounds(
				widget.type,
				widget.bounds,
				canvasWidth,
				canvasHeight,
			);
			const min = getWidgetMinDimensions(widget.type);
			const max = getWidgetMaxDimensions(widget.type, canvasWidth, canvasHeight);
			const className = `rb-widget rb-widget-${widget.type}`;
			const widgetHtml = buildWidgetTemplate(widget.type, options);
			const colSpan = bounds.width >= canvasWidth * 0.55 ? 2 : 1;
			return `<section class="${className}" data-col-span="${colSpan}" style="left:${Math.round(bounds.x)}px;top:${Math.round(bounds.y)}px;width:${Math.round(bounds.width)}px;height:${Math.round(bounds.height)}px;min-width:${min.width}px;min-height:${min.height}px;max-width:${max.width}px;max-height:${max.height}px;z-index:${index + 1};">${widgetHtml}</section>`;
		})
		.join("\n");

	const qrModal = options.configLinks.enableQrModal
		? `<div class="rb-modal" data-config-qr-modal hidden>
	<div class="rb-modal-backdrop" data-qr-close></div>
	<div class="rb-modal-content">
		<button class="rb-modal-close rb-btn" data-qr-close>×</button>
		<div id="rb-qr-canvas"></div>
		<p class="rb-qr-label" id="rb-qr-label"></p>
		<p class="rb-qr-meta" id="rb-qr-meta"></p>
		<div class="rb-qr-actions">
			<button class="rb-btn" data-qr-prev>Prev</button>
			<button class="rb-btn" data-qr-next>Next</button>
		</div>
		<p class="rb-empty" data-i18n="qrHint">Click QR to copy config link</p>
	</div>
</div>`
		: "";

	const languageMenuIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h12"></path><path d="M9 3v2"></path><path d="M7 5c0 5-2 8-4 10"></path><path d="M11 15c-2-2-3-4-4-7"></path><path d="M15 9h6"></path><path d="M18 6v3"></path><path d="M18 9c0 5-2 8-4 10"></path><path d="M22 19c-2-2-3-4-4-7"></path></svg>`;
	const themeMenuIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3A7 7 0 0 0 21 12.79z"></path></svg>`;

	const profileMenu = `<div class="rb-profile-menu" data-profile-menu>
	<button class="rb-user-chip rb-user-trigger" type="button" data-profile-toggle aria-haspopup="menu" aria-expanded="false">
		<span class="rb-user-name">{{ user.username }}</span>
		<span class="rb-user-caret" aria-hidden="true">&#9662;</span>
	</button>
	<div class="rb-profile-dropdown" data-profile-dropdown role="menu" hidden>
		<button class="rb-menu-item" type="button" data-pref-section-toggle="language" aria-expanded="false">
			<span class="rb-menu-label">${languageMenuIcon}<span data-i18n="languageLabel">Language</span></span>
			<span class="rb-menu-value" data-language-current>EN</span>
		</button>
		<div class="rb-submenu" data-pref-section="language" hidden>
			<button class="rb-btn rb-submenu-btn rb-lang-option" type="button" data-set-language="en"><span class="rb-lang-flag" aria-hidden="true">🇺🇸</span><span>English</span></button>
			<button class="rb-btn rb-submenu-btn rb-lang-option" type="button" data-set-language="fa"><span class="rb-lang-flag" aria-hidden="true">🇮🇷</span><span>فارسی</span></button>
			<button class="rb-btn rb-submenu-btn rb-lang-option" type="button" data-set-language="ru"><span class="rb-lang-flag" aria-hidden="true">🇷🇺</span><span>Русский</span></button>
			<button class="rb-btn rb-submenu-btn rb-lang-option" type="button" data-set-language="zh"><span class="rb-lang-flag" aria-hidden="true">🇨🇳</span><span>中文</span></button>
		</div>
		<button class="rb-menu-item" type="button" data-pref-section-toggle="theme" aria-expanded="false">
			<span class="rb-menu-label">${themeMenuIcon}<span data-i18n="themeLabel">Theme</span></span>
			<span class="rb-menu-value" data-theme-current>Light</span>
		</button>
		<div class="rb-submenu" data-pref-section="theme" hidden>
			<button class="rb-btn rb-submenu-btn" type="button" data-set-theme="light" data-i18n="themeLight">Light</button>
			<button class="rb-btn rb-submenu-btn" type="button" data-set-theme="dark" data-i18n="themeDark">Dark</button>
		</div>
	</div>
</div>`;

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>Subscription</title>
	<style>
		:root {
			--surface:#fff;
			--text:#111827;
			--muted:#64748b;
			--border:#d8e0ec;
			--primary:#2563eb;
			--rb-topbar-bg:rgba(15,23,42,.92);
			--rb-topbar-border:rgba(148,163,184,.28);
			--rb-gap:10px;
			--rb-gap-sm:8px;
			--rb-gap-xs:6px;
			--rb-pad:14px;
			--rb-radius:12px;
			--rb-btn-height:34px;
		}
		*,*::before,*::after { box-sizing:border-box; }
		/* FIX: enable scroll */
		html,body { width:100%; max-width:100%; height:auto; min-height:100%; overflow-x:hidden; }
		body {
			margin:0;
			min-height:100vh;
			padding:clamp(12px,2.2vw,24px) clamp(10px,2vw,20px) clamp(14px,2vw,20px);
			color:var(--text);
			font-family:"Segoe UI",sans-serif;
			line-height:1.4;
			transition:background .2s,color .2s;
			overflow-y:auto;
			-webkit-overflow-scrolling:touch;
		}
		body.rb-dark { --surface:#111827; --text:#e5e7eb; --muted:#94a3b8; --border:#1f2937; --primary:#60a5fa; }
		/* FIX: iframe/container query for preview */
		.rb-topbar {
			position:sticky;
			top:0;
			z-index:999;
			width:100%;
			max-width:min(100%, ${canvasWidth}px);
			margin:0 auto var(--rb-gap);
			padding:8px 10px;
			border:1px solid var(--border);
			border-radius:12px;
			background:var(--rb-topbar-bg);
			border-color:var(--rb-topbar-border);
			display:grid;
			grid-template-columns:minmax(0,1fr) auto;
			align-items:center;
			min-height:64px;
			gap:var(--rb-gap);
			box-shadow:0 4px 10px rgba(15,23,42,.06);
			isolation:isolate;
		}
		.rb-topbar[data-title-placement="center"] {
			grid-template-columns:minmax(0,1fr);
			justify-items:center;
			text-align:center;
		}
		.rb-topbar[data-title-placement="center"] .rb-topbar-main { justify-items:center; text-align:center; }
		.rb-topbar[data-title-placement="center"] .rb-topbar-actions { width:100%; justify-content:center; }
		.rb-topbar[data-title-placement="hidden"] {
			grid-template-columns:auto;
			justify-content:flex-end;
			min-height:56px;
		}
		.rb-topbar[data-title-placement="hidden"] .rb-topbar-main { display:none; }
		.rb-topbar-main {
			display:grid;
			gap:4px;
			min-width:0;
			max-width:100%;
			transform:translate(var(--rb-title-offset-x, 0px), var(--rb-title-offset-y, 0px));
			position:relative;
			z-index:2;
		}
		.rb-topbar-title { margin:0; font-size:clamp(1.08rem,1vw + .95rem,1.45rem); line-height:1.2; overflow-wrap:anywhere; }
		.rb-topbar-subtitle { margin:0; color:var(--muted); font-size:.88rem; overflow-wrap:anywhere; }
		.rb-topbar-actions {
			display:flex;
			flex-wrap:wrap;
			align-items:center;
			justify-content:flex-end;
			gap:8px;
			min-width:0;
			position:relative;
			z-index:2;
		}
		.rb-topbar-overlay {
			position:absolute;
			inset:0;
			z-index:1;
			pointer-events:none;
			overflow:hidden;
		}
		.rb-header-text {
			position:absolute;
			display:inline-block;
			max-width:calc(100% - 12px);
			white-space:nowrap;
			overflow:hidden;
			text-overflow:ellipsis;
			line-height:1.2;
			pointer-events:none;
			text-shadow:0 1px 1px rgba(2,6,23,.35);
		}
		.rb-topbar-links {
			display:flex;
			flex-wrap:wrap;
			align-items:center;
			justify-content:flex-end;
			gap:6px;
			min-width:0;
			font-size:.8rem;
		}
		.rb-topbar-links a {
			color:var(--primary);
			text-decoration:none;
			white-space:nowrap;
		}
		.rb-topbar-sep {
			color:var(--muted);
			white-space:nowrap;
		}
		.rb-page {
			width:100%;
			max-width:min(100%, ${canvasWidth}px);
			margin:0 auto;
			display:grid;
			gap:var(--rb-gap);
			min-width:0;
			container-type:inline-size;
			container-name:rb-page;
		}
		.rb-user-chip {
			display:inline-flex;
			align-items:center;
			border:1px solid var(--border);
			background:var(--surface);
			color:var(--text);
			border-radius:999px;
			padding:4px 9px;
			font-size:.78rem;
			min-width:0;
			max-width:100%;
		}
		.rb-user-trigger {
			height:var(--rb-btn-height);
			padding:0 10px;
			gap:8px;
			cursor:pointer;
			font-size:.78rem;
		}
		.rb-user-name {
			min-width:0;
			overflow:hidden;
			text-overflow:ellipsis;
			white-space:nowrap;
			font-weight:600;
		}
		.rb-user-caret {
			color:var(--muted);
			font-size:.68rem;
			flex:0 0 auto;
		}
		/* FIX: compact username dropdown language/theme */
		.rb-profile-menu { position:relative; min-width:0; max-width:100%; }
		.rb-profile-dropdown {
			position:absolute;
			inset-inline-end:0;
			top:calc(100% + 6px);
			z-index:200;
			width:min(252px,calc(100vw - 24px));
			max-width:calc(100vw - 24px);
			max-height:min(70vh, 360px);
			overflow-y:auto;
			background:var(--surface);
			color:var(--text);
			border:1px solid var(--border);
			border-radius:10px;
			padding:6px;
			display:grid;
			gap:4px;
			transform-origin:top right;
			box-shadow:0 8px 18px rgba(2,6,23,.14);
		}
		.rb-profile-dropdown[hidden], .rb-submenu[hidden] { display:none !important; }
		.rb-menu-item {
			height:28px;
			border:1px solid var(--border);
			border-radius:8px;
			background:var(--surface);
			color:var(--text);
			padding:0 7px;
			display:flex;
			align-items:center;
			justify-content:space-between;
			gap:6px;
			font-size:.74rem;
			cursor:pointer;
			text-align:start;
		}
		.rb-menu-item[aria-expanded="true"] {
			border-color:color-mix(in srgb,var(--primary) 55%, var(--border));
			color:var(--primary);
		}
		.rb-menu-label {
			display:inline-flex;
			align-items:center;
			gap:6px;
			min-width:0;
		}
		.rb-menu-label svg {
			width:14px;
			height:14px;
			flex:0 0 auto;
		}
		.rb-menu-value {
			flex:0 0 auto;
			font-size:.72rem;
			color:var(--muted);
			white-space:nowrap;
			max-width:48%;
			overflow:hidden;
			text-overflow:ellipsis;
		}
		.rb-submenu { display:grid; gap:4px; }
		.rb-submenu-btn {
			height:26px;
			padding:0 7px;
			font-size:.72rem;
			text-align:start;
			justify-content:flex-start;
		}
		.rb-lang-option {
			display:flex;
			align-items:center;
			gap:6px;
		}
		.rb-lang-flag {
			font-size:.82rem;
			line-height:1;
			flex:0 0 auto;
		}
		.rb-submenu-btn.is-active {
			border-color:var(--primary);
			color:var(--primary);
			background:color-mix(in srgb,var(--primary) 10%, var(--surface));
		}
		.rb-layout-shell {
			width:100%;
			max-width:100%;
			overflow:auto;
			-webkit-overflow-scrolling:touch;
		}
		.rb-layout {
			position:relative;
			width:${canvasWidth}px;
			min-width:${canvasWidth}px;
			height:${outputLayoutHeight}px;
			min-height:${outputLayoutHeight}px;
			max-width:${canvasWidth}px;
			max-height:${outputLayoutHeight}px;
			margin:0 auto;
		}
		.rb-widget {
			--rb-widget-pad:var(--rb-pad);
			--rb-widget-gap:var(--rb-gap-sm);
			position:absolute;
			background:var(--surface);
			border:1px solid var(--border);
			border-radius:var(--rb-radius);
			padding:var(--rb-widget-pad);
			overflow:hidden;
			display:flex;
			flex-direction:column;
			gap:var(--rb-widget-gap);
			container-type:inline-size;
			min-width:0;
			min-height:0;
		}
		.rb-widget h3 {
			margin:0 0 calc(var(--rb-widget-gap) + 1px);
			font-size:clamp(.82rem,2.2cqi,.95rem);
			line-height:1.25;
			overflow-wrap:anywhere;
		}
		.rb-widget[data-density="compact"] { --rb-widget-pad:12px; --rb-widget-gap:7px; }
		.rb-widget[data-density="mini"] { --rb-widget-pad:10px; --rb-widget-gap:6px; }
		.rb-widget[data-density="compact"] h3 { font-size:.88rem; }
		.rb-widget[data-density="mini"] h3 { font-size:.82rem; }
		.rb-widget[data-density="compact"] [data-hide-on~="compact"] { display:none !important; }
		.rb-widget[data-density="mini"] [data-hide-on~="compact"], .rb-widget[data-density="mini"] [data-hide-on~="mini"] { display:none !important; }
		.rb-value { margin:0; font-size:1.05rem; font-weight:700; line-height:1.2; overflow-wrap:anywhere; }
		.rb-username-value { font-size:clamp(.9rem,4.4cqi,1.35rem); }
		.rb-widget[data-density="compact"] .rb-value { font-size:.98rem; }
		.rb-widget[data-density="mini"] .rb-value { font-size:.9rem; }
		.rb-metrics { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:var(--rb-gap-sm); }
		.rb-widget-usage_summary .rb-metrics { grid-template-columns:repeat(auto-fit,minmax(112px,1fr)); align-items:start; }
		.rb-widget-usage_summary .rb-metrics > div { min-width:0; }
		.rb-metrics span { font-size:.72rem; color:var(--muted); display:block; }
		.rb-metrics strong { font-size:.88rem; display:block; line-height:1.22; overflow-wrap:anywhere; word-break:break-word; }
		.rb-widget[data-density="compact"] .rb-metrics { grid-template-columns:repeat(2,minmax(0,1fr)); gap:7px; }
		.rb-widget[data-density="mini"] .rb-metrics { grid-template-columns:1fr; gap:6px; }
		.rb-widget-usage_summary[data-density="compact"] .rb-metrics { grid-template-columns:repeat(2,minmax(0,1fr)); }
		.rb-widget-usage_summary[data-density="mini"] .rb-metrics { grid-template-columns:repeat(2,minmax(0,1fr)); }
		.rb-progress { height:8px; border-radius:999px; overflow:hidden; margin-top:6px; background:color-mix(in srgb,var(--primary) 20%, transparent); }
		.rb-progress span { height:100%; display:block; background:var(--primary); }
		.rb-status { display:inline-flex; padding:4px 10px; border-radius:999px; color:#fff; text-transform:capitalize; font-size:.8rem; font-weight:700; }
		.rb-status-active { background:#16a34a; } .rb-status-limited { background:#dc2626; } .rb-status-expired { background:#f59e0b; } .rb-status-disabled { background:#64748b; }
		.rb-online-pill { display:inline-flex; align-items:center; border-radius:999px; padding:4px 10px; color:#fff; font-size:.8rem; font-weight:700; }
		.rb-online-pill.is-online { background:#16a34a; }
		.rb-online-pill.is-offline { background:#64748b; }
		.rb-kv { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:var(--rb-gap-sm); }
		.rb-kv span { font-size:.72rem; color:var(--muted); display:block; }
		.rb-kv strong { font-size:.88rem; display:block; line-height:1.3; overflow-wrap:anywhere; word-break:break-word; }
		.rb-widget-expire_details .rb-kv { grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px 10px; }
		.rb-widget-expire_details .rb-kv-created { grid-column:1 / -1; }
		.rb-widget[data-density="compact"] .rb-kv { gap:7px; }
		.rb-widget[data-density="mini"] .rb-kv { grid-template-columns:1fr; gap:6px; }
		.rb-row { display:flex; align-items:center; gap:var(--rb-gap-xs); min-width:0; }
		.rb-input {
			flex:1;
			min-width:0;
			height:var(--rb-btn-height);
			border:1px solid var(--border);
			border-radius:8px;
			padding:0 10px;
			font-size:.8rem;
			background:var(--surface);
			color:var(--text);
		}
		.rb-btn {
			height:var(--rb-btn-height);
			border:1px solid var(--border);
			border-radius:8px;
			background:var(--surface);
			color:var(--text);
			padding:0 10px;
			font-size:.78rem;
			line-height:1;
			cursor:pointer;
			white-space:nowrap;
			max-width:100%;
			overflow:hidden;
			text-overflow:ellipsis;
		}
		.rb-widget[data-density="mini"] .rb-btn { font-size:.72rem; }
		.rb-icon-btn {
			position:relative;
			width:30px;
			min-width:30px;
			height:30px;
			padding:0;
			display:inline-flex;
			align-items:center;
			justify-content:center;
			font-size:.72rem;
		}
		.rb-icon-btn svg { width:14px; height:14px; }
		.rb-icon-btn.is-copied { border-color:var(--primary); color:var(--primary); }
		.rb-sr { position:absolute; width:1px; height:1px; margin:-1px; border:0; padding:0; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; }
		img.twemoji-emoji { display:inline-block; height:1.2em; width:1.2em; margin:0 .1em; vertical-align:-.1em; }
		.rb-empty { margin:0; color:var(--muted); font-size:.8rem; }
		.rb-list { list-style:none; margin:0; padding:0; display:grid; gap:var(--rb-gap-xs); }
		.rb-widget-links { position:relative; }
		.rb-widget-links .rb-list {
			max-height:calc(100% - 56px);
			overflow:auto;
			padding-right:2px;
			-webkit-overflow-scrolling:touch;
		}
		.rb-widget-links .rb-list.is-scrollable {
			padding:6px;
			padding-right:8px;
			border-radius:10px;
			border:1px solid color-mix(in srgb,var(--border) 62%, transparent);
			background:
				linear-gradient(
					145deg,
					color-mix(in srgb,var(--surface) 72%, transparent),
					color-mix(in srgb,var(--surface) 56%, transparent)
				);
			-webkit-backdrop-filter: blur(10px) saturate(130%);
			backdrop-filter: blur(10px) saturate(130%);
			box-shadow:
				inset 0 1px 0 color-mix(in srgb,#ffffff 26%, transparent),
				inset 0 -1px 0 color-mix(in srgb,var(--border) 46%, transparent);
		}
		.rb-widget-links.has-scroll .rb-list.is-scrollable::before,
		.rb-widget-links.has-scroll .rb-list.is-scrollable::after {
			content:"";
			position:sticky;
			left:0;
			right:0;
			display:block;
			height:13px;
			pointer-events:none;
			z-index:2;
			opacity:1;
			transition:opacity .18s ease;
		}
		.rb-widget-links.has-scroll .rb-list.is-scrollable::before {
			top:0;
			margin-bottom:-13px;
			background:linear-gradient(
				to bottom,
				color-mix(in srgb,var(--surface) 90%, transparent),
				transparent
			);
		}
		.rb-widget-links.has-scroll .rb-list.is-scrollable::after {
			bottom:0;
			margin-top:-13px;
			background:linear-gradient(
				to top,
				color-mix(in srgb,var(--surface) 92%, transparent),
				transparent
			);
		}
		.rb-widget-links.scroll-at-top .rb-list.is-scrollable::before { opacity:0; }
		.rb-widget-links.scroll-at-bottom .rb-list.is-scrollable::after { opacity:0; }
		.rb-widget-links[data-density="compact"] .rb-list { max-height:calc(100% - 52px); }
		.rb-widget-links[data-density="mini"] .rb-list { max-height:calc(100% - 48px); }
		.rb-config-item {
			border:1px solid var(--border);
			border-radius:9px;
			padding:6px 8px;
			background:color-mix(in srgb,var(--surface) 88%, var(--text) 12%);
		}
		.rb-config-row { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:var(--rb-gap-xs); direction:ltr; }
		.rb-config-name {
			font-size:.78rem;
			font-weight:600;
			min-width:0;
			text-align:left;
			direction:ltr;
			unicode-bidi:isolate;
			white-space:nowrap;
			overflow:hidden;
			text-overflow:ellipsis;
		}
		.rb-config-actions { display:inline-flex; align-items:center; gap:4px; flex:0 0 auto; }
		.rb-widget[data-density="mini"] .rb-config-name { font-size:.74rem; }
		.rb-chart { min-height:150px; overflow:hidden; }
		.rb-widget[data-density="compact"] .rb-chart { min-height:122px; }
		.rb-widget[data-density="mini"] .rb-chart { min-height:100px; }
		.rb-chart-controls { display:grid; gap:var(--rb-gap-sm); margin-bottom:8px; }
		.rb-ranges { display:flex; gap:var(--rb-gap-xs); flex-wrap:wrap; }
		.rb-ranges .rb-btn.is-active { border-color:var(--primary); color:var(--primary); }
		.rb-calendar { display:grid; gap:var(--rb-gap-xs); grid-template-columns:1fr 1fr auto; }
		.rb-date-input { max-width:100%; }
		.rb-bars { display:grid; grid-template-columns:repeat(14,minmax(0,1fr)); gap:6px; align-items:end; min-height:130px; }
		.rb-bar { display:flex; flex-direction:column; align-items:center; gap:4px; min-width:0; }
		.rb-bar-fill { width:100%; background:var(--primary); border-radius:6px 6px 0 0; }
		.rb-bar-label { font-size:.62rem; color:var(--muted); }
		.rb-widget[data-density="compact"] .rb-bars { gap:4px; min-height:108px; }
		.rb-widget[data-density="mini"] .rb-bars { gap:3px; min-height:92px; }
		.rb-widget[data-density="mini"] .rb-bar-label { display:none; }
		.rb-foot { margin-top:6px; font-size:.76rem; color:var(--muted); line-height:1.35; }
		.rb-widget[data-density="compact"] .rb-foot { margin-top:4px; font-size:.73rem; }
		.rb-widget[data-density="mini"] .rb-foot { margin-top:2px; font-size:.7rem; }
		/* Profile menu hosts Language + Theme controls in a compact dropdown */
		.rb-app-imports { display:grid; gap:8px; min-width:0; }
		.rb-app-tabs {
			display:flex;
			align-items:center;
			gap:6px;
			overflow-x:auto;
			padding-bottom:2px;
			-webkit-overflow-scrolling:touch;
			scrollbar-width:thin;
		}
		.rb-app-tab {
			height:26px;
			min-height:26px;
			padding:0 10px;
			border:1px solid var(--border);
			border-radius:999px;
			background:var(--surface);
			color:var(--text);
			font-size:.72rem;
			font-weight:600;
			white-space:nowrap;
			cursor:pointer;
			flex:0 0 auto;
		}
		.rb-app-tab.is-active {
			border-color:color-mix(in srgb,var(--primary) 55%, var(--border));
			color:var(--primary);
			background:color-mix(in srgb,var(--primary) 10%, var(--surface));
		}
		.rb-app-grid {
			display:grid;
			grid-template-columns:repeat(auto-fit,minmax(180px,1fr));
			gap:var(--rb-gap-sm);
			min-width:0;
		}
		.rb-widget-app_imports .rb-app-grid {
			max-height:calc(100% - 64px);
			overflow:auto;
			padding-right:2px;
			-webkit-overflow-scrolling:touch;
		}
		.rb-app-item {
			display:grid;
			grid-template-columns:minmax(0,1fr) auto;
			align-items:center;
			gap:8px;
			border:1px solid var(--border);
			border-radius:10px;
			padding:7px 8px;
			background:color-mix(in srgb,var(--surface) 88%, var(--text) 12%);
			min-width:0;
		}
		.rb-app-main { display:grid; gap:2px; min-width:0; }
		.rb-app-main-top { display:flex; align-items:center; justify-content:space-between; gap:6px; min-width:0; }
		.rb-app-label {
			font-size:.78rem;
			font-weight:600;
			min-width:0;
			overflow:hidden;
			text-overflow:ellipsis;
			white-space:nowrap;
		}
		.rb-app-os {
			font-size:.68rem;
			color:var(--muted);
			overflow:hidden;
			text-overflow:ellipsis;
			white-space:nowrap;
		}
		.rb-app-tag {
			font-size:.62rem;
			border:1px solid var(--border);
			border-radius:999px;
			padding:2px 6px;
			color:var(--muted);
			flex:0 0 auto;
		}
		.rb-app-action {
			height:28px;
			min-height:28px;
			padding:0 9px;
			font-size:.72rem;
			flex:0 0 auto;
		}
		.rb-widget[data-density="compact"] .rb-app-grid, .rb-widget[data-density="mini"] .rb-app-grid { grid-template-columns:1fr; }
		.rb-widget-app_imports[data-density="compact"] .rb-app-grid { max-height:calc(100% - 58px); }
		.rb-widget-app_imports[data-density="mini"] .rb-app-grid { max-height:calc(100% - 54px); }
		.rb-widget[data-density="mini"] .rb-app-tag, .rb-widget[data-density="mini"] .rb-app-os { display:none; }
		.rb-modal[hidden] { display:none; }
		.rb-modal { position:fixed; inset:0; z-index:9999; display:flex; align-items:center; justify-content:center; }
		.rb-modal-backdrop { position:absolute; inset:0; background:rgba(15,23,42,.65); }
		.rb-modal-content {
			position:relative;
			z-index:1;
			width:min(340px,calc(100vw - 24px));
			background:var(--surface);
			color:var(--text);
			border:1px solid var(--border);
			border-radius:12px;
			padding:14px;
			display:grid;
			gap:8px;
			justify-items:center;
		}
		.rb-modal-close { position:absolute; top:8px; right:8px; padding:2px 8px; height:auto; }
		#rb-qr-canvas { padding:8px; background:#fff; border-radius:10px; cursor:pointer; }
		.rb-qr-label,.rb-qr-meta { margin:0; text-align:center; font-size:.8rem; }
		.rb-qr-meta { color:var(--muted); font-size:.74rem; }
		.rb-qr-actions { display:flex; gap:6px; }

		@container rb-page (max-width:1200px) {
			.rb-page {
				--rb-pad:12px;
				--rb-gap:10px;
				--rb-gap-sm:8px;
				--rb-gap-xs:6px;
				--rb-btn-height:32px;
			}
			.rb-topbar {
				padding:7px 9px;
				margin-bottom:6px;
				min-height:60px;
				grid-template-columns:minmax(0,1fr);
				align-items:start;
			}
			.rb-topbar-main { transform:none !important; }
			.rb-topbar-actions { width:100%; justify-content:space-between; }
			.rb-topbar-links { justify-content:flex-start; }
			.rb-widget { --rb-widget-pad:11px; --rb-widget-gap:7px; }
			.rb-widget .rb-btn { font-size:.76rem; }
			.rb-widget .rb-input { font-size:.78rem; }
			.rb-menu-item { font-size:.74rem; }
			.rb-menu-value { font-size:.7rem; }
			.rb-widget-links .rb-list { max-height:min(42vh,320px); }
			.rb-widget-app_imports .rb-app-grid { max-height:min(46vh,340px); }
			.rb-chart { overflow-x:auto; -webkit-overflow-scrolling:touch; }
			.rb-calendar { grid-template-columns:1fr; }
			.rb-metrics { grid-template-columns:repeat(2,minmax(0,1fr)); }
			.rb-kv { grid-template-columns:repeat(2,minmax(0,1fr)); }
			.rb-row { flex-direction:column; align-items:stretch; }
			.rb-app-grid { grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); }
		}

		@container rb-page (max-width:900px) {
			/* Responsive flow mode for narrow screens: no overlap, consistent gaps */
			.rb-layout-shell { overflow:visible; }
			.rb-layout {
				width:100%;
				min-width:0;
				max-width:100%;
				height:auto;
				min-height:0;
				max-height:none;
				display:grid;
				grid-template-columns:repeat(2,minmax(0,1fr));
				gap:var(--rb-gap);
				align-items:start;
			}
			.rb-widget {
				position:static !important;
				inset:auto !important;
				width:auto !important;
				height:auto !important;
				min-width:0 !important;
				max-width:100% !important;
				max-height:none !important;
				z-index:auto !important;
			}
			.rb-widget[data-col-span="2"] { grid-column:span 2; }
		}

		@container rb-page (max-width:560px) {
			.rb-page {
				--rb-pad:10px;
				--rb-gap:8px;
				--rb-gap-sm:6px;
				--rb-gap-xs:5px;
				--rb-btn-height:30px;
			}
			.rb-topbar {
				padding:6px 8px;
				border-radius:10px;
				min-height:56px;
				gap:8px;
				grid-template-columns:minmax(0,1fr);
			}
			.rb-topbar-main { transform:none !important; }
			.rb-topbar-title { font-size:clamp(1rem,4.8vw,1.18rem); }
			.rb-topbar-subtitle { font-size:.78rem; }
			.rb-topbar-actions { width:100%; justify-content:space-between; gap:6px; }
			.rb-topbar-links { gap:5px; }
			.rb-user-trigger { font-size:.74rem; padding:0 8px; max-width:min(220px,100%); }
			.rb-profile-dropdown { width:min(248px,calc(100vw - 20px)); max-width:calc(100vw - 20px); padding:6px; }
			.rb-menu-item { height:29px; padding:0 7px; font-size:.73rem; }
			.rb-submenu-btn { height:27px; font-size:.72rem; }
			.rb-layout { grid-template-columns:1fr; }
			.rb-widget[data-col-span="2"] { grid-column:span 1; }
			.rb-widget { --rb-widget-pad:9px; --rb-widget-gap:6px; }
			.rb-widget h3 { font-size:.82rem; }
			.rb-metrics { grid-template-columns:1fr; }
			.rb-kv { grid-template-columns:1fr; }
			.rb-config-item { padding:5px 7px; }
			.rb-config-name { font-size:.75rem; }
			.rb-icon-btn { width:28px; min-width:28px; height:28px; }
			.rb-widget-links .rb-list { max-height:min(36vh,240px); }
			.rb-widget-app_imports .rb-app-grid { max-height:min(40vh,260px); }
			.rb-app-grid { grid-template-columns:1fr; }
		}

		@supports not (container-type:inline-size) {
			@media (max-width:1200px) {
				body { padding:18px 14px 16px; }
				.rb-page {
					--rb-pad:12px;
					--rb-gap:10px;
					--rb-gap-sm:8px;
					--rb-gap-xs:6px;
					--rb-btn-height:32px;
				}
				.rb-topbar {
					padding:7px 9px;
					margin-bottom:6px;
					min-height:60px;
					grid-template-columns:minmax(0,1fr);
					align-items:start;
				}
				.rb-topbar-main { transform:none !important; }
				.rb-topbar-actions { width:100%; justify-content:space-between; }
				.rb-topbar-links { justify-content:flex-start; }
				.rb-widget { --rb-widget-pad:11px; --rb-widget-gap:7px; }
				.rb-widget .rb-btn { font-size:.76rem; }
				.rb-widget .rb-input { font-size:.78rem; }
				.rb-menu-item { font-size:.74rem; }
				.rb-menu-value { font-size:.7rem; }
				.rb-widget-links .rb-list { max-height:min(42vh,320px); }
				.rb-widget-app_imports .rb-app-grid { max-height:min(46vh,340px); }
				.rb-chart { overflow-x:auto; -webkit-overflow-scrolling:touch; }
				.rb-calendar { grid-template-columns:1fr; }
				.rb-metrics { grid-template-columns:repeat(2,minmax(0,1fr)); }
				.rb-kv { grid-template-columns:repeat(2,minmax(0,1fr)); }
				.rb-row { flex-direction:column; align-items:stretch; }
				.rb-app-grid { grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); }
			}

			@media (max-width:900px) {
				.rb-layout-shell { overflow:visible; }
				.rb-layout {
					width:100%;
					min-width:0;
					max-width:100%;
					height:auto;
					min-height:0;
					max-height:none;
					display:grid;
					grid-template-columns:repeat(2,minmax(0,1fr));
					gap:var(--rb-gap);
					align-items:start;
				}
				.rb-widget {
					position:static !important;
					inset:auto !important;
					width:auto !important;
					height:auto !important;
					min-width:0 !important;
					max-width:100% !important;
					max-height:none !important;
					z-index:auto !important;
				}
				.rb-widget[data-col-span="2"] { grid-column:span 2; }
			}

			@media (max-width:560px) {
				body { padding:12px 10px 14px; }
				.rb-page {
					--rb-pad:10px;
					--rb-gap:8px;
					--rb-gap-sm:6px;
					--rb-gap-xs:5px;
					--rb-btn-height:30px;
				}
				.rb-topbar {
					padding:6px 8px;
					border-radius:10px;
					min-height:56px;
					gap:8px;
					grid-template-columns:minmax(0,1fr);
				}
				.rb-topbar-main { transform:none !important; }
				.rb-topbar-title { font-size:clamp(1rem,4.8vw,1.18rem); }
				.rb-topbar-subtitle { font-size:.78rem; }
				.rb-topbar-actions { width:100%; justify-content:space-between; gap:6px; }
				.rb-topbar-links { gap:5px; }
				.rb-user-trigger { font-size:.74rem; padding:0 8px; max-width:min(220px,100%); }
				.rb-profile-dropdown { width:min(248px,calc(100vw - 20px)); max-width:calc(100vw - 20px); padding:6px; }
				.rb-menu-item { height:29px; padding:0 7px; font-size:.73rem; }
				.rb-submenu-btn { height:27px; font-size:.72rem; }
				.rb-layout { grid-template-columns:1fr; }
				.rb-widget[data-col-span="2"] { grid-column:span 1; }
				.rb-widget { --rb-widget-pad:9px; --rb-widget-gap:6px; }
				.rb-widget h3 { font-size:.82rem; }
				.rb-metrics { grid-template-columns:1fr; }
				.rb-kv { grid-template-columns:1fr; }
				.rb-config-item { padding:5px 7px; }
				.rb-config-name { font-size:.75rem; }
				.rb-icon-btn { width:28px; min-width:28px; height:28px; }
				.rb-widget-links .rb-list { max-height:min(36vh,240px); }
				.rb-widget-app_imports .rb-app-grid { max-height:min(40vh,260px); }
				.rb-app-grid { grid-template-columns:1fr; }
			}
		}
	</style>
	<script src="https://cdn.jsdelivr.net/npm/twemoji@14.0.2/dist/twemoji.min.js"></script>
	<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
</head>
<body>
${builderConfigScript}
${builderBgImageScript}
<main class="rb-page">
	<header class="rb-topbar" data-title-placement="left">
		<div class="rb-topbar-overlay" data-header-text-layer aria-hidden="true"></div>
		<div class="rb-topbar-main">
			<h1 class="rb-topbar-title" data-page-title>Subscription Dashboard</h1>
			<p class="rb-topbar-subtitle" data-page-subtitle>Manage your subscription links and usage</p>
		</div>
		<div class="rb-topbar-actions">
			<div class="rb-topbar-links">
				<a href="{{ usage_url }}" data-i18n="usageApiLink">Usage API</a>
				{% if support_url %}<span class="rb-topbar-sep">|</span><a href="{{ support_url }}" target="_blank" rel="noopener noreferrer" data-i18n="supportLink">Support</a>{% endif %}
			</div>
			${profileMenu}
		</div>
	</header>
	<div class="rb-layout-shell">
		<section class="rb-layout">
${sections}
		</section>
	</div>
</main>
${qrModal}
<script>
(function () {
	var config = ${scriptConfig};
	if (!config.appearance) config.appearance = {};
	if (!config.activity) config.activity = {};
	if (!config.appImports) config.appImports = {};

	var dict = {
		en: { usageSummaryTitle:"Usage Summary", usedLabel:"Used", totalLabel:"Total", progressLabel:"Progress", usernameTitle:"Username", statusTitle:"Status", onlineStatusTitle:"Online Status", onlineNow:"Online", offlineNow:"Offline", lastOnlineLabel:"Last online", neverOnline:"No online activity yet.", expireDetailsTitle:"Expiration Details", daysLeftLabel:"Days Left", expireAtLabel:"Expire At", createdAtLabel:"Created At", unlimited:"Unlimited", expiredAlready:"Expired", daysRemaining:"[[days]] days left", subscriptionUrlTitle:"Subscription URL", copyUrlButton:"Copy URL", configLinksTitle:"Config Links", copyButton:"Copy", qrButton:"QR", noLinks:"No links available.", usageChartTitle:"Usage Chart", loadingUsage:"Loading usage data...", preferencesTitle:"Language & Theme", languageLabel:"Language", themeLabel:"Theme", themeSystem:"System", themeLight:"Light", themeDark:"Dark", appImportsTitle:"Add To Apps", appImportsHint:"Tap an app to import this subscription directly.", noAppsSelected:"No app button is enabled.", recommendedTag:"Recommended", appImportsAllTab:"All", appImportsImportButton:"Import", osWindows:"Windows", osMacos:"macOS", osIos:"iOS", osAndroid:"Android", osLinux:"Linux", applyButton:"Apply", usageApiLink:"Usage API", supportLink:"Support", usageDataUnavailable:"Usage data is unavailable.", noUsageData:"No usage data for selected range.", rangeTotal:"Range total", configFallback:"Config [[index]]", copied:"Copied", qrHint:"Click QR to copy config link", justNow:"just now", minutesAgo:"[[count]] minute(s) ago", hoursAgo:"[[count]] hour(s) ago", daysAgo:"[[count]] day(s) ago" },
		fa: { usageSummaryTitle:"خلاصه مصرف", usedLabel:"مصرف‌شده", totalLabel:"کل", progressLabel:"پیشرفت", usernameTitle:"نام کاربری", statusTitle:"وضعیت", onlineStatusTitle:"وضعیت آنلاین", onlineNow:"آنلاین", offlineNow:"آفلاین", lastOnlineLabel:"آخرین آنلاین", neverOnline:"هنوز آنلاین نشده است.", expireDetailsTitle:"جزئیات انقضا", daysLeftLabel:"روز باقی‌مانده", expireAtLabel:"تاریخ انقضا", createdAtLabel:"تاریخ ساخت", unlimited:"نامحدود", expiredAlready:"منقضی شده", daysRemaining:"[[days]] روز باقی مانده", subscriptionUrlTitle:"لینک اشتراک", copyUrlButton:"کپی لینک", configLinksTitle:"کانفیگ‌ها", copyButton:"کپی", qrButton:"QR", noLinks:"لینکی موجود نیست.", usageChartTitle:"نمودار مصرف", loadingUsage:"در حال بارگذاری مصرف...", preferencesTitle:"زبان و تم", languageLabel:"زبان", themeLabel:"تم", themeSystem:"سیستم", themeLight:"روشن", themeDark:"تیره", appImportsTitle:"افزودن به برنامه‌ها", appImportsHint:"برای افزودن مستقیم، روی یکی از برنامه‌ها بزنید.", noAppsSelected:"هیچ دکمه برنامه‌ای فعال نیست.", recommendedTag:"پیشنهادی", appImportsAllTab:"همه", appImportsImportButton:"افزودن", osWindows:"ویندوز", osMacos:"مک", osIos:"iOS", osAndroid:"اندروید", osLinux:"لینوکس", applyButton:"اعمال", usageApiLink:"لینک مصرف", supportLink:"پشتیبانی", usageDataUnavailable:"اطلاعات مصرف در دسترس نیست.", noUsageData:"برای این بازه داده‌ای نیست.", rangeTotal:"جمع بازه", configFallback:"کانفیگ [[index]]", copied:"کپی شد", qrHint:"با کلیک روی QR لینک کپی می‌شود", justNow:"همین الان", minutesAgo:"[[count]] دقیقه پیش", hoursAgo:"[[count]] ساعت پیش", daysAgo:"[[count]] روز پیش" },
		ru: { usageSummaryTitle:"Сводка", usedLabel:"Использовано", totalLabel:"Лимит", progressLabel:"Прогресс", usernameTitle:"Имя пользователя", statusTitle:"Статус", onlineStatusTitle:"Онлайн", onlineNow:"В сети", offlineNow:"Не в сети", lastOnlineLabel:"Последний онлайн", neverOnline:"Нет активности.", expireDetailsTitle:"Срок действия", daysLeftLabel:"Дней осталось", expireAtLabel:"Истекает", createdAtLabel:"Создан", unlimited:"Без лимита", expiredAlready:"Истек", daysRemaining:"Осталось дней: [[days]]", subscriptionUrlTitle:"URL подписки", copyUrlButton:"Копировать URL", configLinksTitle:"Конфиги", copyButton:"Копировать", qrButton:"QR", noLinks:"Ссылки отсутствуют.", usageChartTitle:"График трафика", loadingUsage:"Загрузка статистики...", preferencesTitle:"Язык и тема", languageLabel:"Язык", themeLabel:"Тема", themeSystem:"Система", themeLight:"Светлая", themeDark:"Темная", appImportsTitle:"Импорт в приложения", appImportsHint:"Нажмите приложение для импорта подписки.", noAppsSelected:"Кнопки приложений отключены.", recommendedTag:"Рекомендуется", appImportsAllTab:"Все", appImportsImportButton:"Импорт", osWindows:"Windows", osMacos:"macOS", osIos:"iOS", osAndroid:"Android", osLinux:"Linux", applyButton:"Применить", usageApiLink:"API статистики", supportLink:"Поддержка", usageDataUnavailable:"Статистика недоступна.", noUsageData:"Нет данных за период.", rangeTotal:"Итого за период", configFallback:"Конфиг [[index]]", copied:"Скопировано", qrHint:"Нажмите на QR для копирования", justNow:"только что", minutesAgo:"[[count]] мин назад", hoursAgo:"[[count]] ч назад", daysAgo:"[[count]] дн назад" },
		zh: { usageSummaryTitle:"流量概览", usedLabel:"已用", totalLabel:"总量", progressLabel:"进度", usernameTitle:"用户名", statusTitle:"状态", onlineStatusTitle:"在线状态", onlineNow:"在线", offlineNow:"离线", lastOnlineLabel:"最后在线", neverOnline:"暂无在线记录。", expireDetailsTitle:"到期详情", daysLeftLabel:"剩余天数", expireAtLabel:"到期时间", createdAtLabel:"创建时间", unlimited:"无限制", expiredAlready:"已过期", daysRemaining:"剩余 [[days]] 天", subscriptionUrlTitle:"订阅链接", copyUrlButton:"复制链接", configLinksTitle:"配置链接", copyButton:"复制", qrButton:"二维码", noLinks:"暂无链接", usageChartTitle:"流量图表", loadingUsage:"正在加载流量数据...", preferencesTitle:"语言与主题", languageLabel:"语言", themeLabel:"主题", themeSystem:"跟随系统", themeLight:"浅色", themeDark:"深色", appImportsTitle:"添加到应用", appImportsHint:"点击应用可直接导入订阅。", noAppsSelected:"未启用任何应用按钮。", recommendedTag:"推荐", appImportsAllTab:"全部", appImportsImportButton:"导入", osWindows:"Windows", osMacos:"macOS", osIos:"iOS", osAndroid:"Android", osLinux:"Linux", applyButton:"应用", usageApiLink:"流量 API", supportLink:"支持", usageDataUnavailable:"无法获取流量数据", noUsageData:"所选日期无数据", rangeTotal:"区间总量", configFallback:"配置 [[index]]", copied:"已复制", qrHint:"点击二维码复制链接", justNow:"刚刚", minutesAgo:"[[count]] 分钟前", hoursAgo:"[[count]] 小时前", daysAgo:"[[count]] 天前" }
	};
	var twemojiOptions = { base:"https://cdn.jsdelivr.net/gh/twitter/twemoji@latest/assets/", folder:"72x72", ext:".png", className:"twemoji-emoji", size:"72x72" };

	function parseEmojis(root) { if (!root || !window.twemoji || typeof window.twemoji.parse !== "function") return; try { window.twemoji.parse(root, twemojiOptions); } catch (error) {} }
	function fallbackCopy(value, done) { var area = document.createElement("textarea"); area.value = value; area.style.position = "fixed"; area.style.opacity = "0"; document.body.appendChild(area); area.focus(); area.select(); try { document.execCommand("copy"); } catch (err) {} document.body.removeChild(area); done(); }
	function copyText(value, button) { if (!value) return; var done = function () { if (!button) return; var label = button.getAttribute("data-copy-label") || "Copy"; if (button.getAttribute("data-copy-icon") === "1") { button.classList.add("is-copied"); button.setAttribute("title", translate("copied")); button.setAttribute("aria-label", translate("copied")); window.setTimeout(function () { button.classList.remove("is-copied"); button.setAttribute("title", label); button.setAttribute("aria-label", label); }, 1200); return; } button.textContent = translate("copied"); window.setTimeout(function () { button.textContent = label; }, 1200); }; if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(value).then(done).catch(function () { fallbackCopy(value, done); }); return; } fallbackCopy(value, done); }
	function detectBrowserLanguage() { var raw = (navigator.language || "en").toLowerCase(); if (raw.startsWith("fa")) return "fa"; if (raw.startsWith("ru")) return "ru"; if (raw.startsWith("zh")) return "zh"; return "en"; }
	function interpolate(template, params) { var out = String(template || ""); Object.keys(params || {}).forEach(function (key) { out = out.split("[[" + key + "]]").join(String(params[key])); }); return out; }
	function localeFor(lang) { if (lang === "fa") return "fa-IR"; if (lang === "ru") return "ru-RU"; if (lang === "zh") return "zh-CN"; return "en-US"; }
	function formatDateTime(date) { try { return new Intl.DateTimeFormat(localeFor(currentLanguage), { year:"numeric", month:"short", day:"2-digit", hour:"2-digit", minute:"2-digit" }).format(date); } catch (error) { return date.toISOString().replace("T", " ").slice(0, 16); } }
	function formatRelativeAgo(date) { var seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000)); if (seconds < 60) return translate("justNow"); var minutes = Math.floor(seconds / 60); if (minutes < 60) return interpolate(translate("minutesAgo"), { count: minutes }); var hours = Math.floor(minutes / 60); if (hours < 24) return interpolate(translate("hoursAgo"), { count: hours }); var days = Math.floor(hours / 24); return interpolate(translate("daysAgo"), { count: days }); }
	function sanitizeHexColor(value) { var raw = String(value || "").trim(); if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw)) return raw; return ""; }
	function hexToRgb(hex) {
		var raw = String(hex || "").replace("#", "");
		var normalized = raw.length === 3 ? raw.split("").map(function (ch) { return ch + ch; }).join("") : raw;
		if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return { r: 15, g: 23, b: 42 };
		return {
			r: parseInt(normalized.slice(0, 2), 16),
			g: parseInt(normalized.slice(2, 4), 16),
			b: parseInt(normalized.slice(4, 6), 16)
		};
	}
	function rgbaFromHex(hex, alpha) {
		var c = hexToRgb(hex);
		return "rgba(" + c.r + "," + c.g + "," + c.b + "," + alpha + ")";
	}
	function clampNumber(value, min, max, fallback) {
		var n = Number(value);
		if (!isFinite(n)) return fallback;
		if (n < min) return min;
		if (n > max) return max;
		return n;
	}
	var widgetMinSize = {
		usage_summary: { w:280, h:150 },
		username: { w:180, h:96 },
		status: { w:170, h:92 },
		online_status: { w:190, h:96 },
		expire_details: { w:340, h:164 },
		subscription_url: { w:260, h:110 },
		links: { w:300, h:145 },
		usage_chart: { w:320, h:180 },
		app_imports: { w:300, h:150 }
	};
	var densityRules = {
		compactScale: 1,
		miniScale: 0.72
	};
	function widgetTypeOf(node) {
		if (!node || !node.classList) return "";
		var found = "";
		node.classList.forEach(function (cls) {
			if (!found && cls.indexOf("rb-widget-") === 0 && cls !== "rb-widget") {
				found = cls.slice("rb-widget-".length);
			}
		});
		return found;
	}
	function resolveWidgetDensity(node, width, height) {
		var w = Number(width || 0);
		var h = Number(height || 0);
		var type = widgetTypeOf(node);
		var base = widgetMinSize[type] || { w:170, h:84 };
		var compactW = Math.round(base.w * densityRules.compactScale);
		var compactH = Math.round(base.h * densityRules.compactScale);
		var miniW = Math.round(compactW * densityRules.miniScale);
		var miniH = Math.round(compactH * densityRules.miniScale);
		if (w < miniW || h < miniH) return "mini";
		if (w < compactW || h < compactH) return "compact";
		return "full";
	}
	function applyDensityToWidget(widget, width, height) {
		if (!widget) return;
		var nextDensity = resolveWidgetDensity(widget, width, height);
		if (widget.getAttribute("data-density") !== nextDensity) {
			widget.setAttribute("data-density", nextDensity);
		}
	}
	function refreshWidgetDensity() { document.querySelectorAll(".rb-widget").forEach(function (widget) { var rect = widget.getBoundingClientRect(); applyDensityToWidget(widget, rect.width, rect.height); }); refreshConfigLinksScrollState(); }
	function observeWidgetDensity() { if (typeof ResizeObserver !== "function") { refreshWidgetDensity(); return; } var observer = new ResizeObserver(function (entries) { entries.forEach(function (entry) { var rect = entry.contentRect || entry.target.getBoundingClientRect(); applyDensityToWidget(entry.target, rect.width, rect.height); }); }); document.querySelectorAll(".rb-widget").forEach(function (widget) { observer.observe(widget); }); refreshWidgetDensity(); window.addEventListener("resize", refreshWidgetDensity); }
	var currentLanguage = "en";
	function translate(key, params) { var table = dict[currentLanguage] || dict.en; var base = table[key] || dict.en[key] || key; return interpolate(base, params || {}); }
	function applyI18n(lang) { currentLanguage = lang; document.querySelectorAll("[data-i18n]").forEach(function (node) { var key = node.getAttribute("data-i18n") || ""; node.textContent = translate(key); }); document.querySelectorAll("[data-i18n-title]").forEach(function (node) { var key = node.getAttribute("data-i18n-title") || ""; var translated = translate(key); node.setAttribute("title", translated); if (node.getAttribute("aria-label")) node.setAttribute("aria-label", translated); }); document.querySelectorAll("[data-copy-target],[data-copy-current-url]").forEach(function (button) { var title = button.getAttribute("title"); button.setAttribute("data-copy-label", title || button.textContent || "Copy"); }); parseEmojis(document.body); refreshConfigLinksScrollState(); }

	function applyPageMeta() {
		var title = config.appearance && typeof config.appearance.pageTitle === "string" && config.appearance.pageTitle.trim() ? config.appearance.pageTitle.trim() : "Subscription Dashboard";
		var subtitle = config.appearance && typeof config.appearance.pageSubtitle === "string" ? config.appearance.pageSubtitle.trim() : "";
		var titlePlacementRaw = config.appearance && typeof config.appearance.titlePlacement === "string" ? config.appearance.titlePlacement : "left";
		var titlePlacement = titlePlacementRaw === "center" || titlePlacementRaw === "hidden" ? titlePlacementRaw : "left";
		var titleOffsetXRaw = Number(config.appearance && config.appearance.titleOffsetX);
		var titleOffsetYRaw = Number(config.appearance && config.appearance.titleOffsetY);
		var titleOffsetX = isFinite(titleOffsetXRaw) ? Math.min(180, Math.max(-180, Math.round(titleOffsetXRaw))) : 0;
		var titleOffsetY = isFinite(titleOffsetYRaw) ? Math.min(120, Math.max(-80, Math.round(titleOffsetYRaw))) : 0;
		var titleNode = document.querySelector("[data-page-title]");
		var subtitleNode = document.querySelector("[data-page-subtitle]");
		var headerNode = document.querySelector(".rb-topbar");
		var headerMainNode = document.querySelector(".rb-topbar-main");
		if (titleNode) titleNode.textContent = title;
		if (subtitleNode) {
			subtitleNode.textContent = subtitle;
			subtitleNode.hidden = !subtitle;
		}
		if (headerNode) headerNode.setAttribute("data-title-placement", titlePlacement);
		if (headerMainNode && headerMainNode.style) {
			headerMainNode.style.setProperty("--rb-title-offset-x", titleOffsetX + "px");
			headerMainNode.style.setProperty("--rb-title-offset-y", titleOffsetY + "px");
		}
		document.title = title + " - {{ user.username }}";
		parseEmojis(document.body);
	}

	function applyAccentColor() {
		var accent = sanitizeHexColor(config.appearance && config.appearance.accentColor);
		if (!accent) accent = "#2563eb";
		document.documentElement.style.setProperty("--primary", accent);
	}

	function applyHeaderAppearance(actualTheme) {
		var isDark = actualTheme === "dark";
		var appearance = config.appearance || {};
		var lightHex = sanitizeHexColor(appearance.headerBackgroundLight) || "#0f172a";
		var darkHex = sanitizeHexColor(appearance.headerBackgroundDark) || "#0b1227";
		var baseHex = isDark ? darkHex : lightHex;
		var transparent = Boolean(appearance.headerTransparent);
		var opacity = clampNumber(appearance.headerOpacity, 0, 100, 92);
		var alpha = transparent ? opacity / 100 : 1;
		var borderAlpha = transparent ? Math.max(0.2, Math.min(0.9, alpha * 0.55)) : 0.45;
		document.documentElement.style.setProperty("--rb-topbar-bg", rgbaFromHex(baseHex, alpha));
		document.documentElement.style.setProperty("--rb-topbar-border", rgbaFromHex(baseHex, borderAlpha));
	}

	function renderHeaderOverlayTexts() {
		var layer = document.querySelector("[data-header-text-layer]");
		var header = document.querySelector(".rb-topbar");
		if (!layer || !header) return;
		var appearance = config.appearance || {};
		var source = Array.isArray(appearance.headerTexts) ? appearance.headerTexts.slice(0, 16) : [];
		layer.innerHTML = "";
		if (!source.length) return;
		var width = Math.max(0, header.clientWidth || 0);
		var height = Math.max(0, header.clientHeight || 0);
		source.forEach(function (entry, index) {
			if (!entry || typeof entry !== "object") return;
			var text = typeof entry.text === "string" ? entry.text.trim().slice(0, 120) : "";
			if (!text) return;
			var node = document.createElement("span");
			node.className = "rb-header-text";
			node.textContent = text;
			var color = sanitizeHexColor(entry.color) || "#ffffff";
			var x = clampNumber(entry.x, 0, Math.max(0, width - 24), Math.min(24 + index * 10, Math.max(0, width - 24)));
			var y = clampNumber(entry.y, 0, Math.max(0, height - 24), 10 + index * 6);
			var fontSize = clampNumber(entry.fontSize, 10, 36, 13);
			var weightRaw = Number(entry.fontWeight);
			var fontWeight = weightRaw === 400 || weightRaw === 500 || weightRaw === 600 || weightRaw === 700 ? weightRaw : 600;
			node.style.left = Math.round(x) + "px";
			node.style.top = Math.round(y) + "px";
			node.style.color = color;
			node.style.fontSize = Math.round(fontSize) + "px";
			node.style.fontWeight = String(fontWeight);
			layer.appendChild(node);
		});
	}

	function applyBackground(actualTheme) {
		var isDark = actualTheme === "dark";
		var appearance = config.appearance || {};
		var mode = appearance.backgroundMode;
		if (mode !== "solid" && mode !== "gradient" && mode !== "image") mode = "gradient";
		var lightSolid = typeof appearance.backgroundLight === "string" && appearance.backgroundLight.trim() ? appearance.backgroundLight.trim() : "#f4f7fb";
		var darkSolid = typeof appearance.backgroundDark === "string" && appearance.backgroundDark.trim() ? appearance.backgroundDark.trim() : "#0f172a";
		var lightGradient = typeof appearance.gradientLight === "string" && appearance.gradientLight.trim() ? appearance.gradientLight.trim() : "radial-gradient(circle at 10% -5%, #dbeafe, #f4f7fb 45%)";
		var darkGradient = typeof appearance.gradientDark === "string" && appearance.gradientDark.trim() ? appearance.gradientDark.trim() : "radial-gradient(circle at 12% -8%, #1e3a8a, #0f172a 48%)";
		var imageData = typeof appearance.backgroundImageDataUrl === "string" ? appearance.backgroundImageDataUrl : "";
		if (mode === "image" && imageData) {
			var overlay = isDark ? "linear-gradient(rgba(2,6,23,.74),rgba(15,23,42,.82))" : "linear-gradient(rgba(248,250,252,.86),rgba(241,245,249,.75))";
			document.body.style.background = (isDark ? darkSolid : lightSolid);
			document.body.style.backgroundImage = overlay + ',url("' + imageData + '")';
			document.body.style.backgroundSize = "cover";
			document.body.style.backgroundPosition = "center";
			document.body.style.backgroundRepeat = "no-repeat";
			document.body.style.backgroundAttachment = "scroll";
			return;
		}
		document.body.style.backgroundImage = "none";
		if (mode === "solid") {
			document.body.style.background = isDark ? darkSolid : lightSolid;
		} else {
			document.body.style.background = isDark ? darkGradient : lightGradient;
		}
	}

	function applyTheme(mode) {
		var actual = mode;
		if (mode === "system") {
			actual = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
		}
		document.body.classList.toggle("rb-dark", actual === "dark");
		applyBackground(actual);
		applyHeaderAppearance(actual);
		renderHeaderOverlayTexts();
	}

	function applyPreviewInteractionMode() {
		var isTouchPreview = Boolean(window.__RB_PREVIEW_TOUCH);
		document.body.classList.toggle("rb-preview-touch", isTouchPreview);
		document.documentElement.classList.toggle("rb-preview-touch", isTouchPreview);
	}

	applyPageMeta();
	applyAccentColor();
	applyPreviewInteractionMode();

	var langStoreKey = "rebecca_sub_lang";
	var themeStoreKey = "rebecca_sub_theme";
	var languageOrder = ["en", "fa", "ru", "zh"];
	var languageShortLabels = { en: "EN", fa: "FA", ru: "RU", zh: "ZH" };
	var languagePreference = localStorage.getItem(langStoreKey) || config.preferences.defaultLanguage;
	if (languagePreference === "browser") languagePreference = detectBrowserLanguage();
	if (languageOrder.indexOf(languagePreference) < 0) languagePreference = "en";
	applyI18n(languagePreference);
	var initialTheme = localStorage.getItem(themeStoreKey) || config.preferences.defaultTheme;
	if (initialTheme === "system") {
		initialTheme = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
	}
	if (initialTheme !== "dark" && initialTheme !== "light") initialTheme = "light";
	var themePreference = initialTheme;
	applyTheme(themePreference);

	function languagePreferenceLabel() {
		return languageShortLabels[languagePreference] || "EN";
	}
	function updatePreferenceButtons() {
		var langText = languagePreferenceLabel();
		document.querySelectorAll("[data-language-current]").forEach(function (node) { node.textContent = langText; });
		var themeText = themePreference === "dark" ? translate("themeDark") : translate("themeLight");
		document.querySelectorAll("[data-theme-current]").forEach(function (node) { node.textContent = themeText; });
		document.querySelectorAll("[data-set-language]").forEach(function (button) {
			button.classList.toggle("is-active", (button.getAttribute("data-set-language") || "") === languagePreference);
		});
		document.querySelectorAll("[data-set-theme]").forEach(function (button) {
			button.classList.toggle("is-active", (button.getAttribute("data-set-theme") || "") === themePreference);
		});
	}
	function setLanguage(nextLanguage) {
		var normalized = languageOrder.indexOf(nextLanguage) >= 0 ? nextLanguage : "en";
		languagePreference = normalized;
		localStorage.setItem(langStoreKey, normalized);
		applyI18n(languagePreference);
		refreshConfigLabels();
		refreshOnlineStatus();
		refreshExpireDetails();
		refreshWidgetDensity();
		renderAppImports();
		updatePreferenceButtons();
	}
	function setThemePreference(nextTheme) {
		var normalizedTheme = nextTheme === "dark" || nextTheme === "light" ? nextTheme : "light";
		themePreference = normalizedTheme;
		localStorage.setItem(themeStoreKey, normalizedTheme);
		applyTheme(themePreference);
		refreshWidgetDensity();
		updatePreferenceButtons();
	}

	function closeProfileMenu() {
		document.querySelectorAll("[data-profile-dropdown]").forEach(function (panel) { panel.setAttribute("hidden", ""); });
		document.querySelectorAll("[data-profile-toggle]").forEach(function (trigger) { trigger.setAttribute("aria-expanded", "false"); });
		document.querySelectorAll("[data-pref-section]").forEach(function (section) { section.setAttribute("hidden", ""); });
		document.querySelectorAll("[data-pref-section-toggle]").forEach(function (button) { button.setAttribute("aria-expanded", "false"); });
	}
	function toggleProfileMenu(menuNode) {
		if (!menuNode) return;
		var panel = menuNode.querySelector("[data-profile-dropdown]");
		var trigger = menuNode.querySelector("[data-profile-toggle]");
		if (!panel || !trigger) return;
		var shouldOpen = panel.hasAttribute("hidden");
		closeProfileMenu();
		if (shouldOpen) {
			panel.removeAttribute("hidden");
			trigger.setAttribute("aria-expanded", "true");
		}
	}
	function toggleProfileSection(menuNode, sectionName) {
		if (!menuNode) return;
		var target = menuNode.querySelector('[data-pref-section="' + sectionName + '"]');
		var trigger = menuNode.querySelector('[data-pref-section-toggle="' + sectionName + '"]');
		if (!target || !trigger) return;
		var shouldOpen = target.hasAttribute("hidden");
		menuNode.querySelectorAll("[data-pref-section]").forEach(function (section) { section.setAttribute("hidden", ""); });
		menuNode.querySelectorAll("[data-pref-section-toggle]").forEach(function (button) { button.setAttribute("aria-expanded", "false"); });
		if (shouldOpen) {
			target.removeAttribute("hidden");
			trigger.setAttribute("aria-expanded", "true");
		}
	}

	var mediaQuery = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
	if (mediaQuery) {
		mediaQuery.addEventListener("change", function () {
			applyTheme(themePreference);
			updatePreferenceButtons();
		});
	}

	document.querySelectorAll("[data-profile-toggle]").forEach(function (button) {
		button.addEventListener("click", function () {
			var menu = button.closest("[data-profile-menu]");
			toggleProfileMenu(menu);
		});
	});
	document.querySelectorAll("[data-pref-section-toggle]").forEach(function (button) {
		button.addEventListener("click", function () {
			var menu = button.closest("[data-profile-menu]");
			if (!menu) return;
			toggleProfileSection(menu, button.getAttribute("data-pref-section-toggle") || "");
		});
	});
	document.querySelectorAll("[data-set-language]").forEach(function (button) {
		button.addEventListener("click", function () {
			setLanguage(button.getAttribute("data-set-language") || "en");
			closeProfileMenu();
		});
	});
	document.querySelectorAll("[data-set-theme]").forEach(function (button) {
		button.addEventListener("click", function () {
			setThemePreference(button.getAttribute("data-set-theme") || "light");
			closeProfileMenu();
		});
	});
	document.addEventListener("click", function (event) {
		var target = event.target;
		if (!(target instanceof Element)) return;
		if (!target.closest("[data-profile-menu]")) closeProfileMenu();
	});
	document.addEventListener("keydown", function (event) {
		if (event.key === "Escape") closeProfileMenu();
	});
	updatePreferenceButtons();

	window.addEventListener("resize", function () {
		renderHeaderOverlayTexts();
	});
	observeWidgetDensity();

	var currentUrl = window.location.href;
	document.querySelectorAll("[data-current-url]").forEach(function (input) { input.value = currentUrl; });
	document.querySelectorAll("[data-copy-current-url]").forEach(function (button) {
		button.addEventListener("click", function () { copyText(currentUrl, button); });
		button.setAttribute("data-copy-label", button.textContent || "Copy");
	});
	document.querySelectorAll("[data-copy-target]").forEach(function (button) {
		button.addEventListener("click", function () { copyText(button.getAttribute("data-copy-target") || "", button); });
		button.setAttribute("data-copy-label", button.textContent || "Copy");
	});

	function decodeLabel(value) { var normalized = String(value || "").replace(/\\+/g, " "); try { return decodeURIComponent(normalized).trim(); } catch { return normalized.trim(); } }
	function extractFromHash(link) { var idx = link.indexOf("#"); if (idx >= 0 && idx < link.length - 1) return decodeLabel(link.slice(idx + 1)); return ""; }
	function extractFromQuery(link) { var q = link.indexOf("?"); if (q < 0) return ""; var h = link.indexOf("#"); var query = link.slice(q + 1, h < 0 ? link.length : h); var params = new URLSearchParams(query); var keys = ["remark","remarks","ps","name","tag","host"]; for (var i = 0; i < keys.length; i += 1) { var value = params.get(keys[i]); if (value) return decodeLabel(value); } return ""; }
	function decodeVmessName(link) { if (!String(link).toLowerCase().startsWith("vmess://")) return ""; var payload = String(link).slice(8); var hashIndex = payload.indexOf("#"); if (hashIndex >= 0) payload = payload.slice(0, hashIndex); if (!payload) return ""; var normalized = payload.replace(/-/g, "+").replace(/_/g, "/"); var padding = normalized.length % 4; if (padding) normalized += "=".repeat(4 - padding); if (typeof window.atob !== "function") return ""; try { var parsed = JSON.parse(window.atob(normalized)); var name = typeof parsed.ps === "string" ? parsed.ps : typeof parsed.name === "string" ? parsed.name : typeof parsed.tag === "string" ? parsed.tag : ""; return name ? decodeLabel(name) : ""; } catch { return ""; } }
	function getConfigLabelFromLink(link) { return extractFromHash(link) || decodeVmessName(link) || extractFromQuery(link) || ""; }

	var configState = [];
	function refreshConfigLinksScrollState() {
		document.querySelectorAll(".rb-widget-links .rb-list").forEach(function (list) {
			var widget = list.closest(".rb-widget-links");
			if (!widget) return;
			var scrollable = list.scrollHeight > list.clientHeight + 1;
			list.classList.toggle("is-scrollable", scrollable);
			widget.classList.toggle("has-scroll", scrollable);
			if (!scrollable) {
				widget.classList.remove("scroll-at-top");
				widget.classList.remove("scroll-at-bottom");
				return;
			}
			var atTop = list.scrollTop <= 1;
			var atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 1;
			widget.classList.toggle("scroll-at-top", atTop);
			widget.classList.toggle("scroll-at-bottom", atBottom);
		});
	}
	function bindConfigLinksScrollHandlers() {
		document.querySelectorAll(".rb-widget-links .rb-list").forEach(function (list) {
			if (list.getAttribute("data-scroll-bound") === "1") return;
			list.setAttribute("data-scroll-bound", "1");
			list.addEventListener("scroll", refreshConfigLinksScrollState, { passive: true });
		});
	}
	function refreshConfigLabels() {
		configState = [];
		document.querySelectorAll(".rb-config-item").forEach(function (item, index) {
			var link = item.getAttribute("data-config-link") || "";
			var nameNode = item.querySelector("[data-config-name]");
			var extracted = getConfigLabelFromLink(link);
			var fallback = translate("configFallback", { index: index + 1 });
			var label = config.configLinks && config.configLinks.showConfigNames ? (extracted || fallback) : fallback;
			if (nameNode) nameNode.textContent = label;
			var qrButton = item.querySelector("[data-open-config-qr]");
			if (qrButton) qrButton.setAttribute("data-copy-label", translate("qrButton"));
			configState.push({ link: link, label: label });
		});
		parseEmojis(document.body);
		bindConfigLinksScrollHandlers();
		refreshConfigLinksScrollState();
	}
	refreshConfigLabels();

	function refreshOnlineStatus() {
		var threshold = Number(config.activity && config.activity.onlineThresholdMinutes);
		if (!isFinite(threshold) || threshold <= 0) threshold = 5;
		document.querySelectorAll("[data-online-card]").forEach(function (card) {
			var onlineAtRaw = card.getAttribute("data-online-at") || "";
			var badge = card.querySelector("[data-online-pill]");
			var lastNode = card.querySelector("[data-online-last]");
			var onlineDate = onlineAtRaw ? new Date(onlineAtRaw) : null;
			if (!onlineDate || isNaN(onlineDate.getTime())) {
				if (badge) {
					badge.textContent = translate("offlineNow");
					badge.classList.remove("is-online");
					badge.classList.add("is-offline");
				}
				if (lastNode) {
					lastNode.textContent = translate("neverOnline");
				}
				return;
			}
			var minutesDiff = (Date.now() - onlineDate.getTime()) / 60000;
			var isOnline = minutesDiff <= threshold;
			if (badge) {
				badge.textContent = isOnline ? translate("onlineNow") : translate("offlineNow");
				badge.classList.toggle("is-online", isOnline);
				badge.classList.toggle("is-offline", !isOnline);
			}
			if (lastNode) {
				lastNode.textContent = translate("lastOnlineLabel") + ": " + formatDateTime(onlineDate) + " (" + formatRelativeAgo(onlineDate) + ")";
			}
		});
	}

	function refreshExpireDetails() {
		document.querySelectorAll("[data-expire-card]").forEach(function (card) {
			var expireRaw = card.getAttribute("data-expire-ts") || "";
			var createdRaw = card.getAttribute("data-created-iso") || "";
			var daysNode = card.querySelector("[data-expire-days]");
			var expireNode = card.querySelector("[data-expire-date]");
			var createdNode = card.querySelector("[data-created-at]");
			var metaNode = card.parentElement ? card.parentElement.querySelector("[data-expire-meta]") : null;
			var expireTs = Number(expireRaw);
			if (isFinite(expireTs) && expireTs > 0) {
				var expireDate = new Date(expireTs * 1000);
				var msLeft = expireDate.getTime() - Date.now();
				var daysLeft = msLeft > 0 ? Math.ceil(msLeft / 86400000) : 0;
				if (daysNode) daysNode.textContent = String(daysLeft);
				if (expireNode) expireNode.textContent = formatDateTime(expireDate);
				if (metaNode) metaNode.textContent = msLeft > 0 ? interpolate(translate("daysRemaining"), { days: daysLeft }) : translate("expiredAlready");
			} else {
				if (daysNode) daysNode.textContent = "∞";
				if (expireNode) expireNode.textContent = translate("unlimited");
				if (metaNode) metaNode.textContent = translate("unlimited");
			}
			var createdDate = createdRaw ? new Date(createdRaw) : null;
			if (createdNode) {
				createdNode.textContent = createdDate && !isNaN(createdDate.getTime()) ? formatDateTime(createdDate) : "-";
			}
		});
	}

	refreshOnlineStatus();
	refreshExpireDetails();

	var qrModal = document.querySelector("[data-config-qr-modal]");
	if (qrModal) {
		var qrCanvas = document.getElementById("rb-qr-canvas");
		var qrLabel = document.getElementById("rb-qr-label");
		var qrMeta = document.getElementById("rb-qr-meta");
		var qrIndex = 0;
		function renderQr(index) {
			if (!configState.length || !qrCanvas) return;
			qrIndex = (index + configState.length) % configState.length;
			var item = configState[qrIndex];
			qrCanvas.innerHTML = "";
			new QRCode(qrCanvas, { text: item.link, width: 260, height: 260, correctLevel: QRCode.CorrectLevel.L });
			if (qrLabel) qrLabel.textContent = item.label;
			if (qrMeta) qrMeta.textContent = (qrIndex + 1) + " / " + configState.length;
			qrCanvas.onclick = function () { copyText(item.link, null); };
		}
		function openQr(index) { if (!configState.length) return; qrModal.hidden = false; renderQr(index); }
		function closeQr() { qrModal.hidden = true; }
		document.querySelectorAll("[data-open-config-qr]").forEach(function (button, index) {
			button.addEventListener("click", function () { openQr(index); });
		});
		qrModal.querySelectorAll("[data-qr-close]").forEach(function (node) { node.addEventListener("click", closeQr); });
		var prev = qrModal.querySelector("[data-qr-prev]");
		var next = qrModal.querySelector("[data-qr-next]");
		if (prev) prev.addEventListener("click", function () { renderQr(qrIndex - 1); });
		if (next) next.addEventListener("click", function () { renderQr(qrIndex + 1); });
	}

	function detectClientOS() {
		var previewDevice = window.__RB_PREVIEW_DEVICE;
		if (previewDevice === "mobile" || previewDevice === "tablet") {
			return "android";
		}
		var ua = (navigator.userAgent || "").toLowerCase();
		if (ua.indexOf("android") >= 0) return "android";
		if (ua.indexOf("iphone") >= 0 || ua.indexOf("ipad") >= 0 || ua.indexOf("ipod") >= 0) return "ios";
		if (ua.indexOf("win") >= 0) return "windows";
		if (ua.indexOf("mac") >= 0) return "macos";
		if (ua.indexOf("linux") >= 0) return "linux";
		return "windows";
	}

	function sanitizeAppImportId(value, fallback) {
		var normalized = String(value || "")
			.toLowerCase()
			.trim()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "");
		return normalized || fallback;
	}

	function appImportDefaultMetaByKey(key) {
		if (key === "v2rayng") return { label: "v2rayNG", supportedOS: ["android"] };
		if (key === "singbox") return { label: "sing-box", supportedOS: ["android", "ios", "macos", "windows", "linux"] };
		if (key === "v2box") return { label: "v2Box", supportedOS: ["ios"] };
		if (key === "streisand") return { label: "Streisand", supportedOS: ["ios"] };
		if (key === "nekobox") return { label: "NekoBox", supportedOS: ["android"] };
		if (key === "clash") return { label: "Clash", supportedOS: ["windows", "macos", "linux"] };
		if (key === "shadowrocket") return { label: "Shadowrocket", supportedOS: ["ios"] };
		if (key === "foxray") return { label: "FoXray", supportedOS: ["ios"] };
		return { label: "Custom App", supportedOS: ["android"] };
	}

	function normalizeOsList(value, fallback) {
		var allowed = ["windows", "macos", "ios", "android", "linux"];
		var source = Array.isArray(value) ? value : fallback;
		var seen = {};
		var result = [];
		source.forEach(function (item) {
			if (typeof item !== "string") return;
			var os = item.trim().toLowerCase();
			if (os === "win") os = "windows";
			if (os === "mac" || os === "darwin" || os === "osx" || os === "mac os") os = "macos";
			if (os === "iphone" || os === "ipad" || os === "ipados") os = "ios";
			if (allowed.indexOf(os) >= 0 && !seen[os]) {
				seen[os] = true;
				result.push(os);
			}
		});
		return result.length ? result : fallback.slice();
	}

	function normalizeAppImportsConfig(raw) {
		var value = raw && typeof raw === "object" ? raw : {};
		var fallbackApps = [
			{ id: "v2rayng", label: "v2rayNG", recommended: true, supportedOS: ["android"], deepLinkKey: "v2rayng" },
			{ id: "singbox", label: "sing-box", recommended: true, supportedOS: ["android", "ios", "macos", "windows", "linux"], deepLinkKey: "singbox" },
			{ id: "v2box", label: "v2Box", recommended: true, supportedOS: ["ios"], deepLinkKey: "v2box" },
			{ id: "streisand", label: "Streisand", recommended: true, supportedOS: ["ios"], deepLinkKey: "streisand" },
			{ id: "nekobox", label: "NekoBox", recommended: false, supportedOS: ["android"], deepLinkKey: "nekobox" },
			{ id: "clash", label: "Clash", recommended: false, supportedOS: ["windows", "macos", "linux"], deepLinkKey: "clash" },
			{ id: "shadowrocket", label: "Shadowrocket", recommended: false, supportedOS: ["ios"], deepLinkKey: "shadowrocket" },
			{ id: "foxray", label: "FoXray", recommended: false, supportedOS: ["ios"], deepLinkKey: "foxray" }
		];
		var osOrder = normalizeOsList(value.osOrder, ["windows", "macos", "ios", "android", "linux"]);
		["windows", "macos", "ios", "android", "linux"].forEach(function (os) {
			if (osOrder.indexOf(os) < 0) osOrder.push(os);
		});
		var appSource = Array.isArray(value.apps) && value.apps.length ? value.apps.slice(0, 64) : fallbackApps;
		var seenIds = {};
		var apps = appSource
			.map(function (candidate, index) {
				if (!candidate || typeof candidate !== "object") return null;
				var allowedKeys = ["v2rayng", "singbox", "v2box", "streisand", "nekobox", "clash", "shadowrocket", "foxray", "custom"];
				var key = allowedKeys.indexOf(candidate.deepLinkKey) >= 0 ? candidate.deepLinkKey : "v2rayng";
				var defaults = appImportDefaultMetaByKey(key);
				var label = typeof candidate.label === "string" && candidate.label.trim() ? candidate.label.trim().slice(0, 80) : defaults.label;
				var idBase = sanitizeAppImportId(candidate.id || label || ("app-" + (index + 1)), "app-" + (index + 1));
				var count = seenIds[idBase] || 0;
				seenIds[idBase] = count + 1;
				var id = count === 0 ? idBase : idBase + "-" + (count + 1);
				var supportedOS = normalizeOsList(candidate.supportedOS, defaults.supportedOS);
				var customTemplate = typeof candidate.customDeepLinkTemplate === "string" ? candidate.customDeepLinkTemplate.trim().slice(0, 500) : "";
				return {
					id: id,
					label: label,
					recommended: Boolean(candidate.recommended),
					supportedOS: supportedOS,
					deepLinkKey: key,
					customDeepLinkTemplate: key === "custom" ? customTemplate : ""
				};
			})
			.filter(Boolean);
		return {
			showRecommendedFirst: typeof value.showRecommendedFirst === "boolean" ? value.showRecommendedFirst : true,
			showAllButtons: typeof value.showAllButtons === "boolean" ? value.showAllButtons : true,
			osOrder: osOrder,
			apps: apps.length ? apps : fallbackApps
		};
	}

	function appImportOsLabel(os) {
		if (os === "windows") return translate("osWindows");
		if (os === "macos") return translate("osMacos");
		if (os === "ios") return translate("osIos");
		if (os === "android") return translate("osAndroid");
		return translate("osLinux");
	}

	function buildAppImportLink(appKey, url, customTemplate) {
		var encodedUrl = encodeURIComponent(url);
		var profileNameRaw = config.appearance && typeof config.appearance.pageTitle === "string" ? config.appearance.pageTitle : "Subscription";
		var profileName = encodeURIComponent(profileNameRaw);
		if (appKey === "streisand") return "streisand://import/" + encodedUrl;
		if (appKey === "v2box") return "v2box://install-sub?url=" + encodedUrl + "&name=" + profileName;
		if (appKey === "v2rayng") return "v2rayng://install-config?url=" + encodedUrl;
		if (appKey === "singbox") return "sing-box://import-remote-profile?url=" + encodedUrl + "#" + profileName;
		if (appKey === "nekobox") return "sn://subscription?url=" + encodedUrl + "&name=" + profileName;
		if (appKey === "clash") return "clash://install-config?url=" + encodedUrl;
		if (appKey === "shadowrocket") return "sub://" + encodedUrl;
		if (appKey === "foxray") return "foxray://yiguo.dev/sub/add/?url=" + encodedUrl + "#" + profileName;
		if (appKey === "custom") {
			var template = typeof customTemplate === "string" ? customTemplate.trim() : "";
			if (!template) return "";
			var tokenOpen = "{" + "{";
			var tokenClose = "}" + "}";
			var urlToken = tokenOpen + "url" + tokenClose;
			var nameToken = tokenOpen + "name" + tokenClose;
			var urlTokenSpaced = tokenOpen + " url " + tokenClose;
			var nameTokenSpaced = tokenOpen + " name " + tokenClose;
			return template
				.split(urlToken)
				.join(encodedUrl)
				.split(urlTokenSpaced)
				.join(encodedUrl)
				.split(nameToken)
				.join(profileName)
				.split(nameTokenSpaced)
				.join(profileName);
		}
		return "";
	}

	var appImportConfig = normalizeAppImportsConfig(config.appImports);
	config.appImports = appImportConfig;
	var detectedAppImportOs = detectClientOS();

	function renderAppImports() {
		document.querySelectorAll("[data-app-imports]").forEach(function (root) {
			var tabsNode = root.querySelector("[data-app-tabs]");
			var gridNode = root.querySelector("[data-app-grid]");
			var emptyNode = root.querySelector("[data-app-empty]");
			if (!tabsNode || !gridNode) return;
			var availableTabs = Array.isArray(appImportConfig.osOrder) && appImportConfig.osOrder.length
				? appImportConfig.osOrder.slice()
				: ["windows", "macos", "ios", "android", "linux"];
			var active = root.getAttribute("data-active-os") || detectedAppImportOs;
			if (availableTabs.indexOf(active) < 0) {
				active = availableTabs.indexOf(detectedAppImportOs) >= 0 ? detectedAppImportOs : availableTabs[0];
			}
			root.setAttribute("data-active-os", active);

			tabsNode.innerHTML = "";
			availableTabs.forEach(function (tab) {
				var tabBtn = document.createElement("button");
				tabBtn.type = "button";
				tabBtn.className = "rb-app-tab" + (tab === active ? " is-active" : "");
				tabBtn.setAttribute("role", "tab");
				tabBtn.setAttribute("aria-selected", tab === active ? "true" : "false");
				tabBtn.textContent = appImportOsLabel(tab);
				tabBtn.addEventListener("click", function () {
					root.setAttribute("data-active-os", tab);
					renderAppImports();
				});
				tabsNode.appendChild(tabBtn);
			});

			var getAppsForOs = function (os) {
				return appImportConfig.apps.filter(function (app) {
					return Array.isArray(app.supportedOS) && app.supportedOS.indexOf(os) >= 0;
				});
			};

			var appsForActiveOs = getAppsForOs(active);
			if (!appsForActiveOs.length) {
				var firstTabWithApps = availableTabs.find(function (tab) {
					return getAppsForOs(tab).length > 0;
				});
				if (firstTabWithApps) {
					active = firstTabWithApps;
					root.setAttribute("data-active-os", active);
					appsForActiveOs = getAppsForOs(active);
				}
			}

			var apps = appsForActiveOs.slice();
			if (!appImportConfig.showAllButtons) {
				var recommendedApps = apps.filter(function (app) {
					return Boolean(app.recommended);
				});
				if (recommendedApps.length > 0) {
					apps = recommendedApps;
				}
			}
			if (!apps.length) {
				apps = appsForActiveOs.slice();
			}
			if (appImportConfig.showRecommendedFirst) {
				apps.sort(function (a, b) {
					var recDiff = Number(b.recommended) - Number(a.recommended);
					if (recDiff !== 0) return recDiff;
					return String(a.label || "").localeCompare(String(b.label || ""));
				});
			}

			gridNode.innerHTML = "";
			if (!apps.length) {
				if (emptyNode) emptyNode.hidden = false;
				return;
			}
			if (emptyNode) emptyNode.hidden = true;

			apps.forEach(function (app) {
				var item = document.createElement("article");
				item.className = "rb-app-item";

				var main = document.createElement("div");
				main.className = "rb-app-main";

				var top = document.createElement("div");
				top.className = "rb-app-main-top";

				var label = document.createElement("span");
				label.className = "rb-app-label";
				label.textContent = app.label;
				top.appendChild(label);

				if (app.recommended) {
					var badge = document.createElement("span");
					badge.className = "rb-app-tag";
					badge.textContent = translate("recommendedTag");
					top.appendChild(badge);
				}

				main.appendChild(top);

				var osText = document.createElement("span");
				osText.className = "rb-app-os";
				osText.textContent = (app.supportedOS || []).map(function (os) { return appImportOsLabel(os); }).join(" · ");
				main.appendChild(osText);

				var action = document.createElement("button");
				action.type = "button";
				action.className = "rb-btn rb-app-action";
				action.textContent = translate("appImportsImportButton");
				action.addEventListener("click", function () {
					var deepLink = buildAppImportLink(app.deepLinkKey, currentUrl, app.customDeepLinkTemplate || "");
					if (!deepLink) {
						copyText(currentUrl, null);
						return;
					}
					try {
						window.location.href = deepLink;
					} catch (error) {
						copyText(currentUrl, null);
					}
				});

				item.appendChild(main);
				item.appendChild(action);
				gridNode.appendChild(item);
			});
		});
	}

	renderAppImports();

	function formatBytes(bytes) { var val = Number(bytes || 0); if (!isFinite(val) || val <= 0) return "0 B"; var units = ["B","KB","MB","GB","TB"]; var u = 0; while (val >= 1024 && u < units.length - 1) { val /= 1024; u += 1; } return (val >= 10 || u === 0 ? val.toFixed(0) : val.toFixed(1)) + " " + units[u]; }
	var chartTargets = Array.from(document.querySelectorAll("[data-usage-chart]"));
	if (chartTargets.length) {
		var rangeStartInput = document.querySelector("[data-range-start]");
		var rangeEndInput = document.querySelector("[data-range-end]");
		var rangeButtons = Array.from(document.querySelectorAll("[data-range-days]"));
		function toIso(value, endOfDay) { if (!value) return ""; var date = new Date(value + (endOfDay ? "T23:59:59" : "T00:00:00")); return isNaN(date.getTime()) ? "" : date.toISOString(); }
		function updateDateInputs(days) { if (!rangeStartInput || !rangeEndInput) return; var now = new Date(); var end = new Date(now.getFullYear(), now.getMonth(), now.getDate()); var start = new Date(end); start.setDate(start.getDate() - (days - 1)); rangeStartInput.value = start.toISOString().slice(0, 10); rangeEndInput.value = end.toISOString().slice(0, 10); }
		function makeUsageUrl(startIso, endIso) { var url = new URL("{{ usage_url }}", window.location.origin); if (startIso) url.searchParams.set("start", startIso); if (endIso) url.searchParams.set("end", endIso); return url.toString(); }
		var latestUsagePoints = [];
		function barsLimitForTarget(target) {
			var widget = target && typeof target.closest === "function" ? target.closest(".rb-widget") : null;
			var density = widget ? widget.getAttribute("data-density") || "full" : "full";
			if (density === "mini") return 6;
			if (density === "compact") return 10;
			return 14;
		}
		function renderUsage(points) {
			latestUsagePoints = Array.isArray(points) ? points : [];
			if (latestUsagePoints.length === 0) {
				chartTargets.forEach(function (target) { target.innerHTML = '<p class="rb-empty">' + translate("noUsageData") + "</p>"; });
				return;
			}
			chartTargets.forEach(function (target) {
				var subset = latestUsagePoints.slice(-barsLimitForTarget(target));
				var max = 1;
				var total = 0;
				subset.forEach(function (item) {
					var used = Number(item && item.used_traffic ? item.used_traffic : 0);
					if (!isFinite(used) || used < 0) used = 0;
					total += used;
					if (used > max) max = used;
				});
				var bars = subset.map(function (item, index) {
					var used = Number(item && item.used_traffic ? item.used_traffic : 0);
					if (!isFinite(used) || used < 0) used = 0;
					var h = Math.max(8, Math.round((used / max) * 100));
					var raw = item && item.date ? String(item.date) : "";
					var label = raw.length > 5 ? raw.slice(5) : raw;
					var showLabel = subset.length > 7 ? (index % 2 === 0 || index === subset.length - 1) : true;
					return '<div class="rb-bar"><span class="rb-bar-fill" style="height:' + h + '%"></span>' + (showLabel ? '<span class="rb-bar-label">' + label + "</span>" : "") + "</div>";
				}).join("");
				target.innerHTML = '<div class="rb-bars">' + bars + '</div><div class="rb-foot">' + translate("rangeTotal") + ": " + formatBytes(total) + "</div>";
			});
		}
		function fetchUsage(startIso, endIso) { chartTargets.forEach(function (target) { target.innerHTML = '<p class="rb-empty">' + translate("loadingUsage") + "</p>"; }); fetch(makeUsageUrl(startIso, endIso), { headers: { Accept: "application/json" } }).then(function (res) { if (!res.ok) throw new Error("usage"); return res.json(); }).then(function (payload) { var points = payload && Array.isArray(payload.usages) ? payload.usages : []; renderUsage(points); }).catch(function () { chartTargets.forEach(function (target) { target.innerHTML = '<p class="rb-empty">' + translate("usageDataUnavailable") + "</p>"; }); }); }
		var defaultDays = Number(chartTargets[0].getAttribute("data-default-days") || config.chart.defaultRangeDays || 30);
		if (!isFinite(defaultDays) || defaultDays <= 0) defaultDays = 30;
		if (config.chart.enableDateControls) updateDateInputs(defaultDays);
		var initialStart = config.chart.enableDateControls && rangeStartInput ? toIso(rangeStartInput.value, false) : "";
		var initialEnd = config.chart.enableDateControls && rangeEndInput ? toIso(rangeEndInput.value, true) : "";
		fetchUsage(initialStart, initialEnd);
		rangeButtons.forEach(function (button) {
			button.addEventListener("click", function () {
				var days = Number(button.getAttribute("data-range-days") || "30");
				if (!isFinite(days) || days <= 0) return;
				rangeButtons.forEach(function (node) { node.classList.remove("is-active"); });
				button.classList.add("is-active");
				updateDateInputs(days);
				var startIso = rangeStartInput ? toIso(rangeStartInput.value, false) : "";
				var endIso = rangeEndInput ? toIso(rangeEndInput.value, true) : "";
				fetchUsage(startIso, endIso);
			});
		});
		var applyRange = document.querySelector("[data-apply-range]");
		if (applyRange) {
			applyRange.addEventListener("click", function () {
				var startIso = rangeStartInput ? toIso(rangeStartInput.value, false) : "";
				var endIso = rangeEndInput ? toIso(rangeEndInput.value, true) : "";
				fetchUsage(startIso, endIso);
			});
		}
		window.addEventListener("resize", function () {
			if (latestUsagePoints.length > 0) {
				renderUsage(latestUsagePoints);
			}
		});
	}

	if (document.querySelector("[data-online-card]") || document.querySelector("[data-expire-card]")) {
		window.setInterval(function () {
			refreshOnlineStatus();
			refreshExpireDetails();
		}, 60000);
	}
})();
</script>
</body>
</html>`;
};

const buildPreviewHtml = (
	widgets: BuilderWidget[],
	options: BuilderOptions,
	previewDevice: PreviewDevice,
): string => {
	let html = buildTemplateHtml(widgets, options);
	const mockExpireTs = Math.floor(Date.now() / 1000) + 18 * 86400;
	const mockCreatedIso = new Date(Date.now() - 27 * 86400000).toISOString();
	const mockOnlineIso = new Date(Date.now() - 3 * 60000).toISOString();
	const mockLink = "vless://example@1.1.1.1:443?type=tcp&security=tls#Rebecca%20Config";
	const replacements: Array<[RegExp, string]> = [
		[/\{\{\s*user\.username\s*\}\}/g, "demo-user"],
		[/\{\{\s*usage_url\s*\}\}/g, "/api/usage"],
		[/\{\{\s*support_url\s*\}\}/g, "https://example.com/support"],
		[/\{\{\s*user\.status\.value\s*\}\}/g, "active"],
		[/\{\{\s*user\.expire\s*\}\}/g, String(mockExpireTs)],
		[/\{\{\s*user\.created_at\.isoformat\(\)\s*\}\}/g, mockCreatedIso],
		[/\{\{\s*user\.online_at\.isoformat\(\)\s*\}\}/g, mockOnlineIso],
		[/\{\{\s*user\.used_traffic\s*\|\s*bytesformat\s*\}\}/g, "14.2 GB"],
		[/\{\{\s*user\.data_limit\s*\|\s*bytesformat\s*\}\}/g, "40 GB"],
		[
			/\{\{\s*rb_usage_percent\s*\|\s*round\(\s*0\s*,\s*["']floor["']\s*\)\s*\|\s*int\s*\}\}/g,
			"35",
		],
		[/\{\{\s*link\s*\}\}/g, mockLink],
		[/\{\{\s*loop\.index\s*\}\}/g, "1"],
		[/\{\{\s*loop\.index0\s*\}\}/g, "0"],
	];
	for (const [pattern, value] of replacements) {
		html = html.replace(pattern, value);
	}
	html = html.replace(/{%[\s\S]*?%}/g, "");
	html = html.replace(/\{\{\s*[^}]+\s*\}\}/g, "");
	const touchMode = previewDevice === "mobile" || previewDevice === "tablet";
	const previewBaseStyle = `<style id="rb-preview-base">html,body{height:100%;min-height:100%;margin:0;background:#0f172a;}body{overflow-y:auto;overflow-x:hidden;}main.rb-page{min-height:100%;}${
		touchMode
			? `html,body,.rb-page{touch-action:manipulation;-webkit-tap-highlight-color:transparent;}body.rb-preview-touch .rb-btn,body.rb-preview-touch .rb-app-tab,body.rb-preview-touch .rb-user-trigger,body.rb-preview-touch .rb-menu-item{cursor:default !important;}`
			: ""
	}</style>`;
	const previewRuntimeFlags = `<script id="rb-preview-flags">window.__RB_PREVIEW_DEVICE=${JSON.stringify(
		previewDevice,
	)};window.__RB_PREVIEW_TOUCH=${touchMode ? "true" : "false"};</script>`;
	if (html.includes("</head>")) {
		html = html.replace("</head>", `${previewBaseStyle}${previewRuntimeFlags}</head>`);
	}
	return html;
};

export const SubscriptionTemplateCreator = ({ onSaved }: CreatorProps) => {
	const { t } = useTranslation();
	const toast = useToast();
	const [widgets, setWidgets] = useState<BuilderWidget[]>([]);
	const [options, setOptions] = useState<BuilderOptions>(DEFAULT_OPTIONS);
	const [isLoading, setIsLoading] = useState<boolean>(true);
	const [isSaving, setIsSaving] = useState<boolean>(false);
	const [isDropActive, setIsDropActive] = useState<boolean>(false);
	const [externalTemplate, setExternalTemplate] = useState<boolean>(false);
	const [activeWidgetId, setActiveWidgetId] = useState<string | null>(null);
	const [isPreviewOpen, setIsPreviewOpen] = useState<boolean>(false);
	const [previewDevice, setPreviewDevice] = useState<PreviewDevice>("desktop");
	const [previewHtml, setPreviewHtml] = useState<string>("");
	const [isCanvasPanning, setIsCanvasPanning] = useState<boolean>(false);
	const [canvasScale, setCanvasScale] = useState<number>(1);
	const [templateMeta, setTemplateMeta] =
		useState<SubscriptionTemplateContentResponse | null>(null);
	const canvasViewportRef = useRef<HTMLDivElement | null>(null);
	const canvasRef = useRef<HTMLDivElement | null>(null);
	const titleDragAreaRef = useRef<HTMLDivElement | null>(null);
	const headerOverlayCanvasRef = useRef<HTMLDivElement | null>(null);
	const titleDragRef = useRef<{
		startClientX: number;
		startClientY: number;
		startOffsetX: number;
		startOffsetY: number;
	} | null>(null);
	const headerTextDragRef = useRef<{
		textId: string;
		startClientX: number;
		startClientY: number;
		startX: number;
		startY: number;
	} | null>(null);
	const canvasPanRef = useRef<{
		startClientX: number;
		startClientY: number;
		startScrollLeft: number;
		startScrollTop: number;
	} | null>(null);

	const widgetMap = useMemo(
		() => new Map<WidgetType, WidgetDef>(WIDGETS.map((entry) => [entry.type, entry])),
		[],
	);
	const hasCanvasOverlap = useMemo(
		() => widgetsHaveAnyOverlap(widgets, options.canvas.width, options.canvas.height),
		[widgets, options.canvas.width, options.canvas.height],
	);
	const previewDeviceConfig = PREVIEW_DEVICES[previewDevice];
	const isTouchPreview = previewDevice === "tablet" || previewDevice === "mobile";
	const scaledCanvasWidth = Math.max(1, Math.round(options.canvas.width * canvasScale));
	const scaledCanvasHeight = Math.max(1, Math.round(options.canvas.height * canvasScale));
	const headerPreviewBackground = useMemo(() => {
		const dark = isHexColor(options.appearance.headerBackgroundDark)
			? options.appearance.headerBackgroundDark
			: "#0b1227";
		const alpha = options.appearance.headerTransparent
			? clamp(options.appearance.headerOpacity, 0, 100) / 100
			: 1;
		return hexToRgba(dark, alpha);
	}, [
		options.appearance.headerBackgroundDark,
		options.appearance.headerOpacity,
		options.appearance.headerTransparent,
	]);

	useEffect(() => {
		if (!isPreviewOpen) {
			setPreviewHtml("");
			return;
		}
		const build = debounce(() => {
			setPreviewHtml(buildPreviewHtml(widgets, options, previewDevice));
		}, 70);
		build();
		return () => {
			build.cancel();
		};
	}, [isPreviewOpen, options, previewDevice, widgets]);

	useEffect(() => {
		const viewport = canvasViewportRef.current;
		if (!viewport) {
			setCanvasScale(1);
			return;
		}
		const computeScale = () => {
			const availableWidth = Math.max(1, viewport.clientWidth - 2);
			const next = clamp(availableWidth / Math.max(1, options.canvas.width), MIN_CANVAS_SCALE, 1);
			setCanvasScale((prev) => (Math.abs(prev - next) < 0.001 ? prev : next));
		};
		computeScale();
		const observer =
			typeof ResizeObserver !== "undefined" ? new ResizeObserver(computeScale) : null;
		observer?.observe(viewport);
		window.addEventListener("resize", computeScale);
		return () => {
			observer?.disconnect();
			window.removeEventListener("resize", computeScale);
		};
	}, [options.canvas.width]);

	const resolveAutoCanvasHeight = useCallback(
		(bounds: WidgetBounds): number => {
			const requestedBottom =
				Math.round(bounds.y) + Math.round(bounds.height) + CANVAS_PADDING;
			if (requestedBottom <= options.canvas.height) {
				return options.canvas.height;
			}
			const snappedNeeded =
				Math.ceil(requestedBottom / INTERACTION_GRID_SNAP) * INTERACTION_GRID_SNAP;
			const snappedStepTarget =
				Math.ceil((options.canvas.height + CANVAS_AUTO_GROW_STEP) / INTERACTION_GRID_SNAP) *
				INTERACTION_GRID_SNAP;
			const nextHeight = clamp(
				Math.max(snappedNeeded, snappedStepTarget),
				MIN_CANVAS_HEIGHT,
				MAX_CANVAS_HEIGHT,
			);
			if (nextHeight > options.canvas.height) {
				setOptions((prev) =>
					prev.canvas.height >= nextHeight
						? prev
						: {
								...prev,
								canvas: {
									...prev.canvas,
									height: nextHeight,
								},
						  },
				);
			}
			return Math.max(options.canvas.height, nextHeight);
		},
		[options.canvas.height],
	);

	const loadTemplate = useCallback(async () => {
		setIsLoading(true);
		try {
			const payload = await getSubscriptionTemplateContent(TEMPLATE_KEY);
			setTemplateMeta(payload);
			const parsed = parseBuilderTemplate(payload.content || "");
			const loadedWidgets =
				parsed.widgets ||
				defaultWidgets(parsed.options.canvas.width, parsed.options.canvas.height);
			setWidgets(loadedWidgets);
			setOptions(parsed.options);
			setExternalTemplate(!parsed.isBuilder && Boolean((payload.content || "").trim()));
		} catch (error) {
			generateErrorMessage(error, toast);
		} finally {
			setIsLoading(false);
		}
	}, [toast]);

	useEffect(() => {
		void loadTemplate();
	}, [loadTemplate]);

	const addWidget = useCallback(
		(
			type: WidgetType,
			dropPosition?: {
				x: number;
				y: number;
			},
		) => {
			setWidgets((prev) => {
				const defaults = buildDefaultBoundsByType(
					[...DEFAULT_LAYOUT, type],
					options.canvas.width,
					options.canvas.height,
				);
				const defaultSize = getDefaultWidgetDimensions(type, options.canvas.width);
				const fallback =
					dropPosition
						? {
							x: dropPosition.x - defaultSize.width / 2,
							y: dropPosition.y - defaultSize.height / 2,
							width: defaultSize.width,
							height: defaultSize.height,
						}
						: defaults[type] || {
							x: CANVAS_PADDING,
							y: CANVAS_PADDING + prev.length * 24,
							...defaultSize,
						};
				const effectiveCanvasHeight = resolveAutoCanvasHeight(fallback);
				const desiredBounds = clampWidgetBoundsToCanvas(
					type,
					fallback,
					options.canvas.width,
					effectiveCanvasHeight,
				);
				const widget = createWidget(
					type,
					options.canvas.width,
					effectiveCanvasHeight,
					desiredBounds,
				);
				return [...prev, widget];
			});
		},
		[options.canvas.width, resolveAutoCanvasHeight],
	);

	const removeWidget = useCallback((widgetId: string) => {
		setWidgets((prev) => prev.filter((item) => item.id !== widgetId));
		setActiveWidgetId((prev) => (prev === widgetId ? null : prev));
	}, []);

	const updateWidgetBounds = useCallback(
		(widgetId: string, nextBounds: WidgetBounds) => {
			const effectiveCanvasHeight = resolveAutoCanvasHeight(nextBounds);
			setWidgets((prev) => {
				const index = prev.findIndex((item) => item.id === widgetId);
				if (index < 0) {
					return prev;
				}
				const current = prev[index];
				const candidate = clampWidgetBoundsToCanvas(
					current.type,
					nextBounds,
					options.canvas.width,
					effectiveCanvasHeight,
				);
				if (
					current.bounds.x === candidate.x &&
					current.bounds.y === candidate.y &&
					current.bounds.width === candidate.width &&
					current.bounds.height === candidate.height
				) {
					return prev;
				}
				const next = [...prev];
				next[index] = {
					...current,
					bounds: candidate,
				};
				return next;
			});
		},
		[options.canvas.width, resolveAutoCanvasHeight],
	);

	const onDragStartLibrary = useCallback(
		(event: DragEvent<HTMLElement>, type: WidgetType) => {
			event.dataTransfer.effectAllowed = "copy";
			event.dataTransfer.setData(DRAG_MIME, JSON.stringify({ widgetType: type }));
		},
		[],
	);

	const onDropCanvas = useCallback(
		(event: DragEvent<HTMLDivElement>) => {
			event.preventDefault();
			setIsDropActive(false);
			try {
				const payload = JSON.parse(event.dataTransfer.getData(DRAG_MIME)) as {
					widgetType?: unknown;
				};
				if (isWidgetType(payload.widgetType)) {
					const canvas = canvasRef.current;
					if (!canvas) {
						addWidget(payload.widgetType);
						return;
					}
					const rect = canvas.getBoundingClientRect();
					if (rect.width <= 0 || rect.height <= 0) {
						addWidget(payload.widgetType);
						return;
					}
					const scaleX = options.canvas.width / rect.width;
					const scaleY = options.canvas.height / rect.height;
					const x = (event.clientX - rect.left) * scaleX;
					const y = (event.clientY - rect.top) * scaleY;
					addWidget(payload.widgetType, { x, y });
				}
			} catch {
				return;
			}
		},
		[addWidget, options.canvas.height, options.canvas.width],
	);

	const resizeCanvas = useCallback((nextWidthRaw: number, nextHeightRaw: number) => {
		const nextWidth = Math.min(
			MAX_CANVAS_WIDTH,
			Math.max(MIN_CANVAS_WIDTH, Math.round(nextWidthRaw)),
		);
		const nextHeight = Math.min(
			MAX_CANVAS_HEIGHT,
			Math.max(MIN_CANVAS_HEIGHT, Math.round(nextHeightRaw)),
		);

		setOptions((prev) => {
			const prevWidth = prev.canvas.width;
			const prevHeight = prev.canvas.height;
			if (prevWidth === nextWidth && prevHeight === nextHeight) {
				return prev;
			}
			const ratioX = nextWidth / prevWidth;
			const ratioY = nextHeight / prevHeight;
			setWidgets((prevWidgets) =>
				prevWidgets.map((widget) => ({
					...widget,
					bounds: clampWidgetBoundsToCanvas(
						widget.type,
						{
							x: widget.bounds.x * ratioX,
							y: widget.bounds.y * ratioY,
							width: widget.bounds.width * ratioX,
							height: widget.bounds.height * ratioY,
						},
						nextWidth,
						nextHeight,
					),
				})),
			);
			return {
				...prev,
				canvas: {
					width: nextWidth,
					height: nextHeight,
				},
			};
		});
	}, []);

	const startCanvasPan = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
		if (event.button !== 0) {
			return;
		}
		const viewport = canvasViewportRef.current;
		if (!viewport) {
			return;
		}
		const target = event.target as HTMLElement | null;
		if (
			target?.closest(
				"[data-builder-widget='1'], .rb-builder-widget, .react-draggable, .react-resizable-handle",
			)
		) {
			return;
		}
		canvasPanRef.current = {
			startClientX: event.clientX,
			startClientY: event.clientY,
			startScrollLeft: viewport.scrollLeft,
			startScrollTop: viewport.scrollTop,
		};
		setIsCanvasPanning(true);
		event.preventDefault();
	}, []);

	const autoScrollCanvasViewport = useCallback((clientY: number) => {
		const viewport = canvasViewportRef.current;
		if (!viewport) {
			return;
		}
		const viewRect = viewport.getBoundingClientRect();
		const edgeThreshold = 48;
		if (clientY > viewRect.bottom - edgeThreshold) {
			viewport.scrollTop += 22;
		} else if (clientY < viewRect.top + edgeThreshold) {
			viewport.scrollTop -= 22;
		}
	}, []);

	useEffect(() => {
		const onMouseMove = (event: MouseEvent) => {
			const pan = canvasPanRef.current;
			const viewport = canvasViewportRef.current;
			if (!pan || !viewport) {
				return;
			}
			const deltaX = event.clientX - pan.startClientX;
			const deltaY = event.clientY - pan.startClientY;
			viewport.scrollLeft = pan.startScrollLeft - deltaX;
			viewport.scrollTop = pan.startScrollTop - deltaY;
		};

		const onMouseUp = () => {
			if (!canvasPanRef.current) {
				return;
			}
			canvasPanRef.current = null;
			setIsCanvasPanning(false);
		};

		window.addEventListener("mousemove", onMouseMove);
		window.addEventListener("mouseup", onMouseUp);
		return () => {
			window.removeEventListener("mousemove", onMouseMove);
			window.removeEventListener("mouseup", onMouseUp);
		};
	}, []);

	useEffect(() => {
		const onMouseMove = (event: MouseEvent) => {
			const drag = titleDragRef.current;
			const area = titleDragAreaRef.current;
			if (!drag || !area) {
				return;
			}
			const areaRect = area.getBoundingClientRect();
			const dx = event.clientX - drag.startClientX;
			const dy = event.clientY - drag.startClientY;
			const nextX = Math.min(
				Math.max(-180, drag.startOffsetX + dx),
				Math.max(-24, areaRect.width - 140),
			);
			const nextY = Math.min(120, Math.max(-80, drag.startOffsetY + dy));
			setOptions((prev) => ({
				...prev,
				appearance: {
					...prev.appearance,
					titleOffsetX: Math.round(nextX),
					titleOffsetY: Math.round(nextY),
				},
			}));
		};

		const onMouseUp = () => {
			titleDragRef.current = null;
		};

		window.addEventListener("mousemove", onMouseMove);
		window.addEventListener("mouseup", onMouseUp);
		return () => {
			window.removeEventListener("mousemove", onMouseMove);
			window.removeEventListener("mouseup", onMouseUp);
		};
	}, []);

	useEffect(() => {
		const onMouseMove = (event: MouseEvent) => {
			const drag = headerTextDragRef.current;
			const area = headerOverlayCanvasRef.current;
			if (!drag || !area) {
				return;
			}
			const areaRect = area.getBoundingClientRect();
			const dx = event.clientX - drag.startClientX;
			const dy = event.clientY - drag.startClientY;
			const nextX = clamp(
				Math.round(drag.startX + dx),
				0,
				Math.max(0, Math.round(areaRect.width) - 32),
			);
			const nextY = clamp(
				Math.round(drag.startY + dy),
				0,
				Math.max(0, Math.round(areaRect.height) - 20),
			);
			setOptions((prev) => ({
				...prev,
				appearance: {
					...prev.appearance,
					headerTexts: prev.appearance.headerTexts.map((item) =>
						item.id === drag.textId
							? {
									...item,
									x: nextX,
									y: nextY,
							  }
							: item,
					),
				},
			}));
		};

		const onMouseUp = () => {
			headerTextDragRef.current = null;
		};

		window.addEventListener("mousemove", onMouseMove);
		window.addEventListener("mouseup", onMouseUp);
		return () => {
			window.removeEventListener("mousemove", onMouseMove);
			window.removeEventListener("mouseup", onMouseUp);
		};
	}, []);

	const handleBackgroundImageUpload = useCallback(
		(event: ChangeEvent<HTMLInputElement>) => {
			const file = event.target.files?.[0];
			event.target.value = "";
			if (!file) {
				return;
			}
			if (!file.type.startsWith("image/")) {
				toast({
					title: t(
						"settings.templates.invalidBackgroundImage",
						"Please select a valid image file.",
					),
					status: "warning",
					duration: 2500,
				});
				return;
			}
			if (file.size > 3 * 1024 * 1024) {
				toast({
					title: t(
						"settings.templates.backgroundImageTooLarge",
						"Image must be smaller than 3MB.",
					),
					status: "warning",
					duration: 2500,
				});
				return;
			}
			const reader = new FileReader();
			reader.onload = () => {
				const dataUrl = typeof reader.result === "string" ? reader.result : "";
				if (!dataUrl.startsWith("data:image/")) {
					toast({
						title: t(
							"settings.templates.invalidBackgroundImage",
							"Please select a valid image file.",
						),
						status: "warning",
						duration: 2500,
					});
					return;
				}
				setOptions((prev) => ({
					...prev,
					appearance: {
						...prev.appearance,
						backgroundImageDataUrl: dataUrl,
						backgroundMode: "image",
					},
				}));
			};
			reader.onerror = () => {
				toast({
					title: t(
						"settings.templates.failedToReadImage",
						"Failed to read selected image.",
					),
					status: "error",
					duration: 2500,
				});
			};
			reader.readAsDataURL(file);
		},
		[t, toast],
	);

	const save = useCallback(async () => {
		if (widgets.length === 0) {
			toast({
				title: t("settings.templates.addAtLeastOne", "Add at least one widget."),
				status: "warning",
				duration: 2500,
			});
			return;
		}
		setIsSaving(true);
		try {
			const content = buildTemplateHtml(widgets, options);
			const updated = await updateSubscriptionTemplateContent(TEMPLATE_KEY, {
				content,
			});
			setTemplateMeta(updated);
			setExternalTemplate(false);
			generateSuccessMessage(
				t("settings.templates.saved", "Template creator saved."),
				toast,
			);
			if (onSaved) {
				onSaved();
			}
		} catch (error) {
			generateErrorMessage(error, toast);
		} finally {
			setIsSaving(false);
		}
	}, [onSaved, options, t, toast, widgets]);

	const resetLayout = useCallback(() => {
		setWidgets(defaultWidgets());
		setOptions(DEFAULT_OPTIONS);
		setActiveWidgetId(null);
	}, []);

	const hasWidget = useCallback(
		(type: WidgetType) => widgets.some((item) => item.type === type),
		[widgets],
	);

	const startTitleDrag = useCallback(
		(event: ReactMouseEvent<HTMLDivElement>) => {
			const area = titleDragAreaRef.current;
			if (!area) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			titleDragRef.current = {
				startClientX: event.clientX,
				startClientY: event.clientY,
				startOffsetX: options.appearance.titleOffsetX ?? 0,
				startOffsetY: options.appearance.titleOffsetY ?? 0,
			};
		},
		[options.appearance.titleOffsetX, options.appearance.titleOffsetY],
	);

	const updateHeaderTexts = useCallback(
		(updater: (prev: HeaderOverlayText[]) => HeaderOverlayText[]) => {
			setOptions((prev) => ({
				...prev,
				appearance: {
					...prev.appearance,
					headerTexts: updater(prev.appearance.headerTexts),
				},
			}));
		},
		[],
	);

	const addHeaderText = useCallback(() => {
		updateHeaderTexts((prev) => {
			if (prev.length >= HEADER_TEXT_MAX_ITEMS) {
				return prev;
			}
			const seed = prev.length + 1;
			const item = createHeaderOverlayText({
				id: `header-text-${seed}`,
				text: `Text ${seed}`,
				x: 12 + (seed % 3) * 22,
				y: 10 + (seed % 2) * 12,
				color: "#ffffff",
				fontSize: 13,
				fontWeight: 600,
			});
			const existingIds = new Set(prev.map((entry) => entry.id));
			let candidate = item.id;
			let counter = 2;
			while (existingIds.has(candidate)) {
				candidate = `${item.id}-${counter}`;
				counter += 1;
			}
			return [...prev, { ...item, id: candidate }];
		});
	}, [updateHeaderTexts]);

	const removeHeaderText = useCallback(
		(textId: string) => {
			updateHeaderTexts((prev) => prev.filter((item) => item.id !== textId));
		},
		[updateHeaderTexts],
	);

	const updateHeaderTextField = useCallback(
		(
			textId: string,
			field: "text" | "x" | "y" | "color" | "fontSize" | "fontWeight",
			value: string,
		) => {
			updateHeaderTexts((prev) =>
				prev.map((item) => {
					if (item.id !== textId) {
						return item;
					}
					if (field === "text") {
						return { ...item, text: value.slice(0, HEADER_TEXT_MAX_LEN) };
					}
					if (field === "color") {
						return { ...item, color: isHexColor(value) ? value : item.color };
					}
					if (field === "fontWeight") {
						const weight = Number(value);
						return {
							...item,
							fontWeight:
								weight === 400 || weight === 500 || weight === 600 || weight === 700
									? (weight as 400 | 500 | 600 | 700)
									: item.fontWeight,
						};
					}
					const numeric = Number(value);
					if (!Number.isFinite(numeric)) {
						return item;
					}
					if (field === "x") {
						return { ...item, x: clamp(Math.round(numeric), 0, 860) };
					}
					if (field === "y") {
						return { ...item, y: clamp(Math.round(numeric), 0, 120) };
					}
					return { ...item, fontSize: clamp(Math.round(numeric), 10, 36) };
				}),
			);
		},
		[updateHeaderTexts],
	);

	const startHeaderTextDrag = useCallback(
		(event: ReactMouseEvent<HTMLDivElement>, textId: string) => {
			const area = headerOverlayCanvasRef.current;
			const item = options.appearance.headerTexts.find((entry) => entry.id === textId);
			if (!area || !item) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			headerTextDragRef.current = {
				textId,
				startClientX: event.clientX,
				startClientY: event.clientY,
				startX: item.x,
				startY: item.y,
			};
		},
		[options.appearance.headerTexts],
	);

	const appImportOsLabel = useCallback(
		(os: AppImportOs) =>
			t(
				APP_IMPORT_OS_LABEL_KEYS[os],
				os === "windows"
					? "Windows"
					: os === "macos"
						? "macOS"
						: os === "ios"
							? "iOS"
							: os === "android"
								? "Android"
								: "Linux",
			),
		[t],
	);

	const updateAppImports = useCallback(
		(updater: (prev: AppImportsOptions) => AppImportsOptions) => {
			setOptions((prev) => ({
				...prev,
				appImports: updater(prev.appImports),
			}));
		},
		[],
	);

	const ensureUniqueAppId = useCallback(
		(candidate: string, currentId: string | null, apps: AppImportApp[]): string => {
			const base = slugifyAppId(candidate, "app");
			if (!apps.some((app) => app.id === base && app.id !== currentId)) {
				return base;
			}
			let counter = 2;
			let next = `${base}-${counter}`;
			while (apps.some((app) => app.id === next && app.id !== currentId)) {
				counter += 1;
				next = `${base}-${counter}`;
			}
			return next;
		},
		[],
	);

	const moveAppImportOsOrder = useCallback(
		(index: number, direction: -1 | 1) => {
			updateAppImports((prev) => {
				const target = index + direction;
				if (target < 0 || target >= prev.osOrder.length) {
					return prev;
				}
				const nextOrder = [...prev.osOrder];
				[nextOrder[index], nextOrder[target]] = [nextOrder[target], nextOrder[index]];
				return {
					...prev,
					osOrder: nextOrder,
				};
			});
		},
		[updateAppImports],
	);

	const addAppImport = useCallback(() => {
		updateAppImports((prev) => {
			const fallbackId = `app-${prev.apps.length + 1}`;
			const id = ensureUniqueAppId(fallbackId, null, prev.apps);
			return {
				...prev,
				apps: [
					...prev.apps,
					{
						id,
						label: "Custom App",
						recommended: false,
						supportedOS: ["android"],
						deepLinkKey: "custom",
						customDeepLinkTemplate: "",
					},
				],
			};
		});
	}, [ensureUniqueAppId, updateAppImports]);

	const removeAppImport = useCallback(
		(appId: string) => {
			updateAppImports((prev) => ({
				...prev,
				apps: prev.apps.filter((app) => app.id !== appId),
			}));
		},
		[updateAppImports],
	);

	const updateAppImportItem = useCallback(
		(appId: string, updater: (app: AppImportApp, apps: AppImportApp[]) => AppImportApp) => {
			updateAppImports((prev) => ({
				...prev,
				apps: prev.apps.map((app) =>
					app.id === appId
						? updater(
								app,
								prev.apps.filter((entry) => entry.id !== appId),
						  )
						: app,
				),
			}));
		},
		[updateAppImports],
	);

	const toggleAppImportSupportedOs = useCallback(
		(appId: string, os: AppImportOs) => {
			updateAppImportItem(appId, (app) => {
				const hasOs = app.supportedOS.includes(os);
				const nextOs = hasOs
					? app.supportedOS.filter((entry) => entry !== os)
					: [...app.supportedOS, os];
				return {
					...app,
					supportedOS: nextOs.length ? nextOs : [os],
				};
			});
		},
		[updateAppImportItem],
	);

	const renderAppImportsSettings = () => (
		<Stack spacing={3}>
			<FormControl display="flex" alignItems="center">
				<FormLabel mb={0} fontSize="sm" flex="1">
					{t(
						"settings.templates.showRecommendedFirst",
						"Show recommended apps first",
					)}
				</FormLabel>
				<Switch
					isChecked={options.appImports.showRecommendedFirst}
					onChange={(event) =>
						updateAppImports((prev) => ({
							...prev,
							showRecommendedFirst: event.target.checked,
						}))
					}
				/>
			</FormControl>
			<FormControl display="flex" alignItems="center">
				<FormLabel mb={0} fontSize="sm" flex="1">
					{t(
						"settings.templates.showAllAppButtons",
						"Show all app buttons",
					)}
				</FormLabel>
				<Switch
					isChecked={options.appImports.showAllButtons}
					onChange={(event) =>
						updateAppImports((prev) => ({
							...prev,
							showAllButtons: event.target.checked,
						}))
					}
				/>
			</FormControl>
			<Box borderWidth="1px" borderRadius="md" p={2}>
				<Text fontSize="sm" fontWeight="semibold" mb={2}>
					{t("settings.templates.appImportsOsOrder", "OS tab order")}
				</Text>
				<Stack spacing={1}>
					{options.appImports.osOrder.map((os, index) => (
						<Flex
							key={`${os}-${index}`}
							align="center"
							justify="space-between"
							gap={2}
						>
							<Badge>{appImportOsLabel(os)}</Badge>
							<HStack spacing={1}>
								<Button
									size="xs"
									variant="outline"
									onClick={() => moveAppImportOsOrder(index, -1)}
									isDisabled={index === 0}
								>
									↑
								</Button>
								<Button
									size="xs"
									variant="outline"
									onClick={() => moveAppImportOsOrder(index, 1)}
									isDisabled={index === options.appImports.osOrder.length - 1}
								>
									↓
								</Button>
							</HStack>
						</Flex>
					))}
				</Stack>
			</Box>
			<Divider />
			<Flex align="center" justify="space-between">
				<Text fontSize="sm" fontWeight="semibold">
					{t("settings.templates.appImportsApps", "Apps")}
				</Text>
				<Button
					size="xs"
					variant="outline"
					leftIcon={<PlusIcon width={12} height={12} />}
					onClick={addAppImport}
				>
					{t("actions.add", "Add")}
				</Button>
			</Flex>
			<Stack spacing={2}>
				{options.appImports.apps.length === 0 ? (
					<Text fontSize="sm" color="gray.500">
						{t("settings.templates.noAppsSelected", "No app button is enabled.")}
					</Text>
				) : null}
				{options.appImports.apps.map((app) => (
					<Box key={app.id} borderWidth="1px" borderRadius="md" p={2}>
						<Stack spacing={2}>
							<SimpleGrid columns={{ base: 1, md: 2 }} spacing={2}>
								<FormControl>
									<FormLabel fontSize="xs" mb={1}>
										{t("settings.templates.appLabel", "Label")}
									</FormLabel>
									<Input
										size="sm"
										value={app.label}
										onChange={(event) =>
											updateAppImportItem(app.id, (current) => ({
												...current,
												label: event.target.value,
											}))
										}
									/>
								</FormControl>
								<FormControl>
									<FormLabel fontSize="xs" mb={1}>
										{t("settings.templates.appId", "ID")}
									</FormLabel>
									<Input
										size="sm"
										value={app.id}
										onChange={(event) =>
											updateAppImportItem(app.id, (current, siblings) => ({
												...current,
												id: ensureUniqueAppId(event.target.value, current.id, siblings),
											}))
										}
									/>
								</FormControl>
								<FormControl>
									<FormLabel fontSize="xs" mb={1}>
										{t("settings.templates.deepLinkKey", "Deep link key")}
									</FormLabel>
									<Select
										size="sm"
										value={app.deepLinkKey}
										onChange={(event) =>
											updateAppImportItem(app.id, (current) => {
												const key = isAppImportDeepLinkKey(event.target.value)
													? event.target.value
													: current.deepLinkKey;
												return {
													...current,
													deepLinkKey: key,
													customDeepLinkTemplate:
														key === "custom"
															? current.customDeepLinkTemplate || ""
															: undefined,
												};
											})
										}
									>
										{APP_IMPORT_DEEPLINK_KEYS.map((key) => (
											<option key={key} value={key}>
												{APP_IMPORT_DEEPLINK_LABELS[key]}
											</option>
										))}
									</Select>
								</FormControl>
								<FormControl display="flex" alignItems="center">
									<FormLabel mb={0} fontSize="xs" flex="1">
										{t("settings.templates.recommended", "Recommended")}
									</FormLabel>
									<Switch
										size="sm"
										isChecked={app.recommended}
										onChange={(event) =>
											updateAppImportItem(app.id, (current) => ({
												...current,
												recommended: event.target.checked,
											}))
										}
									/>
								</FormControl>
							</SimpleGrid>
							{app.deepLinkKey === "custom" ? (
								<FormControl>
									<FormLabel fontSize="xs" mb={1}>
										{t(
											"settings.templates.customDeepLinkTemplate",
											"Custom deep link template ({{url}}, {{name}})",
										)}
									</FormLabel>
									<Input
										size="sm"
										value={app.customDeepLinkTemplate || ""}
										onChange={(event) =>
											updateAppImportItem(app.id, (current) => ({
												...current,
												customDeepLinkTemplate: event.target.value,
											}))
										}
									/>
								</FormControl>
							) : null}
							<Box>
								<Text fontSize="xs" mb={1} color="gray.500">
									{t("settings.templates.supportedOs", "Supported OS")}
								</Text>
								<Flex wrap="wrap" gap={1}>
									{APP_IMPORT_OS_VALUES.map((os) => {
										const active = app.supportedOS.includes(os);
										return (
											<Button
												key={`${app.id}-${os}`}
												size="xs"
												variant={active ? "solid" : "outline"}
												colorScheme={active ? "blue" : undefined}
												onClick={() => toggleAppImportSupportedOs(app.id, os)}
											>
												{appImportOsLabel(os)}
											</Button>
										);
									})}
								</Flex>
							</Box>
							<Flex justify="flex-end">
								<Button
									size="xs"
									variant="ghost"
									colorScheme="red"
									leftIcon={<TrashIcon width={12} height={12} />}
									onClick={() => removeAppImport(app.id)}
								>
									{t("actions.remove", "Remove")}
								</Button>
							</Flex>
						</Stack>
					</Box>
				))}
			</Stack>
		</Stack>
	);

	const renderSettingsAccordionItem = (
		key: string,
		title: string,
		content: ReactNode,
		summary?: string,
	) => (
		<AccordionItem
			key={key}
			borderWidth="1px"
			borderRadius={SETTINGS_CARD_RADIUS}
			overflow="hidden"
		>
			<h2>
				<AccordionButton py={2} px={3}>
					<Box flex="1" textAlign="left">
						<Text fontWeight="semibold" fontSize="sm">
							{title}
						</Text>
						{summary ? (
							<Text fontSize="xs" color="gray.500" mt={0.5}>
								{summary}
							</Text>
						) : null}
					</Box>
					<AccordionIcon />
				</AccordionButton>
			</h2>
			<AccordionPanel
				px={SETTINGS_CARD_PADDING}
				pb={SETTINGS_CARD_PADDING}
				pt={0}
				sx={{
					"& .chakra-input, & .chakra-select": {
						height: "32px",
						fontSize: "sm",
					},
					"& .chakra-form__label": {
						fontSize: "sm",
					},
				}}
			>
				{content}
			</AccordionPanel>
		</AccordionItem>
	);

	return (
		<VStack align="stretch" spacing={4}>
			<Box borderWidth="1px" borderRadius="lg" p={4}>
				<Flex
					justify="space-between"
					align={{ base: "flex-start", md: "center" }}
					gap={3}
					flexDirection={{ base: "column", md: "row" }}
				>
					<VStack align="start" spacing={1}>
						<Text fontWeight="semibold">
							{t("settings.templates.creatorTitle", "Subscription Template Creator")}
						</Text>
						<Text fontSize="sm" color="gray.500">
							{t(
								"settings.templates.creatorHint",
								"Drag cards/charts into canvas. Save to use it for subscription links.",
							)}
						</Text>
						{templateMeta?.template_name ? (
							<Badge colorScheme="blue">{templateMeta?.template_name}</Badge>
						) : null}
						{templateMeta?.resolved_path ? (
							<Text fontSize="sm" color="gray.500">
								{t("settings.templates.path", "Resolved path")}:{" "}
								{templateMeta?.resolved_path}
							</Text>
						) : null}
					</VStack>
					<HStack spacing={2} flexWrap="wrap" justify="flex-end">
						<Button
							size="sm"
							variant="outline"
							leftIcon={<ArrowPathIcon width={16} height={16} />}
							onClick={() => void loadTemplate()}
							isDisabled={isLoading || isSaving}
						>
							{t("actions.refresh", "Refresh")}
						</Button>
						<Button
							size="sm"
							variant="outline"
							onClick={resetLayout}
							isDisabled={isLoading || isSaving}
						>
							{t("actions.reset", "Reset")}
						</Button>
						<Button
							size="sm"
							variant="outline"
							leftIcon={<EyeIcon width={16} height={16} />}
							onClick={() => setIsPreviewOpen(true)}
							isDisabled={isLoading}
						>
							{t("settings.templates.livePreview", "Live Preview")}
						</Button>
						<Button
							size="sm"
							colorScheme="blue"
							onClick={() => void save()}
							isLoading={isSaving}
							isDisabled={isLoading}
						>
							{t("settings.save", "Save")}
						</Button>
					</HStack>
				</Flex>
			</Box>

			{externalTemplate ? (
				<Alert status="warning" borderRadius="lg">
					<AlertIcon />
					<AlertDescription>
						{t(
							"settings.templates.externalTemplate",
							"Current template is manual. Saving here will replace it with creator output.",
						)}
					</AlertDescription>
				</Alert>
			) : null}

			<Box borderWidth="1px" borderRadius="lg" p={4}>
				<Text fontWeight="semibold" mb={3}>
					{t("settings.templates.widgetSettings", "Widget Settings")}
				</Text>
				<Accordion allowMultiple reduceMotion mt={3}>
					{renderSettingsAccordionItem(
						"appearance",
						t("settings.templates.appearanceSettings", "Appearance"),
						(
							<Box
								borderWidth="1px"
								borderRadius={SETTINGS_CARD_RADIUS}
								p={SETTINGS_CARD_PADDING}
							>
						<Text fontWeight="semibold" fontSize="sm" mb={2}>
							{t("settings.templates.appearanceSettings", "Appearance")}
						</Text>
						<Stack spacing={SETTINGS_SECTION_GAP}>
							<SimpleGrid columns={{ base: 1, md: 3 }} spacing={3}>
								<FormControl>
									<FormLabel fontSize="sm">
										{t("settings.templates.pageTitle", "Page title")}
									</FormLabel>
									<Input
										value={options.appearance.pageTitle}
										onChange={(event) =>
											setOptions((prev) => ({
												...prev,
												appearance: {
													...prev.appearance,
													pageTitle: event.target.value,
												},
											}))
										}
									/>
								</FormControl>
								<FormControl>
									<FormLabel fontSize="sm">
										{t("settings.templates.pageSubtitle", "Page subtitle")}
									</FormLabel>
									<Input
										value={options.appearance.pageSubtitle}
										onChange={(event) =>
											setOptions((prev) => ({
												...prev,
												appearance: {
													...prev.appearance,
													pageSubtitle: event.target.value,
												},
											}))
										}
									/>
								</FormControl>
								<FormControl>
									<FormLabel fontSize="sm">
										{t("settings.templates.titlePlacement", "Title placement")}
									</FormLabel>
									<Select
										size={SETTINGS_CONTROL_SIZE}
										value={options.appearance.titlePlacement}
										onChange={(event) =>
											setOptions((prev) => ({
												...prev,
												appearance: {
													...prev.appearance,
													titlePlacement: event.target
														.value as BuilderOptions["appearance"]["titlePlacement"],
												},
											}))
										}
									>
										<option value="left">
											{t("settings.templates.titlePlacementLeft", "Left")}
										</option>
										<option value="center">
											{t("settings.templates.titlePlacementCenter", "Center")}
										</option>
										<option value="hidden">
											{t("settings.templates.titlePlacementHidden", "Hidden")}
										</option>
									</Select>
								</FormControl>
							</SimpleGrid>

							<Box
								borderWidth="1px"
								borderRadius="md"
								p={3}
								bg="gray.50"
								_dark={{ bg: "gray.800", borderColor: "gray.700" }}
							>
								<Flex
									justify="space-between"
									align={{ base: "flex-start", md: "center" }}
									gap={2}
									flexDirection={{ base: "column", md: "row" }}
								>
									<Text fontSize="sm" fontWeight="semibold">
										{t(
											"settings.templates.titlePosition",
											"Title position in header",
										)}
									</Text>
									<HStack spacing={2}>
										<Text fontSize="xs" color="gray.500">
											X: {Math.round(options.appearance.titleOffsetX)} / Y:{" "}
											{Math.round(options.appearance.titleOffsetY)}
										</Text>
										<Button
											size="xs"
											variant="ghost"
											onClick={() =>
												setOptions((prev) => ({
													...prev,
													appearance: {
														...prev.appearance,
														titleOffsetX: 0,
														titleOffsetY: 0,
													},
												}))
											}
										>
											{t("actions.reset", "Reset")}
										</Button>
									</HStack>
								</Flex>
								<Box
									ref={titleDragAreaRef}
									position="relative"
									mt={2}
									h="96px"
									borderWidth="1px"
									borderStyle="dashed"
									borderColor="gray.300"
									borderRadius="md"
									bg="white"
									_dark={{ bg: "gray.900", borderColor: "gray.600" }}
									overflow="hidden"
								>
									<Box
										position="absolute"
										left="12px"
										top="12px"
										maxW="calc(100% - 24px)"
										minW="120px"
										px={2}
										py={1.5}
										borderWidth="1px"
										borderRadius="md"
										borderColor="gray.300"
										bg="white"
										_dark={{ bg: "gray.700", borderColor: "gray.600" }}
										boxShadow="sm"
										transform={`translate(${options.appearance.titleOffsetX}px, ${options.appearance.titleOffsetY}px)`}
										cursor={
											options.appearance.titlePlacement === "hidden"
												? "not-allowed"
												: "grab"
										}
										opacity={options.appearance.titlePlacement === "hidden" ? 0.55 : 1}
										userSelect="none"
										onMouseDown={
											options.appearance.titlePlacement === "hidden"
												? undefined
												: startTitleDrag
										}
									>
										<Text fontSize="xs" fontWeight="semibold" noOfLines={1}>
											{options.appearance.pageTitle ||
												t("settings.templates.pageTitle", "Page title")}
										</Text>
										<Text fontSize="10px" color="gray.500" noOfLines={1}>
											{options.appearance.pageSubtitle ||
												t("settings.templates.pageSubtitle", "Page subtitle")}
										</Text>
									</Box>
								</Box>
								<Text fontSize="xs" color="gray.500" mt={2}>
									{t(
										"settings.templates.titleDragHint",
										"Drag inside the box to reposition title/subtitle. Position is saved in template config.",
									)}
								</Text>
							</Box>

							<Box
								borderWidth="1px"
								borderRadius="md"
								p={3}
								bg="gray.50"
								_dark={{ bg: "gray.800", borderColor: "gray.700" }}
							>
								<Flex justify="space-between" align="center" mb={2} gap={2} flexWrap="wrap">
									<Text fontSize="sm" fontWeight="semibold">
										{t(
											"settings.templates.headerCanvasSettings",
											"Header canvas and style",
										)}
									</Text>
									<Button
										size="xs"
										leftIcon={<PlusIcon width={12} height={12} />}
										onClick={addHeaderText}
										isDisabled={
											options.appearance.headerTexts.length >= HEADER_TEXT_MAX_ITEMS
										}
									>
										{t("settings.templates.addHeaderText", "Add header text")}
									</Button>
								</Flex>

								<SimpleGrid columns={{ base: 1, md: 3 }} spacing={3} mb={2}>
									<FormControl>
										<FormLabel fontSize="sm">
											{t(
												"settings.templates.headerBackgroundLight",
												"Header color (light)",
											)}
										</FormLabel>
										<Input
											type="color"
											p={1}
											h="38px"
											value={options.appearance.headerBackgroundLight}
											onChange={(event) =>
												setOptions((prev) => ({
													...prev,
													appearance: {
														...prev.appearance,
														headerBackgroundLight: event.target.value,
													},
												}))
											}
										/>
									</FormControl>
									<FormControl>
										<FormLabel fontSize="sm">
											{t(
												"settings.templates.headerBackgroundDark",
												"Header color (dark)",
											)}
										</FormLabel>
										<Input
											type="color"
											p={1}
											h="38px"
											value={options.appearance.headerBackgroundDark}
											onChange={(event) =>
												setOptions((prev) => ({
													...prev,
													appearance: {
														...prev.appearance,
														headerBackgroundDark: event.target.value,
													},
												}))
											}
										/>
									</FormControl>
									<FormControl>
										<FormLabel fontSize="sm">
											{t("settings.templates.headerOpacity", "Header opacity")}
										</FormLabel>
										<Input
											type="number"
											size="sm"
											min={0}
											max={100}
											value={options.appearance.headerOpacity}
											onChange={(event) => {
												const next = Number(event.target.value);
												setOptions((prev) => ({
													...prev,
													appearance: {
														...prev.appearance,
														headerOpacity:
															Number.isFinite(next)
																? clamp(Math.round(next), 0, 100)
																: prev.appearance.headerOpacity,
													},
												}));
											}}
										/>
									</FormControl>
								</SimpleGrid>

								<FormControl display="flex" alignItems="center" mb={3}>
									<FormLabel mb={0} fontSize="sm" flex="1">
										{t(
											"settings.templates.headerTransparent",
											"Enable header transparency",
										)}
									</FormLabel>
									<Switch
										size="sm"
										isChecked={options.appearance.headerTransparent}
										onChange={(event) =>
											setOptions((prev) => ({
												...prev,
												appearance: {
													...prev.appearance,
													headerTransparent: event.target.checked,
												},
											}))
										}
									/>
								</FormControl>

								<Box
									ref={headerOverlayCanvasRef}
									position="relative"
									h="96px"
									borderWidth="1px"
									borderStyle="dashed"
									borderColor="gray.300"
									borderRadius="md"
									bg={headerPreviewBackground}
									_dark={{ borderColor: "gray.600" }}
									overflow="hidden"
									mb={2}
								>
									<Flex
										position="absolute"
										left="10px"
										top="10px"
										right="10px"
										justify="space-between"
										align="center"
										pointerEvents="none"
										opacity={0.75}
									>
										<VStack align="start" spacing={0}>
											<Text fontSize="xs" fontWeight="bold" color="white">
												{options.appearance.pageTitle || "Subscription Dashboard"}
											</Text>
											<Text fontSize="10px" color="whiteAlpha.800">
												{options.appearance.pageSubtitle ||
													"Manage your subscription links and usage"}
											</Text>
										</VStack>
										<Text
											fontSize="11px"
											color="white"
											borderWidth="1px"
											borderColor="whiteAlpha.400"
											borderRadius="full"
											px={2}
											py={1}
										>
											{"{{ user.username }}"}
										</Text>
									</Flex>

									{options.appearance.headerTexts.map((item) => (
										<Box
											key={item.id}
											position="absolute"
											left={`${item.x}px`}
											top={`${item.y}px`}
											maxW="calc(100% - 8px)"
											px={1.5}
											py={0.5}
											bg="blackAlpha.300"
											borderRadius="sm"
											color={item.color}
											fontSize={`${item.fontSize}px`}
											fontWeight={item.fontWeight}
											whiteSpace="nowrap"
											overflow="hidden"
											textOverflow="ellipsis"
											cursor="grab"
											userSelect="none"
											onMouseDown={(event) => startHeaderTextDrag(event, item.id)}
										>
											{item.text || t("settings.templates.headerTextEmpty", "Text")}
										</Box>
									))}
								</Box>

								{options.appearance.headerTexts.length === 0 ? (
									<Text fontSize="xs" color="gray.500">
										{t(
											"settings.templates.headerTextHint",
											"Add custom texts for the fixed header, then drag them in this mini canvas.",
										)}
									</Text>
								) : (
									<Stack spacing={2}>
										{options.appearance.headerTexts.map((item) => (
											<Box
												key={item.id}
												borderWidth="1px"
												borderRadius="md"
												p={2}
												bg="white"
												_dark={{ bg: "gray.900", borderColor: "gray.700" }}
											>
												<Flex gap={2} align="center" mb={2}>
													<Input
														size="sm"
														value={item.text}
														onChange={(event) =>
															updateHeaderTextField(item.id, "text", event.target.value)
														}
														placeholder={t(
															"settings.templates.headerTextPlaceholder",
															"Header text",
														)}
													/>
													<IconButton
														size="sm"
														aria-label={t("actions.remove", "Remove")}
														icon={<TrashIcon width={14} height={14} />}
														variant="ghost"
														colorScheme="red"
														onClick={() => removeHeaderText(item.id)}
													/>
												</Flex>
												<SimpleGrid columns={{ base: 2, md: 5 }} spacing={2}>
													<FormControl>
														<FormLabel fontSize="xs" mb={1}>
															X
														</FormLabel>
														<Input
															size="sm"
															type="number"
															value={item.x}
															onChange={(event) =>
																updateHeaderTextField(item.id, "x", event.target.value)
															}
														/>
													</FormControl>
													<FormControl>
														<FormLabel fontSize="xs" mb={1}>
															Y
														</FormLabel>
														<Input
															size="sm"
															type="number"
															value={item.y}
															onChange={(event) =>
																updateHeaderTextField(item.id, "y", event.target.value)
															}
														/>
													</FormControl>
													<FormControl>
														<FormLabel fontSize="xs" mb={1}>
															{t("settings.templates.color", "Color")}
														</FormLabel>
														<Input
															size="sm"
															type="color"
															p={1}
															h="32px"
															value={item.color}
															onChange={(event) =>
																updateHeaderTextField(item.id, "color", event.target.value)
															}
														/>
													</FormControl>
													<FormControl>
														<FormLabel fontSize="xs" mb={1}>
															{t("settings.templates.size", "Size")}
														</FormLabel>
														<Input
															size="sm"
															type="number"
															min={10}
															max={36}
															value={item.fontSize}
															onChange={(event) =>
																updateHeaderTextField(item.id, "fontSize", event.target.value)
															}
														/>
													</FormControl>
													<FormControl>
														<FormLabel fontSize="xs" mb={1}>
															{t("settings.templates.weight", "Weight")}
														</FormLabel>
														<Select
															size="sm"
															value={item.fontWeight}
															onChange={(event) =>
																updateHeaderTextField(item.id, "fontWeight", event.target.value)
															}
														>
															<option value={400}>400</option>
															<option value={500}>500</option>
															<option value={600}>600</option>
															<option value={700}>700</option>
														</Select>
													</FormControl>
												</SimpleGrid>
											</Box>
										))}
									</Stack>
								)}
							</Box>

							<SimpleGrid columns={{ base: 1, md: 3 }} spacing={3}>
								<FormControl>
									<FormLabel fontSize="sm">
										{t(
											"settings.templates.backgroundMode",
											"Background mode",
										)}
									</FormLabel>
									<Select
										value={options.appearance.backgroundMode}
										onChange={(event) =>
											setOptions((prev) => ({
												...prev,
												appearance: {
													...prev.appearance,
													backgroundMode: event.target.value as BuilderOptions["appearance"]["backgroundMode"],
												},
											}))
										}
									>
										<option value="solid">
											{t("settings.templates.bgSolid", "Solid")}
										</option>
										<option value="gradient">
											{t("settings.templates.bgGradient", "Gradient")}
										</option>
										<option value="image">
											{t("settings.templates.bgImage", "Image")}
										</option>
									</Select>
								</FormControl>
								<FormControl>
									<FormLabel fontSize="sm">
										{t("settings.templates.accentColor", "Accent color")}
									</FormLabel>
									<Input
										type="color"
										p={1}
										h="38px"
										value={options.appearance.accentColor || "#2563eb"}
										onChange={(event) =>
											setOptions((prev) => ({
												...prev,
												appearance: {
													...prev.appearance,
													accentColor: event.target.value,
												},
											}))
										}
									/>
								</FormControl>
								<FormControl>
									<FormLabel fontSize="sm">
										{t(
											"settings.templates.backgroundImageUpload",
											"Background image",
										)}
									</FormLabel>
									<Input
										type="file"
										accept="image/*"
										p={1}
										onChange={handleBackgroundImageUpload}
									/>
								</FormControl>
							</SimpleGrid>

							<SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
								<FormControl>
									<FormLabel fontSize="sm">
										{t(
											"settings.templates.lightBackgroundColor",
											"Light background color",
										)}
									</FormLabel>
									<Input
										type="color"
										p={1}
										h="38px"
										value={options.appearance.backgroundLight || "#f4f7fb"}
										onChange={(event) =>
											setOptions((prev) => ({
												...prev,
												appearance: {
													...prev.appearance,
													backgroundLight: event.target.value,
												},
											}))
										}
									/>
								</FormControl>
								<FormControl>
									<FormLabel fontSize="sm">
										{t(
											"settings.templates.darkBackgroundColor",
											"Dark background color",
										)}
									</FormLabel>
									<Input
										type="color"
										p={1}
										h="38px"
										value={options.appearance.backgroundDark || "#0f172a"}
										onChange={(event) =>
											setOptions((prev) => ({
												...prev,
												appearance: {
													...prev.appearance,
													backgroundDark: event.target.value,
												},
											}))
										}
									/>
								</FormControl>
							</SimpleGrid>

							{options.appearance.backgroundMode === "gradient" ? (
								<SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
									<FormControl>
										<FormLabel fontSize="sm">
											{t(
												"settings.templates.lightGradient",
												"Light gradient CSS",
											)}
										</FormLabel>
										<Input
											value={options.appearance.gradientLight}
											onChange={(event) =>
												setOptions((prev) => ({
													...prev,
													appearance: {
														...prev.appearance,
														gradientLight: event.target.value,
													},
												}))
											}
										/>
									</FormControl>
									<FormControl>
										<FormLabel fontSize="sm">
											{t(
												"settings.templates.darkGradient",
												"Dark gradient CSS",
											)}
										</FormLabel>
										<Input
											value={options.appearance.gradientDark}
											onChange={(event) =>
												setOptions((prev) => ({
													...prev,
													appearance: {
														...prev.appearance,
														gradientDark: event.target.value,
													},
												}))
											}
										/>
									</FormControl>
								</SimpleGrid>
							) : null}

							{options.appearance.backgroundImageDataUrl ? (
								<Stack spacing={2}>
									<Box
										as="img"
										src={options.appearance.backgroundImageDataUrl}
										alt="Background preview"
										maxH="140px"
										borderWidth="1px"
										borderRadius="md"
										objectFit="cover"
										w="full"
									/>
									<Button
										size="sm"
										variant="outline"
										alignSelf="flex-start"
										onClick={() =>
											setOptions((prev) => ({
												...prev,
												appearance: {
													...prev.appearance,
													backgroundImageDataUrl: null,
													backgroundMode:
														prev.appearance.backgroundMode === "image"
															? "gradient"
															: prev.appearance.backgroundMode,
												},
											}))
										}
									>
										{t(
											"settings.templates.removeBackgroundImage",
											"Remove background image",
										)}
									</Button>
								</Stack>
							) : (
								<Text fontSize="sm" color="gray.500">
									{t(
										"settings.templates.backgroundImageHint",
										"Upload PNG/JPG/WebP (max 3MB). Selecting an image sets mode to Image.",
									)}
								</Text>
							)}
						</Stack>
							</Box>
						),
						t(
							"settings.templates.appearanceSummary",
							"Title, placement, background and accent.",
						),
					)}

					{hasWidget("links")
						? renderSettingsAccordionItem(
								"config-links",
								t("settings.templates.configLinksSettings", "Config Links"),
								(
									<Box
										borderWidth="1px"
										borderRadius={SETTINGS_CARD_RADIUS}
										p={SETTINGS_CARD_PADDING}
									>
							<Text fontWeight="semibold" fontSize="sm" mb={2}>
								{t("settings.templates.configLinksSettings", "Config Links")}
							</Text>
							<Stack spacing={2}>
								<FormControl display="flex" alignItems="center">
									<FormLabel mb={0} fontSize="sm" flex="1">
										{t(
											"settings.templates.extractConfigNames",
											"Extract and show config names",
										)}
									</FormLabel>
									<Switch
										isChecked={options.configLinks.showConfigNames}
										onChange={(event) =>
											setOptions((prev) => ({
												...prev,
												configLinks: {
													...prev.configLinks,
													showConfigNames: event.target.checked,
												},
											}))
										}
									/>
								</FormControl>
								<FormControl display="flex" alignItems="center">
									<FormLabel mb={0} fontSize="sm" flex="1">
										{t(
											"settings.templates.enableConfigQr",
											"Enable QR modal for each config",
										)}
									</FormLabel>
									<Switch
										isChecked={options.configLinks.enableQrModal}
										onChange={(event) =>
											setOptions((prev) => ({
												...prev,
												configLinks: {
													...prev.configLinks,
													enableQrModal: event.target.checked,
												},
											}))
										}
									/>
								</FormControl>
							</Stack>
									</Box>
								),
								t(
									"settings.templates.configLinksSummary",
									"Name extraction and QR controls.",
								),
						  )
						: null}

					{hasWidget("usage_chart")
						? renderSettingsAccordionItem(
								"usage-chart",
								t("settings.templates.chartSettings", "Usage Chart"),
								(
									<Box
										borderWidth="1px"
										borderRadius={SETTINGS_CARD_RADIUS}
										p={SETTINGS_CARD_PADDING}
									>
							<Text fontWeight="semibold" fontSize="sm" mb={2}>
								{t("settings.templates.chartSettings", "Usage Chart")}
							</Text>
							<Stack spacing={2}>
								<FormControl display="flex" alignItems="center">
									<FormLabel mb={0} fontSize="sm" flex="1">
										{t(
											"settings.templates.enableDateControls",
											"Enable date controls",
										)}
									</FormLabel>
									<Switch
										isChecked={options.chart.enableDateControls}
										onChange={(event) =>
											setOptions((prev) => ({
												...prev,
												chart: {
													...prev.chart,
													enableDateControls: event.target.checked,
												},
											}))
										}
									/>
								</FormControl>
								<FormControl display="flex" alignItems="center">
									<FormLabel mb={0} fontSize="sm" flex="1">
										{t(
											"settings.templates.enableQuickRanges",
											"Show quick range buttons",
										)}
									</FormLabel>
									<Switch
										isChecked={options.chart.showQuickRanges}
										onChange={(event) =>
											setOptions((prev) => ({
												...prev,
												chart: {
													...prev.chart,
													showQuickRanges: event.target.checked,
												},
											}))
										}
										isDisabled={!options.chart.enableDateControls}
									/>
								</FormControl>
								<FormControl display="flex" alignItems="center">
									<FormLabel mb={0} fontSize="sm" flex="1">
										{t(
											"settings.templates.enableCalendar",
											"Show calendar inputs",
										)}
									</FormLabel>
									<Switch
										isChecked={options.chart.showCalendar}
										onChange={(event) =>
											setOptions((prev) => ({
												...prev,
												chart: {
													...prev.chart,
													showCalendar: event.target.checked,
												},
											}))
										}
										isDisabled={!options.chart.enableDateControls}
									/>
								</FormControl>
								<FormControl maxW="220px">
									<FormLabel fontSize="sm">
										{t(
											"settings.templates.defaultRangeDays",
											"Default range (days)",
										)}
									</FormLabel>
									<Input
										type="number"
										min={1}
										max={120}
										value={options.chart.defaultRangeDays}
										onChange={(event) => {
											const next = Number(event.target.value);
											setOptions((prev) => ({
												...prev,
												chart: {
													...prev.chart,
													defaultRangeDays:
														Number.isFinite(next) && next > 0
															? Math.min(120, Math.max(1, Math.round(next)))
															: prev.chart.defaultRangeDays,
												},
											}));
										}}
									/>
								</FormControl>
							</Stack>
									</Box>
								),
								t(
									"settings.templates.chartSummary",
									"Date controls and chart defaults.",
								),
						  )
						: null}

					{renderSettingsAccordionItem(
						"preferences",
						t("settings.templates.preferencesSettings", "Language & Theme"),
						(
							<Box
								borderWidth="1px"
								borderRadius={SETTINGS_CARD_RADIUS}
								p={SETTINGS_CARD_PADDING}
							>
						<Text fontWeight="semibold" fontSize="sm" mb={2}>
							{t("settings.templates.preferencesSettings", "Language & Theme")}
						</Text>
						<Text fontSize="sm" color="gray.500" mb={3}>
							{t(
								"settings.templates.preferencesAlwaysVisibleHint",
								"Language and theme are shown in the username dropdown on the dashboard top bar.",
							)}
						</Text>
						<SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
							<FormControl>
								<FormLabel fontSize="sm">
									{t("settings.templates.defaultLanguage", "Default language")}
								</FormLabel>
								<Select
									value={options.preferences.defaultLanguage}
									onChange={(event) =>
										setOptions((prev) => ({
											...prev,
											preferences: {
												...prev.preferences,
												defaultLanguage: event.target
													.value as PreferencesOptions["defaultLanguage"],
											},
										}))
									}
								>
									<option value="browser">
										{t("settings.templates.browserLanguage", "Browser")}
									</option>
									<option value="en">English</option>
									<option value="fa">فارسی</option>
									<option value="ru">Русский</option>
									<option value="zh">中文</option>
								</Select>
							</FormControl>
							<FormControl>
								<FormLabel fontSize="sm">
									{t("settings.templates.defaultTheme", "Default theme")}
								</FormLabel>
								<Select
									value={options.preferences.defaultTheme}
									onChange={(event) =>
										setOptions((prev) => ({
											...prev,
											preferences: {
												...prev.preferences,
												defaultTheme: event.target
													.value as PreferencesOptions["defaultTheme"],
											},
										}))
									}
								>
									<option value="system">
										{t("settings.templates.themeSystem", "System")}
									</option>
									<option value="light">
										{t("settings.templates.themeLight", "Light")}
									</option>
									<option value="dark">
										{t("settings.templates.themeDark", "Dark")}
									</option>
								</Select>
							</FormControl>
						</SimpleGrid>
							</Box>
						),
						t(
							"settings.templates.preferencesSummary",
							"Default language and theme for first load.",
						),
					)}

					{hasWidget("online_status")
						? renderSettingsAccordionItem(
								"online-status",
								t("settings.templates.onlineSettings", "Online Status"),
								(
									<Box
										borderWidth="1px"
										borderRadius={SETTINGS_CARD_RADIUS}
										p={SETTINGS_CARD_PADDING}
									>
							<Text fontWeight="semibold" fontSize="sm" mb={2}>
								{t("settings.templates.onlineSettings", "Online Status")}
							</Text>
							<FormControl maxW="260px">
								<FormLabel fontSize="sm">
									{t(
										"settings.templates.onlineThresholdMinutes",
										"Online threshold (minutes)",
									)}
								</FormLabel>
								<Input
									type="number"
									min={1}
									max={1440}
									value={options.activity.onlineThresholdMinutes}
									onChange={(event) => {
										const next = Number(event.target.value);
										setOptions((prev) => ({
											...prev,
											activity: {
												...prev.activity,
												onlineThresholdMinutes:
													Number.isFinite(next) && next > 0
														? Math.min(1440, Math.max(1, Math.round(next)))
														: prev.activity.onlineThresholdMinutes,
											},
										}));
									}}
								/>
								<FormHelperText>
									{t(
										"settings.templates.onlineThresholdHint",
										"If the user has activity in this range, they are shown as online.",
									)}
								</FormHelperText>
							</FormControl>
									</Box>
								),
								t(
									"settings.templates.onlineSummary",
									"Threshold for online/offline indicator.",
								),
						  )
						: null}

					{hasWidget("app_imports")
						? renderSettingsAccordionItem(
								"app-imports",
								t("settings.templates.appImportsSettings", "Add To Apps"),
								(
									<Box
										borderWidth="1px"
										borderRadius={SETTINGS_CARD_RADIUS}
										p={SETTINGS_CARD_PADDING}
									>
							<Text fontWeight="semibold" fontSize="sm" mb={2}>
								{t("settings.templates.appImportsSettings", "Add To Apps")}
							</Text>
							{renderAppImportsSettings()}
									</Box>
								),
								t(
									"settings.templates.appImportsSummary",
									"OS order, app list and import actions.",
								),
						  )
						: null}
				</Accordion>
			</Box>

			<Flex gap={4} flexDirection={{ base: "column", lg: "row" }} minW={0}>
				<Box
					borderWidth="1px"
					borderRadius="lg"
					p={4}
					w={{ base: "full", lg: "320px" }}
					flexShrink={0}
				>
					<Text fontWeight="semibold" mb={3}>
						{t("settings.templates.widgets", "Widgets")}
					</Text>
					<Stack spacing={3}>
						{WIDGETS.map((entry) => (
							<Box
								key={entry.type}
								borderWidth="1px"
								borderRadius="md"
								p={3}
								bg="gray.50"
								_dark={{ bg: "gray.800" }}
								draggable
								onDragStart={(event) => onDragStartLibrary(event, entry.type)}
							>
								<Flex justify="space-between" align="start" gap={2}>
									<VStack align="start" spacing={0}>
										<Text fontWeight="semibold" fontSize="sm">
											{entry.label}
										</Text>
										<Text fontSize="sm" color="gray.500">
											{entry.description}
										</Text>
									</VStack>
									<Button
										size="sm"
										variant="outline"
										leftIcon={<PlusIcon width={12} height={12} />}
										onClick={() => addWidget(entry.type)}
									>
										{t("actions.add", "Add")}
									</Button>
								</Flex>
							</Box>
						))}
					</Stack>
				</Box>

				<Box
					flex="1"
					minW={0}
					borderWidth="2px"
					borderStyle="dashed"
					borderColor={isDropActive ? "blue.400" : "gray.300"}
					borderRadius="lg"
					p={4}
					bg={isDropActive ? "blue.50" : "transparent"}
					_dark={{ bg: isDropActive ? "blue.900" : "transparent" }}
					onDragOver={(event) => {
						event.preventDefault();
						event.dataTransfer.dropEffect = "copy";
						setIsDropActive(true);
					}}
					onDragLeave={() => setIsDropActive(false)}
					onDrop={onDropCanvas}
				>
					<Flex justify="space-between" align="center" mb={3}>
						<Text fontWeight="semibold">
							{t("settings.templates.canvas", "Canvas")}
						</Text>
						<HStack spacing={2}>
							<Badge colorScheme="purple">
							{t("settings.templates.count", {
								defaultValue: "{{count}} widgets",
								count: widgets.length,
							})}
							</Badge>
							<Badge colorScheme="green">
								{options.canvas.width}×{options.canvas.height}
							</Badge>
						</HStack>
					</Flex>
					<SimpleGrid columns={{ base: 1, md: 2 }} spacing={3} mb={3}>
						<FormControl>
							<FormLabel fontSize="sm">
								{t("settings.templates.canvasWidth", "Canvas width")}
							</FormLabel>
							<Input
								size="sm"
								type="number"
								min={MIN_CANVAS_WIDTH}
								max={MAX_CANVAS_WIDTH}
								value={options.canvas.width}
								onChange={(event) => {
									const nextWidth = Number(event.target.value);
									if (!Number.isFinite(nextWidth)) {
										return;
									}
									resizeCanvas(nextWidth, options.canvas.height);
								}}
							/>
						</FormControl>
						<FormControl>
							<FormLabel fontSize="sm">
								{t("settings.templates.canvasHeight", "Canvas height")}
							</FormLabel>
							<Input
								size="sm"
								type="number"
								min={MIN_CANVAS_HEIGHT}
								max={MAX_CANVAS_HEIGHT}
								value={options.canvas.height}
								onChange={(event) => {
									const nextHeight = Number(event.target.value);
									if (!Number.isFinite(nextHeight)) {
										return;
									}
									resizeCanvas(options.canvas.width, nextHeight);
								}}
							/>
						</FormControl>
					</SimpleGrid>
					<Text fontSize="sm" color="gray.500" mb={3}>
						{t(
							"settings.templates.canvasHint",
							"Drop widgets here. Drag to move and resize from bottom-right corner. Coordinates are saved.",
						)}
					</Text>
					<Text fontSize="xs" color="gray.500" mb={3}>
						{t(
							"settings.templates.widgetMinHint",
							"Each widget has enforced min/max dimensions to prevent overlap and extreme resizing.",
						)}
					</Text>
					{hasCanvasOverlap ? (
						<Text fontSize="xs" color="orange.500" mb={3}>
							{t(
								"settings.templates.outputOverlapWarning",
								"Some widgets overlap; output will auto-stack to avoid overlap.",
							)}
						</Text>
					) : null}
					{isLoading ? (
						<Flex align="center" justify="center" minH="220px">
							<Spinner />
						</Flex>
					) : widgets.length === 0 ? (
						<Flex
							minH="220px"
							align="center"
							justify="center"
							borderWidth="1px"
							borderRadius="md"
							borderStyle="dashed"
							borderColor="gray.300"
						>
							<Text color="gray.500">
								{t(
									"settings.templates.empty",
									"No widgets yet. Drag from left side or click Add.",
								)}
							</Text>
						</Flex>
					) : (
						<Box
							ref={canvasViewportRef}
							borderWidth="1px"
							borderRadius="md"
							bg="gray.50"
							_dark={{ bg: "gray.900" }}
							w="full"
							h="72vh"
							minH="320px"
							maxH="92vh"
							overflowY="auto"
							overflowX="hidden"
							cursor={isCanvasPanning ? "grabbing" : "grab"}
							onMouseDown={startCanvasPan}
							onContextMenu={(event) => event.preventDefault()}
							onCopy={(event) => event.preventDefault()}
							onCut={(event) => event.preventDefault()}
							userSelect="none"
							style={{ resize: "vertical" }}
						>
							<Box
								position="relative"
								w={`${scaledCanvasWidth}px`}
								h={`${scaledCanvasHeight}px`}
								mx="auto"
							>
								<Box
									ref={canvasRef}
									position="absolute"
									left={0}
									top={0}
									bg="gray.50"
									_dark={{ bg: "gray.900" }}
									w={`${options.canvas.width}px`}
									h={`${options.canvas.height}px`}
									style={{
										transform: `scale(${canvasScale})`,
										transformOrigin: "top left",
									}}
									onMouseDown={(event) => {
										const target = event.target as HTMLElement | null;
										if (target?.closest(".rb-builder-widget, [data-builder-widget='1']")) {
											return;
										}
										setActiveWidgetId(null);
									}}
								>
								{widgets.map((widget) => {
									const def = widgetMap.get(widget.type);
									if (!def) {
										return null;
									}
									const isActive = activeWidgetId === widget.id;
									const minDims = getWidgetMinDimensions(widget.type);
									const maxDims = getWidgetMaxDimensions(
										widget.type,
										options.canvas.width,
										options.canvas.height,
									);
									const nearMin =
										widget.bounds.width <= minDims.width + INTERACTION_GRID_SNAP ||
										widget.bounds.height <= minDims.height + INTERACTION_GRID_SNAP;
									const nearMax =
										widget.bounds.width >= maxDims.width - INTERACTION_GRID_SNAP ||
										widget.bounds.height >= maxDims.height - INTERACTION_GRID_SNAP;

									return (
										<Rnd
											className="rb-builder-widget"
											key={`${widget.id}-${widget.bounds.x}-${widget.bounds.y}-${widget.bounds.width}-${widget.bounds.height}`}
											data-builder-widget="1"
											scale={canvasScale}
											default={{
												x: widget.bounds.x,
												y: widget.bounds.y,
												width: widget.bounds.width,
												height: widget.bounds.height,
											}}
											bounds="parent"
											minWidth={minDims.width}
											minHeight={minDims.height}
											maxWidth={maxDims.width}
											maxHeight={maxDims.height}
											dragGrid={[INTERACTION_GRID_SNAP, INTERACTION_GRID_SNAP]}
											resizeGrid={[INTERACTION_GRID_SNAP, INTERACTION_GRID_SNAP]}
											enableResizing={{ bottomRight: true }}
											dragHandleClassName="rb-widget-drag-handle"
											cancel=".rb-widget-no-drag"
											onDragStart={() => setActiveWidgetId(widget.id)}
											onDrag={(event, data) => {
												const clientY = getPointerClientY(event);
												if (clientY !== null) {
													autoScrollCanvasViewport(clientY);
												}
												resolveAutoCanvasHeight({
													...widget.bounds,
													x: data.x,
													y: data.y,
												});
											}}
											onDragStop={(event, data) => {
												const clientY = getPointerClientY(event);
												if (clientY !== null) {
													autoScrollCanvasViewport(clientY);
												}
												updateWidgetBounds(widget.id, {
													...widget.bounds,
													x: data.x,
													y: data.y,
												});
											}}
											onResizeStart={() => setActiveWidgetId(widget.id)}
											onResize={(event, _direction, ref, _delta, position) => {
												const clientY = getPointerClientY(event);
												if (clientY !== null) {
													autoScrollCanvasViewport(clientY);
												}
												resolveAutoCanvasHeight({
													x: position.x,
													y: position.y,
													width: ref.offsetWidth,
													height: ref.offsetHeight,
												});
											}}
											onResizeStop={(event, _direction, ref, _delta, position) => {
												const clientY = getPointerClientY(event);
												if (clientY !== null) {
													autoScrollCanvasViewport(clientY);
												}
												updateWidgetBounds(widget.id, {
													x: position.x,
													y: position.y,
													width: ref.offsetWidth,
													height: ref.offsetHeight,
												});
											}}
											style={{ zIndex: isActive ? 3 : 1 }}
											resizeHandleStyles={{
												bottomRight: {
													width: "12px",
													height: "12px",
													right: "0px",
													bottom: "0px",
													background: isActive ? "#4299e1" : "#a0aec0",
													borderTopLeftRadius: "4px",
												},
											}}
										>
											<Box
												borderWidth="1px"
												borderColor={isActive ? "blue.400" : "gray.300"}
												borderRadius="md"
												bg="white"
												_dark={{ bg: "gray.800", borderColor: isActive ? "blue.300" : "gray.600" }}
												boxShadow={isActive ? "md" : "sm"}
												outline={
													isActive && nearMin
														? "1px dashed"
														: isActive && nearMax
															? "1px dashed"
															: "none"
												}
												outlineColor={
													isActive && nearMin
														? "orange.400"
														: isActive && nearMax
															? "purple.400"
															: "transparent"
												}
												overflow="hidden"
												w="full"
												h="full"
												onMouseDown={() => setActiveWidgetId(widget.id)}
											>
												<Flex
													className="rb-widget-drag-handle"
													align="center"
													justify="space-between"
													px={2}
													py={1}
													bg={isActive ? "blue.50" : "gray.100"}
													_dark={{ bg: isActive ? "blue.900" : "gray.700" }}
													cursor="grab"
												>
													<Text fontSize="sm" fontWeight="semibold" noOfLines={1}>
														{def.label}
													</Text>
													<IconButton
														className="rb-widget-no-drag"
														size="sm"
														variant="ghost"
														colorScheme="red"
														aria-label="remove"
														icon={<TrashIcon width={12} height={12} />}
														onClick={() => removeWidget(widget.id)}
													/>
												</Flex>
												<Box px={2} py={2} h="calc(100% - 34px)" overflowY="auto">
													<Text fontSize="10px" color="gray.500">
														{def.preview}
													</Text>
													{isActive ? (
														<Stack spacing={2} mt={2}>
															<Text fontSize="10px" color="gray.500">
																x:{Math.round(widget.bounds.x)} y:{Math.round(widget.bounds.y)} w:
																{Math.round(widget.bounds.width)} h:
																{Math.round(widget.bounds.height)}
															</Text>
															<Text fontSize="10px" color="gray.500">
																{t("settings.templates.widgetMinMax", {
																	defaultValue: "Min: {{minW}}x{{minH}} | Max: {{maxW}}x{{maxH}}",
																	minW: minDims.width,
																	minH: minDims.height,
																	maxW: maxDims.width,
																	maxH: maxDims.height,
																})}
															</Text>
															{nearMin || nearMax ? (
																<Text
																	fontSize="10px"
																	color={nearMin ? "orange.500" : "purple.500"}
																>
																	{nearMin
																		? t(
																				"settings.templates.nearMinHint",
																				"Approaching minimum size limit",
																		  )
																		: t(
																				"settings.templates.nearMaxHint",
																				"Approaching maximum size limit",
																		  )}
																</Text>
															) : null}

															{widget.type === "links" ? (
																<>
																	<FormControl display="flex" alignItems="center">
																		<FormLabel mb={0} fontSize="sm" flex="1">
																			{t(
																				"settings.templates.extractConfigNames",
																				"Extract and show config names",
																			)}
																		</FormLabel>
																		<Switch
																			size="sm"
																			isChecked={options.configLinks.showConfigNames}
																			onChange={(event) =>
																				setOptions((prev) => ({
																					...prev,
																					configLinks: {
																						...prev.configLinks,
																						showConfigNames: event.target.checked,
																					},
																				}))
																			}
																		/>
																	</FormControl>
																	<FormControl display="flex" alignItems="center">
																		<FormLabel mb={0} fontSize="sm" flex="1">
																			{t(
																				"settings.templates.enableConfigQr",
																				"Enable QR modal for each config",
																			)}
																		</FormLabel>
																		<Switch
																			size="sm"
																			isChecked={options.configLinks.enableQrModal}
																			onChange={(event) =>
																				setOptions((prev) => ({
																					...prev,
																					configLinks: {
																						...prev.configLinks,
																						enableQrModal: event.target.checked,
																					},
																				}))
																			}
																		/>
																	</FormControl>
																</>
															) : null}

															{widget.type === "usage_chart" ? (
																<>
																	<FormControl display="flex" alignItems="center">
																		<FormLabel mb={0} fontSize="sm" flex="1">
																			{t(
																				"settings.templates.enableDateControls",
																				"Enable date controls",
																			)}
																		</FormLabel>
																		<Switch
																			size="sm"
																			isChecked={options.chart.enableDateControls}
																			onChange={(event) =>
																				setOptions((prev) => ({
																					...prev,
																					chart: {
																						...prev.chart,
																						enableDateControls: event.target.checked,
																					},
																				}))
																			}
																		/>
																	</FormControl>
																	<FormControl display="flex" alignItems="center">
																		<FormLabel mb={0} fontSize="sm" flex="1">
																			{t(
																				"settings.templates.enableQuickRanges",
																				"Show quick range buttons",
																			)}
																		</FormLabel>
																		<Switch
																			size="sm"
																			isDisabled={!options.chart.enableDateControls}
																			isChecked={options.chart.showQuickRanges}
																			onChange={(event) =>
																				setOptions((prev) => ({
																					...prev,
																					chart: {
																						...prev.chart,
																						showQuickRanges: event.target.checked,
																					},
																				}))
																			}
																		/>
																	</FormControl>
																	<FormControl display="flex" alignItems="center">
																		<FormLabel mb={0} fontSize="sm" flex="1">
																			{t(
																				"settings.templates.enableCalendar",
																				"Show calendar inputs",
																			)}
																		</FormLabel>
																		<Switch
																			size="sm"
																			isDisabled={!options.chart.enableDateControls}
																			isChecked={options.chart.showCalendar}
																			onChange={(event) =>
																				setOptions((prev) => ({
																					...prev,
																					chart: {
																						...prev.chart,
																						showCalendar: event.target.checked,
																					},
																				}))
																			}
																		/>
																	</FormControl>
																	<FormControl>
																		<FormLabel fontSize="sm" mb={1}>
																			{t(
																				"settings.templates.defaultRangeDays",
																				"Default range (days)",
																			)}
																		</FormLabel>
																		<Input
																			size="sm"
																			type="number"
																			min={1}
																			max={120}
																			value={options.chart.defaultRangeDays}
																			onChange={(event) => {
																				const next = Number(event.target.value);
																				setOptions((prev) => ({
																					...prev,
																					chart: {
																						...prev.chart,
																						defaultRangeDays:
																							Number.isFinite(next) && next > 0
																								? Math.min(120, Math.max(1, Math.round(next)))
																								: prev.chart.defaultRangeDays,
																					},
																				}));
																			}}
																		/>
																	</FormControl>
																</>
															) : null}

															{widget.type === "online_status" ? (
																<FormControl>
																	<FormLabel fontSize="sm" mb={1}>
																		{t(
																			"settings.templates.onlineThresholdMinutes",
																			"Online threshold (minutes)",
																		)}
																	</FormLabel>
																	<Input
																		size="sm"
																		type="number"
																		min={1}
																		max={1440}
																		value={options.activity.onlineThresholdMinutes}
																		onChange={(event) => {
																			const next = Number(event.target.value);
																			setOptions((prev) => ({
																				...prev,
																				activity: {
																					...prev.activity,
																					onlineThresholdMinutes:
																						Number.isFinite(next) && next > 0
																							? Math.min(
																									1440,
																									Math.max(1, Math.round(next)),
																							  )
																							: prev.activity.onlineThresholdMinutes,
																				},
																			}));
																		}}
																	/>
																</FormControl>
															) : null}

															{widget.type === "app_imports" ? (
																<>{renderAppImportsSettings()}</>
															) : null}
														</Stack>
													) : null}
												</Box>
											</Box>
										</Rnd>
									);
								})}
								</Box>
							</Box>
						</Box>
					)}
				</Box>
			</Flex>

			{isPreviewOpen ? (
				<Box position="fixed" inset={0} zIndex={1400}>
					<Box
						position="absolute"
						inset={0}
						bg="blackAlpha.700"
						onClick={() => setIsPreviewOpen(false)}
					/>
					<Flex
						position="relative"
						h="100dvh"
						align="center"
						justify="center"
						p={{ base: 2, md: 6 }}
					>
						<Box
							w="min(1320px, 100%)"
							h="min(94vh, 980px)"
							bg="gray.900"
							_dark={{ bg: "gray.900", borderColor: "gray.700" }}
							borderWidth="1px"
							borderColor="gray.200"
							borderRadius="xl"
							boxShadow="2xl"
							overflow="hidden"
							display="flex"
							flexDirection="column"
						>
							<Flex
								align="center"
								justify="space-between"
								p={3}
								borderBottomWidth="1px"
								borderColor="gray.200"
								_dark={{ borderColor: "gray.700" }}
								gap={3}
								flexWrap="wrap"
							>
								<HStack spacing={2}>
									{(Object.keys(PREVIEW_DEVICES) as PreviewDevice[]).map((device) => (
										<Button
											key={device}
											size="sm"
											variant={previewDevice === device ? "solid" : "outline"}
											colorScheme={previewDevice === device ? "blue" : undefined}
											onClick={() => setPreviewDevice(device)}
										>
											{t(
												`settings.templates.preview.${device}`,
												PREVIEW_DEVICES[device].label,
											)}
										</Button>
									))}
								</HStack>
								<HStack spacing={2}>
									<Badge colorScheme="green">
										{t("settings.templates.livePreview", "Live Preview")}
									</Badge>
									<Button
										size="sm"
										variant="ghost"
										leftIcon={<XMarkIcon width={16} height={16} />}
										onClick={() => setIsPreviewOpen(false)}
									>
										{t("actions.close", "Close")}
									</Button>
								</HStack>
							</Flex>
							<Box
								flex="1"
								minH={0}
								overflow="hidden"
								p={{ base: 2, md: 4 }}
								bg="gray.900"
								_dark={{ bg: "gray.900" }}
							>
								<Flex h="full" minH={0} align="stretch" justify="center">
									<Box
										w={previewDeviceConfig.width}
										maxW="100%"
										h={previewDeviceConfig.height}
										minH={0}
										borderWidth="1px"
										borderColor="gray.300"
										_dark={{ borderColor: "gray.600" }}
										borderRadius={previewDevice === "mobile" ? "2xl" : "lg"}
										overflow="hidden"
										bg="gray.900"
										boxShadow="xl"
										style={{
											touchAction: isTouchPreview ? "manipulation" : "auto",
										}}
									>
										<Box
											as="iframe"
											key={`subscription-preview-${previewDevice}`}
											title="Subscription template live preview"
											w="full"
											h="full"
											display="block"
											border="0"
											bg="transparent"
											sandbox="allow-scripts allow-same-origin"
											srcDoc={previewHtml}
											style={{
												touchAction: isTouchPreview ? "pan-y pinch-zoom" : "auto",
											}}
										/>
									</Box>
								</Flex>
							</Box>
						</Box>
					</Flex>
				</Box>
			) : null}
		</VStack>
	);
};

