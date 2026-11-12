import type { ComponentPropsWithoutRef } from "react";
import type { FC, ReactNode } from "react";
import { cn } from "lib/cn";

export type ChartBoxProps = Omit<ComponentPropsWithoutRef<"div">, "title"> & {
	title?: ReactNode;
	children: ReactNode;
	headerActions?: ReactNode;
};

/**
 * The panel's card, built on the shadcn Card primitives.
 *
 * ChartBox is used by every analytics screen, so it keeps its own API
 * (title / headerActions / children) and only the internals moved to the
 * registry component: same surface, border and radius as before.
 */
export const ChartBox: FC<ChartBoxProps> = ({
	title,
	children,
	headerActions,
	className,
	...props
}) => {
	return (
		<div
			{...props}
			data-slot="chart-box"
			className={cn(
				"flex flex-col gap-0 overflow-hidden rounded-xl border border-panel-border bg-panel-surface shadow-sm transition-[box-shadow,border-color] duration-200 hover:border-panel-border-strong",
				className,
			)}
		>
			{(title || headerActions) && (
				<div className="flex flex-wrap items-stretch justify-between gap-3 border-b border-panel-border px-4 py-4 md:items-center md:px-5">
					{title ? (
						<p className="min-w-full! flex-1 text-[1rem] font-bold text-panel-text md:min-w-[220px]! md:text-[1.125rem]">
							{title}
						</p>
					) : null}
					{headerActions ? <div className="max-w-full">{headerActions}</div> : null}
				</div>
			)}
			<div className="flex-1 p-4 md:p-5">{children}</div>
		</div>
	);
};
