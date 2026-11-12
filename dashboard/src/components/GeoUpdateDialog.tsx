import { Field, FieldLabel } from "components/ui/field";
import { Input } from "components/ui/input";
import { Button } from "components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "components/ui/tooltip";
import { RadioGroup, RadioGroupItem } from "components/ui/radio-group";
import { Alert, AlertDescription } from "components/ui/alert";
import { Checkbox } from "components/ui/checkbox";
import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import { withClass } from "lib/withClass";
import { RefreshCw, Minus, Plus } from "lucide-react";

import { cn } from "lib/cn";
import { PanelSelect as Select } from "components/common/PanelSelect";
import { AppDialog } from "components/dialogs/AppDialog";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { fetch as apiFetch } from "service/http";

type GeoFile = { id: string; name: string; url: string };

type GeoTemplate = {
	name: string;
	links?: Record<string, string>;
	files?: GeoFile[];
};

type GeoUpdateDialogProps = {
	open: boolean;
	title: string;
	isSubmitting?: boolean;
	showMasterOptions?: boolean;
	defaultTemplateIndexUrl?: string;
	onSubmit: (payload: {
		mode: "template" | "manual";
		templateIndexUrl: string;
		templateName: string;
		files: GeoFile[];
		persistEnv: boolean;
		applyToNodes: boolean;
	}) => Promise<void>;
	onClose: () => void;
};

const DEFAULT_TEMPLATE_INDEX_URL =
	"https://raw.githubusercontent.com/ppouria/geo-templates/main/index.json";

const IconMinus = withClass(Minus, "w-3.5 h-3.5");
const IconPlus = withClass(Plus, "w-3.5 h-3.5");
const IconRefresh = withClass(RefreshCw, "w-4 h-4");

const createGeoFile = (name: string, url: string): GeoFile => ({
	id:
		typeof crypto !== "undefined" && "randomUUID" in crypto
			? crypto.randomUUID()
			: `${name || "geo-file"}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
	name,
	url,
});

export const GeoUpdateDialog = ({
	open: isOpen,
	title,
	isSubmitting,
	showMasterOptions = false,
	defaultTemplateIndexUrl,
	onSubmit,
	onClose,
}: GeoUpdateDialogProps) => {
	const { t } = useTranslation();
	const [mode, setMode] = useState<"template" | "manual">("template");
	const [templateIndexUrl, setTemplateIndexUrl] = useState(
		DEFAULT_TEMPLATE_INDEX_URL,
	);
	const [selectedTemplate, setSelectedTemplate] = useState("");
	const [manualFiles, setManualFiles] = useState<GeoFile[]>([
		createGeoFile("geoip.dat", ""),
		createGeoFile("geosite.dat", ""),
	]);
	const [persistEnv, setPersistEnv] = useState(true);
	const [applyToNodes, setApplyToNodes] = useState(false);
	const [submissionError, setSubmissionError] = useState<string | null>(null);

	useEffect(() => {
		if (isOpen) {
			setMode("template");
			setTemplateIndexUrl(
				defaultTemplateIndexUrl || DEFAULT_TEMPLATE_INDEX_URL,
			);
			setSelectedTemplate("");
			setManualFiles([
				createGeoFile("geoip.dat", ""),
				createGeoFile("geosite.dat", ""),
			]);
			setPersistEnv(true);
			setApplyToNodes(false);
			setSubmissionError(null);
		}
	}, [isOpen, defaultTemplateIndexUrl]);

	const templatesQuery = useQuery({ queryKey: ["geo-templates", templateIndexUrl], queryFn: () =>
			apiFetch<{ templates: GeoTemplate[] }>("/core/geo/templates", {
				query: templateIndexUrl ? { index_url: templateIndexUrl } : undefined,
			}), enabled: isOpen && mode === "template" && Boolean(templateIndexUrl),
			staleTime: 10 * 60 * 1000, });

	const templates = useMemo(
		() => templatesQuery.data?.templates ?? [],
		[templatesQuery.data],
	);

	useEffect(() => {
		if (templates.length > 0) {
			setSelectedTemplate((current) => current || templates[0].name);
		}
	}, [templates]);

	const manualBg = "bg-gray-50 dark:bg-whiteAlpha-50";

	const addManualFile = () => {
		setManualFiles((prev) => [...prev, createGeoFile("", "")]);
	};

	const updateManualFile = (
		index: number,
		key: keyof GeoFile,
		value: string,
	) => {
		setManualFiles((prev) =>
			prev.map((file, idx) =>
				idx === index ? { ...file, [key]: value } : file,
			),
		);
	};

	const removeManualFile = (index: number) => {
		setManualFiles((prev) => prev.filter((_, idx) => idx !== index));
	};

	const handleSubmit = async () => {
		const baseFiles: GeoFile[] =
			mode === "manual"
				? manualFiles.filter((file) => file.name.trim() && file.url.trim())
				: [];

		if (mode === "template") {
			if (!templateIndexUrl.trim()) {
				setSubmissionError(t("nodes.geoDialog.errors.missingTemplateUrl"));
				return;
			}
			if (!selectedTemplate) {
				setSubmissionError(t("nodes.geoDialog.errors.missingTemplateName"));
				return;
			}
		} else {
			if (baseFiles.length === 0) {
				setSubmissionError(t("nodes.geoDialog.errors.missingFiles"));
				return;
			}
			const invalidFile = baseFiles.find(
				(file) => !file.name.trim() || !file.url.trim(),
			);
			if (invalidFile) {
				setSubmissionError(t("nodes.geoDialog.errors.invalidFile"));
				return;
			}
		}

		setSubmissionError(null);
		const resolvedFiles = mode === "manual" ? baseFiles : [];

		try {
			await onSubmit({
				mode,
				templateIndexUrl: templateIndexUrl.trim(),
				templateName: selectedTemplate,
				files: resolvedFiles,
				persistEnv,
				applyToNodes,
			});
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: t("nodes.geoDialog.genericError");
			setSubmissionError(message);
		}
	};

	const renderManualRows = () => (
		<div className={cn("flex flex-col gap-3 p-4 rounded-md", manualBg)}>
			{manualFiles.map((file, index) => (
				<div key={file.id} className="border rounded-md p-3">
					<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
						<Field>
							<FieldLabel className="text-[0.875rem]">
								{t("nodes.geoDialog.fileNameLabel")}
							</FieldLabel>
							<Input value={file.name} onChange={(event) =>
									updateManualFile(index, "name", event.target.value)
								} />
						</Field>
						<Field>
							<FieldLabel className="text-[0.875rem]">
								{t("nodes.geoDialog.fileUrlLabel")}
							</FieldLabel>
							<Input value={file.url} onChange={(event) =>
									updateManualFile(index, "url", event.target.value)
								} />
						</Field>
					</div>
					<div className="flex flex-row items-center gap-2 justify-end mt-3">
						<Tooltip>
<TooltipTrigger asChild>
							<Button aria-label={t("a11y.removeFile")} onClick={() => removeManualFile(index)} disabled={manualFiles.length <= 1} variant="ghost" size="sm" className="size-8 p-0">{<IconMinus />}</Button>
						</TooltipTrigger>
<TooltipContent>{t("remove")}</TooltipContent>
</Tooltip>
					</div>
				</div>
			))}
			<Button onClick={addManualFile} variant="outline" size="sm" className="self-start">{<IconPlus />}
				{t("nodes.geoDialog.addFile")}
			</Button>
		</div>
	);

	return (
		<AppDialog
			open={isOpen}
			onClose={onClose}
			size="xl"
			title={title}
			footer={
				<>
					<Button onClick={onClose} variant="ghost" className="me-3">
						{t("cancel")}
					</Button>
					<Button onClick={handleSubmit} loading={isSubmitting}>
						{t("nodes.geoDialog.confirmUpdate")}
					</Button>
				</>
			}
		>
					<div className="flex flex-col gap-4">
						<Field>
							<FieldLabel className="text-[0.875rem]">
								{t("nodes.geoDialog.modeLabel")}
							</FieldLabel>
							<RadioGroup value={mode} onValueChange={(value) => setMode(value as "template" | "manual")}>
								<div className="flex flex-row items-center gap-4">
									<label htmlFor="geo-mode-template" className="flex cursor-pointer items-center gap-2 text-sm"><RadioGroupItem id="geo-mode-template" value="template" /><span>{t("nodes.geoDialog.modeTemplate")}</span></label>
									<label htmlFor="geo-mode-manual" className="flex cursor-pointer items-center gap-2 text-sm"><RadioGroupItem id="geo-mode-manual" value="manual" /><span>{t("nodes.geoDialog.modeManual")}</span></label>
								</div>
							</RadioGroup>
						</Field>

						{mode === "template" ? (
							<div className="flex flex-col gap-3">
								<Field>
									<FieldLabel className="text-[0.875rem]">
										{t("nodes.geoDialog.templateIndexLabel")}
									</FieldLabel>
									<Input value={templateIndexUrl} onChange={(event) =>
											setTemplateIndexUrl(event.target.value)
										} />
								</Field>
								<Field>
									<FieldLabel className="text-[0.875rem]">
										{t("nodes.geoDialog.templateNameLabel")}
									</FieldLabel>
									<div className="flex flex-row items-center gap-2">
										<Select size="sm" value={selectedTemplate} onChange={(event) =>
												setSelectedTemplate(event.target.value)
											} disabled={templatesQuery.isLoading || !templates.length} placeholder={
												templatesQuery.isLoading
													? t("nodes.geoDialog.loadingTemplates")
													: t("nodes.geoDialog.selectTemplatePlaceholder")
											} className="flex-1">
											{templates.map((template) => (
												<option key={template.name} value={template.name}>
													{template.name}
												</option>
											))}
										</Select>
										<Tooltip>
<TooltipTrigger asChild>
											<Button aria-label={t("a11y.refreshTemplates")} onClick={() => templatesQuery.refetch()} disabled={!templateIndexUrl.trim()} variant="outline" size="sm" loading={templatesQuery.isFetching} className="size-8 p-0">{<IconRefresh />}</Button>
										</TooltipTrigger>
<TooltipContent>{t("nodes.geoDialog.refreshTemplates")}</TooltipContent>
</Tooltip>
									</div>
								</Field>
								{templatesQuery.isError && (
									<Alert variant="destructive" className="rounded-md text-[0.875rem]">
										<CircleAlert className="size-4" aria-hidden="true" />
										<AlertDescription>
											{t("nodes.geoDialog.failedToLoadTemplates")}
										</AlertDescription>
									</Alert>
								)}
							</div>
						) : (
							renderManualRows()
						)}

						{showMasterOptions && (
							<div className="flex flex-col gap-2">
								<label className="flex cursor-pointer items-center gap-2 text-sm"><Checkbox checked={persistEnv} onCheckedChange={(checked: boolean) => setPersistEnv(checked)} /><span>{t("nodes.geoDialog.persistAssets")}</span></label>
								<label className="flex cursor-pointer items-center gap-2 text-sm"><Checkbox checked={applyToNodes} onCheckedChange={(checked: boolean) => setApplyToNodes(checked)} /><span>{t("nodes.geoDialog.applyToNodes")}</span></label>
								<p className="text-[0.75rem] text-gray-500 dark:text-gray-400">
									{t("nodes.geoDialog.applyToNodesHint")}
								</p>
							</div>
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

export default GeoUpdateDialog;
