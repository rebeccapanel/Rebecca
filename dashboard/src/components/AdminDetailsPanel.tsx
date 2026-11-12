import { cn } from "lib/cn";
import { toneClass } from "lib/tone";
import { Badge } from "components/ui/badge";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AdminRole, AdminTrafficLimitMode, type Admin } from "types/Admin";
import { formatBytes } from "utils/formatByte";
import {
	ExpandedDetails,
	ExpandedHeading,
	ExpandedMeta,
} from "./ui/ExpandedPanel";

const formatLimit = (limit?: number | null, unlimitedLabel?: string) => {
	if (!limit || limit <= 0) {
		return unlimitedLabel ?? "∞";
	}
	return `${limit}`;
};

const formatBytesOrUnlimited = (
	value?: number | null,
	unlimitedLabel?: string
) => {
	if (!value || value <= 0) {
		return unlimitedLabel ?? "∞";
	}
	return formatBytes(value, 2);
};

export const AdminDetailsPanel = ({
	admin,
	actions,
}: {
	admin: Admin;
	actions?: ReactNode;
}) => {
	const { t } = useTranslation();
	const unlimitedLabel = t("admins.details.unlimited");
	const activeUsers = admin.active_users ?? 0;
	const usersLimit = admin.users_limit ?? null;
	const usersLimitLabel =
		usersLimit && usersLimit > 0 ? String(usersLimit) : unlimitedLabel;
	const usedBytes = admin.users_usage ?? 0;
	const createdTrafficBytes = admin.created_traffic ?? 0;
	const dataLimitBytes = admin.data_limit ?? null;
	const effectiveUsageBytes =
		admin.traffic_limit_mode === AdminTrafficLimitMode.CreatedTraffic
			? createdTrafficBytes
			: usedBytes;
	const remainingBytes =
		dataLimitBytes && dataLimitBytes > 0
			? Math.max(dataLimitBytes - effectiveUsageBytes, 0)
			: null;
	const trafficModeLabel =
		admin.traffic_limit_mode === AdminTrafficLimitMode.CreatedTraffic
			? t("myaccount.createdTraffic")
			: t("nodes.usedTrafficSeries");
	const roleLabel =
		admin.role === AdminRole.FullAccess
			? t("admins.roles.fullAccess")
			: admin.role === AdminRole.Sudo
			? t("admins.roles.sudo")
			: t("admins.roles.standard");

	return (
		<>
			<div className="flex-wrap flex items-center justify-between gap-3 mb-3">
				<div className="flex flex-row items-center gap-2">
					<Badge className={cn(toneClass(
							admin.role === AdminRole.FullAccess
								? "orange"
								: admin.role === AdminRole.Sudo
								? "purple"
								: "gray"
						), "text-[0.75rem] px-2 py-0.5 rounded-full")}>
						{roleLabel}
					</Badge>
				</div>
				<p className="text-[0.75rem] text-panel-text-muted">
					{t("admins.details.summary", {
						active: activeUsers,
						limit: usersLimitLabel,
					})}
				</p>
			</div>

			<ExpandedDetails>
				<ExpandedHeading title={t("users")} first />
				<ExpandedMeta
					label={t("admins.details.activeLabel")}
					value={String(activeUsers)}
				/>
				<ExpandedMeta
					label={t("admins.details.onlineLabel")}
					value={String(admin.online_users ?? 0)}
				/>
				<ExpandedMeta
					label={t("admins.details.limitedLabel")}
					value={String(admin.limited_users ?? 0)}
				/>
				<ExpandedMeta
					label={t("status.expired")}
					value={String(admin.expired_users ?? 0)}
				/>
				<ExpandedMeta
					label={t("status.on_hold")}
					value={String(admin.on_hold_users ?? 0)}
				/>
				<ExpandedMeta
					label={t("status.disabled")}
					value={String(admin.disabled_users ?? 0)}
				/>
				<ExpandedMeta
					label={t("admins.details.totalUsers")}
					value={String(admin.users_count ?? 0)}
				/>
				<ExpandedMeta
					label={t("admins.details.usersLimit")}
					value={formatLimit(usersLimit, unlimitedLabel)}
				/>

				<ExpandedHeading title={t("admins.details.dataSection")} />
				<ExpandedMeta
					label={t("admins.details.used")}
					value={formatBytes(usedBytes, 2)}
				/>
				<ExpandedMeta
					label={t("myaccount.createdTraffic")}
					value={formatBytes(createdTrafficBytes, 2)}
				/>
				<ExpandedMeta
					label={t("admins.details.limit")}
					value={formatBytesOrUnlimited(dataLimitBytes, unlimitedLabel)}
				/>
				<ExpandedMeta
					label={t("admins.details.remaining")}
					value={formatBytesOrUnlimited(remainingBytes, unlimitedLabel)}
				/>
				<ExpandedMeta
					label={t("admins.details.lifetime")}
					value={formatBytesOrUnlimited(admin.lifetime_usage ?? null)}
				/>
				<ExpandedMeta
					label={t("admins.details.trafficMode")}
					value={trafficModeLabel}
				/>
				<ExpandedMeta
					label={t("admins.details.showUserTraffic")}
					value={
						admin.show_user_traffic === false
							? t("nodes.disabled")
							: t("nodes.enabled")
					}
				/>

				<ExpandedHeading title={t("admins.details.allocationSection")} />
				<ExpandedMeta
					label={t("admins.details.dataAllocated")}
					value={formatBytes(admin.data_limit_allocated ?? 0, 2)}
				/>
				<ExpandedMeta
					label={t("admins.details.resetVolume")}
					value={formatBytes(admin.reset_bytes ?? 0, 2)}
				/>
				<ExpandedMeta
					label={t("admins.details.unlimitedUsage")}
					value={formatBytes(admin.unlimited_users_usage ?? 0, 2)}
				/>
				<ExpandedMeta
					label={t("admins.deletedUserUsage")}
					value={formatBytes(admin.deleted_users_usage ?? 0, 2)}
				/>
			</ExpandedDetails>

			{actions}
		</>
	);
};
