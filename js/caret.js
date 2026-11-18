// Whether the page may put the caret in a field on its own.
//
// A module of its own, without the DOM's elements or the extension API, so
// that the pickers can take it in the unit tests as well.

import { remote } from './platform.js';

/**
 * Whether a field may take the caret without being asked. On a touch
 * screen a focused text field opens the on-screen keyboard, which covers
 * half a tablet's screen: opening the settings to move a slider brought it
 * up every time. A picker focused from a tap opens its menu on an iPhone
 * and an iPad: the subtitles' look came up with its Style list sprung
 * open over it. There the viewer taps the field they mean; with a mouse
 * the caret is still waiting in the right place. The primary pointer
 * decides, so a laptop with a touch screen keeps its caret. Nor with a
 * television's remote control: a focused field brings up the television's
 * keyboard, which takes the arrows to itself.
 */
export const caretWelcome = () => !remote && !matchMedia('(pointer: coarse)').matches;
