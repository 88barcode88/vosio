import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialPromptTemplateActionState } from "@/lib/prompt-templates/action-state";
import {
  resetPromptOverrideAction,
  savePromptOverrideAction,
} from "@/lib/prompt-templates/actions";
import * as promptTemplateActions from "@/lib/prompt-templates/actions";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  redirect: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

const userId = "00000000-0000-4000-8000-000000000701";
const foreignUserId = "00000000-0000-4000-8000-000000000799";
const systemId = "00000000-0000-4000-8000-000000000702";
const promptText = "Najdi pouze potvrzené úkoly a jejich vlastníky.";

// validFormData builds the browser payload while allowing tampered extras for security assertions.
function validFormData(overrides: Record<string, string> = {}) {
  const formData = new FormData();
  for (const [name, value] of Object.entries({
    systemPromptId: systemId,
    revision: "0",
    promptText,
    ...overrides,
  })) {
    formData.set(name, value);
  }
  return formData;
}

// mockAuthenticatedRpc installs one authenticated Supabase RPC response.
function mockAuthenticatedRpc(result: { data: unknown; error: unknown }) {
  const single = vi.fn().mockResolvedValue(result);
  const chain = { returns: vi.fn(), single };
  chain.returns.mockReturnValue(chain);
  const rpc = vi.fn().mockReturnValue(chain);
  mocks.createClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null }),
    },
    rpc,
  });
  return { rpc, single };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.redirect.mockImplementation((url: string) => {
    throw { digest: `NEXT_REDIRECT;replace;${url}` };
  });
});

describe("prompt override actions", () => {
  it("exports only save and reset mutations for the active prompt workspace", () => {
    expect(promptTemplateActions).not.toHaveProperty("createPromptTemplateAction");
    expect(promptTemplateActions).not.toHaveProperty("updatePromptTemplateAction");
    expect(promptTemplateActions).not.toHaveProperty("duplicatePromptTemplateAction");
  });

  it("creates an override with the visible default revision", async () => {
    const { rpc } = mockAuthenticatedRpc({ data: { revision: 1 }, error: null });

    const result = await savePromptOverrideAction(
      createInitialPromptTemplateActionState(),
      validFormData(),
    );

    expect(rpc).toHaveBeenCalledWith("save_prompt_template_override_v1", {
      p_expected_revision: 0,
      p_prompt_text: promptText,
      p_system_prompt_id: systemId,
    });
    expect(result).toEqual({
      status: "success",
      message: "AI prompt je uložený.",
      systemPromptId: systemId,
      revision: 1,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/templates");
  });

  it("updates the same override with its expected revision", async () => {
    const { rpc } = mockAuthenticatedRpc({ data: { revision: 3 }, error: null });

    await savePromptOverrideAction(
      createInitialPromptTemplateActionState(),
      validFormData({ revision: "2" }),
    );

    expect(rpc).toHaveBeenCalledWith("save_prompt_template_override_v1", {
      p_expected_revision: 2,
      p_prompt_text: promptText,
      p_system_prompt_id: systemId,
    });
  });

  it("resets an active override by system id and revision", async () => {
    const { rpc } = mockAuthenticatedRpc({ data: { revision: 4 }, error: null });

    const result = await resetPromptOverrideAction(
      createInitialPromptTemplateActionState(),
      validFormData({ revision: "3" }),
    );

    expect(rpc).toHaveBeenCalledWith("reset_prompt_template_override_v1", {
      p_expected_revision: 3,
      p_system_prompt_id: systemId,
    });
    expect(result).toMatchObject({ status: "success", systemPromptId: systemId, revision: 4 });
  });

  it("maps Postgres 40001 to a reload conflict instead of overwriting", async () => {
    mockAuthenticatedRpc({
      data: null,
      error: { code: "40001", message: "prompt override conflict" },
    });

    const result = await savePromptOverrideAction(
      createInitialPromptTemplateActionState(),
      validFormData({ revision: "2" }),
    );

    expect(result).toMatchObject({ status: "conflict", message: expect.stringContaining("změnil") });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("never submits name, processing type, schema or user id to the RPC", async () => {
    const { rpc } = mockAuthenticatedRpc({ data: { revision: 1 }, error: null });

    await savePromptOverrideAction(
      createInitialPromptTemplateActionState(),
      validFormData({
        name: "Podvržený",
        processingType: "custom_prompt",
        outputSchema: '{"type":"string"}',
        userId: foreignUserId,
      }),
    );

    const payload = rpc.mock.calls[0]?.[1];
    expect(payload).not.toHaveProperty("p_processing_type");
    expect(payload).not.toHaveProperty("p_user_id");
    expect(payload).not.toHaveProperty("p_output_schema");
    expect(payload).not.toHaveProperty("p_name");
  });

  it("rejects invalid prompt text before opening an authenticated client", async () => {
    const result = await savePromptOverrideAction(
      createInitialPromptTemplateActionState(),
      validFormData({ promptText: "krátké" }),
    );

    expect(result).toMatchObject({ status: "error", systemPromptId: null, revision: null });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "-1"])("rejects a missing, empty or negative save revision before authentication: %s", async (revision) => {
    const formData = validFormData();
    if (typeof revision === "undefined") formData.delete("revision");
    else formData.set("revision", revision);

    const result = await savePromptOverrideAction(createInitialPromptTemplateActionState(), formData);

    expect(result).toMatchObject({ status: "error", message: "Prompt se nepodařilo uložit." });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("uses reset-specific safe copy for invalid and unexpected reset failures", async () => {
    const invalid = await resetPromptOverrideAction(
      createInitialPromptTemplateActionState(),
      validFormData({ revision: "0" }),
    );
    expect(invalid).toMatchObject({ status: "error", message: "Prompt se nepodařilo obnovit." });

    mockAuthenticatedRpc({ data: null, error: { code: "XX000", message: "private detail" } });
    const unexpected = await resetPromptOverrideAction(
      createInitialPromptTemplateActionState(),
      validFormData({ revision: "2" }),
    );
    expect(unexpected).toMatchObject({ status: "error", message: "Prompt se nepodařilo obnovit." });
    expect(unexpected.message).not.toContain("private detail");
  });

  it("follows the normal login recovery path when authentication is missing", async () => {
    mocks.createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
    });

    await expect(savePromptOverrideAction(
      createInitialPromptTemplateActionState(),
      validFormData(),
    )).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
    expect(mocks.redirect).toHaveBeenCalledWith("/login?next=/templates");
  });
});
