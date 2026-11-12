import { cn } from "lib/cn";
import {
	type FC,
	forwardRef,
	memo,
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
	useEffect,
	useMemo,
	useState,
} from "react";
import { useTranslation } from "react-i18next";

export interface SponsorCarouselItem {
	id: string;
	src: string;
	alt: string;
	href?: string;
	label?: string;
	isSponsor?: boolean;
}

interface SponsorCarouselProps {
	items: SponsorCarouselItem[];
	variant: "logo" | "banner" | "sidebar";
	collapsed?: boolean;
	animateIn?: boolean;
}

interface SponsorLinkProps {
	href?: string;
	label?: string;
	isBanner?: boolean;
	children: ReactNode;
}

const SponsorLink = forwardRef<HTMLAnchorElement, SponsorLinkProps>(
	function SponsorLink({ href, label, isBanner = false, children }, ref) {
		const sharedClass = cn(
			"flex h-full w-full min-w-0! items-center select-none no-underline [-webkit-touch-callout:none] [-webkit-user-drag:none]",
			isBanner ? "justify-center gap-0" : "justify-start gap-3",
		);

		if (href) {
			return (
				<a
					ref={ref}
					href={href}
					target="_blank"
					rel="noopener noreferrer"
					title={label}
					className={cn(sharedClass, "cursor-pointer")}
					onDragStart={(e) => e.preventDefault()}
					onContextMenu={(e) => e.preventDefault()}
					onClick={(e: ReactMouseEvent<HTMLAnchorElement>) => {
						e.preventDefault();
						e.stopPropagation();
						window.open(href, "_blank", "noopener,noreferrer");
					}}
				>
					{children}
				</a>
			);
		}

		return (
			<div className={sharedClass}>
				{children}
			</div>
		);
	},
);

export const SponsorCarousel: FC<SponsorCarouselProps> = memo(
	function SponsorCarousel({
		items,
		variant,
		collapsed = false,
	}) {
		const { t } = useTranslation();
		const stableItems = useMemo(
			() => items.filter((item) => Boolean(item.src)),
			[items],
		);
		const [index, setIndex] = useState(0);
		const [paused, setPaused] = useState(false);
		const [bannerDimensions, setBannerDimensions] = useState<{
			width: number;
			ratio: number;
		}>({ width: 220, ratio: 5.5 });

		const isBanner = variant === "banner";
		const isSidebarBanner = variant === "sidebar";
		const isVertical = isBanner || isSidebarBanner;
		const itemCount = stableItems.length;
		const currentIsSponsor = Boolean(stableItems[index]?.isSponsor);
		const currentItemId = stableItems[index]?.id ?? "";
		const activeBannerSrc = isBanner ? stableItems[index]?.src : undefined;

		useEffect(() => {
			if (!isBanner || !activeBannerSrc) return;
			const probe = new window.Image();
			const updateDimensions = () => {
				if (probe.naturalWidth && probe.naturalHeight) {
					const ratio = probe.naturalWidth / probe.naturalHeight;
					const width = Math.round(ratio * 38);
					setBannerDimensions((prev) => {
						if (prev.width === width && prev.ratio === ratio) return prev;
						return { width, ratio };
					});
				}
			};
			probe.onload = updateDimensions;
			probe.src = activeBannerSrc;
			if (probe.complete) {
				updateDimensions();
			}
		}, [isBanner, activeBannerSrc]);

		useEffect(() => {
			if (index >= stableItems.length) {
				setIndex(0);
			}
		}, [index, stableItems.length]);

		useEffect(() => {
			if (paused || itemCount < 2 || !currentItemId) return;
			const delay =
				variant === "logo" ? (currentIsSponsor ? 7000 : 10000) : 7000;
			const timer = window.setTimeout(() => {
				setIndex((current) => (current + 1) % itemCount);
			}, delay);
			return () => window.clearTimeout(timer);
		}, [currentIsSponsor, currentItemId, itemCount, paused, variant]);

		if (stableItems.length === 0) return null;

		return (
			<section
				aria-label={t("a11y.sponsor")}
				onMouseEnter={() => setPaused(true)}
				onMouseLeave={() => setPaused(false)}
				onFocus={() => setPaused(true)}
				onBlur={() => setPaused(false)}
				style={{
					width:
						isBanner && bannerDimensions.width
							? `${bannerDimensions.width}px`
							: "100%",
					aspectRatio: isBanner
						? `${bannerDimensions.ratio}`
						: isSidebarBanner
							? "21 / 17"
							: undefined,
				}}
				className={cn(
					"relative overflow-hidden transition-[border-color,box-shadow] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
					isBanner
						? "inline-flex h-auto max-h-[38px] min-w-[40px]! max-w-full shrink items-center justify-start rounded-[12px] border border-panel-border! bg-panel-surface shadow-[0_1px_4px_rgba(0,0,0,0.06)] min-[769px]:hover:border-panel-border-strong! min-[769px]:hover:shadow-[0_4px_14px_rgba(0,0,0,0.12)]"
						: isSidebarBanner
							? "block w-full max-w-full rounded-[12px] border border-panel-border! bg-panel-surface shadow-[0_2px_8px_rgba(0,0,0,0.06)] min-[769px]:hover:border-panel-border-strong!"
							: "block h-full w-full rounded-[10px] border-0 bg-transparent",
				)}
			>
				<div
					style={{
						transform: isVertical
							? `translate3d(0, -${index * 100}%, 0)`
							: `translate3d(-${index * 100}%, 0, 0)`,
					}}
					className={cn(
						"flex h-full w-full transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none [&_img]:border-0 [&_img]:outline-none",
						isVertical ? "flex-col" : "flex-row",
					)}
				>
					{stableItems.map((item) => {
						const effectiveHref =
							item.href ||
							(item.isSponsor ? "https://webdade.com/" : undefined);
						const hoverTitle = item.label || item.alt || "Sponsor";

						return (
							<div
								key={item.id}
								className={cn(
									"flex h-full w-full min-w-full! shrink-0 items-center",
									isVertical && "min-h-full",
									isBanner ? "justify-center gap-0" : "justify-start gap-3",
								)}
							>
								<SponsorLink
									href={effectiveHref}
									label={hoverTitle}
									isBanner={isBanner}
								>
									<img
										src={item.src}
										alt={item.alt}
										draggable={false}
										loading={isBanner || isSidebarBanner ? "eager" : "lazy"}
										onLoad={(e) => {
											const img = e.currentTarget;
											if (img.naturalWidth && img.naturalHeight && isBanner) {
												const ratio = img.naturalWidth / img.naturalHeight;
												const width = Math.round(ratio * 38);
												setBannerDimensions({ width, ratio });
											}
										}}
										className={cn(
											"pointer-events-none block max-h-full max-w-full select-none [-webkit-user-drag:none]",
											isBanner
												? "h-full w-full rounded-[11px] object-fill"
												: isSidebarBanner
													? "h-full w-full rounded-[11px] object-cover"
													: "size-8 rounded-[8px] object-contain",
										)}
									/>
									{variant === "logo" && !collapsed ? (
										<span className="truncate font-sans text-lg font-bold tracking-tight text-panel-text leading-none whitespace-nowrap md:text-xl">
											{item.isSponsor ? item.label : "Rebecca"}
										</span>
									) : null}
								</SponsorLink>
							</div>
						);
					})}
				</div>
			</section>
		);
	},
);
