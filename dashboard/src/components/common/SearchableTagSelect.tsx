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
	Text,
	useColorModeValue,
	VStack,
} from "@chakra-ui/react";
import {
	CheckIcon,
	ChevronDownIcon,
	XMarkIcon,
} from "@heroicons/react/24/outline";
import { type FC, type MouseEvent, useMemo, useState } from "react";

const Check = chakra(CheckIcon, { baseStyle: { w: 4, h: 4 } });
const ChevronDown = chakra(ChevronDownIcon, { baseStyle: { w: 4, h: 4 } });
const X = chakra(XMarkIcon, { baseStyle: { w: 3.5, h: 3.5 } });

export type SearchableTagSelectOption =
	| string
	| {
			disabled?: boolean;
			label?: string;
			title?: string;
			value: string;
	  };

type NormalizedSearchableTagSelectOption = {
	disabled: boolean;
	label: string;
	title: string;
	value: string;
};

type SearchableTagSelectProps = {
	emptyText?: string;
	isDisabled?: boolean;
	mode?: "single" | "multiple";
	onChange: (value: string | string[]) => void;
	options: SearchableTagSelectOption[];
	placeholder: string;
	searchPlaceholder?: string;
	size?: "sm" | "md";
	value: string | string[];
	width?: string;
};

const normalizeOption = (
	option: SearchableTagSelectOption,
): NormalizedSearchableTagSelectOption => {
	if (typeof option === "string") {
		return {
			disabled: false,
			label: option,
			title: option,
			value: option,
		};
	}
	return {
		disabled: Boolean(option.disabled),
		label: option.label || option.title || option.value,
		title: option.title || option.label || option.value,
		value: option.value,
	};
};

export const SearchableTagSelect: FC<SearchableTagSelectProps> = ({
	emptyText = "No options found",
	isDisabled = false,
	mode = "single",
	onChange,
	options,
	placeholder,
	searchPlaceholder = "Search",
	size = "sm",
	value,
	width,
}) => {
	const [search, setSearch] = useState("");
	const normalizedOptions = useMemo(
		() => options.map(normalizeOption),
		[options],
	);
	const selectedValues = useMemo(() => {
		if (Array.isArray(value)) {
			return new Set(value.filter(Boolean));
		}
		if (value) {
			return new Set([value]);
		}
		return normalizedOptions.some((option) => option.value === "")
			? new Set([""])
			: new Set<string>();
	}, [normalizedOptions, value]);
	const filteredOptions = useMemo(() => {
		const term = search.trim().toLowerCase();
		if (!term) return normalizedOptions;
		return normalizedOptions.filter(
			(option) =>
				option.label.toLowerCase().includes(term) ||
				option.value.toLowerCase().includes(term),
		);
	}, [normalizedOptions, search]);

	const labelByValue = useMemo(
		() =>
			Object.fromEntries(
				normalizedOptions.map((option) => [option.value, option.label]),
			),
		[normalizedOptions],
	);

	const borderColor = useColorModeValue("blackAlpha.200", "whiteAlpha.200");
	const selectedBg = useColorModeValue("primary.50", "whiteAlpha.100");
	const hoverBg = useColorModeValue("blackAlpha.50", "whiteAlpha.100");
	const mutedColor = useColorModeValue("gray.500", "gray.400");

	const selectedList = Array.from(selectedValues);
	const selectedLabels = selectedList.map((item) => labelByValue[item] || item);
	const buttonText =
		mode === "multiple"
			? selectedLabels.length
				? selectedLabels.join(", ")
				: placeholder
			: selectedLabels[0] || placeholder;

	const updateValue = (option: NormalizedSearchableTagSelectOption) => {
		if (option.disabled) return;
		if (mode === "single") {
			onChange(option.value);
			return;
		}
		const next = new Set(selectedValues);
		if (next.has(option.value)) next.delete(option.value);
		else next.add(option.value);
		onChange(Array.from(next));
	};

	const removeValue = (option: string) => {
		if (mode === "single") {
			onChange("");
			return;
		}
		onChange(Array.from(selectedValues).filter((item) => item !== option));
	};

	return (
		<Menu
			closeOnSelect={mode === "single"}
			isOpen={isDisabled ? false : undefined}
			isLazy
			placement="bottom-start"
			strategy="fixed"
			onClose={() => setSearch("")}
		>
			<MenuButton
				as={Button}
				rightIcon={<ChevronDown />}
				size={size}
				isDisabled={isDisabled}
				variant="outline"
				w={width ?? "full"}
				justifyContent="space-between"
				textAlign="start"
				fontWeight={selectedList.length ? "medium" : "normal"}
			>
				<Text
					as="span"
					noOfLines={1}
					color={selectedList.length ? undefined : mutedColor}
				>
					{buttonText}
				</Text>
			</MenuButton>
			<Portal>
				<MenuList
					minW="220px"
					maxW="min(340px, calc(100vw - 24px))"
					maxH="240px"
					overflowY="auto"
					p={1}
					borderColor={borderColor}
					zIndex={16050}
					sx={{
						scrollbarWidth: "none",
						msOverflowStyle: "none",
						"&::-webkit-scrollbar": {
							display: "none",
						},
					}}
				>
					<Input
						size="sm"
						h="30px"
						mb={1}
						fontSize="sm"
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						placeholder={searchPlaceholder}
						autoFocus
					/>
					<VStack align="stretch" spacing={0.5}>
						{filteredOptions.length === 0 ? (
							<Box px={2} py={2}>
								<Text fontSize="sm" color={mutedColor}>
									{emptyText}
								</Text>
							</Box>
						) : (
							filteredOptions.map((option) => {
								const selected = selectedValues.has(option.value);
								return (
									<MenuItem
										key={option.value || option.label}
										borderRadius="md"
										bg={selected ? selectedBg : "transparent"}
										isDisabled={option.disabled}
										fontSize="sm"
										minH="30px"
										opacity={option.disabled ? 0.55 : 1}
										px={2}
										py={1}
										_hover={{ bg: selected ? selectedBg : hoverBg }}
										onClick={() => updateValue(option)}
									>
										<HStack w="full" justifyContent="space-between" spacing={2}>
											<HStack minW={0} spacing={2}>
												<Box
													w="16px"
													color={selected ? "primary.500" : "transparent"}
												>
													<Check />
												</Box>
												<Text noOfLines={1} title={option.title}>
													{option.label}
												</Text>
											</HStack>
											{selected && (
												<Box
													as="span"
													role="button"
													aria-label={`Remove ${option.label}`}
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
									</MenuItem>
								);
							})
						)}
					</VStack>
				</MenuList>
			</Portal>
		</Menu>
	);
};
