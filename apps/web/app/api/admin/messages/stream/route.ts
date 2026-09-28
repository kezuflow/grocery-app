export function GET() {
  return new Response("WebSocket upgrade required", { status: 426 });
}
