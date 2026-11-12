import { Button } from "components/ui/button";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { cn } from "lib/cn";

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "components/ui/dialog";
import { FormField } from "components/ui/form-field";
import { FormSection } from "components/ui/form-section";
import { Input as UiInput } from "components/ui/input";
import { SegmentedControl } from "components/ui/segmented-control";
import { SegmentedMultiControl } from "components/ui/segmented-multi";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "components/ui/tabs";
import { Route, Plus, X } from "lucide-react";
import { type FC, useEffect, useMemo, useState } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { EmojiShortcodeInput } from "components/common/EmojiShortcodeInput";
import { useTranslation } from "react-i18next";
import { isPlainObject } from "utils/jsonFormatting";
import { JsonEditor } from "./JsonEditor";
import { MultiValueAutocomplete } from "./common/MultiValueAutocomplete";
import {
	SearchableTagSelect,
	type SearchableTagSelectOption,
} from "./common/SearchableTagSelect";
import { MatcherSelect } from "./xray/MatcherSelect";
import { OutboundTestButton } from "./xray/OutboundTestButton";
import { PropagationTargets } from "./xray/PropagationTargets";

type AttributePair = {
	key: string;
	value: string;
};

type RuleFormValues = {
	type: string;
	domainMatcher: string;
	outboundTag: string;
	balancerTag: string;
	inboundTags: string[];
	networks: string[];
	protocols: string[];
	sourceIps: string;
	sourcePort: string;
	localOS: string;
	domain: string;
	ip: string;
	user: string;
	port: string;
	attrs: AttributePair[];
	localIps: string;
	localPort: string;
	process: string;
	vlessRoute: string;
	ruleTag: string;
	webhookUrl: string;
	webhookDeduplication: string;
	webhookHeaders: AttributePair[];
};

export type RoutingRule = {
	type?: string;
	domainMatcher?: string;
	outboundTag?: string;
	balancerTag?: string;
	inboundTag?: string[];
	network?: string[];
	protocol?: string[];
	source?: string[];
	sourcePort?: string[];
	localOS?: string[];
	domain?: string[];
	ip?: string[];
	user?: string[];
	port?: string;
	attrs?: Record<string, string>;
	localIP?: string[];
	localPort?: string;
	process?: string[];
	vlessRoute?: string;
	ruleTag?: string;
	webhook?: {
		url?: string;
		deduplication?: number;
		headers?: Record<string, string>;
	};
};

export interface RuleModalProps {
	open: boolean;
	mode: "create" | "edit";
	initialRule?: RoutingRule | null;
	availableInboundTags: string[];
	availableOutboundTags: SearchableTagSelectOption[];
	availableBalancerTags: string[];
	onTestOutbound?: (tag: string) => void;
	outboundTestingByTag?: Record<string, boolean>;
	sourceTarget: string;
	propagationBase: RoutingRule | null;
	onSubmit: (rule: RoutingRule, targetIds: string[]) => void;
	onClose: () => void;
}

const NETWORK_OPTIONS = ["tcp", "udp"];
const PROTOCOL_OPTIONS = ["http", "tls", "bittorrent", "quic"];
const TYPE_OPTIONS = ["field", "chained"];
const DOMAIN_MATCHER_OPTIONS = ["", "hybrid", "linear"];

const defaultFormValues: RuleFormValues = {
	type: "field",
	domainMatcher: "",
	outboundTag: "",
	balancerTag: "",
	inboundTags: [],
	networks: [],
	protocols: [],
	sourceIps: "",
	sourcePort: "",
	localOS: "",
	domain: "",
	ip: "",
	user: "",
	port: "",
	attrs: [],
	localIps: "",
	localPort: "",
	process: "",
	vlessRoute: "",
	ruleTag: "",
	webhookUrl: "",
	webhookDeduplication: "",
	webhookHeaders: [],
};

const toDelimitedString = (value?: string | string[]) => {
	if (!value) {
		return "";
	}
	if (Array.isArray(value)) {
		return value.join(", ");
	}
	return value;
};

const splitStringList = (value: string) =>
	value
		.split(/[\s,]+/)
		.map((item) => item.trim())
		.filter(Boolean);

const toSingleTag = (value: unknown) => {
	if (Array.isArray(value)) {
		const firstValue = value.find((item) => item != null && String(item).trim());
		return firstValue == null ? "" : String(firstValue).trim();
	}
	return value == null ? "" : String(value).trim();
};

export const ruleToFormValues = (rule?: RoutingRule | null): RuleFormValues => {
	if (!rule) {
		return { ...defaultFormValues };
	}

	const attrs: AttributePair[] = rule.attrs
		? Object.entries(rule.attrs).map(([key, value]) => ({
				key,
				value: value == null ? "" : String(value),
			}))
		: [];

	const balancerTag = toSingleTag(rule.balancerTag);
	return {
		type: rule.type ?? "field",
		domainMatcher: rule.domainMatcher ?? "",
		outboundTag: balancerTag ? "" : toSingleTag(rule.outboundTag),
		balancerTag,
		inboundTags: Array.isArray(rule.inboundTag) ? rule.inboundTag : [],
		networks: Array.isArray(rule.network) ? rule.network : [],
		protocols: Array.isArray(rule.protocol) ? rule.protocol : [],
		sourceIps: toDelimitedString(rule.source),
		sourcePort: toDelimitedString(rule.sourcePort),
		localOS: toDelimitedString(rule.localOS),
		domain: toDelimitedString(rule.domain),
		ip: toDelimitedString(rule.ip),
		user: toDelimitedString(rule.user),
		port: toDelimitedString(rule.port),
		attrs,
		localIps: toDelimitedString(rule.localIP),
		localPort: rule.localPort ?? "",
		process: toDelimitedString(rule.process),
		vlessRoute: rule.vlessRoute ?? "",
		ruleTag: rule.ruleTag ?? "",
		webhookUrl: rule.webhook?.url ?? "",
		webhookDeduplication:
			rule.webhook?.deduplication == null ? "" : String(rule.webhook.deduplication),
		webhookHeaders: Object.entries(rule.webhook?.headers ?? {}).map(([key, value]) => ({
			key,
			value: String(value),
		})),
	};
};

export const formValuesToRule = (values: RuleFormValues): RoutingRule => {
	const rule: RoutingRule = {};

	if (values.type) rule.type = values.type;
	if (values.domainMatcher) rule.domainMatcher = values.domainMatcher;
	if (values.balancerTag) {
		rule.balancerTag = values.balancerTag;
	} else if (values.outboundTag) {
		rule.outboundTag = values.outboundTag;
	}
	if (values.inboundTags.length) rule.inboundTag = values.inboundTags;
	if (values.networks.length) rule.network = values.networks;
	if (values.protocols.length) rule.protocol = values.protocols;

	const source = splitStringList(values.sourceIps);
	if (source.length) rule.source = source;

	const sourcePort = splitStringList(values.sourcePort);
	if (sourcePort.length) rule.sourcePort = sourcePort;
	const localOS = splitStringList(values.localOS).map((value) => value.toLowerCase());
	if (localOS.length) rule.localOS = localOS;

	const domain = splitStringList(values.domain);
	if (domain.length) rule.domain = domain;

	const ip = splitStringList(values.ip);
	if (ip.length) rule.ip = ip;

	const user = splitStringList(values.user);
	if (user.length) rule.user = user;

	const portValue = values.port.trim();
	if (portValue) rule.port = portValue;

	const localIP = splitStringList(values.localIps);
	if (localIP.length) rule.localIP = localIP;

	const localPort = values.localPort.trim();
	if (localPort) rule.localPort = localPort;

	const processes = splitStringList(values.process);
	if (processes.length) rule.process = processes;

	const vlessRoute = values.vlessRoute.trim();
	if (vlessRoute) rule.vlessRoute = vlessRoute;

	const ruleTag = values.ruleTag.trim();
	if (ruleTag) rule.ruleTag = ruleTag;

	const webhookUrl = values.webhookUrl.trim();
	if (webhookUrl) {
		const webhook: NonNullable<RoutingRule["webhook"]> = { url: webhookUrl };
		const deduplication = Number(values.webhookDeduplication);
		if (values.webhookDeduplication.trim() && Number.isFinite(deduplication)) {
			webhook.deduplication = deduplication;
		}
		const headers: Record<string, string> = {};
		values.webhookHeaders.forEach(({ key, value }) => {
			if (key.trim()) headers[key.trim()] = value;
		});
		if (Object.keys(headers).length) webhook.headers = headers;
		rule.webhook = webhook;
	}

	if (values.attrs.length) {
		const attrs: Record<string, string> = {};
		values.attrs.forEach(({ key, value }) => {
			if (!key.trim()) return;
			attrs[key.trim()] = value;
		});
		if (Object.keys(attrs).length) {
			rule.attrs = attrs;
		}
	}

	if (!rule.type) {
		rule.type = "field";
	}

	return rule;
};

export const RuleModal: FC<RuleModalProps> = ({
	open: isOpen,
	mode,
	initialRule,
	availableInboundTags,
	availableOutboundTags,
	availableBalancerTags,
	onTestOutbound,
	outboundTestingByTag = {},
	sourceTarget,
	propagationBase,
	onSubmit,
	onClose,
}) => {
	const { t } = useTranslation();
	const [targetIds, setTargetIds] = useState<string[]>([]);
	const [tab, setTab] = useState("form");
	const [jsonData, setJsonData] = useState<RoutingRule>({});
	const [jsonError, setJsonError] = useState<string | null>(null);

	const {
		control,
		register,
		handleSubmit,
		reset,
		setValue,
		getValues,
		formState: { isSubmitting },
	} = useForm<RuleFormValues>({
		defaultValues: defaultFormValues,
	});

	const { fields, append, remove } = useFieldArray({
		control,
		name: "attrs",
	});

	const {
		fields: webhookHeaderFields,
		append: appendHeader,
		remove: removeWebhookHeader,
	} = useFieldArray({
		control,
		name: "webhookHeaders",
	});

	useEffect(() => {
		if (isOpen) {
			reset(ruleToFormValues(initialRule));
			setTargetIds([]);
			setTab("form");
			setJsonError(null);
		}
	}, [isOpen, initialRule, reset]);

	const onAddAttribute = () => append({ key: "", value: "" });
	const onAddWebhookHeader = () => appendHeader({ key: "", value: "" });

	const handleClose = () => {
		onClose();
	};

	const handleTabChange = (next: string) => {
		setTab(next);
		if (next === "json") {
			setJsonData(formValuesToRule(getValues()));
			setJsonError(null);
		}
	};

	const handleJsonChange = (value: string) => {
		try {
			const parsed: unknown = JSON.parse(value);
			if (!isPlainObject(parsed)) throw new SyntaxError(t("jsonEditor.invalid"));
			setJsonError(null);
			setJsonData(parsed as RoutingRule);
			reset(ruleToFormValues(parsed as RoutingRule));
		} catch (error) {
			setJsonError(error instanceof Error ? error.message : t("jsonEditor.invalid"));
		}
	};

	const handleSave = handleSubmit((values) => {
		if (tab === "json" && jsonError) return;
		const rule = formValuesToRule(values);
		onSubmit(rule, targetIds);
		handleClose();
	});

	const title = useMemo(
		() => (mode === "edit" ? t("pages.xray.rules.edit") : t("pages.xray.rules.add")),
		[mode, t],
	);

	return (
		<Dialog open={isOpen} onOpenChange={(next) => { if (!next) handleClose(); }}>
			<DialogContent className="flex max-h-[min(860px,calc(100dvh-8rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl max-md:inset-x-3 max-md:w-auto max-md:top-[4.5rem] max-md:bottom-24 max-md:max-h-none max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0">
				<form onSubmit={handleSave} className="flex min-h-0 flex-1 flex-col">
					<DialogHeader className="flex-row items-center gap-3 border-b px-5 py-3.5 pe-12 text-start sm:text-start">
						<div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
							<Route className="size-4" />
						</div>
						<div className="min-w-0">
							<DialogTitle className="truncate text-base">{title}</DialogTitle>
							<DialogDescription className="truncate">{t("pages.xray.Routings")}</DialogDescription>
						</div>
					</DialogHeader>

					<Tabs value={tab} onValueChange={handleTabChange} className="flex min-h-0 flex-1 flex-col">
						<div className="border-b px-5 pt-2.5 pb-2.5">
							<TabsList className="w-full">
								<TabsTrigger value="form">{t("form")}</TabsTrigger>
								<TabsTrigger value="json">{t("json")}</TabsTrigger>
								<TabsTrigger value="propagate">{t("pages.xray.propagate.tab")}</TabsTrigger>
							</TabsList>
						</div>
						<div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
							<TabsContent value="form" className="mt-0">
								<div className="flex flex-col gap-5">
									<FormSection title={t("pages.outbound.basicSettings")}>
										<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
											<FormField label={t("pages.xray.rules.type")}>
												<Controller
													control={control}
													name="type"
													render={({ field }) => (
														<SegmentedControl<string>
															label={t("pages.xray.rules.type")}
															value={field.value ?? "field"}
															options={TYPE_OPTIONS.map((option) => ({ value: option, label: option }))}
															onChange={(next) => field.onChange(next)}
														/>
													)}
												/>
											</FormField>
											<FormField label={t("pages.xray.rules.domainMatcher")}>
												<Controller
													control={control}
													name="domainMatcher"
													render={({ field }) => (
														<SegmentedControl<string>
															label={t("pages.xray.rules.domainMatcher")}
															value={field.value ?? ""}
															options={DOMAIN_MATCHER_OPTIONS.map((option) => ({
																value: option,
																label: option || t("common.default"),
															}))}
															onChange={(next) => field.onChange(next)}
														/>
													)}
												/>
											</FormField>
										</div>
									</FormSection>

									<FormSection>
										<FormField label={t("pages.xray.rules.inboundTag")}>
											<Controller
												control={control}
												name="inboundTags"
												render={({ field }) => (
													<SearchableTagSelect
														mode="multiple"
														options={availableInboundTags}
														value={field.value ?? []}
														onChange={(value) => field.onChange(value as string[])}
														placeholder={t("pages.xray.rules.inboundTag")}
														searchPlaceholder={t("search")}
														emptyText={t("pages.inbounds.empty")}
													/>
												)}
											/>
										</FormField>
									</FormSection>

									<FormSection>
										<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
											<FormField label={t("pages.xray.rules.outboundTag")}>
												<Controller
													control={control}
													name="outboundTag"
													render={({ field }) => (
														<div className="flex flex-row items-start gap-2">
															<div className="min-w-0 flex-1">
																<SearchableTagSelect
																	mode="single"
																	options={availableOutboundTags}
																	value={field.value ?? ""}
																	onChange={(value) => {
																		const nextValue = value as string;
																		field.onChange(nextValue);
																		if (nextValue) {
																			setValue("balancerTag", "", { shouldDirty: true });
																		}
																	}}
																	placeholder={t("userDialog.flow.none")}
																	searchPlaceholder={t("search")}
																	emptyText={t("pages.xray.outbound.empty")}
																	rightElement={
																		<OutboundTestButton
																			label={t("pages.xray.routeTester.test")}
																			tag={field.value ?? ""}
																			isTesting={outboundTestingByTag[field.value ?? ""]}
																			onTest={onTestOutbound}
																		/>
																	}
																/>
															</div>
															<Button aria-label={t("remove")} disabled={!field.value} onClick={() => field.onChange("")} variant="ghost" size="sm" className="size-8 p-0">
																<X />
															</Button>
														</div>
													)}
												/>
											</FormField>
											<FormField label={t("pages.xray.rules.balancer")}>
												<Controller
													control={control}
													name="balancerTag"
													render={({ field }) => (
														<div className="flex flex-row items-start gap-2">
															<div className="min-w-0 flex-1">
																<SearchableTagSelect
																	mode="single"
																	options={availableBalancerTags}
																	value={field.value ?? ""}
																	onChange={(value) => {
																		const nextValue = value as string;
																		field.onChange(nextValue);
																		if (nextValue) {
																			setValue("outboundTag", "", { shouldDirty: true });
																		}
																	}}
																	placeholder={t("userDialog.flow.none")}
																	searchPlaceholder={t("search")}
																	emptyText={t("pages.xray.balancer.empty")}
																/>
															</div>
															<Button aria-label={t("remove")} disabled={!field.value} onClick={() => field.onChange("")} variant="ghost" size="sm" className="size-8 p-0">
																<X />
															</Button>
														</div>
													)}
												/>
											</FormField>
										</div>
									</FormSection>

									<FormSection title={t("pages.xray.rules.network")}>
										<FormField label={t("pages.xray.rules.network")}>
											<Controller
												control={control}
												name="networks"
												render={({ field }) => (
													<SegmentedMultiControl
														label={t("pages.xray.rules.network")}
														value={field.value ?? []}
														options={NETWORK_OPTIONS.map((option) => ({ value: option, label: option }))}
														onChange={(next) => field.onChange(next)}
													/>
												)}
											/>
										</FormField>
										<FormField label={t("pages.xray.rules.protocol")}>
											<Controller
												control={control}
												name="protocols"
												render={({ field }) => (
													<SegmentedMultiControl
														label={t("pages.xray.rules.protocol")}
														value={field.value ?? []}
														options={PROTOCOL_OPTIONS.map((option) => ({ value: option, label: option }))}
														onChange={(next) => field.onChange(next)}
													/>
												)}
											/>
										</FormField>
									</FormSection>

									<FormSection title={t("pages.xray.rules.sourceGroup")}>
										<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
											<FormField label={t("pages.xray.rules.source")}>
												<Controller
													control={control}
													name="sourceIps"
													render={({ field }) => (
														<MatcherSelect value={field.value ?? ""} kind="ip" onChange={field.onChange} placeholder={t("pages.xray.rules.useComma")} />
													)}
												/>
											</FormField>
											<FormField label={t("pages.xray.rules.sourcePort")}>
												<Controller
													control={control}
													name="sourcePort"
													render={({ field }) => (
														<MultiValueAutocomplete value={field.value ?? ""} onChange={field.onChange} placeholder="80, 443, 1000-2000" />
													)}
												/>
											</FormField>
											<FormField label="Node OS (Xray 26.9.8+)">
												<UiInput placeholder="linux, windows, darwin" {...register("localOS")} />
											</FormField>
										</div>
									</FormSection>

									<FormSection title={t("pages.xray.rules.destinationGroup")}>
										<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
											<FormField label={t("pages.xray.rules.ip")}>
												<Controller
													control={control}
													name="ip"
													render={({ field }) => (
														<MatcherSelect value={field.value ?? ""} kind="ip" onChange={field.onChange} placeholder="8.8.8.8, geoip:private" />
													)}
												/>
											</FormField>
											<FormField label={t("pages.xray.rules.domain")}>
												<Controller
													control={control}
													name="domain"
													render={({ field }) => (
														<MatcherSelect value={field.value ?? ""} kind="domain" onChange={field.onChange} placeholder="domain:example.com, geosite:category-ads" />
													)}
												/>
											</FormField>
											<FormField label={t("users")}>
												<Controller
													control={control}
													name="user"
													render={({ field }) => (
														<MultiValueAutocomplete value={field.value ?? ""} onChange={field.onChange} placeholder="email@example.com, user-tag" />
													)}
												/>
											</FormField>
											<FormField label={t("pages.xray.rules.localIp")}>
												<Controller
													control={control}
													name="localIps"
													render={({ field }) => (
														<MatcherSelect value={field.value ?? ""} kind="ip" onChange={field.onChange} placeholder="127.0.0.1, geoip:private" />
													)}
												/>
											</FormField>
											<FormField label={t("pages.xray.rules.localPort")}>
												<Controller
													control={control}
													name="localPort"
													render={({ field }) => (
														<MultiValueAutocomplete value={field.value ?? ""} onChange={field.onChange} placeholder="80, 443, 1000-2000" />
													)}
												/>
											</FormField>
											<FormField label={t("pages.xray.rules.port")}>
												<Controller
													control={control}
													name="port"
													render={({ field }) => (
														<MultiValueAutocomplete value={field.value ?? ""} onChange={field.onChange} placeholder="80, 443, 1000-2000" />
													)}
												/>
											</FormField>
										</div>
									</FormSection>

									<FormSection title={t("pages.xray.rules.processGroup")}>
										<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
											<FormField label={t("pages.xray.rules.process")}>
												<Controller
													control={control}
													name="process"
													render={({ field }) => (
														<MatcherSelect value={field.value ?? ""} kind="process" onChange={field.onChange} placeholder="curl, /usr/bin/curl, self/" />
													)}
												/>
											</FormField>
											<FormField label={t("pages.xray.rules.vlessRoute")}>
												<UiInput placeholder="53,443,1000-2000" {...register("vlessRoute")} />
											</FormField>
											<FormField label={t("pages.xray.rules.ruleTag")}>
												<Controller
													control={control}
													name="ruleTag"
													render={({ field }) => (
														<EmojiShortcodeInput
															ref={field.ref}
															value={field.value ?? ""}
															onChange={field.onChange}
															onBlur={field.onBlur}
														/>
													)}
												/>
											</FormField>
										</div>
									</FormSection>

									<FormSection title={t("pages.xray.rules.webhook")}>
										<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
											<FormField label={t("pages.xray.rules.webhookUrl")}>
												<UiInput placeholder="https://example.com/hook, /var/run/hook.sock" {...register("webhookUrl")} />
											</FormField>
											<FormField label={t("pages.xray.rules.webhookDeduplication")}>
												<UiInput type="number" min={0} inputMode="numeric" {...register("webhookDeduplication")} />
											</FormField>
										</div>
										<div className="flex flex-col gap-3">
											{webhookHeaderFields.map((field, index) => (
												<div key={field.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2">
													<UiInput placeholder={t("myaccount.apiKeyMasked")} {...register(`webhookHeaders.${index}.key` as const)} />
													<UiInput placeholder={t("value")} {...register(`webhookHeaders.${index}.value` as const)} />
													<Button aria-label={t("a11y.removeAttribute")} onClick={() => removeWebhookHeader(index)} variant="ghost" size="sm" className="size-8 p-0">
														<X className="w-[16px]" />
													</Button>
												</div>
											))}
											<div>
												<Button onClick={onAddWebhookHeader} variant="outline" size="sm">
													<Plus className="w-[16px]" />
													{t("pages.xray.rules.webhookHeaders")}
												</Button>
											</div>
										</div>
									</FormSection>

									<FormSection title={t("pages.xray.rules.attrs")}>
										<div className="flex flex-col gap-3">
											{fields.length === 0 ? (
												<p className="text-sm text-muted-foreground">{t("pages.xray.rules.attrsHelper")}</p>
											) : null}
											{fields.map((field, index) => (
												<div key={field.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2">
													<UiInput placeholder={t("myaccount.apiKeyMasked")} {...register(`attrs.${index}.key` as const)} />
													<UiInput placeholder={t("value")} {...register(`attrs.${index}.value` as const)} />
													<Button aria-label={t("a11y.removeAttribute")} onClick={() => remove(index)} variant="ghost" size="sm" className="size-8 p-0">
														<X className="w-[16px]" />
													</Button>
												</div>
											))}
											<div>
												<Button onClick={onAddAttribute} variant="outline" size="sm">
													<Plus className="w-[16px]" />
													{t("add")}
												</Button>
											</div>
										</div>
									</FormSection>
								</div>
							</TabsContent>
							<TabsContent value="json" className="mt-0">
							<div className="flex flex-col gap-4">
								<div className="h-[420px] overflow-hidden rounded-lg border">
									<JsonEditor json={jsonData} canonicalContext="routingRule" onChange={handleJsonChange} />
								</div>
								{jsonError ? <p className="text-sm text-destructive">{jsonError}</p> : null}
							</div>
						</TabsContent>
						<TabsContent value="propagate" className="mt-0">
								<PropagationTargets
									source={sourceTarget}
									section="routing.rules"
									before={propagationBase}
									after={null}
									selectedIds={targetIds}
									onChange={setTargetIds}
								/>
							</TabsContent>
						</div>
					</Tabs>

					<DialogFooter className="flex-row flex-wrap items-center justify-end gap-2 border-t px-5 py-3">
						<Button onClick={handleClose} variant="outline" size="sm">
							{t("cancel")}
						</Button>
						<Button type="submit" size="sm" loading={isSubmitting}>
							{mode === "edit" ? t("pages.xray.rules.edit") : t("pages.xray.rules.add")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
};
