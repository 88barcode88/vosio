import { LockKeyhole, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { signInAction } from "@/lib/auth/actions";
import { getSafeNextPath } from "@/lib/auth/redirects";
import { LogoMark } from "@/components/logo-mark";
import { createClient } from "@/lib/supabase/server";

type LoginPageProps = {
  searchParams: Promise<{
    error?: string;
    next?: string;
  }>;
};

// LoginPage renders the internal email/password gate for Supabase Auth users.
export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const nextPath = getSafeNextPath(params.next);
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (user) {
    redirect(nextPath);
  }

  return (
    <main className="auth-shell" data-utility-surface="login">
      <section className="auth-card" aria-label="Přihlášení do Vosio">
        <div className="auth-brand">
          <div className="auth-mark" aria-hidden="true">
            <LogoMark size={46} />
          </div>
          <div>
            <strong>Vosio</strong>
            <span>Interní přístup</span>
          </div>
        </div>

        <div className="auth-heading">
          <ShieldCheck size={22} />
          <h1>Přihlášení</h1>
          <p>Vstup je určený pro účty založené v Supabase Auth.</p>
        </div>

        {params.error ? <p className="auth-error">{params.error}</p> : null}

        <form action={signInAction} className="auth-form">
          <input name="next" type="hidden" value={nextPath} />
          <label>
            <span>E-mail</span>
            <input
              autoComplete="email"
              name="email"
              placeholder="jmeno@firma.cz"
              required
              type="email"
            />
          </label>
          <label>
            <span>Heslo</span>
            <input
              autoComplete="current-password"
              name="password"
              placeholder="Zadejte heslo"
              required
              type="password"
            />
          </label>
          <button type="submit">
            <LockKeyhole size={18} />
            Přihlásit se
          </button>
        </form>
      </section>
    </main>
  );
}
