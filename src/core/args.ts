export function getFlagValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

export function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}
