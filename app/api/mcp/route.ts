export const dynamic = "force-dynamic";
// Retired resource: never redirect a bearer POST to a different origin.
export async function POST() { return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } }); }
export const GET = POST;
export const DELETE = POST;
