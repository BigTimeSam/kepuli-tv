import UIKit
import WebKit

/// The extension, loaded into a WKWebExtensionController, and the one web
/// view that shows its player page. The counterpart of Android's GeckoView
/// host: the page is a real extension page, so storage.local, the host
/// permissions and the Stalker header rule are WebKit's own.
final class ExtensionHost: NSObject, WKWebExtensionControllerDelegate {
    // PERMANENT. These three name the page's origin and the folder WebKit
    // keeps its storage in. Change any of them and every viewer's accounts,
    // favourites and settings are gone: measured in the spike, a base URL
    // left to WebKit is a new UUID on every launch and the origin's private
    // file system is orphaned each time.
    static let identifier = "kepuli-tv"
    static let baseURL = URL(string: "webkit-extension://kepuli-tv/")!
    static let storeIdentifier = UUID(uuidString: "EA9BF6AD-7F8E-413E-A452-A75272922ABC")!

    /// The page, with the flag js/host.js reads. Measured on iOS 26.5 and
    /// 18.5: WebKit serves an extension page with a query string, and
    /// location.search is "?ios=1".
    static let page = "player.html?ios=1"

    private(set) var webView: WKWebView?
    private(set) var context: WKWebExtensionContext?
    private var webExtension: WKWebExtension?
    private var controller: WKWebExtensionController?
    private var window: ExtensionWindow?

    /// Never built with appendingPathComponent, which turns the "?" into
    /// "%3F": a file that does not exist.
    var playerURL: URL {
        var page = Self.page
        #if DEBUG
        page = ProcessInfo.processInfo.environment["KEPULI_PAGE"] ?? page
        #endif
        return URL(string: page, relativeTo: Self.baseURL)!.absoluteURL
    }

    /// What both the controller's base configuration and the page's own must say.
    private func configure(_ configuration: WKWebViewConfiguration) {
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.allowsPictureInPictureMediaPlayback = true
        configuration.allowsAirPlayForMediaPlayback = true
        // No full screen for an element: WebKit's shows a banner that names
        // the page's internal address every time, and keeps the picture
        // inside the safe area. The page asks the app instead (`screen.full`,
        // PlayerViewController.setFull), so the banner never appears. The
        // full-screen button of WebKit's own video controls is another
        // matter: it opens the system's player, which has no banner.
        configuration.preferences.isElementFullscreenEnabled = false
    }

    /// Loads the extension and returns the web view, already loading the
    /// player. The order is the one the spike measured: the context's web
    /// view configuration exists only after controller.load.
    @MainActor
    func start() async throws -> WKWebView {
        let webExtension = try await WKWebExtension(resourceBaseURL: Bundle.main.resourceURL!.appendingPathComponent("extension"))
        self.webExtension = webExtension

        let context = WKWebExtensionContext(for: webExtension)
        self.context = context
        context.uniqueIdentifier = Self.identifier
        context.baseURL = Self.baseURL
        // WebKit does not remember grants between launches, so every launch
        // grants what the manifest asks for and every host: the viewer types
        // their provider's address, and the app is that player and nothing else.
        for permission in webExtension.requestedPermissions {
            context.setPermissionStatus(.grantedExplicitly, for: permission)
        }
        for pattern in webExtension.optionalPermissionMatchPatterns {
            context.setPermissionStatus(.grantedExplicitly, for: pattern)
        }

        let configuration = WKWebExtensionController.Configuration(identifier: Self.storeIdentifier)
        let base = WKWebViewConfiguration()
        configure(base)
        #if DEBUG
        context.isInspectable = true
        DebugBridge.shared.prepare(base)
        #endif
        configuration.webViewConfiguration = base
        let controller = WKWebExtensionController(configuration: configuration)
        controller.delegate = self
        self.controller = controller
        try controller.load(context)

        guard let pageConfiguration = context.webViewConfiguration else {
            throw NSError(domain: "KepuliTV", code: 1, userInfo: [NSLocalizedDescriptionKey: "The extension context has no web view configuration."])
        }
        configure(pageConfiguration)
        let webView = WKWebView(frame: .zero, configuration: pageConfiguration)
        webView.allowsLinkPreview = false
        webView.allowsBackForwardNavigationGestures = false
        webView.scrollView.bounces = false
        // The view controller keeps the web view inside the safe area; the
        // page knows nothing of insets.
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        #if DEBUG
        webView.isInspectable = true
        #endif
        self.webView = webView

        let window = ExtensionWindow(tab: ExtensionTab(webView: webView))
        self.window = window
        controller.didOpenWindow(window)
        controller.didFocusWindow(window)
        controller.didOpenTab(window.tab)

        webView.load(URLRequest(url: playerURL))
        return webView
    }

    /// For the driver's `status`.
    func state() -> [String: Any] {
        var state: [String: Any] = [
            "url": webView?.url?.absoluteString ?? "",
            "port": Bridge.shared.connected,
        ]
        if let context, let webExtension {
            state["extensionErrors"] = webExtension.errors.map { $0.localizedDescription }
            state["contextErrors"] = context.errors.map { $0.localizedDescription }
            state["loaded"] = context.isLoaded
            state["baseURL"] = context.baseURL.absoluteString
            state["grantedPermissions"] = context.grantedPermissions.keys.map { $0.rawValue }.sorted()
            state["grantedPatterns"] = context.grantedPermissionMatchPatterns.keys.map { $0.string }.sorted()
        }
        return state
    }

    // MARK: WKWebExtensionControllerDelegate

    func webExtensionController(_ controller: WKWebExtensionController, openWindowsFor extensionContext: WKWebExtensionContext) -> [any WKWebExtensionWindow] {
        window.map { [$0] } ?? []
    }

    func webExtensionController(_ controller: WKWebExtensionController, focusedWindowFor extensionContext: WKWebExtensionContext) -> (any WKWebExtensionWindow)? {
        window
    }

    /// tabs.create: the extension's own pages load in the one web view,
    /// anything else is a link.
    func webExtensionController(_ controller: WKWebExtensionController, openNewTabUsing configuration: WKWebExtension.TabConfiguration,
                                for extensionContext: WKWebExtensionContext, completionHandler: @escaping ((any WKWebExtensionTab)?, (any Error)?) -> Void) {
        if let url = configuration.url {
            if url.scheme == Self.baseURL.scheme, url.host == Self.baseURL.host {
                webView?.load(URLRequest(url: url))
            } else if let presenter = Bridge.shared.presenter {
                LinkOpener.shared.open(url, from: presenter)
            }
        }
        completionHandler(window?.tab, nil)
    }

    // The three prompts answer yes: access was granted before the load, and
    // the app has no dialog of its own to ask with. None is expected to be
    // asked at all; the note is there for a test to find if one is.

    func webExtensionController(_ controller: WKWebExtensionController, promptForPermissions permissions: Set<WKWebExtension.Permission>,
                                in tab: (any WKWebExtensionTab)?, for extensionContext: WKWebExtensionContext,
                                completionHandler: @escaping (Set<WKWebExtension.Permission>, Date?) -> Void) {
        debugLog("permission prompt: permissions")
        completionHandler(permissions, nil)
    }

    func webExtensionController(_ controller: WKWebExtensionController, promptForPermissionMatchPatterns matchPatterns: Set<WKWebExtension.MatchPattern>,
                                in tab: (any WKWebExtensionTab)?, for extensionContext: WKWebExtensionContext,
                                completionHandler: @escaping (Set<WKWebExtension.MatchPattern>, Date?) -> Void) {
        debugLog("permission prompt: match patterns")
        completionHandler(matchPatterns, nil)
    }

    func webExtensionController(_ controller: WKWebExtensionController, promptForPermissionToAccess urls: Set<URL>,
                                in tab: (any WKWebExtensionTab)?, for extensionContext: WKWebExtensionContext,
                                completionHandler: @escaping (Set<URL>, Date?) -> Void) {
        debugLog("permission prompt: addresses")
        completionHandler(urls, nil)
    }

    /// runtime.connectNative: the page's one port to the app.
    func webExtensionController(_ controller: WKWebExtensionController, connectUsing port: WKWebExtension.MessagePort,
                                for extensionContext: WKWebExtensionContext, completionHandler: @escaping ((any Error)?) -> Void) {
        // The handlers are in place before the port is accepted, so that
        // what the page has already said finds them.
        Bridge.shared.attach(port)
        completionHandler(nil)
    }

    /// runtime.sendNativeMessage is not used: everything goes through the port.
    func webExtensionController(_ controller: WKWebExtensionController, sendMessage message: Any, toApplicationWithIdentifier applicationIdentifier: String?,
                                for extensionContext: WKWebExtensionContext, replyHandler: @escaping (Any?, (any Error)?) -> Void) {
        replyHandler(["ok": false], nil)
    }
}
