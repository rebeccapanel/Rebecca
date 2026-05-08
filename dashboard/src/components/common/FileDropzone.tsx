import {
	Box,
	HStack,
	Icon,
	Text,
	useColorModeValue,
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
	onFileSelect: (file: File | null) => void;
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
	onFileSelect,
	selectedFile,
	title,
}: FileDropzoneProps) => {
	const inputRef = useRef<HTMLInputElement | null>(null);
	const [isDragging, setIsDragging] = useState(false);
	const borderColor = useColorModeValue("blackAlpha.300", "whiteAlpha.300");
	const activeBorderColor = useColorModeValue("primary.500", "primary.300");
	const bg = useColorModeValue("blackAlpha.50", "whiteAlpha.50");
	const activeBg = useColorModeValue("primary.50", "whiteAlpha.100");
	const iconBg = useColorModeValue("white", "whiteAlpha.100");
	const mutedColor = useColorModeValue("gray.500", "gray.400");

	useEffect(() => {
		if (!selectedFile && inputRef.current) {
			inputRef.current.value = "";
		}
	}, [selectedFile]);

	const selectFile = (fileList: FileList | null) => {
		onFileSelect(fileList?.[0] ?? null);
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
			borderColor={isDragging ? activeBorderColor : borderColor}
			borderRadius="md"
			bg={isDragging ? activeBg : bg}
			cursor={isDisabled ? "not-allowed" : "pointer"}
			opacity={isDisabled ? 0.55 : 1}
			px={4}
			py={4}
			transition="all 0.15s ease"
			onClick={openFileDialog}
			onDragLeave={handleDragLeave}
			onDragOver={handleDragOver}
			onDrop={handleDrop}
			onKeyDown={handleKeyDown}
			_hover={
				isDisabled
					? undefined
					: {
							borderColor: activeBorderColor,
							bg: activeBg,
						}
			}
		>
			<input
				ref={inputRef}
				type="file"
				accept={accept}
				disabled={isDisabled}
				onChange={handleInputChange}
				style={{ display: "none" }}
			/>
			<HStack spacing={4} align="center">
				<Box
					borderWidth="1px"
					borderColor={isDragging ? activeBorderColor : borderColor}
					borderRadius="md"
					bg={iconBg}
					p={2.5}
				>
					<Icon
						as={selectedFile ? DocumentTextIcon : ArrowUpTrayIcon}
						boxSize={5}
						color={selectedFile ? "primary.400" : mutedColor}
					/>
				</Box>
				<VStack align="stretch" spacing={1} minW={0} flex="1">
					<Text fontSize="sm" fontWeight="semibold" noOfLines={1}>
						{selectedFile?.name || title}
					</Text>
					<Text fontSize="xs" color={mutedColor} noOfLines={2}>
						{selectedFile
							? formatFileSize(selectedFile.size)
							: description || emptyText}
					</Text>
				</VStack>
				<Text
					fontSize="xs"
					fontWeight="semibold"
					color={isDisabled ? mutedColor : "primary.300"}
					whiteSpace="nowrap"
				>
					{emptyText}
				</Text>
			</HStack>
		</Box>
	);
};
