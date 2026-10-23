import { handleRequest } from './gateway.js';
import { AGENT_PATH, connectAgent, relayStub } from './relay.js';

// workerd treats every export of the entry module as an entrypoint: export only the handler and the DO class.
export { AgentRelay } from './relay.js';

export default {
  fetch(request, env) {
    if (new URL(request.url).pathname === AGENT_PATH) return connectAgent(request, env);
    return handleRequest(request, {
      accessToken: env.ACCESS_TOKEN,
      upstream: env.RELAY ? relayStub(env) : null,
    });
  },
};
