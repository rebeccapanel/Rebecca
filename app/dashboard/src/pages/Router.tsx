import { createHashRouter } from "react-router-dom";
import { fetch } from "../service/http";
import { getAuthToken } from "../utils/authStorage";
import { Login } from "./Login";
import { AppLayout } from "../components/AppLayout";
import { DashboardPage } from "./DashboardPage";
import { UsersPage } from "./UsersPage";
import { AdminsPage } from "./AdminsPage";
import { HostsPage } from "./HostsPage";
import { NodesPage } from "./NodesPage";
import { CoreSettingsPage } from "./CoreSettingsPage";
import { XrayLogsPage } from "./XrayLogsPage";

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
        path: "hosts",
        element: <HostsPage />,
      },
      {
        path: "node-settings",
        element: <NodesPage />,
      },
      {
        path: "xray-settings",
        element: <CoreSettingsPage />,
      },
      {
        path: "xray-logs",
        element: <XrayLogsPage />,
      },
    ],
  },
  {
    path: "/login/",
    element: <Login />,
  },
]);
