import type { ReactNode } from "react";

export const SettingsCard = ({
	title,
	description,
	actions,
	children,
}: {
	title: ReactNode;
	description?: ReactNode;
	actions?: ReactNode;
	children?: ReactNode;
}) => (
	<section className="flex flex-col border border-panel-border! bg-panel-surface rounded-xl overflow-hidden">
		<header className="flex flex-col gap-3 p-4 md:flex-row md:items-start md:justify-between">
			<div className="min-w-0">
				<h2 className="text-[1rem] font-semibold text-panel-text">{title}</h2>
				{description ? <p className="mt-1 text-[0.8125rem] text-panel-text-muted">{description}</p> : null}
			</div>
			{actions ? <div className="flex flex-row flex-wrap items-center gap-2 md:justify-end">{actions}</div> : null}
		</header>
		{children ? <div className="flex flex-col gap-4 border-t border-panel-border! p-4">{children}</div> : null}
	</section>
);
