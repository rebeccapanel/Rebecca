import { Button } from "components/ui/button";
import { Textarea } from "components/ui/textarea";
import { toast } from "components/ui/sonner";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";


import { PanelSelect } from "components/common/PanelSelect";
import { JsonEditor } from "components/JsonEditor";
import { CheckRow } from "components/ui/check-row";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "components/ui/dialog";
import { FormField } from "components/ui/form-field";
import { Input as UiInput } from "components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "components/ui/tabs";
import { Network, Upload, Copy, Plus } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
	type HAProxyCertificate,
	type HAProxyConfig,
	type HAProxyNode,
	type HAProxySettings,
	type HAProxyTarget,
	type HAProxyTemplate,
	cloneHAProxyTargetForNode,
	getHAProxyCandidates,
	previewHAProxyConfig,
	uploadHAProxyTemplate,
} from "service/haproxy";
import { AdvancedSettings, EditorPanel, TargetEditor, ToggleRow } from "./HAProxyEditors";
import { emptyListener, errorText } from "./helpers";

const requiredLabel = (text: ReactNode) => (
	<span>
		{text} <span className="text-red-500">*</span>
	</span>
);

export type HAProxyDialogProps = {
	open: boolean;
	onClose: () => void;
	draft: HAProxyConfig;
	setDraft: (config: HAProxyConfig) => void;
	nodes: HAProxyNode[];
	templates: HAProxyTemplate[];
	uploadedTemplates: HAProxyTemplate[];
	certificates: HAProxyCertificate[];
	onSave: () => void;
	isSaving: boolean;
};

const dialogShell =
	"flex max-h-[min(860px,calc(100dvh-4rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl max-md:inset-x-3 max-md:w-auto max-md:top-[4.5rem] max-md:bottom-24 max-md:max-h-none max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0";

export function HAProxyDialog({
	open: isOpen,
	onClose,
	draft,
	setDraft,
	nodes,
	templates,
	uploadedTemplates,
	certificates,
	onSave,
	isSaving,
}: HAProxyDialogProps) {
	const { t } = useTranslation();
	
	const queryClient = useQueryClient();
	const [activeTab, setActiveTab] = useState("form");
	const [targetOption, setTargetOption] = useState("");
	const [preview, setPreview] = useState<HAProxyConfig | null>(null);
	const [archive, setArchive] = useState<File | null>(null);
	const [archiveName, setArchiveName] = useState("");
	const [expandedTargets, setExpandedTargets] = useState<Set<number>>(new Set());
	const [cloningNodeID, setCloningNodeID] = useState(0);
	const [cloneSource, setCloneSource] = useState<HAProxyTarget | null>(null);
	const [cloneAllNodes, setCloneAllNodes] = useState(true);
	const [cloneNodeIDs, setCloneNodeIDs] = useState<Set<number>>(new Set());
	const [randomizeTemplates, setRandomizeTemplates] = useState(false);
	const previewMutation = useMutation({
		mutationFn: previewHAProxyConfig,
		onSuccess: setPreview,
		onError: (error) => {
			toast.error(errorText(error));
		},
	});
	const upload = useMutation({
		mutationFn: () => uploadHAProxyTemplate(archiveName || archive?.name || "template", archive as File),
		onSuccess: async () => {
			setArchive(null);
			setArchiveName("");
			await queryClient.invalidateQueries({ queryKey: ["haproxy-overview"] });
			toast.success(t("haproxy.templateUploaded"));
		},
		onError: (error) => {
			toast.error(errorText(error));
		},
	});
	const availableNodes = nodes.filter(
		(node) =>
			!draft.targets.some((target) => target.node_id === node.id) &&
			(!node.haproxy_config_id || node.haproxy_config_id === draft.id),
	);
	const firstTargetID = draft.targets[0]?.node_id;
	useEffect(() => {
		if (isOpen) {
			setActiveTab("form");
			setExpandedTargets(new Set(firstTargetID ? [firstTargetID] : []));
		}
	}, [isOpen, firstTargetID]);
	const updateSettings = <K extends keyof HAProxySettings>(key: K, value: HAProxySettings[K]) =>
		setDraft({ ...draft, settings: { ...draft.settings, [key]: value } });
	const addTarget = () => {
		const nodeID = Number(targetOption);
		if (!nodeID) return;
		setDraft({
			...draft,
			targets: [...draft.targets, { node_id: nodeID, listeners: [emptyListener(0)] }],
		});
		setTargetOption("");
		setExpandedTargets((current) => new Set(current).add(nodeID));
	};
	const cloneTarget = async (source: HAProxyTarget, randomize: boolean, destinationNodeIDs: number[]) => {
		const destinations = availableNodes.filter(
			(node) => node.status !== "disabled" && destinationNodeIDs.includes(node.id),
		);
		if (destinations.length === 0) {
			toast.warning(t("haproxy.noCloneTargets"));
			return;
		}
		setCloningNodeID(source.node_id);
		const results = await Promise.all(
			destinations.map(async (node) => {
				try {
					const { candidates } = await getHAProxyCandidates(node.id);
					return {
						node,
						...cloneHAProxyTargetForNode(source, node.id, candidates, templates, randomize),
					};
				} catch {
					return { node, target: undefined, missingInbounds: [] as string[], failed: true };
				}
			}),
		);
		setCloningNodeID(0);
		const targets = results.flatMap((result) => (result.target ? [result.target] : []));
		if (targets.length) {
			setDraft({ ...draft, targets: [...draft.targets, ...targets] });
		}
		const skipped = results.filter((result) => !result.target);
		const details = skipped
			.slice(0, 5)
			.map((result) =>
				result.failed
					? t("haproxy.cloneInspectFailed", { node: result.node.name })
					: t("haproxy.cloneMissingInbound", {
							node: result.node.name,
							inbound: result.missingInbounds.join(", "),
						}),
			)
			.join("\n");
		toast(targets.length ? t("haproxy.cloneSuccess", { count: targets.length }) : t("haproxy.cloneNone"), { description: details || undefined, duration: skipped.length ? 9000 : 4000 });
		setCloneSource(null);
	};
	const cloneCandidates = availableNodes.filter((node) => node.status !== "disabled");
	const openCloneDialog = (source: HAProxyTarget) => {
		setCloneSource(source);
		setCloneAllNodes(true);
		setCloneNodeIDs(new Set());
		setRandomizeTemplates(false);
	};
	const handleTabChange = (value: string) => {
		setActiveTab(value);
		if (value === "editor") previewMutation.mutate(draft);
	};

	return (
		<>
			<Dialog open={isOpen} onOpenChange={(next) => { if (!next) onClose(); }}>
				<DialogContent className={dialogShell}>
					<DialogHeader className="flex-row items-center gap-3 border-b px-5 py-3.5 pe-12 text-start sm:text-start">
						<div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
							<Network className="size-4" />
						</div>
						<div className="min-w-0">
							<DialogTitle className="truncate text-base">
								{draft.id ? t("haproxy.editConfig") : t("haproxy.create")}
							</DialogTitle>
							<DialogDescription className="truncate">{draft.name || "HAProxy"}</DialogDescription>
						</div>
					</DialogHeader>

					<Tabs value={activeTab} onValueChange={handleTabChange} className="flex min-h-0 flex-1 flex-col">
						<div className="border-b px-5 pt-2.5 pb-2.5">
							<TabsList className="w-full">
								<TabsTrigger value="form">{t("haproxy.form")}</TabsTrigger>
								<TabsTrigger value="advanced">{t("haproxy.advanced")}</TabsTrigger>
								<TabsTrigger value="editor">{t("haproxy.editor")}</TabsTrigger>
								<TabsTrigger value="json">{t("haproxy.json")}</TabsTrigger>
							</TabsList>
						</div>
						<div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
							<TabsContent value="form" className="mt-0">
								<div className="flex flex-col gap-5">
									<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
										<FormField label={requiredLabel(t("haproxy.name"))}>
											<UiInput value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
										</FormField>
										<ToggleRow
											title={t("haproxy.enabled")}
											hint={t("haproxy.enabledHelp")}
											checked={draft.enabled}
											onChange={(next) => setDraft({ ...draft, enabled: next })}
										/>
									</div>
									<div className="flex flex-col gap-3 rounded-lg border bg-card/40 p-3 text-sm text-muted-foreground">
										{t("haproxy.matcherNotice")}
									</div>
									<div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
										<FormField label={t("haproxy.targetNode")}>
											<PanelSelect
												value={targetOption}
												onValueChange={(value) => setTargetOption(String(value))}
												options={availableNodes.map((node) => ({
													value: String(node.id),
													disabled: node.status === "disabled",
													searchLabel: `${node.name} ${node.status}`,
													label: (
														<div className="flex flex-row items-center gap-2">
															<p>{node.name || t("haproxy.nodeFallback", { id: node.id })}</p>
															<p className="text-xs text-muted-foreground">
																{node.status === "disabled" ? t("haproxy.disabledNode") : node.status}
															</p>
														</div>
													),
												}))}
												placeholder={t("haproxy.selectNode")}
											/>
										</FormField>
										<Button onClick={addTarget} disabled={!targetOption}>
											<Plus className="w-[16px]" />
											{t("haproxy.addTarget")}
										</Button>
									</div>
									{draft.targets.map((target, targetIndex) => (
										<TargetEditor
											key={target.node_id}
											target={target}
											node={nodes.find((node) => node.id === target.node_id)}
											templates={templates}
											uploadedTemplates={uploadedTemplates}
											certificates={certificates}
											expanded={expandedTargets.has(target.node_id)}
											isCloning={cloningNodeID === target.node_id}
											canClone={availableNodes.some((node) => node.status !== "disabled")}
											onExpandedChange={(expanded) =>
												setExpandedTargets((current) => {
													const next = new Set(current);
													if (expanded) next.add(target.node_id);
													else next.delete(target.node_id);
													return next;
												})
											}
											onClone={() => openCloneDialog(target)}
											onChange={(next) =>
												setDraft({
													...draft,
													targets: draft.targets.map((item, index) => (index === targetIndex ? next : item)),
												})
											}
											onRemove={() =>
												setDraft({
													...draft,
													targets: draft.targets.filter((_, index) => index !== targetIndex),
												})
											}
										/>
									))}
									{draft.targets.length === 0 ? (
										<p className="py-8 text-center text-sm text-muted-foreground">{t("haproxy.noTargets")}</p>
									) : null}
									<EditorPanel title={t("haproxy.uploadTemplate")} description={t("haproxy.uploadHelp")}>
										<div className="grid grid-cols-1 items-end gap-3 md:grid-cols-3">
											<FormField label={t("haproxy.templateName")}>
												<UiInput value={archiveName} onChange={(event) => setArchiveName(event.target.value)} />
											</FormField>
											<FormField label={t("haproxy.zipArchive")}>
												<UiInput type="file" accept=".zip,application/zip" onChange={(event) => setArchive(event.target.files?.[0] ?? null)} className="pt-1.5" />
											</FormField>
											<Button disabled={!archive} onClick={() => upload.mutate()} loading={upload.isPending}>
												<Upload className="w-[16px]" />
												{t("upload")}
											</Button>
										</div>
									</EditorPanel>
								</div>
							</TabsContent>
							<TabsContent value="advanced" className="mt-0">
								<AdvancedSettings settings={draft.settings} update={updateSettings} />
							</TabsContent>
							<TabsContent value="editor" className="mt-0">
								<div className="flex flex-col gap-4">
									<div className="flex flex-row items-center justify-between gap-2">
										<p className="text-sm text-muted-foreground">{t("haproxy.editorHelp")}</p>
										<Button onClick={() => previewMutation.mutate(draft)} size="sm" loading={previewMutation.isPending}>
											{t("refresh")}
										</Button>
									</div>
									{preview?.targets.map((target) => (
										<div key={target.node_id} className="flex flex-col gap-2">
											<h2 className="text-sm font-semibold">{nodes.find((node) => node.id === target.node_id)?.name || target.node_id}</h2>
											<Textarea value={target.generated_config || ""} readOnly className="min-h-[420px] whitespace-pre font-mono text-xs" />
										</div>
									))}
									{!preview && !previewMutation.isPending ? (
										<p className="py-12 text-center text-sm text-muted-foreground">{t("haproxy.previewEmpty")}</p>
									) : null}
								</div>
							</TabsContent>
							<TabsContent value="json" className="mt-0">
								<div className="flex flex-col gap-3">
									<p className="text-sm text-muted-foreground">{t("haproxy.jsonHelp")}</p>
									<JsonEditor json={draft} onChange={() => undefined} readOnly minHeight="520px" />
								</div>
							</TabsContent>
						</div>
					</Tabs>

					<DialogFooter className="flex-row flex-wrap items-center justify-end gap-2 border-t px-5 py-3">
						<Button onClick={onClose} variant="outline" size="sm">
							{t("cancel")}
						</Button>
						<Button onClick={onSave} disabled={!draft.name.trim() || draft.targets.length === 0} size="sm" loading={isSaving}>
							{t("save")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog open={Boolean(cloneSource)} onOpenChange={(next) => { if (!next && !cloningNodeID) setCloneSource(null); }}>
				<DialogContent className="flex flex-col gap-0 overflow-hidden p-0 sm:max-w-lg max-md:inset-x-3 max-md:w-auto max-md:translate-x-0 max-md:translate-y-0">
					<DialogHeader className="flex-row items-center gap-3 border-b px-5 py-3.5 pe-12 text-start sm:text-start">
						<div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
							<Copy className="size-4" />
						</div>
						<div className="min-w-0">
							<DialogTitle className="truncate text-base">{t("haproxy.cloneDialogTitle")}</DialogTitle>
						</div>
					</DialogHeader>
					<div className="flex max-h-[min(520px,calc(100dvh-14rem))] flex-col gap-3 overflow-y-auto px-5 py-4">
						<CheckRow checked={randomizeTemplates} onChange={(next) => setRandomizeTemplates(next)}>
							{t("haproxy.randomizeTemplates")}
						</CheckRow>
						<CheckRow checked={cloneAllNodes} onChange={(next) => setCloneAllNodes(next)}>
							{t("haproxy.cloneAllAvailableNodes")}
						</CheckRow>
						{!cloneAllNodes ? (
							<div className="flex flex-col gap-2 rounded-lg border p-3">
								<p className="mb-1 text-sm font-semibold">{t("haproxy.cloneChooseNodes")}</p>
								{cloneCandidates.map((node) => (
									<CheckRow
										key={node.id}
										checked={cloneNodeIDs.has(node.id)}
										onChange={(next) =>
											setCloneNodeIDs((current) => {
												const next2 = new Set(current);
												if (next) next2.add(node.id);
												else next2.delete(node.id);
												return next2;
											})
										}
									>
										{node.name || t("haproxy.nodeFallback", { id: node.id })}
									</CheckRow>
								))}
							</div>
						) : null}
					</div>
					<DialogFooter className="flex-row flex-wrap items-center justify-end gap-2 border-t px-5 py-3">
						<Button onClick={() => setCloneSource(null)} disabled={Boolean(cloningNodeID)} variant="outline" size="sm">
							{t("cancel")}
						</Button>
						<Button disabled={!cloneSource || cloneCandidates.length === 0 || (!cloneAllNodes && cloneNodeIDs.size === 0)} onClick={() =>
								cloneSource &&
								cloneTarget(
									cloneSource,
									randomizeTemplates,
									cloneAllNodes ? cloneCandidates.map((node) => node.id) : [...cloneNodeIDs],
								)
							} size="sm" loading={Boolean(cloningNodeID)}>
							<Copy className="w-[16px]" />
							{t("haproxy.clone")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

