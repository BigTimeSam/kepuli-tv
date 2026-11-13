import GoogleCast
import XCTest
@testable import KepuliTV

/// The Cast sender's pure half (App/Cast/CastMedia.swift). No simulator
/// scenario can see it: there is no Chromecast to hand anything to.
final class CastTests: XCTestCase {
    private let film: [String: Any] = [
        "url": "http://example.org:8080/movie/demo/demo/5000.mp4", "contentType": "video/mp4", "live": false,
        "startAt": 754, "title": "The Long Winter", "subtitle": "Films", "image": "https://example.org/cover.jpg",
    ]
    private let channel: [String: Any] = [
        "url": "http://example.org:8080/live/demo/demo/1170.m3u8", "contentType": "application/x-mpegURL", "live": true,
        "hls": "ts", "startAt": 0, "title": "North One", "subtitle": "Canada",
    ]

    // MARK: cast.load to the SDK's media

    func testAFilmIsBufferedMovieMediaWithItsPicture() throws {
        let media = try XCTUnwrap(CastMedia.information(film))
        XCTAssertEqual(media.contentURL?.absoluteString, "http://example.org:8080/movie/demo/demo/5000.mp4")
        XCTAssertEqual(media.contentID, "http://example.org:8080/movie/demo/demo/5000.mp4")
        XCTAssertEqual(media.streamType, .buffered)
        XCTAssertEqual(media.contentType, "video/mp4")
        XCTAssertEqual(media.hlsSegmentFormat, .undefined)
        let metadata = try XCTUnwrap(media.metadata)
        XCTAssertEqual(metadata.metadataType, .movie)
        XCTAssertEqual(metadata.string(forKey: kGCKMetadataKeyTitle), "The Long Winter")
        XCTAssertEqual(metadata.string(forKey: kGCKMetadataKeySubtitle), "Films")
        XCTAssertEqual((metadata.images() as? [GCKImage])?.map(\.url.absoluteString), ["https://example.org/cover.jpg"])
    }

    func testAChannelIsLiveHlsWithMpegTsSegments() throws {
        let media = try XCTUnwrap(CastMedia.information(channel))
        XCTAssertEqual(media.streamType, .live)
        XCTAssertEqual(media.contentType, "application/x-mpegURL")
        XCTAssertEqual(media.hlsSegmentFormat, .TS)
        XCTAssertEqual(media.hlsVideoSegmentFormat, .MPEG2_TS)
        XCTAssertEqual(media.metadata?.metadataType, .generic)
        XCTAssertEqual(media.metadata?.images().count, 0)
    }

    func testFragmentedMp4SegmentsAreSaidForBothTracks() throws {
        var body = channel
        body["hls"] = "fmp4"
        let media = try XCTUnwrap(CastMedia.information(body))
        XCTAssertEqual(media.hlsSegmentFormat, .FMP4)
        XCTAssertEqual(media.hlsVideoSegmentFormat, .FMP4)
    }

    /// Google's controls fetch the picture in the app, where plain http is refused.
    func testAPictureOverPlainHttpIsLeftOut() throws {
        var body = film
        body["image"] = "http://example.org/cover.jpg"
        XCTAssertEqual(try XCTUnwrap(CastMedia.information(body)).metadata?.images().count, 0)
    }

    func testWhatHasNoAddressOrTypeIsNotMedia() {
        XCTAssertNil(CastMedia.information([:]))
        XCTAssertNil(CastMedia.information(["url": "blob:webkit-extension://kepuli-tv/1", "contentType": "video/mp4"]))
        XCTAssertNil(CastMedia.information(["url": "http://example.org/a.mp4"]))
        XCTAssertNil(CastMedia.request(["contentType": "video/mp4"]))
    }

    func testAFilmStartsWhereThePageSaysAndPlaysAtOnce() throws {
        let request = try XCTUnwrap(CastMedia.request(film))
        XCTAssertEqual(request.autoplay, true)
        XCTAssertEqual(request.startTime, 754)
        XCTAssertEqual(request.mediaInformation?.contentType, "video/mp4")
    }

    /// Zero for a live stream would ask for the playlist's oldest segment.
    func testAChannelAndAFilmFromItsStartKeepTheDefaultPosition() throws {
        XCTAssertFalse(try XCTUnwrap(CastMedia.request(channel)).startTime >= 0)
        var body = film
        body["startAt"] = 0
        XCTAssertFalse(try XCTUnwrap(CastMedia.request(body)).startTime >= 0)
        // A channel never starts at a position, whatever the page sends.
        body = channel
        body["startAt"] = 30
        XCTAssertFalse(try XCTUnwrap(CastMedia.request(body)).startTime >= 0)
    }

    // MARK: the session rule

    /// The phone asleep or the app in the background: the television plays
    /// on, and the page must not hear that the session is gone.
    func testASuspensionSaysNothingAndStopsFollowing() {
        XCTAssertEqual(CastMedia.signal(for: .didSuspend), CastSignal(state: nil, media: false, follows: false, unheard: true))
    }

    func testAResumptionSaysTheStateAndTheMediaAgainAndAsksTheDevice() {
        XCTAssertEqual(CastMedia.signal(for: .didResume), CastSignal(state: .connected, media: true, follows: true, unheard: nil, asks: true))
    }

    /// A film that ended, or a television turned off, while the phone
    /// slept: only a suspension makes the device unheard, only a new
    /// session (or its picture heard running, in CastService) ends that,
    /// and only a resumption asks the device what it has on.
    func testOnlyASuspensionLeavesTheDeviceUnheard() {
        XCTAssertEqual(CastEvent.allCases.filter { CastMedia.signal(for: $0).unheard == true }, [.didSuspend])
        XCTAssertEqual(CastEvent.allCases.filter { CastMedia.signal(for: $0).unheard == false }, [.didStart])
        XCTAssertEqual(CastEvent.allCases.filter { CastMedia.signal(for: $0).asks }, [.didResume])
    }

    /// The place kept is from before the sleep: the page must not play on from it.
    func testASessionEndedUnheardIsStaleAndCarriesNoPosition() {
        let message = CastMedia.state(.disconnected, device: "Living room", devices: 1, position: 1234.5, stale: true)
        XCTAssertEqual(message["stale"] as? Bool, true)
        XCTAssertNil(message["position"])
        XCTAssertNil(CastMedia.state(.disconnected, device: nil, devices: 1, position: 5)["stale"])
        XCTAssertNil(CastMedia.state(.connected, device: "Living room", devices: 1, position: 5, stale: true)["stale"])
    }

    /// No media at all is an end only when the device was asked after a
    /// suspension; at a session's start it is "nothing yet".
    func testADeviceWithNothingOnAfterASuspensionIsGone() {
        XCTAssertEqual(CastMedia.media(.unknown, reason: .none, position: 0, duration: nil, gone: true)["reason"] as? String, "gone")
        XCTAssertTrue(CastMedia.media(.unknown, reason: .none, position: 0, duration: nil)["reason"] is NSNull)
        XCTAssertTrue(CastMedia.media(.playing, reason: .none, position: 9, duration: 90, gone: true)["reason"] is NSNull)
        XCTAssertEqual(CastMedia.media(.idle, reason: .finished, position: 0, duration: nil, gone: true)["reason"] as? String, "finished")
    }

    func testOnlyAnEndOrAFailedStartSaysDisconnected() {
        let disconnecting = CastEvent.allCases.filter { CastMedia.signal(for: $0).state == .disconnected }
        XCTAssertEqual(disconnecting, [.didEnd, .didFailToStart])
        XCTAssertEqual(CastMedia.signal(for: .willStart), CastSignal(state: .connecting))
        XCTAssertEqual(CastMedia.signal(for: .didStart), CastSignal(state: .connected, media: false, follows: true, unheard: false))
    }

    /// The device's "stopped" as a session ends must not reach the page
    /// before `disconnected`, or the film would not play on here.
    func testAnEndingSessionIsNoLongerFollowed() {
        XCTAssertEqual(CastMedia.signal(for: .willEnd), CastSignal(state: nil, media: false, follows: false))
        XCTAssertEqual(CastMedia.signal(for: .didEnd).follows, false)
    }

    // MARK: what the page is told

    func testDisconnectedCarriesThePositionAndNoDevice() {
        let message = CastMedia.state(.disconnected, device: "Living room", devices: 2, position: 1234.5)
        XCTAssertEqual(message["state"] as? String, "disconnected")
        XCTAssertTrue(message["device"] is NSNull)
        XCTAssertEqual(message["devices"] as? Int, 2)
        XCTAssertEqual(message["position"] as? Double, 1234.5)
        XCTAssertNil(CastMedia.state(.disconnected, device: nil, devices: -1, position: nil)["position"])
        XCTAssertTrue(JSONSerialization.isValidJSONObject(message))
    }

    func testConnectedCarriesTheDeviceAndNoPosition() {
        let message = CastMedia.state(.connected, device: "Living room", devices: 1, position: 99)
        XCTAssertEqual(message["state"] as? String, "connected")
        XCTAssertEqual(message["device"] as? String, "Living room")
        XCTAssertNil(message["position"])
        XCTAssertTrue(CastMedia.state(.connecting, device: nil, devices: 1, position: nil)["device"] is NSNull)
    }

    func testThePlayersStatesAndWhyItIsIdle() {
        let states: [(GCKMediaPlayerState, String)] = [
            (.loading, "loading"), (.buffering, "buffering"), (.playing, "playing"), (.paused, "paused"), (.idle, "idle"), (.unknown, "idle"),
        ]
        for (state, name) in states {
            XCTAssertEqual(CastMedia.media(state, reason: .none, position: 1, duration: 2)["state"] as? String, name)
        }
        let reasons: [(GCKMediaPlayerIdleReason, String?)] = [
            (.finished, "finished"), (.cancelled, "stopped"), (.interrupted, "interrupted"), (.error, "error"), (.none, nil),
        ]
        for (reason, name) in reasons {
            XCTAssertEqual(CastMedia.media(.idle, reason: reason, position: 0, duration: nil)["reason"] as? String, name)
        }
        // A reason belongs to idle alone: the SDK keeps the last one while the next thing plays.
        XCTAssertTrue(CastMedia.media(.playing, reason: .finished, position: 3, duration: 10)["reason"] is NSNull)
    }

    /// A live stream has no length; the SDK says infinity or NaN, and JSON takes neither.
    func testPositionAndDurationAreNumbersJsonCanCarry() {
        let film = CastMedia.media(.playing, reason: .none, position: 61.5, duration: 5400)
        XCTAssertEqual(film["position"] as? Double, 61.5)
        XCTAssertEqual(film["duration"] as? Double, 5400)
        for length in [TimeInterval.infinity, .nan, 0, kGCKInvalidTimeInterval] {
            let live = CastMedia.media(.playing, reason: .none, position: .nan, duration: length)
            XCTAssertTrue(live["duration"] is NSNull)
            XCTAssertEqual(live["position"] as? Double, 0)
            XCTAssertTrue(JSONSerialization.isValidJSONObject(live))
        }
    }

    /// Google's button raises an Objective-C exception while the SDK's
    /// database is not ready, which ended the app: the press answers no
    /// instead, and CastService presses again.
    @MainActor
    func testAPressThatRaisesIsCaught() {
        final class Target: NSObject {
            var pressed = 0
            @objc func press() { pressed += 1 }
            @objc func refuse() { NSException(name: .internalInconsistencyException, reason: "Database is not ready.", userInfo: nil).raise() }
        }
        let target = Target(), ready = UIControl(), refusing = UIControl()
        ready.addTarget(target, action: #selector(Target.press), for: .touchUpInside)
        refusing.addTarget(target, action: #selector(Target.refuse), for: .touchUpInside)
        XCTAssertTrue(KepuliPress(ready))
        XCTAssertEqual(target.pressed, 1)
        XCTAssertFalse(KepuliPress(refusing))
    }
}
