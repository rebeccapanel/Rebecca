import { toneClass } from "lib/tone";
import { Button } from "components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "components/ui/popover";
import { Badge } from "components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "components/ui/tooltip";
import { TriangleAlert } from "lucide-react";
import { withClass } from "lib/withClass";
import { cn } from "lib/cn";
import { Clipboard, Info } from "lucide-react";
import { useBreakpointValue } from "hooks/useBreakpointValue";

import { useClipboard } from "hooks/useClipboard";

import type React from "react";

const InfoIcon = withClass(Info, "w-4 h-4");
const CopyIcon = withClass(Clipboard, "w-4 h-4");

interface CompactPopoverProps {
	triggerLabel?: React.ReactNode;
	title?: React.ReactNode;
	children: React.ReactNode;
}

export const CompactPopover: React.FC<CompactPopoverProps> = ({
	triggerLabel,
	title,
	children,
}) => {
	const isMobile = useBreakpointValue({ base: true, md: false });
	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button variant="outline" size="xs">
					{triggerLabel ?? <InfoIcon />}
				</Button>
			</PopoverTrigger>
			<PopoverContent>
				
				
				{title && <div className={cn("p-3 font-semibold", "font-semibold")}>{title}</div>}
				<div className="p-3">{children}</div>
			</PopoverContent>
		</Popover>
	);
};

export const CompactChips: React.FC<{ chips: string[]; color?: string }> = ({
	chips,
	color = "blue",
}) => {
	const first = chips[0];
	const rest = chips.slice(1);
	return (
		<div className="flex flex-row gap-2 items-center">
			{first ? (
				<Badge className={toneClass(color)}>
					{first}
				</Badge>
			) : (
				<p className="text-gray-400">-</p>
			)}
			{rest.length > 0 && (
				<CompactPopover
					triggerLabel={<Badge>+{rest.length}</Badge>}
					title={"Details"}
				>
					<div className="flex flex-col gap-2 items-stretch">
						{chips.map((c) => (
							<div key={c} className="flex flex-row items-center gap-2 justify-between">
								<p>{c}</p>
							</div>
						))}
					</div>
				</CompactPopover>
			)}
		</div>
	);
};

export const CompactTextWithCopy: React.FC<{
	text?: string;
	label?: string;
}> = ({ text, label }) => {
	const display =
		text && text.length > 40 ? `${text.slice(0, 36)}...` : text || "-";
	const { hasCopied, onCopy } = useClipboard(text ?? "");
	return (
		<div className="flex flex-row gap-2 items-center">
			<CompactPopover triggerLabel={display} title={label}>
				<div className="flex flex-row items-start gap-2">
					<Tooltip>
<TooltipTrigger asChild>
						<Button aria-label={hasCopied ? "Copied" : "Copy"} onClick={onCopy} size="sm" className="size-8 p-0">{<CopyIcon />}</Button>
					</TooltipTrigger>
<TooltipContent>{hasCopied ? "Copied" : "Copy"}</TooltipContent>
</Tooltip>
					<p className="break-all pt-1.5">{text}</p>
				</div>
			</CompactPopover>
		</div>
	);
};

export default CompactPopover;
