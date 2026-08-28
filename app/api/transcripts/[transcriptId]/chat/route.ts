import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  CHAT_QUESTION_MAX_CHARS,
  RecordingChatServiceError,
  createRecordingChatStore,
  getRecordingChatHistory,
  submitRecordingChatTurn
} from "@/lib/ai/chat-service.server";
import { aiModelIds } from "@/lib/model-options";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const routeParamsSchema = z.object({ transcriptId: z.uuid() });
const requestBodySchema = z.object({
  clientTurnId: z.uuid(),
  model: z.enum(aiModelIds),
  question: z.string().trim().min(1).max(CHAT_QUESTION_MAX_CHARS)
}).strict();

type RouteContext = {
  params: Promise<{ transcriptId: string }>;
};

// getAuthenticatedChatRequest validates the route identity and obtains a trusted Supabase user.
async function getAuthenticatedChatRequest(context: RouteContext) {
  const params = routeParamsSchema.safeParse(await context.params);

  if (!params.success) {
    return { error: NextResponse.json({ error: "Neplatné ID přepisu." }, { status: 400 }) };
  }

  const authenticated = await createClient();
  const { data: { user }, error } = await authenticated.auth.getUser();

  if (error || !user) {
    return { error: NextResponse.json({ error: "Nejste přihlášený." }, { status: 401 }) };
  }

  return { authenticated, transcriptId: params.data.transcriptId, user };
}

// serviceErrorResponse maps known service states to stable content-free HTTP responses.
function serviceErrorResponse(error: unknown) {
  if (error instanceof RecordingChatServiceError) {
    return NextResponse.json(
      { error: error.publicMessage },
      {
        headers: error.retryAfterSeconds === undefined
          ? undefined
          : { "Retry-After": String(error.retryAfterSeconds) },
        status: error.status
      }
    );
  }

  console.error("[Vosio recording chat] unexpected_error");
  return NextResponse.json({ error: "Chat se nepodařilo zpracovat." }, { status: 500 });
}

// GET returns only the authenticated owner's safe chat projection.
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const auth = await getAuthenticatedChatRequest(context);

    if (auth.error) return auth.error;
    const admin = createAdminClient();
    const store = createRecordingChatStore(auth.authenticated, admin);
    const history = await getRecordingChatHistory({
      transcriptId: auth.transcriptId,
      userId: auth.user.id
    }, { store });

    return NextResponse.json(history);
  } catch (error) {
    return serviceErrorResponse(error);
  }
}

// POST validates the narrow browser contract and submits one idempotent server-owned chat turn.
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const params = routeParamsSchema.safeParse(await context.params);

    if (!params.success) {
      return NextResponse.json({ error: "Neplatné ID přepisu." }, { status: 400 });
    }

    const body = requestBodySchema.safeParse(await request.json().catch(() => null));

    if (!body.success) {
      return NextResponse.json({ error: "Neplatný požadavek na chat." }, { status: 400 });
    }

    const auth = await getAuthenticatedChatRequest({ params: Promise.resolve(params.data) });

    if (auth.error) return auth.error;
    const admin = createAdminClient();
    const store = createRecordingChatStore(auth.authenticated, admin);
    const result = await submitRecordingChatTurn({
      clientTurnId: body.data.clientTurnId,
      model: body.data.model,
      question: body.data.question,
      transcriptId: auth.transcriptId,
      userId: auth.user.id
    }, { store });

    return NextResponse.json(result);
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
