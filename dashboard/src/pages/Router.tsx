import { Box, Button, Heading, Text, VStack } from "@chakra-ui/react";
import { createBrowserRouter } from "react-router-dom";
import { AppLayout } from "../components/AppLayout";
import { fetch } from "../service/http";
import { getAuthToken, removeAuthToken } from "../utils/authStorage";
import AccessInsightsPage from "./AccessInsightsPage";
import { AdminsPage } from "./AdminsPage";
import { ApiDocsPage } from "./ApiDocsPage";
import { CoreSettingsPage } from "./CoreSettingsPage";
import { DashboardPage } from "./DashboardPage";
import { HostsPage } from "./HostsPage";
import { IntegrationSettingsPage } from "./IntegrationSettingsPage";
import { Login } from "./Login";
import MyAccountPage from "./MyAccountPage";
import { NodesPage } from "./NodesPage";
import ServicesPage from "./ServicesPage";
import TutorialsPage from "./TutorialsPage";
import UsagePage from "./UsagePage";
import { UsersPage } from "./UsersPage";
import { XrayLogsPage } from "./XrayLogsPage";
import {
	isRouteErrorResponse,
	redirect,
	useNavigate,
	useRouteError,
} from "react-router-dom";

const routeErrorMessage = (error: unknown) => {
	if (isRouteErrorResponse(error)) {
		return error.statusText || `Request failed with status ${error.status}`;
	}
	if (error instanceof Error) {
		return error.message;
	}
	return "The page could not be loaded.";
};

const RouteErrorPage = () => {
	const error = useRouteError();
	const navigate = useNavigate();

	return (
		<Box minH="100vh" bg="gray.950" color="white" px={6} py={10}>
			<VStack align="start" spacing={4} maxW="720px" mx="auto">
				<Heading size="lg">Something went wrong</Heading>
				<Text color="gray.300">
					Rebecca kept your session active. You can retry the page or go back to
					the dashboard.
				</Text>
				<Text
					bg="whiteAlpha.100"
					border="1px solid"
					borderColor="whiteAlpha.200"
					borderRadius="md"
					color="red.200"
					fontFamily="mono"
					fontSize="sm"
					p={4}
					w="full"
					whiteSpace="pre-wrap"
				>
					{routeErrorMessage(error)}
				</Text>
				<Button colorScheme="blue" onClick={() => navigate("/")}>
					Back to dashboard
				</Button>
			</VStack>
		</Box>
	);
};

const routeSegments = new Set([
	"login",
	"users",
	"admins",
	"myaccount",
	"usage",
	"tutorials",
	"services",
	"hosts",
	"node-settings",
	"integrations",
	"xray-settings",
	"xray-logs",
	"access-insights",
	"api-docs",
]);

const trimTrailingSlash = (value: string) => {
	if (value.length <= 1) return value;
	return value.replace(/\/+$/, "");
};

const getDashboardBasename = () => {
	if (typeof window === "undefined") return "/dashboard";
	const segments = window.location.pathname.split("/").filter(Boolean);
	if (!segments.length) return import.meta.env.DEV ? "/" : "/dashboard";
	const routeIndex = segments.findIndex((segment) => routeSegments.has(segment));
	if (routeIndex > 0) {
		return `/${segments.slice(0, routeIndex).join("/")}`;
	}
	if (routeIndex === 0) return "/";
	return trimTrailingSlash(window.location.pathname) || "/";
};

const normalizeLegacyHashRoute = (basename: string) => {
	if (typeof window === "undefined") return;
	const { hash, search } = window.location;
	if (!hash.startsWith("#/")) return;
	const hashRoute = hash.slice(1);
	if (!hashRoute || hashRoute === "/") return;
	const base = basename === "/" ? "" : basename;
	const nextPath = `${base}${hashRoute}`;
	const nextURL = `${nextPath}${search}`;
	if (`${window.location.pathname}${search}` !== nextURL) {
		window.history.replaceState(null, "", nextURL);
	}
};

const dashboardBasename = getDashboardBasename();
normalizeLegacyHashRoute(dashboardBasename);

const fetchAdminLoader = async () => {
	try {
		const token = getAuthToken();
		if (!token) {
			console.warn("No authentication token found");
			throw redirect("/login/");
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
		const status =
			(error as { response?: { status?: number }; status?: number })?.response
				?.status ?? (error as { status?: number })?.status;
		if (status === 401 || status === 403) {
			removeAuthToken();
			throw redirect("/login/");
		}
		console.error("Loader error:", error);
		throw error;
	}
};

export const router = createBrowserRouter(
	[
		{
			path: "/",
			element: <AppLayout />,
			errorElement: <RouteErrorPage />,
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
				{
					path: "api-docs",
					element: <ApiDocsPage />,
				},
			],
		},
		{
			path: "/login",
			element: <Login />,
		},
	],
	{ basename: dashboardBasename },
);
