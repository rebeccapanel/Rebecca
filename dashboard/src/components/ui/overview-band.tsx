import type { ReactNode } from "react";
import { cn } from "lib/cn";

export type OverviewSegment = {
	key: string;
	label: string;
	value: number;
	tone: string;
};

export type OverviewBandProps = {
	total: { label: string; value: number; caption?: ReactNode };
	rows: OverviewSegment[];
	distribution?: { label: string; segments: OverviewSegment[] };
	extra?: { label: string; value: ReactNode; caption?: ReactNode };
	locale: string;
	onSegmentSelect?: (key: string) => void;
	selectedKey?: string | null;
};

const count = (value: number, locale: string) =>
	new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);

const share = (value: number, of: number) =>
	of > 0 ? (value / of) * 100 : 0;

const LINK_CLASS =
	"cursor-pointer text-start underline decoration-panel-text-muted/60 underline-offset-4 transition-colors hover:text-panel-accent hover:decoration-panel-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-panel-accent rounded-sm";

type SegmentLinkProps = {
	as: "div" | "span";
	label: string;
	active: boolean;
	onSelect?: () => void;
	className?: string;
	children: ReactNode;
};

const SegmentLink = ({ as, label, active, onSelect, className, children }: SegmentLinkProps) => {
	if (!onSelect) {
		const Tag = as;
		return <Tag className={className}>{children}</Tag>;
	}
	return (
		<button
			type="button"
			aria-label={label}
			aria-pressed={active}
			onClick={onSelect}
			className={cn(
				LINK_CLASS,
				active && "text-panel-accent decoration-panel-accent",
				className,
			)}
		>
			{children}
		</button>
	);
};

export function OverviewBand({
	total,
	rows,
	distribution,
	extra,
	locale,
	onSegmentSelect,
	selectedKey,
}: OverviewBandProps) {
	const distributionTotal = (distribution?.segments ?? []).reduce(
		(sum, segment) => sum + segment.value,
		0,
	);
	const fullLayout = Boolean(rows.length && distribution && extra);

	return (
		<section
			className={cn(
				"grid grid-cols-2 gap-x-4 gap-y-4 p-4 md:gap-0",
				fullLayout
					? "md:grid-cols-[minmax(0,14rem)_minmax(0,0.9fr)_minmax(0,1.2fr)_minmax(0,13rem)]"
					: "md:grid-cols-none md:grid-flow-col md:auto-cols-fr",
			)}
		>
			<div className="order-1 col-span-1 flex flex-col justify-between gap-2 md:pe-6">
				<span className="text-[0.6875rem] font-medium uppercase tracking-[0.1em] text-panel-text-muted">
					{total.label}
				</span>
				<div>
					<span className="rb-tabular text-[1.75rem] font-semibold leading-none tracking-tight text-panel-text">
						{count(total.value, locale)}
					</span>
					{total.caption ? (
						<p className="mt-2 text-[0.625rem] text-panel-text-muted">
							{total.caption}
						</p>
					) : null}
				</div>
			</div>

			{extra ? (
				<div className="order-2 col-span-1 flex flex-col justify-between gap-2 md:order-4 md:col-span-1 md:border-s md:border-panel-border md:ps-6">
					<span className="text-[0.6875rem] font-medium uppercase tracking-[0.1em] text-panel-text-muted">
						{extra.label}
					</span>
					<div>
						<span
							dir="ltr"
							className="rb-tabular block text-[1.75rem] font-semibold leading-none tracking-tight text-panel-text"
							style={{ unicodeBidi: "isolate" }}
						>
							{extra.value}
						</span>
						<p className="mt-2 text-[0.625rem] text-panel-text-muted">
							{extra.caption ?? <span>&nbsp;</span>}
						</p>
					</div>
				</div>
			) : null}

			{rows.length > 0 ? (
				<div className="order-3 col-span-2 grid grid-cols-2 content-start gap-x-4 gap-y-3 border-t border-panel-border! pt-4 md:order-2 md:col-span-1 md:flex md:flex-col md:justify-between md:gap-3 md:border-s md:border-t-0 md:px-6 md:pt-0">
					{rows.map((row) => (
						<SegmentLink
							key={row.key}
							as="div"
							className="block w-full"
							label={row.label}
							active={selectedKey === row.key}
							onSelect={onSegmentSelect ? () => onSegmentSelect(row.key) : undefined}
						>
							<div className="flex items-center gap-1.5">
								<span className={`size-1.5 rounded-full ${row.tone}`} />
								<span className="text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-panel-text-muted">
									{row.label}
								</span>
							</div>
							<div className="mt-1 flex items-baseline gap-2">
								<span className="rb-tabular text-lg font-semibold leading-none text-panel-text">
									{count(row.value, locale)}
								</span>
								<span className="rb-tabular flex items-baseline gap-1 text-[0.625rem] text-panel-text-muted">
									<span>{count(share(row.value, total.value), locale)}%</span>
								</span>
							</div>
						</SegmentLink>
					))}
				</div>
			) : null}

			{distribution ? (
				<div className="order-4 col-span-2 flex flex-col justify-center gap-2 border-t border-panel-border! pt-4 md:order-3 md:col-span-1 md:border-s md:border-t-0 md:px-6 md:pt-0">
					<div className="flex items-center justify-between">
						<span className="text-[0.6875rem] font-medium uppercase tracking-[0.1em] text-panel-text-muted">
							{distribution.label}
						</span>
						<span className="rb-tabular text-[0.6875rem] text-panel-text-muted">
							{count(distributionTotal, locale)}
						</span>
					</div>
					<div className="flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-panel-border">
						{distribution.segments.map((segment) =>
							segment.value ? (
								<span
									key={segment.key}
									className={`h-full first:rounded-s-full last:rounded-e-full ${segment.tone}`}
									style={{ width: `${share(segment.value, distributionTotal)}%` }}
									title={`${segment.label}: ${segment.value}`}
								/>
							) : null,
						)}
					</div>
					<div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,7.5rem),1fr))] gap-x-4 gap-y-1">
						{distribution.segments.map((segment) => (
							<SegmentLink
								key={segment.key}
								as="span"
								label={segment.label}
								active={selectedKey === segment.key}
								onSelect={onSegmentSelect ? () => onSegmentSelect(segment.key) : undefined}
								className="flex min-w-0 items-center gap-1.5 text-[0.6875rem] text-panel-text-secondary"
							>
								<span className={`size-1.5 shrink-0 rounded-full ${segment.tone}`} />
								<span className="min-w-0 truncate">{segment.label}</span>
								<span className="rb-tabular ms-auto shrink-0 font-medium text-panel-text">
									{count(segment.value, locale)}
								</span>
							</SegmentLink>
						))}
					</div>
				</div>
			) : null}

		</section>
	);
}
