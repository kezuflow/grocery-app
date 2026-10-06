/** Local browser-test ingress only. Provider events use Core's verified webhooks. */
export default {
  fetch(request: Request, env: BrowserGatewayEnv): Promise<Response> {
    const path = new URL(request.url).pathname;
    return path === "/webhooks/payments/mock" ||
      path === "/webhooks/delivery/lalamove" ||
      path === "/__e2e/scheduled"
      ? env.PAYMENT_WEBHOOK.fetch(request)
      : env.WEB.fetch(request);
  },
};
