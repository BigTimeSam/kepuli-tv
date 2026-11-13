#import "../Bridging.h"

// A control pressed by code, with an Objective-C exception from its action
// caught: NO when one was raised. Google's Cast button asserts, on the way
// to its dialog and before it shows anything, that the SDK's database is
// ready, and the SDK gives no sign of when that is (CastService.prompt).
// Swift cannot catch the exception, and uncaught it ends the app.
BOOL KepuliPress(UIControl *control) {
    @try {
        [control sendActionsForControlEvents:UIControlEventTouchUpInside];
        return YES;
    } @catch (NSException *exception) {
        return NO;
    }
}
