import type * as React from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { cn } from "lib/cn";

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverAnchor = PopoverPrimitive.Anchor;

function PopoverContent({
	className,
	align = "center",
	sideOffset = 6,
	...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
	return (
		<PopoverPrimitive.Portal>
			<PopoverPrimitive.Content
				data-slot="popover-content"
				align={align}
				sideOffset={sideOffset}
				className={cn(
					"z-[13000] w-72 origin-(--radix-popover-content-transform-origin) data-[state=open]:animate-rb-pop-in data-[state=closed]:animate-rb-pop-out rounded-md border border-panel-border bg-panel-elevated p-3 text-panel-text shadow-md outline-hidden",
					className,
				)}
				{...props}
			/>
		</PopoverPrimitive.Portal>
	);
}

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger };
