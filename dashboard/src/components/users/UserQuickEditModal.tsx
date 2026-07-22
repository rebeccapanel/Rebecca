import {
	Button,
	FormControl,
	FormLabel,
	InputGroup,
	InputRightAddon,
	Text,
	useToast,
	VStack,
} from "@chakra-ui/react";
import { NumericInput } from "components/common/NumericInput";
import { DateTimePicker } from "components/DateTimePicker";
import { AppDialog } from "components/dialogs/AppDialog";
import { useDashboard } from "contexts/DashboardContext";
import dayjs from "dayjs";
import { type FC, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetch } from "service/http";

const BYTES_PER_GB = 1024 * 1024 * 1024;

/**
 * Lightweight single-field editor for a user's data limit or expiry date,
 * driven by the `quickEditUser` store slot. These map onto the same
 * PUT /v2/users/{username} contract the edit dialog uses, exposed as quick
 * one-off actions from the Users overflow menu.
 */
export const UserQuickEditModal: FC = () => {
	const { t } = useTranslation();
	const toast = useToast();
	const { quickEditUser, refetchUsers } = useDashboard();
	const user = quickEditUser?.user ?? null;
	const field = quickEditUser?.field ?? null;

	const [loading, setLoading] = useState(false);
	const [limitGb, setLimitGb] = useState("");
	const [expireDate, setExpireDate] = useState<Date | null>(null);

	// Seed the input from the user's current value each time the modal opens.
	useEffect(() => {
		if (!quickEditUser) return;
		if (quickEditUser.field === "data_limit") {
			const bytes = quickEditUser.user.data_limit ?? 0;
			setLimitGb(bytes ? String(+(bytes / BYTES_PER_GB).toFixed(2)) : "");
		} else {
			const expire = quickEditUser.user.expire;
			setExpireDate(expire ? dayjs.unix(expire).toDate() : null);
		}
	}, [quickEditUser]);

	const onClose = () => {
		if (loading) return;
		useDashboard.setState({ quickEditUser: null });
	};

	const save = async () => {
		if (!user || !field) return;
		const body =
			field === "data_limit"
				? {
						data_limit: Math.max(0, Math.round(Number(limitGb) * BYTES_PER_GB)),
					}
				: { expire: expireDate ? dayjs(expireDate).unix() : null };

		setLoading(true);
		try {
			await fetch(`/v2/users/${encodeURIComponent(user.username)}`, {
				method: "PUT",
				body,
			});
			toast({
				title:
					field === "data_limit"
						? t("usersTable.setDataLimitSuccess")
						: t("usersTable.setExpirySuccess"),
				status: "success",
				isClosable: true,
				position: "top",
				duration: 2500,
			});
			refetchUsers(true);
			useDashboard.setState({ quickEditUser: null });
		} catch (error: any) {
			toast({
				title: error?.data?.detail || error?.message || t("error"),
				status: "error",
				isClosable: true,
				position: "top",
				duration: 3000,
			});
		} finally {
			setLoading(false);
		}
	};

	const isDataLimit = field === "data_limit";

	return (
		<AppDialog
			isCentered
			isOpen={Boolean(quickEditUser)}
			onClose={onClose}
			size="sm"
			title={
				isDataLimit
					? t("usersTable.setDataLimit")
					: t("usersTable.setExpiry")
			}
			overlayProps={{ bg: "blackAlpha.300", backdropFilter: "blur(10px)" }}
			contentProps={{ mx: "3" }}
			footerProps={{ gap: 3 }}
			footer={
				<>
					<Button
						size="sm"
						variant="outline"
						onClick={onClose}
						isDisabled={loading}
					>
						{t("cancel")}
					</Button>
					<Button
						size="sm"
						colorScheme="primary"
						onClick={save}
						isLoading={loading}
					>
						{t("save")}
					</Button>
				</>
			}
		>
					<VStack align="stretch" spacing={3}>
						{user && (
							<Text fontSize="sm" color="panel.textMuted" dir="ltr">
								{user.username}
							</Text>
						)}
						{isDataLimit ? (
							<FormControl>
								<FormLabel>{t("userDialog.dataLimit")}</FormLabel>
								<InputGroup>
									<NumericInput
										min={0}
										step={1}
										value={limitGb}
										onChange={(valueAsString) => setLimitGb(valueAsString)}
									/>
									<InputRightAddon>GB</InputRightAddon>
								</InputGroup>
								<Text fontSize="xs" color="panel.textMuted" mt={1}>
									{t("usersTable.unlimitedHint")}
								</Text>
							</FormControl>
						) : (
							<FormControl>
								<FormLabel>{t("usersTable.expire")}</FormLabel>
								<DateTimePicker
									value={expireDate}
									onChange={setExpireDate}
									minDate={new Date()}
									placeholder={t("usersTable.setExpiry")}
								/>
								<Text fontSize="xs" color="panel.textMuted" mt={1}>
									{t("usersTable.expiryClearHint")}
								</Text>
							</FormControl>
						)}
					</VStack>
		</AppDialog>
	);
};
