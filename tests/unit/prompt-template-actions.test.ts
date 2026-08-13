import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialPromptTemplateActionState } from "@/lib/prompt-templates/action-state";
import { duplicatePromptTemplateAction } from "@/lib/prompt-templates/actions";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  revalidatePath: vi.fn()
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

const userId = "00000000-0000-4000-8000-000000000701";
const systemId = "00000000-0000-4000-8000-000000000702";
const copyId = "00000000-0000-4000-8000-000000000703";

// createChain produces one minimal PostgREST-style query for action security tests.
function createChain(result: unknown) {
  const chain = {
    eq: vi.fn(),
    insert: vi.fn(),
    maybeSingle: vi.fn(),
    select: vi.fn()
  };
  chain.eq.mockReturnValue(chain);
  chain.insert.mockReturnValue(chain);
  chain.select.mockReturnValue(chain);
  chain.maybeSingle.mockResolvedValue(result);
  return chain;
}

beforeEach(() => vi.resetAllMocks());

describe("duplicate system prompt", () => {
  it("fetches the authoritative system row and ignores tampered submitted prompt fields", async () => {
    const authoritative = {
      id: systemId,
      is_system: true,
      name: "Systémové shrnutí",
      output_schema: { type: "object" },
      processing_type: "summary",
      prompt_text: "Autoritativní systémový prompt s dostatečnou délkou."
    };
    const lookup = createChain({ data: authoritative, error: null });
    const insert = createChain({ data: { id: copyId }, error: null });
    const from = vi.fn()
      .mockReturnValueOnce(lookup)
      .mockReturnValueOnce(insert);
    mocks.createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null }) },
      from
    });
    const formData = new FormData();
    formData.set("templateId", systemId);
    formData.set("name", "PODVRŽENÝ NÁZEV");
    formData.set("processingType", "custom_prompt");
    formData.set("promptText", "Podvržený obsah s dostatečnou délkou, který se nesmí uložit.");
    formData.set("outputSchema", '{"leak":true}');

    const result = await duplicatePromptTemplateAction(
      createInitialPromptTemplateActionState(),
      formData
    );

    expect(lookup.eq).toHaveBeenNthCalledWith(1, "id", systemId);
    expect(lookup.eq).toHaveBeenNthCalledWith(2, "is_system", true);
    expect(insert.insert).toHaveBeenCalledWith({
      is_system: false,
      name: "Systémové shrnutí - vlastní",
      output_schema: { type: "object" },
      processing_type: "summary",
      prompt_text: authoritative.prompt_text,
      user_id: userId
    });
    expect(JSON.stringify(insert.insert.mock.calls)).not.toContain("PODVRŽENÝ");
    expect(result).toMatchObject({ status: "success", templateId: copyId });
  });

  it("does not insert when the authoritative system lookup is missing", async () => {
    const lookup = createChain({ data: null, error: null });
    const insert = createChain({ data: { id: copyId }, error: null });
    const from = vi.fn().mockReturnValueOnce(lookup).mockReturnValueOnce(insert);
    mocks.createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null }) },
      from
    });
    const formData = new FormData();
    formData.set("templateId", systemId);

    const result = await duplicatePromptTemplateAction(
      createInitialPromptTemplateActionState(),
      formData
    );

    expect(result).toMatchObject({ status: "error", templateId: null });
    expect(from).toHaveBeenCalledTimes(1);
    expect(insert.insert).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
