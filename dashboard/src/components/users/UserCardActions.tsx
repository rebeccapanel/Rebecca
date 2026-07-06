import { Box, chakra, IconButton, Tooltip } from "@chakra-ui/react";
import {
	CheckIcon,
	LinkIcon,
	PencilIcon,
	QrCodeIcon,
	TrashIcon,
} from "@heroicons/react/24/outline";
import { DeleteConfirmPopover } from "components/DeleteConfirmPopover";
import { useDashboard } from "contexts/DashboardContext";
import { type FC, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UserListItem } from "types/User";
import { copyTextToClipboard } from "utils/clipboard";
import { generateUserLinks } from "utils/userLinks";

const iconProps = {
	baseStyle: {
		w: 5,
		h: 5,
	},
};

const EditIcon = chakra(PencilIcon, iconProps);
const CopyLinkIcon = chakra(LinkIcon, iconProps);
const CopiedIcon = chakra(CheckIcon, iconProps);
const QRIcon = chakra(QrCodeIcon, iconProps);
const DeleteIcon = chakra(TrashIcon, iconProps);

type UserCardActionsProps = {
	user: UserListItem;
	onEdit?: () => void;
	onDelete?: () => void | Promise<void>;
};

/**
 * Fixed primary-action bar at the bottom of the expanded user card:
 * Edit, Copy subscription link and QR code, plus a visually separated
 * destructive Delete that always asks for confirmation first. Everything
 * else stays in the card's "..." overflow menu.
 */
export const UserCardActions: FC<UserCardActionsProps> = ({
	user,
	onEdit,
	onDelete,
}) => {
	const { t } = useTranslation();
	const { setQRCode, setSubLink, linkTemplates } = useDashboard();
	const [copied, setCopied] = useState(false);

	const subscriptionLink = user.subscription_url
		? user.subscription_url.startsWith("/")
			? window.location.origin + user.subscription_url
			: user.subscription_url
		: "";

	useEffect(() => {
		if (!copied) return;
		const timeout = setTimeout(() => setCopied(false), 1000);
		return () => clearTimeout(timeout);
	}, [copied]);

	const handleCopyLink = () => {
		void copyTextToClipboard(subscriptionLink)
			.then(() => setCopied(true))
			.catch(() => undefined);
	};

	const handleQRCode = () => {
		setQRCode(generateUserLinks(user, linkTemplates), user.username);
		setSubLink(subscriptionLink);
	};

	return (
		<Box
			className="rb-user-card-actions"
			onClick={(event) => {
				event.preventDefault();
				event.stopPropagation();
			}}
		>
			{onEdit && (
				<Tooltip label={t("userDialog.editUser", "Edit user")}>
					<IconButton
						aria-label={t("userDialog.editUser", "Edit user")}
						icon={<EditIcon />}
						variant="ghost"
						onClick={onEdit}
					/>
				</Tooltip>
			)}
			<Tooltip
				label={copied ? t("usersTable.copied") : t("usersTable.copyLink")}
			>
				<IconButton
					aria-label={t("usersTable.copyLink", "Copy link")}
					icon={copied ? <CopiedIcon /> : <CopyLinkIcon />}
					variant="ghost"
					isDisabled={!subscriptionLink}
					onClick={handleCopyLink}
				/>
			</Tooltip>
			<Tooltip label={t("usersTable.qrCode", "QR Code")}>
				<IconButton
					aria-label={t("usersTable.qrCode", "QR Code")}
					icon={<QRIcon />}
					variant="ghost"
					onClick={handleQRCode}
				/>
			</Tooltip>
			{onDelete && (
				<DeleteConfirmPopover
					message={t("deleteUser.prompt", { username: user.username })}
					onConfirm={onDelete}
				>
					<IconButton
						className="rb-user-card-action--danger"
						aria-label={t("deleteUser.title", "Delete user")}
						icon={<DeleteIcon />}
						variant="ghost"
					/>
				</DeleteConfirmPopover>
			)}
		</Box>
	);
};
