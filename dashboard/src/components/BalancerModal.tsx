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
	Select,
	Text,
	VStack,
} from "@chakra-ui/react";
import type { FC } from "react";
import type { UseFormReturn } from "react-hook-form";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

type BalancerFormValues = {
	tag: string;
	strategy: string;
	selector: string;
	fallbackTag: string;
};

type BalancerConfig = {
	tag: string;
	strategy: { type: string };
	selector: string[];
	fallbackTag: string;
};

type BalancerRow = {
	key: number;
	tag: string;
	strategy: string;
	selector: string[];
	fallbackTag: string;
};

interface BalancerModalProps {
	isOpen: boolean;
	onClose: () => void;
	form: UseFormReturn<any>;
	setBalancersData: (data: BalancerRow[]) => void;
	balancerIndex?: number;
}

export const BalancerModal: FC<BalancerModalProps> = ({
	isOpen,
	onClose,
	form,
	setBalancersData,
	balancerIndex,
}) => {
	const { t } = useTranslation();
	const modalForm = useForm<BalancerFormValues>({
		defaultValues: {
			tag: "",
			strategy: "random",
			selector: "",
			fallbackTag: "",
		},
	});

	const handleSubmit = modalForm.handleSubmit((data) => {
		const newBalancer = {
			tag: data.tag,
			strategy: { type: data.strategy },
			selector: data.selector ? data.selector.split(",") : [],
			fallbackTag: data.fallbackTag,
		};

		const currentBalancers: BalancerConfig[] =
			form.getValues("config.routing.balancers") || [];
		if (balancerIndex !== undefined) {
			currentBalancers[balancerIndex] = newBalancer;
		} else {
			currentBalancers.push(newBalancer);
		}

		form.setValue("config.routing.balancers", currentBalancers, {
			shouldDirty: true,
		});
		setBalancersData(
			currentBalancers.map((b, index) => ({
				key: index,
				tag: b.tag || "",
				strategy: b.strategy?.type || "random",
				selector: b.selector || [],
				fallbackTag: b.fallbackTag || "",
			})),
		);
		onClose();
	});

	return (
		<Modal isOpen={isOpen} onClose={onClose} size="sm">
			<ModalOverlay bg="blackAlpha.300" backdropFilter="blur(10px)" />
			<ModalContent mx="3">
				<ModalHeader pt={6}>
					<Text fontWeight="semibold" fontSize="lg">
						{balancerIndex !== undefined
							? t("pages.xray.balancer.editBalancer")
							: t("pages.xray.balancer.addBalancer")}
					</Text>
				</ModalHeader>
				<ModalCloseButton mt={3} />
				<ModalBody>
					<form onSubmit={handleSubmit}>
						<VStack spacing={4}>
							<FormControl>
								<FormLabel>{t("pages.xray.balancer.tag")}</FormLabel>
								<Input
									{...modalForm.register("tag")}
									size="sm"
									placeholder="balancer-tag"
								/>
							</FormControl>
							<FormControl>
								<FormLabel>
									{t("pages.xray.balancer.balancerStrategy")}
								</FormLabel>
								<Select {...modalForm.register("strategy")} size="sm">
									{["random", "roundRobin", "leastLoad", "leastPing"].map(
										(s) => (
											<option key={s} value={s}>
												{s}
											</option>
										),
									)}
								</Select>
							</FormControl>
							<FormControl>
								<FormLabel>
									{t("pages.xray.balancer.balancerSelectors")}
								</FormLabel>
								<Input
									{...modalForm.register("selector")}
									size="sm"
									placeholder="tag1,tag2"
								/>
							</FormControl>
							<FormControl>
								<FormLabel>{t("pages.xray.balancer.fallbackTag")}</FormLabel>
								<Input
									{...modalForm.register("fallbackTag")}
									size="sm"
									placeholder="fallback-tag"
								/>
							</FormControl>
							<Button type="submit" colorScheme="primary" size="sm">
								{balancerIndex !== undefined
									? t("pages.xray.balancer.editBalancer")
									: t("pages.xray.balancer.addBalancer")}
							</Button>
						</VStack>
					</form>
				</ModalBody>
			</ModalContent>
		</Modal>
	);
};
