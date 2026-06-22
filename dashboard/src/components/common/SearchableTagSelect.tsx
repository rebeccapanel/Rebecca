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
import { CheckIcon, ChevronDownIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { type FC, type MouseEvent, useMemo, useState } from "react";

const Check = chakra(CheckIcon, { baseStyle: { w: 4, h: 4 } });
const ChevronDown = chakra(ChevronDownIcon, { baseStyle: { w: 4, h: 4 } });
const X = chakra(XMarkIcon, { baseStyle: { w: 3.5, h: 3.5 } });

type SearchableTagSelectProps = {
	emptyText?: string;
	mode?: "single" | "multiple";
	onChange: (value: string | string[]) => void;
	options: string[];
	placeholder: string;
	searchPlaceholder?: string;
	size?: "sm" | "md";
	value: string | string[];
};

export const SearchableTagSelect: FC<SearchableTagSelectProps> = ({
	emptyText = "No options found",
	mode = "single",
	onChange,
	options,
	placeholder,
	searchPlaceholder = "Search",
	size = "sm",
	value,
}) => {
	const [search, setSearch] = useState("");
	const selectedValues = useMemo(
		() =>
			new Set(
				Array.isArray(value)
					? value.filter(Boolean)
					: value
						? [value]
						: [],
			),
		[value],
	);
	const filteredOptions = useMemo(() => {
		const term = search.trim().toLowerCase();
		if (!term) return options;
		return options.filter((option) => option.toLowerCase().includes(term));
	}, [options, search]);

	const borderColor = useColorModeValue("blackAlpha.200", "whiteAlpha.200");
	const selectedBg = useColorModeValue("primary.50", "whiteAlpha.100");
	const hoverBg = useColorModeValue("blackAlpha.50", "whiteAlpha.100");
	const mutedColor = useColorModeValue("gray.500", "gray.400");

	const selectedList = Array.from(selectedValues);
	const buttonText =
		mode === "multiple"
			? selectedList.length
				? selectedList.join(", ")
				: placeholder
			: selectedList[0] || placeholder;

	const updateValue = (option: string) => {
		if (mode === "single") {
			onChange(selectedValues.has(option) ? "" : option);
			return;
		}
		const next = new Set(selectedValues);
		if (next.has(option)) next.delete(option);
		else next.add(option);
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
			closeOnSelect={false}
			isLazy
			placement="bottom-start"
			strategy="fixed"
			onClose={() => setSearch("")}
		>
			<MenuButton
				as={Button}
				rightIcon={<ChevronDown />}
				size={size}
				variant="outline"
				w="full"
				justifyContent="space-between"
				textAlign="start"
				fontWeight={selectedList.length ? "medium" : "normal"}
			>
				<Text as="span" noOfLines={1} color={selectedList.length ? undefined : mutedColor}>
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
								const selected = selectedValues.has(option);
								return (
									<MenuItem
										key={option}
										borderRadius="md"
										bg={selected ? selectedBg : "transparent"}
										fontSize="sm"
										minH="30px"
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
												<Text noOfLines={1}>{option}</Text>
											</HStack>
											{selected && (
												<Box
													as="span"
													role="button"
													aria-label={`Remove ${option}`}
													borderRadius="full"
													color="red.500"
													p={0.5}
													onClick={(event: MouseEvent<HTMLSpanElement>) => {
														event.preventDefault();
														event.stopPropagation();
														removeValue(option);
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
