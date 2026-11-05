// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "Bestie",
    platforms: [.macOS(.v15)],
    targets: [
        .executableTarget(
            name: "Bestie",
            path: "Sources/Bestie",
            swiftSettings: [.swiftLanguageMode(.v5)]
        )
    ]
)
