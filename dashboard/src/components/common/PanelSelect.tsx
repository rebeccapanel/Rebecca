import { Button } from "components/ui/button";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "components/ui/popover";
import { Badge } from "components/ui/badge";
import { Input } from "components/ui/input";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { withClass } from "lib/withClass";
import { Check as CheckIcon, ChevronDown as ChevronDownIcon, X as XMarkIcon } from "lucide-react";

import type { ComponentPropsWithoutRef } from "react";
import { cn } from "lib/cn";
import {
	type ChangeEvent,
	Fragment,
	forwardRef,
	isValidElement,
	type KeyboardEvent,
	type MouseEvent,
	type ReactNode,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { DEFAULT_SEARCH_MATCH_OPTIONS, matchesSearch } from "utils/searchMatch";
import { AppleEmojiText } from "./AppleEmojiText";
import { SearchInput } from "./SearchInput";

const Check = withClass(CheckIcon, "w-4 h-4");
const ChevronDown = withClass(ChevronDownIcon, "w-4 h-4");
const X = withClass(XMarkIcon, "w-3.5 h-3.5");

export type PanelSelectOption =
	| string
	| {
			disabled?: boolean;
			label?: ReactNode;
			searchLabel?: string;
			title?: string;
			value: string;
	  };

type NormalizedOption = {
	disabled: boolean;
	label: ReactNode;
	searchLabel: string;
	title: string;
	value: string;
};

export type PanelSelectProps = Omit<
	ComponentPropsWithoutRef<"div">,
	"children" | "defaultValue" | "onChange" | "size" | "value"
> & {
	allowCustom?: boolean;
	children?: ReactNode;
	closeOnSelect?: boolean;
	defaultValue?: string;
	disabled?: boolean;
	emptyText?: string;
	id?: string;
	isInvalid?: boolean;
	mode?: "single" | "multiple";
	name?: string;
	onBlur?: (event: {
		target: { name?: string; value?: string };
		type?: string;
	}) => void;
	onChange?: (event: ChangeEvent<HTMLSelectElement>) => void;
	onValueChange?: (value: string | string[]) => void;
	inputValue?: string;
	onInputValueChange?: (value: string) => void;
	interceptOption?: (value: string) => boolean;
	options?: PanelSelectOption[];
	placeholder?: string;
	portalled?: boolean;
	rightElement?: ReactNode;
	searchPlaceholder?: string;
	showSearch?: boolean;
	size?: "sm" | "md";
	value?: string | number | string[];
};

export const splitPanelSelectText = (value: string) =>
	value
		.split(/\r?\n|[,;]/)
		.map((item) => item.trim())
		.filter(Boolean);

const normalizeOption = (option: PanelSelectOption): NormalizedOption => {
	if (typeof option === "string") {
		return {
			disabled: false,
			label: option,
			searchLabel: option,
			title: option,
			value: option,
		};
	}
	const label =
		option.label === undefined || option.label === null
			? option.value
			: option.label;
	const searchLabel =
		option.searchLabel ??
		option.title ??
		(typeof label === "string" ? label : option.value);
	return {
		disabled: Boolean(option.disabled),
		label,
		searchLabel,
		title: option.title ?? searchLabel,
		value: option.value,
	};
};

const optionText = (node: ReactNode): string => {
	if (node === null || node === undefined || typeof node === "boolean")
		return "";
	if (typeof node === "string" || typeof node === "number") return String(node);
	if (Array.isArray(node)) return node.map(optionText).join("");
	if (isValidElement<{ children?: ReactNode }>(node)) {
		return optionText(node.props.children);
	}
	return "";
};

const renderLabel = (label: ReactNode) =>
	typeof label === "string" ? <AppleEmojiText>{label}</AppleEmojiText> : label;

const collectOptionsFromChildren = (children: ReactNode) => {
	const options: NormalizedOption[] = [];
	const collect = (node: ReactNode) => {
		if (Array.isArray(node)) {
			node.forEach(collect);
			return;
		}
		if (!isValidElement(node)) return;
		if (node.type === Fragment) {
			collect((node.props as { children?: ReactNode }).children);
			return;
		}
		if (typeof node.type !== "string" || node.type.toLowerCase() !== "option") {
			return;
		}
		const props = node.props as {
			children?: ReactNode;
			disabled?: boolean;
			value?: string | number;
		};
		const label = optionText(props.children);
		const value = props.value === undefined ? label : String(props.value);
		options.push({
			disabled: Boolean(props.disabled),
			label,
			searchLabel: label || value,
			title: label || value,
			value,
		});
	};
	collect(children);
	return options;
};

const dedupeOptions = (options: NormalizedOption[]) => {
	const seen = new Set<string>();
	const result: NormalizedOption[] = [];
	for (const option of options) {
		const key = option.value.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(option);
	}
	return result;
};

const dedupeValues = (values: string[]) => {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const raw of values) {
		const value = raw.trim();
		if (!value) continue;
		const key = value.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(value);
	}
	return result;
};

const emitSelectChange = (
	onChange: PanelSelectProps["onChange"],
	name: string | undefined,
	value: string,
) => {
	onChange?.({
		target: { name, value },
		currentTarget: { name, value },
	} as unknown as ChangeEvent<HTMLSelectElement>);
};

export const PanelSelect = forwardRef<HTMLInputElement, PanelSelectProps>(
	(
		{
			allowCustom = false,
			children,
			closeOnSelect,
			defaultValue,
			disabled,
			emptyText,
			id,
			disabled: isDisabled,
			isInvalid = false,
			mode = "single",
			name,
			onBlur,
			onChange,
			onValueChange,
			inputValue,
			onInputValueChange,
			interceptOption,
			options = [],
			placeholder,
			portalled = true,
			rightElement,
			searchPlaceholder,
			showSearch,
			size = "sm",
			value,
			className,
			...boxProps
		},
		ref,
	) => {
		const { t, i18n } = useTranslation();
		const direction = i18n.dir(i18n.language);
		const isRTL = direction === "rtl";
		const removeLabel = t("remove");
		const inputId = useId();
		const [search, setSearch] = useState("");
		const [searchMatch, setSearchMatch] = useState(
			DEFAULT_SEARCH_MATCH_OPTIONS,
		);
		const [customInputDraft, setCustomInputDraft] = useState("");
		const customInput = inputValue ?? customInputDraft;
		const setCustomInput = (next: string) => {
			setCustomInputDraft(next);
			onInputValueChange?.(next);
		};
		const [multiOpen, setMultiOpen] = useState(false);
		const [singleOpen, setSingleOpen] = useState(false);
		const multiContainerRef = useRef<HTMLDivElement | null>(null);
		const nestedMenuScrollRef = useRef<{ left: number; top: number } | null>(
			null,
		);
		const normalizedOptions = useMemo(
			() =>
				dedupeOptions([
					...collectOptionsFromChildren(children),
					...options.map(normalizeOption),
				]).filter((option) => option.value || optionText(option.label).trim()),
			[children, options],
		);
		const selectedValues = useMemo(() => {
			if (Array.isArray(value)) return dedupeValues(value);
			if (typeof value === "number") {
				const numericValue = String(value);
				return mode === "multiple"
					? splitPanelSelectText(numericValue)
					: [numericValue];
			}
			if (typeof value === "string") {
				if (mode === "multiple") return splitPanelSelectText(value);
				return value || normalizedOptions.some((option) => option.value === "")
					? [value]
					: [];
			}
			if (defaultValue !== undefined) {
				const fallbackValue = String(defaultValue);
				return mode === "multiple"
					? splitPanelSelectText(fallbackValue)
					: [fallbackValue];
			}
			return [];
		}, [defaultValue, mode, normalizedOptions, value]);
		const selectedSet = useMemo(
			() => new Set(selectedValues.map((item) => item.toLowerCase())),
			[selectedValues],
		);
		const optionByValue = useMemo(() => {
			const map = new Map<string, NormalizedOption>();
			for (const option of normalizedOptions) {
				map.set(option.value.toLowerCase(), option);
			}
			return map;
		}, [normalizedOptions]);
		const mergedOptions = useMemo(
			() =>
				dedupeOptions([
					...normalizedOptions,
					...selectedValues.map(
						(item) =>
							optionByValue.get(item.toLowerCase()) ?? normalizeOption(item),
					),
				]),
			[normalizedOptions, optionByValue, selectedValues],
		);
		const filterText = mode === "multiple" ? customInput : search;
		const filteredOptions = useMemo(() => {
			if (!filterText.trim()) return mergedOptions;
			return mergedOptions.filter((option) =>
				matchesSearch(
					`${option.searchLabel} ${option.value}`,
					filterText,
					searchMatch,
				),
			);
		}, [mergedOptions, filterText, searchMatch]);
		const searchable = showSearch ?? mergedOptions.length > 10;
		const coarsePointer = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
		const customTerm = customInput.trim();
		const canCreateCustom =
			allowCustom &&
			Boolean(customTerm) &&
			!mergedOptions.some(
				(option) => option.value.toLowerCase() === customTerm.toLowerCase(),
			);
		const selectedLabels = selectedValues.map(
			(item) => optionByValue.get(item.toLowerCase())?.label ?? item,
		);
		const buttonText = selectedLabels[0] || placeholder || "";

		const borderColor = "border-input";
		const focusBorderColor = "focus-within:border-ring";
		const focusRing = "focus-within:ring-[3px] focus-within:ring-ring/50";
		const hoverBorder = "";
		const controlBg = "bg-transparent dark:bg-input/30";
		const menuBg = "bg-white dark:bg-surface-dark";
		const hoverBg = "hover:bg-blackAlpha-50 dark:hover:bg-whiteAlpha-100";
		const selectedBg = "bg-primary-50 dark:bg-whiteAlpha-100";
		const tagBg = "bg-primary-50 dark:bg-whiteAlpha-100";
		const tagColor = "text-primary-700 dark:text-primary-200";
		const mutedColor = "text-muted-foreground";
		const invalidBorderColor = "border-red-500! dark:border-red-300!";
		const controlHeight = "min-h-9";
		const disabledState = isDisabled || Boolean(disabled);
		const resolvedBorderColor = isInvalid ? invalidBorderColor : borderColor;

		const emitValue = (nextValue: string | string[]) => {
			onValueChange?.(nextValue);
			emitSelectChange(
				onChange,
				name,
				Array.isArray(nextValue)
					? dedupeValues(nextValue).join(", ")
					: nextValue,
			);
		};
		const emitBlur = () => {
			onBlur?.({
				target: { name, value: selectedValues[0] ?? "" },
				type: "blur",
			});
		};

		const handleSingleOpenChange = (open: boolean) => {
			setSingleOpen(open);
			if (open) return;
			setSearch("");
			emitBlur();
		};

		const updateMultipleValues = (nextValues: string[]) => {
			emitValue(dedupeValues(nextValues));
		};

		const toggleValue = (option: NormalizedOption) => {
			if (option.disabled) return;
			if (mode === "multiple" && interceptOption?.(option.value)) return;
			if (mode === "single") {
				emitValue(option.value);
				emitBlur();
				return;
			}
			if (selectedSet.has(option.value.toLowerCase())) {
				updateMultipleValues(
					selectedValues.filter(
						(item) => item.toLowerCase() !== option.value.toLowerCase(),
					),
				);
			} else {
				updateMultipleValues([...selectedValues, option.value]);
			}
			setCustomInput("");
			setSearch("");
		};

		const removeValue = (option: string) => {
			updateMultipleValues(
				selectedValues.filter(
					(item) => item.toLowerCase() !== option.toLowerCase(),
				),
			);
		};

		const editValue = (item: string) => {
			if (disabledState) return;
			updateMultipleValues(
				selectedValues.filter((value) => value.toLowerCase() !== item.toLowerCase()),
			);
			setCustomInput(item);
			setSearch(item);
			setMultiOpen(true);
			multiContainerRef.current?.querySelector<HTMLInputElement>("input:not([type='hidden'])")?.focus();
		};

		const commitCustomInput = (rawValue = customInput) => {
			if (!allowCustom) return;
			const tokens = splitPanelSelectText(rawValue);
			if (!tokens.length) {
				setCustomInput("");
				return;
			}
			if (mode === "single") {
				emitValue(tokens[0]);
			} else {
				updateMultipleValues([...selectedValues, ...tokens]);
			}
			setCustomInput("");
			setSearch("");
			setMultiOpen(true);
		};

		const handleCustomInputChange = (nextValue: string) => {
			if (/[,;\n]/.test(nextValue)) {
				commitCustomInput(nextValue);
				return;
			}
			setCustomInput(nextValue);
			setSearch(nextValue);
			setMultiOpen(true);
		};

		const handleCustomKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
			if (event.key === "Enter") {
				event.preventDefault();
				const suggestedOption = filteredOptions.find(
					(option) =>
						!option.disabled && !selectedSet.has(option.value.toLowerCase()),
				);
				if (customInput.trim() && suggestedOption) {
					toggleValue(suggestedOption);
				} else {
					commitCustomInput();
				}
				return;
			}
			if (event.key === "Backspace" && !customInput && selectedValues.length) {
				event.preventDefault();
				removeValue(selectedValues[selectedValues.length - 1]);
			}
		};

		const renderOptionRow = (
			key: string,
			content: ReactNode,
			onSelect: () => void,
			opts: {
				disabled?: boolean;
				selected?: boolean;
			} = {},
		) => {
			const selected = Boolean(opts.selected);
			const rowClass = cn("rounded-md text-sm min-h-[30px] px-2 py-1", selected ? selectedBg : "bg-transparent", opts.disabled ? "opacity-55" : "opacity-100", selected ? "hover:bg-primary-50 dark:hover:bg-whiteAlpha-100" : hoverBg);

			if (mode === "single") {
				return (
					<button key={key} type="button" data-option="" disabled={opts.disabled} onClick={() => {
							if (opts.disabled) return;
							onSelect();
							if (closeOnSelect ?? true) handleSingleOpenChange(false);
						}} className={cn(rowClass, "block w-full text-start cursor-pointer")}>
						{content}
					</button>
				);
			}

			return (
				<button key={key} type="button" disabled={opts.disabled} onClick={(event: MouseEvent<HTMLElement>) => {
						event.preventDefault();
						event.stopPropagation();
						if (!opts.disabled) onSelect();
					}} className={cn(rowClass, "w-full block text-start", opts.disabled ? "cursor-not-allowed" : "cursor-pointer")}>
					{content}
				</button>
			);
		};

		const optionList = (
			<>
				{canCreateCustom &&
					renderOptionRow(
						`custom-${customTerm}`,
						<span className="truncate">
							<AppleEmojiText>{`${t("add")} "${customTerm}"`}</AppleEmojiText>
						</span>,
						() => commitCustomInput(customTerm),
					)}
				{filteredOptions.length === 0 && !canCreateCustom ? (
					<div className="px-2 py-2">
						<p className={cn("text-[0.875rem]", mutedColor)}>
							{emptyText ?? t("hostsDialog.noAutocompleteOptions")}
						</p>
					</div>
				) : (
					filteredOptions.map((option) => {
						const selected = selectedSet.has(option.value.toLowerCase());
						return renderOptionRow(
							option.value || option.searchLabel,
							<>
								<div className="flex flex-row items-center w-full justify-between gap-2">
									<div className="flex flex-row items-center min-w-0! gap-2">
										<p title={option.title} className="truncate">
											{renderLabel(option.label)}
										</p>
									</div>
									{selected && mode === "single" && (
										<div className="text-primary-500 shrink-0">
											<Check />
										</div>
									)}
									{selected && mode === "multiple" && (
										<button type="button" aria-label={`${removeLabel} ${option.title}`} onClick={(event: MouseEvent<HTMLButtonElement>) => {
												event.preventDefault();
												event.stopPropagation();
												removeValue(option.value);
											}} className="rounded-full text-red-500 p-0.5 hover:bg-red-50 dark:hover:bg-whiteAlpha-100">
											<X />
										</button>
									)}
								</div>
							</>,
							() => toggleValue(option),
							{ disabled: option.disabled, selected },
						);
					})
				)}
			</>
		);

		if (mode === "multiple") {
			return (
				// biome-ignore lint/a11y/noStaticElementInteractions: closes the menu when focus leaves the control; the inputs keep focus
				<div ref={multiContainerRef} onBlur={(event) => {
						if (
							!event.currentTarget.contains(event.relatedTarget as Node | null)
						) {
							commitCustomInput();
							setMultiOpen(false);
							emitBlur();
						}
					}} {...boxProps} className={cn("relative", className)}>
					<input
						ref={ref}
						type="hidden"
						id={id}
						name={name}
						value={selectedValues.join(", ")}
						readOnly
					/>
					<Popover open={multiOpen && !disabledState} onOpenChange={(open) => {
							if (open) return;
							commitCustomInput();
							setMultiOpen(false);
							emitBlur();
						}}>
						<PopoverAnchor asChild>
						{/* biome-ignore lint/a11y/noStaticElementInteractions: stops mousedown so the field keeps focus while the menu is used */}
					<div onMouseDown={(event) => {
							if (disabledState) return;
							const target = event.target as HTMLElement | null;
							if (target?.closest("button")) return;
							event.preventDefault();
							const input = event.currentTarget.querySelector("input");
							input?.focus();
							setMultiOpen(true);
						}} className={cn(resolvedBorderColor, controlBg, focusBorderColor, focusRing, "border rounded-md px-1.5 py-1 [transition:border-color_0.15s_ease,_box-shadow_0.15s_ease,_background_0.15s_ease]", controlHeight, rightElement ? "pe-10" : "pe-2", disabledState ? "cursor-not-allowed" : "cursor-text", disabledState ? "opacity-60" : "opacity-100")}>
						<div className="flex flex-wrap gap-1.5 items-center">
							{selectedValues.map((item) => (
								<div key={item}>
									{allowCustom && !disabledState ? (
										<Badge asChild className={cn("min-h-[22px] rounded-full cursor-pointer", tagBg, tagColor)}>
											<button type="button" onClick={() => editValue(item)}>
												{renderLabel(optionByValue.get(item.toLowerCase())?.label ?? item)}
											</button>
										</Badge>
									) : (
										<Badge className={cn("min-h-[22px] rounded-full", tagBg, tagColor)}>
											{renderLabel(optionByValue.get(item.toLowerCase())?.label ?? item)}
										</Badge>
									)}
								</div>
							))}
							<div className="flex-1 min-w-[140px]!">
								<Input placeholder={selectedValues.length ? t("hostsDialog.addAnotherValue") : placeholder} value={customInput} autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} data-lpignore="true" data-1p-ignore="true" data-form-type="other" onFocus={() => setMultiOpen(true)} onChange={(event) =>
										handleCustomInputChange(event.target.value)
									} onKeyDown={handleCustomKeyDown} disabled={disabledState} className="h-[24px] text-[0.875rem] bg-transparent! border-0! rounded-[0px]! [outline:0]! shadow-none! min-h-[24px]! px-0! py-0! focus:shadow-none! focus-visible:shadow-none!" />
							</div>
						</div>
						{rightElement && (
							<div className="absolute top-[7px] z-[1] end-[8px]">
								{rightElement}
							</div>
						)}
					</div>
					</PopoverAnchor>
						<PopoverContent align="start" onOpenAutoFocus={(event) => event.preventDefault()} onInteractOutside={(event) => {
								if (multiContainerRef.current?.contains(event.target as Node)) event.preventDefault();
							}} onMouseDown={(event) => event.preventDefault()} className={cn("w-[var(--radix-popper-anchor-width)] max-h-[240px] overflow-y-auto p-1 rounded-md border shadow-xl z-[16050] [scrollbar-width:none] [ms-overflow-style:none] [&::-webkit-scrollbar]:hidden", borderColor, menuBg)}>
							{optionList}
						</PopoverContent>
						</Popover>
				</div>
			);
		}

		const handleSingleListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
			if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
			const items = Array.from(
				event.currentTarget.querySelectorAll<HTMLButtonElement>(
					"button[data-option]:not(:disabled)",
				),
			);
			if (!items.length) return;
			event.preventDefault();
			const index = items.indexOf(document.activeElement as HTMLButtonElement);
			const next =
				event.key === "ArrowDown"
					? (index + 1) % items.length
					: index <= 0
						? items.length - 1
						: index - 1;
			items[next]?.focus();
		};

		const singleMenuList = (
			<PopoverContent
				align={isRTL ? "end" : "start"}
				onOpenAutoFocus={(event) => {
					event.preventDefault(); (event.target as HTMLElement).querySelector<HTMLElement>(searchable && !coarsePointer ? "input" : "[data-option]:not(:disabled)")?.focus();
				}}
				onKeyDown={handleSingleListKeyDown}
				className={cn(borderColor, "[scrollbar-width:none] [ms-overflow-style:none] [&::-webkit-scrollbar]:hidden", cn("w-[max(var(--radix-popover-trigger-width),240px)] max-w-[min(420px,_calc(100vw_-_24px))] max-h-[260px] overflow-y-auto p-1 rounded-md shadow-xl z-[16050]", menuBg))}
			>
				{searchable && (
					<SearchInput id={`${inputId}-search`} name={`${inputId}-search-${mode}`} size="sm" containerProps={{ className: "mb-1" }} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={searchPlaceholder ?? t("search")} autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} role="combobox" aria-autocomplete="list" data-lpignore="true" data-1p-ignore="true" data-form-type="other" inputMode="text" list={`${inputId}-empty-list`} autoFocus={!coarsePointer} matchOptions={searchMatch} onMatchOptionsChange={setSearchMatch} className="h-[30px] text-[0.875rem] bg-transparent" />
				)}
				<datalist id={`${inputId}-empty-list`} />
				{optionList}
			</PopoverContent>
		);

		return (
			<div {...boxProps} className={cn("relative", className)}>
				<input
					ref={ref}
					type="hidden"
					id={id}
					name={name}
					value={selectedValues[0] ?? ""}
					readOnly
				/>
				<Popover open={singleOpen && !disabledState} onOpenChange={handleSingleOpenChange}>
					<PopoverTrigger asChild><Button size={size === "md" ? "default" : size} disabled={disabledState} variant="outline" className={cn(controlBg, resolvedBorderColor, focusBorderColor, focusRing, hoverBorder, "w-full rounded-md justify-between text-start [&>span]:w-full [&>span]:justify-between", rightElement ? "pe-16" : "", controlHeight, selectedValues.length ? "font-medium" : "font-normal")}>
						<span className={cn("truncate", selectedValues.length ? "" : (mutedColor))}>
							{renderLabel(buttonText)}
						</span>
					{<ChevronDown />}</Button></PopoverTrigger>
					{portalled ? <><div className="pointer-events-auto contents">{singleMenuList}</div></> : singleMenuList}
				</Popover>
				{rightElement && (
					<div className="absolute top-[50%] [transform:translateY(-50%)] z-[1] end-[36px]">
						{rightElement}
					</div>
				)}
			</div>
		);
	},
);
