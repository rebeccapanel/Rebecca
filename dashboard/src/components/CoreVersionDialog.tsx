import { Button } from "components/ui/button";
import { Field, FieldLabel } from "components/ui/field";
import { Spinner } from "components/ui/spinner";
import { Input } from "components/ui/input";
import { Checkbox } from "components/ui/checkbox";
import { Alert, AlertDescription } from "components/ui/alert";
import { CircleAlert, TriangleAlert } from "lucide-react";


import { PanelSelect as Select } from "components/common/PanelSelect";
import { AppDialog } from "components/dialogs/AppDialog";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { fetch as apiFetch } from "service/http";

type CoreVersionDialogProps = {
	open: boolean;
	title: string;
	description?: string;
	currentVersion?: string | null;
	allowPersist?: boolean;
	isSubmitting?: boolean;
	onSubmit: (payload: { version: string; persist?: boolean }) => Promise<void>;
	onClose: () => void;
};

const RELEASE_LIMIT = 10;

export const CoreVersionDialog = ({
	open: isOpen,
	title,
	description,
	currentVersion,
	allowPersist = false,
	isSubmitting,
	onSubmit,
	onClose,
}: CoreVersionDialogProps) => {
	const { t } = useTranslation();
	const [version, setVersion] = useState("");
	const [persist, setPersist] = useState(false);
	const [submissionError, setSubmissionError] = useState<string | null>(null);

	const releasesQuery = useQuery({ queryKey: ["core-xray-releases"], queryFn: () =>
			apiFetch<{ tags: string[] }>("/core/xray/releases", {
				query: { limit: RELEASE_LIMIT },
			}), enabled: isOpen,
			staleTime: 5 * 60 * 1000, });

	useEffect(() => {
		if (isOpen) {
			setVersion(currentVersion || "");
			setPersist(Boolean(allowPersist));
			setSubmissionError(null);
		}
	}, [isOpen, currentVersion, allowPersist]);

	const releaseOptions = useMemo(
		() => releasesQuery.data?.tags ?? [],
		[releasesQuery.data],
	);

	const handleSelectChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
		setVersion(event.target.value);
	};

	const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
		setVersion(event.target.value);
	};

	const handleSubmit = async () => {
		if (!version) {
			setSubmissionError(t("validation.required"));
			return;
		}
		try {
			setSubmissionError(null);
			await onSubmit({ version, persist: allowPersist ? persist : undefined });
		} catch (err) {
			if (err instanceof Error) {
				setSubmissionError(err.message);
			} else {
				setSubmissionError(t("core.generalErrorMessage"));
			}
		}
	};

	const isLoadingReleases = releasesQuery.isLoading;

	return (
		<AppDialog
			open={isOpen}
			onClose={onClose}
			size="lg"
			title={title}
			footer={
				<>
					<Button onClick={onClose} variant="ghost" className="me-3">
						{t("cancel")}
					</Button>
					<Button onClick={handleSubmit} loading={isSubmitting}>
						{t("nodes.coreVersionDialog.confirmUpdate")}
					</Button>
				</>
			}
		>
					<div className="flex flex-col gap-4">
						{description && (
							<p className="text-[0.875rem] text-gray-600 dark:text-gray-300">
								{description}
							</p>
						)}
						<Field>
							<FieldLabel>
								{t("nodes.coreVersionDialog.latestReleases")}
							</FieldLabel>
							<Select
								placeholder={
									isLoadingReleases
										? t("nodes.coreVersionDialog.loadingReleases")
										: t("nodes.coreVersionDialog.selectVersionPlaceholder")
								}
								value={
									version && releaseOptions.includes(version) ? version : ""
								}
								onChange={handleSelectChange}
								disabled={isLoadingReleases || releaseOptions.length === 0}
								size="sm"
							>
								{releaseOptions.map((item) => (
									<option key={item} value={item}>
										{item}
									</option>
								))}
							</Select>
							{isLoadingReleases && (
								<div className="flex flex-row items-center gap-2 mt-2">
									<Spinner />
									<p className="text-[0.75rem] text-gray-500 dark:text-gray-400">
										{t("nodes.coreVersionDialog.fetchingFromGithub")}
									</p>
								</div>
							)}
							{releasesQuery.isError && (
								<p className="text-[0.75rem] text-red-500 mt-1">
									{t("nodes.coreVersionDialog.failedToLoadReleases")}
								</p>
							)}
						</Field>
						<Field>
							<FieldLabel>
								{t("nodes.coreVersionDialog.customVersionLabel")}
							</FieldLabel>
							<Input value={version} onChange={handleInputChange} />
							<p className="text-[0.75rem] text-gray-500 dark:text-gray-400 mt-1">
								{t("nodes.coreVersionDialog.customVersionHelper")}
							</p>
						</Field>
						{allowPersist && (
							<label htmlFor="core-version-persist" className="flex cursor-pointer items-center gap-2 text-sm"><Checkbox id="core-version-persist" checked={persist} onCheckedChange={(checked: boolean) => setPersist(checked)} /><span>{t("nodes.coreVersionDialog.persistExecutable")}</span></label>
						)}
						{submissionError && (
							<Alert variant="destructive" className="rounded-md text-[0.875rem]">
								<CircleAlert className="size-4" aria-hidden="true" />
								<AlertDescription>{submissionError}</AlertDescription>
							</Alert>
						)}
					</div>
		</AppDialog>
	);
};

export default CoreVersionDialog;
