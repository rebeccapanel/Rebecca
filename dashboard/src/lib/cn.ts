import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge conditional class names, resolving conflicting Tailwind utilities so
 * the last one wins. Same helper the rebuilt dashboard uses, so components can
 * move between the two apps unchanged.
 */
export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}
