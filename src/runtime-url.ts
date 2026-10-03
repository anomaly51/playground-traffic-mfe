export function resolveRuntimeBase(configuredBase: string): string {
  const resolved =
    configuredBase.trim().toLowerCase() === "same-origin"
      ? window.location.origin
      : configuredBase.trim();

  return resolved.replace(/\/+$/, "");
}
