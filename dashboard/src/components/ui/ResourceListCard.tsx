import { toneClass } from "lib/tone";
import { Badge } from "components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "components/ui/tooltip";
import { Button } from "components/ui/button";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { cn } from "lib/cn";


import type { ComponentPropsWithoutRef } from "react";
import type { FC, ReactElement, ReactNode } from "react";

export type ResourceSummaryItem = {
	label: string;
	value: string | number;
	helper?: string;
	colorScheme?: string;
};

type ResourceListCardProps = Omit<ComponentPropsWithoutRef<"div">, "title"> & {
	title: ReactNode;
	summaryItems?: ResourceSummaryItem[];
	actions?: ReactNode;
	footerActions?: ReactNode;
	children?: ReactNode;
};

export const ResourceSummaryPills: FC<{ items: ResourceSummaryItem[] }> = ({
	items,
}) => {
	if (items.length === 0) {
		return null;
	}
	return (
		<div className="flex flex-row items-center gap-2 flex-wrap">
			{items.map((item) => {
				const tag = (
					<Badge key={item.label} className={cn(toneClass(item.colorScheme ?? "gray"), "rounded-full px-3 py-1 font-medium")}>
						{item.label}:{" "}
						<span dir="ltr" className="font-bold ms-1 [unicode-bidi:isolate]">
							{item.value}
						</span>
					</Badge>
				);
				return item.helper ? (
					<Tooltip key={item.label}>
<TooltipTrigger asChild><span className="inline-flex max-w-full">{tag}</span></TooltipTrigger>
<TooltipContent>{item.helper}</TooltipContent>
</Tooltip>
				) : (
					tag
				);
			})}
		</div>
	);
};

export const ResourceListCard: FC<ResourceListCardProps> = ({
	title,
	summaryItems = [],
	actions,
	footerActions,
	children,
	...props
}) => {
	const hasFooter = Boolean(children || footerActions);
	const titleContent =
		typeof title === "string" || typeof title === "number" ? (
			<p className="font-bold text-[1.125rem]">
				{title}
			</p>
		) : (
			<div className="w-full">{title}</div>
		);

	return (
		<div {...props} className="hover:md:shadow-sm hover:md:border-panel-border-strong! flex flex-col gap-4 w-full border border-panel-border! rounded-2xl bg-panel-surface p-4 md:p-5 [transition:border-color_0.25s_ease,_box-shadow_0.25s_ease]">
			<div className="flex flex-col xl:flex-row gap-4 items-stretch xl:items-start justify-between">
				<div className="flex flex-col items-start gap-3 min-w-0! xl:min-w-[210px]!">
					{titleContent}
					<ResourceSummaryPills items={summaryItems} />
				</div>
				{actions && <div>{actions}</div>}
			</div>

			{hasFooter && (
				<>
					<hr className="w-full border-0 border-b border-panel-border! opacity-60" />
					<div className="flex flex-col xl:flex-row gap-4 items-stretch xl:items-center justify-between">
						<div className="flex flex-col gap-2 flex-1 min-w-0! rb-resource-card-controls">
							{children}
						</div>
						{footerActions && (
							<div className="flex flex-row items-center gap-2 flex-wrap justify-start xl:justify-end">
								{footerActions}
							</div>
						)}
					</div>
				</>
			)}
		</div>
	);
};

export const ResourceRefreshButton: FC<{
	"aria-label": string;
	icon: ReactElement;
	label?: ReactNode;
	loading?: boolean;
	onClick: () => void;
}> = ({ icon, label, ...props }) => {
	const button = (
		<Button {...props} variant="ghost" size="sm" className={cn("size-8 p-0", "rounded-md")}>{icon}</Button>
	);

	return label ? (
		<Tooltip>
<TooltipTrigger asChild>
			<span>{button}</span>
		</TooltipTrigger>
<TooltipContent>{label}</TooltipContent>
</Tooltip>
	) : (
		button
	);
};
