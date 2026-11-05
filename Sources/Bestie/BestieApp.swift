import SwiftUI

@main
struct BestieApp: App {
    @StateObject private var model = RecorderModel()

    var body: some Scene {
        Window("Bestie", id: "main") {
            ContentView()
                .environmentObject(model)
        }
        Settings {
            SettingsView()
                .environmentObject(model)
        }
    }
}
