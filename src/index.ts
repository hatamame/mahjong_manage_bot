import { Env, Interaction, InteractionType, ResponseType, respond, ephemeral } from "./types";
import { verifyRequest } from "./verify";
import { handleCommand, handleComponent, handleModal } from "./handlers";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("discord-mahjong bot", { status: 200 });
    }

    const body = await request.text();
    if (!(await verifyRequest(request, body, env.DISCORD_PUBLIC_KEY))) {
      return new Response("invalid signature", { status: 401 });
    }

    const interaction: Interaction = JSON.parse(body);

    try {
      switch (interaction.type) {
        case InteractionType.PING:
          return respond(ResponseType.PONG);
        case InteractionType.APPLICATION_COMMAND:
          return await handleCommand(interaction, env);
        case InteractionType.MESSAGE_COMPONENT:
          return await handleComponent(interaction, env);
        case InteractionType.MODAL_SUBMIT:
          return await handleModal(interaction, env);
        default:
          return new Response("unknown interaction type", { status: 400 });
      }
    } catch (err) {
      console.error(err);
      return ephemeral("⚠️ 内部エラーが発生しました。時間をおいて再度お試しください。");
    }
  },
} satisfies ExportedHandler<Env>;
