import { Button } from "components/ui/button";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";

import type { ComponentPropsWithoutRef } from "react";
import { cn } from "lib/cn";
import {
	useEffect,
	useRef,
	type FC,
	type PropsWithChildren,
	type ReactNode,
} from "react";

export { BulkActionBar } from "./BulkActionBar";
export { DataTable } from "./DataTable";
export { PageLoadingSkeleton } from "./PageLoadingSkeleton";
export {
	ResourceListCard,
	ResourceRefreshButton,
	ResourceSummaryPills,
	type ResourceSummaryItem,
} from "./ResourceListCard";
export { RowActionsMenu } from "./DataTableRowActions";
export type { RowActionItem } from "./DataTableRowActions";
export type {
	DataTableBulkAction,
	DataTableColumn,
	DataTableProps,
	DataTableRowAction,
} from "./DataTable.types";

type PageHeaderProps = PropsWithChildren<
	Omit<ComponentPropsWithoutRef<"div">, "title"> & {
		title?: ReactNode;
		description?: ReactNode;
		actions?: ReactNode;
	}
>;

export const PageHeader: FC<PageHeaderProps> = ({
	children,
	title,
	description,
	actions,
	...props
}) => {
	if (!title && !description && !actions) {
		return (
			<div {...props} className="w-full text-panel-text">
				{children}
			</div>
		);
	}

	return (
		<div {...props} className="w-full text-panel-text">
			<div className="flex items-start md:items-center justify-between gap-3 flex-wrap">
				<div className="min-w-0!">
					{title && (
						<h1 className="text-[1.5rem] font-semibold">
							{title}
						</h1>
					)}
					{description && (
						<p className={cn("text-[0.875rem] text-panel-text-secondary", title ? "mt-1" : "mt-0")}>
							{description}
						</p>
					)}
					{children}
				</div>
				{actions && <div className="shrink-0">{actions}</div>}
			</div>
		</div>
	);
};

type PageTabItem = {
	label: ReactNode;
	value: string;
	isActive?: boolean;
	onClick?: () => void;
};

type TabSystemProps = ComponentPropsWithoutRef<"div"> & {
	tabs: PageTabItem[];
};

export const TabSystem: FC<TabSystemProps> = ({ tabs, ...props }) => {
	const activeTabRef = useRef<HTMLButtonElement>(null);
	const activeValue = tabs.find((tab) => tab.isActive)?.value;

	useEffect(() => {
		if (!activeValue) return;
		activeTabRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, [activeValue]);

	return (
		<div role="tablist" {...props} className={"[webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&_>_button]:flex-[0_0_auto] flex gap-6 min-h-10 px-2 md:px-3 overflow-x-auto overflow-y-hidden max-w-full whitespace-nowrap rb-tab-system"}>
			{tabs.map((tab) => (
				<Button key={tab.value} ref={tab.isActive ? activeTabRef : undefined} role="tab" aria-selected={tab.isActive} onClick={tab.onClick} variant="ghost" size="sm" className={cn("px-0 h-10 rounded-[0px] border-b-2 font-bold hover:bg-transparent hover:text-panel-accent-hover", tab.isActive ? "border-panel-accent!" : "border-transparent!", tab.isActive ? "text-panel-accent" : "text-panel-text")}>
					{tab.label}
				</Button>
			))}
		</div>
	);
};

export const PageTabs = TabSystem;
