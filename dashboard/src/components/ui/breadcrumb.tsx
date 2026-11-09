import {
	Box,
	type BoxProps,
	Button,
	Menu,
	MenuButton,
	MenuItem,
	MenuList,
	Portal,
} from "@chakra-ui/react";
import {
	ChevronLeftIcon,
	ChevronRightIcon,
	EllipsisHorizontalIcon,
} from "@heroicons/react/24/outline";
import {
	cloneElement,
	forwardRef,
	type HTMLAttributes,
	type LiHTMLAttributes,
	type OlHTMLAttributes,
	type ReactElement,
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

export interface BreadcrumbProps
	extends BoxProps,
		Omit<HTMLAttributes<HTMLElement>, keyof BoxProps> {
	children?: ReactNode;
}

export const Breadcrumb = forwardRef<HTMLElement, BreadcrumbProps>(
	(props, ref) => <Box as="nav" aria-label="breadcrumb" ref={ref} {...props} />,
);

export interface BreadcrumbListProps
	extends BoxProps,
		Omit<OlHTMLAttributes<HTMLOListElement>, keyof BoxProps> {
	children?: ReactNode;
}

export const BreadcrumbList = forwardRef<HTMLOListElement, BreadcrumbListProps>(
	(props, ref) => (
		<Box
			as="ol"
			ref={ref}
			display="flex"
			flexWrap="nowrap"
			alignItems="center"
			gap={1.5}
			listStyleType="none"
			minW="0"
			p={0}
			m={0}
			{...props}
		/>
	),
);

export interface BreadcrumbItemProps
	extends BoxProps,
		Omit<LiHTMLAttributes<HTMLLIElement>, keyof BoxProps> {
	children?: ReactNode;
}

export const BreadcrumbItem = forwardRef<HTMLLIElement, BreadcrumbItemProps>(
	(props, ref) => (
		<Box
			as="li"
			ref={ref}
			display="inline-flex"
			alignItems="center"
			gap={1.5}
			listStyleType="none"
			{...props}
		/>
	),
);

export interface BreadcrumbLinkProps extends BoxProps {
	children?: ReactNode;
	href?: string;
	onClick?: (event: ReactMouseEvent<HTMLElement>) => void;
	render?: ReactElement;
	asChild?: boolean;
	isClickable?: boolean;
}

export const BreadcrumbLink = forwardRef<HTMLElement, BreadcrumbLinkProps>(
	({ render, children, href, onClick, isClickable = true, ...props }, ref) => {
		if (render) {
			return cloneElement(render, {
				ref,
				...props,
				onClick: isClickable
					? (e: ReactMouseEvent<HTMLElement>) => {
							render.props.onClick?.(e);
							onClick?.(e);
						}
					: undefined,
				children: render.props.children ?? children,
			});
		}

		if (!isClickable || (!href && !onClick)) {
			return (
				<Box
					as="span"
					ref={ref as any}
					display="inline-flex"
					alignItems="center"
					p={0}
					h="auto"
					minW="auto"
					whiteSpace="nowrap"
					cursor="default"
					userSelect="none"
					fontSize={{ base: "xs", md: "12.5px" }}
					fontWeight="500"
					color="panel.textMuted"
					{...props}
				>
					{children}
				</Box>
			);
		}

		return (
			<Box
				as={href ? "a" : "button"}
				type={href ? undefined : "button"}
				href={href}
				ref={ref as any}
				display="inline-flex"
				alignItems="center"
				p={0}
				h="auto"
				minW="auto"
				whiteSpace="nowrap"
				bg="transparent"
				border="none"
				cursor="pointer"
				fontSize={{ base: "xs", md: "12.5px" }}
				fontWeight="500"
				color="panel.textSecondary"
				transition="all 0.16s cubic-bezier(0.2, 0, 0, 1)"
				_hover={{ md: { color: "panel.text" } }}
				_active={{ transform: "scale(0.98)" }}
				onClick={onClick}
				{...props}
			>
				{children}
			</Box>
		);
	},
);

export interface BreadcrumbPageProps
	extends BoxProps,
		Omit<HTMLAttributes<HTMLSpanElement>, keyof BoxProps> {
	children?: ReactNode;
}

export const BreadcrumbPage = forwardRef<HTMLSpanElement, BreadcrumbPageProps>(
	({ isTruncated = false, noOfLines, display, ...props }, ref) => (
		<Box
			as="span"
			ref={ref}
			role="link"
			aria-disabled="true"
			aria-current="page"
			fontSize={{ base: "xs", md: "12.5px" }}
			fontWeight="600"
			color="panel.text"
			display={display ?? (isTruncated ? "inline-block" : "inline-flex")}
			maxW={isTruncated ? "100%" : "none"}
			whiteSpace="nowrap"
			noOfLines={isTruncated ? (noOfLines ?? 1) : undefined}
			isTruncated={isTruncated}
			{...props}
		/>
	),
);

export interface BreadcrumbSeparatorProps
	extends BoxProps,
		Omit<LiHTMLAttributes<HTMLLIElement>, keyof BoxProps> {
	children?: ReactNode;
}

export const BreadcrumbSeparator = forwardRef<
	HTMLLIElement,
	BreadcrumbSeparatorProps
>(({ children, ...props }, ref) => {
	const { i18n } = useTranslation();
	const isRTL = i18n.dir(i18n.language) === "rtl";
	const Chevron = isRTL ? ChevronLeftIcon : ChevronRightIcon;

	return (
		<Box
			as="li"
			ref={ref}
			role="presentation"
			aria-hidden="true"
			display="inline-flex"
			alignItems="center"
			justifyContent="center"
			color="panel.textMuted"
			userSelect="none"
			listStyleType="none"
			flexShrink={0}
			{...props}
		>
			{children ?? <Chevron width={12} height={12} strokeWidth={2} />}
		</Box>
	);
});

export interface BreadcrumbEllipsisProps
	extends BoxProps,
		Omit<HTMLAttributes<HTMLSpanElement>, keyof BoxProps> {
	children?: ReactNode;
}

export const BreadcrumbEllipsis = forwardRef<
	HTMLSpanElement,
	BreadcrumbEllipsisProps
>(({ children, ...props }, ref) => (
	<Box
		as="span"
		ref={ref}
		role="presentation"
		aria-hidden="true"
		display="inline-flex"
		alignItems="center"
		justifyContent="center"
		w="20px"
		h="20px"
		{...props}
	>
		{children ?? <EllipsisHorizontalIcon width={14} height={14} />}
	</Box>
));

export interface BreadcrumbEllipsisDropdownProps {
	items: { label: string; path?: string }[];
	onNavigate?: (path: string) => void;
}

export const BreadcrumbEllipsisDropdown = ({
	items,
	onNavigate,
}: BreadcrumbEllipsisDropdownProps) => {
	const { i18n } = useTranslation();
	const isRTL = i18n.dir(i18n.language) === "rtl";

	if (items.length === 0) return null;

	return (
		<Menu isLazy autoSelect={false} placement="bottom-start" gutter={6}>
			<MenuButton
				as={Button}
				variant="ghost"
				size="xs"
				w="22px"
				h="22px"
				minW="22px"
				p={0}
				borderRadius="6px"
				color="panel.textMuted"
				transition="all 0.16s cubic-bezier(0.2, 0, 0, 1)"
				_hover={{
					md: {
						color: "panel.text",
						bg: "panel.elevated",
					},
				}}
				_active={{ transform: "scale(0.94)" }}
				aria-label="Toggle breadcrumb menu"
			>
				<BreadcrumbEllipsis />
			</MenuButton>
			<Portal>
				<MenuList
					dir={isRTL ? "rtl" : "ltr"}
					bg="panel.surface"
					borderColor="panel.border"
					borderWidth="1px"
					borderRadius="14px"
					boxShadow="0 10px 30px rgba(0, 0, 0, 0.25)"
					p={1.5}
					minW="160px"
					zIndex={2500}
				>
					{items.map((item, idx) => {
						if (!item.path) {
							return (
								<Box
									key={`${item.label}-${idx}`}
									px={2.5}
									py={1.5}
									fontSize="11px"
									fontWeight="600"
									color="panel.textMuted"
									userSelect="none"
									letterSpacing="0.02em"
								>
									{item.label}
								</Box>
							);
						}

						return (
							<MenuItem
								key={`${item.label}-${idx}`}
								borderRadius="8px"
								fontSize="12px"
								fontWeight="500"
								color="panel.text"
								px={2.5}
								py={1.5}
								onClick={() => {
									onNavigate?.(item.path!);
								}}
								_hover={{
									md: {
										bg: "panel.elevated",
										color: "panel.text",
									},
								}}
								_active={{
									transform: "scale(0.98)",
								}}
								transition="all 0.16s cubic-bezier(0.2, 0, 0, 1)"
							>
								{item.label}
							</MenuItem>
						);
					})}
				</MenuList>
			</Portal>
		</Menu>
	);
};
