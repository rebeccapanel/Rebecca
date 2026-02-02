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

export type EchCertResponse = {
	echServerKeys: string;
	echConfigList: string;
};

export type Mldsa65Response = {
	seed: string;
	verify: string;
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

export const generateEchCert = async (
	sni: string,
): Promise<EchCertResponse> => {
	return fetch<EchCertResponse>("/xray/ech", { query: { sni } });
};

export const generateMldsa65 = async (): Promise<Mldsa65Response> => {
	return fetch<Mldsa65Response>("/xray/mldsa65");
};
