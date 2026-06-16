export function json(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

export function text(value: string): void {
  console.log(value);
}

export function fail(message: string, code: number): void {
  console.error(message);
  process.exitCode = code;
}
