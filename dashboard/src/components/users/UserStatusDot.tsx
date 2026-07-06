import { Box } from "@chakra-ui/react";
import { ONLINE_ACTIVE_WINDOW_SECONDS } from "constants/online";
import type { CSSProperties, FC } from "react";
import type { Status } from "types/User";
import { parseServerTimeToUnix } from "utils/dateFormatter";
import { statusRingColor } from "./userColors";

type UserStatusDotProps = {
	status: Status;
	lastOnline?: string | null;
};

const isOnline = (lastOnline?: string | null): boolean => {
	const unixTime = parseServerTimeToUnix(lastOnline ?? null);
	if (!lastOnline || unixTime === null) return false;
	const secondsAgo = Math.floor(Date.now() / 1000) - unixTime;
	return secondsAgo <= ONLINE_ACTIVE_WINDOW_SECONDS;
};

/**
 * Minimal status indicator for the Users list: a small dot colored by the
 * user's status (active/on-hold/expired/...) with a soft pulse while the
 * user is online.
 */
export const UserStatusDot: FC<UserStatusDotProps> = ({
	status,
	lastOnline,
}) => (
	<Box
		as="span"
		className="rb-user-status-dot"
		data-online={isOnline(lastOnline) ? "true" : undefined}
		data-status={status}
		style={{ "--rb-user-dot": statusRingColor(status) } as CSSProperties}
		aria-hidden="true"
	/>
);
