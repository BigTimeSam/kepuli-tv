import AVFoundation
import AVKit
import UIKit

/// The app's own picture: AVPlayer under controls of the app's own, where
/// the page's <video> had WebKit's. Every control belongs to one layer that
/// shows at a touch and goes four seconds later, the time WebKit's took,
/// so nothing has to be laid over the picture from outside: full screen,
/// the Chromecast, AirPlay and picture in picture sit in the bars.
///
/// The same controls lie over what the page plays in its own <video>
/// (Matroska, MPEG-TS without an HLS address, a recording, the archive):
/// then nothing is drawn here but the controls, the page's picture shows
/// through, and the controls' presses are words to the page (`onPage`),
/// which says where its picture is (`setPage`). One player to the viewer,
/// whichever of the two plays.
///
/// It draws and plays; what is played, and what follows from it, is
/// NativePlayer's and the page's.
final class NativePlayerView: UIView, AVPictureInPictureControllerDelegate, UIGestureRecognizerDelegate {
    /// AVPlayer's picture, in a view of its own under the controls. It was
    /// this view's own layer at first, and on an iPad the controls then
    /// lay under a film's picture: AVPlayerLayer adds the picture as a
    /// sublayer of itself when the item is ready, after the controls'
    /// layers and so above them. The simulator did not show it.
    private final class Picture: UIView {
        override class var layerClass: AnyClass { AVPlayerLayer.self }
    }
    private let picture = Picture()
    private var playerLayer: AVPlayerLayer { picture.layer as! AVPlayerLayer }

    /// The full-screen and the Cast buttons were pressed.
    var onFull: (() -> Void)?
    var onCast: (() -> Void)?
    /// The speaker, or the second picture's swap or close, was pressed: "sound", "swap", "close".
    var onSide: ((String) -> Void)?
    /// A press meant for the page's own picture: play, pause, pip, or
    /// seek with the second to go to.
    var onPage: ((String, Double?) -> Void)?
    /// Whether the picture under the controls is the page's, and where the page says it is.
    private var page = false
    private var pagePaused = false
    private var pageNow = 0.0
    private var pageDuration: Double?

    let player = AVPlayer()
    private var pip: AVPictureInPictureController?
    private var ticking: Any?
    private var hideTimer: Timer?
    private var live = false
    private var scrubbing = false

    private let controls = UIView()
    private let shade = CAGradientLayer()
    private let titleLabel = UILabel()
    private let subtitleLabel = UILabel()
    private let playButton = UIButton(type: .system)
    private let backButton = UIButton(type: .system)
    private let forwardButton = UIButton(type: .system)
    private let slider = UISlider()
    private let elapsed = UILabel()
    private let remaining = UILabel()
    private let liveBadge = UILabel()
    private let liveSpace = UIView()
    private let fullButton = UIButton(type: .system)
    private let tracksButton = UIButton(type: .system)
    private let pipButton = UIButton(type: .system)
    private let castButton = UIButton(type: .system)
    private let soundButton = UIButton(type: .system)
    private let swapButton = UIButton(type: .system)
    private let closeButton = UIButton(type: .system)
    /// The second of two pictures side by side: its bar has the speaker, the swap and the close, and nothing that is the first picture's alone.
    private var second = false
    private let routeButton = AVRoutePickerView()
    private let waiting = UIActivityIndicatorView(style: .large)
    private let caption = PaddedLabel()
    private var captionLow: NSLayoutConstraint?
    private var captionHigh: NSLayoutConstraint?
    private var centre: UIView?
    private var targets: UIView?

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .black
        clipsToBounds = true
        picture.frame = bounds
        picture.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        picture.isUserInteractionEnabled = false
        addSubview(picture)
        playerLayer.player = player
        playerLayer.videoGravity = .resizeAspect
        player.allowsExternalPlayback = true
        build()
        // As on the page's own picture: a tap shows or hides the
        // controls, a double tap is full screen and back, and a swipe
        // down leaves full screen. The tap waits for the double tap to
        // fail, a third of a second, as the page's click does.
        let tap = UITapGestureRecognizer(target: self, action: #selector(tapped))
        let double = UITapGestureRecognizer(target: self, action: #selector(doubleTapped))
        double.numberOfTapsRequired = 2
        tap.require(toFail: double)
        let swipe = UISwipeGestureRecognizer(target: self, action: #selector(swipedDown))
        swipe.direction = .down
        for gesture in [tap, double, swipe] as [UIGestureRecognizer] {
            gesture.delegate = self
            addGestureRecognizer(gesture)
        }
        ticking = player.addPeriodicTimeObserver(forInterval: CMTime(value: 1, timescale: 2), queue: .main) { [weak self] _ in
            self?.tick()
        }
        if AVPictureInPictureController.isPictureInPictureSupported() {
            pip = AVPictureInPictureController(playerLayer: playerLayer)
            pip?.delegate = self
        } else {
            pipButton.isHidden = true
        }
    }

    required init?(coder: NSCoder) { fatalError("made in code") }

    deinit {
        if let ticking { player.removeTimeObserver(ticking) }
    }

    // MARK: Layout

    private func symbol(_ button: UIButton, _ name: String, size: CGFloat = 20, weight: UIImage.SymbolWeight = .semibold) {
        button.setImage(UIImage(systemName: name, withConfiguration: UIImage.SymbolConfiguration(pointSize: size, weight: weight)), for: .normal)
        button.tintColor = .white
    }

    /// A capsule of glass around a row of controls, as iOS 26 groups them.
    private func glass(_ views: [UIView], spacing: CGFloat = 6, inset: CGFloat = 6) -> UIView {
        let stack = UIStackView(arrangedSubviews: views)
        stack.spacing = spacing
        stack.alignment = .center
        stack.translatesAutoresizingMaskIntoConstraints = false
        let effect = UIGlassEffect()
        effect.isInteractive = true
        let box = UIVisualEffectView(effect: effect)
        box.cornerConfiguration = .capsule()
        box.contentView.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: box.contentView.topAnchor, constant: inset),
            stack.bottomAnchor.constraint(equalTo: box.contentView.bottomAnchor, constant: -inset),
            stack.leadingAnchor.constraint(equalTo: box.contentView.leadingAnchor, constant: inset + 4),
            stack.trailingAnchor.constraint(equalTo: box.contentView.trailingAnchor, constant: -inset - 4),
        ])
        return box
    }

    private func sized(_ view: UIView, _ side: CGFloat) {
        view.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([view.widthAnchor.constraint(equalToConstant: side),
                                     view.heightAnchor.constraint(equalToConstant: side)])
    }

    /// Google's Cast mark, drawn: the SDK that brings its own button is not
    /// started before the viewer's first cast (CastService), and there is
    /// no system symbol for it.
    static func castMark(side: CGFloat = 24) -> UIImage {
        UIGraphicsImageRenderer(size: CGSize(width: side, height: side)).image { _ in
            let unit = side / 24
            let line = UIBezierPath()
            line.lineWidth = 2 * unit
            line.lineCapStyle = .round
            line.lineJoinStyle = .round
            // The screen, open at its lower left corner where the waves are.
            line.move(to: CGPoint(x: 2 * unit, y: 8 * unit))
            line.addLine(to: CGPoint(x: 2 * unit, y: 6 * unit))
            line.addQuadCurve(to: CGPoint(x: 4 * unit, y: 4 * unit), controlPoint: CGPoint(x: 2 * unit, y: 4 * unit))
            line.addLine(to: CGPoint(x: 20 * unit, y: 4 * unit))
            line.addQuadCurve(to: CGPoint(x: 22 * unit, y: 6 * unit), controlPoint: CGPoint(x: 22 * unit, y: 4 * unit))
            line.addLine(to: CGPoint(x: 22 * unit, y: 18 * unit))
            line.addQuadCurve(to: CGPoint(x: 20 * unit, y: 20 * unit), controlPoint: CGPoint(x: 22 * unit, y: 20 * unit))
            line.addLine(to: CGPoint(x: 14 * unit, y: 20 * unit))
            let corner = CGPoint(x: 2 * unit, y: 20 * unit)
            for radius in [4, 8] as [CGFloat] {
                line.move(to: CGPoint(x: corner.x, y: corner.y - radius * unit))
                line.addArc(withCenter: corner, radius: radius * unit, startAngle: -.pi / 2, endAngle: 0, clockwise: true)
            }
            UIColor.black.setStroke()
            line.stroke()
            UIBezierPath(ovalIn: CGRect(x: 1 * unit, y: 19 * unit, width: 2 * unit, height: 2 * unit)).fill()
        }.withRenderingMode(.alwaysTemplate)
    }

    private func build() {
        controls.translatesAutoresizingMaskIntoConstraints = false
        addSubview(controls)
        NSLayoutConstraint.activate([
            controls.topAnchor.constraint(equalTo: topAnchor), controls.bottomAnchor.constraint(equalTo: bottomAnchor),
            controls.leadingAnchor.constraint(equalTo: leadingAnchor), controls.trailingAnchor.constraint(equalTo: trailingAnchor),
        ])
        shade.colors = [UIColor.black.withAlphaComponent(0.6).cgColor, UIColor.clear.cgColor,
                        UIColor.clear.cgColor, UIColor.black.withAlphaComponent(0.7).cgColor]
        shade.locations = [0, 0.3, 0.65, 1]
        controls.layer.addSublayer(shade)

        waiting.color = .white
        waiting.hidesWhenStopped = true
        waiting.translatesAutoresizingMaskIntoConstraints = false
        addSubview(waiting)

        // Top left: what plays.
        titleLabel.font = .systemFont(ofSize: 19, weight: .semibold)
        titleLabel.textColor = .white
        subtitleLabel.font = .systemFont(ofSize: 14, weight: .regular)
        subtitleLabel.textColor = UIColor.white.withAlphaComponent(0.75)
        let titles = UIStackView(arrangedSubviews: [titleLabel, subtitleLabel])
        titles.axis = .vertical
        titles.spacing = 2
        titles.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

        // Top right: where the picture goes.
        symbol(tracksButton, "captions.bubble")
        tracksButton.showsMenuAsPrimaryAction = true
        tracksButton.isHidden = true
        symbol(pipButton, "pip.enter")
        pipButton.addTarget(self, action: #selector(togglePip), for: .touchUpInside)
        routeButton.tintColor = .white
        routeButton.activeTintColor = .systemBlue
        routeButton.prioritizesVideoDevices = true
        castButton.setImage(Self.castMark(), for: .normal)
        castButton.tintColor = .white
        castButton.addTarget(self, action: #selector(castPressed), for: .touchUpInside)
        // Beside a second picture: which of the two is heard, and on the
        // second the two things done to it.
        symbol(soundButton, "speaker.slash.fill", size: 17)
        soundButton.addTarget(self, action: #selector(soundPressed), for: .touchUpInside)
        soundButton.isHidden = true
        symbol(swapButton, "arrow.left.arrow.right", size: 17)
        swapButton.addTarget(self, action: #selector(swapPressed), for: .touchUpInside)
        swapButton.isHidden = true
        symbol(closeButton, "xmark", size: 17)
        closeButton.addTarget(self, action: #selector(closePressed), for: .touchUpInside)
        closeButton.isHidden = true
        for view in [soundButton, swapButton, closeButton, tracksButton, pipButton, routeButton, castButton] as [UIView] { sized(view, 40) }
        let targets = glass([soundButton, tracksButton, pipButton, routeButton, castButton, swapButton, closeButton])
        self.targets = targets
        targets.setContentCompressionResistancePriority(.required, for: .horizontal)

        let top = UIStackView(arrangedSubviews: [titles, UIView(), targets])
        top.alignment = .center
        top.spacing = 12

        // Centre: the transport.
        symbol(backButton, "gobackward.10", size: 26, weight: .medium)
        symbol(playButton, "pause.fill", size: 38, weight: .bold)
        symbol(forwardButton, "goforward.10", size: 26, weight: .medium)
        backButton.addTarget(self, action: #selector(back), for: .touchUpInside)
        playButton.addTarget(self, action: #selector(togglePlay), for: .touchUpInside)
        forwardButton.addTarget(self, action: #selector(forward), for: .touchUpInside)
        sized(backButton, 56); sized(playButton, 76); sized(forwardButton, 56)
        let centre = glass([backButton, playButton, forwardButton], spacing: 18, inset: 4)
        self.centre = centre

        // Bottom: the time line, or that the channel is live, and full screen.
        for label in [elapsed, remaining] {
            label.font = .monospacedDigitSystemFont(ofSize: 13, weight: .medium)
            label.textColor = .white
        }
        slider.minimumTrackTintColor = .white
        slider.maximumTrackTintColor = UIColor.white.withAlphaComponent(0.3)
        slider.addTarget(self, action: #selector(scrubStart), for: .touchDown)
        slider.addTarget(self, action: #selector(scrubEnd), for: [.touchUpInside, .touchUpOutside, .touchCancel])
        slider.addTarget(self, action: #selector(scrubMove), for: .valueChanged)
        liveBadge.font = .systemFont(ofSize: 12, weight: .bold)
        liveBadge.textColor = .white
        liveBadge.backgroundColor = .systemRed
        liveBadge.layer.cornerRadius = 6
        liveBadge.layer.masksToBounds = true
        liveBadge.setContentHuggingPriority(.required, for: .horizontal)
        fullButton.addTarget(self, action: #selector(fullPressed), for: .touchUpInside)
        sized(fullButton, 40)
        setFull(false)
        let line = glass([liveBadge, liveSpace, elapsed, slider, remaining, fullButton], spacing: 10, inset: 4)

        for view in [top, centre, line] as [UIView] {
            view.translatesAutoresizingMaskIntoConstraints = false
            controls.addSubview(view)
        }
        // The subtitle's line, drawn here and not by AVPlayer, which
        // draws it at the picture's foot, under the bottom bar: it sits
        // above the bar while the controls show and at the foot otherwise.
        caption.numberOfLines = 0
        caption.textAlignment = .center
        caption.textColor = .white
        caption.backgroundColor = UIColor.black.withAlphaComponent(0.6)
        caption.layer.cornerRadius = 6
        caption.layer.masksToBounds = true
        caption.isHidden = true
        caption.translatesAutoresizingMaskIntoConstraints = false
        insertSubview(caption, belowSubview: controls)
        captionLow = caption.bottomAnchor.constraint(equalTo: safeAreaLayoutGuide.bottomAnchor, constant: -12)
        captionHigh = caption.bottomAnchor.constraint(equalTo: line.topAnchor, constant: -8)
        NSLayoutConstraint.activate([
            caption.centerXAnchor.constraint(equalTo: centerXAnchor),
            caption.widthAnchor.constraint(lessThanOrEqualTo: widthAnchor, multiplier: 0.86),
            captionHigh!,
        ])
        dim.isHidden = true
        dim.isUserInteractionEnabled = false
        dim.frame = bounds
        dim.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        addSubview(dim)
        let safe = safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            waiting.centerXAnchor.constraint(equalTo: centerXAnchor),
            waiting.centerYAnchor.constraint(equalTo: centerYAnchor),
            top.topAnchor.constraint(equalTo: safe.topAnchor, constant: 12),
            top.leadingAnchor.constraint(equalTo: safe.leadingAnchor, constant: 16),
            top.trailingAnchor.constraint(equalTo: safe.trailingAnchor, constant: -16),
            centre.centerXAnchor.constraint(equalTo: centerXAnchor),
            centre.centerYAnchor.constraint(equalTo: centerYAnchor),
            line.leadingAnchor.constraint(equalTo: safe.leadingAnchor, constant: 16),
            line.trailingAnchor.constraint(equalTo: safe.trailingAnchor, constant: -16),
            line.bottomAnchor.constraint(equalTo: safe.bottomAnchor, constant: -12),
        ])
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        shade.frame = bounds
        CATransaction.commit()
        cut()
        // A phone's upright picture is some 226 points high: the
        // transport at its full size covered half of it.
        let small = bounds.height < 280
        centre?.transform = small ? CGAffineTransform(scaleX: 0.72, y: 0.72) : .identity
        caption.font = .systemFont(ofSize: max(13, min(22, bounds.height / 22)), weight: .semibold)
    }

    // MARK: Under the page's menus and dialogs

    private var holes: [(CGRect, CGFloat)] = []
    private let dim = UIView()

    /// What of the page lies over the picture (js/nativeplayer.js): cut
    /// out of the view, so that the page under it shows there, and a
    /// touch there is the page's (`hitTest`).
    func setHoles(_ holes: [(CGRect, CGFloat)]) {
        self.holes = holes.filter { $0.0.intersects(bounds) }
        cut()
    }

    private func cut() {
        guard !holes.isEmpty else { layer.mask = nil; return }
        let path = UIBezierPath(rect: bounds)
        // A point more on every side than the page said: its box may end between two pixels.
        for (box, radius) in holes { path.append(UIBezierPath(roundedRect: box.insetBy(dx: -0.5, dy: -0.5), cornerRadius: radius)) }
        let mask = CAShapeLayer()
        mask.fillRule = .evenOdd
        mask.path = path.cgPath
        layer.mask = mask
    }

    /// The backdrop of the page's open dialog, laid over the picture as
    /// it lies over the page; nothing of the view takes a touch then.
    func setShade(_ rgba: [Double]?, open: Bool) {
        isUserInteractionEnabled = !open
        dim.isHidden = !open
        if let rgba, rgba.count == 4 {
            dim.backgroundColor = UIColor(red: rgba[0] / 255, green: rgba[1] / 255, blue: rgba[2] / 255, alpha: rgba[3])
        }
    }

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        if holes.contains(where: { $0.0.contains(point) }) { return nil }
        return super.hitTest(point, with: event)
    }

    // MARK: What plays

    /// The page's words for what plays and for the controls, in the
    /// viewer's language: `labels` has full, leave, cast, play, pause, subtitles, off, audio and live.
    func show(title: String, subtitle: String, live: Bool, labels: [String: String], page: Bool = false) {
        self.page = page
        pagePaused = false
        pageNow = 0
        pageDuration = nil
        // The page's picture shows through; AirPlay is AVPlayer's alone,
        // and the page's tracks are chosen in the page.
        backgroundColor = page ? .clear : .black
        picture.isHidden = page
        routeButton.isHidden = page || second
        pipButton.isHidden = second || pip == nil
        self.labels = labels
        titleLabel.text = title
        subtitleLabel.text = subtitle
        liveBadge.text = labels["live"].map { "  ● \($0.uppercased())  " } ?? "  ●  "
        setLive(live)
        castButton.accessibilityLabel = labels["cast"]
        slider.value = 0
        elapsed.text = Self.clock(0)
        remaining.text = ""
        setFull(full)
        tick()
        show()
    }

    /// A time line, or the mark of a live channel in its place.
    private func setLive(_ live: Bool) {
        self.live = live
        for view in [elapsed, slider, remaining, backButton, forwardButton] as [UIView] { view.isHidden = live }
        liveBadge.isHidden = !live
        liveSpace.isHidden = !live
    }

    /// Where the page's own picture is: the controls follow it as they
    /// follow AVPlayer. A picture with no length is live, whatever it was
    /// started as (a recording in the making, a channel's archive).
    func setPage(paused: Bool, position: Double, duration: Double?) {
        guard page else { return }
        let was = pagePaused
        pagePaused = paused
        pageNow = position
        pageDuration = duration
        if live != (duration == nil) { setLive(duration == nil) }
        tick()
        // Paused from elsewhere (the page's key, the lock screen): the controls say so.
        if paused != was { show() }
    }

    private var isPaused: Bool { page ? pagePaused : player.timeControlStatus == .paused }
    private var nowSeconds: Double { page ? pageNow : player.currentTime().seconds }
    private var lengthSeconds: Double? {
        let length = page ? pageDuration : player.currentItem?.duration.seconds
        guard let length, length.isFinite, length > 0 else { return nil }
        return length
    }
    private func seek(to seconds: Double) {
        if page { pageNow = seconds; onPage?("seek", seconds) } else { player.seek(to: CMTime(seconds: seconds, preferredTimescale: 600)) }
    }

    private var labels: [String: String] = [:]
    private var full = false

    func setFull(_ on: Bool) {
        full = on
        symbol(fullButton, on ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right", size: 17)
        fullButton.accessibilityLabel = labels[on ? "leave" : "full"]
        // The page says what plays above its picture; over the whole
        // screen nothing else does.
        titleLabel.isHidden = !on
        subtitleLabel.isHidden = !on
    }

    /// The second of two pictures: no picture in picture, AirPlay, Cast or
    /// tracks, which are the first picture's, and a swap and a close of
    /// its own. Its name shows over it always, as nothing else says which
    /// channel the half is.
    func setSecond(_ on: Bool) {
        second = on
        swapButton.isHidden = !on
        closeButton.isHidden = !on
        castButton.isHidden = on
        if on { pipButton.isHidden = true; routeButton.isHidden = true; tracksButton.isHidden = true }
    }

    /// Whether this picture is the one heard, and whether it shows its
    /// speaker at all (only beside another picture).
    func setSound(on: Bool, offered: Bool) {
        player.isMuted = !on
        soundButton.isHidden = !offered
        symbol(soundButton, on ? "speaker.wave.2.fill" : "speaker.slash.fill", size: 17)
        // A bar with nothing in it is not drawn.
        targets?.isHidden = [soundButton, tracksButton, pipButton, routeButton, castButton, swapButton, closeButton].allSatisfy(\.isHidden)
    }

    /// The stream's own subtitles and sound tracks, as a menu on a button
    /// of the top bar; no button without anything to choose.
    func setTracks(_ menu: UIMenu?) {
        tracksButton.menu = menu
        tracksButton.isHidden = menu == nil || page || second
        tracksButton.accessibilityLabel = labels["subtitles"]
    }

    /// The subtitle to show now, or nothing (NativePlayer hears them from the stream).
    func setCaption(_ text: String) {
        caption.text = text
        caption.isHidden = text.isEmpty
    }

    private func placeCaption(high: Bool) {
        guard captionHigh?.isActive != high else { return }
        captionLow?.isActive = !high
        captionHigh?.isActive = high
        layoutIfNeeded()
    }

    /// The wheel over the picture while nothing moves yet. It stands where
    /// the transport does, and the two drawn over each other were a muddle
    /// of marks on a phone: the transport is away while the wheel turns.
    func setWaiting(_ on: Bool) {
        if on { waiting.startAnimating() } else { waiting.stopAnimating() }
        centre?.isHidden = on
    }

    /// The Cast mark in the accent's colour while a session is on.
    func setCasting(_ on: Bool) {
        castButton.tintColor = on ? .systemBlue : .white
    }

    static func clock(_ seconds: Double) -> String {
        guard seconds.isFinite else { return "0:00" }
        let s = Int(max(0, seconds))
        return s >= 3600 ? String(format: "%d:%02d:%02d", s / 3600, s / 60 % 60, s % 60) : String(format: "%d:%02d", s / 60, s % 60)
    }

    private func tick() {
        let paused = isPaused
        symbol(playButton, paused ? "play.fill" : "pause.fill", size: 38, weight: .bold)
        playButton.accessibilityLabel = labels[paused ? "play" : "pause"]
        guard !live, !scrubbing, let duration = lengthSeconds else { return }
        let now = nowSeconds
        slider.value = Float(now / duration)
        elapsed.text = Self.clock(now)
        remaining.text = "-" + Self.clock(duration - now)
    }

    // MARK: The controls

    @objc private func togglePlay() {
        if page {
            // Shown at once; the page's word follows and settles it.
            onPage?(pagePaused ? "play" : "pause", nil)
            pagePaused.toggle()
        } else if player.timeControlStatus == .paused { player.play() } else { player.pause() }
        tick(); show()
    }
    @objc private func back() { skip(-10) }
    @objc private func forward() { skip(10) }
    private func skip(_ by: Double) {
        seek(to: max(0, min(nowSeconds + by, lengthSeconds ?? .greatestFiniteMagnitude)))
        show()
    }
    @objc private func scrubStart() { scrubbing = true; hideTimer?.invalidate() }
    @objc private func scrubMove() {
        guard let duration = lengthSeconds else { return }
        elapsed.text = Self.clock(Double(slider.value) * duration)
        remaining.text = "-" + Self.clock((1 - Double(slider.value)) * duration)
    }
    @objc private func scrubEnd() {
        if let duration = lengthSeconds { seek(to: Double(slider.value) * duration) }
        scrubbing = false
        show()
    }
    @objc private func fullPressed() { onFull?(); show() }
    @objc private func soundPressed() { onSide?("sound"); show() }
    @objc private func swapPressed() { onSide?("swap"); show() }
    @objc private func closePressed() { onSide?("close") }
    @objc private func castPressed() { onCast?(); show() }
    /// Out into picture in picture, or back: the button's, and the page's menu's.
    @objc func togglePip() {
        if page { onPage?("pip", nil); return }
        guard let pip else { return }
        if pip.isPictureInPictureActive { pip.stopPictureInPicture() } else { pip.startPictureInPicture() }
    }

    // MARK: Showing and hiding

    /// Whether the controls are in sight (the debug bridge's state).
    var controlsShown: Bool { controls.alpha > 0.5 }

    @objc private func doubleTapped() { onFull?() }
    @objc private func swipedDown() { if full { onFull?() } }

    /// Not on a control: a button's own press, and the time line under a finger, are theirs.
    func gestureRecognizer(_ gesture: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        var view = touch.view
        while let now = view, now !== self {
            if now is UIControl { return false }
            view = now.superview
        }
        return true
    }

    @objc private func tapped() {
        if controlsShown { hide(asked: true) } else { show() }
    }

    func show() {
        UIView.animate(withDuration: 0.2) { self.controls.alpha = 1; self.placeCaption(high: true) }
        hideTimer?.invalidate()
        hideTimer = Timer.scheduledTimer(withTimeInterval: 4, repeats: false) { [weak self] _ in self?.hide() }
    }

    private func hide(asked: Bool = false) {
        // A paused picture keeps its controls when their time is up, as
        // WebKit's did; a tap on the picture still puts them away, to
        // look at the still picture without them.
        guard asked || !isPaused else { return }
        UIView.animate(withDuration: 0.3) { self.controls.alpha = 0; self.placeCaption(high: false) }
    }
}

/// A label with room around its words, for the subtitle's dark ground.
final class PaddedLabel: UILabel {
    private let room = UIEdgeInsets(top: 3, left: 9, bottom: 3, right: 9)

    override func drawText(in rect: CGRect) { super.drawText(in: rect.inset(by: room)) }

    override var intrinsicContentSize: CGSize {
        let size = super.intrinsicContentSize
        return CGSize(width: size.width + room.left + room.right, height: size.height + room.top + room.bottom)
    }

    override func textRect(forBounds bounds: CGRect, limitedToNumberOfLines lines: Int) -> CGRect {
        let inner = super.textRect(forBounds: bounds.inset(by: room), limitedToNumberOfLines: lines)
        return CGRect(x: inner.minX - room.left, y: inner.minY - room.top, width: inner.width + room.left + room.right, height: inner.height + room.top + room.bottom)
    }
}
