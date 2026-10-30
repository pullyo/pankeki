# Windows QA checkpoint and paused home redesign

The native Windows generation, mask-PNG import, local recolor, image save, project JSON save, normal quit, restart and file reopen were verified before the subsequent home redesign began. See windows-qa-20261029/QA-report.ko.md. The generated and re-exported project JSON files were byte-identical (8 candidates); local project files and packaged binaries are intentionally not committed.

The user stopped home implementation and requested a GitHub checkpoint. The next WIP commit preserves the partial home markup and five extracted artwork assets. The home stylesheet has NOT yet been adapted, the WIP frontend has NOT been rebuilt, and it has NOT passed visual or native QA. Do not label the WIP home implementation complete or submission-ready. The preceding Windows-fix commit preserves the earlier tested frontend.

Remaining work: finish the scoped home CSS against the supplied reference; rebuild web/index.html; run home/composer regressions; compare browser screenshots at 1522x984 app content size and responsive widths; build a new Windows package and verify native routing and existing project preservation. Do not reuse the previous EXE or QA source ID as validation of the WIP home markup.
