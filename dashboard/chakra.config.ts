import { extendTheme } from "@chakra-ui/react";
import { mode, type StyleFunctionProps } from "@chakra-ui/theme-tools";

// The theme uses CSS variables for the primary color palette so we can
// switch named palettes at runtime by toggling a class on documentElement.
// The variables below provide sensible defaults which match the previous
// primary color scale.
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
		// primary color scale reads from CSS variables so swapping theme is just
		// adding/removing a class that sets a different set of --primary-* vars.
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
	// global styles: panel tokens and primary colors are CSS variables so
	// theme/accent can switch at runtime without remounting the app.
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
				"--rb-panel-bg": "#f4f5f7",
				"--rb-panel-main": "#f7f8fa",
				"--rb-panel-sidebar": "#ffffff",
				"--rb-panel-surface": "#ffffff",
				"--rb-panel-elevated": "#eef0f3",
				"--rb-panel-border": "#d8dce2",
				"--rb-panel-border-strong": "#c2c8d0",
				"--rb-panel-text": "#17191c",
				"--rb-panel-text-secondary": "#4f5661",
				"--rb-panel-text-muted": "#7a828e",
				"--bg-light": "#f4f5f7",
				"--bg-dark": "#f4f5f7",
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
					boxShadow: "none",
					borderRadius: "6px",
				},
			}),
		},
		Modal: {
			baseStyle: (props: StyleFunctionProps) => ({
				dialog: {
					bg: mode("panel.surface", "panel.surface")(props),
					borderWidth: "1px",
					borderColor: mode("panel.border", "panel.border")(props),
					borderRadius: "6px",
					boxShadow: "0 20px 60px rgba(0, 0, 0, 0.42)",
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
						boxShadow: "0 18px 48px rgba(0, 0, 0, 0.38)",
					},
					item: {
						bg: "transparent !important",
						color: mode("panel.text", "panel.text")(props),
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
					boxShadow: "0 18px 48px rgba(0, 0, 0, 0.38)",
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
					borderRadius: "6px",
					fontSize: "sm",
				},
			},
		},
		Select: {
			baseStyle: {
				field: {
					bg: "panel.surface",
					color: "panel.text",
					_dark: {
						borderColor: "panel.borderStrong",
						borderRadius: "6px",
					},
					_light: {
						borderRadius: "6px",
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
