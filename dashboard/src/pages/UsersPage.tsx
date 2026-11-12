import { Button } from "components/ui/button";
import { toast } from "components/ui/sonner";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { withClass } from "lib/withClass";
import { RefreshCw, Lock } from "lucide-react";

import { AppDialog } from "components/dialogs/AppDialog";
import { Icon } from "components/Icon";
import { Pagination } from "components/Pagination";
import { UsersTable } from "components/UsersTable";
import {
	PageHeader,
	PageLoadingSkeleton,
} from "components/ui";
import { UsersCreateButton, UsersFilterBar } from "components/users";
import { RefreshSplitButton } from "components/users/RefreshSplitButton";
import { fetchInbounds, useDashboard } from "contexts/DashboardContext";
import useGetUser from "hooks/useGetUser";
import {
	type FC,
	lazy,
	Suspense,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { Trans, useTranslation } from "react-i18next";
import { fetch } from "service/http";
import { AdminStatus } from "types/Admin";

const UserDialog = lazy(async () => ({
	default: (await import("components/UserDialog")).UserDialog,
}));
const QRCodeDialog = lazy(async () => ({
	default: (await import("components/QRCodeDialog")).QRCodeDialog,
}));
const UserQuickEditModal = lazy(async () => ({
	default: (await import("components/users/UserQuickEditModal"))
		.UserQuickEditModal,
}));

type OnlineUsersResponse =
	| string[]
	| {
			users: string[];
			speeds: Record<string, { upload_speed: number; download_speed: number }>;
	  };

const ResetIcon = withClass(RefreshCw, "w-5 h-5");

const DisabledIcon = withClass(Lock, "h-12 w-12");

const UserActionDialog: FC<{ action: "reset" | "revoke" }> = ({ action }) => {
	const { t } = useTranslation();
	
	const {
		resetUsageUser,
		revokeSubscriptionUser,
		resetDataUsage,
		revokeSubscription,
	} = {
		resetUsageUser: useDashboard((state) => state.resetUsageUser),
		revokeSubscriptionUser: useDashboard(
			(state) => state.revokeSubscriptionUser,
		),
		resetDataUsage: useDashboard((state) => state.resetDataUsage),
		revokeSubscription: useDashboard((state) => state.revokeSubscription),
	};
	const [loading, setLoading] = useState(false);
	const user = action === "reset" ? resetUsageUser : revokeSubscriptionUser;
	const isRevoke = action === "revoke";

	const onClose = () => {
		useDashboard.setState(
			isRevoke ? { revokeSubscriptionUser: null } : { resetUsageUser: null },
		);
	};
	const onSubmit = () => {
		if (user) {
			setLoading(true);
			(isRevoke ? revokeSubscription(user) : resetDataUsage(user))
				.then(() => {
					toast.success(t(
							isRevoke ? "revokeUserSub.success" : "resetUserUsage.success",
							{ username: user.username },
						), { duration: 3000 });
				})
				.catch(() => {
					toast.error(t(isRevoke ? "revokeUserSub.error" : "resetUserUsage.error"), { duration: 3000 });
				})
				.finally(() => {
					setLoading(false);
				});
		}
	};

	return (
		<AppDialog open={Boolean(user)} onClose={onClose} size="sm" title={
				<Icon color="blue">
					<ResetIcon />
				</Icon>
			} contentProps={{ className: "mx-3" }} headerProps={{ className: "pt-6" }} footerProps={{ className: "flex" }} footer={
				<>
					<Button onClick={onClose} variant="outline" size="sm" className="flex-1">
						{t("cancel")}
					</Button>
					<Button onClick={onSubmit} size="sm" loading={loading} className="flex-1 bg-blue-600 text-white shadow-xs hover:bg-blue-700">
						{t(isRevoke ? "revoke" : "reset")}
					</Button>
				</>
			}>
			<p className="font-semibold text-[1.125rem]">
				{t(isRevoke ? "revokeUserSub.title" : "resetUserUsage.title")}
			</p>
			{user && (
				<p className="mt-1 text-[0.875rem] dark:text-gray-400 text-gray-600">
					<Trans components={{ b: <b /> }}>
						{t(isRevoke ? "revokeUserSub.prompt" : "resetUserUsage.prompt", {
							username: user.username,
						})}
					</Trans>
				</p>
			)}
		</AppDialog>
	);
};

export const UsersPage: FC = () => {
	const { t, i18n } = useTranslation();
	const isRTL = i18n.dir(i18n.language) === "rtl";
	const loading = useDashboard((state) => state.loading);
	const refetchUsers = useDashboard((state) => state.refetchUsers);
	const isUserDialogOpen = useDashboard(
		(state) => state.isCreatingNewUser || Boolean(state.editingUser),
	);
	const isQRCodeDialogOpen = useDashboard(
		(state) => state.QRcodeLinks !== null,
	);
	const isQuickEditOpen = useDashboard((state) => state.quickEditUser !== null);
	const { userData, getUserIsPending } = useGetUser();
	const isAdminDisabled = userData.status === AdminStatus.Disabled;
	const [autoRefreshInterval, setAutoRefreshInterval] = useState(5_000);
	const topSpeedUsernameRef = useRef<string | undefined>(undefined);
	const onlineRefreshInFlightRef = useRef(false);

	const refreshOnlineUsers = useCallback(async () => {
		if (
			onlineRefreshInFlightRef.current ||
			document.visibilityState === "hidden" ||
			!navigator.onLine
		) {
			return;
		}
		onlineRefreshInFlightRef.current = true;
		try {
			const dashboard = useDashboard.getState();
			const needsGlobalSpeeds = dashboard.filters.advancedFilters?.includes(
				"top_speed",
			);
			const visibleUsernames = dashboard.users.users.map(
				(user) => user.username,
			);
			if (!needsGlobalSpeeds && visibleUsernames.length === 0) return;
			const response = await fetch<OnlineUsersResponse>("/users/onlines", {
				query: {
					details: true,
					usernames: needsGlobalSpeeds ? undefined : visibleUsernames.join(","),
				},
			});
			const usernames = Array.isArray(response) ? response : response.users;
			const speeds = Array.isArray(response) ? {} : response.speeds;
			const online = new Set(usernames);
			let topSpeedUsername = "";
			let topSpeed = 0;
			for (const [username, speed] of Object.entries(speeds)) {
				const total = (speed.upload_speed ?? 0) + (speed.download_speed ?? 0);
				if (total > topSpeed) {
					topSpeed = total;
					topSpeedUsername = username;
				}
			}
			const previousTopSpeedUsername = topSpeedUsernameRef.current;
			topSpeedUsernameRef.current = topSpeedUsername;
			useDashboard.setState((state) => {
				const liveUserStats = Object.fromEntries(
					state.users.users.map((user) => {
						const speed = speeds[user.username];
						return [
							user.username,
							{
								is_online: online.has(user.username),
								upload_speed: speed?.upload_speed ?? 0,
								download_speed: speed?.download_speed ?? 0,
							},
						];
					}),
				);
				return { liveUserStats };
			});
			const state = useDashboard.getState();
			if (
				previousTopSpeedUsername !== undefined &&
				previousTopSpeedUsername !== topSpeedUsername &&
				state.filters.advancedFilters?.includes("top_speed")
			) {
				state.refetchUsers(true);
			}
		} catch {
			// Keep the last successful snapshot during a transient poll failure.
		} finally {
			onlineRefreshInFlightRef.current = false;
		}
	}, []);

	useEffect(() => {
		if (getUserIsPending || isAdminDisabled) return;
		useDashboard.getState().refetchUsers(true);
		fetchInbounds();
	}, [getUserIsPending, isAdminDisabled]);

	useEffect(() => {
		if (getUserIsPending || isAdminDisabled || !autoRefreshInterval) return;
		void refreshOnlineUsers();
		const timer = window.setInterval(
			() => void refreshOnlineUsers(),
			autoRefreshInterval,
		);
		return () => window.clearInterval(timer);
	}, [
		autoRefreshInterval,
		getUserIsPending,
		isAdminDisabled,
		refreshOnlineUsers,
	]);

	useEffect(() => {
		if (getUserIsPending || isAdminDisabled || !autoRefreshInterval) return;
		const refreshWhenActive = () => {
			if (document.visibilityState === "visible" && navigator.onLine) {
				void refreshOnlineUsers();
			}
		};
		document.addEventListener("visibilitychange", refreshWhenActive);
		window.addEventListener("online", refreshWhenActive);
		return () => {
			document.removeEventListener("visibilitychange", refreshWhenActive);
			window.removeEventListener("online", refreshWhenActive);
		};
	}, [
		autoRefreshInterval,
		getUserIsPending,
		isAdminDisabled,
		refreshOnlineUsers,
	]);

	useEffect(() => {
		if (getUserIsPending || isAdminDisabled) return;
		const shouldOpenCreate = sessionStorage.getItem("openCreateUser");
		if (shouldOpenCreate === "true") {
			sessionStorage.removeItem("openCreateUser");
			useDashboard.getState().onCreateUser(true);
		}
	}, [getUserIsPending, isAdminDisabled]);

	if (getUserIsPending) {
		return <PageLoadingSkeleton />;
	}

	if (isAdminDisabled) {
		return (
			<div dir={isRTL ? "rtl" : "ltr"} className="flex flex-col gap-5 items-stretch">
				<PageHeader title={t("users")} />
				<div className="flex-col flex items-center border border-panel-border! rounded-[8px] justify-center min-h-[420px] px-6 py-10 text-center">
					<DisabledIcon className="text-red-400 mb-5" />
					<p className="text-[1.25rem] font-bold mb-2">
						{t("usersTable.adminDisabledTitle")}
					</p>
					<p className="text-panel-text-secondary max-w-[520px]">
						{userData.disabled_reason ||
							t("usersTable.adminDisabledDescription")}
					</p>
				</div>
			</div>
		);
	}

	return (
		<div dir={isRTL ? "rtl" : "ltr"} className="flex flex-col gap-4 items-stretch rb-users-section">
			<UsersTable
				toolbar={<UsersFilterBar />}
				headerActions={
					<>
						<RefreshSplitButton
							onRefresh={() => {
								refetchUsers(true);
								void refreshOnlineUsers();
							}}
							loading={loading}
							interval={autoRefreshInterval}
							onIntervalChange={setAutoRefreshInterval}
						/>
						<UsersCreateButton />
					</>
				}
			/>
			<Pagination />
			{isUserDialogOpen && (
				<Suspense fallback={null}>
					<UserDialog />
				</Suspense>
			)}
			{isQRCodeDialogOpen && (
				<Suspense fallback={null}>
					<QRCodeDialog />
				</Suspense>
			)}
			<UserActionDialog action="reset" />
			<UserActionDialog action="revoke" />
			{isQuickEditOpen && (
				<Suspense fallback={null}>
					<UserQuickEditModal />
				</Suspense>
			)}
		</div>
	);
};

export default UsersPage;
