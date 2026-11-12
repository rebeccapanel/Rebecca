import type { ReactNode } from "react";
import { Checkbox } from "components/ui/checkbox";
import { cn } from "lib/cn";

export const CheckRow = ({
	checked,
	onChange,
	disabled,
	indeterminate,
	children,
}: {
	checked: boolean;
	onChange: (next: boolean) => void;
	disabled?: boolean;
	indeterminate?: boolean;
	children: ReactNode;
}) => (
	<label className={cn("flex items-start gap-2.5 text-sm", disabled && "opacity-50")}>
		<Checkbox
			className="mt-0.5"
			checked={indeterminate ? "indeterminate" : checked}
			disabled={disabled}
			onCheckedChange={(next) => onChange(next === true)}
		/>
		<span className="min-w-0">{children}</span>
	</label>
);
