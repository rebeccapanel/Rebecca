import {
  Box,
  Button,
  chakra,
  FormControl,
  FormHelperText,
  FormLabel,
  HStack,
  IconButton,
  Input,
  Menu,
  MenuButton,
  MenuDivider,
  MenuGroup,
  MenuItem,
  MenuList,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  VStack,
  useDisclosure,
  useToast,
  useColorModeValue,
} from "@chakra-ui/react";
import {
  ArrowDownTrayIcon,
  ArrowUturnLeftIcon,
  ArrowUpTrayIcon,
  CheckIcon,
  PencilSquareIcon,
  PlusCircleIcon,
  SparklesIcon,
  SwatchIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import {
  FC,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { updateThemeColor } from "utils/themeColor";
import { useColorMode } from "@chakra-ui/react";

const THEME_KEY = "rb-theme";
const CUSTOM_THEMES_KEY = "rb-custom-themes";

type PaletteVars = Record<string, string>;

type ThemeDefinition = {
  key: string;
  accent: string;
  colorModeTarget?: "light" | "dark";
  className?: string;
};

type ModeConfig = {
  primary: string;
  bg: string;
  surface: string;
};

type CustomTheme = {
  id: string;
  name: string;
  light: ModeConfig;
  dark: ModeConfig;
};

type CustomDraft = {
  name: string;
  light: ModeConfig;
  dark: ModeConfig;
};

type PresetDefinition = {
  key: string;
  light: ModeConfig;
  dark: ModeConfig;
};

type ThemeSelectorProps = {
  /** when true, render a minimal menu (only built-in themes) — used on the login screen */
  minimal?: boolean;
};

const PRIMARY_VARS = [
  "--primary-50",
  "--primary-100",
  "--primary-200",
  "--primary-300",
  "--primary-400",
  "--primary-500",
  "--primary-600",
  "--primary-700",
  "--primary-800",
  "--primary-900",
];

const BUILTIN_THEMES: ThemeDefinition[] = [
  { key: "light", accent: "#f7fafc", colorModeTarget: "light" },
  { key: "dark", accent: "#1a202c", colorModeTarget: "dark", className: "rb-theme-dark" },
  { key: "default", accent: "#396fe4" },
  { key: "ultra-dark", accent: "#319795", className: "rb-theme-ultra-dark" },
  { key: "moontone", accent: "#3b82f6", className: "rb-theme-moontone" },
  { key: "purple", accent: "#7c3aed", className: "rb-theme-purple" },
  { key: "green", accent: "#10b981", className: "rb-theme-green" },
];

const PRESET_THEMES: PresetDefinition[] = [
  {
    key: "sunset",
    light: {
      primary: "#f97316",
      bg: "#fdf5ef",
      surface: "#fff2e5",
    },
    dark: {
      primary: "#fb923c",
      bg: "#1f130c",
      surface: "#2d1a12",
    },
  },
  {
    key: "ocean",
    light: {
      primary: "#0284c7",
      bg: "#f3f9ff",
      surface: "#e7f3ff",
    },
    dark: {
      primary: "#38bdf8",
      bg: "#0b1620",
      surface: "#132233",
    },
  },
  {
    key: "forest",
    light: {
      primary: "#16a34a",
      bg: "#f3faf4",
      surface: "#e8f7ea",
    },
    dark: {
      primary: "#22c55e",
      bg: "#0b1610",
      surface: "#14251a",
    },
  },
];

const DEFAULT_LIGHT_MODE: ModeConfig = {
  primary: "#396fe4",
  bg: "#f6f8ff",
  surface: "#ffffff",
};

const DEFAULT_DARK_MODE: ModeConfig = {
  primary: "#4f46e5",
  bg: "#0f172a",
  surface: "#141f35",
};

const SURFACE_BLEND_LIGHT = 0.14;
const SURFACE_BLEND_DARK = 0.22;

const CheckIconChakra = chakra(CheckIcon, {
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

const PlusIconChakra = chakra(PlusCircleIcon, {
  baseStyle: {
    w: 4,
    h: 4,
  },
});

const PencilIconChakra = chakra(PencilSquareIcon, {
  baseStyle: {
    w: 4,
    h: 4,
  },
});

const TrashIconChakra = chakra(TrashIcon, {
  baseStyle: {
    w: 4,
    h: 4,
  },
});

const SparklesIconChakra = chakra(SparklesIcon, {
  baseStyle: {
    w: 4,
    h: 4,
  },
});

const ArrowUpIconChakra = chakra(ArrowUpTrayIcon, {
  baseStyle: {
    w: 4,
    h: 4,
  },
});

const ArrowDownIconChakra = chakra(ArrowDownTrayIcon, {
  baseStyle: {
    w: 4,
    h: 4,
  },
});

const ResetIconChakra = chakra(ArrowUturnLeftIcon, {
  baseStyle: {
    w: 4,
    h: 4,
  },
});

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

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

const generatePalette = (baseHex: string): PaletteVars => {
  try {
    const { r, g, b } = hexToRgb(baseHex);
    const { h, s, l } = rgbToHsl(r, g, b);
    const stops: [string, number][] = [
      ["50", 0.4],
      ["100", 0.28],
      ["200", 0.18],
      ["300", 0.08],
      ["400", 0.04],
      ["500", 0],
      ["600", -0.06],
      ["700", -0.12],
      ["800", -0.18],
      ["900", -0.26],
    ];

    return stops.reduce<PaletteVars>((acc, [suffix, shift]) => {
      const { r: rr, g: gg, b: bb } = hslToRgb(h, s, clamp(l + shift));
      acc[`--primary-${suffix}`] = rgbToHex(rr, gg, bb);
      return acc;
    }, {});
  } catch {
    return {} as PaletteVars;
  }
};

const mixColors = (hexA: string, hexB: string, weight: number) => {
  const amount = clamp(weight, 0, 1);
  const colorA = hexToRgb(hexA);
  const colorB = hexToRgb(hexB);
  const mixChannel = (channelA: number, channelB: number) => Math.round(channelA * (1 - amount) + channelB * amount);
  return rgbToHex(mixChannel(colorA.r, colorB.r), mixChannel(colorA.g, colorB.g), mixChannel(colorA.b, colorB.b));
};

const deriveSurfaceColor = (bg: string, primary: string, blend: number, fallback: string) => {
  try {
    return mixColors(bg, primary, blend);
  } catch {
    return fallback;
  }
};

const clearInlineVars = () => {
  const root = document.documentElement;
  PRIMARY_VARS.forEach((v) => root.style.removeProperty(v));
  root.style.removeProperty("--bg-light");
  root.style.removeProperty("--bg-dark");
  root.style.removeProperty("--surface-light");
  root.style.removeProperty("--surface-dark");
};

const applyPaletteToRoot = (
  palette: PaletteVars,
  vars: { bgLight: string; bgDark: string; surfaceLight: string; surfaceDark: string }
) => {
  const root = document.documentElement;
  Object.entries(palette).forEach(([key, value]) => root.style.setProperty(key, value));
  root.style.setProperty("--bg-light", vars.bgLight);
  root.style.setProperty("--bg-dark", vars.bgDark);
  root.style.setProperty("--surface-light", vars.surfaceLight);
  root.style.setProperty("--surface-dark", vars.surfaceDark);
};

const generateId = () => {
  try {
    return crypto.randomUUID();
  } catch {
    return Math.random().toString(36).slice(2, 10);
  }
};

const createDefaultDraft = (): CustomDraft => ({
  name: "",
  light: { ...DEFAULT_LIGHT_MODE },
  dark: { ...DEFAULT_DARK_MODE },
});

const sanitizeColor = (value: string, fallback: string) => (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value) ? value : fallback);

export const ThemeSelector: FC<ThemeSelectorProps> = ({ minimal = false }) => {
  const { t } = useTranslation();
  const toast = useToast();
  const { colorMode, toggleColorMode } = useColorMode();
  const createModal = useDisclosure();
  const importModal = useDisclosure();
  const popoverBg = useColorModeValue("surface.light", "surface.dark");
  const popoverHoverBg = useColorModeValue("blackAlpha.50", "whiteAlpha.100");
  const popoverBorder = useColorModeValue("blackAlpha.200", "whiteAlpha.200");
  const primaryText = useColorModeValue("gray.800", "gray.100");
  const secondaryText = useColorModeValue("gray.600", "gray.300");
  const overlayBg = useColorModeValue("blackAlpha.400", "blackAlpha.700");
  const menuGroupStyles = useMemo(
    () => ({
      ".chakra-menu__group__title": {
        fontSize: "xs",
        textTransform: "uppercase",
        letterSpacing: "wider",
        fontWeight: "semibold",
        color: secondaryText,
      },
    }),
    [secondaryText]
  );

  const [active, setActive] = useState<string>(() => {
    try {
      return localStorage.getItem(THEME_KEY) || "default";
    } catch {
      return "default";
    }
  });

  const [customThemes, setCustomThemes] = useState<CustomTheme[]>(() => {
    try {
      const raw = localStorage.getItem(CUSTOM_THEMES_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as CustomTheme[];
      if (!Array.isArray(parsed)) return [];
      return parsed.map((item) => {
        const lightPrimary = sanitizeColor(item.light?.primary || DEFAULT_LIGHT_MODE.primary, DEFAULT_LIGHT_MODE.primary);
        const lightBg = sanitizeColor(item.light?.bg || DEFAULT_LIGHT_MODE.bg, DEFAULT_LIGHT_MODE.bg);
        const lightSurfaceDefault = deriveSurfaceColor(lightBg, lightPrimary, SURFACE_BLEND_LIGHT, DEFAULT_LIGHT_MODE.surface);
        const lightSurface = sanitizeColor(item.light?.surface || lightSurfaceDefault, lightSurfaceDefault);

        const darkPrimary = sanitizeColor(item.dark?.primary || DEFAULT_DARK_MODE.primary, DEFAULT_DARK_MODE.primary);
        const darkBg = sanitizeColor(item.dark?.bg || DEFAULT_DARK_MODE.bg, DEFAULT_DARK_MODE.bg);
        const darkSurfaceDefault = deriveSurfaceColor(darkBg, darkPrimary, SURFACE_BLEND_DARK, DEFAULT_DARK_MODE.surface);
        const darkSurface = sanitizeColor(item.dark?.surface || darkSurfaceDefault, darkSurfaceDefault);

        return {
          id: item.id || generateId(),
          name: item.name || "Custom",
          light: {
            primary: lightPrimary,
            bg: lightBg,
            surface: lightSurface,
          },
          dark: {
            primary: darkPrimary,
            bg: darkBg,
            surface: darkSurface,
          },
        };
      });
    } catch {
      return [];
    }
  });

  const [customDraft, setCustomDraft] = useState<CustomDraft>(createDefaultDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [importPayload, setImportPayload] = useState<string>("");

  useEffect(() => {
    try {
      localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(customThemes));
    } catch {}
  }, [customThemes]);

  useEffect(() => {
    try {
      localStorage.setItem(THEME_KEY, active);
    } catch {}
  }, [active]);

  useEffect(() => {
    if (active.startsWith("custom:")) {
      const exists = customThemes.some((theme) => `custom:${theme.id}` === active);
      if (!exists) setActive("default");
    }
  }, [active, customThemes]);

  useEffect(() => {
    const root = document.documentElement;
    Array.from(root.classList)
      .filter((c) => c.startsWith("rb-theme-"))
      .forEach((c) => root.classList.remove(c));

    clearInlineVars();

    const builtIn = BUILTIN_THEMES.find((theme) => theme.key === active);

    if (builtIn) {
      if (builtIn.className) root.classList.add(builtIn.className);
      updateThemeColor(builtIn.key);
      return;
    }

    if (active.startsWith("custom:")) {
      const theme = customThemes.find((item) => `custom:${item.id}` === active);
      if (!theme) return;
      const modeConfig = colorMode === "dark" ? theme.dark : theme.light;
      const palette = generatePalette(modeConfig.primary);
      applyPaletteToRoot(palette, {
        bgLight: theme.light.bg,
        bgDark: theme.dark.bg,
        surfaceLight: theme.light.surface,
        surfaceDark: theme.dark.surface,
      });
      updateThemeColor("custom", colorMode === "dark" ? theme.dark.bg : theme.light.bg);
    } else {
      updateThemeColor("default");
    }
  }, [active, customThemes, colorMode]);

  const handleSelectBuiltIn = useCallback(
    (theme: ThemeDefinition) => {
      if (theme.colorModeTarget && colorMode !== theme.colorModeTarget) {
        toggleColorMode();
      }
      setActive(theme.key);
    },
    [colorMode, toggleColorMode]
  );

  const handleSelectCustom = (themeId: string) => {
    setActive(`custom:${themeId}`);
  };

  const openCreateModal = (preset?: PresetDefinition) => {
    setEditingId(null);
    if (preset) {
      setCustomDraft({
        name: t(`theme.presets.${preset.key}.name`),
        light: { ...preset.light },
        dark: { ...preset.dark },
      });
    } else {
      setCustomDraft(createDefaultDraft());
    }
    createModal.onOpen();
  };

  const openEditModal = (theme: CustomTheme) => {
    setEditingId(theme.id);
    setCustomDraft({
      name: theme.name,
      light: { ...theme.light },
      dark: { ...theme.dark },
    });
    createModal.onOpen();
  };

  const handleSaveCustom = () => {
    const name = customDraft.name.trim() || t("theme.untitled");
    const lightPrimary = sanitizeColor(customDraft.light.primary, DEFAULT_LIGHT_MODE.primary);
    const lightBg = sanitizeColor(customDraft.light.bg, DEFAULT_LIGHT_MODE.bg);
    const lightSurfaceDefault = deriveSurfaceColor(lightBg, lightPrimary, SURFACE_BLEND_LIGHT, DEFAULT_LIGHT_MODE.surface);
    const lightSurface = sanitizeColor(customDraft.light.surface, lightSurfaceDefault);

    const darkPrimary = sanitizeColor(customDraft.dark.primary, DEFAULT_DARK_MODE.primary);
    const darkBg = sanitizeColor(customDraft.dark.bg, DEFAULT_DARK_MODE.bg);
    const darkSurfaceDefault = deriveSurfaceColor(darkBg, darkPrimary, SURFACE_BLEND_DARK, DEFAULT_DARK_MODE.surface);
    const darkSurface = sanitizeColor(customDraft.dark.surface, darkSurfaceDefault);

    const payload: CustomTheme = {
      id: editingId || generateId(),
      name,
      light: {
        primary: lightPrimary,
        bg: lightBg,
        surface: lightSurface,
      },
      dark: {
        primary: darkPrimary,
        bg: darkBg,
        surface: darkSurface,
      },
    };

    setCustomThemes((prev) => {
      if (editingId) {
        return prev.map((item) => (item.id === editingId ? payload : item));
      }
      return [...prev, payload];
    });

    setActive(`custom:${payload.id}`);
    createModal.onClose();
    setEditingId(null);
    toast({
      status: "success",
      title: t("theme.customSaved"),
    });
  };

  const handleDeleteCustom = (id: string) => {
    setCustomThemes((prev) => prev.filter((item) => item.id !== id));
    if (active === `custom:${id}`) {
      setActive("default");
    }
    toast({ status: "info", title: t("theme.customDeleted") });
  };

  const handleReset = () => {
    setActive("default");
    toast({ status: "info", title: t("theme.resetSuccess") });
  };

  const handleExport = async () => {
    if (!customThemes.length) {
      toast({ status: "warning", title: t("theme.exportEmpty") });
      return;
    }
    const payload = customThemes.map(({ id, ...rest }) => rest);
    const json = JSON.stringify(payload, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      toast({ status: "success", title: t("theme.exportSuccess") });
    } catch {
      try {
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "rebecca-themes.json";
        link.click();
        URL.revokeObjectURL(url);
        toast({ status: "success", title: t("theme.exportSuccessDownload") });
      } catch {
        toast({ status: "error", title: t("theme.exportError") });
      }
    }
  };

  const handleImport = () => {
    try {
      const parsed = JSON.parse(importPayload);
      const array = Array.isArray(parsed) ? parsed : [parsed];
      const sanitized: CustomTheme[] = array
        .map((item) => {
          const lightPrimary = sanitizeColor(item?.light?.primary || DEFAULT_LIGHT_MODE.primary, DEFAULT_LIGHT_MODE.primary);
          const lightBg = sanitizeColor(item?.light?.bg || DEFAULT_LIGHT_MODE.bg, DEFAULT_LIGHT_MODE.bg);
          const lightSurfaceDefault = deriveSurfaceColor(lightBg, lightPrimary, SURFACE_BLEND_LIGHT, DEFAULT_LIGHT_MODE.surface);
          const lightSurface = sanitizeColor(item?.light?.surface || lightSurfaceDefault, lightSurfaceDefault);

          const darkPrimary = sanitizeColor(item?.dark?.primary || DEFAULT_DARK_MODE.primary, DEFAULT_DARK_MODE.primary);
          const darkBg = sanitizeColor(item?.dark?.bg || DEFAULT_DARK_MODE.bg, DEFAULT_DARK_MODE.bg);
          const darkSurfaceDefault = deriveSurfaceColor(darkBg, darkPrimary, SURFACE_BLEND_DARK, DEFAULT_DARK_MODE.surface);
          const darkSurface = sanitizeColor(item?.dark?.surface || darkSurfaceDefault, darkSurfaceDefault);

          return {
            id: generateId(),
            name: (item?.name || "Custom") as string,
            light: {
              primary: lightPrimary,
              bg: lightBg,
              surface: lightSurface,
            },
            dark: {
              primary: darkPrimary,
              bg: darkBg,
              surface: darkSurface,
            },
          };
        })
        .filter((item) => item.name);

      if (!sanitized.length) {
        toast({ status: "warning", title: t("theme.importError") });
        return;
      }

      setCustomThemes((prev) => [...prev, ...sanitized]);
      importModal.onClose();
      setImportPayload("");
      toast({ status: "success", title: t("theme.importSuccess") });
    } catch {
      toast({ status: "error", title: t("theme.importError") });
    }
  };

  const handleCustomMenuAction = useCallback(
    (
      event: ReactMouseEvent<HTMLSpanElement> | ReactKeyboardEvent<HTMLSpanElement>,
      action: () => void
    ) => {
      event.preventDefault();
      event.stopPropagation();
      action();
    },
    []
  );

  const customPreviewLight = useMemo(() => generatePalette(customDraft.light.primary), [customDraft.light.primary]);
  const customPreviewDark = useMemo(() => generatePalette(customDraft.dark.primary), [customDraft.dark.primary]);

  const renderPreviewCard = (mode: "light" | "dark") => {
    const modeConfig = customDraft[mode];
    const palette = mode === "dark" ? customPreviewDark : customPreviewLight;
    const primary = palette["--primary-500"] || modeConfig.primary;
    const subtlePrimary = palette["--primary-300"] || palette["--primary-400"] || primary;
    const textColor = mode === "dark" ? "whiteAlpha.900" : "gray.800";
    const subTextColor = mode === "dark" ? "whiteAlpha.700" : "gray.600";
    const borderColor = mode === "dark" ? "whiteAlpha.200" : "blackAlpha.200";
    const chipBorder = mode === "dark" ? "whiteAlpha.300" : "blackAlpha.100";

    return (
      <Box borderWidth="1px" borderRadius="md" bg={modeConfig.bg} p={4} borderColor={borderColor}>
        <Stack spacing={3}>
          <Text fontWeight="semibold" color={textColor}>
            {mode === "dark" ? t("theme.customPreviewDark") : t("theme.customPreviewLight")}
          </Text>
          <Box borderRadius="lg" bg={modeConfig.surface} p={4} borderWidth="1px" borderColor={borderColor}>
            <Stack spacing={2}>
              <Text fontSize="lg" fontWeight="bold" color={textColor}>
                {t("theme.previewSampleTitle")}
              </Text>
              <Text fontSize="sm" color={subTextColor}>
                {t("theme.previewSampleBody")}
              </Text>
              <Button size="sm" bg={primary} color="white" _hover={{ opacity: 0.9 }} alignSelf="flex-start">
                {t("theme.previewSampleAction")}
              </Button>
              <HStack spacing={2} pt={2}>
                <Box flex="1" h="2" borderRadius="full" bg={subtlePrimary} opacity={0.8} />
                <Box flex="1" h="2" borderRadius="full" bg={primary} opacity={0.9} />
              </HStack>
            </Stack>
          </Box>
          <HStack spacing={1} pt={1} flexWrap="wrap">
            <Box w={6} h={6} borderRadius="sm" bg={modeConfig.bg} borderWidth="1px" borderColor={chipBorder} />
            <Box w={6} h={6} borderRadius="sm" bg={modeConfig.surface} borderWidth="1px" borderColor={chipBorder} />
            {Object.entries(palette).map(([key, value]) => (
              <Box key={key} w={6} h={6} borderRadius="sm" bg={value} borderWidth="1px" borderColor={chipBorder} title={key} />
            ))}
          </HStack>
        </Stack>
      </Box>
    );
  };

  return (
    <>
      <Menu placement="bottom-end">
        <MenuButton as={IconButton} size="sm" variant="outline" icon={<SwatchIconChakra />} position="relative" />
        <MenuList minW="260px" zIndex={9999} bg={popoverBg} color={primaryText} borderColor={popoverBorder}>
          <MenuGroup title={t("theme.builtIn")} sx={menuGroupStyles}>
            {BUILTIN_THEMES.map((theme) => {
              const selected = active === theme.key;
              return (
                <MenuItem
                  key={theme.key}
                  onClick={() => handleSelectBuiltIn(theme)}
                  _hover={{ bg: popoverHoverBg }}
                >
                  <HStack justify="space-between" w="full">
                    <HStack>
                      <Box
                        w="4"
                        h="3"
                        bg={theme.accent}
                        borderRadius="xs"
                        borderWidth="1px"
                        borderColor={popoverBorder}
                      />
                      <Text>{t(`theme.${theme.key}`)}</Text>
                    </HStack>
                    {selected && <CheckIconChakra />}
                  </HStack>
                </MenuItem>
              );
            })}
          </MenuGroup>
          {!minimal && (
            <>
              <MenuDivider borderColor={popoverBorder} />
              <MenuGroup title={t("theme.customGroup")} sx={menuGroupStyles}>
                {customThemes.length ? (
                  customThemes.map((theme) => {
                    const isActive = active === `custom:${theme.id}`;
                    return (
                      <MenuItem
                        key={theme.id}
                        onClick={() => handleSelectCustom(theme.id)}
                        _hover={{ bg: popoverHoverBg }}
                      >
                        <HStack justify="space-between" w="full">
                          <HStack>
                            <Box
                              w="4"
                              h="3"
                              bg="transparent"
                              bgGradient={`linear(to-r, ${theme.light.surface}, ${theme.light.primary})`}
                              borderRadius="xs"
                              borderWidth="1px"
                              borderColor={popoverBorder}
                            />
                            <Text>{theme.name}</Text>
                          </HStack>
                          <HStack spacing={1}>
                            {isActive && <CheckIconChakra />}
                            {[
                              {
                                icon: <PencilIconChakra />,
                                label: t("theme.edit"),
                                onClick: () => openEditModal(theme),
                              },
                              {
                                icon: <TrashIconChakra />,
                                label: t("theme.delete"),
                                onClick: () => handleDeleteCustom(theme.id),
                              },
                            ].map(({ icon, label, onClick: action }) => (
                              <Box
                                key={label}
                                as="span"
                                role="button"
                                tabIndex={0}
                                aria-label={label}
                                onClick={(event: ReactMouseEvent<HTMLSpanElement>) =>
                                  handleCustomMenuAction(event, action)
                                }
                                onKeyDown={(event: ReactKeyboardEvent<HTMLSpanElement>) => {
                                  if (event.key === "Enter" || event.key === " ") {
                                    handleCustomMenuAction(event, action);
                                  }
                                }}
                                cursor="pointer"
                                display="inline-flex"
                                alignItems="center"
                                justifyContent="center"
                                w={6}
                                h={6}
                                borderRadius="md"
                                transition="background-color 0.2s ease"
                                _hover={{
                                  bg: popoverHoverBg,
                                }}
                                _focusVisible={{
                                  outline: "2px solid",
                                  outlineColor: "primary.400",
                                  outlineOffset: "2px",
                                }}
                              >
                                {icon}
                              </Box>
                            ))}
                          </HStack>
                        </HStack>
                      </MenuItem>
                    );
                  })
                ) : (
                  <MenuItem isDisabled>{t("theme.noCustom")}</MenuItem>
                )}
                <MenuItem
                  icon={<PlusIconChakra />}
                  onClick={() => openCreateModal()}
                  _hover={{ bg: popoverHoverBg }}
                >
                  {t("theme.createCustom")}
                </MenuItem>
              </MenuGroup>
              <MenuDivider borderColor={popoverBorder} />
              <MenuItem
                icon={<SparklesIconChakra />}
                onClick={() => openCreateModal(PRESET_THEMES[0])}
                _hover={{ bg: popoverHoverBg }}
              >
                {t("theme.quickPreset")}
              </MenuItem>
              <MenuItem icon={<ArrowUpIconChakra />} onClick={handleExport} _hover={{ bg: popoverHoverBg }}>
                {t("theme.export")}
              </MenuItem>
              <MenuItem icon={<ArrowDownIconChakra />} onClick={() => importModal.onOpen()} _hover={{ bg: popoverHoverBg }}>
                {t("theme.import")}
              </MenuItem>
              <MenuItem icon={<ResetIconChakra />} onClick={handleReset} _hover={{ bg: popoverHoverBg }}>
                {t("theme.reset")}
              </MenuItem>
            </>
          )}
        </MenuList>
      </Menu>

      <Modal isOpen={createModal.isOpen} onClose={createModal.onClose} isCentered size="xl">
        <ModalOverlay bg={overlayBg} backdropFilter="blur(4px)" />
        <ModalContent
          mx={4}
          bg={popoverBg}
          borderColor={popoverBorder}
          borderWidth="1px"
          color={primaryText}
        >
          <ModalHeader color={primaryText}>{editingId ? t("theme.editThemeTitle") : t("theme.customTitle")}</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <VStack spacing={6} align="stretch">
              <FormControl>
                <FormLabel color={secondaryText}>{t("theme.customName")}</FormLabel>
                <Input
                  placeholder={t("theme.customNamePlaceholder") || ""}
                  value={customDraft.name}
                  onChange={(e) => setCustomDraft((prev) => ({ ...prev, name: e.target.value }))}
                />
              </FormControl>

              <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
                {renderPreviewCard("light")}
                {renderPreviewCard("dark")}
              </SimpleGrid>

              <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
                <Stack spacing={4}>
                  <FormControl>
                    <FormLabel color={secondaryText}>{t("theme.lightPrimary")}</FormLabel>
                    <Input
                      type="color"
                      value={customDraft.light.primary}
                      onChange={(e) =>
                        setCustomDraft((prev) => ({
                          ...prev,
                          light: { ...prev.light, primary: e.target.value },
                        }))
                      }
                    />
                    <FormHelperText color={secondaryText}>{t("theme.lightPrimaryHint")}</FormHelperText>
                  </FormControl>
                  <FormControl>
                    <FormLabel color={secondaryText}>{t("theme.lightSurface")}</FormLabel>
                    <Input
                      type="color"
                      value={customDraft.light.surface}
                      onChange={(e) =>
                        setCustomDraft((prev) => ({
                          ...prev,
                          light: { ...prev.light, surface: e.target.value },
                        }))
                      }
                    />
                    <FormHelperText color={secondaryText}>{t("theme.lightSurfaceHint")}</FormHelperText>
                  </FormControl>
                  <FormControl>
                    <FormLabel color={secondaryText}>{t("theme.lightBackground")}</FormLabel>
                    <Input
                      type="color"
                      value={customDraft.light.bg}
                      onChange={(e) =>
                        setCustomDraft((prev) => ({
                          ...prev,
                          light: { ...prev.light, bg: e.target.value },
                        }))
                      }
                    />
                  </FormControl>
                </Stack>
                <Stack spacing={4}>
                  <FormControl>
                    <FormLabel color={secondaryText}>{t("theme.darkPrimary")}</FormLabel>
                    <Input
                      type="color"
                      value={customDraft.dark.primary}
                      onChange={(e) =>
                        setCustomDraft((prev) => ({
                          ...prev,
                          dark: { ...prev.dark, primary: e.target.value },
                        }))
                      }
                    />
                    <FormHelperText color={secondaryText}>{t("theme.darkPrimaryHint")}</FormHelperText>
                  </FormControl>
                  <FormControl>
                    <FormLabel color={secondaryText}>{t("theme.darkSurface")}</FormLabel>
                    <Input
                      type="color"
                      value={customDraft.dark.surface}
                      onChange={(e) =>
                        setCustomDraft((prev) => ({
                          ...prev,
                          dark: { ...prev.dark, surface: e.target.value },
                        }))
                      }
                    />
                    <FormHelperText color={secondaryText}>{t("theme.darkSurfaceHint")}</FormHelperText>
                  </FormControl>
                  <FormControl>
                    <FormLabel color={secondaryText}>{t("theme.darkBackground")}</FormLabel>
                    <Input
                      type="color"
                      value={customDraft.dark.bg}
                      onChange={(e) =>
                        setCustomDraft((prev) => ({
                          ...prev,
                          dark: { ...prev.dark, bg: e.target.value },
                        }))
                      }
                    />
                  </FormControl>
                </Stack>
              </SimpleGrid>

              <Box>
                <HStack mb={2}>
                  <SparklesIconChakra />
                  <Text fontWeight="semibold">{t("theme.presets")}</Text>
                </HStack>
                <SimpleGrid columns={{ base: 1, md: 3 }} spacing={3}>
                  {PRESET_THEMES.map((preset) => (
                    <Button
                      key={preset.key}
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setCustomDraft({
                          name: t(`theme.presets.${preset.key}.name`),
                          light: { ...preset.light },
                          dark: { ...preset.dark },
                        })
                      }
                    >
                      {t(`theme.presets.${preset.key}.name`)}
                    </Button>
                  ))}
                </SimpleGrid>
              </Box>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" mr={3} onClick={createModal.onClose}>
              {t("cancel")}
            </Button>
            <Button colorScheme="primary" onClick={handleSaveCustom}>
              {editingId ? t("theme.customUpdate") : t("theme.customSave")}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal isOpen={importModal.isOpen} onClose={importModal.onClose} size="lg" isCentered>
        <ModalOverlay bg={overlayBg} backdropFilter="blur(4px)" />
        <ModalContent
          mx={4}
          bg={popoverBg}
          borderColor={popoverBorder}
          borderWidth="1px"
          color={primaryText}
        >
          <ModalHeader color={primaryText}>{t("theme.importTitle")}</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <VStack spacing={4} align="stretch">
              <Text fontSize="sm" color={secondaryText}>
                {t("theme.importDescription")}
              </Text>
              <Textarea
                rows={8}
                placeholder={t("theme.importPlaceholder") || ""}
                value={importPayload}
                onChange={(e) => setImportPayload(e.target.value)}
                bg="transparent"
                borderColor={popoverBorder}
                color={primaryText}
              />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" mr={3} onClick={importModal.onClose}>
              {t("cancel")}
            </Button>
            <Button colorScheme="primary" onClick={handleImport}>
              {t("theme.importAction")}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
};

export default ThemeSelector;
