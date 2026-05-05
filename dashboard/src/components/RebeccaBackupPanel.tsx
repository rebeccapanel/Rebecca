import {
	Alert,
	AlertIcon,
	Box,
	Button,
	FormControl,
	FormHelperText,
	FormLabel,
	HStack,
	Input,
	Select,
	SimpleGrid,
	Stack,
	Text,
	VStack,
	useToast,
} from "@chakra-ui/react";
import {
	ArrowDownTrayIcon,
	ArrowUpTrayIcon,
} from "@heroicons/react/24/outline";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "react-query";
import {
	type RebeccaBackupScope,
	exportRebeccaBackup,
	importRebeccaBackup,
} from "service/settings";
import {
	generateErrorMessage,
	generateSuccessMessage,
} from "utils/toastHandler";

const scopeLabels: Record<RebeccaBackupScope, string> = {
	database: "Database only",
	full: "Database + Rebecca files",
};

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
			return t(
				"settings.backup.fullImportWarning",
				"Full import replaces the Rebecca database and restores /etc/rebecca plus /var/lib/rebecca from the backup.",
			);
		}
		return t(
			"settings.backup.databaseImportWarning",
			"Database-only import replaces the current Rebecca database while leaving server files untouched.",
		);
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
				t("settings.backup.exportReady", "Rebecca backup is ready."),
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
					t(
						"settings.backup.importDone",
						"Backup imported. Restored {{tables}} tables and {{rows}} rows.",
						{
							tables: result.tables_restored,
							rows: result.rows_restored,
						},
					),
					toast,
				);
				if (result.warnings.length) {
					toast({
						status: "warning",
						title: t("settings.backup.importWarnings", "Import completed with warnings"),
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
				title: t("settings.backup.fileRequired", "Select a Rebecca backup file first."),
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
					{t("settings.backup.title", "Rebecca backup and import")}
				</Text>
				<Text fontSize="sm" color="gray.500">
					{t(
						"settings.backup.description",
						"Export or restore Rebecca in a portable .rbbackup format that works across SQLite, MySQL and MariaDB installations.",
					)}
				</Text>
			</Box>

			{!runtimeLoading && !isBinaryRuntime ? (
				<Alert status="warning" borderRadius="md">
					<AlertIcon />
					<Text fontSize="sm">
						{t(
							"settings.backup.binaryOnly",
							"Rebecca backup and import are disabled in Docker mode. Migrate this panel to the binary version to use host-level backup and restore.",
						)}
					</Text>
				</Alert>
			) : null}

			<SimpleGrid columns={{ base: 1, lg: 2 }} spacing={4}>
				<Box borderWidth="1px" borderRadius="lg" p={4}>
					<VStack align="stretch" spacing={4}>
						<Box>
							<Text fontWeight="semibold">
								{t("settings.backup.exportTitle", "Export backup")}
							</Text>
							<Text fontSize="sm" color="gray.500">
								{t(
									"settings.backup.exportHint",
									"Database-only exports just Rebecca data. Full exports also include Rebecca configuration and data directories.",
								)}
							</Text>
						</Box>
						<FormControl>
							<FormLabel>{t("settings.backup.scope", "Backup scope")}</FormLabel>
							<Select
								value={exportScope}
								isDisabled={!backupActionsAvailable}
								onChange={(event) =>
									setExportScope(event.target.value as RebeccaBackupScope)
								}
							>
								<option value="database">
									{t("settings.backup.databaseOnly", scopeLabels.database)}
								</option>
								<option value="full">
									{t("settings.backup.full", scopeLabels.full)}
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
								{t("settings.backup.download", "Download backup")}
							</Button>
						</HStack>
					</VStack>
				</Box>

				<Box borderWidth="1px" borderRadius="lg" p={4}>
					<VStack align="stretch" spacing={4}>
						<Box>
							<Text fontWeight="semibold">
								{t("settings.backup.importTitle", "Import backup")}
							</Text>
							<Text fontSize="sm" color="gray.500">
								{t(
									"settings.backup.importHint",
									"Upload a Rebecca .rbbackup file created by this panel.",
								)}
							</Text>
						</Box>
						<Alert status="warning" borderRadius="md">
							<AlertIcon />
							<Text fontSize="sm">{importWarning}</Text>
						</Alert>
						<FormControl>
							<FormLabel>{t("settings.backup.restoreScope", "Restore scope")}</FormLabel>
							<Select
								value={importScope}
								isDisabled={!backupActionsAvailable}
								onChange={(event) =>
									setImportScope(event.target.value as RebeccaBackupScope)
								}
							>
								<option value="database">
									{t("settings.backup.databaseOnly", scopeLabels.database)}
								</option>
								<option value="full">
									{t("settings.backup.full", scopeLabels.full)}
								</option>
							</Select>
						</FormControl>
						<FormControl>
							<FormLabel>{t("settings.backup.file", "Rebecca backup file")}</FormLabel>
							<Input
								type="file"
								accept=".rbbackup,application/vnd.rebecca.backup,application/gzip"
								isDisabled={!backupActionsAvailable}
								onChange={(event) =>
									setSelectedFile(event.target.files?.[0] ?? null)
								}
							/>
							<FormHelperText>
								{selectedFile
									? selectedFile.name
									: t(
											"settings.backup.fileHint",
											"Choose a .rbbackup file exported from Rebecca.",
									  )}
							</FormHelperText>
						</FormControl>
						<HStack justify="flex-end">
							<Button
								colorScheme="red"
								leftIcon={<ArrowUpTrayIcon width={16} height={16} />}
								onClick={handleImport}
								isLoading={importMutation.isLoading}
								isDisabled={!backupActionsAvailable}
							>
								{t("settings.backup.import", "Import backup")}
							</Button>
						</HStack>
					</VStack>
				</Box>
			</SimpleGrid>
		</Stack>
	);
};
