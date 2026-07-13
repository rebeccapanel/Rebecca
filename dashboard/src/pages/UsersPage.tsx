import {
	Button,
	chakra,
	Spinner,
	Text,
	useToast,
	VStack,
} from "@chakra-ui/react";
import { ArrowPathIcon } from "@heroicons/react/24/outline";
import { AppDialog } from "components/dialogs/AppDialog";
import { ReloadIcon } from "components/Filters";
import { Icon } from "components/Icon";
import { Pagination } from "components/Pagination";
import { QRCodeDialog } from "components/QRCodeDialog";
import { UserDialog } from "components/UserDialog";
import { UsersTable } from "components/UsersTable";
import { PageHeader, ResourceRefreshButton } from "components/ui";
import { UsersFilterBar, UserQuickEditModal } from "components/users";
import { fetchInbounds, useDashboard } from "contexts/DashboardContext";
import { type FC, useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";

const ResetIcon = chakra(ArrowPathIcon, {
	baseStyle: { w: 5, h: 5 },
});

const UserActionDialog: FC<{ action: "reset" | "revoke" }> = ({ action }) => {
	const { t } = useTranslation();
	const toast = useToast();
	const {
		resetUsageUser,
		revokeSubscriptionUser,
		resetDataUsage,
		revokeSubscription,
	} = useDashboard();
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
					toast({
						title: t(
							isRevoke ? "revokeUserSub.success" : "resetUserUsage.success",
							{ username: user.username },
						),
						status: "success",
						isClosable: true,
						position: "top",
						duration: 3000,
					});
				})
				.catch(() => {
					toast({
						title: t(isRevoke ? "revokeUserSub.error" : "resetUserUsage.error"),
						status: "error",
						isClosable: true,
						position: "top",
						duration: 3000,
					});
				})
				.finally(() => {
					setLoading(false);
				});
		}
	};

	return (
		<AppDialog
			isCentered
			isOpen={Boolean(user)}
			onClose={onClose}
			size="sm"
			title={
				<Icon color="blue">
					<ResetIcon />
				</Icon>
			}
			overlayProps={{ bg: "blackAlpha.300", backdropFilter: "blur(10px)" }}
			contentProps={{ mx: "3" }}
			headerProps={{ pt: 6 }}
			closeButtonProps={{ mt: 3 }}
			footerProps={{ display: "flex" }}
			footer={
				<>
					<Button size="sm" onClick={onClose} mr={3} w="full" variant="outline">
						{t("cancel")}
					</Button>
					<Button
						size="sm"
						w="full"
						colorScheme="blue"
						onClick={onSubmit}
						leftIcon={loading ? <Spinner size="xs" /> : undefined}
					>
						{t(isRevoke ? "revoke" : "reset")}
					</Button>
				</>
			}
		>
			<Text fontWeight="semibold" fontSize="lg">
				{t(isRevoke ? "revokeUserSub.title" : "resetUserUsage.title")}
			</Text>
			{user && (
				<Text
					mt={1}
					fontSize="sm"
					_dark={{ color: "gray.400" }}
					color="gray.600"
				>
					<Trans components={{ b: <b /> }}>
						{t(isRevoke ? "revokeUserSub.prompt" : "resetUserUsage.prompt", {
							username: user.username,
						})}
					</Trans>
				</Text>
			)}
		</AppDialog>
	);
};

export const UsersPage: FC = () => {
	const { t, i18n } = useTranslation();
	const isRTL = i18n.dir(i18n.language) === "rtl";
	const { loading, refetchUsers } = useDashboard();

	useEffect(() => {
		useDashboard.getState().refetchUsers(true);
		fetchInbounds();
	}, []);

	useEffect(() => {
		const shouldOpenCreate = sessionStorage.getItem("openCreateUser");
		if (shouldOpenCreate === "true") {
			sessionStorage.removeItem("openCreateUser");
			useDashboard.getState().onCreateUser(true);
		}
	}, []);

	return (
		<VStack
			className="rb-users-section"
			spacing={5}
			align="stretch"
			dir={isRTL ? "rtl" : "ltr"}
		>
			<PageHeader title={t("users")} />
			<UsersTable
				toolbar={<UsersFilterBar />}
				headerActions={
					<ResourceRefreshButton
						aria-label={t("refresh", "Refresh")}
						label={t("refresh", "Refresh")}
						icon={<ReloadIcon />}
						onClick={() => refetchUsers(true)}
						isLoading={loading}
					/>
				}
			/>
			<Pagination />
			<UserDialog />
			<QRCodeDialog />
			<UserActionDialog action="reset" />
			<UserActionDialog action="revoke" />
			<UserQuickEditModal />
		</VStack>
	);
};

export default UsersPage;
