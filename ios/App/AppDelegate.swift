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
        // A video player's category, as Apple asks of one. It is not made
        // active here: the sound is WebKit's, which activates a playback
        // session of its own when a picture with sound starts, and an app
        // that did so at launch would stop the viewer's music before
        // anything plays. Now Playing, the lock screen's commands, a
        // call's interruption and unplugged headphones are WebKit's too
        // (the page's Media Session, js/playercontrols.js): no code here.
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
