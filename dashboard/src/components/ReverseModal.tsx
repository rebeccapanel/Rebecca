import {
	Button,
	FormControl,
	FormErrorMessage,
	FormHelperText,
	FormLabel,
	Input,
	Modal,
	ModalCloseButton,
	ModalOverlay,
	VStack,
} from "@chakra-ui/react";
import { type FC, useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { SearchableTagSelect } from "./common/SearchableTagSelect";
import {
	XrayDialogSection,
	XrayFieldGrid,
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
								<XrayFieldGrid>
									<FormControl>
									<FormLabel>
										{t("pages.xray.reverse.type", "Type")}
									</FormLabel>
										<SearchableTagSelect
											mode="single"
											options={[
												{
													value: "bridge",
													label: t("pages.xray.reverse.bridge", "Bridge"),
												},
												{
													value: "portal",
													label: t("pages.xray.reverse.portal", "Portal"),
												},
											]}
											value={modalForm.watch("type") ?? "bridge"}
											onChange={(value) =>
												modalForm.setValue("type", value as ReverseType, {
													shouldDirty: true,
												})
											}
											placeholder={t("pages.xray.reverse.type", "Type")}
											searchPlaceholder={t("search", "Search")}
										/>
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
								</XrayFieldGrid>
							</XrayDialogSection>

							{type === "bridge" ? (
								<XrayDialogSection
									title={t("pages.xray.reverse.bridge", "Bridge")}
								>
									<XrayFieldGrid>
										<FormControl isInvalid={!interconnectionOutboundTag}>
											<FormLabel>
												{t(
													"pages.xray.reverse.interconnection",
													"Interconnection",
												)}
											</FormLabel>
											<SearchableTagSelect
												mode="single"
												options={outboundTags}
												value={interconnectionOutboundTag}
												onChange={(value) =>
													modalForm.setValue(
														"interconnectionOutboundTag",
														value as string,
														{ shouldDirty: true },
													)
												}
												placeholder={t(
													"pages.xray.reverse.selectOutbound",
													"Select outbound tag",
												)}
												searchPlaceholder={t("search", "Search")}
												emptyText={t(
													"pages.xray.outbound.empty",
													"No outbound found",
												)}
											/>
											<FormErrorMessage>
												{t(
													"pages.xray.reverse.outboundRequired",
													"Select an outbound tag.",
												)}
											</FormErrorMessage>
										</FormControl>
										<FormControl isInvalid={!outboundTag}>
											<FormLabel>{t("pages.xray.rules.outbound")}</FormLabel>
											<SearchableTagSelect
												mode="single"
												options={outboundTags}
												value={outboundTag}
												onChange={(value) =>
													modalForm.setValue("outboundTag", value as string, {
														shouldDirty: true,
													})
												}
												placeholder={t(
													"pages.xray.reverse.selectOutbound",
													"Select outbound tag",
												)}
												searchPlaceholder={t("search", "Search")}
												emptyText={t(
													"pages.xray.outbound.empty",
													"No outbound found",
												)}
											/>
											<FormErrorMessage>
												{t(
													"pages.xray.reverse.outboundRequired",
												"Select an outbound tag.",
											)}
										</FormErrorMessage>
									</FormControl>
									</XrayFieldGrid>
								</XrayDialogSection>
							) : (
								<XrayDialogSection
									title={t("pages.xray.reverse.portal", "Portal")}
								>
									<XrayFieldGrid>
										<FormControl
											isInvalid={interconnectionInboundTags.length === 0}
										>
											<FormLabel>
												{t(
													"pages.xray.reverse.interconnection",
													"Interconnection",
												)}
											</FormLabel>
											<SearchableTagSelect
												mode="multiple"
												options={inboundTags}
												value={interconnectionInboundTags}
												onChange={(value) =>
													modalForm.setValue(
														"interconnectionInboundTags",
														value as string[],
														{ shouldDirty: true },
													)
												}
												placeholder={t(
													"pages.xray.rules.inboundTag",
													"Inbound Tags",
												)}
												searchPlaceholder={t("search", "Search")}
												emptyText={t(
													"pages.inbounds.empty",
													"No inbound found",
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
											<SearchableTagSelect
												mode="multiple"
												options={inboundTags}
												value={inboundTagsValue}
												onChange={(value) =>
													modalForm.setValue("inboundTags", value as string[], {
														shouldDirty: true,
													})
												}
												placeholder={t(
													"pages.xray.rules.inboundTag",
													"Inbound Tags",
												)}
												searchPlaceholder={t("search", "Search")}
												emptyText={t(
													"pages.inbounds.empty",
													"No inbound found",
												)}
											/>
											<FormErrorMessage>
												{t(
													"pages.xray.reverse.inboundRequired",
												"Select at least one inbound tag.",
											)}
										</FormErrorMessage>
									</FormControl>
									</XrayFieldGrid>
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
