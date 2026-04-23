export function isOpenClawTerminalCommand(command: string | null | undefined) {
  const executable = readFirstShellToken(command)?.toLowerCase();

  if (!executable) {
    return false;
  }

  return (
    executable === "openclaw" ||
    executable.endsWith("/openclaw") ||
    executable.endsWith("\\openclaw")
  );
}

function readFirstShellToken(command: string | null | undefined) {
  const trimmed = command?.trim();

  if (!trimmed) {
    return null;
  }

  let index = 0;

  while (index < trimmed.length && /\s/.test(trimmed[index])) {
    index += 1;
  }

  if (index >= trimmed.length) {
    return null;
  }

  let token = "";
  let mode: "unquoted" | "single" | "double" = "unquoted";

  while (index < trimmed.length) {
    const char = trimmed[index];

    if (mode === "unquoted") {
      if (/\s/.test(char)) {
        break;
      }

      if (char === "'") {
        mode = "single";
        index += 1;
        continue;
      }

      if (char === '"') {
        mode = "double";
        index += 1;
        continue;
      }

      if (char === "\\" && index + 1 < trimmed.length) {
        token += trimmed[index + 1];
        index += 2;
        continue;
      }

      token += char;
      index += 1;
      continue;
    }

    if (mode === "single") {
      if (char === "'") {
        mode = "unquoted";
        index += 1;
        continue;
      }

      token += char;
      index += 1;
      continue;
    }

    if (char === '"') {
      mode = "unquoted";
      index += 1;
      continue;
    }

    if (char === "\\" && index + 1 < trimmed.length) {
      token += trimmed[index + 1];
      index += 2;
      continue;
    }

    token += char;
    index += 1;
  }

  return token;
}
