import UIKit
import WebKit

/// A line in the debug log (`node ios/sim.mjs log`). Nothing in Release.
/// Never pass a message body, an address or a title: they carry the
/// account's credentials.
@inline(__always)
func debugLog(_ text: @autoclosure () -> String) {
    #if DEBUG
    DebugBridge.shared.log(text())
    #endif
}

#if DEBUG
/// How ios/sim.mjs drives the app in a simulator, in Debug builds only:
/// files in Library/Caches/kepuli-debug/ of the app's data container.
/// `cmd/<n>.js` is the body of an async function run in the page,
/// `cmd/<n>.native` a command for this file (state, reload, width,
/// killweb, tap-reminder); the answer is written to `out/<n>.json`. The page's console, its errors and debugLog's lines go
/// to `page.log`, begun anew at every launch.
///
/// None of this is in a Release build: `strings` on its binary finds
/// neither "kepuli-debug" nor "_killWebContentProcess".
final class DebugBridge: NSObject, WKScriptMessageHandler {
    static let shared = DebugBridge()

    private let directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("kepuli-debug")
    private var logFile: FileHandle?
    private weak var player: PlayerViewController?
    private var timer: Timer?

    // console.* and what the page never caught, posted from every frame at
    // document start.
    private static let consoleHook = """
    (() => {
      const text = (a) => { try { return typeof a === 'string' ? a : (a instanceof Error ? (a.stack || String(a)) : JSON.stringify(a)); } catch { return String(a); } };
      const post = (level, args) => { try { webkit.messageHandlers.kepuliDebug.postMessage({ level, text: args.map(text).join(' ') }); } catch {} };
      for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
        const original = console[level];
        console[level] = (...args) => { post(level, args); original.apply(console, args); };
      }
      addEventListener('error', (e) => {
        if (e.target && e.target !== window && e.target.tagName) post('resource-error', [e.target.tagName]);
        else post('uncaught', [e.message, `${e.filename}:${e.lineno}`, (e.error && e.error.stack) || '']);
      }, true);
      addEventListener('unhandledrejection', (e) => post('unhandledrejection', [(e.reason && (e.reason.stack || e.reason.message)) || String(e.reason)]));
    })();
    """

    private override init() {
        super.init()
        let files = FileManager.default
        // Commands and answers of an earlier launch mean nothing now.
        for name in ["cmd", "out"] {
            try? files.removeItem(at: directory.appendingPathComponent(name))
            try? files.createDirectory(at: directory.appendingPathComponent(name), withIntermediateDirectories: true)
        }
        let log = directory.appendingPathComponent("page.log")
        files.createFile(atPath: log.path, contents: nil)
        logFile = try? FileHandle(forWritingTo: log)
        self.log("launch iOS \(UIDevice.current.systemVersion) \(UIDevice.current.model)")
    }

    /// Before the controller is made: the hook must be in the base configuration.
    func prepare(_ configuration: WKWebViewConfiguration) {
        configuration.userContentController.addUserScript(WKUserScript(source: Self.consoleHook, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        configuration.userContentController.add(self, name: "kepuliDebug")
    }

    func start(player: PlayerViewController) {
        self.player = player
        timer = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] _ in self?.poll() }
    }

    func log(_ text: String) {
        logFile?.write(Data("\(ISO8601DateFormatter().string(from: Date())) \(text)\n".utf8))
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }
        log("console.\(body["level"] ?? "?") \(body["text"] ?? "")")
    }

    // MARK: commands

    private func poll() {
        let commands = directory.appendingPathComponent("cmd")
        guard let files = try? FileManager.default.contentsOfDirectory(at: commands, includingPropertiesForKeys: nil) else { return }
        for file in files.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) where ["js", "native"].contains(file.pathExtension) {
            guard let body = try? String(contentsOf: file, encoding: .utf8) else { continue }
            try? FileManager.default.removeItem(at: file)
            let name = file.deletingPathExtension().lastPathComponent
            if file.pathExtension == "js" {
                evaluate(body, name: name)
            } else {
                answer(name, native(body.trimmingCharacters(in: .whitespacesAndNewlines)))
            }
        }
    }

    private func answer(_ name: String, _ value: Any) {
        let data = (try? JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys, .fragmentsAllowed])) ?? Data("{\"error\":\"unserialisable\"}".utf8)
        try? data.write(to: directory.appendingPathComponent("out/\(name).json"), options: .atomic)
    }

    private func evaluate(_ body: String, name: String) {
        guard let webView = player?.host.webView else { answer(name, ["error": "no web view"]); return }
        // The answer crosses as JSON text: callAsyncJavaScript's own
        // conversion drops what it cannot represent without saying so.
        let wrapped = "const __r = await (async () => { \(body)\n })(); return JSON.stringify(__r === undefined ? null : __r);"
        webView.callAsyncJavaScript(wrapped, arguments: [:], in: nil, in: .page) { [weak self] result in
            switch result {
            case .success(let value):
                let text = value as? String ?? "null"
                let parsed = (try? JSONSerialization.jsonObject(with: Data(text.utf8), options: [.fragmentsAllowed])) ?? text
                self?.answer(name, ["ok": parsed])
            case .failure(let error):
                let info = (error as NSError).userInfo
                self?.answer(name, ["error": error.localizedDescription,
                                    "message": String(describing: info["WKJavaScriptExceptionMessage"] ?? ""),
                                    "line": String(describing: info["WKJavaScriptExceptionLineNumber"] ?? "")])
            }
        }
    }

    private func native(_ command: String) -> Any {
        let parts = command.split(separator: " ", maxSplits: 1).map(String.init)
        let argument = parts.count > 1 ? parts[1] : ""
        switch parts.first ?? "" {
        case "state":
            return state()
        case "reload":
            player?.host.webView?.reload()
        case "width":
            player?.debugWidth(argument == "full" ? nil : Double(argument).map { CGFloat($0) })
            return state()
        case "killweb":
            // There is no public way to end the web content process; this
            // private selector is in the iOS 18.5 and 26.5 WebKit.
            player?.host.webView?.perform(NSSelectorFromString("_killWebContentProcess"))
        case "tap-reminder":
            Services.reminders.debugTap(argument)
        default:
            return ["error": "unknown command \(command)"]
        }
        return ["ok": true]
    }

    private func state() -> [String: Any] {
        var state = player?.host.state() ?? [:]
        state["failure"] = player?.failure ?? NSNull()
        state["idleTimerDisabled"] = UIApplication.shared.isIdleTimerDisabled
        state["dialog"] = player?.dialogOpen ?? false
        if let webView = player?.host.webView {
            // The app's own full screen; `webkitFullscreen` is WebKit's for
            // an element, which must never be anything but "no".
            state["fullscreen"] = player?.full == true ? "yes" : "no"
            state["webkitFullscreen"] = ["no", "entering", "yes", "leaving"][webView.fullscreenState.rawValue]
            state["statusBarHidden"] = player?.view.window?.windowScene?.statusBarManager?.isStatusBarHidden ?? false
            state["webView"] = ["width": webView.bounds.width, "height": webView.bounds.height]
        }
        if let view = player?.view {
            state["view"] = ["width": view.bounds.width, "height": view.bounds.height]
            let insets = view.safeAreaInsets
            state["safeArea"] = ["top": insets.top, "left": insets.left, "bottom": insets.bottom, "right": insets.right]
            var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0
            view.backgroundColor?.getRed(&red, green: &green, blue: &blue, alpha: nil)
            state["ground"] = String(format: "#%02x%02x%02x", Int(round(red * 255)), Int(round(green * 255)), Int(round(blue * 255)))
            // What the page's theme setting made of the window (setTheme).
            state["interfaceStyle"] = ["system", "light", "dark"][view.window?.overrideUserInterfaceStyle.rawValue ?? 0]
            if let scene = view.window?.windowScene {
                state["orientation"] = scene.effectiveGeometry.interfaceOrientation.isLandscape ? "landscape" : "portrait"
            }
        }
        // What the other services report of themselves; left out when it is
        // not JSON, so that one bad value does not cost the whole answer.
        for (key, value) in [("cast", Services.cast.debugState), ("reminders", Services.reminders.debugState)] where JSONSerialization.isValidJSONObject(value) {
            state[key] = value
        }
        state["links"] = LinkOpener.shared.recorded
        if JSONSerialization.isValidJSONObject(DownloadSaver.shared.recorded) { state["saves"] = DownloadSaver.shared.recorded }
        return state
    }
}
#endif
