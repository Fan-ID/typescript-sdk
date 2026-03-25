export function readEnv(key: string): string | undefined {
  if (typeof process !== "undefined" && process.env) {
    const v = process.env[key];
    return v !== undefined && v !== "" ? v : undefined;
  }
  return undefined;
}

export function readEnvBoolean(key: string): boolean {
  const v = readEnv(key);
  return v === "1" || v === "true" || v === "yes";
}
