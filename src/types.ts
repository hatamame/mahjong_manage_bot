export interface Env {
  DB: D1Database;
  DISCORD_PUBLIC_KEY: string;
}

// ---- Discord Interaction の最小限の型定義 ----

export const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
  MODAL_SUBMIT: 5,
} as const;

export const ResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE: 4,
  UPDATE_MESSAGE: 7,
  MODAL: 9,
} as const;

export const EPHEMERAL = 64;

export interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  bot?: boolean;
}

export interface Interaction {
  type: number;
  guild_id?: string;
  member?: { user: DiscordUser; nick?: string | null };
  user?: DiscordUser;
  message?: { id: string };
  data?: {
    // APPLICATION_COMMAND
    name?: string;
    options?: { name: string; value?: string | number }[];
    // MESSAGE_COMPONENT
    custom_id?: string;
    component_type?: number;
    values?: string[];
    resolved?: {
      users?: Record<string, DiscordUser>;
      members?: Record<string, { nick?: string | null }>;
    };
    // MODAL_SUBMIT
    components?: {
      components: { custom_id: string; value: string }[];
    }[];
  };
}

export interface Embed {
  title?: string;
  description?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
}

export type Component = Record<string, unknown>;

export interface ResponseData {
  content?: string;
  embeds?: Embed[];
  components?: Component[];
  flags?: number;
  // MODAL 用
  custom_id?: string;
  title?: string;
}

export function respond(type: number, data?: ResponseData): Response {
  return new Response(JSON.stringify({ type, data }), {
    headers: { "content-type": "application/json" },
  });
}

export function ephemeral(content: string): Response {
  return respond(ResponseType.CHANNEL_MESSAGE, { content, flags: EPHEMERAL });
}

export function interactionUser(i: Interaction): DiscordUser {
  return (i.member?.user ?? i.user)!;
}

// 暖色系のアクセントカラー
export const COLOR = 0xe8590c;
