import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "components/ui/dropdown-menu";
import { cn } from "lib/cn";
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import { Slot } from "radix-ui";
import type * as React from "react";
import { useTranslation } from "react-i18next";

function Breadcrumb({ className, ...props }: React.ComponentProps<"nav">) {
	const { t } = useTranslation();

	return (
		<nav
			aria-label={t("a11y.breadcrumb")}
			data-slot="breadcrumb"
			className={cn("min-w-0", className)}
			{...props}
		/>
	);
}

function BreadcrumbList({ className, ...props }: React.ComponentProps<"ol">) {
	return (
		<ol
			data-slot="breadcrumb-list"
			className={cn(
				"m-0 flex flex-nowrap items-center gap-1.5 p-0 text-xs text-panel-text-secondary list-none md:text-[12.5px]",
				className,
			)}
			{...props}
		/>
	);
}

function BreadcrumbItem({ className, ...props }: React.ComponentProps<"li">) {
	return (
		<li
			data-slot="breadcrumb-item"
			className={cn("inline-flex items-center gap-1.5 list-none", className)}
			{...props}
		/>
	);
}

function BreadcrumbLink({
	asChild,
	isClickable = true,
	className,
	...props
}: React.ComponentProps<"a"> & {
	asChild?: boolean;
	isClickable?: boolean;
}) {
	if (!isClickable && !asChild) {
		return (
			<span
				data-slot="breadcrumb-link"
				className={cn(
					"inline-flex items-center whitespace-nowrap text-xs font-medium text-panel-text-muted select-none md:text-[12.5px]",
					className,
				)}
				{...(props as React.ComponentProps<"span">)}
			/>
		);
	}

	const Comp = asChild ? Slot.Root : "a";

	return (
		<Comp
			data-slot="breadcrumb-link"
			className={cn(
				"inline-flex cursor-pointer items-center whitespace-nowrap text-xs font-medium text-panel-text-secondary transition-[color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] select-none active:scale-[0.98] md:text-[12.5px] min-[769px]:hover:text-panel-text",
				className,
			)}
			{...props}
		/>
	);
}

function BreadcrumbPage({
	className,
	isTruncated = false,
	...props
}: React.ComponentProps<"span"> & {
	isTruncated?: boolean;
}) {
	return (
		<span
			data-slot="breadcrumb-page"
			aria-current="page"
			className={cn(
				"text-xs font-semibold text-panel-text whitespace-nowrap select-none md:text-[12.5px]",
				isTruncated
					? "inline-block max-w-full truncate align-bottom"
					: "inline-flex items-center",
				className,
			)}
			{...props}
		/>
	);
}

function BreadcrumbSeparator({
	children,
	className,
	...props
}: React.ComponentProps<"li">) {
	const { i18n } = useTranslation();
	const isRTL = i18n.dir(i18n.language) === "rtl";
	const ChevronIcon = isRTL ? ChevronLeft : ChevronRight;

	return (
		<li
			data-slot="breadcrumb-separator"
			role="presentation"
			aria-hidden="true"
			className={cn(
				"inline-flex shrink-0 items-center justify-center text-panel-text-muted/70 select-none [&>svg]:size-3",
				className,
			)}
			{...props}
		>
			{children ?? <ChevronIcon strokeWidth={2} />}
		</li>
	);
}

function BreadcrumbEllipsis({
	className,
	children,
	...props
}: React.ComponentProps<"span">) {
	const { t } = useTranslation();

	return (
		<span
			data-slot="breadcrumb-ellipsis"
			role="presentation"
			aria-hidden="true"
			className={cn("inline-flex size-5 items-center justify-center", className)}
			{...props}
		>
			{children ?? <MoreHorizontal className="size-3.5" />}
			<span className="sr-only">{t("a11y.more")}</span>
		</span>
	);
}

export interface BreadcrumbEllipsisDropdownProps {
	items: { label: string; path?: string }[];
	onNavigate?: (path: string) => void;
}

function BreadcrumbEllipsisDropdown({
	items,
	onNavigate,
}: BreadcrumbEllipsisDropdownProps) {
	const { t, i18n } = useTranslation();
	const isRTL = i18n.dir(i18n.language) === "rtl";

	if (items.length === 0) return null;

	return (
		<DropdownMenu dir={isRTL ? "rtl" : "ltr"}>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					aria-label={t("a11y.toggleBreadcrumbMenu")}
					className="inline-flex size-[22px] shrink-0 items-center justify-center rounded-[6px] text-panel-text-muted transition-[background-color,color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] outline-none select-none active:scale-[0.94] focus-visible:ring-2 focus-visible:ring-panel-accent/50 min-[769px]:hover:bg-panel-elevated min-[769px]:hover:text-panel-text"
				>
					<BreadcrumbEllipsis />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align={isRTL ? "end" : "start"}
				sideOffset={6}
				className="z-[2500] min-w-[164px]! rounded-[16px] border border-panel-border! bg-panel-surface p-1.5 text-panel-text shadow-[0_12px_32px_rgba(0,0,0,0.24)]"
			>
				{items.map((item, idx) => {
					if (!item.path) {
						return (
							<div
								key={`${item.label}-${idx}`}
								className="px-2.5 py-1.5 text-[11px] font-semibold tracking-wide text-panel-text-muted select-none"
							>
								{item.label}
							</div>
						);
					}
					const targetPath = item.path;
					return (
						<DropdownMenuItem
							key={`${item.label}-${idx}`}
							onSelect={() => onNavigate?.(targetPath)}
							className="cursor-pointer rounded-[8px] px-2.5 py-1.5 text-xs font-medium text-panel-text transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98] focus:bg-panel-elevated min-[769px]:hover:bg-panel-elevated"
						>
							{item.label}
						</DropdownMenuItem>
					);
				})}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export {
	Breadcrumb,
	BreadcrumbList,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbPage,
	BreadcrumbSeparator,
	BreadcrumbEllipsis,
	BreadcrumbEllipsisDropdown,
};
