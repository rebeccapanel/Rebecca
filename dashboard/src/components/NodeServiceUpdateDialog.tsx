import { Button } from "components/ui/button";
import { Field, FieldDescription, FieldLabel } from "components/ui/field";
import { Alert, AlertDescription } from "components/ui/alert";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";


import { PanelSelect as Select } from "components/common/PanelSelect";
import { AppDialog } from "components/dialogs/AppDialog";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	BuildVersionSelect,
	type BuildCatalog,
} from "./BuildVersionSelect";

export type NodeServiceUpdateChannel = "current" | "latest" | "dev";

type NodeServiceUpdateDialogProps = {
	open: boolean;
	title: string;
	description?: string;
	currentChannel?: string;
	targetVersion?: string;
	devVersion?: string;
	latestVersion?: string;
	catalog?: BuildCatalog;
	isSubmitting?: boolean;
	onSubmit: (channel: NodeServiceUpdateChannel, version?: string) => Promise<void> | void;
	onClose: () => void;
};

export const NodeServiceUpdateDialog = ({
	open: isOpen,
	title,
	description,
	currentChannel,
	targetVersion,
	devVersion,
	latestVersion,
	catalog,
	isSubmitting = false,
	onSubmit,
	onClose,
}: NodeServiceUpdateDialogProps) => {
	const { t } = useTranslation();
	const [channel, setChannel] = useState<NodeServiceUpdateChannel>("current");
	const [version, setVersion] = useState("");

	useEffect(() => {
		if (isOpen) {
			setChannel("current");
			setVersion("");
		}
	}, [isOpen]);

	const selectedVersion =
		channel === "dev"
			? devVersion
			: channel === "latest"
				? latestVersion
				: targetVersion;
	const currentChannelLabel =
		currentChannel === "dev"
			? t("dashboard.maintenance.updateChannelDev")
			: currentChannel === "latest"
				? t("dashboard.maintenance.updateChannelLatest")
				: currentChannel;

	return (
		<AppDialog
			open={isOpen}
			onClose={onClose}
			size="md"
			title={title}
			footer={
				<>
					<Button onClick={onClose} disabled={isSubmitting} variant="ghost" className="me-3">
						{t("cancel")}
					</Button>
					<Button onClick={() => onSubmit(channel, version || undefined)} loading={isSubmitting}>
						{t("nodes.updateServiceAction")}
					</Button>
				</>
			}
		>
			<div className="flex flex-col gap-4">
				{description && (
					<p className="text-panel-text-muted text-[0.875rem]">
						{description}
					</p>
				)}
				{currentChannel && (
					<p className="text-[0.75rem] text-panel-text-muted">
						{t("nodes.serviceUpdateCurrentChannel", {
							channel: currentChannelLabel,
						})}
					</p>
				)}
				<Field>
					<FieldLabel>{t("dashboard.maintenance.updateChannel")}</FieldLabel>
					<Select
						value={channel}
						onChange={(event) => {
							setChannel(event.target.value as NodeServiceUpdateChannel);
							setVersion("");
						}}
					>
						<option value="current">
							{t("dashboard.maintenance.updateChannelCurrent")}
						</option>
						<option value="latest">
							{t("dashboard.maintenance.updateChannelLatest")}
						</option>
						<option value="dev">
							{t("dashboard.maintenance.updateChannelDev")}
						</option>
					</Select>
					<FieldDescription>
						{selectedVersion
							? t("dashboard.maintenance.updateTargetHint", {
									version: selectedVersion,
								})
							: t("dashboard.maintenance.updateTargetUnknown")}
					</FieldDescription>
					</Field>
					<BuildVersionSelect
						catalog={catalog}
						value={version}
						onChange={(nextVersion) => {
							setVersion(nextVersion);
							const build = [...(catalog?.stable ?? []), ...(catalog?.dev ?? [])].find(
								(item) => item.version === nextVersion,
							);
							if (build) setChannel(build.channel === "dev" ? "dev" : "latest");
						}}
					/>
					{version && version !== targetVersion && (
						<Alert className="rounded-xl text-[0.875rem]">
							<TriangleAlert className="size-4" aria-hidden="true" />
							<AlertDescription>
								{t("dashboard.maintenance.versionSwitchWarning")}
							</AlertDescription>
						</Alert>
					)}
				{channel === "dev" && (
					<Alert className="rounded-xl text-[0.875rem]">
						<TriangleAlert className="size-4" aria-hidden="true" />
						<AlertDescription>
							{t("dashboard.maintenance.devChannelWarning")}
						</AlertDescription>
					</Alert>
				)}
			</div>
		</AppDialog>
	);
};

export default NodeServiceUpdateDialog;
