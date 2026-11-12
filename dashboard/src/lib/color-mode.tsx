import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
	type ReactNode,
} from "react";

export type ColorMode = "light" | "dark";

type ColorModeContextValue = {
	colorMode: ColorMode;
	setColorMode: (mode: ColorMode) => void;
	toggleColorMode: () => void;
};

const ColorModeContext = createContext<ColorModeContextValue | null>(null);

/** Reads the saved theme. `rb-theme` is the source of truth; the Chakra key is kept in sync for older code. */
function readStoredMode(): ColorMode {
	try {
		const stored =
			localStorage.getItem("rb-theme") ??
			localStorage.getItem("chakra-ui-color-mode");
		return stored === "light" ? "light" : "dark";
	} catch {
		return "dark";
	}
}

function applyMode(mode: ColorMode) {
	try {
		localStorage.setItem("rb-theme", mode);
		localStorage.setItem("chakra-ui-color-mode", mode);
	} catch {}
	for (const target of [document.documentElement, document.body]) {
		target.classList.remove(
			"rb-theme-light",
			"rb-theme-dark",
			"chakra-ui-light",
			"chakra-ui-dark",
		);
		target.classList.add(`rb-theme-${mode}`, `chakra-ui-${mode}`);
		target.dataset.theme = mode;
		target.style.colorScheme = mode;
	}
}

/** Replaces Chakra's ColorModeProvider. Dark is the default, as in the old theme. */
export function ColorModeProvider({ children }: { children: ReactNode }) {
	const [colorMode, setMode] = useState<ColorMode>(readStoredMode);

	useEffect(() => {
		applyMode(colorMode);
	}, [colorMode]);

	const setColorMode = useCallback((mode: ColorMode) => setMode(mode), []);
	const toggleColorMode = useCallback(
		() => setMode((mode) => (mode === "dark" ? "light" : "dark")),
		[],
	);
	const value = useMemo(
		() => ({ colorMode, setColorMode, toggleColorMode }),
		[colorMode, setColorMode, toggleColorMode],
	);

	return (
		<ColorModeContext.Provider value={value}>{children}</ColorModeContext.Provider>
	);
}

export function useColorMode(): ColorModeContextValue {
	const context = useContext(ColorModeContext);
	if (!context) {
		throw new Error("useColorMode must be used inside ColorModeProvider");
	}
	return context;
}

