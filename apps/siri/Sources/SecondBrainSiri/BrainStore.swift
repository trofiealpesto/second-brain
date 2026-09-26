import Foundation
import SwiftData
import Combine

@MainActor
final class BrainStore: ObservableObject {
    @Published private(set) var pages: [BrainPage] = []
    @Published private(set) var isConnected = false
    @Published private(set) var isSyncing = false
    @Published var errorMessage: String?

    let api: SecondBrainAPI
    let oauth: OAuthClient
    private let context: ModelContext
    private let cursorKey = "second-brain.siri.sync-cursor"

    init(
        api: SecondBrainAPI = SecondBrainAPI(),
        container: ModelContainer? = nil
    ) {
        self.api = api
        oauth = OAuthClient(api: api)
        let container = container ?? (try! Self.makeReplicaContainer())
        context = ModelContext(container)
        loadCache()
        Task { [weak self] in self?.isConnected = await api.isConnected() }
    }

    private static func makeReplicaContainer() throws -> ModelContainer {
        let directory = URL.applicationSupportDirectory.appending(path: ReplicaConfiguration.storageNamespace)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let config = ModelConfiguration(url: directory.appending(path: "cache.store"))
        return try ModelContainer(for: CachedPage.self, configurations: config)
    }

    func signIn() async {
        do {
            try await oauth.signIn()
            isConnected = true
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// This starts only after the user accepts that all active page text is local.
    func initialSyncAfterPrivacyConsent() async {
        UserDefaults.standard.set(true, forKey: "second-brain.siri.local-copy-approved")
        UserDefaults.standard.removeObject(forKey: cursorKey)
        await sync()
    }

    func sync() async {
        guard isConnected else { return }
        isSyncing = true
        defer { isSyncing = false }
        do {
            var cursor = UserDefaults.standard.string(forKey: cursorKey)
            let isFullSnapshot = cursor == nil
            var snapshotKeys = Set<String>()
            for _ in 0..<500 {
                let response = try await api.sync(cursor: cursor)
                try await apply(response.changes, snapshotKeys: &snapshotKeys)
                cursor = response.nextCursor
                UserDefaults.standard.set(cursor, forKey: cursorKey)
                if response.mode == "changes" || response.changes.isEmpty { break }
            }
            if isFullSnapshot {
                try await removePagesMissingFromSnapshot(snapshotKeys)
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func capture(title: String?, content: String) async throws {
        _ = try await api.capture(title: title, content: content)
        await sync()
    }

    /// Call only from a UI/App Intent confirmation flow that has shown its preview.
    func update(
        page: BrainPage,
        operation: PageOperation,
        content: String? = nil,
        title: String? = nil,
        destination: String? = nil
    ) async throws {
        _ = try await api.mutate(
            fileKey: page.fileKey,
            operation: operation,
            revision: page.revision,
            content: content,
            title: title,
            destination: destination
        )
        await sync()
    }

    /// Archive is reversible and does not remove the Markdown page from GitHub.
    func archive(page: BrainPage) async throws {
        _ = try await api.archive(fileKey: page.fileKey, revision: page.revision)
        await sync()
    }

    func searchLocal(_ query: String) -> [BrainPage] {
        let terms = query.lowercased().split { !$0.isLetter && !$0.isNumber }.map(String.init)
        guard !terms.isEmpty else { return pages.filter { !$0.archived } }
        return pages.filter { page in
            guard !page.archived else { return false }
            let haystack = "\(page.fileKey) \(page.title ?? "") \(page.markdown)".lowercased()
            return terms.allSatisfy(haystack.contains)
        }
    }

    func disconnectAndErase() async {
        await api.signOut()
        for page in cachedPages() { context.delete(page) }
        try? context.save()
        try? await SpotlightIndexer.removeAll()
        UserDefaults.standard.removeObject(forKey: cursorKey)
        UserDefaults.standard.removeObject(forKey: "second-brain.siri.local-copy-approved")
        pages = []
        isConnected = false
    }

    private func apply(_ changes: [SyncItem], snapshotKeys: inout Set<String>) async throws {
        for item in changes {
            if item.deleted == true {
                if let cached = cachedPage(fileKey: item.fileKey) { context.delete(cached) }
                try? await SpotlightIndexer.remove(fileKey: item.fileKey)
                continue
            }
            guard let content = item.content, let revision = item.revision else { continue }
            let page = BrainPage(
                fileKey: item.fileKey,
                title: item.title,
                markdown: content,
                revision: revision,
                archived: item.archived ?? false,
                updatedAt: item.updatedAt ?? ""
            )
            snapshotKeys.insert(page.fileKey)
            if let cached = cachedPage(fileKey: page.fileKey) {
                cached.title = page.title
                cached.markdown = page.markdown
                cached.revision = page.revision
                cached.archived = page.archived
                cached.updatedAt = page.updatedAt
            } else {
                context.insert(CachedPage(page: page))
            }
            try await SpotlightIndexer.index(page)
        }
        try context.save()
        loadCache()
    }

    private func removePagesMissingFromSnapshot(_ fileKeys: Set<String>) async throws {
        for cached in cachedPages() where !fileKeys.contains(cached.fileKey) {
            context.delete(cached)
            try? await SpotlightIndexer.remove(fileKey: cached.fileKey)
        }
        try context.save()
        loadCache()
    }

    private func loadCache() {
        pages = cachedPages().map(\.page).sorted { $0.fileKey < $1.fileKey }
    }

    private func cachedPages() -> [CachedPage] {
        (try? context.fetch(FetchDescriptor<CachedPage>())) ?? []
    }

    private func cachedPage(fileKey: String) -> CachedPage? {
        let descriptor = FetchDescriptor<CachedPage>(predicate: #Predicate { $0.fileKey == fileKey })
        return try? context.fetch(descriptor).first
    }
}
