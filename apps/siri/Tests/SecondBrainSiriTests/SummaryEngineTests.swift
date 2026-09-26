import Foundation
import Testing
@testable import SecondBrainSiri

@Test func deterministicFallbackKeepsOnlyWorkerSources() async {
    let sources = [
        SearchSource(
            fileKey: "concepts/example.md",
            title: "Example",
            section: nil,
            excerpt: "A verified excerpt.",
            score: 0.9,
            wikilinks: []
        )
    ]
    // The result always retains the exact Worker source list, including when the
    // current host has an on-device model and chooses to produce a summary.
    let result = await SummaryEngine.answer(question: "What is this?", sources: sources)
    #expect(result.sources == sources)
}

@Test func searchSourceStableIdentifierIncludesPage() {
    let source = SearchSource(
        fileKey: "concepts/example.md", title: nil, section: nil,
        excerpt: "Text", score: 0.5, wikilinks: []
    )
    #expect(source.id.contains("concepts/example.md"))
}
