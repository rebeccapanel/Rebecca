import { useQuery } from "@tanstack/react-query";
import { useMediaQuery } from "hooks/useMediaQuery";
import { cn } from "lib/cn";
import { Star } from "lucide-react";
import { type FC, memo } from "react";
import { useTranslation } from "react-i18next";

const GITHUB_REPO_URL = "https://github.com/rebeccapanel/Rebecca";
const GITHUB_API_URL = "https://api.github.com/repos/rebeccapanel/Rebecca";
const STARS_CACHE_KEY = "rb-github-stars-cache-v1";
const LEGACY_STARS_CACHE_KEY = "rb_github_stars";
const STARS_CACHE_TTL_MS = 30 * 60 * 1000;

type CachedStars = {
	count: number;
	timestamp: number;
};

const readCachedStars = (): CachedStars | null => {
	try {
		const raw = localStorage.getItem(STARS_CACHE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw) as CachedStars;
			if (
				typeof parsed?.count === "number" &&
				parsed.count >= 0 &&
				typeof parsed?.timestamp === "number"
			) {
				return parsed;
			}
		}
		const legacyRaw = localStorage.getItem(LEGACY_STARS_CACHE_KEY);
		if (legacyRaw) {
			const count = Number(legacyRaw);
			if (Number.isFinite(count) && count >= 0) {
				return { count, timestamp: 0 };
			}
		}
		return null;
	} catch {
		return null;
	}
};

const writeCachedStars = (count: number) => {
	try {
		const payload: CachedStars = { count, timestamp: Date.now() };
		localStorage.setItem(STARS_CACHE_KEY, JSON.stringify(payload));
		localStorage.setItem(LEGACY_STARS_CACHE_KEY, String(count));
	} catch {}
};

const fetchGitHubStars = async (): Promise<number | null> => {
	const cached = readCachedStars();
	if (
		cached &&
		cached.timestamp > 0 &&
		Date.now() - cached.timestamp < STARS_CACHE_TTL_MS
	) {
		return cached.count;
	}
	try {
		const response = await window.fetch(GITHUB_API_URL, {
			headers: { Accept: "application/vnd.github+json" },
		});
		if (!response.ok) {
			return cached?.count ?? null;
		}
		const data = (await response.json()) as { stargazers_count?: unknown };
		if (
			typeof data.stargazers_count === "number" &&
			data.stargazers_count >= 0
		) {
			writeCachedStars(data.stargazers_count);
			return data.stargazers_count;
		}
		return cached?.count ?? null;
	} catch {
		return cached?.count ?? null;
	}
};

const formatStarCount = (count: number): string => {
	if (count >= 1000) {
		const k = count / 1000;
		return `${k >= 10 ? k.toFixed(0) : k.toFixed(1).replace(/\.0$/, "")}k`;
	}
	return String(count);
};

const GitHubMark: FC<{ className?: string }> = ({ className }) => (
	<svg
		viewBox="0 0 24 24"
		fill="currentColor"
		aria-hidden="true"
		className={className}
	>
		<path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z" />
	</svg>
);

export interface GitHubStarsProps {
	compact?: boolean;
	className?: string;
}

export const GitHubStars: FC<GitHubStarsProps> = memo(function GitHubStars({
	compact = false,
	className,
}) {
	const { t } = useTranslation();
	const isDesktop = useMediaQuery("(min-width: 769px)");
	const isIconOnly = !isDesktop || compact;

	const { data: stars } = useQuery({
		queryKey: ["github-stars", "rebeccapanel/Rebecca"],
		queryFn: fetchGitHubStars,
		initialData: () => readCachedStars()?.count,
		initialDataUpdatedAt: () => readCachedStars()?.timestamp ?? 0,
		staleTime: STARS_CACHE_TTL_MS,
		gcTime: 60 * 60 * 1000,
		retry: 1,
		refetchOnWindowFocus: false,
	});

	const hasCount = typeof stars === "number" && stars > 0;
	const label = t("header.githubStars", "GitHub");

	return (
		<a
			href={GITHUB_REPO_URL}
			target="_blank"
			rel="noopener noreferrer"
			data-header-github-stars="true"
			aria-label={hasCount ? `${label} (${stars})` : label}
			title={hasCount ? `${label} · ${stars.toLocaleString("en-US")} ★` : label}
			className={cn(
				"inline-flex h-[34px] shrink-0 items-center justify-center border border-panel-border! bg-panel-surface dark:bg-input/30 text-panel-text no-underline shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] outline-none select-none active:scale-[0.97] active:bg-panel-elevated focus-visible:ring-2 focus-visible:ring-panel-accent/50 min-[769px]:hover:border-panel-border-strong! min-[769px]:hover:bg-panel-elevated min-[769px]:dark:hover:bg-panel-elevated min-[769px]:hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)]",
				isIconOnly
					? "size-[34px] min-w-[34px]! rounded-full px-0 min-[769px]:rounded-[12px]"
					: "gap-2 rounded-[12px] px-3",
				className,
			)}
		>
			<GitHubMark className="size-4 shrink-0 text-panel-text" />
			{!isIconOnly ? (
				<>
					<span aria-hidden="true" className="h-3 w-px shrink-0 bg-panel-border" />
					<span className="inline-flex shrink-0 items-center gap-1.5">
						<Star className="size-[13px] shrink-0 fill-[#f59e0b] text-[#f59e0b]" />
						{hasCount ? (
							<span
								dir="ltr"
								style={{ unicodeBidi: "isolate" }}
								className="translate-y-[1.5px] text-xs font-semibold leading-none text-panel-text tabular-nums"
							>
								{formatStarCount(stars)}
							</span>
						) : null}
					</span>
				</>
			) : null}
		</a>
	);
});

export default GitHubStars;
