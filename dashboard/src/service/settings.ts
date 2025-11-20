import { fetch as apiFetch } from "./http";

export interface TelegramTopicSettingsPayload {
  title: string;
  topic_id?: number | null;
}

export interface TelegramSettingsResponse {
  api_token: string | null;
  use_telegram: boolean;
  proxy_url: string | null;
  admin_chat_ids: number[];
  logs_chat_id: number | null;
  logs_chat_is_forum: boolean;
  default_vless_flow: string | null;
  forum_topics: Record<string, TelegramTopicSettingsPayload>;
  event_toggles: Record<string, boolean>;
}

export interface TelegramSettingsUpdatePayload {
  api_token?: string | null;
  use_telegram?: boolean;
  proxy_url?: string | null;
  admin_chat_ids?: number[];
  logs_chat_id?: number | null;
  logs_chat_is_forum?: boolean;
  default_vless_flow?: string | null;
  forum_topics?: Record<string, TelegramTopicSettingsPayload>;
  event_toggles?: Record<string, boolean>;
}

export const getTelegramSettings = async (): Promise<TelegramSettingsResponse> => {
  return apiFetch("/settings/telegram");
};

export const updateTelegramSettings = async (
  payload: TelegramSettingsUpdatePayload
): Promise<TelegramSettingsResponse> => {
  return apiFetch("/settings/telegram", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
};

export interface PanelSettingsResponse {
  use_nobetci: boolean;
}

export interface PanelSettingsUpdatePayload {
  use_nobetci?: boolean;
}

export const getPanelSettings = async (): Promise<PanelSettingsResponse> => {
  return apiFetch("/settings/panel");
};

export const updatePanelSettings = async (
  payload: PanelSettingsUpdatePayload
): Promise<PanelSettingsResponse> => {
  return apiFetch("/settings/panel", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
};
