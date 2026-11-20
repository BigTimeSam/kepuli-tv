import AVFoundation
import AVKit
import UIKit

/// The app's own picture: AVPlayer under controls of the app's own, where
/// the page's <video> had WebKit's. Every control belongs to one layer that
/// shows at a touch and goes four seconds later, the time WebKit's took,
/// so nothing has to be laid over the picture from outside: full screen,
/// the Chromecast, AirPlay and picture in picture sit in the bars.
///
/// It draws and plays; what is played, and what follows from it, is
/// NativePlayer's and the page's.
final class NativePlayerView: UIView, AVPictureInPictureControllerDelegate {
    override class var layerClass: AnyClass { AVPlayerLayer.self }
    private var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }

    /// The full-screen and the Cast buttons were pressed.
    var onFull: (() -> Void)?
    var onCast: (() -> Void)?

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
    private let routeButton = AVRoutePickerView()
    private let waiting = UIActivityIndicatorView(style: .large)
    private let caption = PaddedLabel()
    private var captionLow: NSLayoutConstraint?
    private var captionHigh: NSLayoutConstraint?
    private var centre: UIView?

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .black
        clipsToBounds = true
        playerLayer.player = player
        playerLayer.videoGravity = .resizeAspect
        player.allowsExternalPlayback = true
        build()
        addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tapped)))
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
        for view in [tracksButton, pipButton, routeButton, castButton] as [UIView] { sized(view, 40) }
        let targets = glass([tracksButton, pipButton, routeButton, castButton])
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
    func show(title: String, subtitle: String, live: Bool, labels: [String: String]) {
        self.live = live
        self.labels = labels
        titleLabel.text = title
        subtitleLabel.text = subtitle
        for view in [elapsed, slider, remaining, backButton, forwardButton] as [UIView] { view.isHidden = live }
        liveBadge.isHidden = !live
        liveSpace.isHidden = !live
        liveBadge.text = labels["live"].map { "  ● \($0.uppercased())  " } ?? "  ●  "
        castButton.accessibilityLabel = labels["cast"]
        slider.value = 0
        elapsed.text = Self.clock(0)
        remaining.text = ""
        setFull(full)
        tick()
        show()
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

    /// The stream's own subtitles and sound tracks, as a menu on a button
    /// of the top bar; no button without anything to choose.
    func setTracks(_ menu: UIMenu?) {
        tracksButton.menu = menu
        tracksButton.isHidden = menu == nil
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

    /// The wheel over the picture while nothing moves yet.
    func setWaiting(_ on: Bool) {
        if on { waiting.startAnimating() } else { waiting.stopAnimating() }
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
        let paused = player.timeControlStatus == .paused
        symbol(playButton, paused ? "play.fill" : "pause.fill", size: 38, weight: .bold)
        playButton.accessibilityLabel = labels[paused ? "play" : "pause"]
        guard !live, !scrubbing, let item = player.currentItem else { return }
        let duration = item.duration.seconds, now = item.currentTime().seconds
        guard duration.isFinite, duration > 0 else { return }
        slider.value = Float(now / duration)
        elapsed.text = Self.clock(now)
        remaining.text = "-" + Self.clock(duration - now)
    }

    // MARK: The controls

    @objc private func togglePlay() {
        if player.timeControlStatus == .paused { player.play() } else { player.pause() }
        tick(); show()
    }
    @objc private func back() { skip(-10) }
    @objc private func forward() { skip(10) }
    private func skip(_ by: Double) {
        player.seek(to: CMTime(seconds: max(0, player.currentTime().seconds + by), preferredTimescale: 600))
        show()
    }
    @objc private func scrubStart() { scrubbing = true; hideTimer?.invalidate() }
    @objc private func scrubMove() {
        guard let duration = player.currentItem?.duration.seconds, duration.isFinite else { return }
        elapsed.text = Self.clock(Double(slider.value) * duration)
        remaining.text = "-" + Self.clock((1 - Double(slider.value)) * duration)
    }
    @objc private func scrubEnd() {
        if let duration = player.currentItem?.duration.seconds, duration.isFinite {
            player.seek(to: CMTime(seconds: Double(slider.value) * duration, preferredTimescale: 600))
        }
        scrubbing = false
        show()
    }
    @objc private func fullPressed() { onFull?(); show() }
    @objc private func castPressed() { onCast?(); show() }
    /// Out into picture in picture, or back: the button's, and the page's menu's.
    @objc func togglePip() {
        guard let pip else { return }
        if pip.isPictureInPictureActive { pip.stopPictureInPicture() } else { pip.startPictureInPicture() }
    }

    // MARK: Showing and hiding

    /// Whether the controls are in sight (the debug bridge's state).
    var controlsShown: Bool { controls.alpha > 0.5 }

    @objc private func tapped() {
        if controlsShown { hide() } else { show() }
    }

    func show() {
        UIView.animate(withDuration: 0.2) { self.controls.alpha = 1; self.placeCaption(high: true) }
        hideTimer?.invalidate()
        hideTimer = Timer.scheduledTimer(withTimeInterval: 4, repeats: false) { [weak self] _ in self?.hide() }
    }

    private func hide() {
        // A paused picture keeps its controls, as WebKit's did.
        guard player.timeControlStatus != .paused else { return }
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
