// Pages Functions cannot define Durable Objects, so every dynamic request (including the agent's
// WebSocket upgrade) is handed unchanged to the gateway Worker through the GATEWAY Service binding.
export async function forwardToGateway({ request, env }) {
  if (!env.GATEWAY) {
    return new Response(JSON.stringify({ error: 'upstream_unavailable', message: 'Pages 未绑定网关 Worker' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  return env.GATEWAY.fetch(request);
}
