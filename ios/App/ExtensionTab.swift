import WebKit

// WebKit's extension API speaks of windows and tabs. The app has one of
// each: the player's web view is the tab, and the window is whatever holds
// it. They exist so that the extension's page counts as an open tab of its
// own extension, which is what gives it the full API.

final class ExtensionTab: NSObject, WKWebExtensionTab {
    let webView: WKWebView
    weak var window: ExtensionWindow?

    init(webView: WKWebView) { self.webView = webView }

    func webView(for context: WKWebExtensionContext) -> WKWebView? { webView }
    func window(for context: WKWebExtensionContext) -> (any WKWebExtensionWindow)? { window }
    func url(for context: WKWebExtensionContext) -> URL? { webView.url }
    func title(for context: WKWebExtensionContext) -> String? { webView.title }
    func isSelected(for context: WKWebExtensionContext) -> Bool { true }
    func isLoadingComplete(for context: WKWebExtensionContext) -> Bool { !webView.isLoading }
    func activate(for context: WKWebExtensionContext, completionHandler: @escaping ((any Error)?) -> Void) { completionHandler(nil) }
    func loadURL(_ url: URL, for context: WKWebExtensionContext, completionHandler: @escaping ((any Error)?) -> Void) {
        webView.load(URLRequest(url: url))
        completionHandler(nil)
    }
    func shouldGrantPermissionsOnUserGesture(for context: WKWebExtensionContext) -> Bool { true }
}

final class ExtensionWindow: NSObject, WKWebExtensionWindow {
    let tab: ExtensionTab

    init(tab: ExtensionTab) {
        self.tab = tab
        super.init()
        tab.window = self
    }

    func tabs(for context: WKWebExtensionContext) -> [any WKWebExtensionTab] { [tab] }
    func activeTab(for context: WKWebExtensionContext) -> (any WKWebExtensionTab)? { tab }
    func windowType(for context: WKWebExtensionContext) -> WKWebExtension.WindowType { .normal }
    func windowState(for context: WKWebExtensionContext) -> WKWebExtension.WindowState { .fullscreen }
    func isPrivate(for context: WKWebExtensionContext) -> Bool { false }
    func frame(for context: WKWebExtensionContext) -> CGRect { tab.webView.window?.frame ?? .zero }
    func focus(for context: WKWebExtensionContext, completionHandler: @escaping ((any Error)?) -> Void) { completionHandler(nil) }
}
