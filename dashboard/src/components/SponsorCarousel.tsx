import { Box, Image, Text, useColorModeValue } from "@chakra-ui/react";
import { motion } from "framer-motion";
import {
	type FC,
	forwardRef,
	memo,
	type ReactNode,
	useEffect,
	useMemo,
	useState,
} from "react";

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
	children: ReactNode;
	onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
}

const SponsorLink = forwardRef<HTMLAnchorElement, SponsorLinkProps>(
	({ href, label, children, onClick, ...rest }, ref) => {
		if (href) {
			return (
				<Box
					as="a"
					ref={ref}
					href={href}
					target="_blank"
					rel="noopener noreferrer"
					title={label}
					display="flex"
					alignItems="center"
					justifyContent="center"
					gap={3}
					w="full"
					h="full"
					minW={0}
					cursor="pointer"
					userSelect="none"
					style={{ textDecoration: "none" }}
					sx={{
						WebkitUserDrag: "none",
						WebkitTouchCallout: "none",
					}}
					onDragStart={(e: React.DragEvent) => e.preventDefault()}
					onContextMenu={(e: React.MouseEvent) => e.preventDefault()}
					onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
						e.preventDefault();
						e.stopPropagation();
						if (href) {
							window.open(href, "_blank", "noopener,noreferrer");
						}
						onClick?.(e);
					}}
					{...rest}
				>
					{children}
				</Box>
			);
		}
		return (
			<Box
				ref={ref as any}
				display="flex"
				alignItems="center"
				justifyContent="center"
				gap={3}
				w="full"
				h="full"
				minW={0}
				userSelect="none"
				sx={{
					WebkitUserDrag: "none",
					WebkitTouchCallout: "none",
				}}
				onDragStart={(e: React.DragEvent) => e.preventDefault()}
				onContextMenu={(e: React.MouseEvent) => e.preventDefault()}
				{...rest}
			>
				{children}
			</Box>
		);
	},
);

export const SponsorCarousel: FC<SponsorCarouselProps> = memo(({
	items,
	variant,
	collapsed = false,
	animateIn = true,
}) => {
	const stableItems = useMemo(() => items.filter((item) => item.src), [items]);
	const [index, setIndex] = useState(0);
	const [paused, setPaused] = useState(false);
	const isBanner = variant === "banner";
	const isSidebarBanner = variant === "sidebar";
	const isVertical = isBanner || isSidebarBanner;
	const itemCount = stableItems.length;
	const currentIsSponsor = Boolean(stableItems[index]?.isSponsor);
	const currentItemId = stableItems[index]?.id ?? "";
	const frameBg = useColorModeValue("panel.surface", "panel.surface");
	const frameBorder = useColorModeValue("panel.border", "panel.border");
	const [isInitial, setIsInitial] = useState(true);
	const [bannerDimensions, setBannerDimensions] = useState<{
		width: number;
		ratio: number;
	}>({ width: 220, ratio: 5.5 });
	const activeBannerSrc = isBanner ? stableItems[index]?.src : undefined;
	useEffect(() => {
		if (!isBanner || !activeBannerSrc) return;
		const probe = new window.Image();
		const updateDimensions = () => {
			if (probe.naturalWidth && probe.naturalHeight) {
				const ratio = probe.naturalWidth / probe.naturalHeight;
				const width = Math.round(ratio * 40);
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
		if (index >= stableItems.length) setIndex(0);
	}, [index, stableItems.length]);

	useEffect(() => {
		if (paused || itemCount < 2 || !currentItemId) return;
		const delay = variant === "logo" ? (currentIsSponsor ? 7000 : 10000) : 7000;
		const timer = window.setTimeout(() => {
			setIndex((current) => (current + 1) % itemCount);
		}, delay);
		return () => window.clearTimeout(timer);
	}, [currentIsSponsor, currentItemId, itemCount, paused, variant]);

	if (stableItems.length === 0) return null;

	return (
		<motion.div
			initial={animateIn ? { y: "-140%", opacity: 0 } : false}
			animate={{ y: "0%", opacity: 1 }}
			transition={{
				duration: 0.5,
				ease: [0.16, 1, 0.3, 1],
				delay: animateIn && isInitial ? 0.7 : 0,
			}}
			style={{
				display: isBanner ? "inline-flex" : "block",
				width:
					isBanner && bannerDimensions.width
						? `${bannerDimensions.width}px`
						: "100%",
				maxWidth: "100%",
				minWidth: isBanner ? "40px" : undefined,
				alignItems: "center",
				justifyContent: isBanner ? "flex-start" : "center",
			}}
			onAnimationComplete={() => {
				if (isInitial) setIsInitial(false);
			}}
		>
			<Box
				overflow="hidden"
				w="100%"
				maxW="100%"
				minW={isBanner ? "40px" : undefined}
				h={isBanner ? "auto" : "full"}
				maxH={isBanner ? "40px" : undefined}
				aspectRatio={
					isBanner
						? `${bannerDimensions.ratio}`
						: isSidebarBanner
							? "21 / 17"
							: undefined
				}
				borderRadius={isBanner || isSidebarBanner ? "12px" : "10px"}
				borderWidth={isBanner || isSidebarBanner ? "1px" : "0px"}
				borderColor={frameBorder}
				bg={isBanner || isSidebarBanner ? frameBg : "transparent"}
				boxShadow={
					isBanner || isSidebarBanner
						? "0 2px 10px rgba(0, 0, 0, 0.06)"
						: "none"
				}
				flexShrink={isBanner ? 1 : undefined}
				transition="all 0.25s cubic-bezier(0.16, 1, 0.3, 1)"
				_hover={{
					md: {
						borderColor: "panel.borderStrong",
						boxShadow: "0 6px 20px rgba(0, 0, 0, 0.14)",
					},
				}}
				onMouseEnter={() => setPaused(true)}
				onMouseLeave={() => setPaused(false)}
				onFocus={() => setPaused(true)}
				onBlur={() => setPaused(false)}
			>
				<Box
					display="flex"
					flexDirection={isVertical ? "column" : "row"}
					w="full"
					h="full"
					transform={
						isVertical
							? `translateY(-${index * 100}%)`
							: `translateX(-${index * 100}%)`
					}
					transition="transform 500ms cubic-bezier(0.16, 1, 0.3, 1)"
					sx={{
						"@media (prefers-reduced-motion: reduce)": { transition: "none" },
						img: { border: "none", outline: "none" },
					}}
				>
					{stableItems.map((item) => {
						const image = (
							<Image
								src={item.src}
								alt={item.alt}
								draggable={false}
								loading={isBanner || isSidebarBanner ? "eager" : "lazy"}
								display="block"
								maxW="full"
								maxH="full"
								objectFit={
									isBanner ? "fill" : isSidebarBanner ? "cover" : "contain"
								}
								w="100%"
								h="100%"
								p={0}
								borderRadius={isBanner || isSidebarBanner ? "11px" : "8px"}
								transition="transform 0.25s ease"
								userSelect="none"
								onLoad={(e) => {
									const img = e.currentTarget;
									if (img.naturalWidth && img.naturalHeight && isBanner) {
										const ratio = img.naturalWidth / img.naturalHeight;
										const width = Math.round(ratio * 40);
										setBannerDimensions({ width, ratio });
									}
								}}
								sx={{
									WebkitUserDrag: "none",
									pointerEvents: "none",
								}}
								onDragStart={(e) => e.preventDefault()}
								onContextMenu={(e) => e.preventDefault()}
							/>
						);
						const effectiveHref =
							item.href ||
							(item.isSponsor ? "https://webdade.com/" : undefined);
						const hoverTitle = item.label || item.alt || "Sponsor";

						return (
							<Box
								key={item.id}
								minW="full"
								w="full"
								minH={isVertical ? "full" : undefined}
								h="full"
								display="flex"
								alignItems="center"
								justifyContent={isBanner ? "center" : "flex-start"}
								gap={isBanner ? 0 : 3}
								flexShrink={0}
							>
								<SponsorLink href={effectiveHref} label={hoverTitle}>
									{image}
									{variant === "logo" && !collapsed && (
										<Text
											fontSize={{ base: "lg", md: "2xl" }}
											fontWeight="bold"
											fontFamily="'Inter', system-ui, sans-serif"
											letterSpacing="tight"
											lineHeight="1"
											whiteSpace="nowrap"
											color="panel.text"
											noOfLines={1}
										>
											{item.isSponsor ? item.label : "Rebecca"}
										</Text>
									)}
								</SponsorLink>
							</Box>
						);
					})}
				</Box>
			</Box>
		</motion.div>
	);
});
