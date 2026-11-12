import { Field, FieldLabel } from "components/ui/field";
import { Input } from "components/ui/input";
import { Button } from "components/ui/button";
import { Dialog } from "components/ui/dialog";
import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";


import { type FC, useEffect } from "react";
import type { UseFormReturn } from "react-hook-form";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { NumericInput } from "./common/NumericInput";
import {
	XrayDialogSection,
	XrayModalBody,
	XrayModalContent,
	XrayModalFooter,
	XrayModalHeader,
} from "./xray/XrayDialog";

type FakeDnsFormValues = {
	ipPool: string;
	poolSize: string;
};

type FakeDnsConfig = {
	ipPool: string;
	poolSize: number;
};

interface FakeDnsModalProps {
	open: boolean;
	onClose: () => void;
	form: UseFormReturn<any>;
	setFakeDns: (data: FakeDnsConfig[]) => void;
	fakeDnsIndex?: number | null;
	currentFakeDnsData?: FakeDnsConfig | null;
}

export const FakeDnsModal: FC<FakeDnsModalProps> = ({
	open: isOpen,
	onClose,
	form,
	setFakeDns,
	fakeDnsIndex,
	currentFakeDnsData,
}) => {
	const { t } = useTranslation();
	const isEdit = fakeDnsIndex !== null && fakeDnsIndex !== undefined;
	const modalForm = useForm<FakeDnsFormValues>({
		defaultValues: {
			ipPool: "198.18.0.0/16",
			poolSize: "65535",
		},
	});

	useEffect(() => {
		if (!isOpen) return;
		if (isEdit && currentFakeDnsData) {
			modalForm.reset({
				ipPool: currentFakeDnsData.ipPool ?? "",
				poolSize:
					currentFakeDnsData.poolSize !== undefined
						? String(currentFakeDnsData.poolSize)
						: "",
			});
		} else {
			modalForm.reset({
				ipPool: "198.18.0.0/16",
				poolSize: "65535",
			});
		}
	}, [currentFakeDnsData, isEdit, isOpen, modalForm]);

	const handleSubmit = modalForm.handleSubmit((data) => {
		const poolSizeValue = Number.parseInt(data.poolSize, 10);
		const newFakeDns = {
			ipPool: data.ipPool,
			poolSize:
				Number.isFinite(poolSizeValue) && poolSizeValue > 0
					? poolSizeValue
					: 65535,
		};

		const currentFakeDns: FakeDnsConfig[] =
			(form.getValues("config.fakedns") as FakeDnsConfig[] | undefined) || [];
		if (isEdit && fakeDnsIndex !== null && fakeDnsIndex !== undefined) {
			currentFakeDns[fakeDnsIndex] = newFakeDns;
		} else {
			currentFakeDns.push(newFakeDns);
		}

		form.setValue(
			"config.fakedns",
			currentFakeDns.length > 0 ? currentFakeDns : undefined,
			{ shouldDirty: true },
		);
		setFakeDns(currentFakeDns);
		onClose();
	});

	return (
		<Dialog open={isOpen} onOpenChange={(open) => { if (!open) (onClose)(); }}>
			
			<XrayModalContent className="mx-3">
				<XrayModalHeader>
					{isEdit ? t("pages.xray.fakedns.edit") : t("pages.xray.fakedns.add")}
				</XrayModalHeader>
				
				<form onSubmit={handleSubmit}>
					<XrayModalBody>
						<XrayDialogSection
							title={t("pages.xray.fakedns.title")}
						>
							<div className="flex flex-col gap-4 items-stretch">
								<Field>
									<FieldLabel>{t("pages.xray.fakedns.ipPool")}</FieldLabel>
									<Input {...modalForm.register("ipPool")} />
								</Field>
								<Field>
									<FieldLabel>{t("pages.xray.fakedns.poolSize")}</FieldLabel>
									<Controller
										control={modalForm.control}
										name="poolSize"
										render={({ field }) => (
											<NumericInput value={field.value ?? ""} onChange={(value) => field.onChange(value)} size="sm" min={1} fieldProps={{ className: "[placeholder:100]" }} />
										)}
									/>
								</Field>
							</div>
						</XrayDialogSection>
					</XrayModalBody>
					<XrayModalFooter className="justify-end">
						<Button onClick={onClose} variant="outline">
							{t("cancel")}
						</Button>
						<Button type="submit" size="sm">
							{isEdit
								? t("pages.xray.fakedns.edit")
								: t("pages.xray.fakedns.add")}
						</Button>
					</XrayModalFooter>
				</form>
			</XrayModalContent>
		</Dialog>
	);
};
