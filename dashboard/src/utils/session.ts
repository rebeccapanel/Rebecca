import { clearAdminsCache } from "contexts/AdminsContext";
import { clearDashboardCache } from "contexts/DashboardContext";
import { clearHostsCache } from "contexts/HostsContext";
import { clearServicesCache } from "contexts/ServicesContext";
import { queryClient } from "utils/react-query";
import { useAPIRequestErrors } from "service/http";

const SESSION_HINT_KEY = "rb-session-hint";

export const resetAccentToDefault = () => {
	try {
		localStorage.removeItem("rb-accent");
	} catch {}
	if (typeof document !== "undefined") {
		const root = document.documentElement;
		root.style.removeProperty("--rb-panel-accent");
		root.style.removeProperty("--rb-panel-accent-hover");
		for (let i = 50; i <= 900; i = i < 100 ? i + 50 : i + 100) {
			root.style.removeProperty(`--color-accent-palette-${i}`);
		}
	}
};

export const setRememberedSession = (remembered: boolean) => {
	try {
		if (remembered) localStorage.setItem(SESSION_HINT_KEY, "1");
		else localStorage.removeItem(SESSION_HINT_KEY);
	} catch {}
};

export const hasRememberedSession = () => {
	try {
		return localStorage.getItem(SESSION_HINT_KEY) === "1";
	} catch {
		return false;
	}
};

export const clearClientSession = () => {
	useAPIRequestErrors.getState().clear();
	localStorage.removeItem("token");
	setRememberedSession(false);
	resetAccentToDefault();
	queryClient.clear();
	clearAdminsCache();
	clearDashboardCache();
	clearServicesCache();
	clearHostsCache();
};
