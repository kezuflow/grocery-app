/** Local browser-test ingress only. Financial events still use Core's verified webhook. */
export default {
  fetch(request: Request, env: BrowserGatewayEnv): Promise<Response> {
    const path = new URL(request.url).pathname;
    return path === "/webhooks/payments/mock" || path === "/__e2e/scheduled"
      ? env.PAYMENT_WEBHOOK.fetch(request)
      : env.WEB.fetch(request);
  },
};
