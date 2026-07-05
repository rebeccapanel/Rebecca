import { useDisclosure } from "@chakra-ui/react";
import { cloneElement, type MouseEvent, type ReactElement, type ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmActionDialog } from "./ConfirmActionDialog";

const stripHtmlTags = (value: string) => value.replace(/<[^>]*>/g, "");

type DeleteConfirmPopoverProps = {
	children: ReactElement;
	message?: ReactNode;
	confirmLabel?: string;
	cancelLabel?: string;
	isLoading?: boolean;
	isDisabled?: boolean;
	onConfirm: () => void | Promise<void>;
	onCancel?: () => void;
};

export const DeleteConfirmPopover = ({
	children,
	message,
	confirmLabel,
	cancelLabel,
	isLoading,
	isDisabled,
	onConfirm,
	onCancel,
}: DeleteConfirmPopoverProps) => {
	const { t } = useTranslation();
	const { isOpen, onClose, onOpen } = useDisclosure();
	const [isConfirming, setIsConfirming] = useState(false);
	const confirmMessage =
		typeof message === "string"
			? stripHtmlTags(message)
			: (message ?? t("common.confirmDelete", "Delete this item?"));

	const handleClose = () => {
		if (isConfirming || isLoading) return;
		onCancel?.();
		onClose();
	};

	const handleConfirm = async () => {
		setIsConfirming(true);
		try {
			await onConfirm();
			onClose();
		} finally {
			setIsConfirming(false);
		}
	};
	const childProps = children.props as {
		onClick?: (event: MouseEvent<HTMLElement>) => void;
		onClickCapture?: (event: MouseEvent<HTMLElement>) => void;
	};
	const trigger = cloneElement(children, {
		onClickCapture: (event: MouseEvent<HTMLElement>) => {
			childProps.onClickCapture?.(event);
			if (event.defaultPrevented) return;
			event.preventDefault();
			event.stopPropagation();
			if (!isDisabled && !isLoading && !isConfirming) {
				onOpen();
			}
		},
		onClick: (event: MouseEvent<HTMLElement>) => {
			childProps.onClick?.(event);
			event.stopPropagation();
		},
	} as Partial<typeof children.props>);

	return (
		<>
			{trigger}
			<ConfirmActionDialog
				isOpen={isOpen}
				onClose={handleClose}
				onConfirm={handleConfirm}
				title={t("common.confirmAction", "Confirm action")}
				message={confirmMessage}
				confirmLabel={confirmLabel ?? t("delete", "Delete")}
				cancelLabel={cancelLabel ?? t("cancel", "Cancel")}
				colorScheme="red"
				isLoading={Boolean(isLoading) || isConfirming}
				isConfirmDisabled={Boolean(isDisabled)}
			/>
		</>
	);
};
