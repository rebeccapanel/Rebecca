import { cn } from "lib/cn";
import { FileText, Upload } from "lucide-react";
import {
	type ChangeEvent,
	type DragEvent,
	type KeyboardEvent,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";

type FileDropzoneProps = {
	accept?: string;
	description?: ReactNode;
	emptyText: ReactNode;
	disabled?: boolean;
	multiple?: boolean;
	onFileSelect?: (file: File | null) => void;
	onFilesSelect?: (files: File[]) => void;
	selectedFiles?: File[];
	selectedFile?: File | null;
	title: ReactNode;
};

const formatFileSize = (size: number) => {
	if (!Number.isFinite(size) || size <= 0) {
		return "0 B";
	}
	const units = ["B", "KB", "MB", "GB"];
	let value = size;
	let unitIndex = 0;
	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024;
		unitIndex += 1;
	}
	return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
};

export const FileDropzone = ({
	accept,
	description,
	emptyText,
	disabled: isDisabled,
	multiple = false,
	onFileSelect,
	onFilesSelect,
	selectedFile,
	selectedFiles,
	title,
}: FileDropzoneProps) => {
	const inputRef = useRef<HTMLInputElement | null>(null);
	const [isDragging, setIsDragging] = useState(false);

	const hasSelection = selectedFiles
		? selectedFiles.length > 0
		: Boolean(selectedFile);

	useEffect(() => {
		if (!hasSelection && inputRef.current) {
			inputRef.current.value = "";
		}
	}, [hasSelection]);

	const selectFile = (fileList: FileList | null) => {
		if (multiple) {
			const files = Array.from(fileList ?? []);
			if (inputRef.current) {
				inputRef.current.value = "";
			}
			onFilesSelect?.(files);
			return;
		}
		onFileSelect?.(fileList?.[0] ?? null);
	};

	const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
		selectFile(event.target.files);
	};

	const handleDrop = (event: DragEvent<HTMLButtonElement>) => {
		event.preventDefault();
		setIsDragging(false);
		if (isDisabled) return;
		selectFile(event.dataTransfer.files);
	};

	const handleDragOver = (event: DragEvent<HTMLButtonElement>) => {
		event.preventDefault();
		if (!isDisabled) {
			setIsDragging(true);
		}
	};

	const handleDragLeave = (event: DragEvent<HTMLButtonElement>) => {
		if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
			return;
		}
		setIsDragging(false);
	};

	const openFileDialog = () => {
		if (!isDisabled) {
			inputRef.current?.click();
		}
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			openFileDialog();
		}
	};

	return (
		<button
			type="button"
			disabled={isDisabled}
			onClick={openFileDialog}
			onDragLeave={handleDragLeave}
			onDragOver={handleDragOver}
			onDrop={handleDrop}
			onKeyDown={handleKeyDown}
			className={cn(
				"w-full rounded-[14px] border border-dashed px-4 py-4 text-start transition-[background-color,border-color,opacity] duration-150 focus-visible:outline-2 focus-visible:outline-panel-accent",
				isDragging
					? "border-panel-accent bg-panel-accent/10"
					: "border-panel-border bg-panel-elevated/45",
				!isDisabled &&
					"min-[769px]:hover:border-panel-accent/70 min-[769px]:hover:bg-panel-elevated/80 cursor-pointer",
				isDisabled && "cursor-not-allowed opacity-55",
			)}
		>
			<input
				ref={inputRef}
				type="file"
				accept={accept}
				multiple={multiple}
				disabled={isDisabled}
				onChange={handleInputChange}
				className="hidden"
			/>
			<div className="flex flex-row items-center gap-3.5">
				<span
					className={cn(
						"flex size-10 shrink-0 items-center justify-center rounded-[10px] border",
						hasSelection || isDragging
							? "border-panel-accent/40 bg-panel-accent/12 text-panel-accent"
							: "border-panel-border bg-panel-surface text-panel-text-muted",
					)}
				>
					{hasSelection ? (
						<FileText className="size-5" aria-hidden="true" />
					) : (
						<Upload className="size-5" aria-hidden="true" />
					)}
				</span>
				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
					<p className="truncate text-[13px] font-semibold text-panel-text">
						{selectedFile?.name || title}
					</p>
					<p className="line-clamp-2 text-[11px] text-panel-text-muted">
						{selectedFile
							? formatFileSize(selectedFile.size)
							: description || emptyText}
					</p>
				</div>
				<span
					className={cn(
						"shrink-0 whitespace-nowrap rounded-[8px] border px-2.5 py-1 text-[11px] font-semibold",
						isDisabled
							? "border-panel-border text-panel-text-muted"
							: "border-panel-border bg-panel-surface text-panel-accent",
					)}
				>
					{emptyText}
				</span>
			</div>
		</button>
	);
};
