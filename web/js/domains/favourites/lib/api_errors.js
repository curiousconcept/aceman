// Helpers for interpreting structured errors thrown by ./api.js.
//
// On a 409 the backend returns a JSON body of shape
//   { "error": "...", "existing_name": "..." }
// telling us the operation collided with a previously-saved entry.
// The browser-side store throws a plain Error with `.existingName`
// for the same case (no HTTP response involved). Two shapes, one
// concept — this module reconciles them so the UI layer doesn't
// have to remember the difference.
//
// Pure. No DOM, no globals.

// Returns the name of the existing favourite that caused the
// collision, or null if the error is something else.
//
// Accepts either:
//   * an api.js-wrapped Error with `.status === 409` and a
//     `.data.existing_name` (server-collided path), OR
//   * any Error with an `.existingName` property (in-browser store
//     collision; thrown by createBrowserFavs().add).
export function extractExistingName(err) {
  if (!err) return null;
  if (err.status === 409 && err.data && typeof err.data.existing_name === 'string') {
    return err.data.existing_name;
  }
  if (typeof err.existingName === 'string' && err.existingName) {
    return err.existingName;
  }
  return null;
}
