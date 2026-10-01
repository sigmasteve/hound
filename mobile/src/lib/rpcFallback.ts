// PostgREST's "no such function": the migration that adds it hasn't run
// yet. Callers use this to fall back to the older direct query, so an app
// update can go out before its migration.
export function isMissingFunction(error: { code?: string; message?: string }): boolean {
  return error.code === 'PGRST202' || /could not find the function/i.test(error.message ?? '');
}
