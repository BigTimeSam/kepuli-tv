import WebKit

/// What may load in the web view. The player's own pages stay; a file the
/// page hands out becomes a download; every other address leaves the web
/// view for LinkOpener, so the player is never replaced by a web page.
final class Navigation: NSObject, WKNavigationDelegate, WKUIDelegate {
    weak var player: PlayerViewController?

    private func isPlayer(_ url: URL) -> Bool {
        url.scheme == ExtensionHost.baseURL.scheme && url.host == ExtensionHost.baseURL.host
    }

    private func open(_ url: URL) {
        guard let player else { return }
        LinkOpener.shared.open(url, from: player)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        // A frame inside the page is the page's own business. A link with
        // target="_blank" has no target frame and is judged as the main one.
        if let frame = navigationAction.targetFrame, !frame.isMainFrame { decisionHandler(.allow); return }
        // <a download>, and a blob opened as a page, which could only be a
        // file meant for saving.
        if navigationAction.shouldPerformDownload || url.scheme == "blob" { decisionHandler(.download); return }
        if isPlayer(url) || url.scheme == "data" || url.scheme == "about" { decisionHandler(.allow); return }
        decisionHandler(.cancel)
        open(url)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = DownloadSaver.shared
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = DownloadSaver.shared
    }

    /// window.open and target="_blank": there is no second web view.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            if isPlayer(url) { webView.load(navigationAction.request) } else { open(url) }
        }
        return nil
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        debugLog("the web content process ended")
        // Before the reload: its page is not there to hear anything.
        Bridge.shared.pageGone()
        player?.recover()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        debugLog("didFinish")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: any Error) {
        // The code alone: the description names the address.
        debugLog("didFailProvisionalNavigation \((error as NSError).domain) \((error as NSError).code)")
    }
}
