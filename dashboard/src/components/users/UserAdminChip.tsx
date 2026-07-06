import { chakra, useColorModeValue } from "@chakra-ui/react";
import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { hashNameToHue } from "./userColors";

type UserAdminChipProps = {
	adminUsername?: string | null;
	show?: boolean;
};

/**
 * "by <admin>" tag with a deterministic accent color per admin, so rows that
 * belong to the same reseller can be scanned at a glance.
 */
export const UserAdminChip: FC<UserAdminChipProps> = ({
	adminUsername,
	show = true,
}) => {
	const { t } = useTranslation();
	const hue = hashNameToHue(adminUsername ?? "");
	const chipBg = useColorModeValue(
		`hsla(${hue}, 70%, 45%, 0.12)`,
		`hsla(${hue}, 70%, 60%, 0.16)`,
	);
	const chipColor = useColorModeValue(
		`hsl(${hue}, 60%, 34%)`,
		`hsl(${hue}, 75%, 74%)`,
	);
	const chipBorderColor = useColorModeValue(
		`hsla(${hue}, 60%, 40%, 0.28)`,
		`hsla(${hue}, 70%, 65%, 0.32)`,
	);

	if (!show || !adminUsername) return null;

	return (
		<chakra.span
			className="rb-user-admin-chip"
			dir="ltr"
			bg={chipBg}
			color={chipColor}
			borderColor={chipBorderColor}
			sx={{ unicodeBidi: "isolate" }}
		>
			{t("usersTable.by", "by")}{" "}
			<chakra.span fontWeight="bold">{adminUsername}</chakra.span>
		</chakra.span>
	);
};
