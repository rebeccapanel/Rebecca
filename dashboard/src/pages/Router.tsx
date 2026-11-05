import { Button } from "components/ui/button";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { cn } from "lib/cn";

import { BootScreen } from "../components/BootScreen";
import { PageLoadingSkeleton } from "../components/ui";
import { type ComponentType, lazy, Suspense, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
	createBrowserRouter,
	isRouteErrorResponse,
	Navigate,
	redirect,
	useNavigate,
	useRouteError,
} from "react-router-dom";
import { fetch } from "../service/http";
import { recoverFromStaleChunk } from "../utils/chunkRecovery";
import { hasRememberedSession, setRememberedSession } from "../utils/session";
import { Login } from "./Login";

const AppLayout = lazy(async () => ({
	default: (await import("../components/AppLayout")).AppLayout,
}));
const DashboardPage = lazy(async () => ({
	default: (await import("./DashboardPage")).DashboardPage,
}));
const UsersPage = lazy(async () => ({
	default: (await import("./UsersPage")).UsersPage,
}));
const AccessInsightsPage = lazy(() => import("./AccessInsightsPage"));
const AdminsPage = lazy(async () => ({
	default: (await import("./AdminsPage")).AdminsPage,
}));
const ApiDocsPage = lazy(async () => ({
	default: (await import("./ApiDocsPage")).ApiDocsPage,
}));
const BulkActionsPage = lazy(() => import("./BulkActionsPage"));
const CoreSettingsPage = lazy(() => import("./CoreSettingsPage"));
const GroupsPage = lazy(() => import("./GroupsPage"));
const HostsPage = lazy(() => import("./HostsPage"));
const HAProxyPage = lazy(() => import("./HAProxyPage"));
const IntegrationSettingsPage = lazy(async () => ({
	default: (await import("./IntegrationSettingsPage")).IntegrationSettingsPage,
}));
const PlaceholderSettingsPage = lazy(() => import("./PlaceholderSettingsPage"));
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
const ErrorsPage = lazy(() => import("./ErrorsPage"));
const NotificationsPage = lazy(() => import("./NotificationsPage"));

const PageLoading = () => <PageLoadingSkeleton />;

const LazyPage = ({ Page }: { Page: ComponentType }) => (
	<Suspense fallback={<PageLoading />}>
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
		<div className="min-h-screen bg-gray-950 text-white px-6 py-10">
			<div className="flex flex-col items-start gap-4 max-w-[720px] mx-auto">
				<h2 className="font-heading font-bold text-[1.5rem] leading-[1.33] md:text-[1.875rem] md:leading-[1.2]">{t("router.errorTitle")}</h2>
				<p className="text-gray-300">{t("router.errorDescription")}</p>
				<p className="bg-whiteAlpha-100 border border-whiteAlpha-200! rounded-md text-red-200 font-mono text-[0.875rem] p-4 w-full whitespace-pre-wrap">
					{routeErrorMessage(error)}
				</p>
				<Button onClick={() => navigate("/")} className="bg-blue-600 text-white shadow-xs hover:bg-blue-700">
					{t("router.backToDashboard")}
				</Button>
			</div>
		</div>
	);
};

const routeSegments = new Set([
	"login",
	"users",
	"groups",
	"bulk-actions",
	"admins",
	"myaccount",
	"usage",
	"tutorials",
	"services",
	"hosts",
	"haproxy",
	"node-settings",
	"integrations",
	"settings",
	"xray-settings",
	"xray-logs",
	"errors",
	"notifications",
	"access-insights",
	"api-docs",
	"phpmyadmin",
	"external-apps",
	"recent-actions",
	"placeholders",
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

const SESSION_CHECK_RETRY_DELAY_MS = 1500;
const SESSION_CHECK_MAX_ATTEMPTS = 40;
const SESSION_REJECTED_MAX_ATTEMPTS = 2;

const fetchSessionWithRetry = async () => {
	const maxRejectedAttempts = hasRememberedSession()
		? SESSION_REJECTED_MAX_ATTEMPTS
		: 1;
	for (let attempt = 1; ; attempt += 1) {
		try {
			return await fetch<{ state?: string }>("/auth/session");
		} catch (error) {
			const status =
				(error as { response?: { status?: number }; status?: number })?.response
					?.status ?? (error as { status?: number })?.status;
			const rejected = status === 401 || status === 403;
			if (
				attempt >=
				(rejected ? maxRejectedAttempts : SESSION_CHECK_MAX_ATTEMPTS)
			) {
				throw error;
			}
			await new Promise((resolve) =>
				setTimeout(resolve, SESSION_CHECK_RETRY_DELAY_MS),
			);
		}
	}
};

const fetchAdminLoader = async ({ request }: { request: Request }) => {
	try {
		const response = await fetchSessionWithRetry();
		if (response?.state === "disabled") {
			const pathname = new URL(request.url).pathname.replace(/\/+$/, "");
			if (!pathname.endsWith("/users")) throw redirect("/users/");
		} else if (response?.state !== "active") {
			setRememberedSession(false);
			throw redirect("/login/");
		}
		setRememberedSession(true);
		if (response && typeof response === "object" && "error" in response) {
			throw new Error(`API error: ${response.error || "Unknown error"}`);
		}
		return response;
	} catch (error) {
		const status =
			(error as { response?: { status?: number }; status?: number })?.response
				?.status ?? (error as { status?: number })?.status;
		if (status === 401 || status === 403) {
			setRememberedSession(false);
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
			element: (
				<Suspense fallback={<BootScreen />}>
					<AppLayout />
				</Suspense>
			),
			hydrateFallbackElement: <BootScreen />,
			errorElement: <RouteErrorPage />,
			loader: fetchAdminLoader,
			children: [
				{
					index: true,
					element: <LazyPage Page={DashboardPage} />,
				},
				{
					path: "users",
					element: <LazyPage Page={UsersPage} />,
				},
				{
					path: "groups",
					element: <LazyPage Page={GroupsPage} />,
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
					path: "haproxy",
					element: <LazyPage Page={HAProxyPage} />,
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
					path: "placeholders",
					element: <LazyPage Page={PlaceholderSettingsPage} />,
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
					path: "errors",
					element: <LazyPage Page={ErrorsPage} />,
				},
				{
					path: "notifications",
					element: <LazyPage Page={NotificationsPage} />,
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
