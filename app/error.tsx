"use client";

import { useEffect } from "react";

const screenStyle: React.CSSProperties = {
  alignItems: "center",
  display: "flex",
  justifyContent: "center",
  minHeight: "60vh",
  padding: "2rem",
  textAlign: "center"
};

const buttonStyle: React.CSSProperties = {
  cursor: "pointer",
  marginTop: "1rem",
  minHeight: "40px",
  padding: "0.5rem 1.25rem"
};

// AppError is the route-level error boundary with a retry action and safe logging.
export default function AppError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Vosio app error]", error.message, error.digest ?? "");
  }, [error]);

  return (
    <main style={screenStyle}>
      <div>
        <h1>Něco se pokazilo</h1>
        <p>Neočekávaná chyba přerušila načtení stránky. Vaše data zůstala uložená.</p>
        <button onClick={reset} style={buttonStyle} type="button">
          Zkusit znovu
        </button>
      </div>
    </main>
  );
}
