# Pankeki home reference implementation

Target: user screenshot `docs/images/pankeki-home-reference-20261029.png` (1522×1033, with 49px OS title bar). Compare app content at 1522×984; keep the Windows native title bar.

Update the existing production home presentation and preserve its shared composer, routing, project library, model selection, and recent home-request fix. Reuse the existing supplied brand/logo, pancake-cat, honey background and character artwork; no model or asset downloads. Match 278px sidebar, 108px header, hero/pill composer/four template cards and 338px right rail. Existing projects remain visible rather than showing a fake empty state. At narrower widths, reduce sidebar width and move the right rail below the main content. Keep non-home editing screens unchanged.

Validate with the production UI regression tests, a browser-rendered comparison at matched content size, responsive layout/console/navigation checks, then rebuild and reopen the Windows package with the user's existing project data. New package, source patch and screenshots go to outputs/pankeki-home-design. No source checkout, models, project files or auth overwritten.
