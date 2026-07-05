import { Badge, type BadgeProps } from "@chakra-ui/react";
import type { FC } from "react";

export const StatusBadge: FC<
	BadgeProps & { status?: "success" | "warning" | "danger" | "neutral" }
> = ({ status = "neutral", children, ...props }) => {
	const palette = {
		success: { bg: "rgba(34, 197, 94, 0.14)", color: "panel.success" },
		warning: { bg: "rgba(245, 158, 11, 0.16)", color: "panel.warning" },
		danger: { bg: "rgba(239, 68, 68, 0.16)", color: "panel.danger" },
		neutral: { bg: "panel.elevated", color: "panel.textMuted" },
	}[status];

	return (
		<Badge
			display="inline-flex"
			alignItems="center"
			justifyContent="flex-start"
			gap="1.5"
			px="2"
			py="0.5"
			borderRadius="4px"
			textTransform="none"
			fontWeight="700"
			lineHeight="1"
			whiteSpace="nowrap"
			{...palette}
			{...props}
		>
			{children}
		</Badge>
	);
};
