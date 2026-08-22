import { Box, Button, Heading, Text, VStack } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import {
	createBrowserRouter,
	isRouteErrorResponse,
	Navigate,
	redirect,
	useNavigate,
	useRouteError,
} from "react-router-dom";
import { lazy, Suspense, type ComponentType, useEffect } from "react";
import { AppLayout } from "../components/AppLayout";
import { fetch } from "../service/http";
import { recoverFromStaleChunk } from "../utils/chunkRecovery";
import { DashboardPage } from "./DashboardPage";
import { Login } from "./Login";
import { UsersPage } from "./UsersPage";

const AccessInsightsPage = lazy(() => import("./AccessInsightsPage"));
const AdminsPage = lazy(async () => ({
	default: (await import("./AdminsPage")).AdminsPage,
}));
const ApiDocsPage = lazy(async () => ({
	default: (await import("./ApiDocsPage")).ApiDocsPage,
}));
const BulkActionsPage = lazy(() => import("./BulkActionsPage"));
const CoreSettingsPage = lazy(() => import("./CoreSettingsPage"));
const HostsPage = lazy(() => import("./HostsPage"));
const IntegrationSettingsPage = lazy(async () => ({
	default: (await import("./IntegrationSettingsPage")).IntegrationSettingsPage,
}));
const RecentActionsPage = lazy(async () => ({
	default: (await import("./RecentActionsPage")).RecentActionsPage,
}));
const MyAccountPage = lazy(() => import("./MyAccountPage"));
const NodesPage = lazy(() => import("./NodesPage"));
const PhpMyAdminPage = lazy(async () => ({
	default: (await import("./PhpMyAdminPage")).PhpMyAdminPage,
}));
const ExternalAppsPage = lazy(async () => ({
	default: (await import("./ExternalAppsPage")).ExternalAppsPage,
}));
const ServicesPage = lazy(() => import("./ServicesPage"));
const TutorialsPage = lazy(async () => ({
	default: (await import("./TutorialsPage")).TutorialsPage,
}));
const UsagePage = lazy(() => import("./UsagePage"));
const XrayLogsPage = lazy(() => import("./XrayLogsPage"));

const LazyPage = ({ Page }: { Page: ComponentType }) => (
	<Suspense fallback={<Box minH="160px" />}>
		<Page />
	</Suspense>
);

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
	const { t } = useTranslation();

	useEffect(() => {
		recoverFromStaleChunk(error);
	}, [error]);

	return (
		<Box minH="100vh" bg="gray.950" color="white" px={6} py={10}>
			<VStack align="start" spacing={4} maxW="720px" mx="auto">
				<Heading size="lg">{t("router.errorTitle")}</Heading>
				<Text color="gray.300">{t("router.errorDescription")}</Text>
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
					{t("router.backToDashboard")}
				</Button>
			</VStack>
		</Box>
	);
};

const routeSegments = new Set([
	"login",
	"users",
	"bulk-actions",
	"admins",
	"myaccount",
	"usage",
	"tutorials",
	"services",
	"hosts",
	"node-settings",
	"integrations",
	"settings",
	"xray-settings",
	"xray-logs",
	"access-insights",
	"api-docs",
	"phpmyadmin",
	"external-apps",
	"recent-actions",
]);

const trimTrailingSlash = (value: string) => {
	if (value.length <= 1) return value;
	return value.replace(/\/+$/, "");
};

const getDashboardBasename = () => {
	if (typeof window === "undefined") return "/dashboard";
	const segments = window.location.pathname.split("/").filter(Boolean);
	if (!segments.length) return import.meta.env.DEV ? "/" : "/dashboard";
	const routeIndex = segments.findIndex((segment) =>
		routeSegments.has(segment),
	);
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

const fetchAdminLoader = async ({ request }: { request: Request }) => {
	try {
		const response = await fetch<{ state?: string }>("/auth/session");
		if (response?.state === "disabled") {
			const pathname = new URL(request.url).pathname.replace(/\/+$/, "");
			if (!pathname.endsWith("/users")) throw redirect("/users/");
		} else if (response?.state !== "active") {
			throw redirect("/login/");
		}
		if (response && typeof response === "object" && "error" in response) {
			throw new Error(`API error: ${response.error || "Unknown error"}`);
		}
		return response;
	} catch (error) {
		const status =
			(error as { response?: { status?: number }; status?: number })?.response
				?.status ?? (error as { status?: number })?.status;
		if (status === 401 || status === 403) {
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
					path: "bulk-actions",
					element: <LazyPage Page={BulkActionsPage} />,
				},
				{
					path: "admins",
					element: <LazyPage Page={AdminsPage} />,
				},
				{
					path: "myaccount",
					element: <LazyPage Page={MyAccountPage} />,
				},
				{
					path: "usage",
					element: <LazyPage Page={UsagePage} />,
				},
				{
					path: "tutorials",
					element: <LazyPage Page={TutorialsPage} />,
				},
				{
					path: "services",
					element: <LazyPage Page={ServicesPage} />,
				},
				{
					path: "hosts",
					element: <LazyPage Page={HostsPage} />,
				},
				{
					path: "node-settings",
					element: <LazyPage Page={NodesPage} />,
				},
				{
					path: "settings",
					element: <LazyPage Page={IntegrationSettingsPage} />,
				},
				{
					path: "integrations",
					element: <Navigate to="/settings#panel" replace />,
				},
				{
					path: "xray-settings",
					element: <LazyPage Page={CoreSettingsPage} />,
				},
				{
					path: "xray-logs",
					element: <LazyPage Page={XrayLogsPage} />,
				},
				{
					path: "access-insights",
					element: <LazyPage Page={AccessInsightsPage} />,
				},
				{
					path: "recent-actions",
					element: <LazyPage Page={RecentActionsPage} />,
				},
				{
					path: "api-docs",
					element: <LazyPage Page={ApiDocsPage} />,
				},
				{
					path: "phpmyadmin",
					element: <LazyPage Page={PhpMyAdminPage} />,
				},
				{
					path: "external-apps",
					element: <LazyPage Page={ExternalAppsPage} />,
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
