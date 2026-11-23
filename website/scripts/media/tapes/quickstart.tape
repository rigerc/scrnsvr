# VHS records a terminal, not a browser tab. Webpage screenshots use Playwright.
# Re-run using: pnpm media:vhs (native VHS) or pnpm media:vhs --docker.
# This is a template: scripts/media/vhs.mjs fills the double-brace placeholders below from
# src/config/project.config.ts and runs the result (media-output/vhs/quickstart.generated.tape).
Output media-output/vhs/quickstart.gif
Output media-output/vhs/quickstart.mp4

Set Width 1100
Set Height 600
Set FontSize 24
Set Padding 24
Set Framerate 30
Set TypingSpeed 55ms
Set CursorBlink false

Type "echo '{{PROJECT_NAME}}  /  quick start'"
Enter
Sleep 800ms
Type "echo '{{PROJECT_EYEBROW}}'"
Enter
Sleep 1s
Type "ls src/content/docs/docs"
Enter
Sleep 1500ms
Screenshot media-output/vhs/quickstart.png
Sleep 1s
