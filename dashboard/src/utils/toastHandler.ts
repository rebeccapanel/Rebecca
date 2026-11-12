import type { FieldValues, UseFormReturn } from "react-hook-form";
import type { toast as sonnerToast } from "components/ui/sonner";
import { getAPIErrorMessage } from "service/http";

type ErrorRecord = Record<string, unknown>;
type ToastFunction = typeof sonnerToast;

const asRecord = (value: unknown): ErrorRecord | undefined =>
	value && typeof value === "object" ? (value as ErrorRecord) : undefined;

const firstErrorText = (...values: unknown[]): string | undefined => {
	for (const value of values) {
		if (typeof value === "string" && value.trim()) {
			return value.trim();
		}
		const record = asRecord(value);
		if (!record) continue;
		for (const key of [
			"message",
			"error",
			"detail",
			"title",
			"statusMessage",
			"statusText",
		]) {
			const text = record[key];
			if (typeof text === "string" && text.trim()) {
				return text.trim();
			}
		}
	}
	return undefined;
};

const getErrorMessage = (error: unknown): string | undefined => {
	const errorRecord = asRecord(error);
	const response = asRecord(errorRecord?.response);
	const body = response?._data ?? response?.data;
	return firstErrorText(error, body, response);
};

export const generateErrorMessage = (
	e: unknown,
	toast: ToastFunction,
	form?: UseFormReturn<FieldValues | any>,
) => {
	const errorRecord = asRecord(e);
	const response = asRecord(errorRecord?.response);
	const detail = asRecord(response?._data ?? response?.data)?.detail;
	if (detail && typeof detail === "object" && form) {
		const validationDetail = detail as Record<string, string>;
		if (Object.keys(validationDetail).length > 0) {
			Object.keys(validationDetail).forEach((errorKey) => {
				form.setError(errorKey, {
					message: validationDetail[errorKey],
				});
			});
			return;
		}
	}
	const validationMessage =
		detail && typeof detail === "object"
			? Object.entries(detail as Record<string, unknown>)
					.map(([key, value]) =>
						typeof value === "string" ? `${key}: ${value}` : "",
					)
					.filter(Boolean)
					.join(", ")
			: undefined;
	const message = validationMessage || getAPIErrorMessage(e) || getErrorMessage(e);
	const status = response?.status;
	return toast.error(message ??
			(typeof status === "number"
				? `Request failed (HTTP ${status})`
				: "Request failed"), { duration: 3000 });
};

export const generateSuccessMessage = (
	message: string,
	toast: ToastFunction,
) => {
	return toast.success(message, { duration: 5000 });
};
