import Link from "next/link";
import type { ReactNode } from "react";
import "./login/login.css";

export function AuthPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="fm-storefront fm-login-page">
      <div className="fm-login-content">
        <header className="fm-login-heading">
          <Link href="/" className="fm-login-brand" aria-label="FreshMarkets home">
            FreshMarkets<span aria-hidden="true">.</span>
          </Link>
          <h1>{title}</h1>
        </header>
        {children}
      </div>
    </main>
  );
}
