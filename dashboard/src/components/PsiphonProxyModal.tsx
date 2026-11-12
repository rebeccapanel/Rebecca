import { Alert } from "components/ui/alert";
import { Field, FieldDescription, FieldError, FieldLabel } from "components/ui/field";
import { Textarea } from "components/ui/textarea";
import { Button } from "components/ui/button";
import { Input } from "components/ui/input";
import { Badge } from "components/ui/badge";
import { Dialog } from "components/ui/dialog";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";


import { cn } from "lib/cn";
import { type FC, useEffect, useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { fetch as apiFetch } from "service/http";
import { countrySelectOptions } from "../utils/countries";
import {
	MultiValueAutocomplete,
	splitMultiValueText,
} from "./common/MultiValueAutocomplete";
import {
	XrayDialogSection,
	XrayFieldGrid,
	XrayModalBody,
	XrayModalContent,
	XrayModalFooter,
	XrayModalHeader,
} from "./xray/XrayDialog";

export type PsiphonProxyFormValues = {
	config: string;
	locations: string;
	port: number;
	tag: string;
};

type Props = {
	open: boolean;
	loading: boolean;
	isMasterTarget: boolean;
	targetID: string;
	existingTags: string[];
	onClose: () => void;
	onSubmit: (values: PsiphonProxyFormValues) => Promise<void>;
};

const defaults: PsiphonProxyFormValues = {
	config: "",
	locations: "",
	port: 20888,
	tag: "psiphon",
};

export const PsiphonProxyModal: FC<Props> = ({
	open: isOpen,
	loading: isLoading,
	isMasterTarget,
	targetID,
	existingTags,
	onClose,
	onSubmit,
}) => {
	const { t, i18n } = useTranslation();
	const form = useForm<PsiphonProxyFormValues>({ defaultValues: defaults });
	const borderColor = "border-gray-200! dark:border-whiteAlpha-200!";
	const [isLoadingLocations, setIsLoadingLocations] = useState(false);
	const [availableLocations, setAvailableLocations] = useState<string[]>([]);
	const [loadedConfig, setLoadedConfig] = useState("");
	const [loadError, setLoadError] = useState("");
	const locationOptions = useMemo(
		() => countrySelectOptions(i18n.language, availableLocations),
		[availableLocations, i18n.language],
	);
	const config = form.watch("config").trim();
	const locationsReady =
		availableLocations.length > 0 && loadedConfig === config;
	const locations = splitMultiValueText(form.watch("locations")).map((value) =>
		value.toLowerCase(),
	);
	const tag = form.watch("tag").trim();
	const startPort = Number(form.watch("port"));
	const preview = locations.map((location, index) => ({
		location,
		port: startPort + index,
		tag: `${tag}-${location}`,
	}));
	const duplicateTag = preview.find((item) => existingTags.includes(item.tag))?.tag;

	useEffect(() => {
		if (!isOpen) return;
		form.reset(defaults);
		setAvailableLocations([]);
		setLoadedConfig("");
		setLoadError("");
	}, [form, isOpen]);

	const loadLocations = async () => {
		if (!(await form.trigger("config"))) return;
		setIsLoadingLocations(true);
		setLoadError("");
		const configValue = form.getValues("config").trim();
		try {
			const response = await apiFetch<{
				success: boolean;
				obj?: { locations?: string[] };
				msg?: string;
			}>("/panel/xray/psiphon/locations", {
				method: "POST",
				body: { target_id: targetID, config: configValue },
			});
			if (!response?.success) {
				throw new Error(response?.msg || t("pages.xray.psiphon.locationsFailed"));
			}
			const locations = (response.obj?.locations ?? []).filter((value) =>
				/^[a-z]{2}$/i.test(value),
			);
			if (locations.length === 0) {
				throw new Error(t("pages.xray.psiphon.noLocations"));
			}
			setAvailableLocations(locations.map((value) => value.toLowerCase()));
			setLoadedConfig(configValue);
			form.setValue("locations", "", { shouldValidate: true });
		} catch (error: any) {
			setAvailableLocations([]);
			setLoadedConfig("");
			const detail =
				error?.response?._data?.detail ??
				error?.data?.detail ??
				error?.message ??
				t("pages.xray.psiphon.locationsFailed");
			setLoadError(typeof detail === "string" ? detail : JSON.stringify(detail));
		} finally {
			setIsLoadingLocations(false);
		}
	};

	return (
		<Dialog open={isOpen} onOpenChange={(open) => { if (!open) (onClose)(); }}>
			
			<XrayModalContent>
				<form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-1 flex-col min-h-0 overflow-hidden">
					<XrayModalHeader subtitle={t("pages.xray.psiphon.description")}>
						{t("pages.xray.psiphon.title")}
					</XrayModalHeader>
					
					<XrayModalBody className="flex-1 min-h-0 overflow-y-auto">
						<div className="flex flex-col gap-3 items-stretch">
							{isMasterTarget && (
								<Alert className="rounded-xs text-[0.875rem]">
									<TriangleAlert className="size-4" aria-hidden="true" />
									{t("pages.xray.psiphon.nodeRequired")}
								</Alert>
							)}
							<XrayDialogSection title={t("pages.xray.psiphon.config")}>
								<Field data-invalid={Boolean(form.formState.errors.config)}>
									<FieldLabel>{t("pages.xray.psiphon.config")}</FieldLabel>
									<Textarea spellCheck={false} {...form.register("config", {
											required: t("pages.xray.psiphon.configRequired"),
											maxLength: {
												value: 1 << 20,
												message: t("pages.xray.psiphon.configInvalid"),
											},
											validate: (value) => {
												try {
													const parsed = JSON.parse(value);
													return (
														(parsed && typeof parsed === "object" && !Array.isArray(parsed)) ||
														t("pages.xray.psiphon.configInvalid")
													);
												} catch {
													return t("pages.xray.psiphon.configInvalid");
												}
											},
										})} className="font-mono min-h-[160px]" />
									<FieldDescription>
										{t("pages.xray.psiphon.configHint")}
									</FieldDescription>
									<FieldError>
										{form.formState.errors.config?.message}
									</FieldError>
									<Button type="button" disabled={isMasterTarget || isLoading} onClick={loadLocations} variant="outline" size="sm" loading={isLoadingLocations} className="mt-3">
										{t("pages.xray.psiphon.loadLocations")}
									</Button>
									{loadError && (
										<Alert variant="destructive" className="mt-3 rounded-xs text-[0.875rem]">
											<CircleAlert className="size-4" aria-hidden="true" />
											{loadError}
										</Alert>
									)}
								</Field>
							</XrayDialogSection>
							<XrayDialogSection title={t("pages.xray.psiphon.proxy")}>
								<Field data-invalid={Boolean(form.formState.errors.locations)}>
									<FieldLabel>{t("pages.xray.psiphon.locations")}</FieldLabel>
									<Controller
										name="locations"
										control={form.control}
										rules={{
										validate: (value) => {
											if (!locationsReady) {
												return t("pages.xray.psiphon.locationsRequired");
											}
											const selected = splitMultiValueText(value);
												if (selected.length === 0) {
													return t("pages.xray.psiphon.locationsRequired");
												}
											if (selected.length > 20) {
													return t("pages.xray.psiphon.locationsLimit");
											}
											if (
												selected.some(
													(item) => !availableLocations.includes(item.toLowerCase()),
												)
											) {
												return t("pages.xray.psiphon.locationsRequired");
											}
												return (
													new Set(selected.map((item) => item.toLowerCase())).size ===
														selected.length || t("pages.xray.psiphon.locationsDuplicate")
												);
											},
										}}
										render={({ field }) => (
											<MultiValueAutocomplete
												allowCustom={false}
												disabled={!locationsReady || isLoadingLocations}
												options={locationOptions}
												placeholder={t("pages.xray.psiphon.selectLocations")}
												value={field.value}
												onChange={field.onChange}
											/>
										)}
									/>
									<FieldDescription>
										{t("pages.xray.psiphon.locationsHint")}
									</FieldDescription>
									<FieldError>
										{form.formState.errors.locations?.message}
									</FieldError>
								</Field>
								<XrayFieldGrid className="mt-3">
									<Field data-invalid={Boolean(form.formState.errors.port)}>
										<FieldLabel>{t("pages.xray.psiphon.port")}</FieldLabel>
										<Input type="number" inputMode="numeric" {...form.register("port", {
												valueAsNumber: true,
												validate: (value) =>
													(value >= 1024 && value + Math.max(0, locations.length - 1) <= 65535) ||
													t("pages.xray.psiphon.portInvalid"),
											})} />
										<FieldError>
											{form.formState.errors.port?.message}
										</FieldError>
									</Field>
									<Field data-invalid={Boolean(form.formState.errors.tag || duplicateTag)}>
										<FieldLabel>{t("pages.xray.psiphon.tagPrefix")}</FieldLabel>
										<Input {...form.register("tag", {
												required: t("pages.xray.psiphon.tagRequired"),
												pattern: {
													value: /^[a-zA-Z0-9_.-]+$/,
													message: t("pages.xray.psiphon.tagInvalid"),
												},
											})} />
										<FieldError>
											{form.formState.errors.tag?.message ||
												(duplicateTag
													? t("pages.xray.outbound.tagExistsNamed", {
															tag: duplicateTag,
														})
													: undefined)}
										</FieldError>
									</Field>
								</XrayFieldGrid>
								<div className={cn("mt-4 pt-3 border-t", borderColor)}>
									<div className="flex flex-row items-center gap-2 justify-between mb-2">
										<p className="text-[0.75rem] font-semibold">
											{t("pages.xray.psiphon.preview")}
										</p>
										<Badge>{preview.length}</Badge>
									</div>
									<div className="flex flex-col items-stretch gap-0 max-h-[152px] overflow-y-auto">
										{preview.map((item, index) => (
											<div key={`${item.location}-${index}`} className={cn("flex flex-row items-center gap-2 justify-between min-h-[34px] border-b text-[0.75rem]", borderColor)}>
												<p className="font-medium">{item.tag}</p>
												<p className="text-panel-text-muted font-mono">
													127.0.0.1:{item.port}
												</p>
											</div>
										))}
									</div>
								</div>
							</XrayDialogSection>
						</div>
					</XrayModalBody>
					<XrayModalFooter className="justify-end">
						<Button onClick={onClose} disabled={isLoading || isLoadingLocations} variant="outline">
							{t("cancel")}
						</Button>
						<Button type="submit" disabled={
								isMasterTarget ||
								!locationsReady ||
								isLoadingLocations ||
								Boolean(duplicateTag)
							} loading={isLoading}>
							{t("pages.xray.psiphon.start")}
						</Button>
					</XrayModalFooter>
				</form>
			</XrayModalContent>
		</Dialog>
	);
};
