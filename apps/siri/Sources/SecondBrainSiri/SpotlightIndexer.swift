import CoreSpotlight
import Foundation
import UniformTypeIdentifiers

enum SpotlightIndexer {
    private static let domain = "\(ReplicaConfiguration.storageNamespace).pages"
    private static var searchIndex: CSSearchableIndex {
        CSSearchableIndex(name: ReplicaConfiguration.storageNamespace)
    }

    static func index(_ page: BrainPage) async throws {
        guard !page.archived else {
            try await remove(fileKey: page.fileKey)
            return
        }
        let attributes = CSSearchableItemAttributeSet(contentType: .text)
        attributes.title = page.title ?? page.fileKey
        attributes.contentDescription = page.markdown
        attributes.keywords = tokens(from: page.fileKey + " " + (page.title ?? ""))
        attributes.identifier = page.fileKey
        let item = CSSearchableItem(
            uniqueIdentifier: page.fileKey,
            domainIdentifier: domain,
            attributeSet: attributes
        )
        try await searchIndex.indexSearchableItems([item])
    }

    static func remove(fileKey: String) async throws {
        try await searchIndex.deleteSearchableItems(withIdentifiers: [fileKey])
    }

    static func removeAll() async throws {
        try await searchIndex.deleteSearchableItems(withDomainIdentifiers: [domain])
    }

    private static func tokens(from value: String) -> [String] {
        value
            .lowercased()
            .split { !$0.isLetter && !$0.isNumber }
            .map(String.init)
    }
}
