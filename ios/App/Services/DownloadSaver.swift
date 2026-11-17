import UIKit
import WebKit

/// What becomes of a file the page hands out (`<a download>` of a Blob):
/// WebKit writes it into a folder of the app's own, and the viewer then
/// chooses its place in Files. Navigation makes this the delegate of every
/// download.
///
/// Not a share sheet: its "Save Video" ends an app that has no
/// photo-library key, and the app has none on purpose.
final class DownloadSaver: NSObject, WKDownloadDelegate, UIDocumentPickerDelegate {
    static let shared = DownloadSaver()

    weak var presenter: UIViewController?

    /// tmp/saves/<uuid>/<name>: a folder for each file, so that two files
    /// of one name do not meet, and one above them all that is emptied at
    /// launch, as a file left by an app that was ended half-way may hold
    /// an account's password and the system clears tmp only when it likes.
    private let folder = FileManager.default.temporaryDirectory.appendingPathComponent("saves")
    /// Where each download in flight is being written.
    private var writing: [ObjectIdentifier: URL] = [:]
    /// Files written and not yet placed; the first is the one whose picker
    /// is up. One picker at a time: a second cannot be presented over it.
    private var waiting: [URL] = []

    #if DEBUG
    /// For `node ios/sim.mjs status`: each file written, {name, size}. With
    /// KEPULI_SAVES=record the picker is not shown and the file is dropped,
    /// so that a scenario can save without a hand to choose a place.
    private(set) var recorded: [[String: Any]] = []
    private let recording = ProcessInfo.processInfo.environment["KEPULI_SAVES"] == "record"
    #endif

    private override init() {
        super.init()
        try? FileManager.default.removeItem(at: folder)
    }

    /// The name alone, whatever the page suggested: a path in it would
    /// write outside the file's folder.
    static func fileName(_ suggested: String) -> String {
        let name = (suggested as NSString).lastPathComponent
        return ["", ".", "..", "/"].contains(name) ? "download" : name
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        let directory = folder.appendingPathComponent(UUID().uuidString)
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        } catch {
            completionHandler(nil)
            return
        }
        let file = directory.appendingPathComponent(Self.fileName(suggestedFilename))
        writing[ObjectIdentifier(download)] = file
        completionHandler(file)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let file = writing.removeValue(forKey: ObjectIdentifier(download)) else { return }
        debugLog("save: a file was written")
        #if DEBUG
        let size = (try? FileManager.default.attributesOfItem(atPath: file.path)[.size] as? NSNumber)?.intValue ?? -1
        recorded.append(["name": file.lastPathComponent, "size": size])
        if recording { discard(file); return }
        #endif
        waiting.append(file)
        if waiting.count == 1 { ask() }
    }

    func download(_ download: WKDownload, didFailWithError error: any Error, resumeData: Data?) {
        // The code alone: the description may name the address.
        debugLog("save: failed \((error as NSError).domain) \((error as NSError).code)")
        if let file = writing.removeValue(forKey: ObjectIdentifier(download)) { discard(file) }
    }

    /// The viewer chooses the place. The file is moved there, not copied
    /// (`asCopy: false`): nothing of it is to stay behind in the app.
    ///
    /// A presentation UIKit refuses is asked again: `frontmost` passes
    /// over a controller on its way out, the one under it cannot present
    /// until that has gone, and a refusal calls no delegate, so the file
    /// and every one after it waited for the rest of the launch. After
    /// ten tries the file is let go.
    private func ask(tries: Int = 0) {
        guard let file = waiting.first else { return }
        guard let presenter, tries < 10 else { placed(); return }
        let picker = UIDocumentPickerViewController(forExporting: [file], asCopy: false)
        picker.delegate = self
        presenter.frontmost.present(picker, animated: true)
        if picker.presentingViewController == nil {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [weak self] in self?.ask(tries: tries + 1) }
        }
    }

    /// The picker closed, with a place chosen or without: the file's folder
    /// goes either way, and the next file gets its picker.
    private func placed() {
        if !waiting.isEmpty { discard(waiting.removeFirst()) }
        ask()
    }

    private func discard(_ file: URL) {
        try? FileManager.default.removeItem(at: file.deletingLastPathComponent())
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) { placed() }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { placed() }
}
