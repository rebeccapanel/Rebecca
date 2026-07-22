import {
	Alert,
	AlertIcon,
	Box,
	Button,
	FormControl,
	FormLabel,
	HStack,
	SimpleGrid,
	Stack,
	Text,
	useToast,
	VStack,
} from "@chakra-ui/react";
import { PanelSelect as Select } from "components/common/PanelSelect";
import {
	ArrowDownTrayIcon,
	ArrowUpTrayIcon,
} from "@heroicons/react/24/outline";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "react-query";
import {
	exportRebeccaBackup,
	importRebeccaBackup,
	type RebeccaBackupScope,
} from "service/settings";
import {
	generateErrorMessage,
	generateSuccessMessage,
} from "utils/toastHandler";
import { FileDropzone } from "./common/FileDropzone";

const buildBackupFilename = (scope: RebeccaBackupScope) => {
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	return `rebecca-${scope}-${timestamp}.rbbackup`;
};

type RebeccaBackupPanelProps = {
	isBinaryRuntime?: boolean;
	runtimeLoading?: boolean;
};

export const RebeccaBackupPanel = ({
	isBinaryRuntime = true,
	runtimeLoading = false,
}: RebeccaBackupPanelProps) => {
	const { t } = useTranslation();
	const toast = useToast();
	const [exportScope, setExportScope] =
		useState<RebeccaBackupScope>("database");
	const [importScope, setImportScope] =
		useState<RebeccaBackupScope>("database");
	const [selectedFile, setSelectedFile] = useState<File | null>(null);

	const importWarning = useMemo(() => {
		if (importScope === "full") {
			return t("settings.backup.fullImportWarning");
		}
		return t("settings.backup.databaseImportWarning");
	}, [importScope, t]);

	const exportMutation = useMutation(exportRebeccaBackup, {
		onSuccess: (blob, scope) => {
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = buildBackupFilename(scope);
			document.body.appendChild(anchor);
			anchor.click();
			anchor.remove();
			URL.revokeObjectURL(url);
			generateSuccessMessage(
				t("settings.backup.exportReady"),
				toast,
			);
		},
		onError: (error) => {
			generateErrorMessage(error, toast);
		},
	});

	const importMutation = useMutation(
		({ scope, file }: { scope: RebeccaBackupScope; file: File }) =>
			importRebeccaBackup(scope, file),
		{
			onSuccess: (result) => {
				generateSuccessMessage(
					t("settings.backup.importDone", {
							tables: result.tables_restored,
							rows: result.rows_restored,
						}),
					toast,
				);
				if (result.warnings.length) {
					toast({
						status: "warning",
						title: t("settings.backup.importWarnings"),
						description: result.warnings.join("\n"),
						duration: 8000,
						isClosable: true,
					});
				}
				setSelectedFile(null);
			},
			onError: (error) => {
				generateErrorMessage(error, toast);
			},
		},
	);

	const handleImport = () => {
		if (!selectedFile) {
			toast({
				status: "warning",
				title: t("settings.backup.fileRequired"),
			});
			return;
		}
		importMutation.mutate({ scope: importScope, file: selectedFile });
	};
	const backupActionsAvailable = isBinaryRuntime && !runtimeLoading;

	return (
		<Stack spacing={5} align="stretch">
			<Box>
				<Text fontWeight="semibold">
					{t("settings.backup.title")}
				</Text>
				<Text fontSize="sm" color="gray.500">
					{t("settings.backup.description")}
				</Text>
			</Box>

			{!runtimeLoading && !isBinaryRuntime ? (
				<Alert status="warning" borderRadius="md">
					<AlertIcon />
					<Text fontSize="sm">
						{t("settings.backup.binaryOnly")}
					</Text>
				</Alert>
			) : null}

			<SimpleGrid columns={{ base: 1, lg: 2 }} spacing={4}>
				<Box
					className="master-settings-card"
					borderWidth="1px"
					borderRadius="lg"
					p={4}
				>
					<VStack align="stretch" spacing={4}>
						<Box>
							<Text fontWeight="semibold">
								{t("settings.backup.exportTitle")}
							</Text>
							<Text fontSize="sm" color="gray.500">
								{t("settings.backup.exportHint")}
							</Text>
						</Box>
						<FormControl>
							<FormLabel>
								{t("settings.telegram.backupScope")}
							</FormLabel>
							<Select
								value={exportScope}
								isDisabled={!backupActionsAvailable}
								onChange={(event) =>
									setExportScope(event.target.value as RebeccaBackupScope)
								}
							>
								<option value="database">
									{t("settings.backup.databaseOnly")}
								</option>
								<option value="full">
									{t("settings.backup.full")}
								</option>
							</Select>
						</FormControl>
						<HStack justify="flex-end">
							<Button
								leftIcon={<ArrowDownTrayIcon width={16} height={16} />}
								onClick={() => exportMutation.mutate(exportScope)}
								isLoading={exportMutation.isLoading}
								isDisabled={!backupActionsAvailable}
							>
								{t("settings.backup.download")}
							</Button>
						</HStack>
					</VStack>
				</Box>

				<Box
					className="master-settings-card"
					borderWidth="1px"
					borderRadius="lg"
					p={4}
				>
					<VStack align="stretch" spacing={4}>
						<Box>
							<Text fontWeight="semibold">
								{t("settings.backup.import")}
							</Text>
							<Text fontSize="sm" color="gray.500">
								{t("settings.backup.importHint")}
							</Text>
						</Box>
						<Alert status="warning" borderRadius="md">
							<AlertIcon />
							<Text fontSize="sm">{importWarning}</Text>
						</Alert>
						<FormControl>
							<FormLabel>
								{t("settings.backup.restoreScope")}
							</FormLabel>
							<Select
								value={importScope}
								isDisabled={!backupActionsAvailable}
								onChange={(event) =>
									setImportScope(event.target.value as RebeccaBackupScope)
								}
							>
								<option value="database">
									{t("settings.backup.databaseOnly")}
								</option>
								<option value="full">
									{t("settings.backup.full")}
								</option>
							</Select>
						</FormControl>
						<FormControl>
							<FormLabel>
								{t("settings.backup.file")}
							</FormLabel>
							<FileDropzone
								accept=".rbbackup,application/vnd.rebecca.backup,application/gzip"
								isDisabled={!backupActionsAvailable}
								selectedFile={selectedFile}
								title={t("settings.backup.dropTitle")}
								description={t("settings.backup.dropHint")}
								emptyText={t("settings.backup.selectFile")}
								onFileSelect={setSelectedFile}
							/>
						</FormControl>
						<HStack justify="flex-end">
							<Button
								colorScheme="red"
								leftIcon={<ArrowUpTrayIcon width={16} height={16} />}
								onClick={handleImport}
								isLoading={importMutation.isLoading}
								isDisabled={!backupActionsAvailable}
							>
								{t("settings.backup.import")}
							</Button>
						</HStack>
					</VStack>
				</Box>
			</SimpleGrid>
		</Stack>
	);
};
