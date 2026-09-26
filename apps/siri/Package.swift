// swift-tools-version: 6.4
import PackageDescription

let package = Package(
    name: "SecondBrainSiri",
    platforms: [.macOS(.v27)],
    products: [.executable(name: "SecondBrainSiri", targets: ["SecondBrainSiri"])],
    targets: [
        .executableTarget(
            name: "SecondBrainSiri",
            path: "Sources/SecondBrainSiri"
        ),
        .testTarget(
            name: "SecondBrainSiriTests",
            dependencies: ["SecondBrainSiri"],
            path: "Tests/SecondBrainSiriTests"
        ),
    ]
)
