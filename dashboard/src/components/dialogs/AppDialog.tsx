import {
	Modal,
	ModalBody,
	ModalCloseButton,
	ModalContent,
	ModalFooter,
	ModalHeader,
	ModalOverlay,
	type ModalProps,
} from "@chakra-ui/react";
import type { ComponentProps, ReactNode } from "react";

export type AppDialogProps = Omit<ModalProps, "children"> & {
	title: ReactNode;
	children: ReactNode;
	footer?: ReactNode;
	overlayProps?: ComponentProps<typeof ModalOverlay>;
	contentProps?: ComponentProps<typeof ModalContent>;
	headerProps?: ComponentProps<typeof ModalHeader>;
	closeButtonProps?: ComponentProps<typeof ModalCloseButton>;
	bodyProps?: ComponentProps<typeof ModalBody>;
	footerProps?: ComponentProps<typeof ModalFooter>;
};

export const AppDialog = ({
	title,
	children,
	footer,
	overlayProps,
	contentProps,
	headerProps,
	closeButtonProps,
	bodyProps,
	footerProps,
	...modalProps
}: AppDialogProps) => (
	<Modal {...modalProps}>
		<ModalOverlay {...overlayProps} />
		<ModalContent {...contentProps}>
			<ModalHeader {...headerProps}>{title}</ModalHeader>
			<ModalCloseButton {...closeButtonProps} />
			<ModalBody {...bodyProps}>{children}</ModalBody>
			{footer != null && <ModalFooter {...footerProps}>{footer}</ModalFooter>}
		</ModalContent>
	</Modal>
);
