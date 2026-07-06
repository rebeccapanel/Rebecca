import { Box } from "@chakra-ui/react";
import { ONLINE_ACTIVE_WINDOW_SECONDS } from "constants/online";
import type { CSSProperties, FC } from "react";
import type { Status } from "types/User";
import { parseServerTimeToUnix } from "utils/dateFormatter";
import { statusRingColor } from "./userColors";

type OnlineState = "online" | "offline" | "never";

type UserStatusAvatarProps = {
	username: string;
	status: Status;
	lastOnline?: string | null;
	/** Avatar diameter in pixels, ring excluded. */
	size?: number;
};

const getOnlineState = (lastOnline?: string | null): OnlineState => {
	const unixTime = parseServerTimeToUnix(lastOnline ?? null);
	if (!lastOnline || unixTime === null) return "never";
	const secondsAgo = Math.floor(Date.now() / 1000) - unixTime;
	return secondsAgo <= ONLINE_ACTIVE_WINDOW_SECONDS ? "online" : "offline";
};

/**
 * Avatar for the Users list: the ring color mirrors the user's status while
 * the bottom-right dot (and pulse) reflects live online state. The circle
 * itself follows the active theme's surface color (white in light mode,
 * the dark surface in dark mode) via the rb-panel CSS variables.
 */
export const UserStatusAvatar: FC<UserStatusAvatarProps> = ({
	username,
	status,
	lastOnline,
	size = 34,
}) => {
	const onlineState = getOnlineState(lastOnline);
	const initial = username.trim().charAt(0).toUpperCase() || "?";

	return (
		<Box
			className="rb-user-avatar"
			data-online={onlineState}
			data-status={status}
			style={
				{
					"--rb-user-avatar-size": `${size}px`,
					"--rb-user-ring": statusRingColor(status),
				} as CSSProperties
			}
		>
			<Box className="rb-user-avatar-circle" aria-hidden="true">
				{initial}
			</Box>
			<Box as="span" className="rb-user-avatar-dot" aria-hidden="true" />
		</Box>
	);
};
