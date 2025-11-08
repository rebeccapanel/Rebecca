import { fetch } from "./http";

export type VlessEncAuthBlock = {
  label: string;
  encryption?: string;
  decryption?: string;
};

export type VlessEncResponse = {
  auths: VlessEncAuthBlock[];
};

export const getVlessEncAuthBlocks = async (): Promise<VlessEncResponse> => {
  return fetch<VlessEncResponse>("/xray/vlessenc");
};
