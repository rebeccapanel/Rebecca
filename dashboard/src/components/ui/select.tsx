import type * as React from "react";
import { Select as SelectPrimitive } from "radix-ui";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "lib/cn";

const Select = SelectPrimitive.Root;
const SelectValue = SelectPrimitive.Value;
/** Wrap an option's label in this so the trigger shows only the label, not the description under it. */
const SelectItemText = SelectPrimitive.ItemText;

function SelectTrigger({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
	return (
		<SelectPrimitive.Trigger
			data-slot="select-trigger"
			className={cn(
				"flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-start text-sm whitespace-nowrap shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-muted-foreground [&>span]:truncate",
				className,
			)}
			{...props}
		>
			{children}
			<SelectPrimitive.Icon asChild>
				<ChevronDown className="size-4 shrink-0 opacity-60" />
			</SelectPrimitive.Icon>
		</SelectPrimitive.Trigger>
	);
}

function SelectContent({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Content>) {
	return (
		<SelectPrimitive.Portal>
			<SelectPrimitive.Content
				data-slot="select-content"
				position="popper"
				sideOffset={4}
				className={cn(
					"relative z-[13000] origin-(--radix-select-content-transform-origin) data-[state=open]:animate-rb-pop-in data-[state=closed]:animate-rb-pop-out max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-panel-border bg-panel-elevated text-panel-text shadow-md",
					className,
				)}
				{...props}
			>
				<SelectPrimitive.Viewport className="w-full p-1">{children}</SelectPrimitive.Viewport>
			</SelectPrimitive.Content>
		</SelectPrimitive.Portal>
	);
}

function SelectItem({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Item>) {
	return (
		<SelectPrimitive.Item
			data-slot="select-item"
			className={cn(
				"relative flex w-full cursor-default items-start gap-2 rounded-sm py-1.5 ps-2 pe-8 text-sm outline-none select-none focus:bg-whiteAlpha-100 data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
				className,
			)}
			{...props}
		>
			<span className="absolute end-2 top-2 flex size-4 items-center justify-center">
				<SelectPrimitive.ItemIndicator>
					<Check className="size-4" />
				</SelectPrimitive.ItemIndicator>
			</span>
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">{children}</div>
		</SelectPrimitive.Item>
	);
}

export { Select, SelectContent, SelectItem, SelectItemText, SelectTrigger, SelectValue };
