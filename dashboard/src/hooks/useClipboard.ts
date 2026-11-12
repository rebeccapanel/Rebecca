import { useCallback, useEffect, useRef, useState } from "react";

/** Chakra's useClipboard: copies the value and flags `hasCopied` for a short time. `setValue` changes what gets copied. */
export function useClipboard(initialValue: string, timeout = 1500) {
	const [value, setValue] = useState(initialValue);
	const [hasCopied, setHasCopied] = useState(false);
	const timer = useRef<number | undefined>(undefined);

	useEffect(() => setValue(initialValue), [initialValue]);
	useEffect(() => () => window.clearTimeout(timer.current), []);

	const onCopy = useCallback(() => {
		navigator.clipboard
			?.writeText(value)
			.then(() => {
				setHasCopied(true);
				window.clearTimeout(timer.current);
				timer.current = window.setTimeout(() => setHasCopied(false), timeout);
			})
			.catch(() => {});
	}, [value, timeout]);

	return { value, setValue, hasCopied, onCopy };
}
