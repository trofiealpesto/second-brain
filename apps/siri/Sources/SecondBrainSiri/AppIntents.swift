import AppIntents
import CoreSpotlight
import CoreTransferable
import Foundation
import UniformTypeIdentifiers

@AppEntity(schema: .notes.note)
struct NoteEntity: IndexedEntity, SyncableEntity, Transferable {
    static let defaultQuery = NoteEntityQuery()

    let id: String
    let title: String
    let revision: String
    let archived: Bool
    var name: AttributedString
    var content: AttributedString?
    var folder: FolderEntity?
    var isPinned: Bool
    var attachments: [IntentFile]
    var creationDate: Date?
    var modificationDate: Date?

    init(
        id: String,
        title: String,
        revision: String,
        archived: Bool,
        markdown: String? = nil,
        updatedAt: String? = nil
    ) {
        self.id = id
        self.title = title
        self.revision = revision
        self.archived = archived
        name = AttributedString(title)
        content = markdown.map(AttributedString.init)
        let folderID = id.split(separator: "/").dropLast().joined(separator: "/")
        folder = folderID.isEmpty ? nil : FolderEntity(folderID)
        isPinned = false
        attachments = []
        creationDate = nil
        modificationDate = updatedAt.flatMap { ISO8601DateFormatter().date(from: $0) }
    }

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(title)", subtitle: "\(id)")
    }

    var attributeSet: CSSearchableItemAttributeSet {
        let attributes = CSSearchableItemAttributeSet(contentType: .text)
        attributes.title = title
        attributes.contentDescription = id
        return attributes
    }

    static var transferRepresentation: some TransferRepresentation {
        ProxyRepresentation(exporting: { $0.id })
    }
}

@AppEntity(schema: .notes.folder)
struct FolderEntity: SyncableEntity, Transferable {
    static let defaultQuery = FolderEntityQuery()

    let id: String
    var name: String
    var parentFolder: FolderEntity?
    var account: SecondBrainAccountEntity?

    init(_ id: String) {
        self.id = id
        name = id.split(separator: "/").last.map(String.init) ?? id
        let parentID = id.split(separator: "/").dropLast().joined(separator: "/")
        parentFolder = parentID.isEmpty ? nil : FolderEntity(parentID)
        account = SecondBrainAccountEntity()
    }

    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(id)") }

    static var transferRepresentation: some TransferRepresentation {
        ProxyRepresentation(exporting: { $0.id })
    }
}

@AppEntity(schema: .notes.account)
struct SecondBrainAccountEntity: SyncableEntity, Transferable {
    static let defaultQuery = SecondBrainAccountEntityQuery()

    let id: String
    var name: String

    init(id: String = "second-brain", name: String = "Second Brain") {
        self.id = id
        self.name = name
    }

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)")
    }

    static var transferRepresentation: some TransferRepresentation {
        ProxyRepresentation(exporting: { $0.id })
    }
}

struct NoteEntityQuery: EntityStringQuery {
    init() {}

    func entities(for identifiers: [String]) async throws -> [NoteEntity] {
        await IntentPageCache.shared.notes(matching: identifiers)
    }

    func suggestedEntities() async throws -> [NoteEntity] {
        await IntentPageCache.shared.notes(matching: [])
    }

    func entities(matching string: String) async throws -> [NoteEntity] {
        await IntentPageCache.shared.search(string)
    }
}

struct FolderEntityQuery: EntityStringQuery {
    init() {}

    func entities(for identifiers: [String]) async throws -> [FolderEntity] {
        identifiers.map(FolderEntity.init)
    }

    func suggestedEntities() async throws -> [FolderEntity] {
        await IntentPageCache.shared.folders()
    }

    func entities(matching string: String) async throws -> [FolderEntity] {
        await IntentPageCache.shared.folders().filter { $0.id.localizedCaseInsensitiveContains(string) }
    }
}

struct SecondBrainAccountEntityQuery: EntityStringQuery {
    init() {}

    func entities(for identifiers: [String]) async throws -> [SecondBrainAccountEntity] {
        identifiers.contains("second-brain") ? [SecondBrainAccountEntity()] : []
    }

    func suggestedEntities() async throws -> [SecondBrainAccountEntity] {
        [SecondBrainAccountEntity()]
    }

    func entities(matching string: String) async throws -> [SecondBrainAccountEntity] {
        "Second Brain".localizedCaseInsensitiveContains(string) ? [SecondBrainAccountEntity()] : []
    }
}

actor IntentPageCache {
    static let shared = IntentPageCache()
    private var pages: [NoteEntity] = []
    private var pageByID: [String: BrainPage] = [:]

    func replace(with pages: [BrainPage]) {
        self.pages = pages.map {
            NoteEntity(
                id: $0.fileKey,
                title: $0.title ?? $0.fileKey,
                revision: $0.revision,
                archived: $0.archived,
                markdown: $0.markdown,
                updatedAt: $0.updatedAt
            )
        }
        pageByID = Dictionary(uniqueKeysWithValues: pages.map { ($0.fileKey, $0) })
    }

    func notes(matching identifiers: [String]) -> [NoteEntity] {
        identifiers.isEmpty ? pages.filter { !$0.archived } : pages.filter { identifiers.contains($0.id) }
    }

    func search(_ string: String) -> [NoteEntity] {
        pages.filter { !$0.archived && ($0.title.localizedCaseInsensitiveContains(string) || $0.id.localizedCaseInsensitiveContains(string)) }
    }

    func folders() -> [FolderEntity] {
        Array(Set(pages.compactMap { $0.id.split(separator: "/").dropLast().joined(separator: "/").isEmpty ? nil : String($0.id.split(separator: "/").dropLast().joined(separator: "/")) }))
            .sorted().map(FolderEntity.init)
    }

    func preview(note: NoteEntity, operation: PageOperation, value: String) -> String {
        let current = pageByID[note.id]
        let currentTitle = current?.title ?? note.title

        switch operation {
        case .append:
            return "Target: \(note.id)\nAppend:\n+ \(previewText(value))"
        case .replace:
            let old = current.map { previewText($0.markdown) } ?? "Current content unavailable"
            return "Target: \(note.id)\nReplace:\n- \(old)\n+ \(previewText(value))"
        case .rename:
            return "Target: \(note.id)\nRename:\n- \(currentTitle)\n+ \(previewText(value))"
        case .move:
            let folder = note.id.split(separator: "/").dropLast().joined(separator: "/")
            return "Target: \(note.id)\nMove:\n- \(folder.isEmpty ? "/" : folder)\n+ \(previewText(value))"
        }
    }

    private func previewText(_ text: String) -> String {
        let normalized = text.replacingOccurrences(of: "\n", with: " ")
        return normalized.count > 400 ? String(normalized.prefix(397)) + "..." : normalized
    }
}

actor IntentRuntime {
    static let shared = IntentRuntime()
    private let api = SecondBrainAPI()

    func capture(title: String?, text: String) async throws -> CaptureResponse {
        try await api.capture(title: title, content: text)
    }

    func ask(_ question: String) async throws -> AnswerWithSources {
        let results = try await api.search(query: question)
        return await SummaryEngine.answer(question: question, sources: results.results)
    }

    func search(_ query: String) async throws -> SearchResponse {
        try await api.search(query: query)
    }

    func update(note: NoteEntity, operation: PageOperation, value: String) async throws -> BrainPageMutationResponse {
        switch operation {
        case .append, .replace:
            return try await api.mutate(fileKey: note.id, operation: operation, revision: note.revision, content: value)
        case .rename:
            return try await api.mutate(fileKey: note.id, operation: operation, revision: note.revision, title: value)
        case .move:
            return try await api.mutate(fileKey: note.id, operation: operation, revision: note.revision, destination: value)
        }
    }

    func updateMetadata(
        note: NoteEntity,
        name: String?,
        folder: FolderEntity?
    ) async throws -> NoteEntity {
        var current = note
        if let name, name != note.title {
            let response = try await update(note: current, operation: .rename, value: name)
            current = NoteEntity(
                id: response.fileKey,
                title: name,
                revision: response.revision,
                archived: response.archived ?? false
            )
        }
        if let folder, folder.id != note.folder?.id {
            let response = try await update(note: current, operation: .move, value: folder.id)
            current = NoteEntity(
                id: response.fileKey,
                title: current.title,
                revision: response.revision,
                archived: response.archived ?? false
            )
        }
        return current
    }

    func archive(note: NoteEntity) async throws {
        _ = try await api.archive(fileKey: note.id, revision: note.revision)
    }
}

@AppIntent(schema: .system.searchInApp)
struct SearchSecondBrainIntent {
    static let title: LocalizedStringResource = "Search Second Brain"
    static let openAppWhenRun = true

    @Parameter(title: "Search query") var criteria: StringSearchCriteria

    init() {}
    init(query: String) { self.criteria = StringSearchCriteria(term: query) }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let results = try await IntentRuntime.shared.search(criteria.term)
        let titles = results.results.prefix(5).map { $0.title ?? $0.fileKey }.joined(separator: ", ")
        let dialog = titles.isEmpty ? "No matching pages were found." : "Matching pages: \(titles)"
        return .result(dialog: IntentDialog(stringLiteral: dialog))
    }
}

struct AskSecondBrainIntent: AppIntent {
    static let title: LocalizedStringResource = "Ask Second Brain"
    static let description = IntentDescription("Searches Second Brain and summarizes only its returned sources on-device.")
    static let openAppWhenRun = true

    @Parameter(title: "Question") var question: String

    init() {}
    init(question: String) { self.question = question }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let answer = try await IntentRuntime.shared.ask(question)
        let sourceList = answer.sources.enumerated().map { "[\($0.offset + 1)] \($0.element.title ?? $0.element.fileKey)" }.joined(separator: ", ")
        return .result(dialog: IntentDialog(stringLiteral: "\(answer.text)\nSources: \(sourceList)"))
    }
}

/// This is deliberately immediate: it writes only a new immutable raw/voice capture.
@AppIntent(schema: .notes.createNote)
struct CreateVoiceCaptureIntent {
    static let title: LocalizedStringResource = "Capture to Second Brain"
    static let openAppWhenRun = false

    @Parameter(title: "Title", default: "Voice capture") var name: AttributedString
    @Parameter(title: "Text") var content: AttributedString?
    @Parameter(title: "Pinned", default: false) var isPinned: Bool
    @Parameter(title: "Attachments", default: [], supportedContentTypes: [UTType.item]) var attachments: [IntentFile]
    @Parameter(title: "Folder") var folder: FolderEntity?

    init() {}
    init(text: String, title: String = "Voice capture") {
        name = AttributedString(title)
        content = AttributedString(text)
        isPinned = false
        attachments = []
        folder = nil
    }

    func perform() async throws -> some IntentResult & ProvidesDialog & ReturnsValue<NoteEntity> {
        guard !isPinned, attachments.isEmpty, folder == nil else {
            throw SecondBrainError.server("Voice captures are always saved unpinned in raw/voice without attachments or a selected folder.")
        }
        let title = String(name.characters)
        let text = content.map { String($0.characters) } ?? ""
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw SecondBrainError.server("A voice capture needs text.")
        }
        let capture = try await IntentRuntime.shared.capture(title: title, text: text)
        let note = NoteEntity(id: capture.fileKey, title: title, revision: capture.revision, archived: false, markdown: text)
        return .result(value: note, dialog: IntentDialog(stringLiteral: "Saved immutable capture \(capture.fileKey)."))
    }
}

/// The Notes schema manages rename and move. Content edits remain custom because this
/// schema intentionally does not provide a replace-body operation.
@AppIntent(schema: .notes.updateNote)
struct UpdateSecondBrainNoteIntent {
    static let title: LocalizedStringResource = "Update Second Brain note"
    static let openAppWhenRun = true

    @Parameter(title: "Note") var target: NoteEntity
    @Parameter(title: "Title") var name: AttributedString?
    @Parameter(title: "Pinned") var isPinned: Bool?
    @Parameter(title: "Attachments", supportedContentTypes: [UTType.item]) var attachments: [IntentFile]?
    @Parameter(title: "Folder") var folder: FolderEntity?

    init() {}
    init(note: NoteEntity, name: String? = nil, folder: FolderEntity? = nil) {
        target = note
        self.name = name.map(AttributedString.init)
        isPinned = nil
        attachments = nil
        self.folder = folder
    }

    func perform() async throws -> some IntentResult & ProvidesDialog & ReturnsValue<NoteEntity> {
        guard isPinned != true, attachments?.isEmpty != false else {
            throw SecondBrainError.server("Second Brain does not support changing pinned state or attachments through Siri yet.")
        }
        let updatedName = name.map { String($0.characters) }
        guard updatedName != nil || folder != nil else {
            throw SecondBrainError.server("Choose a new title or destination folder.")
        }
        let changes = [
            updatedName.map { "Rename: \(target.title) → \($0)" },
            folder.map { "Move: \(target.folder?.id ?? "/") → \($0.id)" },
        ].compactMap { $0 }.joined(separator: "\n")
        try await requestConfirmation(
            actionName: .continue,
            dialog: IntentDialog(stringLiteral: "Target: \(target.id)\n\(changes)")
        )
        let updated = try await IntentRuntime.shared.updateMetadata(note: target, name: updatedName, folder: folder)
        return .result(value: updated, dialog: "Updated \(updated.title).")
    }
}

/// Siri/Shortcuts presents this confirmation after showing its concrete target and diff.
struct EditSecondBrainNoteContentIntent: AppIntent {
    static let title: LocalizedStringResource = "Edit Second Brain note content"
    static let openAppWhenRun = true

    @Parameter(title: "Note") var note: NoteEntity
    @Parameter(title: "Operation") var operation: NoteContentOperationIntent
    @Parameter(title: "Text") var value: String

    init() {}
    init(note: NoteEntity, operation: NoteContentOperationIntent, value: String) {
        self.note = note; self.operation = operation; self.value = value
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let preview = await IntentPageCache.shared.preview(note: note, operation: operation.operation, value: value)
        try await requestConfirmation(actionName: .continue, dialog: IntentDialog(stringLiteral: preview))
        _ = try await IntentRuntime.shared.update(note: note, operation: operation.operation, value: value)
        return .result(dialog: "Updated \(note.title).")
    }
}

struct ArchiveSecondBrainNoteIntent: AppIntent {
    static let title: LocalizedStringResource = "Archive Second Brain note"
    static let openAppWhenRun = true

    @Parameter(title: "Note") var note: NoteEntity

    init() {}
    init(note: NoteEntity) { self.note = note }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        try await requestConfirmation(
            actionName: .continue,
            dialog: IntentDialog(stringLiteral: "Archive target: \(note.id) (\(note.title))? It will remain recoverable.")
        )
        try await IntentRuntime.shared.archive(note: note)
        return .result(dialog: "Archived \(note.title).")
    }
}

enum NoteContentOperationIntent: String, AppEnum {
    case append, replace

    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Note operation")
    static let caseDisplayRepresentations: [NoteContentOperationIntent: DisplayRepresentation] = [
        .append: "Append", .replace: "Replace",
    ]

    var operation: PageOperation { PageOperation(rawValue: rawValue)! }
}

struct SecondBrainShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: AskSecondBrainIntent(), phrases: [
            "Ask \(.applicationName)",
            "Chiedi a \(.applicationName)",
        ], shortTitle: "Ask Second Brain", systemImageName: "brain.head.profile")
        AppShortcut(intent: CreateVoiceCaptureIntent(), phrases: [
            "Save to \(.applicationName)",
            "Salva in \(.applicationName)",
        ], shortTitle: "Capture", systemImageName: "mic")
        AppShortcut(intent: SearchSecondBrainIntent(), phrases: [
            "Search \(.applicationName)",
            "Cerca in \(.applicationName)",
        ], shortTitle: "Search", systemImageName: "magnifyingglass")
        AppShortcut(intent: ArchiveSecondBrainNoteIntent(), phrases: [
            "Archive in \(.applicationName)",
            "Archivia in \(.applicationName)",
        ], shortTitle: "Archive", systemImageName: "archivebox")
    }
}
