import {
	chakra,
	HStack,
	IconButton,
	Menu,
	MenuButton,
	MenuItem,
	MenuList,
	Text,
	useColorModeValue,
} from "@chakra-ui/react";
import { CheckIcon, LanguageIcon } from "@heroicons/react/24/outline";
import type { FC, ReactNode } from "react";
import ReactCountryFlag from "react-country-flag";
import { useTranslation } from "react-i18next";
import { ReactComponent as ImperialIranFlag } from "../assets/imperial-iran-flag.svg";

type HeaderProps = {
	actions?: ReactNode;
};

const LangIcon = chakra(LanguageIcon, {
	baseStyle: {
		w: 4,
		h: 4,
	},
});

const CheckIconChakra = chakra(CheckIcon, {
	baseStyle: {
		w: 4,
		h: 4,
	},
});

export const Language: FC<HeaderProps> = ({ actions }) => {
	const { i18n } = useTranslation();
	const menuBg = useColorModeValue("surface.light", "surface.dark");
	const hoverBg = useColorModeValue("blackAlpha.50", "whiteAlpha.100");
	const borderColor = useColorModeValue("blackAlpha.200", "whiteAlpha.200");
	const textColor = useColorModeValue("gray.800", "gray.100");

	const changeLanguage = (lang: string) => {
		i18n.changeLanguage(lang);
	};

	const items = [
		{ code: "en", label: "English", flag: "US" },
		{ code: "fa", label: "پارسی", flag: "IR" },
		{ code: "zh-cn", label: "中文", flag: "CN" },
		{ code: "ru", label: "Русский", flag: "RU" },
	];

	return (
		<Menu placement="bottom-end">
			<MenuButton
				as={IconButton}
				size="sm"
				variant="outline"
				icon={<LangIcon />}
				position="relative"
			/>
			<MenuList
				minW={{ base: "70vw", sm: "160px" }}
				zIndex={9999}
				bg={menuBg}
				borderColor={borderColor}
				color={textColor}
			>
				{items.map(({ code, label, flag }) => (
					<MenuItem
						key={code}
						fontSize="sm"
						onClick={() => changeLanguage(code)}
						_hover={{ bg: hoverBg }}
					>
						<HStack justify="space-between" w="full">
							<HStack spacing={2}>
								{code === "fa" ? (
									<ImperialIranFlag style={{ width: "16px", height: "12px" }} />
								) : (
									<ReactCountryFlag
										countryCode={flag}
										svg
										style={{ width: "16px", height: "12px" }}
									/>
								)}
								<Text>{label}</Text>
							</HStack>
							{i18n.language === code && <CheckIconChakra />}
						</HStack>
					</MenuItem>
				))}
			</MenuList>
		</Menu>
	);
};
