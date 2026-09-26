import Foundation
import FoundationModels

struct AnswerWithSources: Sendable, Equatable {
    let text: String
    let sources: [SearchSource]
    let usedOnDeviceModel: Bool
}

enum SummaryEngine {
    /// Never asks a cloud model. Without the on-device model, excerpts are returned verbatim.
    static func answer(question: String, sources: [SearchSource]) async -> AnswerWithSources {
        let stableSources = Array(sources.prefix(5))
        guard !stableSources.isEmpty else {
            return AnswerWithSources(text: "No matching pages were found.", sources: [], usedOnDeviceModel: false)
        }
        let fallback = stableSources.enumerated().map { index, source in
            "[\(index + 1)] \(source.excerpt)"
        }.joined(separator: "\n\n")

        guard SystemLanguageModel.default.isAvailable else {
            return AnswerWithSources(text: fallback, sources: stableSources, usedOnDeviceModel: false)
        }
        do {
            let context = stableSources.enumerated().map { index, source in
                "SOURCE [\(index + 1)] \(source.fileKey)\n\(source.excerpt)"
            }.joined(separator: "\n\n")
            let session = LanguageModelSession(
                instructions: "Answer only from the supplied sources. Be concise. Do not invent citations or facts."
            )
            let response = try await session.respond(to: "Question: \(question)\n\n\(context)")
            // Sources are attached from the Worker response, never parsed from model output.
            return AnswerWithSources(text: response.content, sources: stableSources, usedOnDeviceModel: true)
        } catch {
            return AnswerWithSources(text: fallback, sources: stableSources, usedOnDeviceModel: false)
        }
    }
}
