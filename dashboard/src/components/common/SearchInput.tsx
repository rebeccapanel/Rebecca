import { Input } from "components/ui/input";
import { Spinner } from "components/ui/spinner";
import { Button } from "components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "components/ui/tooltip";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { withClass } from "lib/withClass";
import { Search, X } from "lucide-react";

import type { ComponentPropsWithoutRef } from "react";
import { cn } from "lib/cn";
import type { FC, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { SearchMatchOptions } from "utils/searchMatch";

const SearchIcon = withClass(Search, "w-4 h-4");
const ClearIcon = withClass(X, "w-3.5 h-3.5");

type SearchInputProps = Omit<ComponentPropsWithoutRef<"input">, "size"> & {
	size?: "xs" | "sm" | "md" | "lg";
	containerProps?: ComponentPropsWithoutRef<"div">;
	loading?: boolean;
	matchOptions: SearchMatchOptions;
	onClear?: () => void;
	onMatchOptionsChange: (options: SearchMatchOptions) => void;
	rightElement?: ReactNode;
};

export const SearchInput: FC<SearchInputProps> = ({
	containerProps,
	loading: isLoading,
	matchOptions,
	onClear,
	onMatchOptionsChange,
	rightElement,
	size = "sm",
	value,
	...inputProps
}) => {
	const { t } = useTranslation();
	const toggle = (key: keyof SearchMatchOptions) =>
		onMatchOptionsChange({ ...matchOptions, [key]: !matchOptions[key] });

	return (
		<div className="relative flex w-full items-center">
			<div className={cn("pointer-events-none absolute inset-y-0 start-0 z-10 flex items-center ps-3 text-muted-foreground", "pointer-events-none h-full")}>
				<SearchIcon className="text-panel-text-muted" />
			</div>
			<Input value={value} {...inputProps} className="ps-9 pe-[116px]" />
			<div className={cn("absolute inset-y-0 end-0 z-10 flex items-center pe-3", "w-auto pe-1 h-full")}>
				<div className="flex flex-row items-center gap-0.5">
					{isLoading && <Spinner className="text-panel-text-muted" />}
					<Tooltip>
<TooltipTrigger asChild>
						<Button aria-label={t("search.matchCase")} aria-pressed={matchOptions.matchCase} onClick={() => toggle("matchCase")} type="button" variant="ghost" size="xs" className={cn("size-7 p-0", cn(matchOptions.matchCase ? "text-primary-400" : "text-panel-text-muted", matchOptions.matchCase ? "bg-panel-hover" : "bg-transparent"))}>{<p className="text-[0.75rem]">Aa</p>}</Button>
					</TooltipTrigger>
<TooltipContent>{t("search.matchCase")}</TooltipContent>
</Tooltip>
					<Tooltip>
<TooltipTrigger asChild>
						<Button aria-label={t("search.matchWholeWord")} aria-pressed={matchOptions.matchWholeWord} onClick={() => toggle("matchWholeWord")} type="button" variant="ghost" size="xs" className={cn("size-7 p-0", cn(matchOptions.matchWholeWord ? "text-primary-400" : "text-panel-text-muted", matchOptions.matchWholeWord ? "bg-panel-hover" : "bg-transparent"))}>{<p className="text-[0.75rem] underline">
									ab
								</p>}</Button>
					</TooltipTrigger>
<TooltipContent>{t("search.matchWholeWord")}</TooltipContent>
</Tooltip>
					{rightElement}
					{onClear && String(value ?? "").length > 0 && (
						<Button aria-label={t("clear")} onClick={onClear} type="button" variant="ghost" size="xs" className="size-7 p-0">{<ClearIcon />}</Button>
					)}
				</div>
			</div>
		</div>
	);
};
