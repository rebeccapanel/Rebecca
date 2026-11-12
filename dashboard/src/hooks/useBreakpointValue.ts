import { useEffect, useState } from "react";

/** Same breakpoints as the Chakra theme this replaces. */
const BREAKPOINT_MIN_WIDTH = {
	sm: "30em",
	md: "48em",
	lg: "62em",
	xl: "80em",
	"2xl": "96em",
} as const;

type Breakpoint = "base" | keyof typeof BREAKPOINT_MIN_WIDTH;
type BreakpointValues<T> = Partial<Record<Breakpoint, T>>;

const ORDER: Breakpoint[] = ["base", "sm", "md", "lg", "xl", "2xl"];

function currentBreakpoint(): Breakpoint {
	let current: Breakpoint = "base";
	for (const bp of ORDER) {
		if (bp === "base") continue;
		if (window.matchMedia(`(min-width: ${BREAKPOINT_MIN_WIDTH[bp]})`).matches) {
			current = bp;
		}
	}
	return current;
}

/**
 * Chakra semantics: the value of the largest defined breakpoint at or below the
 * current viewport. Returns undefined when nothing is defined that low.
 */
export function useBreakpointValue<T>(values: BreakpointValues<T>): T | undefined {
	const [bp, setBp] = useState<Breakpoint>(() =>
		typeof window === "undefined" ? "base" : currentBreakpoint(),
	);

	useEffect(() => {
		const update = () => setBp(currentBreakpoint());
		update();
		const queries = ORDER.filter((b) => b !== "base").map((b) =>
			window.matchMedia(`(min-width: ${BREAKPOINT_MIN_WIDTH[b as keyof typeof BREAKPOINT_MIN_WIDTH]})`),
		);
		queries.forEach((mql) => {
			mql.addEventListener("change", update);
		});
		return () => {
			queries.forEach((mql) => {
				mql.removeEventListener("change", update);
			});
		};
	}, []);

	for (let i = ORDER.indexOf(bp); i >= 0; i--) {
		const value = values[ORDER[i]];
		if (value !== undefined) return value;
	}
	return undefined;
}
