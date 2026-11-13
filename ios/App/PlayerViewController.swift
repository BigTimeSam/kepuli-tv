import UIKit
import WebKit

/// The player: the web view inside the safe area, on a ground of the
/// page's own colour; over the whole screen while a picture is in the
/// app's full screen.
final class PlayerViewController: UIViewController {
    /// The ground until the page has painted: the Android app's window
    /// colour, and LaunchBackground in the asset catalogue. After that the
    /// view follows the page (see `show`).
    static let ground = UIColor(red: 0x0f / 255.0, green: 0x13 / 255.0, blue: 0x20 / 255.0, alpha: 1)

    let host = ExtensionHost()
    private let navigation = Navigation()
    private var observations: [NSKeyValueObservation] = []
    private var frame: UIView?
    private var safeEdges: [NSLayoutConstraint] = []
    private var screenEdges: [NSLayoutConstraint] = []
    private(set) var failure: String?
    /// The app's full screen (see `setFull`).
    private(set) var full = false
    /// The page's ground as last followed, and what a dialog's backdrop
    /// lays over it (see `setShade`).
    private var pageGround = PlayerViewController.ground
    private var shade: [Double]?
    /// Whether a dialog of the page's own is open over it (`setShade`):
    /// what the page says in its strip is then under the dialog.
    private(set) var dialogOpen = false
    /// When the page was last loaded again after its process had ended,
    /// and how long that reload waited (see `recover`).
    private var reloaded = Date.distantPast
    private var patience: TimeInterval = 0
    #if DEBUG
    private var narrowed: NSLayoutConstraint?
    #endif

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Self.ground
        navigation.player = self
        Bridge.shared.presenter = self
        DownloadSaver.shared.presenter = self
        Task { @MainActor in
            do { show(try await host.start()) } catch { fail(error) }
            #if DEBUG
            DebugBridge.shared.start(player: self)
            #endif
        }
    }

    private func show(_ webView: WKWebView) {
        webView.navigationDelegate = navigation
        webView.uiDelegate = navigation
        // Until the page paints the web view shows the ground, not a white
        // sheet; `paint` keeps both in the page's colour after that.
        webView.backgroundColor = Self.ground
        webView.scrollView.backgroundColor = Self.ground
        // The page knows nothing of insets (no viewport-fit=cover), so the
        // web view keeps to the safe area on all four sides, in both
        // orientations, as the Android shell does. The keyboard is left to
        // WebKit, which scrolls the focused field into view; tying the web
        // view to the keyboard guide as well would move the page twice.
        //
        // The constraints are on a frame around the web view, not on the
        // web view. For an element's full screen, which the app has since
        // turned off (ExtensionHost.configure), WebKit moved the web view
        // into a window of its own, dropped every constraint to this
        // hierarchy and put it back by its frame and autoresizing mask:
        // constrained directly it was 62 by 0 points there (measured). The
        // frame stays: it is what the two sets of edges below move, and
        // what the debug bridge narrows.
        let frame = UIView()
        frame.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(frame)
        // Two sets of edges: the safe area's, and for full screen the view's own.
        let edges = { (top: NSLayoutYAxisAnchor, bottom: NSLayoutYAxisAnchor, leading: NSLayoutXAxisAnchor, trailing: NSLayoutXAxisAnchor) -> [NSLayoutConstraint] in
            let end = frame.trailingAnchor.constraint(equalTo: trailing)
            // Below required, so that the debug bridge's `width` can narrow the frame.
            end.priority = .defaultHigh
            return [frame.topAnchor.constraint(equalTo: top), frame.bottomAnchor.constraint(equalTo: bottom), frame.leadingAnchor.constraint(equalTo: leading), end]
        }
        let safe = view.safeAreaLayoutGuide
        safeEdges = edges(safe.topAnchor, safe.bottomAnchor, safe.leadingAnchor, safe.trailingAnchor)
        screenEdges = edges(view.topAnchor, view.bottomAnchor, view.leadingAnchor, view.trailingAnchor)
        NSLayoutConstraint.activate(full ? screenEdges : safeEdges)
        webView.frame = frame.bounds
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        frame.addSubview(webView)
        self.frame = frame
        // The strips under the status bar, beside the notch and under the
        // home indicator take the page's ground colour, in the light theme
        // too. Before a page has painted WebKit reports a colour of its own
        // (white), measured to arrive even after the load has ended; taking
        // it would flash, so that one colour is never followed. Neither of
        // the page's themes has it as its ground.
        let blank = webView.underPageBackgroundColor
        observations = [
            webView.observe(\.underPageBackgroundColor) { [weak self] webView, _ in
                guard let self, let colour = webView.underPageBackgroundColor, colour != blank else { return }
                self.pageGround = colour
                self.paint()
            },
        ]
    }

    /// A dialog of the page dims the page behind it, and the strips around
    /// the web view are not the page's: undimmed they framed the dimmed
    /// page in two bright bands, plain to see in the light theme, on the
    /// first screen a new viewer meets. The page says its backdrop's
    /// colour while a modal dialog is open (`screen.shade`, js/host.js):
    /// red, green and blue to 255 and how opaque, or nil with none open;
    /// and whether one is open, said apart, as a colour that could not be
    /// read is no sign of a closed dialog (`Reminders` asks).
    func setShade(_ rgba: [Double]?, open: Bool) {
        shade = rgba?.count == 4 ? rgba : nil
        dialogOpen = open
        paint()
    }

    /// The page's theme setting, for what is the system's to draw: the
    /// keyboard, and Google's Cast dialogs presented from this window. They
    /// followed the device's appearance alone, so a viewer with the app
    /// set to Dark on a phone in light mode typed on a light keyboard over
    /// a dark page. The page says its setting and not the colour it comes
    /// to: an override also decides what `prefers-color-scheme` answers in
    /// the web view, so "system" must be no override at all, or the page
    /// would stop following the device. On the window, as the dialogs
    /// presented over the player take it from there.
    func setTheme(_ theme: String?) {
        view.window?.overrideUserInterfaceStyle = Self.style(theme)
    }

    static func style(_ theme: String?) -> UIUserInterfaceStyle {
        theme == "dark" ? .dark : theme == "light" ? .light : .unspecified
    }

    /// `ground` with `rgba` laid over it, as the page's backdrop lies over its ground.
    static func shaded(_ ground: UIColor, _ rgba: [Double]) -> UIColor {
        var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0
        ground.getRed(&red, green: &green, blue: &blue, alpha: nil)
        let over = CGFloat(rgba[3]), mix = { (under: CGFloat, top: Double) in under * (1 - over) + CGFloat(top) / 255 * over }
        return UIColor(red: mix(red, rgba[0]), green: mix(green, rgba[1]), blue: mix(blue, rgba[2]), alpha: 1)
    }

    /// The strips, and what the web view shows past the page's end (under
    /// a keyboard WebKit scrolls the page beyond it), in the page's ground
    /// colour, dimmed as the page is. The scroll view's colour was the
    /// dark ground for good once: a dark slab stood between a light page
    /// and the keyboard.
    private func paint() {
        let colour = shade.map { Self.shaded(pageGround, $0) } ?? pageGround
        guard view.backgroundColor != colour else { return }
        view.backgroundColor = colour
        host.webView?.backgroundColor = colour
        host.webView?.scrollView.backgroundColor = colour
        setNeedsStatusBarAppearanceUpdate()
    }

    /// The app's full screen, asked for by the page (js/playercontrols.js)
    /// in place of WebKit's own for an element, which shows a banner with
    /// the page's internal address and keeps the picture inside the safe
    /// area. The web view takes the whole screen, the status bar and the
    /// home indicator go, and the page is told, with what of the screen is
    /// not safe on each side: it lays the picture over its window and
    /// keeps the picture's controls clear of those strips. Nothing turns
    /// the device: the picture follows the way it is held.
    func setFull(_ on: Bool) {
        guard on != full else { sayScreen(); return }
        full = on
        if frame != nil {
            NSLayoutConstraint.deactivate(on ? safeEdges : screenEdges)
            NSLayoutConstraint.activate(on ? screenEdges : safeEdges)
        }
        setNeedsStatusBarAppearanceUpdate()
        setNeedsUpdateOfHomeIndicatorAutoHidden()
        view.layoutIfNeeded()
        debugLog("full screen \(on ? "entered" : "left")")
        sayScreen()
    }

    /// Where full screen stands, for the page. The insets are the view's:
    /// in full screen the web view covers it, and a point there is a CSS
    /// pixel of the page.
    private func sayScreen() {
        let unsafe = full ? view.safeAreaInsets : .zero
        Bridge.shared.send("screen", ["full": full, "top": unsafe.top, "left": unsafe.left, "bottom": unsafe.bottom, "right": unsafe.right])
    }

    /// The device was turned, or the status bar went: the strips changed.
    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        if full { sayScreen() }
    }

    override var prefersStatusBarHidden: Bool { full }
    override var prefersHomeIndicatorAutoHidden: Bool { full }

    /// The extension did not load. Nothing a viewer can do about it, so the
    /// release build only says whose screen this is.
    private func fail(_ error: any Error) {
        failure = "\(error.localizedDescription) (\(error))"
        let label = UILabel()
        label.numberOfLines = 0
        label.textAlignment = .center
        label.textColor = .white
        label.text = "Kepuli-TV"
        #if DEBUG
        label.text = failure
        #endif
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            label.leadingAnchor.constraint(equalTo: view.layoutMarginsGuide.leadingAnchor),
            label.trailingAnchor.constraint(equalTo: view.layoutMarginsGuide.trailingAnchor),
        ])
    }

    /// The web content process died (memory, a crash). The web view keeps
    /// its address, hash route included, so a reload returns the page to
    /// its place, as onKill does on Android.
    ///
    /// At once, unless the process ended within a minute of the reload
    /// before: the page's own start may then be what ends it (memory, on a
    /// very large list), and reloaded at once each time the ground would
    /// flicker for as long as the app is in front, with the provider
    /// signed in to at every turn. Such a reload waits, twice as long each
    /// time up to a minute; a page that has lived a minute is reloaded at
    /// once again. Not seen to happen: there is no page that dies at its
    /// start to try it with.
    func recover() {
        patience = Self.patience(after: patience, lived: Date().timeIntervalSince(reloaded))
        let reload = { [weak self] in
            guard let self, let webView = self.host.webView else { return }
            self.reloaded = Date()
            if webView.url == nil { webView.load(URLRequest(url: self.host.playerURL)) } else { webView.reload() }
        }
        if patience > 0 { DispatchQueue.main.asyncAfter(deadline: .now() + patience, execute: reload) } else { reload() }
    }

    /// How long a reload waits: nothing when the page had lived a minute
    /// since the reload before, else 2 s and then twice the wait before,
    /// up to a minute.
    static func patience(after last: TimeInterval, lived: TimeInterval) -> TimeInterval {
        lived >= 60 ? 0 : min(60, max(2, last * 2))
    }

    /// Dark letters on a light ground and the other way round.
    override var preferredStatusBarStyle: UIStatusBarStyle {
        var white: CGFloat = 0
        view.backgroundColor?.getWhite(&white, alpha: nil)
        return white > 0.6 ? .darkContent : .lightContent
    }

    #if DEBUG
    /// What the page sees of Split View: the web view's frame at that
    /// width, or the full width again with nil.
    func debugWidth(_ points: CGFloat?) {
        narrowed?.isActive = false
        narrowed = points.flatMap { frame?.widthAnchor.constraint(equalToConstant: $0) }
        narrowed?.isActive = true
        view.layoutIfNeeded()
    }
    #endif
}
