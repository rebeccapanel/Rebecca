import type { FC } from "react";
import { useTranslation } from "react-i18next";

type UserOnlineBadgeProps = {
	isOnline: boolean;
};

export const UserOnlineBadge: FC<UserOnlineBadgeProps> = ({ isOnline }) => {
	const { t } = useTranslation();

	return (
		<span data-online={isOnline ? "true" : "false"} className="flex flex-row items-center gap-1 rb-user-online-tag">
			<span aria-hidden="true" className="rb-user-status-dot" />
			<span>
				{t(isOnline ? "usersTable.online" : "usersTable.offline")}
			</span>
		</span>
	);
};
