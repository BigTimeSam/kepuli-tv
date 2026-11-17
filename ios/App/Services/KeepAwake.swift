import UIKit

/// `awake {on}`: the screen stays on while a picture plays.
/// navigator.wakeLock is refused in the web view (measured in the spike),
/// so js/wakelock.js says it here instead. Not on unconditionally, as on
/// Android: an app left on its list should let the phone lock.
final class KeepAwake: NativeService {
    let prefix = "awake"

    func handle(_ type: String, _ body: [String: Any], reply: @escaping ([String: Any]) -> Void) {
        UIApplication.shared.isIdleTimerDisabled = body["on"] as? Bool ?? false
        reply([:])
    }

    /// A page that has just loaded plays nothing yet, whatever the one
    /// before it said last (it may have died while playing).
    func pageConnected() {
        UIApplication.shared.isIdleTimerDisabled = false
    }

    /// Nor does a page that is gone: the screen kept on for the dead one's
    /// picture stayed on until the next page greeted.
    func pageGone() { pageConnected() }
}
