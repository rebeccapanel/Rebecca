import { Alert, AlertDescription } from "components/ui/alert";
import { Button } from "components/ui/button";
import { Field, FieldDescription, FieldLabel } from "components/ui/field";
import { Input } from "components/ui/input";
import { Switch } from "components/ui/switch";
import {
	type Control,
	Controller,
	type UseFormSetValue,
} from "react-hook-form";
import { useTranslation } from "react-i18next";
import { AWG_EXTRA_FIELDS, generateAwgParameters } from "utils/awgFields";
import type { InboundFormValues } from "utils/inbounds";

export const AwgFields = ({
	control,
	setValue,
}: {
	control: Control<InboundFormValues>;
	setValue: UseFormSetValue<InboundFormValues>;
}) => {
	const { t } = useTranslation();

	const generate = () => {
		const next = generateAwgParameters();
		const options = { shouldDirty: true, shouldValidate: true };
		setValue("awgJc", next.jc, options);
		setValue("awgJmin", next.jmin, options);
		setValue("awgJmax", next.jmax, options);
		setValue("awgS1", next.s1, options);
		setValue("awgS2", next.s2, options);
		setValue("awgH1", next.h1, options);
		setValue("awgH2", next.h2, options);
		setValue("awgH3", next.h3, options);
		setValue("awgH4", next.h4, options);
		setValue("awgExtra", next.extra, options);
	};

	return (
		<div className="flex flex-col gap-3">
			<Alert>
				<AlertDescription>{t("inbounds.amneziawg.v3Warning")}</AlertDescription>
			</Alert>
			<Button type="button" variant="outline" size="sm" onClick={generate}>
				{t("inbounds.amneziawg.generate")}
			</Button>
			<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
				{AWG_EXTRA_FIELDS.map((spec) => (
					<Field key={spec.key}>
						<FieldLabel>{spec.label}</FieldLabel>
						<Controller
							control={control}
							name={`awgExtra.${spec.key}` as "tag"}
							render={({ field }) =>
								spec.type === "bool" ? (
									<Switch
										aria-label={spec.label}
										checked={Boolean(field.value)}
										onCheckedChange={field.onChange}
									/>
								) : (
									<Input
										dir="ltr"
										aria-label={spec.label}
										placeholder={spec.placeholder}
										value={String(field.value ?? "")}
										onChange={field.onChange}
									/>
								)
							}
						/>
						<FieldDescription>
							{t(`inbounds.amneziawg.hint.${spec.key}`)}
						</FieldDescription>
					</Field>
				))}
			</div>
		</div>
	);
};
