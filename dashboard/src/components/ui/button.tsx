import { cva, type VariantProps } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";
import { Slot } from "radix-ui";
import * as React from "react";
import { Children, isValidElement } from "react";
import { cn } from "lib/cn";

const buttonVariants = cva(
	"inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold outline-none transition-[color,background-color,border-color,box-shadow,transform,opacity] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] select-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
	{
		variants: {
			variant: {
				default: "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
				destructive:
					"bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
				outline:
					"border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50",
				secondary: "bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80",
				ghost: "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
				link: "text-primary underline-offset-4 hover:underline",
			},
			size: {
				default: "h-9 px-4 py-2 has-[>svg]:px-3",
				xs: "h-7 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5",
				sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
				lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
				icon: "size-9",
				"icon-sm": "size-8",
			},
		},
		defaultVariants: { variant: "default", size: "default" },
	},
);

export type ButtonProps = React.ComponentProps<"button"> &
	VariantProps<typeof buttonVariants> & {
		asChild?: boolean;
		loading?: boolean;
	};

function isIconLeaf(node: React.ReactNode): boolean {
	if (!isValidElement<{ className?: string; children?: React.ReactNode }>(node)) {
		return false;
	}
	if (node.type === "svg") {
		return true;
	}
	if (typeof node.type === "string") {
		return false;
	}
	return node.props.children === undefined || node.props.children === null;
}

function replaceFirstIconWithLoader(
	children: React.ReactNode,
	fallbackSizeClass?: string,
): { content: React.ReactNode; replaced: boolean } {
	let replaced = false;
	const mapped = Children.map(children, (child) => {
		if (
			replaced ||
			!isValidElement<{ className?: string; children?: React.ReactNode }>(child)
		) {
			return child;
		}
		if (isIconLeaf(child)) {
			replaced = true;
			return (
				<LoaderCircle
					className={cn(
						!child.props.className && fallbackSizeClass,
						child.props.className,
						"aspect-square animate-spin",
					)}
					aria-hidden="true"
				/>
			);
		}
		if (child.props.children !== undefined && child.props.children !== null) {
			const nested = replaceFirstIconWithLoader(
				child.props.children,
				fallbackSizeClass,
			);
			if (nested.replaced) {
				replaced = true;
				return React.cloneElement(child, undefined, nested.content);
			}
		}
		return child;
	});
	return { content: mapped, replaced };
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
	{ className, variant, size, asChild = false, loading = false, disabled, children, type = "button", ...props },
	ref,
) {
	const Comp = asChild ? Slot.Slot : "button";
	const fallbackSizeClass = size === "xs" ? "size-3.5" : undefined;
	const loadingRender =
		loading && !asChild
			? replaceFirstIconWithLoader(children, fallbackSizeClass)
			: null;
	return (
		<Comp
			ref={ref}
			data-slot="button"
			type={asChild ? undefined : type}
			disabled={asChild ? undefined : disabled || loading}
			className={cn(buttonVariants({ variant, size }), className)}
			{...props}
		>
			{asChild ? (
				children
			) : loadingRender ? (
				loadingRender.replaced ? (
					loadingRender.content
				) : (
					<>
						<LoaderCircle
							className={cn(fallbackSizeClass, "aspect-square animate-spin")}
							aria-hidden="true"
						/>
						{children}
					</>
				)
			) : (
				children
			)}
		</Comp>
	);
});

export { Button, buttonVariants };
