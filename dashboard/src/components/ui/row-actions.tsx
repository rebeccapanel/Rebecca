import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { buttonVariants } from "components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "components/ui/tooltip";
import { cn } from "lib/cn";

type RowActionButtonProps = Omit<ComponentPropsWithoutRef<"button">, "children"> & {
	/** Tooltip text and accessible name. */
	label: string;
	icon: ReactNode;
	danger?: boolean;
	tooltip?: string;
};

/**
 * The one action icon used in table rows: a 32px square stock ghost button with the
 * icon centred, a tooltip, and the danger tone for delete. Built from the stock variant
 * (not the compat Button) so no horizontal padding pushes the icon off its hover box.
 */
export const RowActionButton = forwardRef<HTMLButtonElement, RowActionButtonProps>(function RowActionButton(
	{ label, icon, danger = false, tooltip, className, type = "button", ...props },
	ref,
) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span className="inline-flex">
				<button
					ref={ref}
					type={type}
					aria-label={label}
					className={cn(
						buttonVariants({ variant: "ghost", size: "icon-sm" }),
						danger
							? "text-panel-danger hover:bg-panel-danger/10 hover:text-panel-danger"
							: "text-panel-text-secondary hover:bg-whiteAlpha-100 hover:text-panel-text",
						className,
					)}
					{...props}
				>
					{icon}
				</button>
				</span>
			</TooltipTrigger>
			<TooltipContent>{tooltip ?? label}</TooltipContent>
		</Tooltip>
	);
});
