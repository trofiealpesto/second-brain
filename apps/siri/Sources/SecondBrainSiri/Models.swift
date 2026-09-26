import Foundation
import SwiftData

struct OAuthTokens: Codable, Sendable, Equatable {
    let accessToken: String
    let refreshToken: String?
    let expiresAt: Date?

    var isExpired: Bool {
        guard let expiresAt else { return false }
        return expiresAt <= Date().addingTimeInterval(60)
    }
}

struct ServerConfiguration: Codable, Sendable, Equatable {
    var baseURL: URL
    var clientID: String?

    static func validatedServerURL(_ value: String?) -> URL? {
        guard let value, let url = URL(string: value.trimmingCharacters(in: .whitespacesAndNewlines)),
              url.scheme == "https", let host = url.host, !host.isEmpty,
              !host.hasSuffix(".invalid"), url.user == nil, url.password == nil,
              url.query == nil, url.fragment == nil, url.path.isEmpty || url.path == "/"
        else { return nil }
        return url
    }

    static let `default` = ServerConfiguration(
        baseURL: validatedServerURL(Bundle.main.object(forInfoDictionaryKey: "SecondBrainServerURL") as? String)
            ?? URL(string: "https://second-brain.invalid")!,
        clientID: nil
    )
}

enum ReplicaConfiguration {
    static let callbackScheme = "secondbrain-replica"
    static let callbackURL = "\(callbackScheme)://oauth/callback"
    // A separate bundle and per-server namespace keep other installations untouched.
    static let storageNamespace = "\(Bundle.main.bundleIdentifier ?? "org.example.secondbrain.replica").\(ServerConfiguration.default.baseURL.host ?? "unconfigured")"
}

struct BrainPage: Codable, Identifiable, Sendable, Equatable {
    var id: String { fileKey }
    let fileKey: String
    let title: String?
    let markdown: String
    let revision: String
    let archived: Bool
    let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case fileKey = "file_key"
        case title, markdown = "content", revision, archived
        case updatedAt = "updated_at"
    }
}

struct SyncItem: Codable, Sendable {
    let fileKey: String
    let title: String?
    let content: String?
    let revision: String?
    let archived: Bool?
    let updatedAt: String?
    let deleted: Bool?

    enum CodingKeys: String, CodingKey {
        case fileKey = "file_key", title, content, revision, archived
        case updatedAt = "updated_at", deleted
    }
}

struct SyncResponse: Codable, Sendable {
    let mode: String
    let changes: [SyncItem]
    let nextCursor: String

    enum CodingKeys: String, CodingKey {
        case mode, changes
        case nextCursor = "next_cursor"
    }
}

struct SearchSource: Codable, Identifiable, Sendable, Equatable {
    var id: String { "\(fileKey)#\(section ?? "")#\(excerpt.hashValue)" }
    let fileKey: String
    let title: String?
    let section: String?
    let excerpt: String
    let score: Double
    let wikilinks: [String]

    enum CodingKeys: String, CodingKey {
        case fileKey = "file_key", title, section, excerpt, score, wikilinks
    }
}

struct SearchResponse: Codable, Sendable {
    let results: [SearchSource]
    let total: Int
}

struct CaptureResponse: Codable, Sendable {
    let fileKey: String
    let revision: String

    enum CodingKeys: String, CodingKey {
        case fileKey = "file_key", revision
    }
}

enum PageOperation: String, Codable, Sendable {
    case append, replace, rename, move
}

@Model
final class CachedPage {
    @Attribute(.unique) var fileKey: String
    var title: String?
    var markdown: String
    var revision: String
    var archived: Bool
    var updatedAt: String

    init(page: BrainPage) {
        fileKey = page.fileKey
        title = page.title
        markdown = page.markdown
        revision = page.revision
        archived = page.archived
        updatedAt = page.updatedAt
    }

    var page: BrainPage {
        BrainPage(
            fileKey: fileKey,
            title: title,
            markdown: markdown,
            revision: revision,
            archived: archived,
            updatedAt: updatedAt
        )
    }
}

enum SecondBrainError: LocalizedError, Sendable {
    case notConnected
    case invalidResponse
    case conflict
    case server(String)

    var errorDescription: String? {
        switch self {
        case .notConnected: "Sign in to Second Brain first."
        case .invalidResponse: "Second Brain returned an invalid response."
        case .conflict: "This page changed elsewhere. Sync and review the latest version."
        case .server(let message): message
        }
    }
}
