import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  })
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import {
  changePasswordAction
} from "@/lib/auth/password-actions";
import { initialPasswordActionState } from "@/lib/auth/password-action-state";

// createPasswordForm builds a fresh password payload without retaining it outside a test case.
function createPasswordForm({
  confirmation = "new-secure-password",
  current = "current-password",
  next = "new-secure-password"
}: {
  confirmation?: string;
  current?: string;
  next?: string;
} = {}) {
  const formData = new FormData();
  formData.set("currentPassword", current);
  formData.set("newPassword", next);
  formData.set("confirmPassword", confirmation);
  return formData;
}

// configureAuthClient creates one request-scoped auth mock for reauthentication and update.
function configureAuthClient({
  email = "user@example.test",
  reauthError = null as null | { message: string },
  updateError = null as null | { message: string },
  user = undefined as undefined | null | { email?: string }
} = {}) {
  const getUser = vi.fn().mockResolvedValue({
    data: { user: user === undefined ? { email } : user },
    error: null
  });
  const signInWithPassword = vi.fn().mockResolvedValue({ error: reauthError });
  const updateUser = vi.fn().mockResolvedValue({ error: updateError });
  mocks.createClient.mockResolvedValue({
    auth: { getUser, signInWithPassword, updateUser }
  });
  return { getUser, signInWithPassword, updateUser };
}

describe("changePasswordAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["missing current password", { current: "" }, "Vyplňte všechna pole."],
    ["missing new password", { next: "", confirmation: "" }, "Vyplňte všechna pole."],
    ["missing confirmation", { confirmation: "" }, "Vyplňte všechna pole."],
    ["short new password", { next: "short", confirmation: "short" }, "Nové heslo musí mít alespoň 8 znaků."],
    ["mismatched confirmation", { confirmation: "different-password" }, "Nové heslo a potvrzení se neshodují."],
    ["same current and new password", { current: "same-password", next: "same-password", confirmation: "same-password" }, "Nové heslo musí být jiné než současné."]
  ])("rejects %s before reauthentication", async (_name, values, message) => {
    const { signInWithPassword, updateUser } = configureAuthClient();
    const result = await changePasswordAction(initialPasswordActionState, createPasswordForm(values));

    expect(result).toEqual({ message, status: "error" });
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("redirects a missing session to the safe settings login path", async () => {
    const { getUser } = configureAuthClient({ user: null });
    getUser.mockResolvedValue({ data: { user: null }, error: { message: "Auth session missing" } });

    await expect(changePasswordAction(initialPasswordActionState, createPasswordForm()))
      .rejects.toThrow("REDIRECT:/login?next=/settings");
    expect(mocks.redirect).toHaveBeenCalledWith("/login?next=/settings");
  });

  it("rejects an authenticated account without a usable email", async () => {
    const { signInWithPassword, updateUser } = configureAuthClient({ user: {} });

    const result = await changePasswordAction(initialPasswordActionState, createPasswordForm());

    expect(result).toEqual({
      message: "Účet nelze bezpečně ověřit. Přihlaste se znovu.",
      status: "error"
    });
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("reauthenticates the server-resolved email before changing the password", async () => {
    const { signInWithPassword, updateUser } = configureAuthClient();
    const formData = createPasswordForm();

    const result = await changePasswordAction(initialPasswordActionState, formData);

    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "user@example.test",
      password: formData.get("currentPassword")
    });
    expect(updateUser).toHaveBeenCalledWith({ password: formData.get("newPassword") });
    expect(mocks.createClient).toHaveBeenCalledOnce();
    expect(signInWithPassword.mock.invocationCallOrder[0]).toBeLessThan(updateUser.mock.invocationCallOrder[0]!);
    expect(result).toEqual({ message: "Heslo bylo změněno.", status: "success" });
  });

  it("does not update after a failed current-password check or leak provider details", async () => {
    const { updateUser } = configureAuthClient({
      reauthError: { message: "Invalid login credentials for current-password" }
    });

    const result = await changePasswordAction(initialPasswordActionState, createPasswordForm());

    expect(updateUser).not.toHaveBeenCalled();
    expect(result).toEqual({ message: "Současné heslo se nepodařilo ověřit.", status: "error" });
    expect(JSON.stringify(result)).not.toContain("current-password");
    expect(JSON.stringify(result)).not.toContain("Invalid login credentials");
  });

  it("sanitizes an updateUser failure", async () => {
    configureAuthClient({ updateError: { message: "provider detail new-secure-password" } });

    const result = await changePasswordAction(initialPasswordActionState, createPasswordForm());

    expect(result).toEqual({ message: "Heslo se nepodařilo změnit. Zkuste to znovu.", status: "error" });
    expect(JSON.stringify(result)).not.toContain("new-secure-password");
    expect(JSON.stringify(result)).not.toContain("provider detail");
  });

  it("settles unexpected Supabase failures with fixed safe copy", async () => {
    const { signInWithPassword } = configureAuthClient();
    signInWithPassword.mockRejectedValue(new Error("network current-password"));

    const result = await changePasswordAction(initialPasswordActionState, createPasswordForm());

    expect(result).toEqual({ message: "Heslo se nepodařilo změnit. Zkuste to znovu.", status: "error" });
    expect(JSON.stringify(result)).not.toContain("current-password");
  });
});
