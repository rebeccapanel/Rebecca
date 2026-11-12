import type { ReactNode } from "react";
import { cn } from "lib/cn";
import { Switch as UiSwitch } from "components/ui/switch";

export const ToggleRow = ({
	title,
	hint,
	checked,
	disabled,
	onChange,
}: {
	title: ReactNode;
	hint?: ReactNode;
	checked: boolean;
	disabled?: boolean;
	onChange: (next: boolean) => void;
}) => (
	<label className={cn("flex items-center justify-between gap-4 rounded-lg border bg-card/40 px-3 py-2.5", disabled && "opacity-60")}>
		<span className="min-w-0">
			<span className="block text-sm font-medium">{title}</span>
			{hint ? <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span> : null}
		</span>
		<UiSwitch checked={checked} disabled={disabled} onCheckedChange={(next) => onChange(next)} />
	</label>
);
