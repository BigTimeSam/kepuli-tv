/// The one list of what answers the page. A new service is created here
/// and nowhere else; the bridge routes by each one's prefix.
enum Services {
    static let keepAwake = KeepAwake()
    static let cast = CastService()
    static let reminders = Reminders()
    static let screen = Screen()
    static let player = NativePlayer()

    static func start() {
        let all: [NativeService] = [keepAwake, cast, reminders, screen, player]
        for service in all { Bridge.shared.register(service) }
    }
}
