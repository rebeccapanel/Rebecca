import {
	Box,
	Button,
	Flex,
	HStack,
	Icon,
	Text,
	VStack,
} from "@chakra-ui/react";
import { ArrowUpTrayIcon, DocumentTextIcon } from "@heroicons/react/24/outline";
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
	isDisabled?: boolean;
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
	isDisabled = false,
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

	const handleDrop = (event: DragEvent<HTMLDivElement>) => {
		event.preventDefault();
		setIsDragging(false);
		if (isDisabled) {
			return;
		}
		selectFile(event.dataTransfer.files);
	};

	const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
		event.preventDefault();
		if (!isDisabled) {
			setIsDragging(true);
		}
	};

	const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
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

	const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			openFileDialog();
		}
	};

	return (
		<Box
			role="button"
			tabIndex={isDisabled ? -1 : 0}
			aria-disabled={isDisabled}
			borderWidth="1px"
			borderStyle="dashed"
			borderColor={isDragging ? "var(--rb-panel-accent)" : "panel.border"}
			borderRadius="20px"
			bg={isDragging ? "panel.elevated" : "panel.surface"}
			cursor={isDisabled ? "not-allowed" : "pointer"}
			opacity={isDisabled ? 0.55 : 1}
			px={{ base: 4, sm: 5 }}
			py={5}
			transition="background-color 0.18s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.18s cubic-bezier(0.16, 1, 0.3, 1)"
			_active={isDisabled ? undefined : { transform: "scale(0.995)" }}
			onClick={openFileDialog}
			onDragLeave={handleDragLeave}
			onDragOver={handleDragOver}
			onDrop={handleDrop}
			onKeyDown={handleKeyDown}
			_focusVisible={{
				outline: "2px solid var(--rb-panel-accent)",
				outlineOffset: "2px",
			}}
			_hover={
				isDisabled
					? undefined
					: {
							md: {
								borderColor: "panel.borderStrong",
								bg: "panel.elevated",
							},
						}
			}
		>
			<input
				ref={inputRef}
				type="file"
				accept={accept}
				multiple={multiple}
				disabled={isDisabled}
				onChange={handleInputChange}
				style={{ display: "none" }}
			/>
			<HStack spacing={4} align="center">
				<Flex
					w="44px"
					h="44px"
					align="center"
					justify="center"
					flexShrink={0}
					borderRadius="12px"
					bg={isDragging ? "panel.surface" : "panel.elevated"}
					color="panel.text"
					borderWidth="1px"
					borderColor="panel.border"
					transition="background-color 0.18s cubic-bezier(0.16, 1, 0.3, 1)"
				>
					<Icon
						as={hasSelection ? DocumentTextIcon : ArrowUpTrayIcon}
						boxSize="20px"
						color={
							hasSelection ? "var(--rb-panel-accent)" : "panel.textSecondary"
						}
					/>
				</Flex>
				<VStack align="stretch" spacing={0.5} minW={0} flex="1">
					<Text
						fontSize="13px"
						fontWeight="700"
						color="panel.text"
						noOfLines={1}
					>
						{selectedFiles?.length
							? `${selectedFiles.length} files selected`
							: selectedFile?.name || title}
					</Text>
					<Text fontSize="12px" color="panel.textMuted" noOfLines={2}>
						{selectedFile
							? formatFileSize(selectedFile.size)
							: description || emptyText}
					</Text>
				</VStack>
				<Button
					size="xs"
					h="30px"
					px={3}
					flexShrink={0}
					borderRadius="10px"
					borderWidth="1px"
					borderColor="panel.border"
					bg="panel.elevated"
					color="panel.text"
					fontSize="12px"
					fontWeight="600"
					transition="all 0.16s cubic-bezier(0.2, 0, 0, 1)"
					_hover={{
						md: {
							bg: "panel.surface",
							borderColor: "panel.borderStrong",
						},
					}}
					_active={{ transform: "scale(0.96)" }}
					tabIndex={-1}
					as="span"
				>
					{emptyText}
				</Button>
			</HStack>
		</Box>
	);
};
