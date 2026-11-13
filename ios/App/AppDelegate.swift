// Kepuli-TV for the iPhone and the iPad: the extension's player in one web
// view (ExtensionHost), with native code for what a page cannot do there
// (Bridge and the services). ios/AGENTS.md is the guide.

import AVFoundation
import UIKit
import UserNotifications

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        // A television's sound does not depend on the ring switch. With the
        // audio background mode this is also what lets picture in picture
        // and sound go on when the app leaves the foreground.
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
        Services.start()
        // Set before launch ends, or a notification tapped while the app was
        // closed is delivered to nobody.
        UNUserNotificationCenter.current().delegate = Services.reminders
        return true
    }

    /// The app follows the way the device is held, everywhere: nothing is
    /// forced when full screen is entered or left, and the device's rotation
    /// lock decides, as in the Android phone app. The app-wide mask also
    /// governs the window WebKit presents for full screen.
    func application(_ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        UIDevice.current.userInterfaceIdiom == .pad ? .all : .allButUpsideDown
    }
}
