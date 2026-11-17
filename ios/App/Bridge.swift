import UIKit
import WebKit

/// One part of the app that answers the page: the Cast sender, the idle
/// timer, the reminders.
protocol NativeService: AnyObject {
    /// The start of the message types it takes: "cast." takes cast.prompt,
    /// cast.load …; "awake" takes awake.
    var prefix: String { get }
    /// For a service that takes two families of messages (Reminders:
    /// notify.* and reminders.*). The default is the one prefix.
    var prefixes: [String] { get }
    /// `reply` may be called once, at any later time; for a message the
    /// page sent without an id it does nothing.
    func handle(_ type: String, _ body: [String: Any], reply: @escaping ([String: Any]) -> Void)
    /// A page connected or reloaded: send it the current state.
    func pageConnected()
    /// The page's process ended (`Bridge.pageGone`): what the page held of
    /// the app is let go now, as the next page may be a minute in coming
    /// (`PlayerViewController.recover`). Nothing by default.
    func pageGone()
}

extension NativeService {
    var prefixes: [String] { [prefix] }
    func pageGone() {}
}

/// What the bridge needs of the page's port, so that a test can stand in
/// for a page: WKWebExtension.MessagePort cannot be made outside WebKit.
protocol PagePort: AnyObject {
    var messageHandler: ((Any?, (any Error)?) -> Void)? { get set }
    var disconnectHandler: (((any Error)?) -> Void)? { get set }
    func sendMessage(_ message: Any?, completionHandler: (((any Error)?) -> Void)?)
}

extension WKWebExtension.MessagePort: PagePort {}

/// The page's port to the app (runtime.connectNative in js/host.js) and the
/// routing of its messages. Both ways a message is { type, id?, …fields };
/// the answer to one with an id is { re: id, ok, error?, …fields }.
///
/// Nothing here logs a message's body, in any build: a stream's address
/// carries the account's user name and password. DEBUG logs the types.
final class Bridge {
    static let shared = Bridge()

    /// The view controller that dialogs and pickers are presented from.
    weak var presenter: UIViewController?

    private var services: [NativeService] = []
    private var port: PagePort?
    /// Whether the page on `port` has been greeted, which is when it is
    /// known to hear what the app says.
    private var ready = false
    private var kept: [[String: Any]] = []
    /// What was sent with `keep`, and when: see `pageGone`.
    private var sent: [(at: Date, message: [String: Any])] = []
    /// How long a kept message counts as perhaps unheard by a page that
    /// then turned out to be gone.
    static let unheard: TimeInterval = 10

    var connected: Bool { ready }

    func register(_ service: NativeService) { services.append(service) }

    /// A page opened its port. It replaces an earlier one: after a reload
    /// the old page's port may be reported closed only after the new one
    /// has arrived, which is why the handlers below check which port they
    /// belong to.
    ///
    /// Nothing is said to the page yet. WebKit delivers a native message
    /// only once the page's onMessage listener is registered with it, and
    /// drops it without an error before: measured on iOS 26.5, what was
    /// sent here, or on the next turn of the run loop, never arrived, and
    /// what was sent 10 ms later did. There is no call that tells when the
    /// listener is in, but the page's first message does: js/host.js adds
    /// its listener before it sends anything, and WebKit handles the two in
    /// that order. So the page is greeted at its first message, or after
    /// half a second (the spike's measured delay) if it has nothing to say.
    func attach(_ port: PagePort) {
        self.port = port
        ready = false
        port.messageHandler = { [weak self, weak port] message, _ in
            guard let self, let port else { return }
            self.greet(port)
            self.receive(message, from: port)
        }
        port.disconnectHandler = { [weak self, weak port] _ in
            guard let self, self.port === port else { return }
            self.port = nil
            self.ready = false
            debugLog("bridge: the port closed")
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self, weak port] in
            if let port { self?.greet(port) }
        }
    }

    /// Once for each port: who the app is, what was kept for a page, and
    /// every service's current state.
    private func greet(_ port: PagePort) {
        guard self.port === port, !ready else { return }
        ready = true
        debugLog("bridge: a page connected")
        let info = Bundle.main.infoDictionary ?? [:]
        var simulator = false
        #if targetEnvironment(simulator)
        simulator = true
        #endif
        var debug = false
        #if DEBUG
        debug = true
        #endif
        send("host", [
            "v": 1,
            "idiom": UIDevice.current.userInterfaceIdiom == .pad ? "pad" : "phone",
            "version": info["CFBundleShortVersionString"] as? String ?? "",
            "build": info["CFBundleVersion"] as? String ?? "",
            "debug": debug,
            "simulator": simulator,
        ])
        // Through `send`, which notes when each was said: a page that
        // dies at its start has not heard them either (`pageGone`).
        let waiting = kept
        kept = []
        for var message in waiting {
            let type = message.removeValue(forKey: "type") as? String ?? ""
            send(type, message, keep: true)
        }
        for service in services { service.pageConnected() }
    }

    /// The web content process ended (Navigation). WebKit closes no port
    /// for it: a dead process cannot say that its page went, and the
    /// port's disconnectHandler was never called (measured on iOS 26.5;
    /// WebKit disconnects a page's ports only when the page is removed).
    /// Until the page loaded again had connected, the bridge counted the
    /// dead one as hearing: a reminder tapped then, which is how a phone
    /// commonly wakes an app whose web process was taken while it slept,
    /// went into the dead port and played nothing, and one that fell due
    /// was left to a page that was not there (`Reminders.shows`).
    ///
    /// What was sent with `keep` in the last seconds is kept again for
    /// the next page: the tap may be handled before the end of the process
    /// is told, and the dead port took it without an error. A page that
    /// did hear it hears it twice, which it must bear (js/remindersui.js
    /// goes by the tap's own time).
    func pageGone() {
        port = nil
        ready = false
        let now = Date()
        kept += sent.filter { now.timeIntervalSince($0.at) < Self.unheard }.map(\.message)
        sent = []
        debugLog("bridge: the page is gone")
        for service in services { service.pageGone() }
    }

    /// An event for the page. With `keep` it waits for a page when none is
    /// connected (a notification tapped while the app was closed); without,
    /// it is dropped, as the page asks for the state when it connects.
    func send(_ type: String, _ body: [String: Any] = [:], keep: Bool = false) {
        var message = body
        message["type"] = type
        guard let port, ready else {
            if keep { kept.append(message) }
            return
        }
        debugLog("bridge > \(type)")
        if keep {
            let now = Date()
            sent = sent.filter { now.timeIntervalSince($0.at) < Self.unheard } + [(now, message)]
        }
        port.sendMessage(message) { _ in }
    }

    private func receive(_ message: Any?, from port: PagePort) {
        guard let body = message as? [String: Any], let type = body["type"] as? String else { return }
        debugLog("bridge < \(type)")
        let id = body["id"] as? NSNumber
        var replied = false
        // The answer goes to the port the question came by: a page that has
        // reloaded since numbers its requests anew.
        let reply: ([String: Any]) -> Void = { [weak port] fields in
            guard let id, !replied else { return }
            replied = true
            var answer = fields
            answer["re"] = id
            if answer["ok"] == nil { answer["ok"] = true }
            port?.sendMessage(answer) { _ in }
        }
        guard let service = services.first(where: { $0.prefixes.contains { type.hasPrefix($0) } }) else {
            reply(["ok": false, "error": "unknown"])
            return
        }
        service.handle(type, body, reply: reply)
    }
}
