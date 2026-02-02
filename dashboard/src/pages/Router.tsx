import { createHashRouter } from "react-router-dom";
import { AppLayout } from "../components/AppLayout";
import { fetch } from "../service/http";
import { getAuthToken } from "../utils/authStorage";
import AccessInsightsPage from "./AccessInsightsPage";
import { AdminsPage } from "./AdminsPage";
import { CoreSettingsPage } from "./CoreSettingsPage";
import { DashboardPage } from "./DashboardPage";
import { HostsPage } from "./HostsPage";
import { IntegrationSettingsPage } from "./IntegrationSettingsPage";
import { Login } from "./Login";
import MyAccountPage from "./MyAccountPage";
import { NodesPage } from "./NodesPage";
import ServicesPage from "./ServicesPage";
import UsagePage from "./UsagePage";
import { UsersPage } from "./UsersPage";
import { XrayLogsPage } from "./XrayLogsPage";
import TutorialsPage from "./TutorialsPage";

const fetchAdminLoader = async () => {
	try {
		const token = getAuthToken();
		if (!token) {
			console.warn("No authentication token found");
			throw new Error("No token available");
		}
		const response = await fetch("/admin", {
			headers: {
				Authorization: `Bearer ${token}`,
			},
		});
		if (response && typeof response === "object" && "error" in response) {
			throw new Error(`API error: ${response.error || "Unknown error"}`);
		}
		return response;
	} catch (error) {
		console.error("Loader error:", error);
		throw error;
	}
};

export const router = createHashRouter([
	{
		path: "/",
		element: <AppLayout />,
		errorElement: <Login />,
		loader: fetchAdminLoader,
		children: [
			{
				index: true,
				element: <DashboardPage />,
			},
			{
				path: "users",
				element: <UsersPage />,
			},
			{
				path: "admins",
				element: <AdminsPage />,
			},
			{
				path: "myaccount",
				element: <MyAccountPage />,
			},
			{
				path: "usage",
				element: <UsagePage />,
			},
			{
				path: "tutorials",
				element: <TutorialsPage />,
			},
			{
				path: "services",
				element: <ServicesPage />,
			},
			{
				path: "hosts",
				element: <HostsPage />,
			},
			{
				path: "node-settings",
				element: <NodesPage />,
			},
			{
				path: "integrations",
				element: <IntegrationSettingsPage />,
			},
			{
				path: "xray-settings",
				element: <CoreSettingsPage />,
			},
			{
				path: "xray-logs",
				element: <XrayLogsPage />,
			},
			{
				path: "access-insights",
				element: <AccessInsightsPage />,
			},
		],
	},
	{
		path: "/login/",
		element: <Login />,
	},
]);
