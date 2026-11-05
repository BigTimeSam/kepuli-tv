// Whether the page may put the caret in a field on its own.
//
// A module of its own, without the DOM's elements or the extension API, so
// that the pickers can take it in the unit tests as well.

/**
 * Whether a field may take the caret without being asked. On a touch
 * screen a focused text field opens the on-screen keyboard, which covers
 * half a tablet's screen: opening the settings to move a slider brought it
 * up every time. There the viewer taps the field they mean; with a mouse
 * the caret is still waiting in the right place. The primary pointer
 * decides, so a laptop with a touch screen keeps its caret.
 */
export const caretWelcome = () => !matchMedia('(pointer: coarse)').matches;
