import { extendTheme } from "@chakra-ui/react";
import { mode, type StyleFunctionProps } from "@chakra-ui/theme-tools";

const sharedThemeConfig = {
	config: {
		initialColorMode: "dark",
		useSystemColorMode: false,
	},
	direction: "ltr" as const,
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
			":root": {
				"--primary-50": "#ffe6ed",
				"--primary-100": "#ffb8c9",
				"--primary-200": "#ff88a5",
				"--primary-300": "#fb5a82",
				"--primary-400": "#f42d62",
				"--primary-500": "#e0003c",
				"--primary-600": "#bf0033",
				"--primary-700": "#990029",
				"--primary-800": "#73001f",
				"--primary-900": "#4c0015",
				"--bg-light": "#f8fafc",
				"--bg-dark": "#0a0a0a",
				"--surface-light": "#ffffff",
				"--surface-dark": "#141414",
			},

			".rb-theme-dark": {
				"--rb-panel-bg": "#0a0a0a",
				"--rb-panel-main": "#0a0a0a",
				"--rb-panel-sidebar": "#141414",
				"--rb-panel-surface": "#141414",
				"--rb-panel-elevated": "#1f1f1f",
				"--rb-panel-border": "#262626",
				"--rb-panel-border-strong": "#333333",
				"--rb-panel-text": "#f5f5f5",
				"--rb-panel-text-secondary": "#a3a3a3",
				"--rb-panel-text-muted": "#737373",
				"--bg-light": "#0a0a0a",
				"--bg-dark": "#0a0a0a",
				"--surface-light": "#141414",
				"--surface-dark": "#141414",
			},
			".rb-theme-light": {
				"--rb-panel-bg": "#f8fafc",
				"--rb-panel-main": "#f8fafc",
				"--rb-panel-sidebar": "#ffffff",
				"--rb-panel-surface": "#ffffff",
				"--rb-panel-elevated": "#f1f5f9",
				"--rb-panel-border": "#e2e8f0",
				"--rb-panel-border-strong": "#cbd5e1",
				"--rb-panel-text": "#0f172a",
				"--rb-panel-text-secondary": "#475569",
				"--rb-panel-text-muted": "#94a3b8",
				"--bg-light": "#f8fafc",
				"--bg-dark": "#f8fafc",
				"--surface-light": "#ffffff",
				"--surface-dark": "#ffffff",
			},
			body: {
				backgroundColor: "panel.main",
				color: "panel.text",
				letterSpacing: "tight",
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
				"--bg-dark": "#0a0a0a",
				"--surface-light": "#ffffff",
				"--surface-dark": "#141414",
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
					boxShadow: "none",
					borderRadius: "xl",
				},
			}),
		},
		Modal: {
			baseStyle: (props: StyleFunctionProps) => ({
				dialog: {
					bg: mode("panel.surface", "panel.surface")(props),
					borderWidth: "1px",
					borderColor: mode("panel.border", "panel.border")(props),
					borderRadius: "2xl",
					boxShadow: "xl",
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
						boxShadow: "lg",
						borderRadius: "xl",
					},
					item: {
						bg: "transparent !important",
						color: mode("panel.text", "panel.text")(props),
						borderRadius: "md",
						mx: 2,
						w: "calc(100% - 16px)",
						_hover: {
							bg: `${hoverBg} !important`,
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
					boxShadow: "lg",
					borderRadius: "xl",
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
						bg: mode("panel.elevated", "panel.elevated")(props),
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
					borderRadius: "xl",
					fontSize: "sm",
				},
			},
		},
		Select: {
			baseStyle: {
				field: {
					bg: "panel.surface",
					color: "panel.text",
					borderRadius: "lg",
					_dark: {
						borderColor: "panel.borderStrong",
					},
					_light: {
						borderColor: "panel.borderStrong",
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
				fontWeight: "semibold",
				mb: "1.5",
				_dark: { color: "panel.textSecondary" },
			},
		},
		Input: {
			baseStyle: {
				addon: {
					bg: "panel.elevated",
					borderRadius: "lg",
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
					borderRadius: "lg",
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
					_light: {
						borderColor: "panel.borderStrong",
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
					transition: "all .15s ease-out",
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
					_last: {
						"& > td": {
							_first: {
								borderBottomLeftRadius: "12px",
							},
							_last: {
								borderBottomRightRadius: "12px",
							},
						},
					},
				},
			},
		},
		Button: {
			baseStyle: {
				borderRadius: "lg",
				fontWeight: "semibold",
			},
			variants: {
				outline: (props: StyleFunctionProps) => ({
					borderColor: mode("blackAlpha.300", "whiteAlpha.300")(props),
					_hover: {
						bg: mode("blackAlpha.50", "whiteAlpha.100")(props),
					},
					_active: {
						bg: mode("blackAlpha.100", "whiteAlpha.200")(props),
					},
				}),
			},
		},
	},
};

export const theme = extendTheme(sharedThemeConfig);
export const rtlTheme = extendTheme({ ...sharedThemeConfig, direction: "rtl" });
