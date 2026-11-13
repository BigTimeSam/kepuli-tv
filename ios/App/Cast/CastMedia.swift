import Foundation
import GoogleCast

/// The session as the page is told it (`cast.state`). There is no
/// "suspended": see `CastMedia.signal(for:)`.
enum CastSession: String {
    case disconnected, connecting, connected
}

/// The session manager's callbacks that mean something to the page.
enum CastEvent: CaseIterable {
    case willStart, didStart, didSuspend, didResume, willEnd, didEnd, didFailToStart
}

/// What one of them makes the app do.
struct CastSignal: Equatable {
    /// What `cast.state` says from here on; nil when the page is told nothing.
    var state: CastSession?
    /// `cast.media` is said again as well.
    var media = false
    /// Whether the device's media is followed from here on (its status
    /// changes and the 5 s position); nil leaves it as it was.
    var follows: Bool?
    /// The device is out of hearing from here on (true), or a session
    /// begins that has been heard throughout (false); nil leaves it.
    var unheard: Bool?
    /// The device is asked what it has on, as nothing was heard meanwhile.
    var asks = false
}

/// The pure half of the Cast sender: the page's words into Google's
/// objects and Google's callbacks into the page's words. Nothing here
/// touches a session, so ios/Tests/CastTests.swift covers all of it.
///
/// The address, the title and the picture's address go into Google's
/// objects and nowhere else: they are never logged, in any build (the
/// address carries the account's user name and password).
enum CastMedia {
    /// What a session callback sends.
    ///
    /// A suspended session is not a disconnected one. Every cast ends with
    /// the phone asleep or the app in the background, and the SDK then
    /// suspends the session while the television plays on. Were the page
    /// told `disconnected` it would start the stream here on return, taking
    /// the account's one connection from the television, and hand over a
    /// second time at the `connected` that follows. So a suspension says
    /// nothing, a resumption says the state and the media again (the page
    /// acts on changes and takes it as a refresh), and only an end or a
    /// failed start says `disconnected`.
    ///
    /// What the device did during a suspension nobody heard: a film may
    /// have come to its end, or the television been turned off, with the
    /// phone asleep. So from a suspension the device counts as unheard
    /// until its picture is heard running again (`CastService`), and a
    /// resumption asks the device what it has on. A session that ends
    /// unheard says `disconnected` as `stale`, without the place from
    /// before the sleep, and a device that answers the question with no
    /// media at all is said as `gone`: the page starts nothing on either
    /// (js/castui.js), where it used to keep "Playing on …" over an idle
    /// device or begin the film here from where the phone fell asleep.
    ///
    /// From `willEnd` on the media is no longer followed: the device's
    /// "stopped" as it lets go is the end's doing, and the page, hearing it
    /// before `disconnected`, would take the film as stopped at the device
    /// and not play on here.
    static func signal(for event: CastEvent) -> CastSignal {
        switch event {
        case .willStart: return CastSignal(state: .connecting)
        case .didStart: return CastSignal(state: .connected, follows: true, unheard: false)
        case .didSuspend: return CastSignal(follows: false, unheard: true)
        case .didResume: return CastSignal(state: .connected, media: true, follows: true, asks: true)
        case .willEnd: return CastSignal(follows: false)
        case .didEnd, .didFailToStart: return CastSignal(state: .disconnected, follows: false)
        }
    }

    /// `cast.state`. `devices` is -1 while nothing has looked for devices.
    /// `position` goes with `disconnected` alone: where the device had got
    /// to, for the page to play on from. A session that ended with the
    /// device unheard is `stale` instead: the place kept is from before.
    static func state(_ session: CastSession, device: String?, devices: Int, position: TimeInterval?, stale: Bool = false) -> [String: Any] {
        var message: [String: Any] = ["state": session.rawValue, "device": NSNull(), "devices": devices]
        if session != .disconnected, let device { message["device"] = device }
        if session == .disconnected, stale { message["stale"] = true }
        else if session == .disconnected, let position, position.isFinite { message["position"] = position }
        return message
    }

    /// `cast.media`, from the device's player state. A live stream's
    /// duration is not a number (the SDK says infinity, or its "invalid"
    /// NaN), which JSON cannot carry: the page gets null. `gone`: the device
    /// was asked after a suspension and has no media at all, which is the
    /// one case where "unknown" is an end and not a beginning.
    static func media(_ state: GCKMediaPlayerState, reason: GCKMediaPlayerIdleReason,
                      position: TimeInterval, duration: TimeInterval?, gone: Bool = false) -> [String: Any] {
        let name: String
        switch state {
        case .loading: name = "loading"
        case .buffering: name = "buffering"
        case .playing: name = "playing"
        case .paused: name = "paused"
        default: name = "idle"   // idle, and unknown: no media session yet
        }
        var why: Any = NSNull()
        if name == "idle" {
            switch reason {
            case .finished: why = "finished"
            case .cancelled: why = "stopped"
            case .interrupted: why = "interrupted"
            case .error: why = "error"
            default: if gone, state == .unknown { why = "gone" }
            }
        }
        var length: Any = NSNull()
        if let duration, duration.isFinite, duration > 0 { length = duration }
        let at: TimeInterval = position.isFinite ? position : 0
        return ["state": name, "reason": why, "position": at, "duration": length]
    }

    /// `cast.load` as the media the device is handed, or nil when it has no
    /// address or type to hand over.
    static func information(_ body: [String: Any]) -> GCKMediaInformation? {
        guard let text = body["url"] as? String, let url = URL(string: text),
              let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let type = body["contentType"] as? String, !type.isEmpty else { return nil }
        let live = body["live"] as? Bool ?? false
        let builder = GCKMediaInformationBuilder(contentURL: url)
        // Receivers older than the content URL read the address from here.
        builder.contentID = url.absoluteString
        builder.streamType = live ? .live : .buffered
        builder.contentType = type
        // Without these the device's player guesses an HLS stream's
        // segments, and guesses wrong for a provider's MPEG-TS ones.
        switch body["hls"] as? String {
        case "ts":
            builder.hlsSegmentFormat = .TS
            builder.hlsVideoSegmentFormat = .MPEG2_TS
        case "fmp4":
            builder.hlsSegmentFormat = .FMP4
            builder.hlsVideoSegmentFormat = .FMP4
        default: break
        }
        // A film or an episode is a "movie" to the device's own display and
        // to Google's controls (a seek bar, a duration); a channel is not.
        let metadata = GCKMediaMetadata(metadataType: live ? .generic : .movie)
        if let title = body["title"] as? String, !title.isEmpty { metadata.setString(title, forKey: kGCKMetadataKeyTitle) }
        if let subtitle = body["subtitle"] as? String, !subtitle.isEmpty { metadata.setString(subtitle, forKey: kGCKMetadataKeySubtitle) }
        // Google's controls fetch the picture in the app, where App
        // Transport Security refuses plain http (only the web view is
        // exempt), so the page sends an https one or none; held to here too.
        if let image = (body["image"] as? String).flatMap(URL.init(string:)), image.scheme?.lowercased() == "https" {
            metadata.addImage(GCKImage(url: image, width: 0, height: 0))
        }
        builder.metadata = metadata
        return builder.build()
    }

    /// `cast.load` as the request: the media, played at once. A film starts
    /// where the page says. A channel, and a film from its beginning, keep
    /// the SDK's "default position": zero for a live stream would ask the
    /// device for the oldest segment of the playlist instead of the newest.
    static func request(_ body: [String: Any]) -> GCKMediaLoadRequestData? {
        guard let information = information(body) else { return nil }
        let builder = GCKMediaLoadRequestDataBuilder()
        builder.mediaInformation = information
        builder.autoplay = true
        if information.streamType == .buffered, let start = (body["startAt"] as? NSNumber)?.doubleValue, start.isFinite, start > 0 {
            builder.startTime = start
        }
        return builder.build()
    }
}
