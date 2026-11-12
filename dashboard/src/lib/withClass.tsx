import type { ComponentType } from "react";
import { cn } from "lib/cn";

export function withClass<P extends object = Record<string, never>>(Component: ComponentType<P>, base: string) {
	return function Styled({ className, ...props }: P & { className?: string }) {
		return <Component className={cn(base, className)} {...(props as P)} />;
	};
}
