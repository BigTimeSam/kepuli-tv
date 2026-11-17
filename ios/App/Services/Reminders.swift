import UIKit
import UserNotifications

/// The guide's reminders as the system's notifications, which fire with
/// the app closed too: more than a browser's page manages.
///
/// The page (js/remindersui.js) asks notify.get and notify.set {on} and is
/// answered {on, system: granted | denied | unasked}: the app's own switch
/// and the system's leave, which is asked for only when the switch is
/// turned on. It sends reminders.set {account, items: [{id, at, text,
/// channel}]} at every change, the whole list of the account it shows,
/// and reminders.clear {account?} when an account is removed from its
/// list or, with none named, when the player is reset. A notification
/// tapped goes back as reminder.open {channel, account, id, at}: the
/// item's id and when it was tapped. `notify {on, system}` is said unasked
/// when the system's leave is found changed as the app comes to the front.
///
/// Services creates the one instance and AppDelegate makes it the
/// notification centre's delegate before launch ends.
final class Reminders: NSObject, NativeService, UNUserNotificationCenterDelegate {
    let prefix = "notify."
    /// Two families of messages: notify.get and notify.set, and reminders.*.
    var prefixes: [String] { [prefix, "reminders."] }

    /// One notification to be scheduled.
    struct Planned: Equatable {
        /// reminder|<bytes of the account>|<account>|<id>: an account's
        /// own are found by their beginning, among those of the accounts
        /// the page does not show (`mark`).
        let identifier: String
        /// The page's own name for the reminder, handed back with a tap.
        let id: String
        let at: Date
        let text: String
        /// The channel as JSON text, to be handed back untouched. Text,
        /// because a notification carries property-list values only and
        /// the page's object may hold a null.
        let channel: String
    }

    /// iOS keeps the 64 soonest of an app's pending notifications and
    /// drops the rest without a word; this leaves a few for another account.
    static let most = 60

    /// How an account's identifiers begin. With the key's length, as a key
    /// is free text (js/config.js): `reminder|<account>|` alone also began
    /// the identifiers of an account whose key went on with a `|`, and a
    /// change to the one's list took the other's reminders away.
    static func mark(_ account: String) -> String { "reminder|\(account.utf8.count)|\(account)|" }

    /// How near its moment a pending notification is the system's and no
    /// longer the plan's to take away (`schedule`).
    static let settled: TimeInterval = 5

    /// Which pending notifications of an account go when its list has
    /// changed: its own that the new plan does not keep, but none within
    /// `settled` of its moment. The page's timer and the notification are
    /// set for the same instant, and the page, in front, takes the
    /// reminder out of its list as it says it: the list sent then removed
    /// the notification before the system had delivered it, so that
    /// `willPresent` was never asked and the banner for a reminder the
    /// page could not show (a dialog open, Google's remote control over
    /// the player) never came.
    static func stale(_ pending: [String], account: String, keep: Set<String>, due: [String: Date], now: Date) -> [String] {
        pending.filter { $0.hasPrefix(mark(account)) && !keep.contains($0) && !(due[$0].map { $0.timeIntervalSince(now) < settled } ?? false) }
    }

    /// Whether the system shows a notification that falls due with the app
    /// in front. Not when the page says the reminder in its own strip,
    /// which a banner would say twice: the page hears the app, nothing
    /// lies over the player (`covered`: Google's remote control, a web
    /// page, a picker), no dialog of the page's own is open (`dialog`:
    /// Settings, the help; the strip lies dimmed under its backdrop and
    /// cannot be pressed, and the reminder was lost there), and the
    /// reminder is of the account the page shows, the only one whose
    /// reminders it holds.
    static func shows(connected: Bool, covered: Bool, dialog: Bool = false, account: String?, current: String?) -> Bool {
        !(connected && !covered && !dialog && account != nil && account == current)
    }

    /// An identifier as the debug status shows it: its account is a number
    /// there, its place among those heard of in this launch, and one of an
    /// account not heard of shows nothing of itself. An account's key is
    /// its address: a playlist's whole one, user name and password in it.
    static func shown(_ identifier: String, accounts: [String]) -> String {
        guard let own = accounts.sorted().enumerated().first(where: { identifier.hasPrefix(mark($0.element)) }) else { return "reminder|?|" }
        return "reminder|#\(own.offset)|" + identifier.dropFirst(mark(own.element).count)
    }

    /// What to schedule of an account's reminders: the nearest `most`, and
    /// none at or before a second from now. The page's list still holds a
    /// reminder that fell due while the app was closed or out of sight,
    /// and a time-interval trigger raises an exception for an interval of
    /// zero or less, which ends the app.
    static func plan(account: String, items: [[String: Any]], now: Date) -> [Planned] {
        let planned: [Planned] = items.compactMap { item in
            guard let id = item["id"] as? String, let at = (item["at"] as? NSNumber)?.doubleValue, at.isFinite else { return nil }
            let channel = item["channel"].flatMap { JSONSerialization.isValidJSONObject($0) ? try? JSONSerialization.data(withJSONObject: $0) : nil }
            return Planned(identifier: mark(account) + id, id: id, at: Date(timeIntervalSince1970: at / 1000),
                           text: item["text"] as? String ?? "", channel: channel.map { String(decoding: $0, as: UTF8.self) } ?? "{}")
        }
        return Array(planned.filter { $0.at.timeIntervalSince(now) > 1 }.sorted { $0.at < $1.at }.prefix(most))
    }

    /// UserDefaults: the switch in Settings. On until turned off, so the
    /// first reminder set asks the system and nothing else stands between.
    private static let enabledKey = "remindersEnabled"
    private var enabled: Bool {
        get { defaults.object(forKey: Self.enabledKey) as? Bool ?? true }
        set { defaults.set(newValue, forKey: Self.enabledKey) }
    }

    private let notifier: Notifier
    private let defaults: UserDefaults
    /// What is said to the page: the bridge's `send`, or a test's ear.
    private let say: (String, [String: Any], Bool) -> Void
    /// When each notification added in this launch falls due (`stale`).
    private var due: [String: Date] = [:]
    /// The reminders as the page last said them, by account, for this
    /// launch: what is scheduled again when the switch is turned back on
    /// or the system's leave is given. The first reminder is sent before
    /// the viewer has answered the system's question, and a notification
    /// added before the leave is given is dropped without an error
    /// (measured on iOS 26.5: it never became pending).
    private var said: [String: [[String: Any]]] = [:]
    /// Counts each account's changes, so that an answer from the system
    /// that was overtaken by a newer list schedules nothing.
    private var turns: [String: Int] = [:]
    /// The account of the last reminders.set: the one the page shows.
    private var current: String?
    /// The system's leave as last heard (`activated`).
    private var system: String?

    override convenience init() {
        #if DEBUG
        let variable = ProcessInfo.processInfo.environment["KEPULI_NOTIFY"]
        self.init(notifier: FakeNotifier(variable) ?? SystemNotifier(quiet: variable == "quiet"))
        #else
        self.init(notifier: SystemNotifier())
        #endif
    }

    init(notifier: Notifier, defaults: UserDefaults = .standard,
         say: @escaping (String, [String: Any], Bool) -> Void = { Bridge.shared.send($0, $1, keep: $2) }) {
        self.notifier = notifier
        self.defaults = defaults
        self.say = say
        super.init()
        NotificationCenter.default.addObserver(self, selector: #selector(activated), name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    /// The app came to the front, perhaps from the device's settings: the
    /// leave is asked for again. It was read once, at the page's start, so
    /// a viewer who allowed notifications there, as the page's own message
    /// had told them to, kept a reminder the system had dropped (it was
    /// added while refused) and a switch that still said off. Changed, the
    /// lists are scheduled again and the page is told.
    @objc func activated() {
        notifier.status { system in
            let before = self.system
            self.system = system
            guard let before, before != system else { return }
            self.scheduleAll()
            self.say("notify", ["on": self.enabled, "system": system], false)
        }
    }

    // MARK: the page

    func handle(_ type: String, _ body: [String: Any], reply: @escaping ([String: Any]) -> Void) {
        switch type {
        case "notify.get":
            notifier.status { self.system = $0; reply(["on": self.enabled, "system": $0]) }
        case "notify.set":
            let on = body["on"] as? Bool ?? false
            enabled = on
            let done: (String) -> Void = { system in
                self.system = system
                self.scheduleAll()
                reply(["on": on, "system": system])
            }
            notifier.status { system in
                if on && system == "unasked" { self.notifier.ask(done) } else { done(system) }
            }
        case "reminders.set":
            if let account = body["account"] as? String {
                current = account
                said[account] = body["items"] as? [[String: Any]] ?? []
                schedule(account)
            }
            reply([:])
        case "reminders.clear":
            // An account left the page's list, or with none named every
            // one did: nothing of theirs is left with the system, where it
            // would fire for a viewer who has deleted it. A list still on
            // its way to being scheduled is overtaken. Answered when done,
            // as the page loads itself again after this.
            let account = body["account"] as? String
            for key in turns.keys where account == nil || key == account { turns[key, default: 0] += 1 }
            if let account { said[account] = nil } else { said = [:] }
            let mark = account.map(Self.mark) ?? "reminder|"
            notifier.pending { identifiers in
                self.notifier.remove(identifiers.filter { $0.hasPrefix(mark) })
                reply([:])
            }
        default:
            reply(["ok": false, "error": "unknown"])
        }
    }

    /// Nothing to say unasked: the page asks for the switch when it starts
    /// and sends its reminders then.
    func pageConnected() {}

    // MARK: scheduling

    /// The account's notifications made to be its list as last said: those
    /// planned are added (one of the same name is replaced) and its others
    /// taken away, but for one about to fire (`stale`). With the switch
    /// off, all of them are taken away.
    private func schedule(_ account: String) {
        let turn = (turns[account] ?? 0) + 1
        turns[account] = turn
        notifier.pending { identifiers in
            guard turn == self.turns[account] else { return }
            let now = Date()
            let planned = self.enabled ? Self.plan(account: account, items: self.said[account] ?? [], now: now) : []
            self.due = self.due.filter { now.timeIntervalSince($0.value) < 60 }
            self.notifier.remove(Self.stale(identifiers, account: account, keep: Set(planned.map(\.identifier)), due: self.enabled ? self.due : [:], now: now))
            for one in planned {
                self.due[one.identifier] = one.at
                self.notifier.add(one, account: account)
            }
        }
    }

    /// After the switch or the system's leave changed. Turned off, the
    /// notifications of every account go, those of accounts not heard of
    /// in this launch too: they come back when their account is next shown.
    private func scheduleAll() {
        if enabled {
            for account in said.keys { schedule(account) }
        } else {
            notifier.pending { if !self.enabled { self.notifier.remove($0.filter { $0.hasPrefix("reminder|") }) } }
        }
    }

    // MARK: a notification

    /// In front, the page says the reminder in its own strip, where it
    /// can (see `shows`); otherwise the system does.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        let account = notification.request.content.userInfo["account"] as? String
        // The bridge and the views are the main thread's, wherever the system calls this.
        DispatchQueue.main.async {
            let player = Bridge.shared.presenter
            let covered = player.map { $0.frontmost !== $0 } ?? true
            let shows = Self.shows(connected: Bridge.shared.connected, covered: covered, dialog: (player as? PlayerViewController)?.dialogOpen == true,
                                   account: account, current: self.current)
            completionHandler(shows ? [.banner, .list, .sound] : [])
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let info = response.notification.request.content.userInfo
        let channel = info["channel"] as? String, account = info["account"] as? String, id = info["id"] as? String
        if response.actionIdentifier == UNNotificationDefaultActionIdentifier {
            // The bridge is the main thread's, wherever the system calls this.
            DispatchQueue.main.async { self.tapped(channel: channel, account: account, id: id) }
        }
        completionHandler()
    }

    /// The channel goes back to the page, which plays it if it is still
    /// that account's and the tap is fresh (js/remindersui.js, watchAsked).
    /// Kept for a page that is not there yet: the tap may be what launched
    /// the app. With the reminder's id, so that the page does not say in
    /// its strip what the viewer has just answered, and the tap's own time:
    /// a page that hears of it late (it was loaded again after its process
    /// had ended, and waited its turn) starts nothing by then.
    private func tapped(channel: String?, account: String?, id: String?) {
        guard let account, let channel,
              let value = try? JSONSerialization.jsonObject(with: Data(channel.utf8)) as? [String: Any] else { return }
        say("reminder.open", ["channel": value, "account": account, "id": id ?? "", "at": (Date().timeIntervalSince1970 * 1000).rounded()], true)
    }

    #if DEBUG
    /// For `node ios/sim.mjs status`: the switch, the notifier, the plan of
    /// what the page last said, and what the notifier holds (the system's
    /// own lists are asked for at each reading and shown from the one
    /// before). The sentences are here; the channels are not, as a playlist
    /// channel carries its address, and neither are the accounts, for the
    /// same reason (see `shown`).
    var debugState: [String: Any] {
        let now = Date()
        let plan = said.flatMap { account, items in Self.plan(account: account, items: items, now: now) }.sorted { $0.at < $1.at }
        let shown = { (identifier: String) in Self.shown(identifier, accounts: Array(self.said.keys)) }
        var state = notifier.debugState
        for list in ["pending", "delivered"] { state[list] = (state[list] as? [String])?.map(shown).sorted() }
        state["enabled"] = enabled
        state["plan"] = plan.map { ["identifier": shown($0.identifier), "at": Int($0.at.timeIntervalSince1970 * 1000),
                                    "in": Int($0.at.timeIntervalSince(now).rounded()), "text": $0.text] }
        return state
    }

    /// `node ios/sim.mjs native 'tap-reminder <id>'`: the tap on the
    /// notification of the reminder with that id, of what the page last said.
    func debugTap(_ id: String) {
        for (account, items) in said {
            guard let one = Self.plan(account: account, items: items, now: .distantPast).first(where: { $0.identifier == Self.mark(account) + id }) else { continue }
            tapped(channel: one.channel, account: account, id: one.id)
        }
    }
    #endif
}

/// What Reminders needs of the system's notifications, so that a scenario
/// can run without them. Every answer comes on the main thread.
protocol Notifier: AnyObject {
    /// granted | denied | unasked
    func status(_ answer: @escaping (String) -> Void)
    /// Asks the viewer, and answers as `status` does.
    func ask(_ answer: @escaping (String) -> Void)
    /// The identifiers of the notifications still to come.
    func pending(_ answer: @escaping ([String]) -> Void)
    func remove(_ identifiers: [String])
    func add(_ planned: Reminders.Planned, account: String)
    #if DEBUG
    var debugState: [String: Any] { get }
    #endif
}

private final class SystemNotifier: Notifier {
    private let center = UNUserNotificationCenter.current()
    /// KEPULI_NOTIFY=quiet, for a scenario: the leave is asked for as a
    /// provisional one, which the system gives without a question nobody
    /// is there to answer, and delivers by.
    private let quiet: Bool

    init(quiet: Bool = false) { self.quiet = quiet }

    func status(_ answer: @escaping (String) -> Void) {
        center.getNotificationSettings { settings in
            let status: String
            switch settings.authorizationStatus {
            case .notDetermined: status = "unasked"
            case .denied: status = "denied"
            default: status = "granted"
            }
            DispatchQueue.main.async { answer(status) }
        }
    }

    func ask(_ answer: @escaping (String) -> Void) {
        center.requestAuthorization(options: quiet ? [.alert, .sound, .provisional] : [.alert, .sound]) { _, _ in self.status(answer) }
    }

    func pending(_ answer: @escaping ([String]) -> Void) {
        center.getPendingNotificationRequests { requests in
            let identifiers = requests.map(\.identifier)
            DispatchQueue.main.async { answer(identifiers) }
        }
    }

    func remove(_ identifiers: [String]) {
        if !identifiers.isEmpty { center.removePendingNotificationRequests(withIdentifiers: identifiers) }
    }

    func add(_ planned: Reminders.Planned, account: String) {
        let content = UNMutableNotificationContent()
        // The sentence the page's strip says, and no title: the system
        // heads it with the app's name.
        content.body = planned.text
        content.sound = .default
        content.userInfo = ["channel": planned.channel, "account": account, "id": planned.id]
        // Never zero or less (see Reminders.plan); the floor is for the
        // moment that passed between the plan and this line.
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, planned.at.timeIntervalSinceNow), repeats: false)
        center.add(UNNotificationRequest(identifier: planned.identifier, content: content, trigger: trigger)) { error in
            if let error { debugLog("reminders: not scheduled \((error as NSError).domain) \((error as NSError).code)") }
        }
    }

    #if DEBUG
    private var seen: [String: Any] = ["notifier": "system"]
    var debugState: [String: Any] {
        status { self.seen["system"] = $0 }
        pending { self.seen["pending"] = $0.sorted() }
        center.getDeliveredNotifications { delivered in
            let identifiers = delivered.map(\.request.identifier).sorted()
            DispatchQueue.main.async { self.seen["delivered"] = identifiers }
        }
        return seen
    }
    #endif
}

#if DEBUG
/// KEPULI_NOTIFY=fake: nothing reaches the system. The leave is unasked
/// and given when asked for; KEPULI_NOTIFY=fake-denied starts with it
/// refused and KEPULI_NOTIFY=fake-granted with it given.
final class FakeNotifier: Notifier {
    /// Set by a test as the device's settings would.
    var system: String
    private(set) var scheduled: [String] = []

    init?(_ variable: String?) {
        guard let variable, variable.hasPrefix("fake") else { return nil }
        system = ["fake-denied": "denied", "fake-granted": "granted"][variable] ?? "unasked"
    }

    func status(_ answer: @escaping (String) -> Void) { answer(system) }

    func ask(_ answer: @escaping (String) -> Void) {
        system = "granted"
        answer(system)
    }

    func pending(_ answer: @escaping ([String]) -> Void) { answer(scheduled) }

    func remove(_ identifiers: [String]) { scheduled.removeAll { identifiers.contains($0) } }

    /// As the system does: without the leave nothing is kept.
    func add(_ planned: Reminders.Planned, account: String) {
        if system == "granted" && !scheduled.contains(planned.identifier) { scheduled.append(planned.identifier) }
    }

    var debugState: [String: Any] { ["notifier": "fake", "system": system, "pending": scheduled.sorted()] }
}
#endif
