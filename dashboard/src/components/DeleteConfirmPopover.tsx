import {
	Box,
	Button,
	ButtonGroup,
	Popover,
	PopoverArrow,
	PopoverBody,
	PopoverContent,
	PopoverFooter,
	PopoverTrigger,
	Portal,
	Text,
	useDisclosure,
} from "@chakra-ui/react";
import type { MouseEvent, ReactElement, ReactNode } from "react";
import { useTranslation } from "react-i18next";

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
	const confirmMessage =
		typeof message === "string"
			? stripHtmlTags(message)
			: (message ?? t("common.confirmDelete", "Delete this item?"));

	return (
		<Popover
			placement="top"
			closeOnBlur
			isLazy
			isOpen={isOpen}
			onClose={onClose}
			modifiers={[
				{
					name: "preventOverflow",
					options: {
						boundary: "viewport",
						padding: 12,
					},
				},
				{
					name: "flip",
					options: {
						boundary: "viewport",
						padding: 12,
						fallbackPlacements: ["bottom", "left", "right"],
					},
				},
			]}
		>
			{() => (
				<>
					<PopoverTrigger>
						<Box
							as="span"
							display="inline-flex"
							onClickCapture={(event: MouseEvent<HTMLSpanElement>) => {
								event.preventDefault();
								event.stopPropagation();
								if (!isDisabled && !isLoading) {
									onOpen();
								}
							}}
							onClick={(event: MouseEvent<HTMLSpanElement>) =>
								event.stopPropagation()
							}
						>
							{children}
						</Box>
					</PopoverTrigger>
					<Portal>
						<PopoverContent
							w={{ base: "calc(100vw - 24px)", sm: "min(320px, calc(100vw - 24px))" }}
							maxW="calc(100vw - 24px)"
							minW="0"
							borderRadius="md"
							boxShadow="lg"
							_focusVisible={{ outline: "none" }}
						>
							<PopoverArrow />
							<PopoverBody pb={2}>
								<Text
									fontSize="sm"
									whiteSpace="normal"
									overflowWrap="anywhere"
									wordBreak="break-word"
								>
									{confirmMessage}
								</Text>
							</PopoverBody>
							<PopoverFooter
								display="flex"
								justifyContent="flex-end"
								borderTopWidth="0"
								pt={0}
							>
								<ButtonGroup
									size="sm"
									spacing={2}
									flexWrap="wrap"
									justifyContent="flex-end"
								>
									<Button
										variant="ghost"
										onClick={(event) => {
											event.stopPropagation();
											onCancel?.();
											onClose();
										}}
										isDisabled={isLoading}
									>
										{cancelLabel ?? t("cancel", "Cancel")}
									</Button>
									<Button
										colorScheme="red"
										isLoading={isLoading}
										isDisabled={isDisabled}
										onClick={async (event) => {
											event.stopPropagation();
											await onConfirm();
											onClose();
										}}
									>
										{confirmLabel ?? t("delete", "Delete")}
									</Button>
								</ButtonGroup>
							</PopoverFooter>
						</PopoverContent>
					</Portal>
				</>
			)}
		</Popover>
	);
};
