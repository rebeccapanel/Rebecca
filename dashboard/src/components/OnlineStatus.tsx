import { Box, Text } from "@chakra-ui/react";
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
	withMargin?: boolean;
};

export const OnlineStatus: FC<UserStatusProps> = ({
	lastOnline,
	withMargin = true,
}) => {
	const { t, i18n } = useTranslation();
	const isRTL = i18n.language === "fa";
	const currentTimeInSeconds = Math.floor(Date.now() / 1000);
	const unixTime = parseServerTimeToUnix(lastOnline);
	const marginLeft = withMargin ? "2" : undefined;

	const timeDifferenceInSeconds = unixTime
		? currentTimeInSeconds - unixTime
		: null;

	if (!unixTime || timeDifferenceInSeconds === null) {
		return (
			<Text
				display="inline-flex"
				fontSize="xs"
				fontWeight="medium"
				ml={marginLeft}
				color="gray.600"
				_dark={{
					color: "gray.400",
				}}
				as="span"
				gap={1}
				alignItems="center"
			>
				{t("onlineStatus.notConnectedYet", "Not Connected Yet")}
			</Text>
		);
	}

	const parts = buildRelativeTimeParts(unixTime, currentTimeInSeconds);
	const formattedParts = formatRelativeTimeParts(parts);

	// A user seen between the online window and one minute ago produces no
	// non-zero hour/minute parts, so the relative string is empty. Treat that
	// sub-minute case as "Online" instead of rendering a bare "ago".
	if (
		timeDifferenceInSeconds <= ONLINE_ACTIVE_WINDOW_SECONDS ||
		formattedParts.trim() === ""
	) {
		return (
			<Text
				display="inline-flex"
				fontSize="xs"
				fontWeight="medium"
				ml={marginLeft}
				color="gray.600"
				_dark={{
					color: "gray.400",
				}}
				as="span"
				gap={1}
				alignItems="center"
			>
				{t("onlineStatus.online", "Online")}
			</Text>
		);
	}

	return (
		<Text
			display="inline-flex"
			flexWrap="wrap"
			fontSize="xs"
			fontWeight="medium"
			ml={marginLeft}
			color="gray.600"
			_dark={{
				color: "gray.400",
			}}
			as="span"
			gap={1}
			alignItems="center"
			dir={isRTL ? "rtl" : "ltr"}
		>
			<Box as="span" dir="ltr" sx={{ unicodeBidi: "isolate" }}>
				{formattedParts}
			</Box>
			<Text as="span">{t("onlineStatus.ago", "ago")}</Text>
		</Text>
	);
};
