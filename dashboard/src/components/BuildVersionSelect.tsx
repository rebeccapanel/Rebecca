import { FormControl, FormHelperText, FormLabel } from "@chakra-ui/react";
import { PanelSelect as Select } from "components/common/PanelSelect";
import { useTranslation } from "react-i18next";

export type BuildVersion = {
	version: string;
	channel: "stable" | "dev";
	commit?: string;
};

export type BuildCatalog = {
	floor: string;
	stable: BuildVersion[];
	dev: BuildVersion[];
};

type BuildVersionSelectProps = {
	catalog?: BuildCatalog;
	value: string;
	onChange: (version: string) => void;
	portalled?: boolean;
};

export const BuildVersionSelect = ({
	catalog,
	value,
	onChange,
	portalled = false,
}: BuildVersionSelectProps) => {
	const { t } = useTranslation();
	const builds = [...(catalog?.stable ?? []), ...(catalog?.dev ?? [])];
	if (builds.length === 0) return null;

	return (
		<FormControl>
			<FormLabel fontSize="12px" fontWeight="600" color="panel.textSecondary">
				{t("dashboard.maintenance.buildVersion")}
			</FormLabel>
			<Select
				size="sm"
				portalled={portalled}
				borderRadius="10px"
				value={value}
				onChange={(event) => onChange(event.target.value)}
			>
				<option value="">
					{t("dashboard.maintenance.buildVersionAutomatic")}
				</option>
				{builds.map((build) => (
					<option
						key={`${build.channel}-${build.version}`}
						value={build.version}
					>
						{build.channel === "dev" && build.commit
							? `${build.version} · ${build.commit.slice(0, 7)}`
							: build.version}
					</option>
				))}
			</Select>
			<FormHelperText fontSize="11px" color="panel.textMuted">
				{t("dashboard.maintenance.buildVersionFloor", {
					version: catalog?.floor,
				})}
			</FormHelperText>
		</FormControl>
	);
};

export default BuildVersionSelect;
