import { cn } from "lib/cn";
import { ONLINE_ACTIVE_WINDOW_SECONDS } from "constants/online";
import type { FC } from "react";
import { useTranslation } from "react-i18next";
import {
	buildRelativeTimeParts,
	formatRelativeTimeParts,
	parseServerTimeToUnix,
} from "utils/dateFormatter";

type UserStatusProps = {
	lastOnline: string | null;
	isOnline?: boolean;
	withMargin?: boolean;
	/** Render the relative time in short units (e.g. "2H, 4m") for tight cells. */
	compact?: boolean;
};

export const OnlineStatus: FC<UserStatusProps> = ({
	lastOnline,
	isOnline = false,
	withMargin = true,
	compact = false,
}) => {
	const { t, i18n } = useTranslation();
	const isRTL = i18n.dir(i18n.language) === "rtl";
	const currentTimeInSeconds = Math.floor(Date.now() / 1000);
	const unixTime = parseServerTimeToUnix(lastOnline);
	const marginLeft = withMargin ? "ms-2" : undefined;

	const timeDifferenceInSeconds = unixTime
		? currentTimeInSeconds - unixTime
		: null;

	if (isOnline || (unixTime && timeDifferenceInSeconds !== null && timeDifferenceInSeconds <= ONLINE_ACTIVE_WINDOW_SECONDS)) {
		return (
			<span className={cn("inline-flex text-[0.75rem] font-medium text-gray-600 dark:text-gray-400 gap-1 items-center", marginLeft)}>
				{t("onlineStatus.online")}
			</span>
		);
	}

	if (!unixTime || timeDifferenceInSeconds === null) {
		return (
			<span className={cn("inline-flex text-[0.75rem] font-medium text-gray-600 dark:text-gray-400 gap-1 items-center", marginLeft)}>
				{t("onlineStatus.notConnectedYet")}
			</span>
		);
	}

	const parts = buildRelativeTimeParts(unixTime, currentTimeInSeconds);
	const formattedParts = formatRelativeTimeParts(parts, { compact });

	// A user seen between the online window and one minute ago produces no
	// non-zero hour/minute parts, so the relative string is empty. Treat that
	// sub-minute case as "Online" instead of rendering a bare "ago".
	if (formattedParts.trim() === "") {
		return (
			<span className={cn("inline-flex text-[0.75rem] font-medium text-gray-600 dark:text-gray-400 gap-1 items-center", marginLeft)}>
				{t("onlineStatus.online")}
			</span>
		);
	}

	return (
		<span dir={isRTL ? "rtl" : "ltr"} className={cn("inline-flex flex-wrap text-[0.75rem] font-medium text-gray-600 dark:text-gray-400 gap-1 items-center", marginLeft)}>
			<span dir="ltr" className="[unicode-bidi:isolate]">
				{formattedParts}
			</span>
			<span>{t("onlineStatus.ago")}</span>
		</span>
	);
};
