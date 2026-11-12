import { PanelSelect as Select } from "components/common/PanelSelect";
import { Field, FieldDescription, FieldLabel } from "components/ui/field";
import type { FC } from "react";
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

export type BuildVersionSelectProps = {
	catalog?: BuildCatalog;
	value: string;
	onChange: (version: string) => void;
	portalled?: boolean;
	disabled?: boolean;
};

export const BuildVersionSelect: FC<BuildVersionSelectProps> = ({
	catalog,
	value,
	onChange,
	portalled = false,
	disabled = false,
}) => {
	const { t } = useTranslation();
	const builds = [...(catalog?.stable ?? []), ...(catalog?.dev ?? [])];
	if (builds.length === 0) return null;

	return (
		<Field className="flex flex-col gap-1.5">
			<FieldLabel className="text-[12px] font-semibold text-panel-text-secondary">
				{t("dashboard.maintenance.buildVersion")}
			</FieldLabel>
			<Select
				size="sm"
				portalled={portalled}
				disabled={disabled}
				value={value}
				onChange={(event) => onChange(event.target.value)}
			>
				<option value="">{t("dashboard.maintenance.buildVersionAutomatic")}</option>
				{builds.map((build) => (
					<option key={`${build.channel}-${build.version}`} value={build.version}>
						{build.channel === "dev" && build.commit
							? `${build.version} · ${build.commit.slice(0, 7)}`
							: build.version}
					</option>
				))}
			</Select>
			{catalog?.floor && (
				<FieldDescription className="text-[11px] leading-relaxed text-panel-text-muted">
					{t("dashboard.maintenance.buildVersionFloor", {
						version: catalog.floor,
					})}
				</FieldDescription>
			)}
		</Field>
	);
};

export default BuildVersionSelect;
