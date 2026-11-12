import type { ReactNode } from "react";

export const FormSection = ({ title, children }: { title?: ReactNode; children: ReactNode }) => (
	<section className="flex flex-col gap-4 border-t border-panel-border! pt-5 first:border-t-0 first:pt-0">
		{title ? <h3 className="text-sm font-semibold">{title}</h3> : null}
		{children}
	</section>
);
