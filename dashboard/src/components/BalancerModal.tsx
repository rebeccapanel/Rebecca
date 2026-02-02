import {
	Box,
	Button,
	FormControl,
	FormErrorMessage,
	FormHelperText,
	FormLabel,
	HStack,
	Input,
	Modal,
	ModalBody,
	ModalCloseButton,
	ModalContent,
	ModalHeader,
	ModalOverlay,
	Select,
	Tag,
	TagCloseButton,
	TagLabel,
	Text,
	VStack,
	Wrap,
	WrapItem,
} from "@chakra-ui/react";
import { type FC, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

export type BalancerFormValues = {
	tag: string;
	strategy: string;
	selector: string[];
	fallbackTag: string;
};

interface BalancerModalProps {
	isOpen: boolean;
	onClose: () => void;
	mode: "create" | "edit";
	initialBalancer?: BalancerFormValues | null;
	outboundTags: string[];
	existingTags: string[];
	onSubmit: (values: BalancerFormValues) => void;
}

const DEFAULT_BALANCER: BalancerFormValues = {
	tag: "",
	strategy: "random",
	selector: [],
	fallbackTag: "",
};

const parseTags = (value: string) =>
	value
		.split(/[\s,]+/)
		.map((item) => item.trim())
		.filter(Boolean);

const uniq = (values: string[]) => Array.from(new Set(values));

export const BalancerModal: FC<BalancerModalProps> = ({
	isOpen,
	onClose,
	mode,
	initialBalancer,
	outboundTags,
	existingTags,
	onSubmit,
}) => {
	const { t } = useTranslation();
	const [selectorInput, setSelectorInput] = useState("");
	const [selectorPick, setSelectorPick] = useState("");

	const modalForm = useForm<BalancerFormValues>({
		defaultValues: DEFAULT_BALANCER,
	});

	useEffect(() => {
		modalForm.register("selector");
	}, [modalForm]);

	const tagValue = modalForm.watch("tag");
	const selectorValue = modalForm.watch("selector") ?? [];
	const normalizedTag = tagValue.trim();
	const duplicateTag = !normalizedTag || existingTags.includes(normalizedTag);
	const emptySelector = selectorValue.length === 0;

	useEffect(() => {
		if (!isOpen) return;
		modalForm.reset(
			initialBalancer
				? {
						...DEFAULT_BALANCER,
						...initialBalancer,
						tag: initialBalancer.tag ?? "",
						selector: initialBalancer.selector ?? [],
						fallbackTag: initialBalancer.fallbackTag ?? "",
					}
				: DEFAULT_BALANCER,
		);
		setSelectorInput("");
		setSelectorPick("");
	}, [initialBalancer, isOpen, modalForm]);

	const addSelectorTags = (value: string) => {
		const tags = parseTags(value);
		if (tags.length === 0) return;
		const merged = uniq([...(selectorValue ?? []), ...tags]);
		modalForm.setValue("selector", merged, { shouldDirty: true });
	};

	const removeSelectorTag = (tag: string) => {
		modalForm.setValue(
			"selector",
			(selectorValue ?? []).filter((item) => item !== tag),
			{ shouldDirty: true },
		);
	};

	const addSelectedOutboundTag = (value: string) => {
		if (!value) return;
		addSelectorTags(value);
		setSelectorPick("");
	};

	const onSubmitInternal = modalForm.handleSubmit((data) => {
		if (!isValid) return;
		const payload: BalancerFormValues = {
			tag: data.tag.trim(),
			strategy: data.strategy,
			selector: uniq(data.selector.map((item) => item.trim()).filter(Boolean)),
			fallbackTag: data.fallbackTag ?? "",
		};
		onSubmit(payload);
	});

	const isValid = useMemo(
		() => !duplicateTag && !emptySelector,
		[duplicateTag, emptySelector],
	);

	return (
		<Modal isOpen={isOpen} onClose={onClose} size="md">
			<ModalOverlay bg="blackAlpha.300" backdropFilter="blur(10px)" />
			<ModalContent mx="3">
				<ModalHeader pt={6}>
					<Text fontWeight="semibold" fontSize="lg">
						{mode === "edit"
							? t("pages.xray.balancer.editBalancer")
							: t("pages.xray.balancer.addBalancer")}
					</Text>
				</ModalHeader>
				<ModalCloseButton mt={3} />
				<ModalBody>
					<form onSubmit={onSubmitInternal}>
						<VStack spacing={4}>
							<FormControl isInvalid={duplicateTag}>
								<FormLabel>{t("pages.xray.balancer.tag")}</FormLabel>
								<Input
									{...modalForm.register("tag")}
									size="sm"
									placeholder={t("pages.xray.balancer.tagDesc")}
								/>
								{duplicateTag ? (
									<FormErrorMessage>
										{t("pages.xray.balancer.tagError")}
									</FormErrorMessage>
								) : (
									<FormHelperText>
										{t("pages.xray.balancer.tagDesc")}
									</FormHelperText>
								)}
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
							<FormControl isInvalid={emptySelector}>
								<FormLabel>
									{t("pages.xray.balancer.balancerSelectors")}
								</FormLabel>
								<VStack align="stretch" spacing={2}>
									{outboundTags.length > 0 && (
										<HStack>
											<Select
												size="sm"
												placeholder={t(
													"pages.xray.balancer.selectOutbound",
													"Select outbound tag",
												)}
												value={selectorPick}
												onChange={(event) =>
													addSelectedOutboundTag(event.target.value)
												}
											>
												{outboundTags.map((tag) => (
													<option key={tag} value={tag}>
														{tag}
													</option>
												))}
											</Select>
										</HStack>
									)}
									<HStack>
										<Input
											size="sm"
											value={selectorInput}
											onChange={(event) => setSelectorInput(event.target.value)}
											placeholder={t(
												"pages.xray.balancer.selectorPlaceholder",
												"tag1, tag2",
											)}
											onKeyDown={(event) => {
												if (event.key === "Enter") {
													event.preventDefault();
													addSelectorTags(selectorInput);
													setSelectorInput("");
												}
											}}
										/>
										<Button
											size="xs"
											variant="outline"
											onClick={() => {
												addSelectorTags(selectorInput);
												setSelectorInput("");
											}}
										>
											{t("core.add", "Add")}
										</Button>
									</HStack>
									{selectorValue.length > 0 ? (
										<Wrap>
											{selectorValue.map((tag) => (
												<WrapItem key={tag}>
													<Tag size="sm" colorScheme="blue">
														<TagLabel>{tag}</TagLabel>
														<TagCloseButton
															onClick={() => removeSelectorTag(tag)}
														/>
													</Tag>
												</WrapItem>
											))}
										</Wrap>
									) : (
										<Box>
											<Text fontSize="sm" color="gray.500">
												{t(
													"pages.xray.balancer.selectorHint",
													"Choose outbound tags or add custom tags.",
												)}
											</Text>
										</Box>
									)}
								</VStack>
								{emptySelector && (
									<FormErrorMessage>
										{t("pages.xray.balancer.selectorError")}
									</FormErrorMessage>
								)}
							</FormControl>
							<FormControl>
								<FormLabel>{t("pages.xray.balancer.fallbackTag")}</FormLabel>
								<Select {...modalForm.register("fallbackTag")} size="sm">
									<option value="">{t("core.none", "None")}</option>
									{outboundTags.map((tag) => (
										<option key={tag} value={tag}>
											{tag}
										</option>
									))}
								</Select>
							</FormControl>
							<Button
								type="submit"
								colorScheme="primary"
								size="sm"
								isDisabled={!isValid}
							>
								{mode === "edit"
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
