You are extending a freshly generated Shipshit.dev project scaffold.

Project: openpacksduel
Scope: Frontend-only Solana Pokemon pack duel MVP with quick matchmaking, wallet challenges, synchronized reveals, and shareable outcomes
App surfaces: web, app
Routes: /overview
UI package: @shipshitdev/ui
Surface contract:
- apps/web is the public landing page.
- apps/app is the product web app with the selected routes.
- apps/desktop is an Electron shell that embeds the product web app.
- apps/mobile, apps/extension, and apps/cli are explicit platform surfaces.
- apps/docs is an opt-in Nextra documentation site.

Your task:
1. Inspect the generated repo before editing.
2. Shape the product around the stated scope.
3. Generate real scoped landing content in apps/web.
4. Generate real scoped page content in apps/app for each default route instead of leaving generic placeholders.
5. Keep the stronger default shell and replace sample data with product-specific content instead of collapsing the UI back to blank cards.
6. Keep the apps/app route contract intact: /overview.
7. Use @shipshitdev/ui components first for product app surfaces.
8. Keep the monorepo Bun/Turbo setup working.
9. Use Bun for install/script workflows.
10. Run relevant typecheck/build commands and fix issues.

Do not replace the scaffold with a different stack. Extend it.