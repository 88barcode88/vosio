"use client";

import { useActionState, useEffect, useRef } from "react";
import {
  changePasswordAction
} from "@/lib/auth/password-actions";
import {
  initialPasswordActionState,
  type PasswordActionState
} from "@/lib/auth/password-action-state";

type PasswordAction = (
  state: PasswordActionState,
  formData: FormData
) => Promise<PasswordActionState>;

type AccountSecurityPanelProps = {
  action?: PasswordAction;
  disabled?: boolean;
  email: string;
};

// AccountSecurityPanel keeps password mutation separate from preference saving.
export function AccountSecurityPanel({
  action = changePasswordAction,
  disabled = false,
  email
}: AccountSecurityPanelProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  const [state, formAction, pending] = useActionState(action, initialPasswordActionState);

  useEffect(() => {
    if (state.status === "idle") return;
    formRef.current?.reset();
    feedbackRef.current?.focus();
  }, [state]);

  return (
    <section className="settings-section account-security-section" data-utility-surface="account-security" aria-labelledby="settings-account">
      <div className="settings-section-heading">
        <h2 id="settings-account">Účet</h2>
        <p>Přihlášený účet. Heslo se mění samostatně a uloží se hned.</p>
      </div>
      <form action={disabled ? undefined : formAction} className="account-security-form" noValidate ref={formRef}>
        <fieldset aria-busy={pending} className="account-security-fields" disabled={disabled || pending}>
          <label className="account-security-email">
            <span>Přihlášený e-mail</span>
            <input autoComplete="username" readOnly type="email" value={email} />
          </label>
          <details className="account-security-password" open={state.status !== "idle" || undefined}>
            <summary>Změnit heslo</summary>
            <div className="account-security-grid">
              <label>
                <span>Současné heslo</span>
                <input autoComplete="current-password" name="currentPassword" required type="password" />
              </label>
              <label>
                <span>Nové heslo</span>
                <input autoComplete="new-password" minLength={8} name="newPassword" required type="password" />
                <small>Alespoň 8 znaků.</small>
              </label>
              <label>
                <span>Potvrzení nového hesla</span>
                <input autoComplete="new-password" minLength={8} name="confirmPassword" required type="password" />
              </label>
            </div>
            {state.status !== "idle" ? (
              <p
                aria-live="polite"
                className={`account-security-feedback account-security-feedback-${state.status}`}
                ref={feedbackRef}
                role={state.status === "success" ? "status" : "alert"}
                tabIndex={-1}
              >
                {state.message}
              </p>
            ) : null}
            <button className="settings-save-button account-security-submit" disabled={disabled || pending} type="submit">
              {pending ? "Měním heslo…" : "Uložit nové heslo"}
            </button>
          </details>
        </fieldset>
      </form>
    </section>
  );
}
