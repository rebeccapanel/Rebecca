import { cn } from "lib/cn";

export type SegmentedOption<T extends string> = {
	value: T;
	label: string;
	disabled?: boolean;
};

type SegmentedControlProps<T extends string> = {
	label: string;
	value: T;
	options: SegmentedOption<T>[];
	onChange: (value: T) => void;
};

export function SegmentedControl<T extends string>({
	label,
	value,
	options,
	onChange,
}: SegmentedControlProps<T>) {
	return (
		<div
			role="radiogroup"
			aria-label={label}
			className="inline-flex w-fit max-w-full flex-wrap items-center gap-1 rounded-lg border bg-muted/40 p-1"
		>
			{options.map((option) => {
				const active = option.value === value;
				return (
					<button
						key={option.value}
						type="button"
						role="radio"
						aria-checked={active}
						disabled={option.disabled}
						onClick={() => onChange(option.value)}
						className={cn(
							"h-7 min-w-14 flex-auto rounded-md px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
							active
								? "bg-primary text-primary-foreground shadow-xs"
								: "text-muted-foreground hover:bg-accent hover:text-foreground",
						)}
					>
						{option.label}
					</button>
				);
			})}
		</div>
	);
}
