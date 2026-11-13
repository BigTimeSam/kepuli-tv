import GoogleCast
import UIKit

/// The Google Cast sender behind the page's cast.* messages (js/cast.js,
/// NativeCast; the session on the page is js/castui.js).
///
/// On iOS a page's video.remote is AirPlay and nothing mirrors a tab, so a
/// Chromecast is reached the one way left: Google's sender hands the
/// device an address and the device fetches the stream by itself. The page
/// draws its own two buttons; every dialog is Google's (the devices, the
/// terms, the session with its volume, the remote control), which is what
/// the Cast terms ask for.
///
/// The page sends cast.prompt, cast.load {id, url, contentType, live, hls?,
/// startAt, title, subtitle, image?}, cast.stop, cast.end, cast.controls.
/// The app says cast.state {state, device, devices, position?} at every
/// change of the session or of the devices found and when a page connects,
/// and cast.media {state, reason, position, duration} at every change of
/// what the device plays, and every 5 s while it plays. CastMedia has the
/// mapping both ways.
///
/// Nothing here logs an address or a title, in any build, and the SDK's
/// own log is turned off: the address carries the account's credentials.
final class CastService: NSObject, NativeService, GCKSessionManagerListener, GCKRemoteMediaClientListener,
                         GCKDiscoveryManagerListener, GCKRequestDelegate {
    let prefix = "cast."

    /// UserDefaults: the viewer has asked to cast once, and the search for
    /// devices began. Google's SDK is not started before the first cast.prompt,
    /// and starts with the app after this is set, so that the page's
    /// button can show when a device is near. The SDK then resumes its
    /// search by itself (measured: no startDiscovery call is needed).
    ///
    /// Not started means not at all. Measured (2026-11-13, SDK 4.8.6):
    /// creating the SDK's context, with analytics logging disabled and
    /// before any search, fetches clients3.google.com/cast/senderconfig/config
    /// and keeps a "pseudonymous sender id" and a database of its own in
    /// the app's container. An app whose viewer never casts should say
    /// nothing to Google, and the search itself brings the system's
    /// question about the local network.
    private static let usedKey = "castUsed"

    /// Google's SDK, once it has been started.
    private var context: GCKCastContext?
    /// Google's own Cast button, never seen: the page draws the button, and
    /// pressing this one runs the SDK's whole course (its note before the
    /// local-network question, the search, the devices, the terms, and the
    /// session's dialog while connected). Measured: a press by code on a
    /// button in a hidden view presents all of it. The hidden view is its
    /// own because the SDK, by its documentation, shows and hides the
    /// button itself.
    private var button: GCKUICastButton?
    private let holder = UIView(frame: .zero)
    /// When the SDK was started, and whether a press is waiting: see `prompt`.
    private var started = Date.distantPast
    private var pressing = false
    /// When Google's note was agreed to, in this launch: see `didUpdateDeviceList`.
    private var agreed: Date?
    /// cast.stop came while the device was still fetching what it was
    /// handed: see `handle`.
    private var stopWhenLoaded = false
    /// Whether the SDK has begun to look for devices. Its own
    /// discoveryState still says "stopped" when it tells of the start.
    private var searching = false

    private var session = CastSession.disconnected
    private var device: String?
    /// The device's media client while its media is followed.
    private var client: GCKRemoteMediaClient?
    private var timer: Timer?
    /// Where the device had got to when last heard, for `disconnected`.
    private var position: TimeInterval?
    /// From a suspension until the device's picture is heard running
    /// again: see `CastMedia.signal(for:)`.
    private var unheard = false
    /// The question put to the device at a resumption: what has it on?
    private var asked: GCKRequestID?
    /// The answers owed to cast.load, by the SDK's request.
    private var loads: [GCKRequestID: ([String: Any]) -> Void] = [:]
    /// The count the page heard last: the SDK reports the list of devices
    /// far more often than the count moves.
    private var saidDevices = -1

    override init() {
        super.init()
        holder.isHidden = true
        if UserDefaults.standard.bool(forKey: Self.usedKey) { start() }
    }

    @discardableResult
    private func start() -> GCKCastContext {
        if let context { return context }
        // The SDK's log names what it loads. It is off altogether rather
        // than filtered: nothing reads it.
        let logger = GCKLogger.sharedInstance()
        logger.loggingEnabled = false
        logger.consoleLoggingEnabled = false
        logger.fileLoggingEnabled = false

        // The Default Media Receiver: nothing to register, and it plays
        // what a Chromecast's own player knows (HLS, MP4, WebM).
        let options = GCKCastOptions(discoveryCriteria: GCKDiscoveryCriteria(applicationID: kGCKDefaultMediaReceiverApplicationID))
        options.disableAnalyticsLogging = true
        options.stopReceiverApplicationWhenEndingSession = true
        // Nothing sounds here while casting, so the phone's buttons are the
        // television's volume.
        options.physicalVolumeButtonsWillControlDeviceVolume = true
        // Left at their defaults on purpose: suspendSessionsWhenBackgrounded
        // (the app holds no connection in the background; see
        // CastMedia.signal) and startDiscoveryAfterFirstTapOnCastButton
        // (the SDK's note comes before the system's question).
        GCKCastContext.setSharedInstanceWith(options)
        let context = GCKCastContext.sharedInstance()
        // The media in Google's session dialog opens Google's remote
        // control, as cast.controls does.
        context.useDefaultExpandedMediaControls = true
        context.sessionManager.add(self)
        context.discoveryManager.add(self)
        let button = GCKUICastButton(frame: .zero)
        holder.addSubview(button)
        self.button = button
        self.context = context
        started = Date()
        return context
    }

    #if DEBUG
    /// For `node ios/sim.mjs status`. No address, no title. `presented` is
    /// the class of what is shown over the player, Google's dialogs among
    /// them, so that a scenario can tell without reading a picture.
    var debugState: [String: Any] {
        // The topmost of the key window, as dialogs are presented
        // (LinkOpener.swift); the player itself is nothing presented.
        var top = Bridge.shared.presenter?.frontmost
        if top === Bridge.shared.presenter { top = nil }
        if let inner = (top as? UINavigationController)?.topViewController { top = inner }
        return [
            "sdk": kGCKFrameworkVersion,
            "started": context != nil,
            "state": session.rawValue,
            "devices": devices,
            "discovery": searching,
            "used": UserDefaults.standard.bool(forKey: Self.usedKey),
            "presented": top.map { String(describing: type(of: $0)) } ?? NSNull(),
            "following": client != nil,
            "loads": loads.count,
        ]
    }
    #endif

    // MARK: the page

    func handle(_ type: String, _ body: [String: Any], reply: @escaping ([String: Any]) -> Void) {
        switch type {
        case "cast.prompt":
            prompt()
        case "cast.load":
            load(body, reply: reply)
            return
        case "cast.stop":
            // The media stops, the session stays for the next thing chosen.
            // With nothing loaded there is nothing to ask of the device;
            // one still fetching what it was handed (the viewer left it
            // meanwhile) is stopped when it has taken the stream, or it
            // would go on to play it, on the account's one connection.
            if showing { _ = client?.stop() } else if !loads.isEmpty { stopWhenLoaded = true }
        case "cast.end":
            // False, and nothing more, without a session.
            _ = context?.sessionManager.endSessionAndStopCasting(true)
        case "cast.controls":
            if showing { context?.presentDefaultExpandedMediaControls() }
        default:
            reply(["ok": false, "error": "unknown"])
            return
        }
        reply([:])
    }

    /// A page connected or reloaded. During a session the media is said
    /// too: a page loaded again finds the device playing by it.
    func pageConnected() {
        sayState()
        if session == .connected { sayMedia() }
    }

    private var showing: Bool {
        guard let state = client?.mediaStatus?.playerState else { return false }
        return state != .idle && state != .unknown
    }

    private func prompt() {
        guard let view = Bridge.shared.presenter?.view else { return }
        start()
        if holder.superview !== view { view.addSubview(holder) }
        // Not within a second of the SDK's start. Its button asserts that
        // the SDK's database is ready, which takes a moment after the
        // context is made and has no public sign: pressed at once the app
        // ended with "Database is not ready" (measured; ready after 14 to
        // 55 ms in the simulator). The wait is felt once, at the first cast
        // ever; later the SDK has started with the app.
        //
        // The second is a guess, so the press itself is guarded: Google's
        // assertion is an Objective-C exception, raised before anything is
        // shown, which KepuliPress catches (Press.m; Swift cannot), and a
        // press that met it is made again half a second later, a few times.
        guard !pressing else { return }
        pressing = true
        press(after: max(0, 1 - Date().timeIntervalSince(started)), tries: 6)
    }

    private func press(after wait: TimeInterval, tries: Int) {
        DispatchQueue.main.asyncAfter(deadline: .now() + wait) { [weak self] in
            guard let self else { return }
            guard let button = self.button, !KepuliPress(button), tries > 1 else { self.pressing = false; return }
            debugLog("cast: the SDK was not ready for a press")
            self.press(after: 0.5, tries: tries - 1)
        }
    }

    /// The answer waits for the device: it fetches the stream before it
    /// accepts. The page takes no word about the media until then, so a
    /// refusal has to be this answer and nothing else.
    private func load(_ body: [String: Any], reply: @escaping ([String: Any]) -> Void) {
        guard session == .connected, let client = context?.sessionManager.currentCastSession?.remoteMediaClient else {
            reply(["ok": false, "error": "no-session"])
            return
        }
        guard let data = CastMedia.request(body) else {
            reply(["ok": false, "error": "refused"])
            return
        }
        // What the device had got to belongs to what it played before.
        position = nil
        stopWhenLoaded = false
        let request = client.loadMedia(with: data)
        request.delegate = self
        loads[request.requestID] = reply
    }

    private func answer(_ request: GCKRequest, _ fields: [String: Any]) -> Bool {
        guard let reply = loads.removeValue(forKey: request.requestID) else { return false }
        reply(fields)
        return true
    }

    func requestDidComplete(_ request: GCKRequest) {
        if request.requestID == asked {
            // Asked at the resumption, and the device has nothing on: what
            // it played came to its end, or was stopped, while the app
            // could not hear it.
            asked = nil
            if client?.mediaStatus == nil { sayMedia(gone: true) }
            return
        }
        // The page was deaf to the media while it waited: what the device
        // does now is said again after the answer.
        guard answer(request, [:]) else { return }
        if stopWhenLoaded, loads.isEmpty {
            stopWhenLoaded = false
            _ = client?.stop()
        }
        sayMedia()
    }

    func request(_ request: GCKRequest, didFailWithError error: GCKError) {
        // The question of a resumption went unanswered: nothing is known, nothing is said.
        if request.requestID == asked { asked = nil; return }
        debugLog("cast: the load failed, code \(error.code)")
        _ = answer(request, ["ok": false, "error": error.code == GCKErrorCode.timeout.rawValue ? "timeout" : "refused"])
    }

    /// Replaced by a newer load, or cancelled by a stop: the page has moved
    /// on and no longer waits for this one.
    func request(_ request: GCKRequest, didAbortWith abortReason: GCKRequestAbortReason) {
        _ = answer(request, ["ok": false, "error": "refused"])
    }

    // MARK: what the page is told

    /// The devices found, or -1 while nothing has looked for any.
    private var devices: Int {
        guard searching, let discovery = context?.discoveryManager else { return -1 }
        return Int(discovery.deviceCount)
    }

    private func sayState() {
        saidDevices = devices
        Bridge.shared.send("cast.state", CastMedia.state(session, device: device, devices: devices, position: position, stale: unheard))
    }

    private func sayMedia(gone: Bool = false) {
        let status = client?.mediaStatus
        notePosition()
        Bridge.shared.send("cast.media", CastMedia.media(status?.playerState ?? .unknown, reason: status?.idleReason ?? .none,
                                                         position: client?.approximateStreamPosition() ?? 0,
                                                         duration: status?.mediaInformation?.streamDuration, gone: gone))
    }

    /// Kept only from a picture that runs: a stream still loading reports
    /// zero, which would send a film handed over at its middle back to its
    /// beginning. A picture that runs is also the device heard again.
    private func notePosition() {
        guard let client, let state = client.mediaStatus?.playerState, [.playing, .paused, .buffering].contains(state) else { return }
        unheard = false
        let at = client.approximateStreamPosition()
        if at > 0 { position = at }
    }

    /// The device's media followed, or let go of with nil: its status
    /// changes, and where it has got to every 5 s while it plays.
    private func follow(_ next: GCKRemoteMediaClient?) {
        guard next !== client else { return }
        client?.remove(self)
        timer?.invalidate()
        client = next
        guard let next else { return }
        next.add(self)
        timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            if self?.client?.mediaStatus?.playerState == .playing { self?.sayMedia() }
        }
    }

    // MARK: the SDK

    private func apply(_ event: CastEvent, _ castSession: GCKCastSession) {
        debugLog("cast: \(event)")
        let signal = CastMedia.signal(for: event)
        // The last moment the device still answers.
        if event == .willEnd { notePosition() }
        if event == .didStart { position = nil }
        if let unheard = signal.unheard { self.unheard = unheard }
        if let follows = signal.follows { follow(follows ? castSession.remoteMediaClient : nil) }
        if let state = signal.state {
            session = state
            device = castSession.device.friendlyName
            sayState()
            if state == .disconnected {
                position = nil
                unheard = false
                asked = nil
                // Whatever load was still waiting has no device to answer it.
                for reply in loads.values { reply(["ok": false, "error": "no-session"]) }
                loads = [:]
            }
        }
        if signal.media { sayMedia() }
        if signal.asks, let request = client?.requestStatus() {
            request.delegate = self
            asked = request.requestID
        }
    }

    func sessionManager(_ sessionManager: GCKSessionManager, willStart session: GCKCastSession) { apply(.willStart, session) }
    func sessionManager(_ sessionManager: GCKSessionManager, didStart session: GCKCastSession) { apply(.didStart, session) }
    func sessionManager(_ sessionManager: GCKSessionManager, didSuspend session: GCKCastSession, with reason: GCKConnectionSuspendReason) { apply(.didSuspend, session) }
    func sessionManager(_ sessionManager: GCKSessionManager, didResumeCastSession session: GCKCastSession) { apply(.didResume, session) }
    func sessionManager(_ sessionManager: GCKSessionManager, willEnd session: GCKCastSession) { apply(.willEnd, session) }
    func sessionManager(_ sessionManager: GCKSessionManager, didEnd session: GCKCastSession, withError error: Error?) { apply(.didEnd, session) }
    func sessionManager(_ sessionManager: GCKSessionManager, didFailToStart session: GCKCastSession, withError error: Error) { apply(.didFailToStart, session) }

    func remoteMediaClient(_ client: GCKRemoteMediaClient, didUpdate mediaStatus: GCKMediaStatus?) {
        if client === self.client { sayMedia() }
    }

    func didStartDiscovery(forDeviceCategory deviceCategory: String) {
        searching = true
        // The viewer has been through the SDK's note; one who closed it
        // without agreeing has not, and the SDK stays asleep at the next
        // launch.
        if !UserDefaults.standard.bool(forKey: Self.usedKey) { agreed = Date() }
        UserDefaults.standard.set(true, forKey: Self.usedKey)
        if devices != saidDevices { sayState() }
    }

    /// The first cast ever ends at Google's note: after its OK the SDK
    /// shows nothing more, and the viewer who asked to cast was left at
    /// the player. So the first devices found soon after the note bring
    /// Google's list by themselves. They are found only once the system's
    /// question about the local network has been answered yes, which is
    /// why this waits for them and not for a time: a list opened at once
    /// would stand empty behind that question, or after a no.
    func didUpdateDeviceList() {
        if devices != saidDevices { sayState() }
        guard let agreed, devices > 0 else { return }
        self.agreed = nil
        let player = Bridge.shared.presenter
        if Date().timeIntervalSince(agreed) < 30, session == .disconnected, player?.frontmost === player { prompt() }
    }
}
