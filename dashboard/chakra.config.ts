import { extendTheme } from "@chakra-ui/react";
import { mode, type StyleFunctionProps } from "@chakra-ui/theme-tools";

// The theme uses CSS variables for the primary color palette so we can
// switch named palettes at runtime by toggling a class on documentElement.
// The variables below provide sensible defaults which match the previous
// primary color scale.
export const theme = extendTheme({
	shadows: { outline: "0 0 0 2px var(--chakra-colors-primary-200)" },
	fonts: {
		body: `Arad,Inter,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Oxygen,Ubuntu,Cantarell,Fira Sans,Droid Sans,Helvetica Neue,"Apple Color Emoji","Segoe UI Emoji","Segoe UI Symbol",sans-serif`,
	},
	colors: {
		"light-border": "#d2d2d4",
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
	// global styles: define CSS variables for the default theme and a few
	// alternate named themes. The runtime ThemeSelector will toggle classes
	// like `rb-theme-ultra-dark` on document.documentElement to switch palettes.
	styles: {
		global: {
			":root": {
				"--primary-50": "#9cb7f2",
				"--primary-100": "#88a9ef",
				"--primary-200": "#749aec",
				"--primary-300": "#618ce9",
				"--primary-400": "#4d7de7",
				"--primary-500": "#396fe4",
				"--primary-600": "#3364cd",
				"--primary-700": "#2e59b6",
				"--primary-800": "#284ea0",
				"--primary-900": "#224389",
				"--bg-light": "#f6f8ff",
				"--bg-dark": "#0f172a",
				"--surface-light": "#ffffff",
				"--surface-dark": "#141f35",
			},

			".rb-theme-dark": {
				"--primary-50": "#1a202c",
				"--primary-100": "#2d3748",
				"--primary-200": "#4a5568",
				"--primary-300": "#718096",
				"--primary-400": "#a0aec0",
				"--primary-500": "#cbd5e0",
				"--primary-600": "#e2e8f0",
				"--primary-700": "#f7fafc",
				"--primary-800": "#ffffff",
				"--primary-900": "#ffffff",
				"--bg-light": "#1a202c",
				"--bg-dark": "#0b1524",
				"--surface-light": "#232c3d",
				"--surface-dark": "#121c2c",
			},
			body: {
				backgroundColor: "var(--bg-light)",
			},
			"[data-theme='dark'] body, .chakra-ui-dark body": {
				backgroundColor: "var(--bg-dark)",
			},

			".rb-theme-ultra-dark": {
				"--primary-50": "#e6fffa",
				"--primary-100": "#b2f5ea",
				"--primary-200": "#81e6d9",
				"--primary-300": "#4fd1c5",
				"--primary-400": "#38b2ac",
				"--primary-500": "#319795",
				"--primary-600": "#2c7a7b",
				"--primary-700": "#285e61",
				"--primary-800": "#234e52",
				"--primary-900": "#1b4046",
				"--bg-light": "#edfafa",
				"--bg-dark": "#091212",
				"--surface-light": "#ffffff",
				"--surface-dark": "#0f1f1f",
			},

			".rb-theme-moontone": {
				"--primary-50": "#ebf8ff",
				"--primary-100": "#dbeafe",
				"--primary-200": "#bfdbfe",
				"--primary-300": "#93c5fd",
				"--primary-400": "#60a5fa",
				"--primary-500": "#3b82f6",
				"--primary-600": "#2563eb",
				"--primary-700": "#1d4ed8",
				"--primary-800": "#1e40af",
				"--primary-900": "#172554",
				"--bg-light": "#f5f7ff",
				"--bg-dark": "#0f1930",
				"--surface-light": "#ffffff",
				"--surface-dark": "#172544",
			},

			".rb-theme-purple": {
				"--primary-50": "#f5f3ff",
				"--primary-100": "#ede9fe",
				"--primary-200": "#ddd6fe",
				"--primary-300": "#c4b5fd",
				"--primary-400": "#a78bfa",
				"--primary-500": "#7c3aed",
				"--primary-600": "#6d28d9",
				"--primary-700": "#5b21b6",
				"--primary-800": "#4c1d95",
				"--primary-900": "#3b0f73",
				"--bg-light": "#f8f2ff",
				"--bg-dark": "#1a1031",
				"--surface-light": "#ffffff",
				"--surface-dark": "#261547",
			},

			".rb-theme-green": {
				"--primary-50": "#ecfdf5",
				"--primary-100": "#d1fae5",
				"--primary-200": "#a7f3d0",
				"--primary-300": "#6ee7b7",
				"--primary-400": "#34d399",
				"--primary-500": "#10b981",
				"--primary-600": "#059669",
				"--primary-700": "#047857",
				"--primary-800": "#065f46",
				"--primary-900": "#064e3b",
				"--bg-light": "#eefdf4",
				"--bg-dark": "#071c10",
				"--surface-light": "#ffffff",
				"--surface-dark": "#0f2a18",
			},
		},
	},
	components: {
		Card: {
			baseStyle: (props: StyleFunctionProps) => ({
				container: {
					bg: mode("surface.light", "surface.dark")(props),
					borderWidth: "1px",
					borderColor: mode("blackAlpha.100", "whiteAlpha.200")(props),
					boxShadow: "none",
				},
			}),
		},
		Modal: {
			baseStyle: (props: StyleFunctionProps) => ({
				dialog: {
					bg: mode("surface.light", "surface.dark")(props),
					borderWidth: "1px",
					borderColor: mode("blackAlpha.100", "whiteAlpha.200")(props),
					borderRadius: "lg",
					boxShadow: mode("xl", "dark-lg")(props),
				},
				header: {
					borderBottomWidth: "1px",
					borderColor: mode("blackAlpha.100", "whiteAlpha.200")(props),
				},
				footer: {
					borderTopWidth: "1px",
					borderColor: mode("blackAlpha.100", "whiteAlpha.200")(props),
				},
			}),
		},
		Drawer: {
			baseStyle: (props: StyleFunctionProps) => ({
				dialog: {
					bg: mode("surface.light", "surface.dark")(props),
					borderColor: mode("blackAlpha.100", "whiteAlpha.200")(props),
					borderWidth: "0",
				},
			}),
		},
		Menu: {
			baseStyle: (props: StyleFunctionProps) => {
				const hoverBg = mode("blackAlpha.50", "whiteAlpha.100")(props);
				return {
					list: {
						bg: mode("surface.light", "surface.dark")(props),
						borderWidth: "1px",
						borderColor: mode("blackAlpha.100", "whiteAlpha.200")(props),
						boxShadow: mode("lg", "dark-lg")(props),
					},
					item: {
						bg: "transparent !important",
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
					bg: mode("surface.light", "surface.dark")(props),
					borderWidth: "1px",
					borderColor: mode("blackAlpha.100", "whiteAlpha.200")(props),
					boxShadow: mode("lg", "dark-lg")(props),
				},
				header: {
					borderBottomWidth: "1px",
					borderColor: mode("blackAlpha.100", "whiteAlpha.200")(props),
				},
				footer: {
					borderTopWidth: "1px",
					borderColor: mode("blackAlpha.100", "whiteAlpha.200")(props),
				},
			}),
		},
		Accordion: {
			baseStyle: (props: StyleFunctionProps) => ({
				container: {
					borderTopWidth: "0",
					borderBottomWidth: "1px",
					borderColor: mode("blackAlpha.100", "whiteAlpha.200")(props),
					_last: {
						borderBottomWidth: "1px",
					},
				},
				button: {
					bg: "transparent",
					_hover: {
						bg: mode("blackAlpha.50", "whiteAlpha.100")(props),
					},
					_expanded: {
						bg: mode("blackAlpha.50", "whiteAlpha.100")(props),
					},
				},
				panel: {
					bg: mode("surface.light", "surface.dark")(props),
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
					_dark: {
						borderColor: "gray.600",
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
				_dark: { color: "gray.300" },
			},
		},
		Input: {
			baseStyle: {
				addon: {
					_dark: {
						borderColor: "gray.600",
						_placeholder: {
							color: "gray.500",
						},
					},
				},
				field: {
					_focusVisible: {
						boxShadow: "none",
						borderColor: "primary.200",
						outlineColor: "primary.200",
					},
					_dark: {
						borderColor: "gray.600",
						_disabled: {
							color: "gray.400",
							borderColor: "gray.500",
						},
						_placeholder: {
							color: "gray.500",
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
					background: "#F9FAFB",
					borderColor: "light-border !important",
					borderBottomColor: "light-border !important",
					borderTop: "1px solid ",
					borderTopColor: "light-border !important",
					_first: {
						borderLeft: "1px solid",
						borderColor: "light-border !important",
					},
					_last: {
						borderRight: "1px solid",
						borderColor: "light-border !important",
					},
					_dark: {
						borderColor: "gray.600 !important",
						background: "gray.750",
					},
				},
				td: {
					transition: "all .1s ease-out",
					borderColor: "light-border",
					borderBottomColor: "light-border !important",
					_first: {
						borderLeft: "1px solid",
						borderColor: "light-border",
						_dark: {
							borderColor: "gray.600",
						},
					},
					_last: {
						borderRight: "1px solid",
						borderColor: "light-border",
						_dark: {
							borderColor: "gray.600",
						},
					},
					_dark: {
						borderColor: "gray.600",
						borderBottomColor: "gray.600 !important",
					},
				},
				tr: {
					"&.interactive": {
						cursor: "pointer",
						_hover: {
							"& > td": {
								bg: "gray.200",
							},
							_dark: {
								"& > td": {
									bg: "gray.750",
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
});
