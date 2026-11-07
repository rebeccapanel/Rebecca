import { Badge } from "components/ui/badge";
import { Button } from "components/ui/button";
import { Collapsible, CollapsibleContent } from "components/ui/collapsible";
import { Textarea } from "components/ui/textarea";
import { Alert } from "components/ui/alert";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { ExternalLink, ChevronDown, ChevronUp, Copy, Plus, Trash2 } from "lucide-react";

import { PanelSelect } from "components/common/PanelSelect";
import { CheckRow } from "components/ui/check-row";
import { ToggleRow } from "components/ui/toggle-row";
import { FormField } from "components/ui/form-field";
import { Input as UiInput } from "components/ui/input";
import { NumberField } from "components/ui/number-field";
import { Switch as UiSwitch } from "components/ui/switch";
import { cn } from "lib/cn";
import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
	type HAProxyCandidate,
	type HAProxyCertificate,
	type HAProxyListener,
	type HAProxyNode,
	type HAProxyRoute,
	type HAProxySettings,
	type HAProxySite,
	type HAProxyTarget,
	type HAProxyTemplate,
	getHAProxyCandidates,
	haproxyMatcherPriority,
	preferredHAProxyMatcher,
} from "service/haproxy";
import { emptyListener, emptySite, externalRoute } from "./helpers";

const numeric = (value: number | null | undefined) =>
	value === null || value === undefined ? "" : String(value);

const requiredLabel = (text: ReactNode) => (
	<span>
		{text} <span className="text-red-500">*</span>
	</span>
);

export const EditorPanel = ({
	title,
	description,
	actions,
	className,
	children,
}: {
	title?: ReactNode;
	description?: ReactNode;
	actions?: ReactNode;
	className?: string;
	children: ReactNode;
}) => (
	<section className={cn("flex flex-col gap-4 rounded-xl border border-panel-border! bg-panel-surface p-4", className)}>
		{title || actions ? (
			<div className="flex flex-row flex-wrap items-center justify-between gap-3">
				<div className="min-w-0">
					{title ? <h3 className="text-sm font-semibold">{title}</h3> : null}
					{description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
				</div>
				{actions}
			</div>
		) : null}
		{children}
	</section>
);

export { ToggleRow };

export function TargetEditor({
	target,
	node,
	templates,
	uploadedTemplates,
	certificates,
	expanded,
	isCloning,
	canClone,
	onExpandedChange,
	onClone,
	onChange,
	onRemove,
}: {
	target: HAProxyTarget;
	node?: HAProxyNode;
	templates: HAProxyTemplate[];
	uploadedTemplates: HAProxyTemplate[];
	certificates: HAProxyCertificate[];
	expanded: boolean;
	isCloning: boolean;
	canClone: boolean;
	onExpandedChange: (expanded: boolean) => void;
	onClone: () => void;
	onChange: (target: HAProxyTarget) => void;
	onRemove: () => void;
}) {
	const { t } = useTranslation();
	const candidates = useQuery({ queryKey: ["haproxy-candidates", target.node_id], queryFn: () => getHAProxyCandidates(target.node_id), refetchOnWindowFocus: false, enabled: expanded });
	return (
		<section className="flex flex-col gap-4 rounded-xl border border-panel-border! bg-panel-surface p-4">
			<div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
				<div className="min-w-0">
					<div className="flex flex-row items-center gap-2">
						<h2 className="text-[0.95rem] font-semibold">
							{node?.name || t("haproxy.nodeFallback", { id: target.node_id })}
						</h2>
						{node?.status === "disabled" ? <Badge className="bg-destructive/10 text-destructive">{t("haproxy.disabledNode")}</Badge> : null}
					</div>
					<p className="mt-0.5 text-xs text-muted-foreground">
						{target.listeners.length} {t("haproxy.listeners")}
					</p>
				</div>
				<div className="flex flex-row flex-wrap items-center gap-2">
					<Button onClick={onClone} disabled={!canClone} variant="outline" size="sm" loading={isCloning}>
						<Copy className="w-[16px]" />
						{t("haproxy.clone")}
					</Button>
					<Button aria-label={t(expanded ? "haproxy.collapseSettings" : "haproxy.expandSettings")} onClick={() => onExpandedChange(!expanded)} variant="ghost" size="sm" className="size-8 p-0">
						{expanded ? <ChevronUp className="w-[17px]" /> : <ChevronDown className="w-[17px]" />}
					</Button>
					<Button aria-label={t("haproxy.removeTarget")} onClick={onRemove} variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 size-8 p-0">
						<Trash2 className="w-[17px]" />
					</Button>
				</div>
			</div>
			<Collapsible open={expanded}><CollapsibleContent forceMount className="data-[state=closed]:hidden">
				<div className="flex flex-col gap-4">
					{target.listeners.map((listener, index) => (
						<ListenerEditor
							key={`${listener.name}-${index}`}
							listener={listener}
							candidates={candidates.data?.candidates ?? []}
							templates={templates}
							uploadedTemplates={uploadedTemplates}
							certificates={certificates}
							onChange={(next) =>
								onChange({
									...target,
									listeners: target.listeners.map((item, itemIndex) => (itemIndex === index ? next : item)),
								})
							}
							onRemove={() =>
								onChange({
									...target,
									listeners: target.listeners.filter((_, itemIndex) => itemIndex !== index),
								})
							}
						/>
					))}
					<Button onClick={() =>
							onChange({
								...target,
								listeners: [...target.listeners, emptyListener(target.listeners.length)],
							})
						} variant="outline">
						<Plus className="w-[16px]" />
						{t("haproxy.addListener")}
					</Button>
				</div>
			</CollapsibleContent></Collapsible>
		</section>
	);
}

function ListenerEditor({
	listener,
	candidates,
	templates,
	uploadedTemplates,
	certificates,
	onChange,
	onRemove,
}: {
	listener: HAProxyListener;
	candidates: HAProxyCandidate[];
	templates: HAProxyTemplate[];
	uploadedTemplates: HAProxyTemplate[];
	certificates: HAProxyCertificate[];
	onChange: (listener: HAProxyListener) => void;
	onRemove: () => void;
}) {
	const { t } = useTranslation();
	const [candidateOption, setCandidateOption] = useState("");
	const [expanded, setExpanded] = useState(true);
	const sites = listener.sites ?? (listener.site?.enabled ? [listener.site] : []);
	const hasDefaultSite = sites.some((site) => site.enabled && site.is_default);
	const hasDefaultRoute = listener.routes.some((route) => route.match_type === "default");
	const candidateOptions = useMemo(
		() =>
			candidates
				.filter((candidate) => !listener.routes.some((route) => route.inbound_tag === candidate.tag))
				.map((candidate) => {
					const matchers = candidate.matchers.filter((matcher) => !hasDefaultSite || matcher.type !== "default");
					const matcher = preferredHAProxyMatcher(matchers);
					const displayedMatcher = matcher ?? preferredHAProxyMatcher(candidate.matchers);
					return {
						value: candidate.tag,
						label: `${candidate.tag} · ${candidate.protocol}/${candidate.network} · ${displayedMatcher?.type}${displayedMatcher?.value ? `: ${displayedMatcher.value}` : ""}${matchers.length > 1 ? ` (+${matchers.length - 1})` : ""}`,
						disabled: !matcher,
					};
				}),
		[candidates, listener.routes, hasDefaultSite],
	);
	const addCandidate = () => {
		const candidate = candidates.find((item) => item.tag === candidateOption);
		const matcher = candidate && preferredHAProxyMatcher(candidate.matchers.filter((item) => !hasDefaultSite || item.type !== "default"));
		if (!candidate || !matcher) return;
		onChange({
			...listener,
			routes: [
				...listener.routes,
				{
					name: candidate.tag,
					source: "xray",
					inbound_tag: candidate.tag,
					protocol: candidate.protocol,
					backend_host: "127.0.0.1",
					backend_port: candidate.port,
					match_type: matcher.type,
					match_value: matcher.value,
				},
			],
		});
		setCandidateOption("");
	};

	return (
		<section className="flex flex-col gap-4 rounded-xl border border-panel-border! bg-panel-surface-muted p-4">
			<div className="flex flex-row items-center justify-between gap-2">
				<div className="flex flex-row items-center gap-2">
					<h2 className="text-sm font-semibold">{listener.name || t("haproxy.listener")}</h2>
					<Badge>{listener.listen_port}</Badge>
				</div>
				<div className="flex flex-row items-center gap-1">
					<Button aria-label={t(expanded ? "haproxy.collapseSettings" : "haproxy.expandSettings")} onClick={() => setExpanded(!expanded)} variant="ghost" size="sm" className="size-8 p-0">
						{expanded ? <ChevronUp className="w-[16px]" /> : <ChevronDown className="w-[16px]" />}
					</Button>
					<Button aria-label={t("haproxy.removeListener")} onClick={onRemove} variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 size-8 p-0">
						<Trash2 className="w-[16px]" />
					</Button>
				</div>
			</div>
			<Collapsible open={expanded}><CollapsibleContent forceMount className="data-[state=closed]:hidden">
				<div className="flex flex-col gap-4">
					<div className="grid grid-cols-1 gap-3 md:grid-cols-3">
						<FormField label={t("haproxy.listenerName")}>
							<UiInput value={listener.name} onChange={(event) => onChange({ ...listener, name: event.target.value })} />
						</FormField>
						<FormField label={t("haproxy.listenAddress")}>
							<UiInput value={listener.listen_address} onChange={(event) => onChange({ ...listener, listen_address: event.target.value })} />
						</FormField>
						<FormField label={requiredLabel(t("haproxy.listenPort"))}>
							<NumberField
								inputMode="numeric"
								min={1}
								max={65535}
								value={numeric(listener.listen_port)}
								doneLabel={t("common.done")}
								onChange={(raw) => onChange({ ...listener, listen_port: Number(raw) })}
							/>
						</FormField>
					</div>
					<ToggleRow
						title={t("haproxy.acceptProxy")}
						checked={listener.accept_proxy_protocol}
						onChange={(next) => onChange({ ...listener, accept_proxy_protocol: next })}
					/>
					<FormField label={t("haproxy.compatibleInbound")} description={t("haproxy.matcherPriorityHelp")}>
						<div className="flex flex-col gap-2 lg:flex-row lg:items-center">
							<PanelSelect
								showSearch
								value={candidateOption}
								onValueChange={(value) => setCandidateOption(String(value))}
								options={candidateOptions}
								placeholder={t("haproxy.selectInbound")}
								className="flex-1"
							/>
							<div className="flex flex-row flex-wrap gap-2">
								<Button onClick={addCandidate} disabled={
										!candidateOption ||
										candidateOptions.some((option) => option.value === candidateOption && option.disabled)
									}>
									<Plus className="w-[16px]" />
									{t("haproxy.addInbound")}
								</Button>
								<Button onClick={() =>
										onChange({
											...listener,
											routes: [...listener.routes, externalRoute(listener.routes.length, hasDefaultSite)],
										})
									} variant="outline">
									{t("haproxy.addExternal")}
								</Button>
							</div>
						</div>
					</FormField>
					<div className="flex flex-col gap-2">
						{listener.routes.map((route, index) => (
							<RouteEditor
								key={`${route.name}-${index}`}
								route={route}
								candidate={candidates.find((candidate) => candidate.tag === route.inbound_tag)}
								defaultUnavailable={hasDefaultSite}
								onChange={(next) =>
									onChange({
										...listener,
										routes: listener.routes.map((item, itemIndex) => (itemIndex === index ? next : item)),
									})
								}
								onRemove={() =>
									onChange({
										...listener,
										routes: listener.routes.filter((_, itemIndex) => itemIndex !== index),
									})
								}
							/>
						))}
					</div>
					<div className="flex flex-row items-center justify-between gap-3 border-t border-panel-border! pt-4">
						<div className="min-w-0">
							<p className="text-sm font-semibold">{t("haproxy.websites")}</p>
							<p className="text-xs text-muted-foreground">{t("haproxy.websitesHelp")}</p>
						</div>
						<Button onClick={() =>
								onChange({
									...listener,
									sites: [...sites, emptySite(sites.length)],
									site: undefined,
								})
							} size="sm">
							<Plus className="w-[15px]" />
							{t("haproxy.addWebsite")}
						</Button>
					</div>
					<div className="flex flex-col gap-3">
						{sites.map((site, index) => (
							<SiteEditor
								key={`${site.name || "site"}-${index}`}
								site={site}
								templates={templates}
								uploadedTemplates={uploadedTemplates}
								certificates={certificates}
								isFirst={index === 0}
								defaultUnavailable={hasDefaultRoute}
								hostnameRequired={hasDefaultSite && !site.is_default}
								onChange={(next) =>
									onChange({
										...listener,
										sites: sites.map((item, itemIndex) => (itemIndex === index ? next : item)),
										site: undefined,
									})
								}
								onRemove={() =>
									onChange({
										...listener,
										sites: sites.filter((_, itemIndex) => itemIndex !== index),
										site: undefined,
									})
								}
							/>
						))}
					</div>
				</div>
			</CollapsibleContent></Collapsible>
		</section>
	);
}

function SiteEditor({
	site,
	templates,
	uploadedTemplates,
	certificates,
	isFirst,
	defaultUnavailable,
	hostnameRequired,
	onChange,
	onRemove,
}: {
	site: HAProxySite;
	templates: HAProxyTemplate[];
	uploadedTemplates: HAProxyTemplate[];
	certificates: HAProxyCertificate[];
	isFirst: boolean;
	defaultUnavailable: boolean;
	hostnameRequired: boolean;
	onChange: (site: HAProxySite) => void;
	onRemove: () => void;
}) {
	const { t } = useTranslation();
	const [expanded, setExpanded] = useState(true);
	const [templateMode, setTemplateMode] = useState<"catalog" | "url">(site.template_url ? "url" : "catalog");
	const sourceTemplates = site.source === "upload" ? uploadedTemplates : templates;
	const selectedTemplate = sourceTemplates.find((item) => item.id === site.template_id);
	const previewURL = site.template_url || selectedTemplate?.preview_url;
	const tlsMode = site.tls_mode || "none";
	const open = site.enabled && expanded;

	return (
		<section className="flex flex-col gap-4 rounded-xl border border-panel-border! bg-card/40 p-4">
			<div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
				<div className="flex flex-row flex-wrap items-center gap-2">
					<UiSwitch checked={site.enabled} onCheckedChange={(next) => onChange({ ...site, enabled: next, is_default: next ? site.is_default : false })} />
					<p className="text-sm font-semibold">{site.name || t("haproxy.website")}</p>
					<Badge>
						{site.is_default
							? t("haproxy.websiteModeHTTPAndHTTPS")
							: tlsMode === "none"
								? t("haproxy.websiteModeHTTP")
								: t("haproxy.websiteModeTLSSNI")}
					</Badge>
				</div>
				<div className="flex flex-row flex-wrap items-center gap-3">
					{isFirst ? (
						<CheckRow checked={Boolean(site.is_default)} disabled={!site.enabled || defaultUnavailable} onChange={(next) => onChange({ ...site, is_default: next })}>
							{t("haproxy.defaultWebsite")}
						</CheckRow>
					) : null}
					<Button aria-label={t(open ? "haproxy.collapseSettings" : "haproxy.expandSettings")} disabled={!site.enabled} onClick={() => setExpanded(!expanded)} variant="ghost" size="sm" className="size-8 p-0">
						{open ? <ChevronUp className="w-[15px]" /> : <ChevronDown className="w-[15px]" />}
					</Button>
					<Button aria-label={t("haproxy.removeWebsite")} onClick={onRemove} variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 size-8 p-0">
						<Trash2 className="w-[15px]" />
					</Button>
				</div>
			</div>
			<Collapsible open={open}><CollapsibleContent forceMount className="data-[state=closed]:hidden">
				<div className="flex flex-col gap-4">
					<div className="grid grid-cols-1 gap-3 md:grid-cols-3">
						<FormField label={t("haproxy.websiteName")}>
							<UiInput value={site.name || ""} onChange={(event) => onChange({ ...site, name: event.target.value })} />
						</FormField>
						<FormField label={(tlsMode !== "none" && !site.is_default) || hostnameRequired ? requiredLabel(t("haproxy.hostname")) : t("haproxy.hostname")}>
							<UiInput value={site.hostname || ""} placeholder="site.example.com" onChange={(event) => onChange({ ...site, hostname: event.target.value })} />
						</FormField>
						<FormField label={t("haproxy.tlsMode")}>
							<PanelSelect
								value={tlsMode}
								onValueChange={(value) => onChange({ ...site, tls_mode: String(value) as HAProxySite["tls_mode"] })}
								options={[
									{ value: "none", label: t("haproxy.noTLS") },
									{ value: "self_signed", label: t("haproxy.selfSigned") },
									{ value: "managed", label: t("haproxy.managedCertificate") },
									{ value: "custom", label: t("haproxy.customCertificate") },
								]}
							/>
						</FormField>
					</div>
					{tlsMode === "managed" ? (
						<FormField label={requiredLabel(t("haproxy.managedCertificate"))}>
							<PanelSelect
								showSearch
								value={site.certificate_domain || ""}
								onValueChange={(value) => onChange({ ...site, certificate_domain: String(value) })}
								options={certificates
									.filter((certificate) => certificate.status === "active")
									.map((certificate) => ({ value: certificate.domain, label: certificate.domain }))}
								placeholder={t("haproxy.selectCertificate")}
							/>
						</FormField>
					) : null}
					{tlsMode === "custom" ? (
						<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
							<FormField label={requiredLabel(t("haproxy.certificatePath"))}>
								<UiInput value={site.certificate_path || ""} placeholder="/etc/ssl/fullchain.pem" onChange={(event) => onChange({ ...site, certificate_path: event.target.value })} />
							</FormField>
							<FormField label={requiredLabel(t("haproxy.privateKeyPath"))}>
								<UiInput value={site.private_key_path || ""} placeholder="/etc/ssl/privkey.pem" onChange={(event) => onChange({ ...site, private_key_path: event.target.value })} />
							</FormField>
						</div>
					) : null}
					<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
						<FormField label={t("haproxy.templateSource")}>
							<PanelSelect
								value={site.source}
								onValueChange={(value) => {
									const source = String(value) as HAProxySite["source"];
									setTemplateMode("catalog");
									onChange({
										...site,
										source,
										template_id: source === "builtin" ? "builtin" : source === "templatemo" ? templates[0]?.id || "" : uploadedTemplates[0]?.id || "",
										template_url: "",
									});
								}}
								options={[
									{ value: "builtin", label: t("haproxy.builtinTemplate") },
									{ value: "templatemo", label: "TemplateMo" },
									{ value: "upload", label: t("haproxy.uploadedTemplate") },
								]}
							/>
						</FormField>
						{site.source === "templatemo" ? (
							<FormField label={t("haproxy.templateChoice")}>
								<PanelSelect
									value={templateMode}
									onValueChange={(value) => {
										const mode = String(value) as "catalog" | "url";
										setTemplateMode(mode);
										onChange({
											...site,
											template_id: mode === "catalog" ? site.template_id || templates[0]?.id || "" : "",
											template_url: "",
										});
									}}
									options={[
										{ value: "catalog", label: t("haproxy.templateFromList") },
										{ value: "url", label: t("haproxy.templateFromURL") },
									]}
								/>
							</FormField>
						) : null}
						{site.source === "upload" ? (
							<FormField label={t("haproxy.template")}>
								<PanelSelect
									showSearch
									value={site.template_id}
									onValueChange={(value) => onChange({ ...site, template_id: String(value), template_url: "" })}
									options={sourceTemplates.map((template) => ({ value: template.id, label: template.name }))}
									placeholder={t("haproxy.selectTemplate")}
								/>
							</FormField>
						) : null}
					</div>
					{site.source === "templatemo" && templateMode === "catalog" ? (
						<FormField label={t("haproxy.template")}>
							<PanelSelect
								showSearch
								value={site.template_id}
								onValueChange={(value) => onChange({ ...site, template_id: String(value), template_url: "" })}
								options={templates.map((template) => ({ value: template.id, label: template.name }))}
								placeholder={t("haproxy.selectTemplate")}
							/>
						</FormField>
					) : null}
					{site.source === "templatemo" && templateMode === "url" ? (
						<FormField label={t("haproxy.templateMoURL")} description={t("haproxy.templateMoURLHelp")}>
							<UiInput
								value={site.template_url || ""}
								placeholder="https://templatemo.com/tm-632-machina"
								onChange={(event) =>
									onChange({
										...site,
										template_url: event.target.value,
										template_id: event.target.value ? "" : site.template_id,
									})
								}
							/>
						</FormField>
					) : null}
					{previewURL ? (
						<a href={previewURL} target="_blank" rel="noopener noreferrer" className="inline-flex w-fit items-center gap-2 text-sm text-primary">
							<ExternalLink className="w-[15px]" />
							{t("haproxy.previewTemplate")}
						</a>
					) : null}
					<FormField label={t("haproxy.notFoundHTML")} description={t("haproxy.notFoundHelp")}>
						<Textarea value={site.not_found_html || ""} onChange={(event) => onChange({ ...site, not_found_html: event.target.value })} className="min-h-[100px] font-mono" />
					</FormField>
				</div>
			</CollapsibleContent></Collapsible>
		</section>
	);
}

function RouteEditor({
	route,
	candidate,
	defaultUnavailable,
	onChange,
	onRemove,
}: {
	route: HAProxyRoute;
	candidate?: HAProxyCandidate;
	defaultUnavailable: boolean;
	onChange: (route: HAProxyRoute) => void;
	onRemove: () => void;
}) {
	const { t } = useTranslation();
	if (route.source === "xray") {
		const matchers = candidate?.matchers.length ? candidate.matchers : [{ type: route.match_type, value: route.match_value || "" }];
		const availableTypes = new Set(matchers.map((matcher) => matcher.type));
		const values = Array.from(new Set(matchers.filter((matcher) => matcher.type === route.match_type).map((matcher) => matcher.value)));
		return (
			<div className="flex flex-col gap-3 rounded-lg border border-panel-border! bg-card/40 p-3">
				<div className="flex flex-row items-start justify-between gap-2">
					<div className="min-w-0">
						<div className="flex flex-row flex-wrap items-center gap-2">
							<p className="text-sm font-semibold">{route.name}</p>
							<Badge className="bg-blue-100 text-blue-800 hover:bg-blue-200 dark:bg-blue-500/20 dark:text-blue-200">Xray</Badge>
							<code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs">
								{route.match_type}
								{route.match_value ? `: ${route.match_value}` : ""}
							</code>
						</div>
						<p className="mt-1 text-xs text-muted-foreground">127.0.0.1:{route.backend_port} · {route.protocol}</p>
					</div>
					<Button aria-label={t("haproxy.removeRoute")} onClick={onRemove} variant="ghost" size="sm" className="size-8 p-0">
						<Trash2 className="w-[15px]" />
					</Button>
				</div>
				<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
					<FormField label={t("haproxy.matchType")}>
						<PanelSelect
							value={route.match_type}
							onValueChange={(value) => {
								const matcher = matchers.find((item) => item.type === String(value));
								if (matcher) onChange({ ...route, match_type: matcher.type, match_value: matcher.value });
							}}
							options={haproxyMatcherPriority.map((type) => ({
								value: type,
								label: type,
								disabled: !availableTypes.has(type) || (defaultUnavailable && type === "default"),
							}))}
						/>
					</FormField>
					<FormField label={t("haproxy.matchValue")}>
						{values.length > 1 ? (
							<PanelSelect value={route.match_value || ""} onValueChange={(value) => onChange({ ...route, match_value: String(value) })} options={values} />
						) : values[0] ? (
							<UiInput value={values[0]} readOnly />
						) : (
							<UiInput value={route.match_value || ""} placeholder={t("haproxy.matchValueRequired")} onChange={(event) => onChange({ ...route, match_value: event.target.value })} />
						)}
					</FormField>
				</div>
			</div>
		);
	}
	return (
		<div className="flex flex-col gap-3 rounded-lg border border-panel-border! bg-card/40 p-3">
			<div className="grid grid-cols-1 gap-3 md:grid-cols-5">
				<FormField label={t("haproxy.routeName")}>
					<UiInput value={route.name} onChange={(event) => onChange({ ...route, name: event.target.value })} />
				</FormField>
				<FormField label={t("haproxy.backendHost")}>
					<UiInput value={route.backend_host} onChange={(event) => onChange({ ...route, backend_host: event.target.value })} />
				</FormField>
				<FormField label={t("haproxy.backendPort")}>
					<NumberField inputMode="numeric" min={1} max={65535} value={numeric(route.backend_port)} doneLabel={t("common.done")} onChange={(raw) => onChange({ ...route, backend_port: Number(raw) })} />
				</FormField>
				<FormField label={t("haproxy.matchType")}>
					<PanelSelect
						value={route.match_type}
						onValueChange={(value) =>
							onChange({
								...route,
								match_type: String(value) as HAProxyRoute["match_type"],
								match_value: String(value) === "default" ? "" : route.match_value,
							})
						}
						options={haproxyMatcherPriority.map((type) => ({
							value: type,
							label: type,
							disabled: defaultUnavailable && type === "default",
						}))}
					/>
				</FormField>
				<div className="flex flex-row items-end gap-2">
					<FormField label={t("haproxy.matchValue")} className="min-w-0 flex-1">
						<UiInput
							value={route.match_value || ""}
							disabled={route.match_type === "default"}
							onChange={(event) => onChange({ ...route, match_value: event.target.value })}
						/>
					</FormField>
					<Button aria-label={t("haproxy.removeRoute")} onClick={onRemove} variant="ghost" size="sm" className="size-8 p-0">
						<Trash2 className="w-[15px]" />
					</Button>
				</div>
			</div>
		</div>
	);
}

export function AdvancedSettings({
	settings,
	update,
}: {
	settings: HAProxySettings;
	update: <K extends keyof HAProxySettings>(key: K, value: HAProxySettings[K]) => void;
}) {
	const { t } = useTranslation();
	const numberField = (key: keyof HAProxySettings, label: string, min: number, max: number) => (
		<FormField label={label}>
			<NumberField
				inputMode="numeric"
				min={min}
				max={max}
				value={numeric(settings[key] as number)}
				doneLabel={t("common.done")}
				onChange={(raw) => update(key, Number(raw) as never)}
			/>
		</FormField>
	);
	return (
		<div className="flex flex-col gap-5">
			<Alert className="rounded-xl">
				<TriangleAlert className="size-4" aria-hidden="true" />
				<p className="text-sm">{t("haproxy.advancedWarning")}</p>
			</Alert>
			<EditorPanel title={t("haproxy.connectionSettings")}>
				<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
					{numberField("max_connections", t("haproxy.maxConnections"), 128, 1000000)}
					{numberField("inspect_delay_ms", t("haproxy.inspectDelay"), 100, 30000)}
					{numberField("connect_timeout_ms", t("haproxy.connectTimeout"), 100, 60000)}
					{numberField("client_timeout_seconds", t("haproxy.clientTimeout"), 1, 86400)}
					{numberField("server_timeout_seconds", t("haproxy.serverTimeout"), 1, 86400)}
					{numberField("retries", t("haproxy.retries"), 0, 10)}
				</div>
			</EditorPanel>
			<EditorPanel title={t("haproxy.healthChecks")}>
				<ToggleRow title={t("haproxy.healthCheck")} checked={settings.health_check} onChange={(next) => update("health_check", next)} />
				<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
					{numberField("check_interval_ms", t("haproxy.checkInterval"), 100, 60000)}
					{numberField("check_rise", t("haproxy.checkRise"), 1, 10)}
					{numberField("check_fall", t("haproxy.checkFall"), 1, 10)}
				</div>
			</EditorPanel>
			<EditorPanel title={t("haproxy.loggingAndTCP")}>
				<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
					<FormField label={t("haproxy.logLevel")}>
						<PanelSelect
							value={settings.log_level}
							onValueChange={(value) => update("log_level", String(value))}
							options={["silent", "emerg", "alert", "crit", "err", "warning", "notice", "info", "debug"]}
						/>
					</FormField>
				</div>
				<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
					<ToggleRow title={t("haproxy.tcpKeepAlive")} checked={settings.tcp_keep_alive} onChange={(next) => update("tcp_keep_alive", next)} />
					<ToggleRow title={t("haproxy.dontLogNull")} checked={settings.dont_log_null} onChange={(next) => update("dont_log_null", next)} />
				</div>
			</EditorPanel>
		</div>
	);
}
