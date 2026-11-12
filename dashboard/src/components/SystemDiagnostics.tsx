import { Alert } from "components/ui/alert";
import { Badge } from "components/ui/badge";
import { cn } from "lib/cn";
import { toneClass } from "lib/tone";
import { ArrowUpRight, CircleAlert, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { fetch, getAPIErrorMessage } from "service/http";
import {
	diagnosticHref,
	diagnosticSeverity,
	isCriticalDiagnostic,
	type Diagnostic,
} from "utils/diagnostics";

export const useSystemDiagnostics = (enabled: boolean) =>
	useQuery<Diagnostic[]>({
		queryKey: ["system-diagnostics"],
		queryFn: () => fetch("/system/diagnostics"),
		enabled,
		refetchInterval: 15000,
		staleTime: 10000,
		retry: false,
	});

export const SystemDiagnostics = ({
	issues,
	error,
	criticalOnly = false,
}: {
	issues: Diagnostic[];
	error?: unknown;
	criticalOnly?: boolean;
}) => {
	const { t } = useTranslation();
	const visibleIssues = criticalOnly
		? issues.filter(isCriticalDiagnostic)
		: issues;
	if (!visibleIssues.length && !error) return null;

	return (
		<section
			role="alert"
			aria-live="polite"
			className="flex flex-col gap-3 rounded-[20px] border border-red-500/25 bg-red-500/6 p-4 min-[769px]:p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
		>
			<div className="flex items-center justify-between gap-2">
				<div className="flex items-center gap-2.5">
					<span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-red-500/15 text-red-400">
						<TriangleAlert className="size-4" aria-hidden="true" />
					</span>
					<p className="text-[13px] font-bold text-red-400">
						{t(criticalOnly ? "diagnostics.criticalTitle" : "diagnostics.title")}
					</p>
				</div>
				<span
					dir="ltr"
					className="inline-flex items-center justify-center rounded-full border border-red-500/25 bg-red-500/12 px-2.5 py-0.5 text-[11px] font-bold text-red-400 tabular-nums [unicode-bidi:isolate]"
				>
					{visibleIssues.length}
				</span>
			</div>

			{Boolean(error) && (
				<Alert variant="destructive" className="rounded-[14px]">
					<CircleAlert className="size-4" aria-hidden="true" />
					<p className="text-[12px] font-medium">{getAPIErrorMessage(error)}</p>
				</Alert>
			)}

			<div className="flex flex-col gap-2.5">
				{visibleIssues.map((issue, index) => {
					const severity = diagnosticSeverity(issue);
					const tone = severity === "warning" ? "orange" : "red";
					return (
						<Link
							key={`${issue.target_id}-${issue.resource_type}-${index}`}
							to={diagnosticHref(issue)}
							aria-label={`${issue.resource}: ${issue.message}`}
							className={cn(
								"group block rounded-[14px] border border-panel-border! bg-panel-surface/90 p-3.5 no-underline transition-[border-color,background-color] duration-200 min-[769px]:hover:border-panel-border-strong! min-[769px]:hover:bg-panel-elevated focus-visible:outline-2 focus-visible:outline-panel-accent",
							)}
						>
							<div className="flex flex-wrap items-center justify-between gap-2 mb-2">
								<div className="flex flex-wrap items-center gap-2">
									<Badge className={toneClass(tone)}>
										{t(`diagnostics.level.${severity}`)}
									</Badge>
									<Badge className={toneClass(tone)}>
										{t(
											`diagnostics.source.${issue.resource_type}`,
											issue.resource_type,
										)}
									</Badge>
									<span className="text-[12px] font-bold text-panel-text">
										{issue.resource}
									</span>
									<span
										dir="ltr"
										className="text-[11px] font-medium text-panel-text-muted tabular-nums [unicode-bidi:isolate]"
									>
										{issue.target_id}
									</span>
								</div>
								<span className="inline-flex items-center gap-1 text-[11px] font-semibold text-panel-accent">
									<span>{t("diagnostics.openSection")}</span>
									<ArrowUpRight className="size-3.5" aria-hidden="true" />
								</span>
							</div>
							<p
								dir="auto"
								className="font-mono text-[12px] leading-relaxed text-panel-text-secondary whitespace-pre-wrap [word-break:break-word]"
							>
								{issue.message}
							</p>
						</Link>
					);
				})}
			</div>
		</section>
	);
};
