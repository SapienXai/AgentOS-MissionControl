# AgentOS Desktop security boundary

The desktop shell uses Tauri 2 capabilities with a narrow default window
permission set. The frontend has no generic execute-command API. Runtime
lifecycle actions are fixed OpenClaw subcommands, and terminal access is a
separate PTY capability that can only start in a persisted, user-approved
workspace.

Native command protections:

- workspace paths reject absolute paths, parent traversal, missing parents, and
  symlink escapes outside the approved root;
- text reads and writes are capped at 2 MiB and binary files are not opened as
  text;
- delete requires an explicit confirmation flag and cannot delete the approved
  workspace root;
- terminal input is capped at 8 KiB and PTY dimensions are bounded;
- terminal session ids use UUIDs, natural PTY exits remove their session state,
  and emitted output is capped at 1 MiB per session;
- OpenClaw output is bounded to 200 entries and redacted before event delivery;
- notification and deep-link inputs use allowlisted event names and routes;
- secrets use the OS keyring and never enter workspace JSON, localStorage, or
  runtime logs.

The tray close action hides the window so a running managed runtime is not
surprisingly terminated by default. This behavior is persisted and can be
disabled in Settings. The explicit Quit menu stops the desktop-managed runtime
before exiting. Product notifications are generated from native state
transitions, not client-controlled status claims. Remote and cloud execution
are not exposed until a real provider is registered.
