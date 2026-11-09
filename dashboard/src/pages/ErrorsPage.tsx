import { Box, Button, HStack, Stack, Text } from "@chakra-ui/react";
import { RequestErrors } from "components/RequestErrors";
import {
	SystemDiagnostics,
	useSystemDiagnostics,
} from "components/SystemDiagnostics";
import { PanelSelect as Select } from "components/common/PanelSelect";
import {
	PageHeader,
	PageLoadingSkeleton,
	ResourceListCard,
} from "components/ui";
import useGetUser from "hooks/useGetUser";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAPIRequestErrors } from "service/http";
import { AdminRole } from "types/Admin";
import { diagnosticSeverity, type DiagnosticSeverity } from "utils/diagnostics";

const levels: DiagnosticSeverity[] = ["critical", "error", "warning"];

export default function ErrorsPage() {
	const { t } = useTranslation();
	const { userData } = useGetUser();
	const canSeeGlobal =
		userData.role === AdminRole.Sudo || userData.role === AdminRole.FullAccess;
	const query = useSystemDiagnostics(canSeeGlobal);
	const requests = useAPIRequestErrors((state) => state.errors);
	const [level, setLevel] = useState<DiagnosticSeverity | "all">("all");
	const issues = [...(canSeeGlobal ? query.data || [] : [])].sort(
		(a, b) =>
			levels.indexOf(diagnosticSeverity(a)) -
			levels.indexOf(diagnosticSeverity(b)),
	);
	const visibleIssues = issues.filter(
		(issue) => level === "all" || diagnosticSeverity(issue) === level,
	);
	const showRequests = level === "all" || level === "error";
	const empty = !visibleIssues.length && (!showRequests || !requests.length);

	return (
		<Stack spacing={5}>
			<PageHeader
				title={t("errors.title", "errors")}
				description={t("diagnostics.pageDescription")}
			/>
			<ResourceListCard
				title={t("diagnostics.title")}
				summaryItems={levels.map((severity) => ({
					label: t(`diagnostics.level.${severity}`),
					value:
						issues.filter((issue) => diagnosticSeverity(issue) === severity)
							.length + (severity === "error" ? requests.length : 0),
					colorScheme: severity === "warning" ? "orange" : "red",
				}))}
				actions={
					canSeeGlobal ? (
						<Button
							size="sm"
							onClick={() => query.refetch()}
							isLoading={query.isFetching}
							borderRadius="10px"
							transition="all 0.16s cubic-bezier(0.16, 1, 0.3, 1)"
							_hover={{ md: { transform: "translateY(-1px)" } }}
							_active={{ transform: "scale(0.98)" }}
						>
							{t("diagnostics.refresh")}
						</Button>
					) : undefined
				}
			>
				<HStack>
					<Select
						aria-label={t("diagnostics.filterLevel")}
						value={level}
						onChange={(event) => setLevel(event.target.value as typeof level)}
						maxW="260px"
					>
						<option value="all">{t("diagnostics.allLevels")}</option>
						{levels.map((severity) => (
							<option key={severity} value={severity}>
								{t(`diagnostics.level.${severity}`)}
							</option>
						))}
					</Select>
				</HStack>
			</ResourceListCard>
			{canSeeGlobal && query.isLoading ? (
				<PageLoadingSkeleton />
			) : (
				<>
					<SystemDiagnostics
						issues={visibleIssues}
						error={canSeeGlobal ? query.error : undefined}
					/>
					{showRequests && <RequestErrors />}
					{empty && !(canSeeGlobal && query.error) && (
						<Box
							p={8}
							bg="panel.surface"
							borderRadius="20px"
							borderWidth="1px"
							borderColor="panel.border"
							textAlign="center"
						>
							<Text color="panel.textSecondary" fontSize="14px" fontWeight="500">
								{t("diagnostics.empty")}
							</Text>
						</Box>
					)}
				</>
			)}
		</Stack>
	);
}
