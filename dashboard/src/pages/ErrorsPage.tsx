import { Button } from "components/ui/button";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";

import { RequestErrors } from "components/RequestErrors";
import { DiagnosticsTable } from "components/diagnostics/DiagnosticsTable";
import {
	SystemDiagnostics,
	useSystemDiagnostics,
} from "components/SystemDiagnostics";
import { PanelSelect as Select } from "components/common/PanelSelect";
import { OverviewBand } from "components/ui/overview-band";
import { PageHeader, PageLoadingSkeleton } from "components/ui";
import useGetUser from "hooks/useGetUser";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAPIRequestErrors } from "service/http";
import { AdminRole } from "types/Admin";
import { diagnosticSeverity, type DiagnosticSeverity } from "utils/diagnostics";

const levels: DiagnosticSeverity[] = ["critical", "error", "warning"];

const levelTone: Record<DiagnosticSeverity, string> = {
	critical: "bg-panel-danger",
	error: "bg-panel-warning",
	warning: "bg-panel-info",
};

export default function ErrorsPage() {
	const { t, i18n } = useTranslation();
	const locale = i18n.language || "en";
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

	const countOf = (severity: DiagnosticSeverity) =>
		issues.filter((issue) => diagnosticSeverity(issue) === severity).length +
		(severity === "error" ? requests.length : 0);
	const total = levels.reduce((sum, severity) => sum + countOf(severity), 0);
	const overview = {
		total: { label: t("diagnostics.title"), value: total },
		rows: [
			{ key: "critical", label: t("diagnostics.level.critical"), value: countOf("critical"), tone: levelTone.critical },
			{ key: "error", label: t("diagnostics.level.error"), value: countOf("error"), tone: levelTone.error },
		],
		distribution: {
			label: t("diagnostics.levelTitle"),
			segments: levels.map((severity) => ({
				key: severity,
				label: t(`diagnostics.level.${severity}`),
				value: countOf(severity),
				tone: levelTone[severity],
			})),
		},
		extra: { label: t("diagnostics.requestFailed"), value: requests.length },
	};

	return (
		<div className="flex flex-col gap-5">
			<PageHeader
				title={t("diagnostics.menu")}
				description={t("diagnostics.pageDescription")}
			/>
			<div className="border border-panel-border! bg-panel-surface rounded-xl overflow-hidden">
				<OverviewBand
					total={overview.total}
					rows={overview.rows}
					distribution={overview.distribution}
					extra={overview.extra}
					locale={locale}
				/>
				<div className="border-t border-panel-border! p-3">
					<div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
						<div className="min-w-0 md:w-[260px]">
							<Select
								aria-label={t("diagnostics.filterLevel")}
								value={level}
								onChange={(event) => setLevel(event.target.value as typeof level)}
								className="w-full"
							>
								<option value="all">{t("diagnostics.allLevels")}</option>
								{levels.map((severity) => (
									<option key={severity} value={severity}>
										{t(`diagnostics.level.${severity}`)}
									</option>
								))}
							</Select>
						</div>
						{canSeeGlobal ? (
							<div className="flex shrink-0 justify-end">
								<Button onClick={() => query.refetch()} variant="outline" size="sm" loading={query.isFetching}>
									{t("diagnostics.refresh")}
								</Button>
							</div>
						) : null}
					</div>
				</div>
			</div>
			{canSeeGlobal && query.isLoading ? (
				<PageLoadingSkeleton />
			) : (
				<>
					{visibleIssues.length ? (
						<section className="flex flex-col gap-3">
							<h2 className="text-[0.95rem] font-semibold">
								{t("diagnostics.title")}{" "}
								<span className="text-panel-text-muted">({visibleIssues.length})</span>
							</h2>
							<DiagnosticsTable issues={visibleIssues} />
						</section>
					) : canSeeGlobal && query.error ? (
						<SystemDiagnostics issues={[]} error={query.error} />
					) : null}
					{showRequests && <RequestErrors />}
					{empty && !(canSeeGlobal && query.error) && (
						<div className="p-6 bg-panel-surface rounded-2xl">
							<p className="text-panel-text-secondary">{t("diagnostics.empty")}</p>
						</div>
					)}
				</>
			)}
		</div>
	);
}
