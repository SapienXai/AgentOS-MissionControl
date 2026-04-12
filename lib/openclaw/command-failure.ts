export function stringifyCommandFailure(error: unknown) {
  if (!error || typeof error !== "object") {
    return "";
  }

  const stdout = "stdout" in error ? stringifyFailureChunk(error.stdout) : "";
  const stderr = "stderr" in error ? stringifyFailureChunk(error.stderr) : "";
  const message = "message" in error && typeof error.message === "string" ? error.message : "";

  return `${message}\n${stdout}\n${stderr}`;
}

function stringifyFailureChunk(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString();
  }

  return "";
}
