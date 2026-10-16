import { createFileRoute } from "@tanstack/react-router";

import { proxyAdminApiRequest } from "@/server/api-proxy";

const handler = ({ request }: { request: Request }) => proxyAdminApiRequest(request);

export const Route = createFileRoute("/api/v1/admin/$")({
  server: {
    handlers: {
      DELETE: handler,
      GET: handler,
      PATCH: handler,
      POST: handler,
      PUT: handler,
    },
  },
});
