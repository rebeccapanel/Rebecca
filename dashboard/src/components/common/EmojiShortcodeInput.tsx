import {
	type ComponentProps,
	type FC,
	type KeyboardEvent,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Input } from "components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "components/ui/popover";
import { cn } from "lib/cn";
import {
	type EmojiShortcode,
	emojiShortcodeInsertion,
	emojiShortcodeLabel,
	replaceShortcodeToken,
	searchEmojiShortcodes,
	shortcodeTokenAt,
} from "utils/emojiShortcode";

type EmojiShortcodeInputProps = Omit<ComponentProps<typeof Input>, "value" | "onChange"> & {
	value: string;
	onChange: (value: string) => void;
	enabled?: boolean;
};

let shortcodeTable: Promise<ReadonlyArray<EmojiShortcode>> | null = null;

const loadShortcodeTable = () => {
	shortcodeTable ??= import("utils/emojiShortcodes").then((module) => module.emojiShortcodes);
	return shortcodeTable;
};

export const EmojiShortcodeInput: FC<EmojiShortcodeInputProps> = ({
	value,
	onChange,
	enabled = true,
	ref,
	onFocus,
	onBlur,
	onKeyDown,
	onSelect,
	...props
}) => {
	const inputRef = useRef<HTMLInputElement | null>(null);
	const [table, setTable] = useState<ReadonlyArray<EmojiShortcode> | null>(null);
	const [caret, setCaret] = useState(0);
	const [focused, setFocused] = useState(false);
	const [active, setActive] = useState(0);
	const [dismissed, setDismissed] = useState(false);
	const token = enabled ? shortcodeTokenAt(value, caret) : null;
	const query = token?.query ?? "";
	const needsTable = token !== null;

	useEffect(() => {
		if (needsTable && !table) {
			void loadShortcodeTable().then(setTable);
		}
	}, [needsTable, table]);

	const results = useMemo(
		() => (table && needsTable ? searchEmojiShortcodes(table, query) : []),
		[table, needsTable, query],
	);
	const open = focused && !dismissed && results.length > 0;
	const activeIndex = Math.min(active, Math.max(results.length - 1, 0));

	const setInputRef = (node: HTMLInputElement | null) => {
		inputRef.current = node;
		if (typeof ref === "function") ref(node);
		else if (ref) (ref as { current: HTMLInputElement | null }).current = node;
	};

	const pick = (entry: EmojiShortcode) => {
		if (!token) return;
		const next = replaceShortcodeToken(value, token, emojiShortcodeInsertion(entry));
		onChange(next.text);
		setCaret(next.caret);
		setActive(0);
		requestAnimationFrame(() => {
			inputRef.current?.setSelectionRange(next.caret, next.caret);
		});
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		onKeyDown?.(event);
		if (event.defaultPrevented || !open) return;
		if (event.key === "ArrowDown") {
			event.preventDefault();
			setActive((index) => (index + 1) % results.length);
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			setActive((index) => (index - 1 + results.length) % results.length);
		} else if (event.key === "Enter" || event.key === "Tab") {
			event.preventDefault();
			pick(results[activeIndex]);
		} else if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			setDismissed(true);
		}
	};

	return (
		<Popover open={open}>
			<PopoverAnchor asChild>
				<Input
					{...props}
					ref={setInputRef}
					value={value}
					autoComplete="off"
					aria-expanded={open}
					aria-autocomplete="list"
					onChange={(event) => {
						onChange(event.target.value);
						setCaret(event.target.selectionStart ?? 0);
						setActive(0);
						setDismissed(false);
					}}
					onSelect={(event) => {
						setCaret(event.currentTarget.selectionStart ?? 0);
						onSelect?.(event);
					}}
					onKeyDown={handleKeyDown}
					onFocus={(event) => {
						setFocused(true);
						setCaret(event.currentTarget.selectionStart ?? 0);
						onFocus?.(event);
					}}
					onClick={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
					onKeyUp={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
					onBlur={(event) => {
						setFocused(false);
						onBlur?.(event);
					}}
				/>
			</PopoverAnchor>
			<PopoverContent
				align="start"
				onOpenAutoFocus={(event) => event.preventDefault()}
				onMouseDown={(event) => event.preventDefault()}
				className="z-[16050] w-[var(--radix-popper-anchor-width)] max-h-[260px] overflow-y-auto p-1"
			>
				<div role="listbox" className="flex flex-col gap-0.5">
					{results.map((entry, index) => (
						<button
							type="button"
							key={entry[0]}
							role="option"
							aria-selected={index === activeIndex}
							onMouseDown={(event) => {
								event.preventDefault();
								pick(entry);
							}}
							onMouseEnter={() => setActive(index)}
							className={cn(
								"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm",
								index === activeIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
							)}
						>
							<span className="text-base leading-none">{entry[1]}</span>
							<span className="font-mono text-xs">:{entry[0]}:</span>
							<span className="ms-auto truncate text-xs text-muted-foreground">
								{emojiShortcodeLabel(entry)}
							</span>
						</button>
					))}
				</div>
			</PopoverContent>
		</Popover>
	);
};
