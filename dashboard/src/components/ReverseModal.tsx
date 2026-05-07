import {
	Button,
	Checkbox,
	CheckboxGroup,
	FormControl,
	FormErrorMessage,
	FormHelperText,
	FormLabel,
	Input,
	Modal,
	ModalCloseButton,
	ModalOverlay,
	Select,
	VStack,
	Wrap,
	WrapItem,
} from "@chakra-ui/react";
import { type FC, useEffect, useMemo } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import {
	XrayDialogSection,
	XrayModalBody,
	XrayModalContent,
	XrayModalFooter,
	XrayModalHeader,
} from "./xray/XrayDialog";

export type ReverseType = "bridge" | "portal";

export type ReverseFormValues = {
	type: ReverseType;
	tag: string;
	domain: string;
	interconnectionOutboundTag: string;
	outboundTag: string;
	interconnectionInboundTags: string[];
	inboundTags: string[];
};

interface ReverseModalProps {
	isOpen: boolean;
	onClose: () => void;
	mode: "create" | "edit";
	initialReverse?: ReverseFormValues | null;
	inboundTags: string[];
	outboundTags: string[];
	existingTags: string[];
	reverseCount: number;
	onSubmit: (values: ReverseFormValues) => void;
}

const defaultReverseFormValues = (reverseCount: number): ReverseFormValues => ({
	type: "bridge",
	tag: `reverse-${reverseCount}`,
	domain: "reverse.xui",
	interconnectionOutboundTag: "",
	outboundTag: "",
	interconnectionInboundTags: [],
	inboundTags: [],
});

export const ReverseModal: FC<ReverseModalProps> = ({
	isOpen,
	onClose,
	mode,
	initialReverse,
	inboundTags,
	outboundTags,
	existingTags,
	reverseCount,
	onSubmit,
}) => {
	const { t } = useTranslation();
	const modalForm = useForm<ReverseFormValues>({
		defaultValues: defaultReverseFormValues(reverseCount),
	});

	useEffect(() => {
		if (!isOpen) return;
		modalForm.reset(
			initialReverse
				? {
						...defaultReverseFormValues(reverseCount),
						...initialReverse,
						tag: initialReverse.tag ?? "",
						domain: initialReverse.domain ?? "",
						interconnectionInboundTags:
							initialReverse.interconnectionInboundTags ?? [],
						inboundTags: initialReverse.inboundTags ?? [],
					}
				: defaultReverseFormValues(reverseCount),
		);
	}, [initialReverse, isOpen, modalForm, reverseCount]);

	const type = modalForm.watch("type");
	const tag = modalForm.watch("tag");
	const domain = modalForm.watch("domain");
	const interconnectionOutboundTag = modalForm.watch(
		"interconnectionOutboundTag",
	);
	const outboundTag = modalForm.watch("outboundTag");
	const interconnectionInboundTags =
		modalForm.watch("interconnectionInboundTags") ?? [];
	const inboundTagsValue = modalForm.watch("inboundTags") ?? [];

	const tagTrimmed = tag.trim();
	const domainTrimmed = domain.trim();
	const duplicateTag = existingTags.includes(tagTrimmed);
	const tagInvalid = !tagTrimmed || duplicateTag;
	const domainInvalid = !domainTrimmed;
	const bridgeInvalid =
		type === "bridge" && (!interconnectionOutboundTag || !outboundTag);
	const portalInvalid =
		type === "portal" &&
		(interconnectionInboundTags.length === 0 || inboundTagsValue.length === 0);

	const isValid = useMemo(
		() => !tagInvalid && !domainInvalid && !bridgeInvalid && !portalInvalid,
		[tagInvalid, domainInvalid, bridgeInvalid, portalInvalid],
	);

	const onSubmitInternal = modalForm.handleSubmit((data) => {
		if (!isValid) return;
		onSubmit({
			...data,
			tag: data.tag.trim(),
			domain: data.domain.trim().replace(/^full:/, ""),
			interconnectionInboundTags: data.interconnectionInboundTags ?? [],
			inboundTags: data.inboundTags ?? [],
		});
	});

	return (
		<Modal isOpen={isOpen} onClose={onClose} size="2xl" scrollBehavior="inside">
			<ModalOverlay bg="blackAlpha.400" backdropFilter="blur(8px)" />
			<XrayModalContent mx="3">
				<XrayModalHeader>
					{mode === "edit"
						? t("pages.xray.reverse.edit", "Edit Reverse")
						: t("pages.xray.reverse.add", "Add Reverse")}
				</XrayModalHeader>
				<ModalCloseButton />
				<form onSubmit={onSubmitInternal}>
					<XrayModalBody>
						<VStack spacing={4} align="stretch">
							<XrayDialogSection
								title={t("pages.xray.reverse.title", "Reverse")}
							>
								<VStack spacing={4} align="stretch">
									<FormControl>
										<FormLabel>
											{t("pages.xray.reverse.type", "Type")}
										</FormLabel>
										<Select {...modalForm.register("type")} size="sm">
											<option value="bridge">
												{t("pages.xray.reverse.bridge", "Bridge")}
											</option>
											<option value="portal">
												{t("pages.xray.reverse.portal", "Portal")}
											</option>
										</Select>
									</FormControl>

									<FormControl isInvalid={tagInvalid}>
										<FormLabel>{t("pages.xray.reverse.tag", "Tag")}</FormLabel>
										<Input
											{...modalForm.register("tag")}
											size="sm"
											placeholder="reverse-0"
										/>
										{tagInvalid ? (
											<FormErrorMessage>
												{duplicateTag
													? t(
															"pages.xray.reverse.tagDuplicate",
															"This reverse tag already exists.",
														)
													: t(
															"pages.xray.reverse.tagError",
															"Reverse tag is required.",
														)}
											</FormErrorMessage>
										) : (
											<FormHelperText>
												{t(
													"pages.xray.reverse.tagHint",
													"Unique tag for this reverse entry.",
												)}
											</FormHelperText>
										)}
									</FormControl>

									<FormControl isInvalid={domainInvalid}>
										<FormLabel>
											{t("pages.xray.reverse.domain", "Domain")}
										</FormLabel>
										<Input
											{...modalForm.register("domain")}
											size="sm"
											placeholder="reverse.xui"
										/>
										<FormErrorMessage>
											{t(
												"pages.xray.reverse.domainError",
												"Domain is required.",
											)}
										</FormErrorMessage>
									</FormControl>
								</VStack>
							</XrayDialogSection>

							{type === "bridge" ? (
								<XrayDialogSection
									title={t("pages.xray.reverse.bridge", "Bridge")}
								>
									<VStack spacing={4} align="stretch">
										<FormControl isInvalid={!interconnectionOutboundTag}>
											<FormLabel>
												{t(
													"pages.xray.reverse.interconnection",
													"Interconnection",
												)}
											</FormLabel>
											<Select
												{...modalForm.register("interconnectionOutboundTag")}
												size="sm"
												placeholder={t(
													"pages.xray.reverse.selectOutbound",
													"Select outbound tag",
												)}
											>
												{outboundTags.map((tag) => (
													<option key={tag} value={tag}>
														{tag}
													</option>
												))}
											</Select>
											<FormErrorMessage>
												{t(
													"pages.xray.reverse.outboundRequired",
													"Select an outbound tag.",
												)}
											</FormErrorMessage>
										</FormControl>
										<FormControl isInvalid={!outboundTag}>
											<FormLabel>{t("pages.xray.rules.outbound")}</FormLabel>
											<Select
												{...modalForm.register("outboundTag")}
												size="sm"
												placeholder={t(
													"pages.xray.reverse.selectOutbound",
													"Select outbound tag",
												)}
											>
												{outboundTags.map((tag) => (
													<option key={tag} value={tag}>
														{tag}
													</option>
												))}
											</Select>
											<FormErrorMessage>
												{t(
													"pages.xray.reverse.outboundRequired",
													"Select an outbound tag.",
												)}
											</FormErrorMessage>
										</FormControl>
									</VStack>
								</XrayDialogSection>
							) : (
								<XrayDialogSection
									title={t("pages.xray.reverse.portal", "Portal")}
								>
									<VStack spacing={4} align="stretch">
										<FormControl
											isInvalid={interconnectionInboundTags.length === 0}
										>
											<FormLabel>
												{t(
													"pages.xray.reverse.interconnection",
													"Interconnection",
												)}
											</FormLabel>
											<Controller
												name="interconnectionInboundTags"
												control={modalForm.control}
												render={({ field }) => (
													<CheckboxGroup
														value={field.value ?? []}
														onChange={(values) => field.onChange(values)}
													>
														<Wrap spacing={3}>
															{inboundTags.map((tag) => (
																<WrapItem key={tag}>
																	<Checkbox value={tag} size="sm">
																		{tag}
																	</Checkbox>
																</WrapItem>
															))}
														</Wrap>
													</CheckboxGroup>
												)}
											/>
											<FormErrorMessage>
												{t(
													"pages.xray.reverse.inboundRequired",
													"Select at least one inbound tag.",
												)}
											</FormErrorMessage>
										</FormControl>
										<FormControl isInvalid={inboundTagsValue.length === 0}>
											<FormLabel>{t("pages.xray.rules.inbound")}</FormLabel>
											<Controller
												name="inboundTags"
												control={modalForm.control}
												render={({ field }) => (
													<CheckboxGroup
														value={field.value ?? []}
														onChange={(values) => field.onChange(values)}
													>
														<Wrap spacing={3}>
															{inboundTags.map((tag) => (
																<WrapItem key={tag}>
																	<Checkbox value={tag} size="sm">
																		{tag}
																	</Checkbox>
																</WrapItem>
															))}
														</Wrap>
													</CheckboxGroup>
												)}
											/>
											<FormErrorMessage>
												{t(
													"pages.xray.reverse.inboundRequired",
													"Select at least one inbound tag.",
												)}
											</FormErrorMessage>
										</FormControl>
									</VStack>
								</XrayDialogSection>
							)}
						</VStack>
					</XrayModalBody>
					<XrayModalFooter justifyContent="flex-end">
						<Button variant="outline" onClick={onClose}>
							{t("cancel")}
						</Button>
						<Button
							type="submit"
							colorScheme="primary"
							size="sm"
							isDisabled={!isValid}
						>
							{mode === "edit"
								? t("pages.xray.reverse.edit", "Edit Reverse")
								: t("pages.xray.reverse.add", "Add Reverse")}
						</Button>
					</XrayModalFooter>
				</form>
			</XrayModalContent>
		</Modal>
	);
};
