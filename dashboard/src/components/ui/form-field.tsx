import type { ReactNode } from "react";
import { cn } from "lib/cn";
import { FieldHint } from "components/ui/field-hint";
import { Label } from "components/ui/label";

type FormFieldProps = {
	/** Omit when the enclosing card's title already names the field. */
	label?: ReactNode;
	htmlFor?: string;
	description?: ReactNode;
	error?: string;
	className?: string;
	children: ReactNode;
};

export const FormField = ({ label, htmlFor, description, error, className, children }: FormFieldProps) => (
	<div className={cn("flex min-w-0 flex-col gap-2", className)}>
		{label || description ? (
			<div className="flex min-w-0 items-center gap-1.5">
				{label ? <Label htmlFor={htmlFor}>{label}</Label> : null}
				{description ? <FieldHint>{description}</FieldHint> : null}
			</div>
		) : null}
		{children}
		{error ? (
			<p role="alert" className="text-xs text-destructive">
				{error}
			</p>
		) : null}
	</div>
);
