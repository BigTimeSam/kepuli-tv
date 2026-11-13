import XCTest
@testable import KepuliTV

/// What a simulator scenario cannot see cheaply about the shell: the
/// address the page is loaded from and the package in the bundle.
final class ShellTests: XCTestCase {
    /// appendingPathComponent would make the "?" a "%3F", a missing file.
    func testThePlayerAddressKeepsItsQuery() {
        let url = ExtensionHost().playerURL
        XCTAssertEqual(url.absoluteString, "webkit-extension://kepuli-tv/player.html?ios=1")
        XCTAssertEqual(url.query, "ios=1")
    }

    /// A service worker background never starts in WebKit and says nothing;
    /// without nativeMessaging the page cannot reach the app.
    func testTheBundledManifestIsTheAppsOwn() throws {
        let file = try XCTUnwrap(Bundle.main.resourceURL).appendingPathComponent("extension/manifest.json")
        let manifest = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any])
        XCTAssertNil(manifest["background"])
        XCTAssertNil(manifest["browser_specific_settings"])
        XCTAssertEqual((manifest["permissions"] as? [String])?.contains("nativeMessaging"), true)
    }

    /// Full screen is the app's: WebKit's own for an element, with its
    /// banner naming the page's address, is off; the app's gives the web
    /// view the whole screen without the system's bars, and a page that
    /// connects anew (the one before may have died there) finds them back.
    @MainActor
    func testFullScreenIsTheAppsOwn() throws {
        let player = try XCTUnwrap(Bridge.shared.presenter as? PlayerViewController)
        let until = Date().addingTimeInterval(20)
        while player.host.webView == nil && Date() < until { RunLoop.main.run(until: Date().addingTimeInterval(0.1)) }
        let webView = try XCTUnwrap(player.host.webView)
        XCTAssertFalse(webView.configuration.preferences.isElementFullscreenEnabled)
        XCTAssertFalse(player.full)
        XCTAssertFalse(player.prefersStatusBarHidden)
        let inside = webView.frame.size

        player.setFull(true)
        XCTAssertTrue(player.full)
        XCTAssertTrue(player.prefersStatusBarHidden)
        XCTAssertTrue(player.prefersHomeIndicatorAutoHidden)
        XCTAssertEqual(webView.frame.size, player.view.bounds.size)
        XCTAssertGreaterThan(webView.frame.height, inside.height)

        Services.screen.pageConnected()
        XCTAssertFalse(player.full)
        XCTAssertFalse(player.prefersStatusBarHidden)
        XCTAssertFalse(player.prefersHomeIndicatorAutoHidden)
        XCTAssertEqual(webView.frame.size, inside)
    }

    /// A web content process that ends is reloaded at once, but one that
    /// ends again soon after its reload waits longer each time: a page
    /// whose own start ends it would otherwise be started without pause.
    func testAPageThatDiesAtItsStartIsReloadedEverMoreSlowly() {
        XCTAssertEqual(PlayerViewController.patience(after: 0, lived: Date().timeIntervalSince(.distantPast)), 0)
        var wait: TimeInterval = 0, waits: [TimeInterval] = []
        for _ in 1...7 {
            wait = PlayerViewController.patience(after: wait, lived: 5)
            waits.append(wait)
        }
        XCTAssertEqual(waits, [2, 4, 8, 16, 32, 60, 60])
        XCTAssertEqual(PlayerViewController.patience(after: 60, lived: 61), 0)
    }

    /// The strips around the web view under a dialog's backdrop: the light
    /// theme's ground with its backdrop over it, and the dark theme's.
    func testTheStripsAreDimmedAsThePageIs() {
        let hex = { (colour: UIColor) -> String in
            var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0
            colour.getRed(&red, green: &green, blue: &blue, alpha: nil)
            return String(format: "#%02x%02x%02x", Int(round(red * 255)), Int(round(green * 255)), Int(round(blue * 255)))
        }
        let light = UIColor(red: 0xf3 / 255.0, green: 0xf4 / 255.0, blue: 0xf8 / 255.0, alpha: 1)
        XCTAssertEqual(hex(PlayerViewController.shaded(light, [22, 25, 37, 0.35])), "#a6a7ae")
        let dark = UIColor(red: 0x0a / 255.0, green: 0x0c / 255.0, blue: 0x11 / 255.0, alpha: 1)
        XCTAssertEqual(hex(PlayerViewController.shaded(dark, [5, 6, 10, 0.66])), "#07080c")
        XCTAssertEqual(hex(PlayerViewController.shaded(light, [0, 0, 0, 0])), "#f3f4f8")
    }

    /// The page's theme setting for what the system draws: "system" is no
    /// override, or the page would stop following the device's appearance.
    func testThePagesThemeIsTheWindowsOnlyWhenChosen() {
        XCTAssertEqual(PlayerViewController.style("dark"), .dark)
        XCTAssertEqual(PlayerViewController.style("light"), .light)
        for other in ["system", "", nil] { XCTAssertEqual(PlayerViewController.style(other), .unspecified) }
    }
}
