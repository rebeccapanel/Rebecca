import { useInfiniteQuery } from "@tanstack/react-query";
import dayjs from "dayjs";
import type { FC } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "components/ui/button";
import { fetch } from "service/http";

type AdminHistoryChange = {
	field: string;
	before: string;
	after: string;
	delta?: string;
};

type AdminHistoryEntry = {
	id: number;
	actor_username: string;
	created_at: string;
	changes?: AdminHistoryChange[];
};

type AdminHistoryResponse = {
	actions: AdminHistoryEntry[];
	next_before_id?: number | null;
};

const formatChangeValue = (field: string, value: string) =>
	field === "expire" && /^\d+$/.test(value) ? dayjs.unix(Number(value)).format("YYYY-MM-DD HH:mm") : value;

export const AdminHistoryPanel: FC<{ username: string }> = ({ username }) => {
	const { t } = useTranslation();
	const query = useInfiniteQuery({
		queryKey: ["admin-history", username],
		queryFn: ({ pageParam }) =>
			fetch<AdminHistoryResponse>(
				`/admin/history/${encodeURIComponent(username)}?limit=30${pageParam ? `&before_id=${pageParam}` : ""}`,
			),
		initialPageParam: null as number | null,
		getNextPageParam: (last) => last.next_before_id ?? undefined,
	});

	if (query.isPending) {
		return <p className="text-sm text-muted-foreground">{t("loading")}</p>;
	}
	if (query.isError) {
		return <p className="text-sm text-destructive">{t("adminHistory.error")}</p>;
	}
	const entries = query.data.pages.flatMap((page) => page.actions);
	if (!entries.length) {
		return <p className="text-sm text-muted-foreground">{t("adminHistory.empty")}</p>;
	}

	return (
		<div className="flex flex-col gap-3">
			{entries.map((entry) => (
				<div key={entry.id} className="rounded-md border px-3 py-2">
					<div className="flex flex-wrap items-center justify-between gap-2 text-xs">
						<span dir="ltr" className="font-semibold text-foreground">
							{t("adminHistory.by", { name: entry.actor_username })}
						</span>
						<span className="rb-tabular text-muted-foreground">{dayjs(entry.created_at).format("YYYY-MM-DD HH:mm")}</span>
					</div>
					{entry.changes?.length ? (
						<ul className="mt-2 flex flex-col gap-1.5">
							{entry.changes.map((change) => (
								<li key={change.field} dir="ltr" className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
									<span className="font-semibold text-foreground">
										{t(`recentActions.fields.${change.field}`, { defaultValue: change.field })}
									</span>
									<span className="text-muted-foreground">{formatChangeValue(change.field, change.before)}</span>
									<span className="text-muted-foreground">→</span>
									<span className="font-bold text-foreground">{formatChangeValue(change.field, change.after)}</span>
									{change.delta ? (
										<span className="rb-tabular rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground">{change.delta}</span>
									) : null}
								</li>
							))}
						</ul>
					) : null}
				</div>
			))}
			{query.hasNextPage ? (
				<Button variant="outline" size="sm" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
					{t("adminHistory.loadMore")}
				</Button>
			) : null}
		</div>
	);
};
