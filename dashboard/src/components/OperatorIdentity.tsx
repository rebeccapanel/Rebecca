import { Tooltip, TooltipContent, TooltipTrigger } from "components/ui/tooltip";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";

import { cn } from "lib/cn";
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
		bg: "bg-blue-100 dark:bg-blue-800", color: "text-blue-700 dark:text-blue-100",
	},
	{
		bg: "bg-green-100 dark:bg-green-800", color: "text-green-700 dark:text-green-100",
	},
	{
		bg: "bg-orange-100 dark:bg-orange-800", color: "text-orange-700 dark:text-orange-100",
	},
	{
		bg: "bg-cyan-100 dark:bg-cyan-800", color: "text-cyan-700 dark:text-cyan-100",
	},
	{
		bg: "bg-purple-100 dark:bg-purple-800", color: "text-purple-700 dark:text-purple-100",
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
		shortName || owner || t("usersTable.operatorUnknown");
	const brand = findOperatorBrand(shortName, owner);
	const markSize = compact ? "24px" : "32px";
	const palette = fallbackPalette(label);
	const identity = (
		<div className={cn("flex flex-row gap-2 min-w-0! items-center", compact ? "gap-1.5" : "gap-2")}>
			<div style={{ width: markSize, height: markSize, backgroundColor: brand?.background }} className={cn("shrink-0 flex items-center justify-center border border-panel-border! rounded-md overflow-hidden", !brand && palette.bg, !brand && palette.color)}>
				{brand ? (
					<img src={brand.logo} alt="" className={cn("object-contain", compact ? "size-[18px]" : "size-[24px]")} />
				) : (
					<p className={cn("font-extrabold leading-[1]", compact ? "text-[0.625rem]" : "text-[0.75rem]")}>
						{operatorInitials(label)}
					</p>
				)}
			</div>
			<div className="flex flex-col gap-0 items-start min-w-0! text-start">
				<p className={cn("font-semibold truncate max-w-full", compact ? "text-[0.75rem]" : "text-[0.875rem]")}>
					{label}
				</p>
				{!compact && owner && owner !== shortName ? (
					<p className="text-[0.75rem] text-panel-text-muted truncate max-w-full">
						{owner}
					</p>
				) : null}
			</div>
		</div>
	);

	return compact && owner && owner !== shortName ? (
		<Tooltip>
<TooltipTrigger asChild><span className="inline-flex max-w-full">{identity}</span></TooltipTrigger>
<TooltipContent>{owner}</TooltipContent>
</Tooltip>
	) : (
		identity
	);
};
