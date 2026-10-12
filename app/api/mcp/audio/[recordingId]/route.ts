// Audio moved with its resource; old bearer URLs remain closed without redirects.
export async function GET() { return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } }); }
