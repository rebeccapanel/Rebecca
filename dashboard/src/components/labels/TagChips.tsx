import { Badge } from "components/ui/badge";
import { cn } from "lib/cn";
import type { FC } from "react";

type TagChipsProps = {
	tags?: string[];
	limit?: number;
	className?: string;
};

export const TagChips: FC<TagChipsProps> = ({ tags, limit = 3, className }) => {
	if (!tags?.length) {
		return <span className="text-panel-text-muted">–</span>;
	}
	const shown = tags.slice(0, limit);
	const hidden = tags.length - shown.length;
	return (
		<div className={cn("flex min-w-0 flex-wrap items-center gap-1", className)}>
			{shown.map((tag) => (
				<Badge
					key={tag}
					variant="secondary"
					className="max-w-[9rem] truncate font-normal"
				>
					{tag}
				</Badge>
			))}
			{hidden > 0 && (
				<Badge
					variant="outline"
					className="font-normal"
					title={tags.slice(limit).join(", ")}
				>
					+{hidden}
				</Badge>
			)}
		</div>
	);
};
