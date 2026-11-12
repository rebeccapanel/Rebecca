import { DialogContent, DialogFooter, DialogHeader } from "components/ui/dialog";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";

import type { ComponentPropsWithoutRef } from "react";
import { cn } from "lib/cn";
import type { FC, ReactNode } from "react";

// UX credit: Xray edit dialogs follow the compact Ant Design/3x-ui form rhythm:
// tight headers, section panels, small controls, and explicit footer actions.
export const XrayModalContent: FC<Parameters<typeof DialogContent>[0]> = ({ className, children, ...props }) => (
	<DialogContent {...props} className={cn("rb-xray-dialog flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0", className)}>
		{children}
	</DialogContent>
);

export const XrayModalHeader: FC<
	ComponentPropsWithoutRef<"div"> & { subtitle?: ReactNode }
> = ({ children, subtitle, ...props }) => (
	<DialogHeader {...props} className="shrink-0 px-4 md:px-5 py-3">
		<p className="text-[1rem] font-semibold">
			{children}
		</p>
		{subtitle && (
			<p className="mt-1 text-[0.75rem] text-gray-500 dark:text-gray-400">
				{subtitle}
			</p>
		)}
	</DialogHeader>
);

export const XrayModalBody: FC<ComponentPropsWithoutRef<"div">> = ({ children, ...props }) => (
	<div className={cn("min-h-0 flex-1 overflow-y-auto", "px-4 md:px-5 py-4")}>
		{children}
	</div>
);

export const XrayModalFooter: FC<ComponentPropsWithoutRef<"div">> = ({
	children,
	...props
}) => (
	<DialogFooter {...props} className="shrink-0 px-4 md:px-5 py-3 gap-2">
		{children}
	</DialogFooter>
);

export const XrayDialogSection: FC<
	ComponentPropsWithoutRef<"div"> & { title?: ReactNode; description?: ReactNode }
> = ({ title, description, children, className, ...props }) => (
	<div {...props} className={cn(["xray-dialog-section", className].filter(Boolean).join(" "))}>
		{title && (
			<div className="mb-3">
				<p className="text-[0.875rem] font-semibold">
					{title}
				</p>
				{description && (
					<p className="mt-1 text-[0.75rem] text-gray-500 dark:text-gray-400">
						{description}
					</p>
				)}
			</div>
		)}
		{children}
	</div>
);

export const XrayFieldGrid: FC<ComponentPropsWithoutRef<"div">> = ({
	children,
	...props
}) => (
	<div {...props} className="grid grid-cols-1 md:grid-cols-2 gap-3">
		{children}
	</div>
);
