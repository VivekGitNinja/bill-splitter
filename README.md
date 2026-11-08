# Bill Splitter — Live Demo (GitHub Pages)

This branch hosts the static, client-side demo of Bill Splitter — the same demo
that runs at the Muse share link. It is a self-contained single-page app:
all data lives in the visitor's own browser (localStorage), nothing is sent
to a server, and no real money moves.

- Exact remainder-cent splits (₹1,000 across 3 people = 334 / 333 / 333)
- Two-step UTR payment flow (mark paid with UTR → receiver confirms → receipt)
- Optimal settle plan, partial payments, recurring bills, multi-currency,
  dispute freeze, activity feed, share via link + QR

The production implementation (Hono API on Cloudflare Workers + D1, React +
Vite + TanStack frontend, 71 automated tests) lives on the `main` branch of
this same repo: https://github.com/VivekGitNinja/bill-splitter

Live demo: https://vivekgitninja.github.io/bill-splitter/
