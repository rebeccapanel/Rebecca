import { useEffect, type RefObject } from "react";

/** Calls `handler` for pointer presses that land outside `ref`. */
export function useOutsideClick({
	ref,
	handler,
	enabled = true,
}: {
	ref: RefObject<HTMLElement | null>;
	handler: (event: MouseEvent | TouchEvent) => void;
	enabled?: boolean;
}) {
	useEffect(() => {
		if (!enabled) return;
		const listener = (event: MouseEvent | TouchEvent) => {
			const node = ref.current;
			if (!node || node.contains(event.target as Node)) return;
			handler(event);
		};
		document.addEventListener("mousedown", listener);
		document.addEventListener("touchstart", listener);
		return () => {
			document.removeEventListener("mousedown", listener);
			document.removeEventListener("touchstart", listener);
		};
	}, [ref, handler, enabled]);
}
