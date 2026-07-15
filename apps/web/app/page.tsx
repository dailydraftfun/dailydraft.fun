const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001';
const surfaces = [
  {
    label: 'apps/web',
    detail: 'Public landing page',
  },
  {
    label: 'apps/app',
    detail: 'Product web app',
  },
] as const;
const routes = [
  {
    label: 'Overview',
    href: '/overview',
  },
] as const;

export default function LandingPage() {
  return (
    <main className="min-h-screen overflow-hidden bg-primary text-primary">
      <section className="relative min-h-[92svh] px-6 py-6">
        <div className="absolute inset-0 opacity-60">
          <div className="h-full w-full bg-[linear-gradient(90deg,rgba(255,255,255,0.055)_1px,transparent_1px),linear-gradient(0deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:44px_44px]" />
        </div>
        <div className="absolute inset-x-0 bottom-0 h-40 bg-[linear-gradient(0deg,var(--bg-primary),transparent)]" />

        <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between gap-4">
          <a
            href="/"
            className="flex min-h-10 items-center gap-2.5"
            aria-label="openpacksduel home"
          >
            <span className="grid h-9 w-9 place-items-center rounded-md bg-accent font-mono text-sm font-semibold text-accent-foreground">
              op
            </span>
            <span className="text-sm font-semibold text-secondary">openpacksduel</span>
          </a>
          <nav className="hidden items-center gap-2 sm:flex" aria-label="Landing navigation">
            <a
              className="rounded-md px-3 py-2 text-sm text-secondary transition hover:bg-hover hover:text-primary"
              href="#surfaces"
            >
              Surfaces
            </a>
            <a
              className="rounded-md px-3 py-2 text-sm text-secondary transition hover:bg-hover hover:text-primary"
              href="#routes"
            >
              Routes
            </a>
            <a
              className="rounded-md bg-accent px-3 py-2 text-sm font-semibold text-accent-foreground transition hover:bg-accent-hover"
              href={appUrl}
            >
              Open app
            </a>
          </nav>
        </header>

        <div className="relative z-10 mx-auto grid max-w-6xl gap-10 pt-24 pb-16 lg:grid-cols-[minmax(0,1fr)_440px] lg:items-end lg:pt-32">
          <div>
            <p className="font-mono text-xs font-semibold uppercase text-agent">
              Public launch surface
            </p>
            <h1 className="mt-5 max-w-3xl text-6xl font-semibold leading-none tracking-normal text-primary md:text-8xl">
              openpacksduel
            </h1>
            <p className="mt-6 max-w-2xl text-lg font-medium leading-8 text-secondary md:text-xl">
              Frontend-only Solana Pokemon pack duel MVP with quick matchmaking, wallet challenges,
              synchronized reveals, and shareable outcomes
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a
                className="rounded-md bg-accent px-4 py-3 text-sm font-semibold text-accent-foreground transition hover:bg-accent-hover"
                href={appUrl}
              >
                Open app
              </a>
              <a
                className="rounded-md border border-border px-4 py-3 text-sm font-semibold text-secondary transition hover:border-border-strong hover:bg-hover hover:text-primary"
                href="#surfaces"
              >
                View surfaces
              </a>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-secondary p-4 shadow-2xl shadow-black/40 backdrop-blur">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <span className="text-xs font-semibold uppercase text-muted">Product snapshot</span>
              <span className="rounded bg-tertiary px-2 py-1 font-mono text-[10px] text-agent">
                live scaffold
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 py-4">
              <div className="rounded-lg bg-tertiary p-4">
                <div className="text-3xl font-semibold">02</div>
                <div className="mt-1 text-xs text-muted">surfaces</div>
              </div>
              <div className="rounded-lg bg-tertiary p-4">
                <div className="text-3xl font-semibold">01</div>
                <div className="mt-1 text-xs text-muted">app routes</div>
              </div>
            </div>
            <div className="space-y-2">
              {surfaces.slice(0, 4).map((surface) => (
                <div
                  key={surface.label}
                  className="flex items-center justify-between rounded-md bg-primary px-3 py-2"
                >
                  <span className="font-mono text-xs text-primary">{surface.label}</span>
                  <span className="text-xs text-muted">{surface.detail}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="surfaces" className="px-6 py-16">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-2xl">
            <p className="font-mono text-xs font-semibold uppercase text-agent">Selected outputs</p>
            <h2 className="mt-3 text-3xl font-semibold text-primary md:text-4xl">
              Generated surfaces have separate jobs.
            </h2>
          </div>
          <div className="mt-8 grid gap-3 md:grid-cols-3">
            {surfaces.map((surface) => (
              <article
                key={surface.label}
                className="rounded-lg border border-border bg-secondary p-5"
              >
                <h3 className="font-mono text-sm text-primary">{surface.label}</h3>
                <p className="mt-2 text-sm leading-6 text-secondary">{surface.detail}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="routes" className="px-6 py-16">
        <div className="mx-auto grid max-w-6xl gap-8 md:grid-cols-[320px_minmax(0,1fr)]">
          <div>
            <p className="font-mono text-xs font-semibold uppercase text-agent">App routes</p>
            <h2 className="mt-3 text-3xl font-semibold text-primary">
              The product app starts here.
            </h2>
            <p className="mt-4 text-sm leading-6 text-secondary">
              These routes are generated in apps/app. Wire this landing page to the deployed app URL
              with NEXT_PUBLIC_APP_URL.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {routes.map((route) => (
              <a
                key={route.href}
                href={appUrl}
                className="rounded-lg border border-border bg-secondary p-5 transition hover:border-border-strong hover:bg-hover"
              >
                <span className="text-sm font-semibold text-primary">{route.label}</span>
                <span className="mt-2 block font-mono text-xs text-muted">
                  apps/app{route.href}
                </span>
              </a>
            ))}
          </div>
        </div>
      </section>

      <footer id="waitlist" className="border-t border-border px-6 py-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
          <span>{new Date().getFullYear()} openpacksduel</span>
          <span>Generated with @shipshitdev/v0</span>
        </div>
      </footer>
    </main>
  );
}
