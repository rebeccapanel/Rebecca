import type { FC, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "lib/cn";
import { OverviewBand, type OverviewBandProps } from "components/ui/overview-band";

type ListCardProps = {
	overview?: Omit<OverviewBandProps, "locale">;
	toolbar?: ReactNode;
	children?: ReactNode;
};

export const ListCard: FC<ListCardProps> = ({ overview, toolbar, children }) => {
	const { i18n } = useTranslation();
	return (
		<div className="flex flex-col border border-panel-border! bg-panel-surface rounded-xl overflow-hidden">
			{overview ? <OverviewBand {...overview} locale={i18n.language || "en"} /> : null}
			{toolbar ? <div className={cn("p-3", overview && "border-t border-panel-border!")}>{toolbar}</div> : null}
			{children ? <div className="border-t border-panel-border! px-4 py-3">{children}</div> : null}
		</div>
	);
};
