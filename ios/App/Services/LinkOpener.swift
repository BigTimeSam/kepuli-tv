import SafariServices
import UIKit

/// Where an address that is not the player's goes. Navigation and
/// ExtensionHost hand over every link that would have left the page, so the
/// player is never replaced by a web page.
final class LinkOpener {
    static let shared = LinkOpener()

    enum Route: Equatable {
        /// A web page, read in Safari's view over the player: IMDb, TMDb, a
        /// trailer, the guide, the privacy policy, the licences. Closing it
        /// returns to the picture, which a trip to Safari would not.
        case page
        /// Another app: VLC (`vlc-x-callback:`), mail, and the App Store,
        /// whose pages are web addresses that only the store itself shows
        /// as more than an advertisement for it.
        case app
    }

    /// Safari's view takes http and https and nothing else: handed any other
    /// scheme it raises an exception, so the sorting is exact about it.
    static func route(_ url: URL) -> Route {
        guard let scheme = url.scheme?.lowercased(), ["http", "https"].contains(scheme),
              let host = url.host?.lowercased(), !host.isEmpty else { return .app }
        return ["apps.apple.com", "itunes.apple.com"].contains(host) ? .app : .page
    }

    #if DEBUG
    /// For `node ios/sim.mjs status`: every address handed over, in order.
    /// With KEPULI_LINKS=record nothing is opened, so that a scenario can
    /// follow a link without leaving the app, and only then is the whole
    /// address kept: that is for the mock provider. Otherwise the status
    /// shows where a link led and no more (`noted`), as it is pasted into
    /// reports and VLC's address carries the stream's, with the account's
    /// user name and password.
    private(set) var recorded: [String] = []
    private let recording = ProcessInfo.processInfo.environment["KEPULI_LINKS"] == "record"

    /// An address as the status keeps it: whole, or its scheme and host.
    static func noted(_ url: URL, whole: Bool) -> String {
        whole ? url.absoluteString : "\(url.scheme ?? "")://\(url.host ?? "")"
    }
    #endif

    func open(_ url: URL, from presenter: UIViewController) {
        let route = Self.route(url)
        #if DEBUG
        recorded.append(Self.noted(url, whole: recording))
        if recording { return }
        #endif
        // The route alone is logged: VLC's address carries the stream's,
        // and with it the account's password.
        switch route {
        case .page:
            debugLog("link: a page")
            presenter.frontmost.present(SFSafariViewController(url: url), animated: true)
        case .app:
            // No app for the scheme (VLC not installed) answers false and
            // shows nothing here. What follows is the page's: it sees that
            // it was not left and offers VLC's page in the App Store
            // (js/external.js), which comes back through this same route.
            UIApplication.shared.open(url) { opened in debugLog("link: an app, opened \(opened)") }
        }
    }
}

extension UIViewController {
    /// The controller to present a page or a picker from, so that it comes
    /// up over whatever is showing. A controller that already presents one
    /// (Google's cast dialog, an earlier page) refuses another, so it is the
    /// last in that chain. And the chain is the key window's: WebKit showed
    /// an element in full screen in a second window above the app's
    /// (measured on iOS 26.5: the same level, the key one), and what was
    /// presented in the app's window then waited beneath it, unseen until
    /// full screen was left. The app's own full screen has no second
    /// window (PlayerViewController.setFull); the rule is kept for
    /// whatever else WebKit may put over the app, the system's video
    /// player among them (not measured).
    var frontmost: UIViewController {
        let window = view.window?.windowScene?.windows.last { $0.isKeyWindow && $0.windowLevel == .normal }
        var top = window?.rootViewController ?? self
        while let next = top.presentedViewController, !next.isBeingDismissed { top = next }
        return top
    }
}
