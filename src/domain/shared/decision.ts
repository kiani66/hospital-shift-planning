/** A yes/no answer with a machine-readable reason when the answer is no. */
export type Decision<R extends string = string> =
  { readonly allowed: true } | { readonly allowed: false; readonly reason: R };

export const allow: { readonly allowed: true } = { allowed: true };

export const deny = <R extends string>(
  reason: R,
): { readonly allowed: false; readonly reason: R } => ({
  allowed: false,
  reason,
});
