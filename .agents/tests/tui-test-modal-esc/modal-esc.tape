# tk TUI live evidence — task modal esc freeze regression (2026-10-19)
# Repro: board → enter card → modal. Before the fix esc closed nothing and
# every later key died (TaskModal had no escape case; shell bails on modals).
# After: esc closes the modal, input keeps working (help opens, closes).
Output modal-esc.gif
Set Shell "zsh"
Set FontSize 14
Set Width 1100
Set Height 650

Type "bun packages/tui/src/main.tsx"
Enter
Sleep 3s
Type "2"
Sleep 800ms
Type "j"
Sleep 500ms
Enter
Sleep 1s
Escape
Sleep 800ms
Type "?"
Sleep 1s
Escape
Sleep 800ms
Ctrl+C
Sleep 500ms
