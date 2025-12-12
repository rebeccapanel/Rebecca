import { Box, Text } from "@chakra-ui/react";
import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { relativeExpiryDate } from "utils/dateFormatter";

type UserStatusProps = {
	lastOnline: string | null;
};

const convertDateFormat = (lastOnline: string | null): number | null => {
	if (!lastOnline) {
		return null;
	}

	const date = new Date(`${lastOnline}Z`);
	return Math.floor(date.getTime() / 1000);
};

export const OnlineStatus: FC<UserStatusProps> = ({ lastOnline }) => {
	const { t } = useTranslation();
	const currentTimeInSeconds = Math.floor(Date.now() / 1000);
	const unixTime = convertDateFormat(lastOnline);

	const timeDifferenceInSeconds = unixTime
		? currentTimeInSeconds - unixTime
		: null;
	const dateInfo = unixTime
		? relativeExpiryDate(unixTime)
		: {
				status: "",
				time: t("onlineStatus.notConnectedYet", "Not Connected Yet"),
			};

	return (
		<Text
			display="inline-flex"
			fontSize="xs"
			fontWeight="medium"
			ml="2"
			color="gray.600"
			_dark={{
				color: "gray.400",
			}}
			as="span"
			gap={1}
			alignItems="center"
		>
			{timeDifferenceInSeconds && timeDifferenceInSeconds <= 60 ? (
				t("onlineStatus.online", "Online")
			) : timeDifferenceInSeconds && dateInfo.time ? (
				<>
					<Box
						as="span"
						dir="ltr"
						display="inline-block"
						style={{ unicodeBidi: "embed" }}
					>
						{dateInfo.time}
					</Box>
					<Text as="span">{t("onlineStatus.ago", "ago")}</Text>
				</>
			) : (
				dateInfo.time
			)}
		</Text>
	);
};
