import { z } from "zod";

// Xray accepts extension keys, so the API boundary validates only its top-level shape.
export const coreConfigSchema = z.record(z.string(), z.unknown());

export type CoreConfig = z.infer<typeof coreConfigSchema>;

export const parseCoreConfig = (value: unknown): CoreConfig =>
	coreConfigSchema.parse(value);
