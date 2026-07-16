import {
	Box,
	Button,
	chakra,
	HStack,
	Input,
	Menu,
	MenuButton,
	MenuItem,
	MenuList,
	Portal,
	Tag,
	TagCloseButton,
	TagLabel,
	Text,
	useColorModeValue,
	Wrap,
	WrapItem,
	type BoxProps,
} from "@chakra-ui/react";
import {
	CheckIcon,
	ChevronDownIcon,
	XMarkIcon,
} from "@heroicons/react/24/outline";
import {
	forwardRef,
	Fragment,
	isValidElement,
	type ChangeEvent,
	type KeyboardEvent,
	type MouseEvent,
	type ReactNode,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";

const Check = chakra(CheckIcon, { baseStyle: { w: 4, h: 4 } });
const ChevronDown = chakra(ChevronDownIcon, { baseStyle: { w: 4, h: 4 } });
const X = chakra(XMarkIcon, { baseStyle: { w: 3.5, h: 3.5 } });

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
	BoxProps,
	"children" | "defaultValue" | "onChange" | "size" | "value"
> & {
	allowCustom?: boolean;
	children?: ReactNode;
	closeOnSelect?: boolean;
	defaultValue?: string;
	disabled?: boolean;
	emptyText?: string;
	id?: string;
	isDisabled?: boolean;
	isInvalid?: boolean;
	mode?: "single" | "multiple";
	name?: string;
	onBlur?: (event: { target: { name?: string; value?: string }; type?: string }) => void;
	onChange?: (event: ChangeEvent<HTMLSelectElement>) => void;
	onValueChange?: (value: string | string[]) => void;
	options?: PanelSelectOption[];
	placeholder?: string;
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
	if (node === null || node === undefined || typeof node === "boolean") return "";
	if (typeof node === "string" || typeof node === "number") return String(node);
	if (Array.isArray(node)) return node.map(optionText).join("");
	if (isValidElement<{ children?: ReactNode }>(node)) {
		return optionText(node.props.children);
	}
	return "";
};

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
			isDisabled = false,
			isInvalid = false,
			mode = "single",
			name,
			onBlur,
			onChange,
			onValueChange,
			options = [],
			placeholder,
			rightElement,
			searchPlaceholder,
			showSearch = true,
			size = "sm",
			value,
			w,
			width,
			maxW,
			minW,
			...boxProps
		},
		ref,
	) => {
		const { t, i18n } = useTranslation();
		const direction = i18n.dir(i18n.language);
		const isRTL = direction === "rtl";
		const removeLabel = t("remove", "Remove");
		const inputId = useId();
		const [search, setSearch] = useState("");
		const [customInput, setCustomInput] = useState("");
		const [multiOpen, setMultiOpen] = useState(false);
		const multiContainerRef = useRef<HTMLDivElement | null>(null);
		const [multiMenuRect, setMultiMenuRect] = useState<{
			left: number;
			top?: number;
			bottom?: number;
			width: number;
		} | null>(null);
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
					...selectedValues.map((item) =>
						optionByValue.get(item.toLowerCase()) ?? normalizeOption(item),
					),
				]),
			[normalizedOptions, optionByValue, selectedValues],
		);
		const filteredOptions = useMemo(() => {
			const term = search.trim().toLowerCase();
			if (!term) return mergedOptions;
			return mergedOptions.filter((option) =>
				`${option.searchLabel} ${option.value}`.toLowerCase().includes(term),
			);
		}, [mergedOptions, search]);
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

		const borderColor = useColorModeValue("blackAlpha.200", "whiteAlpha.200");
		const focusBorderColor = useColorModeValue("primary.500", "primary.300");
		const controlBg = useColorModeValue("white", "whiteAlpha.50");
		const menuBg = useColorModeValue("white", "surface.dark");
		const hoverBg = useColorModeValue("blackAlpha.50", "whiteAlpha.100");
		const selectedBg = useColorModeValue("primary.50", "whiteAlpha.100");
		const tagBg = useColorModeValue("primary.50", "whiteAlpha.100");
		const tagColor = useColorModeValue("primary.700", "primary.200");
		const mutedColor = useColorModeValue("gray.500", "gray.400");
		const invalidBorderColor = useColorModeValue("red.500", "red.300");
		const controlHeight = size === "md" ? "40px" : "36px";
		const disabledState = isDisabled || Boolean(disabled);
		const resolvedBorderColor = isInvalid ? invalidBorderColor : borderColor;

		useEffect(() => {
			if (!multiOpen) return;
			const updateMultiMenuRect = () => {
				const rect = multiContainerRef.current?.getBoundingClientRect();
				if (!rect) return;
				const menuHeight = 240;
				const gap = 6;
				const spaceBelow = window.innerHeight - rect.bottom;
				const opensUp = spaceBelow < menuHeight + gap && rect.top > spaceBelow;
				setMultiMenuRect({
					left: rect.left,
					width: rect.width,
					...(opensUp
						? { bottom: window.innerHeight - rect.top + gap }
						: { top: rect.bottom + gap }),
				});
			};
			updateMultiMenuRect();
			window.addEventListener("resize", updateMultiMenuRect);
			window.addEventListener("scroll", updateMultiMenuRect, true);
			return () => {
				window.removeEventListener("resize", updateMultiMenuRect);
				window.removeEventListener("scroll", updateMultiMenuRect, true);
			};
		}, [multiOpen]);

		const emitValue = (nextValue: string | string[]) => {
			onValueChange?.(nextValue);
			emitSelectChange(
				onChange,
				name,
				Array.isArray(nextValue) ? dedupeValues(nextValue).join(", ") : nextValue,
			);
		};
		const emitBlur = () => {
			onBlur?.({
				target: { name, value: selectedValues[0] ?? "" },
				type: "blur",
			});
		};

		const updateMultipleValues = (nextValues: string[]) => {
			emitValue(dedupeValues(nextValues));
		};

		const toggleValue = (option: NormalizedOption) => {
			if (option.disabled) return;
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
				return;
			}
			updateMultipleValues([...selectedValues, option.value]);
		};

		const removeValue = (option: string) => {
			updateMultipleValues(
				selectedValues.filter(
					(item) => item.toLowerCase() !== option.toLowerCase(),
				),
			);
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
				commitCustomInput();
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
			const rowProps = {
				borderRadius: "md",
				bg: selected ? selectedBg : "transparent",
				fontSize: "sm",
				minH: "30px",
				opacity: opts.disabled ? 0.55 : 1,
				px: 2,
				py: 1,
				_hover: { bg: selected ? selectedBg : hoverBg },
			};

			if (mode === "single") {
				return (
					<MenuItem
						key={key}
						{...rowProps}
						isDisabled={opts.disabled}
						onClick={() => {
							if (!opts.disabled) onSelect();
						}}
					>
						{content}
					</MenuItem>
				);
			}

			return (
				<Box
					key={key}
					as="button"
					type="button"
					w="full"
					display="block"
					textAlign="start"
					cursor={opts.disabled ? "not-allowed" : "pointer"}
					disabled={opts.disabled}
					{...rowProps}
					onClick={(event: MouseEvent<HTMLElement>) => {
						event.preventDefault();
						event.stopPropagation();
						if (!opts.disabled) onSelect();
					}}
				>
					{content}
				</Box>
			);
		};

		const optionList = (
			<>
				{canCreateCustom &&
					renderOptionRow(
						`custom-${customTerm}`,
						<Text as="span" noOfLines={1}>
							{t("hostsDialog.addCustomValue", "Add")} "{customTerm}"
						</Text>,
						() => commitCustomInput(customTerm),
					)}
				{filteredOptions.length === 0 && !canCreateCustom ? (
					<Box px={2} py={2}>
						<Text fontSize="sm" color={mutedColor}>
							{emptyText ?? t("hostsDialog.noAutocompleteOptions", "No options")}
						</Text>
					</Box>
				) : (
					filteredOptions.map((option) => {
						const selected = selectedSet.has(option.value.toLowerCase());
						return renderOptionRow(
							option.value || option.searchLabel,
							<>
									<HStack w="full" justifyContent="space-between" spacing={2}>
										<HStack minW={0} spacing={2}>
											<Text noOfLines={1} title={option.title}>
												{option.label}
											</Text>
										</HStack>
										{selected && mode === "single" && (
											<Box color="primary.500" flexShrink={0}>
												<Check />
											</Box>
										)}
										{selected && mode === "multiple" && (
										<Box
											as="span"
											role="button"
											aria-label={`${removeLabel} ${option.title}`}
											borderRadius="full"
											color="red.500"
											p={0.5}
											onClick={(event: MouseEvent<HTMLSpanElement>) => {
												event.preventDefault();
												event.stopPropagation();
												removeValue(option.value);
											}}
											_hover={{ bg: "red.50" }}
											_dark={{ _hover: { bg: "whiteAlpha.100" } }}
										>
											<X />
										</Box>
									)}
								</HStack>
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
				<Box
					ref={multiContainerRef}
					position="relative"
					w={w ?? width}
					maxW={maxW}
					minW={minW}
					onBlur={(event) => {
						if (
							!event.currentTarget.contains(event.relatedTarget as Node | null)
						) {
							commitCustomInput();
							setMultiOpen(false);
							emitBlur();
						}
					}}
					{...boxProps}
				>
					<input
						ref={ref}
						type="hidden"
						id={id}
						name={name}
						value={selectedValues.join(", ")}
						readOnly
					/>
					<Box
						borderWidth="1px"
						borderRadius="md"
						borderColor={resolvedBorderColor}
						bg={controlBg}
						minH={controlHeight}
						px={1.5}
						py={1}
						pl={isRTL ? (rightElement ? 10 : 2) : undefined}
						pr={isRTL ? undefined : rightElement ? 10 : 2}
						cursor={disabledState ? "not-allowed" : "text"}
						opacity={disabledState ? 0.6 : 1}
						transition="border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease"
						_focusWithin={{
							borderColor: focusBorderColor,
							boxShadow: `0 0 0 1px ${focusBorderColor}`,
						}}
						onMouseDown={(event) => {
							if (disabledState) return;
							const target = event.target as HTMLElement | null;
							if (target?.closest("button")) return;
							event.preventDefault();
							const input = event.currentTarget.querySelector("input");
							input?.focus();
							setMultiOpen(true);
						}}
					>
						<Wrap spacing={1.5} align="center">
							{selectedValues.map((item) => (
								<WrapItem key={item}>
									<Tag
										size="sm"
										minH="22px"
										borderRadius="full"
										bg={tagBg}
										color={tagColor}
									>
										<TagLabel maxW="150px" noOfLines={1} fontSize="xs">
											{optionByValue.get(item.toLowerCase())?.label ?? item}
										</TagLabel>
										<TagCloseButton
											aria-label={`${removeLabel} ${item}`}
											onMouseDown={(event) => event.preventDefault()}
											onClick={() => removeValue(item)}
										/>
									</Tag>
								</WrapItem>
							))}
							<WrapItem flex="1" minW="140px">
								<Input
									variant="unstyled"
									size="sm"
									h="24px"
									fontSize="sm"
									value={customInput}
									placeholder={
										selectedValues.length
											? t("hostsDialog.addAnotherValue", "Add another value")
											: placeholder
									}
									autoComplete="off"
									autoCorrect="off"
									autoCapitalize="none"
									spellCheck={false}
									bg="transparent !important"
									border="0 !important"
									borderRadius="0 !important"
									outline="0 !important"
									boxShadow="none !important"
									minH="24px !important"
									px="0 !important"
									py="0 !important"
									_focus={{ boxShadow: "none !important" }}
									_focusVisible={{ boxShadow: "none !important" }}
									data-lpignore="true"
									data-1p-ignore="true"
									data-form-type="other"
									onFocus={() => setMultiOpen(true)}
									onChange={(event) => handleCustomInputChange(event.target.value)}
									onKeyDown={handleCustomKeyDown}
									isDisabled={disabledState}
								/>
							</WrapItem>
						</Wrap>
						{rightElement && (
							<Box
								position="absolute"
								top="7px"
								left={isRTL ? "8px" : undefined}
								right={isRTL ? undefined : "8px"}
								zIndex={1}
							>
								{rightElement}
							</Box>
						)}
					</Box>
					{multiOpen && !disabledState && multiMenuRect && (
						<Portal>
							<Box
								dir={direction}
								position="fixed"
								left={`${multiMenuRect.left}px`}
								top={
									multiMenuRect.top === undefined
										? undefined
										: `${multiMenuRect.top}px`
								}
								bottom={
									multiMenuRect.bottom === undefined
										? undefined
										: `${multiMenuRect.bottom}px`
								}
								w={`${multiMenuRect.width}px`}
								zIndex={16060}
								borderWidth="1px"
								borderColor={borderColor}
								borderRadius="md"
								bg={menuBg}
								boxShadow="xl"
								maxH="240px"
								overflowY="auto"
								p={1}
								onMouseDown={(event) => event.preventDefault()}
								sx={{
									scrollbarWidth: "none",
									msOverflowStyle: "none",
									"&::-webkit-scrollbar": { display: "none" },
								}}
							>
								{optionList}
							</Box>
						</Portal>
					)}
				</Box>
			);
		}

		return (
			<Box w={w ?? width} maxW={maxW} minW={minW} {...boxProps}>
				<input
					ref={ref}
					type="hidden"
					id={id}
					name={name}
					value={selectedValues[0] ?? ""}
					readOnly
				/>
				<Menu
					closeOnSelect={closeOnSelect ?? true}
					isOpen={disabledState ? false : undefined}
					isLazy
					matchWidth
					placement={isRTL ? "bottom-end" : "bottom-start"}
					strategy="fixed"
					onClose={() => {
						setSearch("");
						emitBlur();
					}}
				>
					<MenuButton
						as={Button}
						rightIcon={<ChevronDown />}
						size={size}
						isDisabled={disabledState}
						variant="outline"
						w="full"
						minH={controlHeight}
						bg={controlBg}
						borderColor={resolvedBorderColor}
						borderRadius="md"
						justifyContent="space-between"
						textAlign="start"
						fontWeight={selectedValues.length ? "medium" : "normal"}
						_hover={{ borderColor: focusBorderColor, bg: controlBg }}
						_active={{ bg: controlBg }}
						_focusVisible={{
							borderColor: focusBorderColor,
							boxShadow: `0 0 0 1px ${focusBorderColor}`,
						}}
					>
						<Text
							as="span"
							noOfLines={1}
							color={selectedValues.length ? undefined : mutedColor}
						>
							{buttonText}
						</Text>
					</MenuButton>
					<Portal>
						<MenuList
							dir={direction}
							minW="100%"
							maxW="min(420px, calc(100vw - 24px))"
							maxH="260px"
							overflowY="auto"
							p={1}
							bg={menuBg}
							borderColor={borderColor}
							borderRadius="md"
							boxShadow="xl"
							zIndex={16050}
							sx={{
								scrollbarWidth: "none",
								msOverflowStyle: "none",
								"&::-webkit-scrollbar": { display: "none" },
							}}
						>
							{showSearch && (
								<Input
									id={`${inputId}-search`}
									name={`${inputId}-search-${mode}`}
									size="sm"
									h="30px"
									mb={1}
									fontSize="sm"
									bg="transparent"
									value={search}
									onChange={(event) => setSearch(event.target.value)}
									placeholder={searchPlaceholder ?? t("search", "Search")}
									autoComplete="off"
									autoCorrect="off"
									autoCapitalize="none"
									spellCheck={false}
									role="combobox"
									aria-autocomplete="list"
									data-lpignore="true"
									data-1p-ignore="true"
									data-form-type="other"
									inputMode="text"
									list={`${inputId}-empty-list`}
									autoFocus
								/>
							)}
							<datalist id={`${inputId}-empty-list`} />
							{optionList}
						</MenuList>
					</Portal>
				</Menu>
			</Box>
		);
	},
);
