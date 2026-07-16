import { clearAdminsCache } from "contexts/AdminsContext";
import { clearDashboardCache } from "contexts/DashboardContext";
import { clearHostsCache } from "contexts/HostsContext";
import { clearServicesCache } from "contexts/ServicesContext";
import { queryClient } from "utils/react-query";

export const clearClientSession = () => {
	localStorage.removeItem("token");
	queryClient.clear();
	clearAdminsCache();
	clearDashboardCache();
	clearServicesCache();
	clearHostsCache();
};
