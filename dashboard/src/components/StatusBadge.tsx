import { Badge, Box, Text } from "@chakra-ui/react";

import { statusColors } from "constants/UserSettings";
import type { FC } from "react";
import { useTranslation } from "react-i18next";
import type { Status as UserStatusType } from "types/User";
import { relativeExpiryDate } from "utils/dateFormatter";

type UserStatusProps = {
	expiryDate?: number | null;
	status: UserStatusType;
	compact?: boolean;
	showDetail?: boolean;
	extraText?: string | null;
};
export const StatusBadge: FC<UserStatusProps> = ({
	expiryDate,
	status: userStatus,
	compact = false,
	showDetail = true,
	extraText,
}) => {
	const { t } = useTranslation();
	const dateInfo = relativeExpiryDate(expiryDate);
	const Icon = statusColors[userStatus].icon;
	return (
		<>
			<Badge
				colorScheme={statusColors[userStatus].statusColor}
				rounded="full"
				display="inline-flex"
				px={3}
				py={1}
				columnGap={compact ? 1 : 2}
				alignItems="center"
			>
				<Icon w={compact ? 3 : 4} />
				{showDetail && (
					<Text
						textTransform="capitalize"
						fontSize={compact ? ".7rem" : ".875rem"}
						lineHeight={compact ? "1rem" : "1.25rem"}
						fontWeight="medium"
						letterSpacing="tighter"
					>
						{userStatus && t(`status.${userStatus}`)}
						{extraText && `: ${extraText}`}
					</Text>
				)}
			</Badge>
			{showDetail && expiryDate && dateInfo.time && (
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
					{dateInfo.status === "expires" ? (
						<>
							<Text as="span">
								{t("expires").replace("{{time}}", "").trim()}
							</Text>
							<Box
								as="span"
								dir="ltr"
								display="inline"
								style={{ unicodeBidi: "embed" }}
							>
								{dateInfo.time}
							</Box>
						</>
					) : (
						<>
							<Box
								as="span"
								dir="ltr"
								display="inline"
								style={{ unicodeBidi: "embed" }}
							>
								{dateInfo.time}
							</Box>
							<Text as="span">
								{" " +
									(t("expired").includes("{{time}}")
										? t("expired").split("{{time}}")[1]
										: " پیش به پایان رسیده")}
							</Text>
						</>
					)}
				</Text>
			)}
		</>
	);
};
