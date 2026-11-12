import type * as React from "react";
import { HoverCard as HoverCardPrimitive } from "radix-ui";
import { cn } from "lib/cn";

const HoverCard = HoverCardPrimitive.Root;
const HoverCardTrigger = HoverCardPrimitive.Trigger;

function HoverCardContent({
	className,
	align = "center",
	sideOffset = 6,
	...props
}: React.ComponentProps<typeof HoverCardPrimitive.Content>) {
	return (
		<HoverCardPrimitive.Portal>
			<HoverCardPrimitive.Content
				data-slot="hover-card-content"
				align={align}
				sideOffset={sideOffset}
				className={cn(
					"z-[13000] w-72 origin-(--radix-hover-card-content-transform-origin) rounded-md border border-panel-border bg-panel-elevated p-3 text-panel-text shadow-md outline-hidden",
					className,
				)}
				{...props}
			/>
		</HoverCardPrimitive.Portal>
	);
}

export { HoverCard, HoverCardContent, HoverCardTrigger };
