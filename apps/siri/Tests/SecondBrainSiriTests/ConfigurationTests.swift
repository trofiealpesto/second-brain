import Foundation
import Testing
@testable import SecondBrainSiri

@Test func serverConfigurationRequiresAnExplicitHTTPSOrigin() {
    #expect(ServerConfiguration.validatedServerURL(nil) == nil)
    #expect(ServerConfiguration.validatedServerURL("$(SECOND_BRAIN_SERVER_URL)") == nil)
    #expect(ServerConfiguration.validatedServerURL("https://second-brain.invalid") == nil)
    #expect(ServerConfiguration.validatedServerURL("http://example.com") == nil)
    #expect(ServerConfiguration.validatedServerURL("https://example.com/mcp") == nil)
    #expect(ServerConfiguration.validatedServerURL("https://token@example.com") == nil)
    #expect(ServerConfiguration.validatedServerURL("https://example.com")?.host == "example.com")
}

@Test func replicaUsesAnIndependentOAuthCallback() {
    #expect(ReplicaConfiguration.callbackURL == "secondbrain-replica://oauth/callback")
    #expect(ReplicaConfiguration.storageNamespace.contains("second-brain.invalid"))
}
