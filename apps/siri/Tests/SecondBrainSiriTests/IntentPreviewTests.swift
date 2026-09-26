import Testing
@testable import SecondBrainSiri

@Suite(.serialized)
struct IntentPreviewTests {
    @Test func updatePreviewShowsTargetAndDiff() async {
        let page = BrainPage(
            fileKey: "projects/alpha.md",
            title: "Alpha",
            markdown: "Old body",
            revision: "revision-1",
            archived: false,
            updatedAt: "2026-09-11T00:00:00Z"
        )
        let note = NoteEntity(id: page.fileKey, title: "Alpha", revision: page.revision, archived: false)
        await IntentPageCache.shared.replace(with: [page])

        let preview = await IntentPageCache.shared.preview(note: note, operation: .replace, value: "New body")

        #expect(preview.contains("Target: projects/alpha.md"))
        #expect(preview.contains("- Old body"))
        #expect(preview.contains("+ New body"))
    }

    @Test func archivedPagesAreNotSuggestedToSiri() async {
        let active = BrainPage(fileKey: "active.md", title: "Active", markdown: "", revision: "1", archived: false, updatedAt: "")
        let archived = BrainPage(fileKey: "archive.md", title: "Archive", markdown: "", revision: "2", archived: true, updatedAt: "")
        await IntentPageCache.shared.replace(with: [active, archived])

        let suggestions = await IntentPageCache.shared.notes(matching: [])

        #expect(suggestions.map(\.id) == ["active.md"])
    }
}
