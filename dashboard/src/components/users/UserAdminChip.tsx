import type { FC } from "react";
import { useTranslation } from "react-i18next";

type UserAdminChipProps = {
	adminUsername?: string | null;
	show?: boolean;
};

/**
 * "by <admin>" tag for rows owned by another admin/reseller. Deliberately
 * muted and uniform (styled via .rb-user-admin-chip with the panel theme
 * tokens) so it reads as quiet metadata rather than a colored label.
 */
export const UserAdminChip: FC<UserAdminChipProps> = ({
	adminUsername,
	show = true,
}) => {
	const { t } = useTranslation();

	if (!show || !adminUsername) return null;

	return (
		<span dir="ltr" className="[unicode-bidi:isolate] rb-user-admin-chip">
			{t("usersTable.by")}{" "}
			<span className="font-semibold">{adminUsername}</span>
		</span>
	);
};
