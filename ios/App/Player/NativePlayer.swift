import AVFoundation
import MediaPlayer
import UIKit

/// The app's own player behind the page's player.* messages
/// (js/nativeplayer.js): what AVPlayer plays by itself, HLS and the MP4
/// family, is shown in a view of the app's (NativePlayerView) in the
/// place of the page's picture, and the page plays the rest as before.
///
/// The page stays the one that knows what plays. It sends
/// player.load {id, url, live, startAt, title, subtitle, labels,
/// subtitleLang, audioLang},
/// player.frame {x, y, width, height, holes} (the picture's box in the
/// page, in the document's points: the view lies in the web view's scroll
/// view, so it moves with the page; and what of the page lies over the
/// box, each {x, y, width, height, radius} within it, cut out of the view), player.stop, player.play, player.pause and
/// player.seek {to}.
/// The app says player.state {id, state, reason?, position, duration,
/// width, height}:
/// loading, playing, paused, or idle with why (finished, error); at every
/// change, and every two seconds while the picture runs; and
/// player.track {id, kind, language?} when the viewer chose subtitles or
/// a sound track from the stream's own, for the page to keep the language;
/// and player.command {id, what, to?} for the lock screen's next and previous.
///
/// What the page plays itself has the same controls over it: the page
/// sends player.load {id, page: true, live, title, subtitle, labels} with
/// no address, and player.page {id, state, position, duration?} as its own
/// picture goes; the controls' presses come back as player.command
/// {id, what: play | pause | seek | pip, to?}. Nothing plays here then, and
/// the lock screen is WebKit's, as it was.
///
/// Two pictures side by side (js/secondui.js) are two of these: every
/// message names its `slot`, 1 the picture and 2 the second beside it
/// (none said is 1). Sound comes from one at a time, at the page's word:
/// player.sound {slot, on, offered} says whether a slot is heard and
/// whether it shows its speaker, and a press of the speaker, of the
/// second's swap or of its close comes back as player.command
/// {slot, what: sound | swap | close}. The lock screen, picture in
/// picture, AirPlay, the Cast mark and the tracks are the first slot's.
///
/// As with the cast session, nothing here logs an address or a title.
final class NativePlayer: NSObject, NativeService {
    let prefix = "player."

    private let slots = [1: PlayerSlot(number: 1), 2: PlayerSlot(number: 2)]

    /// What the debug bridge says of the player (ios/sim.mjs status): the
    /// first picture's state, and the second's under `second`.
    var debugState: [String: Any] {
        var state = slots[1]?.debugState ?? ["on": false]
        state["second"] = slots[2]?.debugState ?? ["on": false]
        return state
    }

    func handle(_ type: String, _ body: [String: Any], reply: @escaping ([String: Any]) -> Void) {
        guard let slot = slots[(body["slot"] as? NSNumber)?.intValue ?? 1] else { reply(["ok": false, "error": "bad-request"]); return }
        slot.handle(type, body, reply: reply)
    }

    /// A page that has just loaded plays nothing, whatever the one before
    /// it had on; nor does one whose process ended.
    func pageConnected() { for slot in slots.values { slot.stop() } }
    func pageGone() { for slot in slots.values { slot.stop() } }

    /// A dialog of the page is open, with this backdrop (Screen).
    func setShade(_ rgba: [Double]?, open: Bool) { for slot in slots.values { slot.setShade(rgba, open: open) } }
}

/// One picture of the app's own, and what the page says to it.
final class PlayerSlot: NSObject, AVPlayerItemLegibleOutputPushDelegate {
    /// 1 the picture, 2 the second beside it.
    let number: Int
    init(number: Int) { self.number = number }

    /// To the page, with the slot it is from.
    private func send(_ type: String, _ body: [String: Any]) {
        var word = body
        word["slot"] = number
        Bridge.shared.send(type, word)
    }

    private var view: NativePlayerView?
    /// The page's number for what plays, said back with every state.
    private var id: NSNumber?
    private var live = false
    /// The picture is the page's own, and only the controls are here.
    private var page = false
    private var observations: [NSKeyValueObservation] = []
    private var ended: [NSObjectProtocol] = []
    private var beat: Timer?
    private var said = ""

    private var host: PlayerViewController? { Bridge.shared.presenter as? PlayerViewController }

    /// What the debug bridge says of the player (ios/sim.mjs status).
    var debugState: [String: Any] {
        guard let view, id != nil else { return ["on": false] }
        let chosen = view.player.currentItem?.currentMediaSelection
        let subtitle = legible.flatMap { chosen?.selectedMediaOption(in: $0) }.map(Self.language) ?? "off"
        let sound = audible.flatMap { chosen?.selectedMediaOption(in: $0) }.map(Self.language) ?? "none"
        return ["on": true, "page": page, "state": state, "subtitle": subtitle, "audio": sound,
                "subtitles": legible.map { texts($0).count } ?? 0, "audios": audible?.options.count ?? 0, "live": live, "hidden": view.isHidden, "controls": view.controlsShown,
                "position": position, "frame": [view.frame.minX, view.frame.minY, view.frame.width, view.frame.height]]
    }

    func handle(_ type: String, _ body: [String: Any], reply: @escaping ([String: Any]) -> Void) {
        switch type {
        case "player.load":
            let own = body["page"] as? Bool ?? false
            guard let id = body["id"] as? NSNumber, let url = own ? URL(string: "about:blank") : (body["url"] as? String).flatMap(URL.init(string:)) else {
                reply(["ok": false, "error": "bad-request"]); return
            }
            load(own ? nil : url, id: id, body)
        case "player.page":
            if page, let said = body["id"] as? NSNumber, said == id {
                view?.setPage(paused: body["state"] as? String == "paused", position: (body["position"] as? NSNumber)?.doubleValue ?? 0,
                              duration: (body["duration"] as? NSNumber)?.doubleValue)
            }
        case "player.frame": place(body)
        case "player.sound":
            heard = body["on"] as? Bool ?? true
            speaker = body["offered"] as? Bool ?? false
            view?.setSound(on: heard, offered: speaker)
        case "player.stop": stop()
        // At the page's word the controls show, as at a touch: what was
        // paused from elsewhere says so.
        case "player.play": view?.player.play(); view?.show()
        case "player.pause": view?.player.pause(); view?.show()
        case "player.pip": view?.togglePip()
        case "player.seek":
            if let to = (body["to"] as? NSNumber)?.doubleValue, !live {
                view?.player.seek(to: CMTime(seconds: max(0, to), preferredTimescale: 600))
                view?.show()
            }
        default: reply(["ok": false, "error": "unknown"]); return
        }
        reply([:])
    }

    /// `url` is nil for what the page plays itself: the controls alone.
    private func load(_ url: URL?, id: NSNumber, _ body: [String: Any]) {
        guard let webView = host?.host.webView else { return }
        let view = self.view ?? NativePlayerView()
        if self.view == nil {
            view.isHidden = true
            view.onFull = { [weak self] in
                guard let host = self?.host else { return }
                host.setFull(!host.full)
            }
            // The same as the page's own Cast button: Google's dialogs.
            view.onCast = { Services.cast.handle("cast.prompt", [:]) { _ in } }
            // The speaker, and the second picture's swap and close: the
            // page's to do, as it knows both pictures.
            view.onSide = { [weak self] what in
                guard let self, let id = self.id else { return }
                self.send("player.command", ["id": id, "what": what])
            }
            view.setSecond(number == 2)
            webView.scrollView.addSubview(view)
            view.setShade(shade.0, open: shade.1)
            self.view = view
        }
        unwatch()
        self.id = id
        live = body["live"] as? Bool ?? false
        said = ""
        page = url == nil
        view.show(title: body["title"] as? String ?? "", subtitle: body["subtitle"] as? String ?? "", live: live,
                  labels: body["labels"] as? [String: String] ?? [:], page: page)
        view.setFull(host?.full ?? false)
        view.setSound(on: heard, offered: speaker)
        guard let url else {
            // The page's picture: nothing of AVPlayer's stays on, and the
            // system's commands are WebKit's again.
            view.player.replaceCurrentItem(with: nil)
            view.setCaption("")
            view.setTracks(nil)
            view.setWaiting(false)
            dropCommands()
            view.onPage = { [weak self] what, to in
                var word: [String: Any] = ["id": id, "what": what]
                if let to { word["to"] = to }
                self?.send("player.command", word)
            }
            return
        }
        view.setWaiting(true)

        // The sound plays with the ring switch off and goes on behind
        // another app, as a film's does; WebKit ran a session of its own
        // for the page's picture (ios/MEASURED.md), this picture needs the
        // app's.
        try? AVAudioSession.sharedInstance().setActive(true)
        let item = AVPlayerItem(url: url)
        // The subtitles come here as text and the view draws them
        // (NativePlayerView.setCaption): AVPlayer's own are at the
        // picture's foot, under the bottom bar while the controls show.
        let texts = AVPlayerItemLegibleOutput()
        texts.suppressesPlayerRendering = true
        texts.setDelegate(self, queue: .main)
        item.add(texts)
        view.setCaption("")
        let player = view.player
        player.replaceCurrentItem(with: item)
        if let startAt = body["startAt"] as? Double, startAt > 0, !live {
            player.seek(to: CMTime(seconds: startAt, preferredTimescale: 600))
        }
        observations = [
            item.observe(\.status) { [weak self] item, _ in
                DispatchQueue.main.async { if item.status == .failed { self?.finish("error") } else { self?.say() } }
            },
            player.observe(\.timeControlStatus) { [weak self] _, _ in
                DispatchQueue.main.async { self?.say() }
            },
        ]
        let centre = NotificationCenter.default
        ended = [
            centre.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification, object: item, queue: .main) { [weak self] _ in self?.finish("finished") },
            centre.addObserver(forName: AVPlayerItem.failedToPlayToEndTimeNotification, object: item, queue: .main) { [weak self] _ in self?.finish("error") },
        ]
        title = body["title"] as? String ?? ""
        subtitle = body["subtitle"] as? String ?? ""
        takeCommands()
        labels = body["labels"] as? [String: String] ?? [:]
        view.setTracks(nil)
        findTracks(item, id: id, subtitles: body["subtitleLang"] as? String ?? "off", audio: body["audioLang"] as? String ?? "auto")
        beat = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in self?.say(again: true) }
        player.play()
        say()
    }

    func legibleOutput(_ output: AVPlayerItemLegibleOutput, didOutputAttributedStrings strings: [NSAttributedString],
                       nativeSampleBuffers: [Any], forItemTime itemTime: CMTime) {
        guard view?.player.currentItem?.outputs.contains(output) == true else { return }
        view?.setCaption(strings.map(\.string).joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines))
    }

    private var labels: [String: String] = [:]
    private var legible: AVMediaSelectionGroup?
    private var audible: AVMediaSelectionGroup?

    /// The two-letter or three-letter code of a track's language, as the page keeps it.
    private static func language(_ option: AVMediaSelectionOption) -> String {
        option.locale?.language.languageCode?.identifier ?? option.extendedLanguageTag ?? "und"
    }

    /// The tracks the stream itself brings (an HLS playlist's renditions,
    /// an MP4's tracks), once it has been read: the languages the page
    /// kept are chosen, subtitles off without one, and the menu is made.
    private func findTracks(_ item: AVPlayerItem, id: NSNumber, subtitles: String, audio: String) {
        legible = nil
        audible = nil
        Task { @MainActor [weak self] in
            let shown = try? await item.asset.loadMediaSelectionGroup(for: .legible)
            let heard = try? await item.asset.loadMediaSelectionGroup(for: .audible)
            guard let self, self.id == id else { return }
            // The system would otherwise pick subtitles by its own settings.
            self.view?.player.appliesMediaSelectionCriteriaAutomatically = false
            if let shown {
                let wanted = self.texts(shown).first { Self.language($0).hasPrefix(subtitles) || subtitles.hasPrefix(Self.language($0)) }
                item.select(subtitles == "off" ? nil : wanted, in: shown)
            }
            if let heard, audio != "auto", let wanted = heard.options.first(where: { Self.language($0).hasPrefix(audio) || audio.hasPrefix(Self.language($0)) }) {
                item.select(wanted, in: heard)
            }
            self.legible = shown
            self.audible = heard
            self.showTracks()
        }
    }

    /// The subtitles a viewer can choose: not the forced ones, which the player shows by itself.
    private func texts(_ group: AVMediaSelectionGroup) -> [AVMediaSelectionOption] {
        AVMediaSelectionGroup.playableMediaSelectionOptions(from: group.options).filter { !$0.hasMediaCharacteristic(.containsOnlyForcedSubtitles) }
    }

    /// The menu as it stands now; made again after every choice, as a menu's marks do not change by themselves.
    private func showTracks() {
        guard let view, let item = view.player.currentItem else { return }
        let chosen = item.currentMediaSelection
        var sections: [UIMenu] = []
        if let legible, !texts(legible).isEmpty {
            let now = chosen.selectedMediaOption(in: legible)
            let off = UIAction(title: labels["off"] ?? "", state: now == nil ? .on : .off) { [weak self] _ in self?.choose(nil, in: legible, kind: "subtitle") }
            let options = texts(legible).map { option in
                UIAction(title: option.displayName, state: option == now ? .on : .off) { [weak self] _ in self?.choose(option, in: legible, kind: "subtitle") }
            }
            sections.append(UIMenu(title: labels["subtitles"] ?? "", options: .displayInline, children: [off] + options))
        }
        if let audible, audible.options.count > 1 {
            let now = chosen.selectedMediaOption(in: audible)
            let options = audible.options.map { option in
                UIAction(title: option.displayName, state: option == now ? .on : .off) { [weak self] _ in self?.choose(option, in: audible, kind: "audio") }
            }
            sections.append(UIMenu(title: labels["audio"] ?? "", options: .displayInline, children: options))
        }
        view.setTracks(sections.isEmpty ? nil : UIMenu(children: sections))
    }

    /// The viewer's choice: shown or heard at once, and said to the page, which keeps the language.
    private func choose(_ option: AVMediaSelectionOption?, in group: AVMediaSelectionGroup, kind: String) {
        guard let id, let item = view?.player.currentItem else { return }
        item.select(option, in: group)
        if kind == "subtitle" { view?.setCaption("") }
        showTracks()
        var body: [String: Any] = ["id": id, "kind": kind]
        if let option { body["language"] = Self.language(option) }
        send("player.track", body)
    }

    /// The picture's box in the page. Nothing of it in sight (another pane
    /// of the page shows, or the box has no size yet) hides the view; the
    /// sound goes on, as the page's own picture's did.
    private func place(_ body: [String: Any]) {
        guard let view else { return }
        let number = { (key: String) in CGFloat((body[key] as? NSNumber)?.doubleValue ?? 0) }
        let box = CGRect(x: number("x"), y: number("y"), width: number("width"), height: number("height"))
        // On whole pixels: the page's box may end between two (376.875
        // points high was measured), and the row the view half covered
        // showed as a hairline across a dialog cut out of it.
        let scale = view.window?.screen.scale ?? 2
        let whole = { (edge: CGFloat) in (edge * scale).rounded() / scale }
        view.frame = CGRect(x: whole(box.minX), y: whole(box.minY), width: whole(box.maxX) - whole(box.minX), height: whole(box.maxY) - whole(box.minY))
        view.setHoles((body["holes"] as? [[String: Any]] ?? []).map { hole in
            let number = { (key: String) in CGFloat((hole[key] as? NSNumber)?.doubleValue ?? 0) }
            return (CGRect(x: number("x"), y: number("y"), width: number("width"), height: number("height")), number("radius"))
        })
        view.isHidden = id == nil || box.width < 1 || box.height < 1
        view.setFull(host?.full ?? false)
    }

    /// A dialog of the page is open, with this backdrop (Screen): the
    /// picture is dimmed as the page around it is, and a touch on it is
    /// the page's, where it closes the dialog.
    func setShade(_ rgba: [Double]?, open: Bool) {
        view?.setShade(open ? rgba : nil, open: open)
        shade = (open ? rgba : nil, open)
    }

    private var shade: ([Double]?, Bool) = (nil, false)
    /// Whether this slot is the one heard, and whether it shows its speaker (player.sound).
    private lazy var heard = number == 1
    private var speaker = false

    private var position: Double {
        let seconds = view?.player.currentTime().seconds ?? 0
        return seconds.isFinite ? seconds : 0
    }

    private var state: String {
        guard let player = view?.player, let item = player.currentItem, item.status == .readyToPlay else { return "loading" }
        switch player.timeControlStatus {
        case .playing: return "playing"
        case .paused: return "paused"
        default: return "loading"
        }
    }

    /// Where the picture stands, for the page: at a change, and `again`
    /// with the beat while it runs.
    private func say(again: Bool = false) {
        guard let id, let view, !page else { return }
        let now = state
        guard now != said || (again && now == "playing") else { return }
        said = now
        view.setWaiting(now == "loading")
        // The screen stays on while the picture runs (KeepAwake does this
        // for the page's own picture, at the page's word).
        if number == 1 { UIApplication.shared.isIdleTimerDisabled = now != "paused" }
        var body: [String: Any] = ["id": id, "state": now, "position": position]
        if let duration = view.player.currentItem?.duration.seconds, duration.isFinite, duration > 0 { body["duration"] = duration }
        // The picture's shape, for the box the page gives it.
        if let size = view.player.currentItem?.presentationSize, size.width > 0, size.height > 0 {
            body["width"] = size.width
            body["height"] = size.height
        }
        send("player.state", body)
        sayNowPlaying()
    }

    /// The picture came to its end or could not be played: the page is
    /// told, with where it had got to, and nothing is on any more.
    private func finish(_ reason: String) {
        guard let id else { return }
        let at = position
        debugLog("player: \(reason)")
        stop()
        send("player.state", ["id": id, "state": "idle", "reason": reason, "position": at])
    }

    // MARK: The lock screen and Control Centre

    private var title = ""
    private var subtitle = ""
    private var commands: [(MPRemoteCommand, Any)] = []

    /// What plays, for the system's own controls. WebKit published this
    /// from the page's Media Session for the page's picture
    /// (ios/MEASURED.md); this picture is not WebKit's.
    private func sayNowPlaying() {
        guard number == 1, id != nil, let player = view?.player else { return }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: title, MPMediaItemPropertyArtist: subtitle, MPMediaItemPropertyAlbumTitle: "Kepuli-TV",
            MPNowPlayingInfoPropertyIsLiveStream: live,
            MPNowPlayingInfoPropertyPlaybackRate: player.timeControlStatus == .paused ? 0.0 : 1.0,
        ]
        if !live {
            info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = position
            if let duration = player.currentItem?.duration.seconds, duration.isFinite, duration > 0 { info[MPMediaItemPropertyPlaybackDuration] = duration }
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    /// The system's commands for this picture: play and pause here, a
    /// place on the time line of a film, and next and previous, which are
    /// the page's to answer (it knows the list).
    private func takeCommands() {
        guard number == 1, commands.isEmpty else { return }
        let centre = MPRemoteCommandCenter.shared()
        let add = { [weak self] (command: MPRemoteCommand, act: @escaping (PlayerSlot, MPRemoteCommandEvent) -> Void) in
            command.isEnabled = true
            let token = command.addTarget { [weak self] event in
                guard let self, self.id != nil else { return .noActionableNowPlayingItem }
                act(self, event)
                return .success
            }
            self?.commands.append((command, token))
        }
        add(centre.playCommand) { player, _ in player.view?.player.play() }
        add(centre.pauseCommand) { player, _ in player.view?.player.pause() }
        add(centre.togglePlayPauseCommand) { player, _ in
            guard let now = player.view?.player else { return }
            if now.timeControlStatus == .paused { now.play() } else { now.pause() }
        }
        add(centre.changePlaybackPositionCommand) { player, event in
            guard !player.live, let to = (event as? MPChangePlaybackPositionCommandEvent)?.positionTime else { return }
            player.view?.player.seek(to: CMTime(seconds: to, preferredTimescale: 600))
        }
        add(centre.nextTrackCommand) { player, _ in player.send("player.command", ["id": player.id ?? 0, "what": "next"]) }
        add(centre.previousTrackCommand) { player, _ in player.send("player.command", ["id": player.id ?? 0, "what": "previous"]) }
    }

    private func dropCommands() {
        // The system's commands and what it shows as playing are the first picture's.
        guard number == 1 else { return }
        for (command, token) in commands { command.removeTarget(token) }
        commands = []
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }

    private func unwatch() {
        observations = []
        for observer in ended { NotificationCenter.default.removeObserver(observer) }
        ended = []
        beat?.invalidate()
        beat = nil
    }

    func stop() {
        unwatch()
        guard id != nil else { return }
        id = nil
        view?.player.replaceCurrentItem(with: nil)
        view?.setCaption("")
        view?.setWaiting(false)
        view?.isHidden = true
        dropCommands()
        // The page's own picture keeps the screen on at the page's word (KeepAwake).
        if !page, number == 1 { UIApplication.shared.isIdleTimerDisabled = false }
        page = false
    }
}
