export function splitConstraints(input: string): string[] {
  return input
    .split(/[,，；;]|(?:\b(?:and|then|but)\b)/i)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) =>
      /不要|别|先|only|without|dont|don't|audit|审计|report|确认|confirm|preview|backend|后端/i.test(part),
    );
}
