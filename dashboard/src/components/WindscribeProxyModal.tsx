import { Alert } from "components/ui/alert";
import { Field, FieldDescription, FieldError, FieldLabel } from "components/ui/field";
import { Input } from "components/ui/input";
import { Button } from "components/ui/button";
import { Dialog } from "components/ui/dialog";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";


import { type FC, useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { fetch as apiFetch } from "service/http";
import { countryCodeFromEnglishName, countryFlag } from "../utils/countries";
import {
	MultiValueAutocomplete,
	splitMultiValueText,
	type MultiValueAutocompleteOption,
} from "./common/MultiValueAutocomplete";
import {
	XrayDialogSection,
	XrayFieldGrid,
	XrayModalBody,
	XrayModalContent,
	XrayModalFooter,
	XrayModalHeader,
} from "./xray/XrayDialog";

export type WindscribeProxyFormValues = {
	username: string;
	password: string;
	location: string;
	port: number;
	tag: string;
};

type WindscribeLocation = {
	name: string;
	available: boolean;
};

type Props = {
	open: boolean;
	loading: boolean;
	isMasterTarget: boolean;
	targetID: string;
	existingTags: string[];
	onClose: () => void;
	onSubmit: (values: WindscribeProxyFormValues) => Promise<void>;
};

const defaults: WindscribeProxyFormValues = {
	username: "",
	password: "",
	location: "",
	port: 18888,
	tag: "windscribe",
};

const errorDetail = (error: any, fallback: string) => {
	const detail =
		error?.response?._data?.detail ??
		error?.data?.detail ??
		error?.message ??
		fallback;
	return typeof detail === "string" ? detail : JSON.stringify(detail);
};

const outboundTag = (prefix: string, location: string) => {
	const normalizedPrefix = prefix.trim();
	const normalizedLocation = location.trim().toLowerCase();
	if (!normalizedLocation) return normalizedPrefix;
	const suffix = `-${normalizedLocation}`;
	return normalizedPrefix.toLowerCase().endsWith(suffix)
		? `${normalizedPrefix.slice(0, -suffix.length)}${suffix}`
		: `${normalizedPrefix}${suffix}`;
};

export const WindscribeProxyModal: FC<Props> = ({
	open: isOpen,
	loading: isLoading,
	isMasterTarget,
	targetID,
	existingTags,
	onClose,
	onSubmit,
}) => {
	const { t } = useTranslation();
	const form = useForm<WindscribeProxyFormValues>({ defaultValues: defaults });
	const [isLoadingLocations, setIsLoadingLocations] = useState(false);
	const [locationOptions, setLocationOptions] = useState<
		MultiValueAutocompleteOption[]
	>([]);
	const [loadError, setLoadError] = useState("");
	const duplicateTag = existingTags.includes(
		outboundTag(form.watch("tag"), form.watch("location")),
	);

	useEffect(() => {
		if (!isOpen) return;
		form.reset(defaults);
		setLocationOptions([]);
		setLoadError("");
	}, [form, isOpen]);

	const loadLocations = async () => {
		if (!(await form.trigger(["username", "password"]))) return;
		setIsLoadingLocations(true);
		setLoadError("");
		try {
			const response = await apiFetch<{
				success: boolean;
				obj?: { locations?: WindscribeLocation[] };
				msg?: string;
			}>("/panel/xray/windscribe/locations", {
				method: "POST",
				body: {
					target_id: targetID,
					username: form.getValues("username").trim(),
					password: form.getValues("password"),
				},
			});
			if (!response?.success) {
				throw new Error(
					response?.msg || t("pages.xray.windscribe.locationsFailed"),
				);
			}
			const options = (response.obj?.locations ?? []).flatMap((location) => {
				const code = countryCodeFromEnglishName(location.name);
				if (!code) return [];
				return [
					{
						disabled: !location.available,
						label: `${countryFlag(code)} ${code} - ${location.name}${location.available ? "" : " (Pro)"}`,
						searchLabel: `${code} ${location.name}`,
						title: location.name,
						value: code,
					},
				];
			});
			if (options.length === 0) {
				throw new Error(t("pages.xray.windscribe.noLocations"));
			}
			setLocationOptions(options);
			form.setValue("location", "", { shouldValidate: true });
		} catch (error: any) {
			setLocationOptions([]);
			setLoadError(
				errorDetail(
					error,
					t("pages.xray.windscribe.locationsFailed"),
				),
			);
		} finally {
			setIsLoadingLocations(false);
		}
	};

	return (
		<Dialog open={isOpen} onOpenChange={(open) => { if (!open) (onClose)(); }}>
			
			<XrayModalContent>
				<form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-1 flex-col min-h-0 overflow-hidden">
					<XrayModalHeader subtitle={t("pages.xray.windscribe.description")}>
						{t("pages.xray.windscribe.title")}
					</XrayModalHeader>
					
					<XrayModalBody className="flex-1 min-h-0 overflow-y-auto">
						<div className="flex flex-col gap-3 items-stretch">
							{isMasterTarget && (
								<Alert className="rounded-xs text-[0.875rem]">
									<TriangleAlert className="size-4" aria-hidden="true" />
									{t("pages.xray.windscribe.nodeRequired")}
								</Alert>
							)}
							<XrayDialogSection
								title={t("pages.xray.windscribe.account")}
							>
								<XrayFieldGrid>
									<Field data-invalid={Boolean(form.formState.errors.username)}>
										<FieldLabel>{t("username")}</FieldLabel>
										<Input autoComplete="username" {...form.register("username", {
												required: t("pages.xray.windscribe.usernameRequired"),
												minLength: {
													value: 3,
													message: t("pages.xray.windscribe.usernameRequired"),
												},
												maxLength: 128,
											})} />
										<FieldError>
											{form.formState.errors.username?.message}
										</FieldError>
									</Field>
									<Field data-invalid={Boolean(form.formState.errors.password)}>
										<FieldLabel>{t("password")}</FieldLabel>
										<Input type="password" autoComplete="current-password" {...form.register("password", {
												required: t("pages.xray.windscribe.passwordRequired"),
												minLength: {
													value: 8,
													message: t("pages.xray.windscribe.passwordRequired"),
												},
												maxLength: 256,
											})} />
										<FieldError>
											{form.formState.errors.password?.message}
										</FieldError>
									</Field>
								</XrayFieldGrid>
								<Button type="button" disabled={isMasterTarget || isLoading} onClick={loadLocations} variant="outline" size="sm" loading={isLoadingLocations} className="mt-3">
									{t("pages.xray.windscribe.loadLocations")}
								</Button>
								{loadError && (
									<Alert variant="destructive" className="mt-3 rounded-xs text-[0.875rem]">
										<CircleAlert className="size-4" aria-hidden="true" />
										{loadError}
									</Alert>
								)}
							</XrayDialogSection>

							<XrayDialogSection
								title={t("pages.xray.windscribe.proxy")}
							>
								<Field data-invalid={Boolean(form.formState.errors.location)}>
									<FieldLabel>
										{t("pages.xray.windscribe.location")}
									</FieldLabel>
									<Controller
										name="location"
										control={form.control}
										rules={{
											validate: (value) =>
												splitMultiValueText(value).length === 1 ||
												t("pages.xray.windscribe.locationRequired"),
										}}
										render={({ field }) => (
											<MultiValueAutocomplete
												allowCustom={false}
												disabled={locationOptions.length === 0}
												maxValues={1}
												options={locationOptions}
												placeholder={t("pages.xray.windscribe.selectLocation")}
												value={field.value}
												onChange={field.onChange}
											/>
										)}
									/>
									<FieldDescription>
										{t("pages.xray.windscribe.singleLocationHint")}
									</FieldDescription>
									<FieldError>
										{form.formState.errors.location?.message}
									</FieldError>
								</Field>
								<XrayFieldGrid className="mt-3">
									<Field data-invalid={Boolean(form.formState.errors.port)}>
										<FieldLabel>
											{t("pages.xray.windscribe.port")}
										</FieldLabel>
										<Input type="number" inputMode="numeric" {...form.register("port", {
												valueAsNumber: true,
												min: {
													value: 1024,
													message: t("pages.xray.windscribe.portInvalid"),
												},
												max: {
													value: 65535,
													message: t("pages.xray.windscribe.portInvalid"),
												},
											})} />
										<FieldError>
											{form.formState.errors.port?.message}
										</FieldError>
									</Field>
									<Field data-invalid={Boolean(form.formState.errors.tag || duplicateTag)}>
										<FieldLabel>
											{t("pages.xray.windscribe.tagPrefix")}
										</FieldLabel>
										<Input {...form.register("tag", {
												required: t("pages.xray.windscribe.tagRequired"),
												pattern: {
													value: /^[a-zA-Z0-9_.-]+$/,
													message: t("pages.xray.windscribe.tagInvalid"),
												},
												validate: (value) =>
													!existingTags.includes(value.trim()) ||
													t("pages.xray.outbound.tagExists"),
											})} />
										<FieldDescription>
											{t("pages.xray.windscribe.tagPrefixHint")}
										</FieldDescription>
										<FieldError>
											{form.formState.errors.tag?.message ||
												(duplicateTag
													? t("pages.xray.outbound.tagExists")
													: undefined)}
										</FieldError>
									</Field>
								</XrayFieldGrid>
							</XrayDialogSection>
						</div>
					</XrayModalBody>
					<XrayModalFooter className="justify-end">
						<Button onClick={onClose} disabled={isLoading || isLoadingLocations} variant="outline">
							{t("cancel")}
						</Button>
						<Button type="submit" disabled={
								isMasterTarget ||
								locationOptions.length === 0 ||
								isLoadingLocations ||
								duplicateTag
							} loading={isLoading}>
							{t("pages.xray.windscribe.start")}
						</Button>
					</XrayModalFooter>
				</form>
			</XrayModalContent>
		</Dialog>
	);
};
