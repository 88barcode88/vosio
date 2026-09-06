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
      <div className="auth-layout">
        <section className="auth-intro" aria-label="Vosio pracovní prostor">
          <div className="auth-brand">
            <div className="auth-mark" aria-hidden="true">
              <LogoMark size={46} />
            </div>
            <div>
              <strong>Vosio</strong>
              <span>Pracovní audio prostor</span>
            </div>
          </div>

          <div className="auth-intro-copy">
            <span>PRACOVNÍ AUDIO WORKSPACE</span>
            <h1>Hovory, přepisy a výstupy pohromadě.</h1>
            <p>Vraťte se k nahrávkám, upravte přepis a pokračujte v práci s uloženými AI výstupy.</p>
          </div>

          <ul className="auth-intro-meta" aria-label="Možnosti pracovního prostoru">
            <li>Nahrávání a upload</li>
            <li>Přepis hovoru</li>
            <li>Uložené AI výstupy</li>
          </ul>
        </section>

        <section className="auth-card" aria-label="Přihlášení do Vosio">
          <div className="auth-heading">
            <ShieldCheck size={22} />
            <h1>Přihlášení</h1>
            <p>Použijte svůj účet Vosio.</p>
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
      </div>
    </main>
  );
}
