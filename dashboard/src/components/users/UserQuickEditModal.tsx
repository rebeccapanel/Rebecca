import { Button } from "components/ui/button";
import { Field, FieldLabel } from "components/ui/field";
import { toast } from "components/ui/sonner";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { cn } from "lib/cn";


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
	
	const quickEditUser = useDashboard((state) => state.quickEditUser);
	const refetchUsers = useDashboard((state) => state.refetchUsers);
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
			toast.success(field === "data_limit"
						? t("usersTable.setDataLimitSuccess")
						: t("usersTable.setExpirySuccess"), { duration: 2500 });
			refetchUsers(true);
			useDashboard.setState({ quickEditUser: null });
		} catch (error: any) {
			toast.error(error?.data?.detail || error?.message || t("error"), { duration: 3000 });
		} finally {
			setLoading(false);
		}
	};

	const isDataLimit = field === "data_limit";

	return (
		<AppDialog open={Boolean(quickEditUser)} onClose={onClose} size="sm" title={
				isDataLimit
					? t("usersTable.setDataLimit")
					: t("usersTable.setExpiry")
			} contentProps={{ className: "mx-3" }} footerProps={{ className: "gap-3" }} footer={
				<>
					<Button onClick={onClose} disabled={loading} variant="outline" size="sm">
						{t("cancel")}
					</Button>
					<Button onClick={save} size="sm" loading={loading}>
						{t("save")}
					</Button>
				</>
			}>
					<div className="flex flex-col items-stretch gap-3">
						{user && (
							<p dir="ltr" className="text-[0.875rem] text-panel-text-muted">
								{user.username}
							</p>
						)}
						{isDataLimit ? (
							<Field>
								<FieldLabel>{t("userDialog.dataLimit")}</FieldLabel>
								<div className="relative flex w-full items-center">
									<NumericInput
										min={0}
										step={1}
										value={limitGb}
										onChange={(valueAsString) => setLimitGb(valueAsString)}
									/>
									<div className="flex items-center rounded-e-md border border-s-0 border-input bg-muted px-3 text-sm">GB</div>
								</div>
								<p className="text-[0.75rem] text-panel-text-muted mt-1">
									{t("usersTable.unlimitedHint")}
								</p>
							</Field>
						) : (
							<Field>
								<FieldLabel>{t("usersTable.expire")}</FieldLabel>
								<DateTimePicker
									value={expireDate}
									onChange={setExpireDate}
									minDate={new Date()}
									placeholder={t("usersTable.setExpiry")}
								/>
								<p className="text-[0.75rem] text-panel-text-muted mt-1">
									{t("usersTable.expiryClearHint")}
								</p>
							</Field>
						)}
					</div>
		</AppDialog>
	);
};
