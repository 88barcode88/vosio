// The old resource stays retired; new resource metadata lives beside its Function.
export async function GET() { return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } }); }
