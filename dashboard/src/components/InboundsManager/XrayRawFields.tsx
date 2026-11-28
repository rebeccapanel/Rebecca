import { SearchableTagSelect } from "components/common/SearchableTagSelect";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
} from "components/ui/field";
import { Input } from "components/ui/input";
import { Switch } from "components/ui/switch";
import { Textarea } from "components/ui/textarea";
import { type FC, useState } from "react";
import { type Control, Controller } from "react-hook-form";
import { useTranslation } from "react-i18next";
import type { InboundFormValues } from "utils/inbounds";
import {
	formatRawField,
	parseRawField,
	type XrayRawField,
} from "utils/xrayRawFields";

const TextValue: FC<{
	spec: XrayRawField;
	label: string;
	value: unknown;
	onChange: (value: unknown) => void;
}> = ({ spec, label, value, onChange }) => {
	const { t } = useTranslation();
	const [draft, setDraft] = useState<string | null>(null);
	const text = draft ?? formatRawField(spec, value);
	const invalid = draft !== null && !parseRawField(spec, draft).ok;
	const multiline = spec.type === "json" || spec.type === "list";
	const props = {
		dir: "ltr" as const,
		"aria-label": label,
		"aria-invalid": invalid,
		placeholder: spec.placeholder,
		value: text,
		onChange: (event: { target: { value: string } }) => {
			setDraft(event.target.value);
			const parsed = parseRawField(spec, event.target.value);
			if (parsed.ok) onChange(parsed.value);
		},
		onBlur: () => {
			if (!invalid) setDraft(null);
		},
	};
	return (
		<>
			{multiline ? <Textarea rows={3} {...props} /> : <Input {...props} />}
			{invalid && <FieldError>{t("xrayFields.invalid")}</FieldError>}
		</>
	);
};

export const XrayRawFields: FC<{
	control: Control<InboundFormValues>;
	base: string;
	fields: XrayRawField[];
}> = ({ control, base, fields }) => {
	const { t } = useTranslation();
	return (
		<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
			{fields.map((spec) => {
				const label = spec.path.replace(/^xdriveSettings\./, "");
				return (
					<Field key={spec.path}>
						<FieldLabel>{label}</FieldLabel>
						<Controller
							control={control}
							name={`${base}.${spec.path}` as "tag"}
							render={({ field }) => {
								const value = field.value as unknown;
								if (spec.options) {
									return (
										<SearchableTagSelect
											value={value === null ? "" : String(value ?? "")}
											options={[
												{ value: "", label: t("common.default") },
												...spec.options,
											]}
											placeholder={label}
											onChange={(next) =>
												field.onChange(
													next === ""
														? null
														: spec.type === "bool"
															? next === "true"
															: next,
												)
											}
										/>
									);
								}
								if (spec.type === "bool") {
									return (
										<Switch
											aria-label={label}
											checked={Boolean(value)}
											onCheckedChange={(next) => field.onChange(next || null)}
										/>
									);
								}
								return (
									<TextValue
										spec={spec}
										label={label}
										value={value}
										onChange={field.onChange}
									/>
								);
							}}
						/>
						<FieldDescription>
							{t(`xrayFields.hint.${spec.hint}`)}
						</FieldDescription>
					</Field>
				);
			})}
		</div>
	);
};
