import type { CreateToastFnReturn } from "@chakra-ui/react";
import type { FieldValues, UseFormReturn } from "react-hook-form";

export const generateErrorMessage = (
	e: unknown,
	toast: CreateToastFnReturn,
	form?: UseFormReturn<FieldValues | any>,
) => {
	if (e && typeof e === "object" && "response" in e) {
		const response = (e as { response?: { _data?: unknown } }).response;
		const detail = response?._data as
			| string
			| { detail?: string }
			| { [key: string]: string };
		if (typeof detail === "string") {
			return toast({
				title: detail,
				status: "error",
				isClosable: true,
				position: "top",
				duration: 3000,
			});
		}
		if (
			response?._data &&
			typeof (detail as { detail?: unknown })?.detail === "object" &&
			form
		) {
			const validationDetail = (detail as { detail?: Record<string, string> })
				.detail;
			if (validationDetail) {
				Object.keys(validationDetail).forEach((errorKey) => {
					form.setError(errorKey, {
						message: validationDetail[errorKey],
					});
				});
			}
			return;
		}
	}
	return toast({
		title: "Something went wrong!",
		status: "error",
		isClosable: true,
		position: "top",
		duration: 3000,
	});
};

export const generateSuccessMessage = (
	message: string,
	toast: CreateToastFnReturn,
) => {
	return toast({
		title: message,
		status: "success",
		isClosable: true,
		position: "top",
		duration: 3000,
	});
};
