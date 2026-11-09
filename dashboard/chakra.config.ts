import { extendTheme } from "@chakra-ui/react";
import { mode, type StyleFunctionProps } from "@chakra-ui/theme-tools";

const mobileSheetQuery = "@media screen and (max-width: 47.99em)";
const mobileSheet = {
	margin: "auto !important",
	width: "calc(100vw - 32px) !important",
	maxWidth: "min(540px, calc(100vw - 32px)) !important",
	maxHeight: "calc(100dvh - 32px) !important",
	minHeight: "0",
	borderRadius: "20px !important",
	animation: "rb-sheet-up 0.28s cubic-bezier(0.32, 0.72, 0, 1)",
	"&::before": {
		content: '""',
		display: "block",
		width: "36px",
		height: "4.5px",
		borderRadius: "full",
		bg: "panel.borderStrong",
		mx: "auto",
		mt: "8px",
		mb: "4px",
		flexShrink: 0,
		touchAction: "none",
		cursor: "grab",
	},
};

const sharedThemeConfig = {
	config: {
		initialColorMode: "dark",
		useSystemColorMode: false,
	},
	direction: "ltr" as const,
	breakpoints: {
		base: "0px",
		sm: "480px",
		md: "769px",
		lg: "992px",
		xl: "1280px",
		"2xl": "1536px",
	},
	shadows: { outline: "0 0 0 2px var(--chakra-colors-primary-200)" },
	fonts: {
		body: `Arad,Inter,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Oxygen,Ubuntu,Cantarell,Fira Sans,Droid Sans,Helvetica Neue,"Apple Color Emoji","Segoe UI Emoji","Segoe UI Symbol",sans-serif`,
	},
	colors: {
		"light-border": "#d2d2d4",
		panel: {
			app: "var(--rb-panel-bg)",
			main: "var(--rb-panel-main)",
			sidebar: "var(--rb-panel-sidebar)",
			surface: "var(--rb-panel-surface)",
			elevated: "var(--rb-panel-elevated)",
			border: "var(--rb-panel-border)",
			borderStrong: "var(--rb-panel-border-strong)",
			text: "var(--rb-panel-text)",
			textSecondary: "var(--rb-panel-text-secondary)",
			textMuted: "var(--rb-panel-text-muted)",
			accent: "var(--rb-panel-accent)",
			accentHover: "var(--rb-panel-accent-hover)",
			warning: "#f59e0b",
			success: "#22c55e",
			danger: "#ef4444",
		},
		bg: {
			light: "var(--bg-light)",
			dark: "var(--bg-dark)",
		},
		surface: {
			light: "var(--surface-light)",
			dark: "var(--surface-dark)",
		},
		primary: {
			50: "var(--primary-50)",
			100: "var(--primary-100)",
			200: "var(--primary-200)",
			300: "var(--primary-300)",
			400: "var(--primary-400)",
			500: "var(--primary-500)",
			600: "var(--primary-600)",
			700: "var(--primary-700)",
			800: "var(--primary-800)",
			900: "var(--primary-900)",
		},
		gray: {
			750: "#222C3B",
		},
	},
	styles: {
		global: {
			".chakra-modal__overlay": {
				bg: "blackAlpha.500 !important",
				backdropFilter: "none !important",
				WebkitBackdropFilter: "none !important",
			},
			".chakra-modal__content": {
				backgroundColor: "var(--rb-panel-surface) !important",
				color: "var(--rb-panel-text) !important",
				borderColor: "var(--rb-panel-border) !important",
				borderRadius: "16px !important",
				boxShadow: "0 24px 72px rgba(0, 0, 0, 0.46) !important",
			},
			":root": {
				"--primary-50": "#e9effd",
				"--primary-100": "#bacef9",
				"--primary-200": "#8cadf4",
				"--primary-300": "#5d8bf0",
				"--primary-400": "#4177ee",
				"--primary-500": "#2563eb",
				"--primary-600": "#1453dd",
				"--primary-700": "#1147bc",
				"--primary-800": "#0d3792",
				"--primary-900": "#092564",
				"--bg-light": "#101010",
				"--bg-dark": "#101010",
				"--surface-light": "#242424",
				"--surface-dark": "#242424",
			},

			".rb-theme-dark": {
				"--rb-panel-bg": "#101010",
				"--rb-panel-main": "#111111",
				"--rb-panel-sidebar": "#2b2b2b",
				"--rb-panel-surface": "#242424",
				"--rb-panel-elevated": "#2f2f2f",
				"--rb-panel-border": "#3a3a3a",
				"--rb-panel-border-strong": "#4a4a4a",
				"--rb-panel-text": "#f5f5f5",
				"--rb-panel-text-secondary": "#b8b8b8",
				"--rb-panel-text-muted": "#8a8a8a",
				"--bg-light": "#101010",
				"--bg-dark": "#101010",
				"--surface-light": "#242424",
				"--surface-dark": "#242424",
			},
			".rb-theme-light": {
				"--rb-panel-bg": "#f0f2f5",
				"--rb-panel-main": "#f3f5f8",
				"--rb-panel-sidebar": "#ffffff",
				"--rb-panel-surface": "#ffffff",
				"--rb-panel-elevated": "#e2e6eb",
				"--rb-panel-border": "#cbd2d9",
				"--rb-panel-border-strong": "#9aa5b1",
				"--rb-panel-text": "#101318",
				"--rb-panel-text-secondary": "#3e4651",
				"--rb-panel-text-muted": "#626d7a",
				"--bg-light": "#f0f2f5",
				"--bg-dark": "#f0f2f5",
				"--surface-light": "#ffffff",
				"--surface-dark": "#ffffff",
			},
			body: {
				backgroundColor: "panel.main",
				color: "panel.text",
			},
			"[data-theme='dark'] body, .chakra-ui-dark body": {
				backgroundColor: "panel.main",
				color: "panel.text",
			},

			".rb-seasonal-christmas": {
				"--primary-50": "#ffe6e6",
				"--primary-100": "#ffcdd2",
				"--primary-200": "#ef9a9a",
				"--primary-300": "#e57373",
				"--primary-400": "#ef5350",
				"--primary-500": "#d32f2f",
				"--primary-600": "#c62828",
				"--primary-700": "#b71c1c",
				"--primary-800": "#8d0f0f",
				"--primary-900": "#5f0a0a",
				"--bg-light": "#fdf7f2",
				"--bg-dark": "#0b0f19",
				"--surface-light": "#f7eee8",
				"--surface-dark": "#172235",
			},
		},
	},
	components: {
		Card: {
			baseStyle: (props: StyleFunctionProps) => ({
				container: {
					bg: mode("panel.surface", "panel.surface")(props),
					borderWidth: "1px",
					borderColor: mode("panel.border", "panel.border")(props),
					boxShadow: mode("0 1px 3px 0 rgba(0, 0, 0, 0.04)", "0 1px 3px 0 rgba(0, 0, 0, 0.2)")(props),
					borderRadius: "16px",
					transition: "border-color 0.2s ease, box-shadow 0.2s ease, background-color 0.2s ease",
				},
			}),
		},
		Modal: {
			baseStyle: (props: StyleFunctionProps) => ({
				dialogContainer: {
					[mobileSheetQuery]: {
						alignItems: "center !important",
						justifyContent: "center !important",
						padding: "1rem !important",
					},
				},
				dialog: {
					bg: mode("panel.surface", "panel.surface")(props),
					borderWidth: "1px",
					borderColor: mode("panel.border", "panel.border")(props),
					borderRadius: "20px",
					boxShadow: "0 24px 64px rgba(0, 0, 0, 0.42)",
					[mobileSheetQuery]: mobileSheet,
				},
				header: {
					borderBottomWidth: "1px",
					borderColor: mode("panel.border", "panel.border")(props),
				},
				footer: {
					borderTopWidth: "1px",
					borderColor: mode("panel.border", "panel.border")(props),
				},
			}),
		},
		Drawer: {
			baseStyle: (props: StyleFunctionProps) => ({
				dialog: {
					bg: mode("panel.surface", "panel.surface")(props),
					borderColor: mode("panel.border", "panel.border")(props),
					borderWidth: "0",
				},
			}),
		},
		Menu: {
			baseStyle: (props: StyleFunctionProps) => {
				const hoverBg = mode("panel.elevated", "panel.elevated")(props);
				return {
					list: {
						bg: mode("panel.surface", "panel.surface")(props),
						borderWidth: "1px",
						borderColor: mode("panel.border", "panel.border")(props),
						boxShadow: "0 14px 40px rgba(0, 0, 0, 0.32)",
						borderRadius: "14px",
						p: "5px",
					},
					item: {
						bg: "transparent !important",
						borderRadius: "8px",
						h: "34px",
						px: "10px",
						fontSize: "13px",
						fontWeight: "500",
						color: mode("panel.text", "panel.text")(props),
						_hover: {
							md: {
								bg: `${hoverBg} !important`,
							},
						},
						_focus: {
							bg: `${hoverBg} !important`,
						},
						_active: {
							bg: `${hoverBg} !important`,
						},
					},
				};
			},
		},
		Popover: {
			baseStyle: (props: StyleFunctionProps) => ({
				content: {
					bg: mode("panel.surface", "panel.surface")(props),
					borderWidth: "1px",
					borderColor: mode("panel.border", "panel.border")(props),
					boxShadow: "0 14px 40px rgba(0, 0, 0, 0.32)",
					borderRadius: "14px",
				},
				header: {
					borderBottomWidth: "1px",
					borderColor: mode("panel.border", "panel.border")(props),
				},
				footer: {
					borderTopWidth: "1px",
					borderColor: mode("panel.border", "panel.border")(props),
				},
			}),
		},
		Accordion: {
			baseStyle: (props: StyleFunctionProps) => ({
				container: {
					borderTopWidth: "0",
					borderBottomWidth: "1px",
					borderColor: mode("panel.border", "panel.border")(props),
					_last: {
						borderBottomWidth: "1px",
					},
				},
				button: {
					bg: "transparent",
					_hover: {
						md: {
							bg: mode("panel.elevated", "panel.elevated")(props),
						},
					},
					_expanded: {
						bg: mode("panel.elevated", "panel.elevated")(props),
					},
				},
				panel: {
					bg: mode("panel.surface", "panel.surface")(props),
				},
			}),
		},
		Alert: {
			baseStyle: {
				container: {
					borderRadius: "10px",
					fontSize: "sm",
				},
			},
		},
		Select: {
			baseStyle: {
				field: {
					bg: "panel.surface",
					color: "panel.text",
					borderRadius: "10px",
					borderColor: "panel.border",
					_dark: {
						borderColor: "panel.borderStrong",
						borderRadius: "10px",
					},
					_light: {
						borderRadius: "10px",
					},
				},
			},
		},
		FormHelperText: {
			baseStyle: {
				fontSize: "xs",
			},
		},
		FormLabel: {
			baseStyle: {
				fontSize: "sm",
				fontWeight: "medium",
				mb: "1",
				_dark: { color: "panel.textSecondary" },
			},
		},
		Input: {
			baseStyle: {
				addon: {
					bg: "panel.elevated",
					_dark: {
						borderColor: "panel.borderStrong",
						_placeholder: {
							color: "panel.textMuted",
						},
					},
				},
				field: {
					bg: "panel.surface",
					color: "panel.text",
					borderRadius: "10px",
					borderColor: "panel.border",
					_focusVisible: {
						boxShadow: "none",
						borderColor: "primary.500",
						outlineColor: "primary.500",
					},
					_dark: {
						borderColor: "panel.borderStrong",
						_disabled: {
							color: "panel.textMuted",
							borderColor: "panel.border",
						},
						_placeholder: {
							color: "panel.textMuted",
						},
					},
				},
			},
		},
		Table: {
			baseStyle: {
				table: {
					borderCollapse: "separate",
					borderSpacing: 0,
				},
				thead: {
					borderBottomColor: "light-border",
				},
				th: {
					background: "panel.elevated",
					color: "panel.text",
					borderColor: "panel.border !important",
					borderBottomColor: "panel.border !important",
					borderTop: "1px solid ",
					borderTopColor: "panel.border !important",
					_first: {
						borderLeft: "1px solid",
						borderColor: "panel.border !important",
					},
					_last: {
						borderRight: "1px solid",
						borderColor: "panel.border !important",
					},
					_dark: {
						borderColor: "panel.border !important",
						background: "panel.elevated",
					},
				},
				td: {
					transition: "all .1s ease-out",
					borderColor: "panel.border",
					borderBottomColor: "panel.border !important",
					_first: {
						borderLeft: "1px solid",
						borderColor: "panel.border",
						_dark: {
							borderColor: "panel.border",
						},
					},
					_last: {
						borderRight: "1px solid",
						borderColor: "panel.border",
						_dark: {
							borderColor: "panel.border",
						},
					},
					_dark: {
						borderColor: "panel.border",
						borderBottomColor: "panel.border !important",
					},
				},
				tr: {
					"&.interactive": {
						cursor: "pointer",
						_hover: {
							md: {
								"& > td": {
									bg: "panel.elevated",
								},
								_dark: {
									"& > td": {
										bg: "panel.elevated",
									},
								},
							},
						},
					},
					_last: {
						"& > td": {
							_first: {
								borderBottomLeftRadius: "8px",
							},
							_last: {
								borderBottomRightRadius: "8px",
							},
						},
					},
				},
			},
		},
		Button: {
			baseStyle: {
				fontWeight: "500",
				borderRadius: "10px",
				transition: "all 0.16s cubic-bezier(0.16, 1, 0.3, 1)",
				_active: { transform: "scale(0.98)" },
				_focusVisible: {
					outline: "2px solid var(--rb-panel-accent)",
					outlineOffset: "2px",
					boxShadow: "none",
				},
			},
			variants: {
				solid: {
					bg: "panel.accent",
					color: "#ffffff",
					_hover: {
						md: {
							opacity: 0.92,
							boxShadow: "0 2px 8px rgba(0, 0, 0, 0.16)",
						},
					},
					_active: {
						opacity: 0.85,
					},
				},
				outline: (props: StyleFunctionProps) => ({
					borderWidth: "1px",
					borderColor: mode("panel.border", "panel.border")(props),
					bg: "transparent",
					color: mode("panel.text", "panel.text")(props),
					_hover: {
						md: {
							bg: mode("panel.elevated", "panel.elevated")(props),
							borderColor: mode("panel.borderStrong", "panel.borderStrong")(props),
						},
					},
					_active: {
						bg: mode("panel.elevated", "panel.elevated")(props),
					},
				}),
				ghost: (props: StyleFunctionProps) => ({
					bg: "transparent",
					color: mode("panel.textSecondary", "panel.textSecondary")(props),
					_hover: {
						md: {
							bg: mode("panel.elevated", "panel.elevated")(props),
							color: mode("panel.text", "panel.text")(props),
						},
					},
					_active: {
						bg: mode("panel.elevated", "panel.elevated")(props),
					},
				}),
				secondary: (props: StyleFunctionProps) => ({
					bg: mode("panel.elevated", "panel.elevated")(props),
					color: mode("panel.text", "panel.text")(props),
					_hover: {
						md: {
							bg: mode("panel.borderStrong", "panel.borderStrong")(props),
						},
					},
				}),
			},
		},
	},
};

export const theme = extendTheme(sharedThemeConfig);
export const rtlTheme = extendTheme({ ...sharedThemeConfig, direction: "rtl" });
