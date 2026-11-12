import { Input as FieldInput } from "components/ui/input";
import { Field, FieldError, FieldLabel } from "components/ui/field";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { withClass } from "lib/withClass";
import { X } from "lucide-react";
import React, {
	type ChangeEvent,
	type ComponentPropsWithoutRef,
	type FocusEvent,
	type MouseEvent,
	type PropsWithChildren,
	type ReactNode,
} from "react";
import { cn } from "lib/cn";

const ClearIcon = withClass(X, "w-4 h-4");

type FieldSize = "xs" | "sm" | "md" | "lg";

export type InputProps = PropsWithChildren<
	{
		value?: string;
		className?: string;
		endAdornment?: ReactNode;
		startAdornment?: ReactNode;
		type?: string;
		placeholder?: string;
		onChange?: (
			e:
				| ChangeEvent<HTMLInputElement>
				| { target: { value: string; valueAsNumber?: number; name?: string } },
		) => void;
		onBlur?: (e: FocusEvent<HTMLInputElement>) => void;
		onClick?: (e: MouseEvent<HTMLInputElement>) => void;
		name?: string;
		error?: string;
		disabled?: boolean;
		step?: number;
		label?: string;
		clearable?: boolean;
		precision?: number;
		size?: FieldSize;
		readOnly?: boolean;
		required?: boolean;
	} & Omit<ComponentPropsWithoutRef<"input">, "size">
>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
	(
		{
			disabled: disabledProp,
			disabled: isDisabled,
			readOnly: isReadOnly,
			required: isRequired,
			step,
			label,
			className,
			startAdornment,
			endAdornment,
			type = "text",
			placeholder,
			onChange,
			onBlur,
			name,
			value,
			onClick,
			error,
			clearable = false, precision = 5,
			size = "md",
			...props
		},
		ref,
	) => {
		const disabled = disabledProp ?? isDisabled;
		const clear = () => {
			if (onChange)
				onChange({
					target: {
						value: "",
						name,
					},
				});
		};
		const isNumber = type === "number";
		const fieldClassName = cn(
			"focus-visible:outline-none focus-visible:border-t-transparent! focus-visible:border-e-transparent! focus-visible:border-b-transparent! disabled:cursor-not-allowed",
			isNumber && "pe-8",
			startAdornment ? "rounded-s-none" : "rounded-md",
			endAdornment ? "rounded-e-none" : "rounded-md",
			className,
		);
		const field = isNumber ? (
			<>
				
				
					
					
				
			</>
		) : (
			<FieldInput ref={ref} name={name} step={step} type={type} onChange={onChange} onBlur={onBlur} value={value} onClick={onClick} disabled={disabled} readOnly={isReadOnly} {...props} className={fieldClassName} />
		);
		return (
			<Field data-invalid={!!error}>
				{label && <FieldLabel>{label}</FieldLabel>}
				<div className={cn("relative flex w-full items-center", cn(
						"w-full rounded-md focus-within:[outline:2px_solid] focus-within:outline-primary-200",
						disabled ? "bg-gray-100" : "bg-transparent",
						disabled ? "dark:bg-gray-600" : "dark:bg-transparent",
					))}>
					{startAdornment && <div className="flex items-center rounded-s-md border border-e-0 border-input bg-muted px-3 text-sm">{startAdornment}</div>}
					{field}
					{endAdornment && (
						<div className={cn("flex items-center rounded-e-md border border-s-0 border-input bg-muted px-3 text-sm", "rounded-s-[0] rounded-e-[6px] bg-transparent")}>
							{endAdornment}
						</div>
					)}
					{clearable && value && value.length && (
						<div onClick={clear} className={cn("absolute inset-y-0 end-0 z-10 flex items-center pe-3", "rounded-s-[0] rounded-e-[6px] bg-transparent cursor-pointer")}>
							<ClearIcon />
						</div>
					)}
				</div>
				{!!error && <FieldError>{error}</FieldError>}
			</Field>
		);
	},
);
