import { fetch } from "./http";

export type VlessEncAuthBlock = {
	label: string;
	encryption?: string;
	decryption?: string;
};

export type VlessEncResponse = {
	auths: VlessEncAuthBlock[];
};

export type RealityKeypairResponse = {
	privateKey: string;
	publicKey: string;
};

export type RealityShortIdResponse = {
	shortId: string;
};

export const getVlessEncAuthBlocks = async (): Promise<VlessEncResponse> => {
	return fetch<VlessEncResponse>("/xray/vlessenc");
};

export const generateRealityKeypair =
	async (): Promise<RealityKeypairResponse> => {
		return fetch<RealityKeypairResponse>("/xray/reality-keypair");
	};

export const generateRealityShortId =
	async (): Promise<RealityShortIdResponse> => {
		return fetch<RealityShortIdResponse>("/xray/reality-shortid");
	};
