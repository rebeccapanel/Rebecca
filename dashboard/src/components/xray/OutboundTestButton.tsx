import { Button } from "components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "components/ui/tooltip";
import { Zap } from "lucide-react";

import type { FC } from "react";

type OutboundTestButtonProps = {
	isTesting?: boolean;
	label: string;
	onTest?: (tag: string) => void;
	tag: string;
};

export const OutboundTestButton: FC<OutboundTestButtonProps> = ({
	isTesting = false,
	label,
	onTest,
	tag,
}) => {
	if (!onTest || !tag || tag.trim().toLowerCase() === "blocked") return null;

	return (
		<Tooltip>
<TooltipTrigger asChild>
			<Button aria-label={label} loading={isTesting} onClick={() => onTest(tag)} variant="ghost" size="xs" className="size-7 p-0"><Zap /></Button>
		</TooltipTrigger>
<TooltipContent>{label}</TooltipContent>
</Tooltip>
	);
};
