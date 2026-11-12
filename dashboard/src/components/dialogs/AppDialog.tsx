import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "components/ui/dialog";
import { cn } from "lib/cn";

import type { ComponentProps, ReactNode } from "react";

const SIZE_CLASSES = {
	sm: "sm:max-w-md max-h-[calc(100dvh-2rem)]",
	md: "sm:max-w-lg max-h-[calc(100dvh-2rem)]",
	lg: "sm:max-w-2xl max-h-[calc(100dvh-2rem)]",
	xl: "sm:max-w-3xl max-h-[calc(100dvh-2rem)]",
	"2xl": "sm:max-w-4xl max-h-[calc(100dvh-2rem)]",
	"3xl": "sm:max-w-5xl max-h-[calc(100dvh-2rem)]",
	"4xl": "sm:max-w-6xl max-h-[calc(100dvh-2rem)]",
	full: "max-w-[100vw] h-[100dvh] max-h-[100dvh]",
} as const;

export type AppDialogProps = {
	open: boolean;
	onClose: () => void;
	title: ReactNode;
	children: ReactNode;
	footer?: ReactNode;
	size?: keyof typeof SIZE_CLASSES;
	contentProps?: ComponentProps<typeof DialogContent>;
	headerProps?: ComponentProps<typeof DialogHeader>;
	bodyProps?: ComponentProps<"div">;
	footerProps?: ComponentProps<typeof DialogFooter>;
};

export const AppDialog = ({
	open,
	onClose,
	title,
	children,
	footer,
	size = "md",
	contentProps,
	headerProps,
	bodyProps,
	footerProps,
}: AppDialogProps) => (
	<Dialog open={open} onOpenChange={(next) => !next && onClose()}>
		<DialogContent {...contentProps} className={cn(SIZE_CLASSES[size], "flex flex-col", contentProps?.className)}>
			<DialogHeader {...headerProps} className={cn("shrink-0", headerProps?.className)}>
				<DialogTitle>{title}</DialogTitle>
			</DialogHeader>
			<div {...bodyProps} className={cn("min-h-0 flex-1 px-5 py-4 overflow-y-auto", bodyProps?.className)}>
				{children}
			</div>
			{footer != null && <DialogFooter {...footerProps} className={cn("shrink-0", footerProps?.className)}>{footer}</DialogFooter>}
		</DialogContent>
	</Dialog>
);
