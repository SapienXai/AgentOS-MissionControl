export function shouldAttemptOpenClawUpdateRecovery(output: string) {
  const normalized = output.trim();

  if (!normalized) {
    return false;
  }

  const updateFinished = /Update Result:\s*OK/i.test(normalized);
  const versionAdvanced = /\bBefore:\s*\d+(?:\.\d+)+/i.test(normalized) && /\bAfter:\s*\d+(?:\.\d+)+/i.test(normalized);
  const postUpdateFailure =
    /Completion cache update failed/i.test(normalized) ||
    /Gateway did not become healthy after restart/i.test(normalized) ||
    /Gateway version mismatch/i.test(normalized) ||
    /Run `?openclaw gateway status --deep`? for details/i.test(normalized);

  return (updateFinished || versionAdvanced) && postUpdateFailure;
}

export function isOpenClawGatewayReadyOutput(output: string) {
  const normalized = output.trim();

  if (!normalized) {
    return false;
  }

  return (
    /Gateway Health\s+OK/i.test(normalized) ||
    /(?:^|\n)\s*OK\s*(?:\n|$)/i.test(normalized) ||
    /Connectivity probe:\s*ok/i.test(normalized) ||
    /Capability:\s*admin-capable/i.test(normalized)
  );
}

export function buildOpenClawUpdateRecoveryManualCommand(command: string) {
  return `${command} doctor --fix && ${command} gateway restart && ${command} gateway status --deep`;
}
