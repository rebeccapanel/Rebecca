import {
	Box,
	HStack,
	Image,
	Text,
	Tooltip,
	useColorModeValue,
	VStack,
} from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import IrancellLogo from "../assets/operators/irancell-svgrepo-com.svg";
import MCILogo from "../assets/operators/mci-svgrepo-com.svg";
import RightelLogo from "../assets/operators/rightel-svgrepo-com.svg";
import TCILogo from "../assets/operators/tci-svgrepo-com.svg";

type OperatorBrand = {
	keywords: string[];
	logo: string;
	background: string;
};

const operatorBrands: OperatorBrand[] = [
	{
		keywords: ["irancell", "iran cell", "mtn"],
		logo: IrancellLogo,
		background: "#ffd600",
	},
	{
		keywords: ["hamrah aval", "mci", "mobile communication company"],
		logo: MCILogo,
		background: "#ffffff",
	},
	{ keywords: ["rightel"], logo: RightelLogo, background: "#ffffff" },
	{
		keywords: ["mokhaberat", "tci", "iran telecommunication company"],
		logo: TCILogo,
		background: "#ffffff",
	},
];

const fallbackPalettes = [
	{
		lightBg: "blue.100",
		lightColor: "blue.700",
		darkBg: "blue.800",
		darkColor: "blue.100",
	},
	{
		lightBg: "green.100",
		lightColor: "green.700",
		darkBg: "green.800",
		darkColor: "green.100",
	},
	{
		lightBg: "orange.100",
		lightColor: "orange.700",
		darkBg: "orange.800",
		darkColor: "orange.100",
	},
	{
		lightBg: "cyan.100",
		lightColor: "cyan.700",
		darkBg: "cyan.800",
		darkColor: "cyan.100",
	},
	{
		lightBg: "purple.100",
		lightColor: "purple.700",
		darkBg: "purple.800",
		darkColor: "purple.100",
	},
] as const;

const findOperatorBrand = (shortName?: string, owner?: string) => {
	const identity = `${shortName || ""} ${owner || ""}`.toLowerCase();
	return operatorBrands.find((brand) =>
		brand.keywords.some((keyword) => identity.includes(keyword)),
	);
};

const operatorInitials = (label: string) => {
	const parts = label.trim().split(/\s+/).filter(Boolean);
	if (parts.length > 1) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
	return label.slice(0, 2).toUpperCase();
};

const fallbackPalette = (label: string) => {
	const index = Array.from(label).reduce(
		(total, character) => total + character.charCodeAt(0),
		0,
	);
	return fallbackPalettes[index % fallbackPalettes.length];
};

export const OperatorIdentity = ({
	shortName,
	owner,
	compact = false,
}: {
	shortName?: string;
	owner?: string;
	compact?: boolean;
}) => {
	const { t } = useTranslation();
	const label =
		shortName || owner || t("usersTable.operatorUnknown", "Unknown operator");
	const brand = findOperatorBrand(shortName, owner);
	const markSize = compact ? "24px" : "32px";
	const palette = fallbackPalette(label);
	const fallbackBg = useColorModeValue(palette.lightBg, palette.darkBg);
	const fallbackColor = useColorModeValue(
		palette.lightColor,
		palette.darkColor,
	);
	const identity = (
		<HStack spacing={compact ? 1.5 : 2} minW={0} align="center">
			<Box
				w={markSize}
				h={markSize}
				flexShrink={0}
				display="flex"
				alignItems="center"
				justifyContent="center"
				borderWidth="1px"
				borderColor="panel.border"
				borderRadius="md"
				bg={brand?.background || fallbackBg}
				color={brand ? undefined : fallbackColor}
				overflow="hidden"
			>
				{brand ? (
					<Image
						src={brand.logo}
						alt=""
						boxSize={compact ? "18px" : "24px"}
						objectFit="contain"
					/>
				) : (
					<Text
						fontSize={compact ? "2xs" : "xs"}
						fontWeight="800"
						lineHeight="1"
					>
						{operatorInitials(label)}
					</Text>
				)}
			</Box>
			<VStack spacing={0} align="start" minW={0} textAlign="start">
				<Text
					fontSize={compact ? "xs" : "sm"}
					fontWeight="semibold"
					noOfLines={1}
					maxW="full"
				>
					{label}
				</Text>
				{!compact && owner && owner !== shortName ? (
					<Text fontSize="xs" color="panel.textMuted" noOfLines={1} maxW="full">
						{owner}
					</Text>
				) : null}
			</VStack>
		</HStack>
	);

	return compact && owner && owner !== shortName ? (
		<Tooltip label={owner} hasArrow>
			{identity}
		</Tooltip>
	) : (
		identity
	);
};
