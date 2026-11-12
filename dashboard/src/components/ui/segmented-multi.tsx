import { cn } from "lib/cn";

export type SegmentedMultiOption = {
	value: string;
	label: string;
	disabled?: boolean;
};

export function SegmentedMultiControl({
	label,
	value,
	options,
	onChange,
}: {
	label: string;
	value: string[];
	options: SegmentedMultiOption[];
	onChange: (next: string[]) => void;
}) {
	const toggle = (option: string) =>
		onChange(value.includes(option) ? value.filter((item) => item !== option) : [...value, option]);

	return (
		<div
			role="group"
			aria-label={label}
			className="inline-flex w-fit max-w-full flex-wrap items-center gap-1 rounded-lg border bg-muted/40 p-1"
		>
			{options.map((option) => {
				const active = value.includes(option.value);
				return (
					<button
						key={option.value}
						type="button"
						role="checkbox"
						aria-checked={active}
						disabled={option.disabled}
						onClick={() => toggle(option.value)}
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
