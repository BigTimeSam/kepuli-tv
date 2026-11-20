import UIKit

/// `screen.full {on}`: the picture over the whole screen and back, the
/// app's own way (PlayerViewController.setFull says why). The answer is the
/// `screen` event, which the page follows as it follows fullscreenchange in
/// a browser. `screen.shade {rgba, open}`: the backdrop of the page's open
/// dialog, for the strips around the web view, and whether one is open
/// (PlayerViewController.setShade). `screen.theme {theme}`: the page's own
/// theme setting (dark, light or system), for what the system draws over
/// and around the page (PlayerViewController.setTheme).
final class Screen: NativeService {
    let prefix = "screen"

    private var player: PlayerViewController? { Bridge.shared.presenter as? PlayerViewController }

    func handle(_ type: String, _ body: [String: Any], reply: @escaping ([String: Any]) -> Void) {
        switch type {
        case "screen.full": player?.setFull(body["on"] as? Bool ?? false)
        case "screen.shade":
            let rgba = (body["rgba"] as? [NSNumber])?.map(\.doubleValue)
            player?.setShade(rgba, open: body["open"] as? Bool ?? (rgba != nil))
            Services.player.setShade(rgba, open: body["open"] as? Bool ?? (rgba != nil))
        case "screen.theme": player?.setTheme(body["theme"] as? String)
        default: reply(["ok": false, "error": "unknown"]); return
        }
        reply([:])
    }

    /// A page that has just loaded shows no picture, whatever the one
    /// before it had over the screen (it may have died there): the bars
    /// come back, and no dialog of its is open yet.
    func pageConnected() {
        player?.setFull(false)
        player?.setShade(nil, open: false)
        Services.player.setShade(nil, open: false)
    }

    /// The same at once when the page's process ended: the bars stayed
    /// hidden over an empty ground until the next page greeted.
    func pageGone() { pageConnected() }
}
