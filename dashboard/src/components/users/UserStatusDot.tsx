import { Box } from "@chakra-ui/react";
import { ONLINE_ACTIVE_WINDOW_SECONDS } from "constants/online";
import type { FC } from "react";
import { parseServerTimeToUnix } from "utils/dateFormatter";

type UserStatusDotProps = {
	lastOnline?: string | null;
};

const isOnline = (lastOnline?: string | null): boolean => {
	const unixTime = parseServerTimeToUnix(lastOnline ?? null);
	if (!lastOnline || unixTime === null) return false;
	const secondsAgo = Math.floor(Date.now() / 1000) - unixTime;
	return secondsAgo <= ONLINE_ACTIVE_WINDOW_SECONDS;
};

/**
 * Online indicator for the Users list: a small dot that lights up green
 * while the user is connected and stays a neutral, muted gray otherwise.
 * Subscription status is conveyed by the status badge column, not this dot.
 */
export const UserStatusDot: FC<UserStatusDotProps> = ({ lastOnline }) => (
	<Box
		as="span"
		className="rb-user-status-dot"
		data-online={isOnline(lastOnline) ? "true" : undefined}
		aria-hidden="true"
	/>
);
