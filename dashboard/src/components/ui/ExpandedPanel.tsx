import { cn } from "lib/cn";
import type { ReactNode } from "react";

export const ExpandedDetails = ({ children }: { children: ReactNode }) => (
	<div data-density="compact" className="rb-resource-details">
		{children}
	</div>
);

export const ExpandedHeading = ({
	title,
	first,
}: {
	title: ReactNode;
	first?: boolean;
}) => (
	<p className={cn("[grid-column:1_/_-1] flex items-center gap-2 pb-0.5 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-panel-text-muted after:h-px after:flex-1 after:bg-panel-border", first ? "pt-0" : "pt-2")}>
		{title}
	</p>
);

export const ExpandedMeta = ({
	label,
	value,
	wide,
}: {
	label: ReactNode;
	value: ReactNode;
	wide?: boolean;
}) => (
	<div className={cn("min-w-0! rb-resource-meta", wide && "[grid-column:1_/_-1]")}>
		<span className="text-panel-text-muted">
			{label}
		</span>
		<div className="text-panel-text rb-resource-meta-value">
			{value}
		</div>
	</div>
);
