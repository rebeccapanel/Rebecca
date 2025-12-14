import {
	Button,
	FormControl,
	FormLabel,
	Input,
	Modal,
	ModalBody,
	ModalCloseButton,
	ModalContent,
	ModalHeader,
	ModalOverlay,
	Text,
	VStack,
} from "@chakra-ui/react";
import type { FC } from "react";
import type { UseFormReturn } from "react-hook-form";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

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
	fakeDnsIndex?: number;
}

export const FakeDnsModal: FC<FakeDnsModalProps> = ({
	isOpen,
	onClose,
	form,
	setFakeDns,
	fakeDnsIndex,
}) => {
	const { t } = useTranslation();
	const modalForm = useForm<FakeDnsFormValues>({
		defaultValues: {
			ipPool: "",
			poolSize: "",
		},
	});

	const handleSubmit = modalForm.handleSubmit((data) => {
		const newFakeDns = {
			ipPool: data.ipPool,
			poolSize: parseInt(data.poolSize, 10),
		};

		const currentFakeDns: FakeDnsConfig[] =
			(form.getValues("config.fakedns") as FakeDnsConfig[] | undefined) || [];
		if (fakeDnsIndex !== undefined) {
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
		<Modal isOpen={isOpen} onClose={onClose} size="sm">
			<ModalOverlay bg="blackAlpha.300" backdropFilter="blur(10px)" />
			<ModalContent mx="3">
				<ModalHeader pt={6}>
					<Text fontWeight="semibold" fontSize="lg">
						{fakeDnsIndex !== undefined
							? t("pages.xray.fakedns.edit")
							: t("pages.xray.fakedns.add")}
					</Text>
				</ModalHeader>
				<ModalCloseButton mt={3} />
				<ModalBody>
					<form onSubmit={handleSubmit}>
						<VStack spacing={4}>
							<FormControl>
								<FormLabel>{t("pages.xray.fakedns.ipPool")}</FormLabel>
								<Input
									{...modalForm.register("ipPool")}
									size="sm"
									placeholder="192.168.0.0/16"
								/>
							</FormControl>
							<FormControl>
								<FormLabel>{t("pages.xray.fakedns.poolSize")}</FormLabel>
								<Input
									{...modalForm.register("poolSize")}
									size="sm"
									placeholder="100"
								/>
							</FormControl>
							<Button type="submit" colorScheme="primary" size="sm">
								{fakeDnsIndex !== undefined
									? t("pages.xray.fakedns.edit")
									: t("pages.xray.fakedns.add")}
							</Button>
						</VStack>
					</form>
				</ModalBody>
			</ModalContent>
		</Modal>
	);
};
