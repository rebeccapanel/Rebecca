import { clearAdminsCache } from "contexts/AdminsContext";
import { clearDashboardCache } from "contexts/DashboardContext";
import { clearHostsCache } from "contexts/HostsContext";
import { clearServicesCache } from "contexts/ServicesContext";
import { queryClient } from "utils/react-query";
import { useAPIRequestErrors } from "service/http";

const SESSION_HINT_KEY = "rb-session-hint";

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
	queryClient.clear();
	clearAdminsCache();
	clearDashboardCache();
	clearServicesCache();
	clearHostsCache();
};
