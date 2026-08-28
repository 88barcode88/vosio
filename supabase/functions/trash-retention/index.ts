import {
  createSupabaseTrashRetentionAdapter,
  createTrashRetentionHandler
} from "./worker.ts";

type EdgeRuntime = {
  env: { get: (name: string) => string | undefined };
  serve: (handler: (request: Request) => Response | Promise<Response>) => void;
};

declare const Deno: EdgeRuntime;

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const adapter = supabaseUrl && serviceRoleKey
  ? createSupabaseTrashRetentionAdapter({ serviceRoleKey, supabaseUrl })
  : null;

const handler = createTrashRetentionHandler({
  adapter,
  env: (name) => Deno.env.get(name),
  // eslint-disable-next-line no-console -- Edge logs must emit only the sanitized aggregate summary.
  logger: (event, summary) => console.info(event, summary)
});

Deno.serve(handler);
