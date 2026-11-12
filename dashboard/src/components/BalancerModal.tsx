import { Tabs, TabsContent, TabsList, TabsTrigger } from "components/ui/tabs";
import { Field, FieldDescription, FieldError, FieldLabel } from "components/ui/field";
import { Input } from "components/ui/input";
import { Button } from "components/ui/button";
import { Dialog } from "components/ui/dialog";
import { Plus, TriangleAlert, X } from "lucide-react";
import { Checkbox } from "components/ui/checkbox";
import {
	cleanLeastLoadSettings,
	type LeastLoadCost,
	type LeastLoadSettings,
} from "utils/xrayBalancer";


import { type FC, useCallback, useEffect, useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { EmojiShortcodeInput } from "components/common/EmojiShortcodeInput";
import { useTranslation } from "react-i18next";
import { isPlainObject } from "utils/jsonFormatting";
import { JsonEditor } from "./JsonEditor";
import {
	MultiValueAutocomplete,
	splitMultiValueText,
} from "./common/MultiValueAutocomplete";
import type { SearchableTagSelectOption } from "./common/SearchableTagSelect";
import { SearchableTagSelect } from "./common/SearchableTagSelect";
import { OutboundTestButton } from "./xray/OutboundTestButton";
import { PropagationTargets } from "./xray/PropagationTargets";
import {
	XrayDialogSection,
	XrayModalBody,
	XrayModalContent,
	XrayModalFooter,
	XrayModalHeader,
} from "./xray/XrayDialog";

export type BalancerFormValues = {
	tag: string;
	strategy: string;
	selector: string[];
	fallbackTag: string;
	strategySettings?: LeastLoadSettings;
};

interface BalancerModalProps {
	open: boolean;
	onClose: () => void;
	mode: "create" | "edit";
	initialBalancer?: BalancerFormValues | null;
	outboundTags: string[];
	outboundOptions?: SearchableTagSelectOption[];
	excludedOutboundTags?: string[];
	existingTags: string[];
	onTestOutbound?: (tag: string) => void;
	outboundTestingByTag?: Record<string, boolean>;
	sourceTarget: string;
	propagationBase: Record<string, unknown> | null;
	onSubmit: (values: BalancerFormValues, targetIds: string[]) => void;
}

const DEFAULT_BALANCER: BalancerFormValues = {
	tag: "",
	strategy: "random",
	selector: [],
	fallbackTag: "",
};

const uniq = (values: string[]) => Array.from(new Set(values));

const balancerToJson = (values: BalancerFormValues) => {
	const settings =
		values.strategy === "leastLoad" ? cleanLeastLoadSettings(values.strategySettings) : undefined;
	return {
		tag: values.tag.trim(),
		selector: values.selector.map((item) => item.trim()).filter(Boolean),
		fallbackTag: values.fallbackTag ?? "",
		...(values.strategy && values.strategy !== "random"
			? { strategy: settings ? { type: values.strategy, settings } : { type: values.strategy } }
			: {}),
	};
};

const balancerFromJson = (json: Record<string, any>): BalancerFormValues => ({
	tag: String(json.tag ?? ""),
	strategy: typeof json.strategy === "string" ? json.strategy : (json.strategy?.type ?? "random"),
	selector: Array.isArray(json.selector) ? json.selector.map(String) : [],
	fallbackTag: String(json.fallbackTag ?? ""),
	strategySettings:
		typeof json.strategy === "object" && json.strategy?.settings
			? (json.strategy.settings as LeastLoadSettings)
			: undefined,
});

const LeastLoadFields: FC<{
	settings: LeastLoadSettings;
	onChange: (next: LeastLoadSettings) => void;
}> = ({ settings, onChange }) => {
	const { t } = useTranslation();
	const costs = settings.costs ?? [];
	const updateCost = (index: number, patch: Partial<LeastLoadCost>) =>
		onChange({
			...settings,
			costs: costs.map((cost, current) => (current === index ? { ...cost, ...patch } : cost)),
		});
	return (
		<Field>
			<FieldLabel>{t("pages.xray.balancer.leastLoadSettings")}</FieldLabel>
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
				<Field>
					<FieldLabel>{t("pages.xray.balancer.expected")}</FieldLabel>
					<Input
						type="number"
						min={1}
						step={1}
						value={settings.expected ?? ""}
						onChange={(event) =>
							onChange({
								...settings,
								expected: event.target.value === "" ? undefined : Number(event.target.value),
							})
						}
					/>
				</Field>
				<Field>
					<FieldLabel>{t("pages.xray.balancer.tolerance")}</FieldLabel>
					<Input
						type="number"
						min={0}
						max={1}
						step={0.01}
						value={settings.tolerance ?? ""}
						onChange={(event) =>
							onChange({
								...settings,
								tolerance: event.target.value === "" ? undefined : Number(event.target.value),
							})
						}
					/>
				</Field>
				<Field>
					<FieldLabel>{t("pages.xray.balancer.maxRTT")}</FieldLabel>
					<Input
						placeholder="1s"
						value={settings.maxRTT ?? ""}
						onChange={(event) => onChange({ ...settings, maxRTT: event.target.value })}
					/>
				</Field>
				<Field>
					<FieldLabel>{t("pages.xray.balancer.baselines")}</FieldLabel>
					<Input
						placeholder="1s, 2s"
						value={(settings.baselines ?? []).join(", ")}
						onChange={(event) =>
							onChange({ ...settings, baselines: splitMultiValueText(event.target.value) })
						}
					/>
				</Field>
			</div>
			<FieldLabel>{t("pages.xray.balancer.costs")}</FieldLabel>
			<FieldDescription>{t("pages.xray.balancer.costsDesc")}</FieldDescription>
			{costs.map((cost, index) => (
				<div
					key={index}
					className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,6rem)_auto] items-center gap-2"
				>
					<Input
						placeholder={t("pages.xray.balancer.costMatch")}
						value={cost.match}
						onChange={(event) => updateCost(index, { match: event.target.value })}
					/>
					<label className="flex items-center gap-1.5 text-xs">
						<Checkbox
							checked={cost.regexp}
							onCheckedChange={(checked) => updateCost(index, { regexp: checked === true })}
						/>
						regexp
					</label>
					<Input
						type="number"
						min={0}
						step="any"
						value={cost.value}
						onChange={(event) => updateCost(index, { value: Number(event.target.value) })}
					/>
					<Button
						aria-label={t("remove")}
						variant="ghost"
						size="sm"
						className="size-8 p-0"
						onClick={() =>
							onChange({ ...settings, costs: costs.filter((_, current) => current !== index) })
						}
					>
						<X className="w-4 h-4" />
					</Button>
				</div>
			))}
			<div>
				<Button
					variant="outline"
					size="sm"
					onClick={() =>
						onChange({ ...settings, costs: [...costs, { match: "", regexp: false, value: 1 }] })
					}
				>
					<Plus className="w-4 h-4" />
					{t("pages.xray.balancer.addCost")}
				</Button>
			</div>
		</Field>
	);
};
const normalizeBalancerOutboundTag = (tag: string) => tag.trim().toLowerCase();

export const BalancerModal: FC<BalancerModalProps> = ({
	open: isOpen,
	onClose,
	mode,
	initialBalancer,
	outboundTags,
	outboundOptions,
	excludedOutboundTags = [],
	existingTags,
	onTestOutbound,
	outboundTestingByTag = {},
	sourceTarget,
	propagationBase,
	onSubmit,
}) => {
	const { t } = useTranslation();
	const [targetIds, setTargetIds] = useState<string[]>([]);
	const [tab, setTab] = useState("form");
	const [jsonData, setJsonData] = useState<Record<string, unknown>>({});
	const [jsonError, setJsonError] = useState<string | null>(null);

	const modalForm = useForm<BalancerFormValues>({
		defaultValues: DEFAULT_BALANCER,
	});

	useEffect(() => {
		modalForm.register("selector");
	}, [modalForm]);

	const tagValue = modalForm.watch("tag");
	const rawSelectorValue = modalForm.watch("selector") ?? [];
	const rawFallbackTagValue = modalForm.watch("fallbackTag") ?? "";
	const excludedOutboundTagKeys = useMemo(
		() =>
			new Set(
				excludedOutboundTags.map(normalizeBalancerOutboundTag).filter(Boolean),
			),
		[excludedOutboundTags],
	);
	const isExcludedBalancerOutbound = useCallback(
		(tag: string) => {
			const normalized = normalizeBalancerOutboundTag(tag);
			return (
				normalized === "blocked" || excludedOutboundTagKeys.has(normalized)
			);
		},
		[excludedOutboundTagKeys],
	);
	const selectableOutboundTags = useMemo(
		() => outboundTags.filter((tag) => !isExcludedBalancerOutbound(tag)),
		[outboundTags, isExcludedBalancerOutbound],
	);
	const selectableOutboundOptions = useMemo(
		() =>
			(outboundOptions ?? selectableOutboundTags).filter(
				(option) =>
					!isExcludedBalancerOutbound(
						typeof option === "string" ? option : option.value,
					),
			),
		[outboundOptions, selectableOutboundTags, isExcludedBalancerOutbound],
	);
	const selectorValue = rawSelectorValue.filter(
		(tag) => !isExcludedBalancerOutbound(tag),
	);
	const fallbackTagValue = isExcludedBalancerOutbound(rawFallbackTagValue)
		? ""
		: rawFallbackTagValue;
	const normalizedTag = tagValue.trim();
	const duplicateTag = !normalizedTag || existingTags.includes(normalizedTag);
	const emptySelector = selectorValue.length === 0;

	useEffect(() => {
		if (!isOpen) return;
		setTargetIds([]);
		setTab("form");
		setJsonError(null);
		modalForm.reset(
			initialBalancer
				? {
						...DEFAULT_BALANCER,
						...initialBalancer,
						tag: initialBalancer.tag ?? "",
						selector: (initialBalancer.selector ?? []).filter(
							(tag) => !isExcludedBalancerOutbound(tag),
						),
						fallbackTag: isExcludedBalancerOutbound(
							initialBalancer.fallbackTag ?? "",
						)
							? ""
							: (initialBalancer.fallbackTag ?? ""),
					}
				: DEFAULT_BALANCER,
		);
	}, [initialBalancer, isOpen, modalForm, isExcludedBalancerOutbound]);

	const handleTabChange = (next: string) => {
		setTab(next);
		if (next === "json") {
			setJsonData(balancerToJson(modalForm.getValues()));
			setJsonError(null);
		}
	};

	const handleJsonChange = (value: string) => {
		try {
			const parsed: unknown = JSON.parse(value);
			if (!isPlainObject(parsed)) throw new SyntaxError(t("jsonEditor.invalid"));
			setJsonError(null);
			setJsonData(parsed);
			modalForm.reset(balancerFromJson(parsed));
		} catch (error) {
			setJsonError(error instanceof Error ? error.message : t("jsonEditor.invalid"));
		}
	};

	const onSubmitInternal = modalForm.handleSubmit((data) => {
		if (!isValid || (tab === "json" && jsonError)) return;
		const payload: BalancerFormValues = {
			tag: data.tag.trim(),
			strategy: data.strategy,
			strategySettings:
				data.strategy === "leastLoad"
					? cleanLeastLoadSettings(data.strategySettings)
					: undefined,
			selector: uniq(
				data.selector
					.map((item) => item.trim())
					.filter((item) => item && !isExcludedBalancerOutbound(item)),
			),
			fallbackTag: isExcludedBalancerOutbound(data.fallbackTag ?? "")
				? ""
				: (data.fallbackTag ?? ""),
		};
		onSubmit(payload, targetIds);
	});

	const isValid = useMemo(
		() => !duplicateTag && !emptySelector,
		[duplicateTag, emptySelector],
	);

	return (
		<Dialog open={isOpen} onOpenChange={(open) => { if (!open) (onClose)(); }}>
			
			<XrayModalContent className="mx-3 sm:max-w-2xl">
				<XrayModalHeader>
					{mode === "edit"
						? t("pages.xray.balancer.editBalancer")
						: t("pages.xray.balancer.addBalancer")}
				</XrayModalHeader>
				
				<form onSubmit={onSubmitInternal}>
					<XrayModalBody>
						<Tabs value={tab} onValueChange={handleTabChange}>
							<TabsList>
								<TabsTrigger value="form">{t("form")}</TabsTrigger>
								<TabsTrigger value="json">{t("json")}</TabsTrigger>
								<TabsTrigger value="propagate">{t("pages.xray.propagate.tab")}</TabsTrigger>
							</TabsList>
							
								<TabsContent value="form" className="px-0">
									<div className="flex flex-col gap-3 items-stretch">
										<XrayDialogSection title={mode === "edit" ? t("pages.xray.balancer.editBalancer") : t("pages.xray.balancer.addBalancer")}>
											<div className="flex flex-col gap-4 items-stretch">
												<Field data-invalid={duplicateTag}>
													<FieldLabel>{t("pages.xray.balancer.tag")}</FieldLabel>
													<Controller
														control={modalForm.control}
														name="tag"
														render={({ field }) => (
															<EmojiShortcodeInput
																ref={field.ref}
																value={field.value ?? ""}
																onChange={field.onChange}
																onBlur={field.onBlur}
															/>
														)}
													/>
													{duplicateTag ? (
														<FieldError>
															{t("pages.xray.balancer.tagError")}
														</FieldError>
													) : (
														<FieldDescription>
															{t("pages.xray.balancer.tagDesc")}
														</FieldDescription>
													)}
												</Field>
												<Field>
													<FieldLabel>
														{t("pages.xray.balancer.balancerStrategy")}
													</FieldLabel>
													<SearchableTagSelect
														mode="single"
														options={[
															"random",
															"roundRobin",
															"leastLoad",
															"leastPing",
														]}
														value={modalForm.watch("strategy") ?? ""}
														onChange={(value) =>
															modalForm.setValue("strategy", value as string, {
																shouldDirty: true,
															})
														}
														placeholder={t("pages.xray.balancer.balancerStrategy")}
														searchPlaceholder={t("search")}
													/>
												</Field>
												{modalForm.watch("strategy") === "leastLoad" ? (
													<LeastLoadFields
														settings={modalForm.watch("strategySettings") ?? {}}
														onChange={(next) =>
															modalForm.setValue("strategySettings", next, { shouldDirty: true })
														}
													/>
												) : null}
												<Field data-invalid={emptySelector}>
													<FieldLabel>
														{t("pages.xray.balancer.balancerSelectors")}
													</FieldLabel>
													<MultiValueAutocomplete
														options={selectableOutboundOptions}
														value={selectorValue.join(", ")}
														onChange={(value) =>
															modalForm.setValue(
																"selector",
																uniq(
																	splitMultiValueText(value).filter(
																		(tag) => !isExcludedBalancerOutbound(tag),
																	),
																),
																{ shouldDirty: true },
															)
														}
														placeholder={t("pages.xray.balancer.selectorPlaceholder")}
														emptyText={t("pages.xray.outbound.empty")}
														rightElement={
															selectorValue.length > 0 ? (
																<OutboundTestButton
																	label={t("pages.xray.routeTester.test")}
																	tag={selectorValue[0]}
																	isTesting={selectorValue.some(
																		(tag) => outboundTestingByTag[tag],
																	)}
																	onTest={() => {
																		selectorValue.forEach((tag) => {
																			onTestOutbound?.(tag);
																		});
																	}}
																/>
															) : undefined
														}
													/>
													{emptySelector && (
														<FieldError>
															{t("pages.xray.balancer.selectorError")}
														</FieldError>
													)}
												</Field>
												<Field>
													<FieldLabel>
														{t("pages.xray.balancer.fallbackTag")}
													</FieldLabel>
													<SearchableTagSelect
														mode="single"
														options={selectableOutboundOptions}
														value={fallbackTagValue}
														onChange={(value) =>
															modalForm.setValue("fallbackTag", value as string, {
																shouldDirty: true,
															})
														}
														placeholder={t("userDialog.flow.none")}
														searchPlaceholder={t("search")}
														emptyText={t("pages.xray.outbound.empty")}
														rightElement={
															<OutboundTestButton
																label={t("pages.xray.routeTester.test")}
																tag={fallbackTagValue}
																isTesting={outboundTestingByTag[fallbackTagValue]}
																onTest={onTestOutbound}
															/>
														}
													/>
												</Field>
											</div>
										</XrayDialogSection>
									</div>
								</TabsContent>
								<TabsContent value="json" className="px-0">
								<div className="flex flex-col gap-4">
									<div className="h-[420px] overflow-hidden rounded-lg border">
										<JsonEditor json={jsonData} onChange={handleJsonChange} />
									</div>
									{jsonError ? <p className="text-sm text-destructive">{jsonError}</p> : null}
								</div>
							</TabsContent>
								<TabsContent value="propagate" className="px-0">
									<PropagationTargets
										source={sourceTarget}
										section="balancers"
										before={propagationBase}
										after={{ tag: tagValue }}
										selectedIds={targetIds}
										onChange={setTargetIds}
									/>
								</TabsContent>
							
						</Tabs>
					</XrayModalBody>
					<XrayModalFooter className="justify-end">
						<Button onClick={onClose} variant="outline">
							{t("cancel")}
						</Button>
						<Button type="submit" disabled={!isValid} size="sm">
							{mode === "edit"
								? t("pages.xray.balancer.editBalancer")
								: t("pages.xray.balancer.addBalancer")}
						</Button>
					</XrayModalFooter>
				</form>
			</XrayModalContent>
		</Dialog>
	);
};
