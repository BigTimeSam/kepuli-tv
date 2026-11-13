import XCTest
@testable import KepuliTV

/// The pure halves of the services in App/Services: what a reminder list
/// becomes, where an address goes, what a saved file is called. The first
/// is a crash if wrong (a notification scheduled into the past ends the
/// app), and no simulator scenario sees a list of seventy reminders.
final class ServicesTests: XCTestCase {
    private let account = "http://example.org:80/demo"
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    private func item(_ id: String, in seconds: Double, text: String = "", channel: Any = ["id": 1170, "n": "North One"]) -> [String: Any] {
        ["id": id, "at": (now.timeIntervalSince1970 + seconds) * 1000, "text": text, "channel": channel]
    }

    // MARK: Reminders.plan

    func testAReminderIsNamedByItsAccountAndItsId() throws {
        let plan = Reminders.plan(account: account, items: [item("1170:1800003600000", in: 3540, text: "Evening News starts at 19.00 on North One.")], now: now)
        XCTAssertEqual(plan.map(\.identifier), ["reminder|http://example.org:80/demo|1170:1800003600000"])
        XCTAssertEqual(plan[0].at, now.addingTimeInterval(3540))
        XCTAssertEqual(plan[0].text, "Evening News starts at 19.00 on North One.")
        let channel = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(plan[0].channel.utf8)) as? [String: Any])
        XCTAssertEqual(channel["id"] as? Int, 1170)
        XCTAssertEqual(channel["n"] as? String, "North One")
        XCTAssertTrue(plan[0].identifier.hasPrefix(Reminders.mark(account)))
    }

    /// The page's list still holds what fell due while the app was closed;
    /// an interval of zero or less raises an exception in the trigger.
    func testWhatIsDueOrPastIsDropped() {
        let items = [item("past", in: -3600), item("now", in: 0), item("at-the-edge", in: 1), item("soon", in: 1.5), item("later", in: 60)]
        XCTAssertEqual(Reminders.plan(account: account, items: items, now: now).map(\.identifier),
                       ["soon", "later"].map { Reminders.mark(account) + $0 })
        for planned in Reminders.plan(account: account, items: items, now: now) {
            XCTAssertGreaterThan(planned.at.timeIntervalSince(now), 0)
        }
    }

    /// iOS keeps 64 pending notifications of an app and drops the rest.
    func testTheNearestSixtyAreKeptInOrder() {
        let items = (1...70).shuffled().map { item("r\($0)", in: Double($0) * 600) }
        let plan = Reminders.plan(account: account, items: items, now: now)
        XCTAssertEqual(plan.count, 60)
        XCTAssertEqual(plan.map(\.identifier), (1...60).map { Reminders.mark(account) + "r\($0)" })
    }

    func testAnItemWithoutItsIdOrTimeIsLeftOut() {
        let items: [[String: Any]] = [["at": 1_800_000_600_000.0], ["id": "no-time"], ["id": "not-a-time", "at": "soon"],
                                      ["id": "bare", "at": 1_800_000_600_000.0]]
        let plan = Reminders.plan(account: account, items: items, now: now)
        XCTAssertEqual(plan.map(\.identifier), [Reminders.mark(account) + "bare"])
        XCTAssertEqual(plan[0].text, "")
        XCTAssertEqual(plan[0].channel, "{}")
    }

    /// The page's object may hold a null, which a notification's own
    /// dictionary would refuse: the channel travels as text.
    func testAChannelWithANullTravelsWhole() throws {
        let plan = Reminders.plan(account: account, items: [item("a", in: 60, channel: ["id": "x", "logo": NSNull(), "cats": [1, 2]])], now: now)
        let channel = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(plan[0].channel.utf8)) as? [String: Any])
        XCTAssertTrue(channel["logo"] is NSNull)
        XCTAssertEqual(channel["cats"] as? [Int], [1, 2])
    }

    /// One account's reminders are told from another's by their beginning.
    func testAccountsDoNotShareAMark() {
        let other = Reminders.plan(account: "m3u:http://example.org/list.m3u", items: [item("a", in: 60)], now: now)
        XCTAssertFalse(other[0].identifier.hasPrefix(Reminders.mark(account)))
    }

    /// The page says a reminder in its strip only when it can be seen
    /// there and holds it: otherwise the system's banner is the only word.
    func testAReminderInFrontIsLeftToThePageOnlyWhenThePageCanSayIt() {
        XCTAssertFalse(Reminders.shows(connected: true, covered: false, account: account, current: account))
        // Google's remote control, a web page or a picker lies over the strip.
        XCTAssertTrue(Reminders.shows(connected: true, covered: true, account: account, current: account))
        // The page holds the reminders of the account it shows, and no other's.
        XCTAssertTrue(Reminders.shows(connected: true, covered: false, account: account, current: "m3u:http://example.org/list.m3u"))
        XCTAssertTrue(Reminders.shows(connected: true, covered: false, account: account, current: nil))
        XCTAssertTrue(Reminders.shows(connected: true, covered: false, account: nil, current: nil))
        // The web process died (Bridge.pageGone), or the page is being loaded again.
        XCTAssertTrue(Reminders.shows(connected: false, covered: false, account: account, current: account))
        // A dialog of the page's own is open: its strip lies under the backdrop.
        XCTAssertTrue(Reminders.shows(connected: true, covered: false, dialog: true, account: account, current: account))
        XCTAssertFalse(Reminders.shows(connected: true, covered: false, dialog: false, account: account, current: account))
    }

    /// The page's stand-in: what the app said to it, and its own first word.
    private final class FakePort: PagePort {
        var messageHandler: ((Any?, (any Error)?) -> Void)?
        var disconnectHandler: (((any Error)?) -> Void)?
        var heard: [String] = []
        func sendMessage(_ message: Any?, completionHandler: (((any Error)?) -> Void)?) {
            heard.append((message as? [String: Any])?["type"] as? String ?? "?")
            completionHandler?(nil)
        }
        func speak() { messageHandler?(["type": "hello"], nil) }
    }

    /// WebKit closes no port when the web content process ends, so the
    /// bridge is told: the dead page counts as gone, and a reminder tapped
    /// just before the end was told (it went into the dead port, with no
    /// error) or after it is heard by the page that is loaded next.
    func testAPageWhoseProcessEndedIsNotConnectedAndItsTapIsKept() {
        let bridge = Bridge()
        let dead = FakePort()
        bridge.attach(dead)
        XCTAssertFalse(bridge.connected)
        dead.speak()
        XCTAssertTrue(bridge.connected)
        // The tap arrives before the end of the process is told.
        bridge.send("reminder.open", ["account": account], keep: true)
        bridge.send("cast.state", ["state": "disconnected"])
        XCTAssertEqual(dead.heard, ["host", "reminder.open", "cast.state"])
        bridge.pageGone()
        XCTAssertFalse(bridge.connected)
        // And one after it, with no page at all.
        bridge.send("reminder.open", ["account": account], keep: true)
        bridge.send("cast.state", ["state": "disconnected"])
        XCTAssertEqual(dead.heard.count, 3)
        let next = FakePort()
        bridge.attach(next)
        next.speak()
        XCTAssertTrue(bridge.connected)
        XCTAssertEqual(next.heard, ["host", "reminder.open", "reminder.open"])
        // Heard by a living page, it is not said again to the one after.
        bridge.attach(FakePort())
        let last = FakePort()
        bridge.attach(last)
        last.speak()
        XCTAssertEqual(last.heard, ["host"])
    }

    /// Notifications allowed in the device's settings while the app lives:
    /// the reminder set while they were refused, which the system dropped,
    /// is scheduled when the app comes back to the front.
    func testAReminderSetWhileRefusedIsScheduledOnceTheLeaveIsGiven() throws {
        let notifier = try XCTUnwrap(FakeNotifier("fake-denied"))
        let reminders = Reminders(notifier: notifier)
        var answer: [String: Any] = [:]
        reminders.handle("notify.set", ["on": true]) { answer = $0 }
        XCTAssertEqual(answer["system"] as? String, "denied")
        reminders.handle("reminders.set", ["account": account, "items": [item("a", in: 600)]]) { _ in }
        XCTAssertEqual(notifier.scheduled, [])
        reminders.activated()
        XCTAssertEqual(notifier.scheduled, [])
        notifier.system = "granted"
        reminders.activated()
        XCTAssertEqual(notifier.scheduled, [Reminders.mark(account) + "a"])
        // Taken away again there: nothing more is added, and what the
        // system holds it keeps to itself.
        notifier.system = "denied"
        reminders.handle("reminders.set", ["account": account, "items": [item("a", in: 600), item("b", in: 900)]]) { _ in }
        XCTAssertEqual(notifier.scheduled, [Reminders.mark(account) + "a"])
    }

    /// An account's key is its address, a playlist's with the user name
    /// and the password in it: the debug status shows a number in its place.
    func testTheDebugStatusNamesNoAccount() {
        let playlist = "m3u:http://example.org/get.php?username=demo&password=demo", portal = "stalker:http://example.org/c/|00:1A:79:00:00:01"
        let accounts = [portal, playlist, account]
        XCTAssertEqual(Reminders.shown(Reminders.mark(account) + "1170:1800003600000", accounts: accounts), "reminder|#0|1170:1800003600000")
        XCTAssertEqual(Reminders.shown(Reminders.mark(playlist) + "a|b", accounts: accounts), "reminder|#1|a|b")
        XCTAssertEqual(Reminders.shown(Reminders.mark(portal) + "7:1", accounts: accounts), "reminder|#2|7:1")
        // One of an account not heard of in this launch shows nothing of itself.
        XCTAssertEqual(Reminders.shown(Reminders.mark("m3u:http://example.net/secret.m3u") + "1:2", accounts: accounts), "reminder|?|")
        for identifier in [Reminders.mark(playlist) + "x", Reminders.mark(portal) + "y", "reminder|http://other.example/user|z"] {
            let shown = Reminders.shown(identifier, accounts: accounts)
            XCTAssertFalse(shown.contains("example") || shown.contains("password") || shown.contains("00:1A"), shown)
        }
    }

    // MARK: LinkOpener.route

    private func route(_ address: String) throws -> LinkOpener.Route {
        LinkOpener.route(try XCTUnwrap(URL(string: address)))
    }

    func testWebPagesOpenOverThePlayer() throws {
        for address in ["https://bigtimesam.github.io/kepuli-tv/iptv-app-iphone-ipad/", "https://bigtimesam.github.io/kepuli-tv/privacy/",
                        "https://www.imdb.com/title/tt0000001/", "http://example.org/trailer", "HTTPS://www.themoviedb.org/movie/1"] {
            XCTAssertEqual(try route(address), .page, address)
        }
    }

    func testTheAppStoreAndOtherSchemesGoToTheSystem() throws {
        for address in ["https://apps.apple.com/app/vlc-media-player/id650377962", "https://itunes.apple.com/app/id650377962",
                        "https://APPS.apple.com/app/id650377962",
                        "vlc-x-callback://x-callback-url/stream?url=http%3A%2F%2Fexample.org%3A8080%2Flive%2Fdemo%2Fdemo%2F1170.ts",
                        "mailto:someone@example.org", "tel:0", "itms-apps://apps.apple.com/app/id650377962"] {
            XCTAssertEqual(try route(address), .app, address)
        }
    }

    /// Safari's view raises an exception for anything but http and https
    /// with a host, so nothing else may be sorted to it.
    func testOnlyHttpWithAHostIsAPage() throws {
        for address in ["file:///etc/hosts", "javascript:void(0)", "http:///nowhere", "https:", "ftp://example.org/file", "x://example.org"] {
            XCTAssertEqual(try route(address), .app, address)
        }
    }

    /// The status is pasted into reports: outside a recording run (the
    /// mock's) a link is kept as where it led, never with what it carried.
    func testTheDebugStatusKeepsNoAddressOfAStream() throws {
        let vlc = try XCTUnwrap(URL(string: "vlc-x-callback://x-callback-url/stream?url=http%3A%2F%2Fexample.org%3A8080%2Flive%2Fdemo%2Fsecret%2F1170.ts"))
        XCTAssertEqual(LinkOpener.noted(vlc, whole: false), "vlc-x-callback://x-callback-url")
        XCTAssertEqual(LinkOpener.noted(vlc, whole: true), vlc.absoluteString)
        let page = try XCTUnwrap(URL(string: "https://www.imdb.com/find?q=demo"))
        XCTAssertEqual(LinkOpener.noted(page, whole: false), "https://www.imdb.com")
    }

    // MARK: DownloadSaver.fileName

    func testASavedFilesNameIsANameAlone() {
        XCTAssertEqual(DownloadSaver.fileName("kepuli-tv-settings.json"), "kepuli-tv-settings.json")
        XCTAssertEqual(DownloadSaver.fileName("../../Library/Preferences/x.plist"), "x.plist")
        XCTAssertEqual(DownloadSaver.fileName("/etc/hosts"), "hosts")
        for empty in ["", ".", "..", "/", "a/.."] {
            XCTAssertEqual(DownloadSaver.fileName(empty), "download", empty)
        }
    }
}
