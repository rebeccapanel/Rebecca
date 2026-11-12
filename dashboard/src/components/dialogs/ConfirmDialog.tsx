import { Button } from "components/ui/button";
import { CircleAlert, CircleCheck, Info } from "lucide-react";
import { withClass } from "lib/withClass";
import { TriangleAlert } from "lucide-react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogTitle,
} from "components/ui/dialog";

import { useDisclosure } from "hooks/useDisclosure";
import { cn } from "lib/cn";
import {
	cloneElement,
	type MouseEvent,
	type ReactElement,
	type ReactNode,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";

const WarningIcon = withClass(TriangleAlert, "w-6 h-6");

export type ConfirmDialogProps = {
	open: boolean;
	title: ReactNode;
	description: ReactNode;
	confirmLabel?: string;
	cancelLabel?: string;
	colorScheme?: string;
	loading?: boolean;
	isConfirmDisabled?: boolean;
	onClose: () => void;
	onConfirm: () => void | Promise<void>;
};

export const ConfirmDialog = ({
	open: isOpen,
	title,
	description,
	confirmLabel,
	cancelLabel,
	colorScheme = "primary",
	loading: isLoading,
	isConfirmDisabled = false,
	onClose,
	onConfirm,
}: ConfirmDialogProps) => {
	const { t } = useTranslation();
	const cancelRef = useRef<HTMLButtonElement | null>(null);
	const mutedText = "text-panel-text-muted";
	const iconBg = `bg-${colorScheme}-50 dark:bg-${colorScheme}-200/16`;
	const iconColor = `text-${colorScheme}-600 dark:text-${colorScheme}-200`;

	return (
		<Dialog open={isOpen} onOpenChange={(next) => { if (!next) onClose(); }}>
			<DialogContent
				showCloseButton={false}
				onKeyDown={(event) => {
					if (event.key !== "Enter" || isLoading || isConfirmDisabled) return;
					event.preventDefault();
					void onConfirm();
				}}
				className="mx-4 max-w-[calc(100vw_-_32px)] gap-0 overflow-hidden rounded-2xl px-4 py-3.5 shadow-2xl sm:mx-0 sm:max-w-[520px] sm:px-4.5 sm:py-4"
			>
				<div className="flex items-start gap-2.5">
					<div className={cn(iconBg, iconColor, "flex size-9 shrink-0 items-center justify-center rounded-full")}>
						<WarningIcon />
					</div>
					<div className="min-w-0! flex-1">
						<DialogTitle className="mb-0.5 text-[1.125rem] font-extrabold leading-[1.375] rb-confirm-dialog-content">
							{title}
						</DialogTitle>
						<DialogDescription asChild className="mt-1.5">
							<div>
								{typeof description === "string" ? (
									<p className={cn("text-[0.875rem] leading-[1.45]", mutedText)}>{description}</p>
								) : (
									description
								)}
							</div>
						</DialogDescription>
					</div>
				</div>
				<DialogFooter className="mt-2 flex-wrap justify-end gap-1.5 rb-confirm-dialog-actions">
					<Button ref={cancelRef} onClick={onClose} disabled={isLoading} size="sm" className="h-[34px] min-h-[34px] min-w-[76px]! px-3 text-[0.875rem]">
						{cancelLabel ?? t("cancel")}
					</Button>
					<Button variant={colorScheme === "red" ? "destructive" : "default"} disabled={isConfirmDisabled} onClick={onConfirm} size="sm" loading={isLoading} className="h-[34px] min-h-[34px] min-w-[76px]! px-3 text-[0.875rem]">
						{confirmLabel ?? t("confirm")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};

const stripHtmlTags = (value: string) => value.replace(/<[^>]*>/g, "");

export type DeleteConfirmDialogProps = {
	children: ReactElement;
	description?: ReactNode;
	confirmLabel?: string;
	cancelLabel?: string;
	loading?: boolean;
	disabled?: boolean;
	onConfirm: () => void | Promise<void>;
	onCancel?: () => void;
};

export const DeleteConfirmDialog = ({
	children,
	description,
	confirmLabel,
	cancelLabel,
	loading: isLoading,
	disabled: isDisabled,
	onConfirm,
	onCancel,
}: DeleteConfirmDialogProps) => {
	const { t } = useTranslation();
	const { isOpen, onClose, onOpen } = useDisclosure();
	const [isConfirming, setIsConfirming] = useState(false);
	const busy = Boolean(isLoading) || isConfirming;
	const confirmMessage =
		typeof description === "string"
			? stripHtmlTags(description)
			: (description ?? t("common.confirmDelete"));

	const handleClose = () => {
		if (busy) return;
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
			if (!isDisabled && !busy) onOpen();
		},
		onClick: (event: MouseEvent<HTMLElement>) => {
			childProps.onClick?.(event);
			event.stopPropagation();
		},
	} as Partial<typeof children.props>);

	return (
		<>
			{trigger}
			<ConfirmDialog
				open={isOpen}
				onClose={handleClose}
				onConfirm={handleConfirm}
				title={t("common.confirmAction")}
				description={confirmMessage}
				confirmLabel={confirmLabel ?? t("delete")}
				cancelLabel={cancelLabel ?? t("cancel")}
				colorScheme="red"
				loading={busy}
				isConfirmDisabled={Boolean(isDisabled)}
			/>
		</>
	);
};
