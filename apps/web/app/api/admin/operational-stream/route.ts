/** The Worker entrypoint handles upgrades before vinext handles HTTP routes. */
export function GET(): Response {
  return new Response(null, { status: 426 });
}
