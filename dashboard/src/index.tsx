import { ChakraProvider, localStorageManager } from "@chakra-ui/react";
import dayjs from "dayjs";
import Duration from "dayjs/plugin/duration";
import LocalizedFormat from "dayjs/plugin/localizedFormat";
import RelativeTime from "dayjs/plugin/relativeTime";
import Timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import "locales/i18n";
import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "react-query";
import { queryClient } from "utils/react-query";
import { updateThemeColor } from "utils/themeColor";
import { theme } from "../chakra.config";
import App from "./App";
import "index.scss";

dayjs.extend(Timezone);
dayjs.extend(LocalizedFormat);
dayjs.extend(utc);
dayjs.extend(RelativeTime);
dayjs.extend(Duration);

type ThemeMode = "dark" | "light";

const normalizeThemeMode = (value?: string | null): ThemeMode =>
	value === "light" ? "light" : "dark";

const getInitialThemeMode = (): ThemeMode => {
	try {
		return normalizeThemeMode(
			localStorage.getItem("rb-theme") || localStorageManager.get(),
		);
	} catch {
		return "dark";
	}
};

const applyInitialThemeMode = (mode: ThemeMode) => {
	try {
		localStorage.setItem("rb-theme", mode);
		localStorage.setItem("chakra-ui-color-mode", mode);
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
		target.classList.add(`rb-theme-${mode}`, `chakra-ui-${mode}`);
		target.dataset.theme = mode;
		target.style.colorScheme = mode;
	});
	updateThemeColor(mode);
};

applyInitialThemeMode(getInitialThemeMode());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<React.StrictMode>
		<ChakraProvider theme={theme} colorModeManager={localStorageManager}>
			<QueryClientProvider client={queryClient}>
				<App />
			</QueryClientProvider>
		</ChakraProvider>
	</React.StrictMode>,
);
