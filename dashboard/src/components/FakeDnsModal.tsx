import {
	Button,
	FormControl,
	FormLabel,
	Input,
	Modal,
	ModalCloseButton,
	ModalOverlay,
	VStack,
} from "@chakra-ui/react";
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
	isOpen: boolean;
	onClose: () => void;
	form: UseFormReturn<any>;
	setFakeDns: (data: FakeDnsConfig[]) => void;
	fakeDnsIndex?: number | null;
	currentFakeDnsData?: FakeDnsConfig | null;
}

export const FakeDnsModal: FC<FakeDnsModalProps> = ({
	isOpen,
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
		<Modal isOpen={isOpen} onClose={onClose} size="lg">
			<ModalOverlay bg="blackAlpha.400" backdropFilter="blur(8px)" />
			<XrayModalContent mx="3">
				<XrayModalHeader>
					{isEdit ? t("pages.xray.fakedns.edit") : t("pages.xray.fakedns.add")}
				</XrayModalHeader>
				<ModalCloseButton />
				<form onSubmit={handleSubmit}>
					<XrayModalBody>
						<XrayDialogSection
							title={t("pages.xray.fakedns.title", "Fake DNS")}
						>
							<VStack spacing={4} align="stretch">
								<FormControl>
									<FormLabel>{t("pages.xray.fakedns.ipPool")}</FormLabel>
									<Input
										{...modalForm.register("ipPool")}
										size="sm"
										placeholder="198.18.0.0/16"
									/>
								</FormControl>
								<FormControl>
									<FormLabel>{t("pages.xray.fakedns.poolSize")}</FormLabel>
									<Controller
										control={modalForm.control}
										name="poolSize"
										render={({ field }) => (
											<NumericInput
												value={field.value ?? ""}
												onChange={(value) => field.onChange(value)}
												size="sm"
												min={1}
												fieldProps={{ placeholder: "100" }}
											/>
										)}
									/>
								</FormControl>
							</VStack>
						</XrayDialogSection>
					</XrayModalBody>
					<XrayModalFooter justifyContent="flex-end">
						<Button variant="outline" onClick={onClose}>
							{t("cancel")}
						</Button>
						<Button type="submit" colorScheme="primary" size="sm">
							{isEdit
								? t("pages.xray.fakedns.edit")
								: t("pages.xray.fakedns.add")}
						</Button>
					</XrayModalFooter>
				</form>
			</XrayModalContent>
		</Modal>
	);
};
