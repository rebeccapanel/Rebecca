declare module "@cubone/react-file-manager" {
	import type { CSSProperties, FC, ReactNode } from "react";

	export interface FileManagerFile {
		name: string;
		isDirectory: boolean;
		path: string;
		updatedAt?: string;
		size?: number;
	}

	interface FileManagerProps {
		files: FileManagerFile[];
		className?: string;
		collapsibleNav?: boolean;
		defaultNavExpanded?: boolean;
		enableFilePreview?: boolean;
		filePreviewComponent?: (file: FileManagerFile) => ReactNode;
		fileUploadConfig?: {
			url: string;
			method?: "POST" | "PUT";
			headers?: Record<string, string>;
			withCredentials?: boolean;
		};
		height?: string | number;
		initialPath?: string;
		isLoading?: boolean;
		language?: string;
		layout?: "list" | "grid";
		maxFileSize?: number;
		onCreateFolder?: (name: string, parent: FileManagerFile) => void;
		onDelete?: (files: FileManagerFile[]) => void;
		onDownload?: (files: FileManagerFile[]) => void;
		onError?: (
			error: { type: string; message: string },
			file: FileManagerFile,
		) => void;
		onFileOpen?: (file: FileManagerFile) => void;
		onFileUploaded?: (response: unknown) => void;
		onFileUploading?: (
			file: globalThis.File,
			parent: FileManagerFile,
		) => Record<string, string>;
		onFolderChange?: (path: string) => void;
		onPaste?: (
			files: FileManagerFile[],
			destination: FileManagerFile,
			operation: "copy" | "move",
		) => void;
		onRefresh?: () => void;
		onRename?: (file: FileManagerFile, newName: string) => void;
		permissions?: Partial<
			Record<
				| "create"
				| "upload"
				| "move"
				| "copy"
				| "rename"
				| "download"
				| "delete",
				boolean
			>
		>;
		primaryColor?: string;
		style?: CSSProperties;
		width?: string | number;
	}

	export const FileManager: FC<FileManagerProps>;
}
