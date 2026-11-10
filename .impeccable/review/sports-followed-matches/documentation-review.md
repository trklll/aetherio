No global system changes. Checked PRODUCT.md, src/index.css (page background, Inter stack, shared gutter variables, liquid-glass material), src/pages/BigPicture/SportsTeamPage.css (muted text, rules, panel geometry), src/pages/Sports/SportsMyTeamsPage.css and its component, plus the six final capture files.

Palette: inherited #1f1f1f Aetherio ground, #f8f9fa text, #c5c8cd supporting text and neutral translucent rules/material.
Type ramp: inherited Inter; page heading clamp(30px, 2.4vw, 46px), body clamp(16px, 1.15vw, 22px), centered match time/result at 1.35em.
Layout rule: shared --app-page-y / --app-gutter-x / --app-gutter-bottom, bounded 1440px table and mirrored opponents around the match center.
Component rule: reuse .liquid-glass and the existing TeamSelection/SportsDialog flow, resolve real insignia through the existing shared resolver.
Interaction rule: labeled date tabs, keyboard/cruceta traversal, date collapse controls, team-detail routing, visible focus and reduced-motion support.

Not canonized or repaired: the pre-existing absent global DESIGN.md and .impeccable/design.json; this ordinary extension is not authorization to redesign or document the entire application. No new shipping raster asset was added. Review/documentation used the degraded in-thread protocols because nested delegation was blocked.
