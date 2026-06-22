import { Box } from "@chakra-ui/react";
import { ONLINE_ACTIVE_WINDOW_SECONDS } from "constants/online";
import type { FC } from "react";
import { parseServerTimeToUnix } from "utils/dateFormatter";

type UserStatusProps = {
	lastOnline?: string | null;
};

export const OnlineBadge: FC<UserStatusProps> = ({ lastOnline }) => {
	const currentTimeInSeconds = Math.floor(Date.now() / 1000);
	const unixTime = parseServerTimeToUnix(lastOnline);

	if (!lastOnline || unixTime === null) {
		return (
			<Box
				border="1px solid"
				borderColor="gray.400"
				_dark={{ borderColor: "gray.600" }}
				className="circle"
			/>
		);
	}

	const timeDifferenceInSeconds = currentTimeInSeconds - unixTime;

	if (timeDifferenceInSeconds <= ONLINE_ACTIVE_WINDOW_SECONDS) {
		return (
			<Box
				bg="green.300"
				_dark={{ bg: "green.500" }}
				className="circle pulse green"
			/>
		);
	}

	return <Box bg="gray.400" _dark={{ bg: "gray.600" }} className="circle" />;
};
