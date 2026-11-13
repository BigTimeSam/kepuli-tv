import UIKit

/// The one window. The app declares a single scene (project.yml), so there
/// is one player and one page, as the page's own "one tab" rule expects.
final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let scene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: scene)
        window.backgroundColor = PlayerViewController.ground
        window.rootViewController = PlayerViewController()
        window.makeKeyAndVisible()
        self.window = window
    }
}
