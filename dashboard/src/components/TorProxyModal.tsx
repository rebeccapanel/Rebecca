import { Field, FieldDescription, FieldError, FieldLabel } from "components/ui/field";
import { Input } from "components/ui/input";
import { Button } from "components/ui/button";
import { Badge } from "components/ui/badge";
import { Switch } from "components/ui/switch";
import { Dialog } from "components/ui/dialog";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { ArrowDown, ArrowUp } from "lucide-react";

import { cn } from "lib/cn";
import { type FC, useEffect, useMemo } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { countrySelectOptions } from "../utils/countries";
import { MultiValueAutocomplete } from "./common/MultiValueAutocomplete";
import {
	XrayDialogSection,
	XrayFieldGrid,
	XrayModalBody,
	XrayModalContent,
	XrayModalFooter,
	XrayModalHeader,
} from "./xray/XrayDialog";

export type TorProxyFormValues = {
	locations: string;
	startPort: number;
	portStep: number;
	direction: "up" | "down";
	tagPrefix: string;
	strict: boolean;
};

type TorProxyModalProps = {
	open: boolean;
	loading: boolean;
	isMasterTarget: boolean;
	existingTags: string[];
	onClose: () => void;
	onSubmit: (values: TorProxyFormValues) => Promise<void>;
};

const defaults: TorProxyFormValues = {
	locations: "de",
	startPort: 9050,
	portStep: 1,
	direction: "up",
	tagPrefix: "tor",
	strict: true,
};

const parseLocations = (value: string) =>
	value
		.split(/[\s,;]+/)
		.map((item) => item.trim().toLowerCase())
		.filter(Boolean);

export const TorProxyModal: FC<TorProxyModalProps> = ({
	open: isOpen,
	loading: isLoading,
	isMasterTarget,
	existingTags,
	onClose,
	onSubmit,
}) => {
	const { t, i18n } = useTranslation();
	const borderColor = "border-gray-200! dark:border-whiteAlpha-200!";
	const form = useForm<TorProxyFormValues>({ defaultValues: defaults });
	const locationsValue = useWatch({ control: form.control, name: "locations" });
	const startPort = useWatch({ control: form.control, name: "startPort" });
	const portStep = useWatch({ control: form.control, name: "portStep" });
	const direction = useWatch({ control: form.control, name: "direction" });
	const tagPrefix = useWatch({ control: form.control, name: "tagPrefix" });
	const preview = useMemo(() => {
		const locations = parseLocations(locationsValue || "").slice(0, 20);
		const basePort = Number(startPort);
		const step = Number(portStep);
		return locations.map((country, index) => ({
			country,
			port:
				direction === "down"
					? basePort - index * step
					: basePort + index * step,
			tag: `${(tagPrefix || "tor").trim()}-${country}`,
		}));
	}, [direction, locationsValue, portStep, startPort, tagPrefix]);
	const duplicateTag = preview.find((item) => existingTags.includes(item.tag))?.tag;
	const locationOptions = useMemo(
		() => countrySelectOptions(i18n.language),
		[i18n.language],
	);

	useEffect(() => {
		if (isOpen) form.reset(defaults);
	}, [form, isOpen]);

	return (
		<Dialog open={isOpen} onOpenChange={(open) => { if (!open) (onClose)(); }}>
			
			<XrayModalContent>
				<form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-1 flex-col min-h-0 overflow-hidden">
					<XrayModalHeader
						subtitle={
							isMasterTarget
								? t("pages.xray.tor.descriptionAll")
								: t("pages.xray.tor.description")
						}
					>
						{t("pages.xray.tor.title")}
					</XrayModalHeader>
					
					<XrayModalBody className="flex-1 min-h-0 overflow-y-auto">
						<div className="flex flex-col gap-3 items-stretch">
							<XrayDialogSection>
								<Field data-invalid={Boolean(form.formState.errors.locations)}>
									<FieldLabel>
										{t("pages.xray.tor.locations")}
									</FieldLabel>
									<Controller
										name="locations"
										control={form.control}
										rules={{
											validate: (value) => {
												const locations = parseLocations(value);
												if (locations.length === 0) {
													return t("pages.xray.tor.locationsRequired");
												}
												if (locations.length > 20) {
													return t("pages.xray.tor.locationsLimit");
												}
												if (locations.some((item) => !/^[a-z]{2}$/i.test(item))) {
													return t("pages.xray.tor.countryInvalid");
												}
												if (new Set(locations).size !== locations.length) {
													return t("pages.xray.tor.locationsDuplicate");
												}
												return true;
											},
										}}
										render={({ field }) => (
											<MultiValueAutocomplete
												allowCustom={false}
												options={locationOptions}
												placeholder={t("pages.xray.tor.locationsPlaceholder")}
												value={field.value}
												onChange={field.onChange}
											/>
										)}
									/>
									<FieldDescription>
										{t("pages.xray.tor.locationsHint")}
									</FieldDescription>
									<FieldError>
										{form.formState.errors.locations?.message}
									</FieldError>
								</Field>

								<XrayFieldGrid className="mt-3">
									<Field data-invalid={Boolean(form.formState.errors.startPort)}>
										<FieldLabel>
											{t("pages.xray.tor.startPort")}
										</FieldLabel>
										<Input type="number" inputMode="numeric" {...form.register("startPort", {
												valueAsNumber: true,
												required: t("pages.xray.tor.portRequired"),
												validate: (value) => {
													const count = Math.max(
														1,
														parseLocations(form.getValues("locations")).length,
													);
													const step = Number(form.getValues("portStep")) || 1;
													const end =
														form.getValues("direction") === "down"
															? value - (count - 1) * step
															: value + (count - 1) * step;
													return (
														(value >= 1024 && value <= 65535 && end >= 1024 && end <= 65535) ||
														t("pages.xray.tor.generatedPortInvalid")
													);
												},
											})} />
										<FieldError>
											{form.formState.errors.startPort?.message}
										</FieldError>
									</Field>
									<Field>
										<FieldLabel>
											{t("pages.xray.tor.direction")}
										</FieldLabel>
										<Controller
											name="direction"
											control={form.control}
											render={({ field }) => (
												<div className={cn("inline-flex items-center gap-2", "w-full")}>
													<Button type="button" aria-pressed={field.value === "up"} onClick={() => field.onChange("up")} className="flex-1" variant={field.value === "up" ? "default" : "outline"}>{<ArrowUp className="w-[14px]" />}
														{t("pages.xray.tor.directionUp")}
													</Button>
													<Button type="button" aria-pressed={field.value === "down"} onClick={() => field.onChange("down")} className="flex-1" variant={field.value === "down" ? "default" : "outline"}>{<ArrowDown className="w-[14px]" />}
														{t("pages.xray.tor.directionDown")}
													</Button>
												</div>
											)}
										/>
									</Field>
								</XrayFieldGrid>

								<XrayFieldGrid className="mt-3">
									<Field data-invalid={Boolean(form.formState.errors.portStep)}>
										<FieldLabel>{t("pages.xray.tor.portStep")}</FieldLabel>
										<Input type="number" inputMode="numeric" {...form.register("portStep", {
												valueAsNumber: true,
												min: {
													value: 1,
													message: t("pages.xray.tor.portStepInvalid"),
												},
												max: {
													value: 1000,
													message: t("pages.xray.tor.portStepInvalid"),
												},
											})} />
										<FieldError>
											{form.formState.errors.portStep?.message}
										</FieldError>
									</Field>
									<Field data-invalid={Boolean(
											form.formState.errors.tagPrefix || duplicateTag,
										)}>
										<FieldLabel>{t("pages.xray.tor.tagPrefix")}</FieldLabel>
										<Input {...form.register("tagPrefix", {
												required: t("pages.xray.tor.tagRequired"),
												validate: (value) =>
													Boolean(value.trim()) ||
													t("pages.xray.tor.tagRequired"),
											})} />
										<FieldDescription>
											{t("pages.xray.tor.tagPrefixHint")}
										</FieldDescription>
										<FieldError>
											{form.formState.errors.tagPrefix?.message ||
												(duplicateTag
													? t("pages.xray.outbound.tagExistsNamed", { tag: duplicateTag })
													: undefined)}
										</FieldError>
									</Field>
								</XrayFieldGrid>

								<div className={cn("mt-4 pt-3 border-t", borderColor)}>
									<div className="flex flex-row items-center gap-2 justify-between mb-2">
										<p className="text-[0.75rem] font-semibold">
											{t("pages.xray.tor.preview")}
										</p>
										<Badge>{preview.length}</Badge>
									</div>
									<div className="flex flex-col items-stretch gap-0 max-h-[152px] overflow-y-auto">
										{preview.map((item) => (
											<div key={item.country} className={cn("flex flex-row items-center gap-2 justify-between min-h-[34px] border-b text-[0.75rem]", borderColor)}>
												<p className="font-medium">{item.tag}</p>
												<p className="text-panel-text-muted font-mono">
													127.0.0.1:{item.port}
												</p>
											</div>
										))}
									</div>
								</div>
							</XrayDialogSection>
							<Field className="rb-dialog-switch-row">
								<FieldLabel>
									{t("pages.xray.tor.strict")}
								</FieldLabel>
								<Controller
									name="strict"
									control={form.control}
									render={({ field }) => (
										<Switch checked={field.value} onCheckedChange={(checked: boolean) => field.onChange(checked)} />
									)}
								/>
							</Field>
						</div>
					</XrayModalBody>
					<XrayModalFooter className="justify-end">
						<Button onClick={onClose} disabled={isLoading} variant="outline">
							{t("cancel")}
						</Button>
						<Button type="submit" disabled={Boolean(duplicateTag)} loading={isLoading}>
							{t("pages.xray.tor.start")}
						</Button>
					</XrayModalFooter>
				</form>
			</XrayModalContent>
		</Dialog>
	);
};
