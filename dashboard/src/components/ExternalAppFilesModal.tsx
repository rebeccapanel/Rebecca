import { Dialog, DialogContent, DialogHeader } from "components/ui/dialog";
import { Button } from "components/ui/button";
import { Alert } from "components/ui/alert";
import { Spinner } from "components/ui/spinner";
import { toast } from "components/ui/sonner";
import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import { ArrowLeft, Code, FilePlus, FolderOpen } from "lucide-react";
import { useColorMode } from "lib/color-mode";

import { cn } from "lib/cn";
import { FileManager, type FileManagerFile } from "@cubone/react-file-manager";
import "@cubone/react-file-manager/dist/style.css";
import "ace-builds/src-noconflict/ace";
import AceEditor from "react-ace";
import "ace-builds/src-noconflict/ext-language_tools";
import "ace-builds/src-noconflict/mode-css";
import "ace-builds/src-noconflict/mode-golang";
import "ace-builds/src-noconflict/mode-html";
import "ace-builds/src-noconflict/mode-ini";
import "ace-builds/src-noconflict/mode-java";
import "ace-builds/src-noconflict/mode-javascript";
import "ace-builds/src-noconflict/mode-json";
import "ace-builds/src-noconflict/mode-markdown";
import "ace-builds/src-noconflict/mode-php";
import "ace-builds/src-noconflict/mode-python";
import "ace-builds/src-noconflict/mode-rust";
import "ace-builds/src-noconflict/mode-sh";
import "ace-builds/src-noconflict/mode-sql";
import "ace-builds/src-noconflict/mode-text";
import "ace-builds/src-noconflict/mode-typescript";
import "ace-builds/src-noconflict/mode-xml";
import "ace-builds/src-noconflict/mode-yaml";
import "ace-builds/src-noconflict/theme-github";
import "ace-builds/src-noconflict/theme-monokai";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	createExternalAppFolder,
	deleteExternalAppFiles,
	getExternalAppPHPConfig,
	getExternalAppFile,
	getExternalAppFiles,
	moveExternalAppFile,
	externalAppFileDownloadURL,
	externalAppFileUploadURL,
	saveExternalAppPHPConfig,
	saveExternalAppFile,
	type ExternalAppRecord,
} from "service/settings";
import "./ExternalAppFilesModal.css";

type EditorKind = "file" | "php-config";

interface EditorDocument {
	kind: EditorKind;
	path: string;
	content: string;
}

interface Props {
	app: ExternalAppRecord | null;
	initialView?: EditorKind;
	onClose: () => void;
}

const joinPath = (parent: string, name: string) =>
	`${parent === "/" || !parent ? "" : parent}/${name}`.replace(/\/+/g, "/");

const parentPath = (value: string) => {
	const parts = value.split("/").filter(Boolean);
	parts.pop();
	return parts.length ? `/${parts.join("/")}` : "/";
};

export const editorModeForPath = (value: string) => {
	const extension = value.split(".").pop()?.toLowerCase() || "";
	return (
		{
			php: "php",
			phtml: "php",
			html: "html",
			htm: "html",
			css: "css",
			js: "javascript",
			jsx: "javascript",
			mjs: "javascript",
			ts: "typescript",
			tsx: "typescript",
			json: "json",
			yaml: "yaml",
			yml: "yaml",
			sh: "sh",
			bash: "sh",
			py: "python",
			sql: "sql",
			xml: "xml",
			md: "markdown",
			go: "golang",
			java: "java",
			rs: "rust",
			conf: "ini",
			ini: "ini",
		}[extension] || "text"
	);
};

export const ExternalAppFilesModal = ({
	app,
	initialView = "file",
	onClose,
}: Props) => {
	const { t, i18n } = useTranslation();
	const { colorMode } = useColorMode();
	const modalBg = "bg-white dark:bg-gray-900";
	
	const [folder, setFolder] = useState("/");
	const [document, setDocument] = useState<EditorDocument | null>(null);
	const [draft, setDraft] = useState("");
	const [loadingDocument, setLoadingDocument] = useState(false);
	const domain = app?.domain || "";
	const appID = app?.id || "";
	const isPHPConfigView = initialView === "php-config";
	const filesQuery = useQuery({ queryKey: ["external-app-files", appID], queryFn: () => getExternalAppFiles(appID), enabled: Boolean(appID) && !isPHPConfigView,
			refetchOnWindowFocus: false, });
	const isDirty = document !== null && draft !== document.content;

	const showError = useCallback(
		(error: unknown) => {
			const candidate = error as {
				data?: { detail?: string };
				response?: { _data?: { detail?: string } };
				message?: string;
			};
			toast.error(t("externalApps.files.actionFailed"), { description: candidate?.data?.detail ||
					candidate?.response?._data?.detail ||
					candidate?.message ||
					String(error) });
		},
		[t, toast],
	);

	const refreshFiles = useCallback(async () => {
		await filesQuery.refetch();
	}, [filesQuery.refetch]);

	const fileMutation = useMutation({ mutationFn: (action: () => Promise<unknown>) => action(), onSettled: refreshFiles, onError: showError });

	const openFile = useCallback(
		async (path: string, discardConfirmed = false) => {
			if (!app) return;
			if (
				isDirty &&
				!discardConfirmed &&
				!window.confirm(t("externalApps.files.discardConfirm"))
			)
				return;
			setLoadingDocument(true);
			try {
				const result = await getExternalAppFile(app.id, path);
				setDocument({
					kind: "file",
					path: result.path,
					content: result.content,
				});
				setDraft(result.content);
			} catch (error) {
				showError(error);
			} finally {
				setLoadingDocument(false);
			}
		},
		[app, isDirty, showError, t],
	);

	useEffect(() => {
		let cancelled = false;
		setFolder("/");
		setDocument(null);
		setDraft("");
		setLoadingDocument(false);
		if (!appID || app?.runtime !== "php" || initialView !== "php-config") {
			return;
		}
		setLoadingDocument(true);
		getExternalAppPHPConfig(appID)
			.then((result) => {
				if (cancelled) return;
				setDocument({
					kind: "php-config",
					path: result.path,
					content: result.content,
				});
				setDraft(result.content);
			})
			.catch((error) => {
				if (!cancelled) showError(error);
			})
			.finally(() => {
				if (!cancelled) setLoadingDocument(false);
			});
		return () => {
			cancelled = true;
		};
	}, [app?.runtime, appID, initialView, showError]);

	const saveMutation = useMutation({ mutationFn: async () => {
			if (!app || !document) return;
			if (document.kind === "php-config") {
				await saveExternalAppPHPConfig({ domain: app.id, content: draft });
			} else {
				await saveExternalAppFile({
					domain: app.id,
					path: document.path,
					content: draft,
				});
			}
		}, onSuccess: async () => {
				setDocument((current) =>
					current ? { ...current, content: draft } : current,
				);
				if (document?.kind === "file") await refreshFiles();
				toast.success(t("externalApps.files.saved"));
			},
			onError: showError, });

	const close = () => {
		if (isDirty && !window.confirm(t("externalApps.files.discardConfirm")))
			return;
		onClose();
	};
	const closeDocument = () => {
		if (isDirty && !window.confirm(t("externalApps.files.discardConfirm")))
			return;
		setDocument(null);
		setDraft("");
	};

	const createFile = () => {
		if (!app) return;
		if (isDirty && !window.confirm(t("externalApps.files.discardConfirm")))
			return;
		const name = window.prompt(t("externalApps.files.newFilePrompt"))?.trim();
		if (!name) return;
		const path = joinPath(folder, name);
		fileMutation.mutate(async () => {
			await saveExternalAppFile({ domain: app.id, path, content: "" });
			await openFile(path, true);
		});
	};

	const downloadFiles = (files: FileManagerFile[]) => {
		if (!app) return;
		const file = files.find((item) => !item.isDirectory);
		if (!file || files.length !== 1) {
			showError(new Error(t("externalApps.files.downloadOne")));
			return;
		}
		const anchor = window.document.createElement("a");
		anchor.href = externalAppFileDownloadURL(app.id, file.path);
		anchor.download = file.name;
		anchor.click();
	};

	return (
		<Dialog open={Boolean(app)} onOpenChange={(open) => { if (!open) (close)(); }}>
			
			<DialogContent className={cn("h-[100dvh] max-h-[100dvh]", modalBg)}>
				<DialogHeader className="px-3 md:px-6 py-3 md:py-4">
					<div className="flex items-center gap-3 pe-10 min-w-0!">
						{isPHPConfigView ? (
							<Code className="w-[22px]" />
						) : (
							<FolderOpen className="w-[22px]" />
						)}
						<p className="truncate min-w-0!">
							{t(
								isPHPConfigView
									? "externalApps.files.phpConfigTitle"
									: "externalApps.files.title",
								{ domain },
							)}
						</p>
						{document ? (
							<code className="truncate rounded-xs bg-gray-100 px-[0.2em] py-[0.1em] font-mono dark:bg-whiteAlpha-200 text-[0.75rem] max-w-[45%] hidden md:block">
								{document.path}
							</code>
						) : null}
					</div>
				</DialogHeader>
				
				<div className={cn("px-5 py-4 overflow-y-auto", "flex min-h-0 overflow-hidden px-2 md:px-4 pb-2 md:pb-4")}>
					<div className="flex gap-4 flex-1 min-h-0 min-w-0! w-full">
						{!isPHPConfigView ? (
							<div className={cn("flex-1 min-w-0! min-h-0 lg:flex flex-col", document ? "hidden" : "flex")}>
								<div className="flex-1 min-h-0 min-w-0! external-app-files-shell">
									<Button title={t("externalApps.files.newFile")} aria-label={t("externalApps.files.newFile")} disabled={fileMutation.isPending} onClick={createFile} variant="ghost" size="sm" className="external-app-files-new-file">{<FilePlus className="w-[18px]" />}
										<span className="external-app-files-new-file-label">
											{t("externalApps.files.newFile")}
										</span>
									</Button>
									<FileManager files={filesQuery.data?.files ?? []} collapsibleNav enableFilePreview={false} fileUploadConfig={{
											url: externalAppFileUploadURL(appID),
											method: "POST",
											withCredentials: true,
										}} loading={filesQuery.isPending || fileMutation.isPending} language={
											i18n.language.startsWith("fa") ? "fa-IR" : "en-US"
										} layout="list" maxFileSize={32 << 20} onCreateFolder={(name, parent) =>
											fileMutation.mutate(() =>
												createExternalAppFolder({
													domain: appID,
													path: joinPath(parent?.path || "/", name),
												}),
											)
										} onDelete={(files) =>
											fileMutation.mutate(() =>
												deleteExternalAppFiles({
													domain: appID,
													paths: files.map((file) => file.path),
												}),
											)
										} onDownload={downloadFiles} onError={(error) => showError(new Error(error.message))} onFileOpen={(file) => {
											if (!file.isDirectory) void openFile(file.path);
										}} onFileUploaded={() => void refreshFiles()} onFileUploading={(_file, parent) => ({
											parent: parent?.path || "/",
										})} onFolderChange={(path) => setFolder(path || "/")} onPaste={(files, destination, operation) => {
											if (operation !== "move") return;
											fileMutation.mutate(async () => {
												for (const file of files) {
													await moveExternalAppFile({
														domain: appID,
														path: file.path,
														new_path: joinPath(
															destination.path || "/",
															file.name,
														),
													});
												}
											});
										}} onRefresh={() => void refreshFiles()} onRename={(file, newName) =>
											fileMutation.mutate(() =>
												moveExternalAppFile({
													domain: appID,
													path: file.path,
													new_path: joinPath(parentPath(file.path), newName),
												}),
											)
										} permissions={{ copy: false }} primaryColor="#4299e1" className={cn("h-full", `external-app-files external-app-files--new-file-visible${
											colorMode === "dark" ? " external-app-files--dark" : ""
										}`)} />
								</div>
							</div>
						) : null}
						<div className={cn("flex-1 min-w-0! min-h-0 flex-col", isPHPConfigView ? "flex" : `${document ? "flex" : "hidden"} lg:flex`)}>
							{document?.kind === "php-config" ? (
								<Alert className="mb-2 rounded-md py-2">
									<TriangleAlert className="size-4" aria-hidden="true" />
									<p className="text-[0.875rem]">
										{t("externalApps.files.phpConfigHint")}
									</p>
								</Alert>
							) : null}
							<div className="flex justify-between items-center gap-2 mb-2 min-h-[32px]">
								{!isPHPConfigView ? (
									<Button onClick={closeDocument} size="sm" className="inline-flex lg:hidden">{<ArrowLeft className="w-[16px]" />}
										{t("externalApps.files.backToFiles")}
									</Button>
								) : null}
								<p className="flex-1 min-w-0! text-[0.875rem] text-panel-text-secondary truncate">
									{document?.path || t("externalApps.files.openHint")}
								</p>
								<Button disabled={!document || !isDirty} onClick={() => saveMutation.mutate()} size="sm" loading={saveMutation.isPending} className="bg-blue-600 text-white shadow-xs hover:bg-blue-700">
									{t("externalApps.files.save")}
								</Button>
							</div>
							<div className="flex-1 min-h-0 relative">
								{loadingDocument ? (
									<div className="flex absolute inset-0 items-center justify-center z-[1] bg-blackAlpha-400">
										<Spinner />
									</div>
								) : null}
								{document ? (
									<AceEditor name={
											isPHPConfigView
												? "external-app-php-editor"
												: "external-app-editor"
										} mode={
											document.kind === "php-config"
												? "ini"
												: editorModeForPath(document.path)
										} theme={colorMode === "dark" ? "monokai" : "github"} value={draft} onChange={setDraft} setOptions={{
											enableBasicAutocompletion: true,
											enableLiveAutocompletion: true,
											showPrintMargin: false,
											useWorker: false,
										}} className="w-full h-full text-[14px]" />
								) : (
									<div className="flex h-full items-center justify-center px-6">
										<p className="text-panel-text-secondary text-center">
											{t("externalApps.files.openHint")}
										</p>
									</div>
								)}
							</div>
						</div>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
};
