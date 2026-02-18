import { Box, Text } from "@chakra-ui/react";
import { ONLINE_ACTIVE_WINDOW_SECONDS } from "constants/online";
import type { FC } from "react";
import { useTranslation } from "react-i18next";
import {
	buildRelativeTimeParts,
	formatRelativeTimeParts,
} from "utils/dateFormatter";

type UserStatusProps = {
	lastOnline: string | null;
	withMargin?: boolean;
};

const convertDateFormat = (lastOnline: string | null): number | null => {
	if (!lastOnline) {
		return null;
	}

	const date = new Date(`${lastOnline}Z`);
	return Math.floor(date.getTime() / 1000);
};

export const OnlineStatus: FC<UserStatusProps> = ({
	lastOnline,
	withMargin = true,
}) => {
	const { t, i18n } = useTranslation();
	const isRTL = i18n.language === "fa";
	const currentTimeInSeconds = Math.floor(Date.now() / 1000);
	const unixTime = convertDateFormat(lastOnline);
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

	if (timeDifferenceInSeconds <= ONLINE_ACTIVE_WINDOW_SECONDS) {
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

	const parts = buildRelativeTimeParts(unixTime, currentTimeInSeconds);
	const formattedParts = formatRelativeTimeParts(parts);

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
