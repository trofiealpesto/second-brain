import AppKit
import AuthenticationServices
import CryptoKit
import Foundation
import Security

actor SecondBrainAPI {
    private var configuration: ServerConfiguration
    private var tokens: OAuthTokens?
    private let session: URLSession

    init(
        configuration: ServerConfiguration = (try? KeychainStore.loadConfiguration()) ?? .default,
        tokens: OAuthTokens? = try? KeychainStore.loadTokens(),
        session: URLSession = .shared
    ) {
        self.configuration = configuration
        self.tokens = tokens
        self.session = session
    }

    func updateConfiguration(_ configuration: ServerConfiguration) throws {
        self.configuration = configuration
        try KeychainStore.saveConfiguration(configuration)
    }

    func storedConfiguration() -> ServerConfiguration { configuration }
    func isConnected() -> Bool {
        loadCredentialsIfNeeded()
        return tokens != nil
    }

    func setTokens(_ tokens: OAuthTokens) throws {
        self.tokens = tokens
        try KeychainStore.saveTokens(tokens)
    }

    func signOut() async {
        loadCredentialsIfNeeded()
        if let tokens {
            var request = URLRequest(url: endpoint("token"))
            request.httpMethod = "POST"
            request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
            request.httpBody = formData(["token": tokens.accessToken]).data(using: .utf8)
            _ = try? await session.data(for: request) // Provider owns RFC 7009 revocation.
        }
        self.tokens = nil
        try? KeychainStore.removeAll()
    }

    func sync(cursor: String?) async throws -> SyncResponse {
        var components = URLComponents(url: endpoint("v1/siri/sync"), resolvingAgainstBaseURL: false)!
        if let cursor { components.queryItems = [URLQueryItem(name: "cursor", value: cursor)] }
        return try await send(URLRequest(url: components.url!), as: SyncResponse.self)
    }

    func search(query: String, limit: Int = 8) async throws -> SearchResponse {
        try await sendJSON(
            path: "v1/siri/search",
            method: "POST",
            body: ["query": query, "limit": limit],
            as: SearchResponse.self
        )
    }

    func capture(title: String?, content: String) async throws -> CaptureResponse {
        var body: [String: Any] = ["content": content]
        if let title, !title.isEmpty { body["title"] = title }
        return try await sendJSON(path: "v1/siri/captures", method: "POST", body: body, as: CaptureResponse.self)
    }

    func mutate(
        fileKey: String,
        operation: PageOperation,
        revision: String,
        content: String? = nil,
        title: String? = nil,
        destination: String? = nil
    ) async throws -> BrainPageMutationResponse {
        var body: [String: Any] = ["operation": operation.rawValue]
        if let content { body["content"] = content }
        if let title { body["title"] = title }
        if let destination { body["destination"] = destination }
        return try await sendJSON(
            path: "v1/siri/pages/\(fileKey.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? fileKey)",
            method: "PATCH",
            body: body,
            revision: revision,
            as: BrainPageMutationResponse.self
        )
    }

    func archive(fileKey: String, revision: String) async throws -> BrainPageMutationResponse {
        try await sendJSON(
            path: "v1/siri/pages/\(fileKey.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? fileKey)/archive",
            method: "POST",
            body: [:],
            revision: revision,
            as: BrainPageMutationResponse.self
        )
    }

    private func sendJSON<T: Decodable>(
        path: String,
        method: String,
        body: [String: Any],
        revision: String? = nil,
        as type: T.Type
    ) async throws -> T {
        var request = URLRequest(url: endpoint(path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let revision { request.setValue("\"\(revision)\"", forHTTPHeaderField: "If-Match") }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        return try await send(request, as: T.self)
    }

    private func send<T: Decodable>(_ request: URLRequest, as type: T.Type) async throws -> T {
        let token = try await accessToken()
        var authenticated = request
        authenticated.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await session.data(for: authenticated)
        guard let response = response as? HTTPURLResponse else { throw SecondBrainError.invalidResponse }
        if response.statusCode == 409 { throw SecondBrainError.conflict }
        guard (200..<300).contains(response.statusCode) else {
            let message = (try? JSONDecoder().decode(APIError.self, from: data))?.error.message
                ?? HTTPURLResponse.localizedString(forStatusCode: response.statusCode)
            throw SecondBrainError.server(message)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func endpoint(_ path: String) -> URL {
        configuration.baseURL.appending(path: path)
    }

    private func loadCredentialsIfNeeded() {
        guard tokens == nil else { return }
        tokens = try? KeychainStore.loadTokens()
        if let savedConfiguration = try? KeychainStore.loadConfiguration() {
            configuration = savedConfiguration
        }
    }

    private func accessToken() async throws -> String {
        loadCredentialsIfNeeded()
        guard let current = tokens else { throw SecondBrainError.notConnected }
        guard current.isExpired else { return current.accessToken }
        guard let refreshToken = current.refreshToken, let clientID = configuration.clientID else {
            throw SecondBrainError.notConnected
        }

        var request = URLRequest(url: endpoint("token"))
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = formData([
            "grant_type": "refresh_token",
            "client_id": clientID,
            "refresh_token": refreshToken,
        ]).data(using: .utf8)
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw SecondBrainError.notConnected
        }
        let raw = try JSONDecoder().decode(TokenResponse.self, from: data)
        let refreshed = OAuthTokens(
            accessToken: raw.accessToken,
            refreshToken: raw.refreshToken ?? refreshToken,
            expiresAt: raw.expiresIn.map { Date().addingTimeInterval(TimeInterval($0)) }
        )
        tokens = refreshed
        try KeychainStore.saveTokens(refreshed)
        return refreshed.accessToken
    }

    private func formData(_ values: [String: String]) -> String {
        values.map { key, value in
            "\(key.urlQueryEncoded)=\(value.urlQueryEncoded)"
        }.joined(separator: "&")
    }
}

struct BrainPageMutationResponse: Codable, Sendable {
    let fileKey: String
    let revision: String
    let archived: Bool?
    let syncPending: Bool?

    enum CodingKeys: String, CodingKey {
        case fileKey = "file_key", revision, archived
        case syncPending = "sync_pending"
    }
}

private struct APIError: Decodable {
    struct Detail: Decodable { let message: String }
    let error: Detail
}

@MainActor
final class OAuthClient: NSObject, ASWebAuthenticationPresentationContextProviding {
    private let api: SecondBrainAPI
    private var presentationSession: ASWebAuthenticationSession?

    init(api: SecondBrainAPI) { self.api = api }

    func signIn() async throws {
        var configuration = await api.storedConfiguration()
        guard ServerConfiguration.validatedServerURL(configuration.baseURL.absoluteString) != nil else {
            throw NSError(domain: "SecondBrainConfiguration", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "Set SECOND_BRAIN_SERVER_URL to your Worker HTTPS origin when building the app."
            ])
        }
        if configuration.clientID == nil {
            configuration.clientID = try await registerPublicClient(baseURL: configuration.baseURL)
            try await api.updateConfiguration(configuration)
        }
        guard let clientID = configuration.clientID else { throw SecondBrainError.invalidResponse }

        let verifier = PKCE.verifier()
        let callback = ReplicaConfiguration.callbackURL
        var components = URLComponents(url: configuration.baseURL.appending(path: "authorize"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "client_id", value: clientID),
            URLQueryItem(name: "redirect_uri", value: callback),
            URLQueryItem(name: "scope", value: "brain.read brain.write"),
            URLQueryItem(name: "code_challenge", value: PKCE.challenge(for: verifier)),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
        ]
        let callbackURL = try await authorize(url: components.url!)
        guard let code = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false)?
            .queryItems?.first(where: { $0.name == "code" })?.value else {
            throw SecondBrainError.invalidResponse
        }
        let tokenResponse = try await exchangeCode(
            baseURL: configuration.baseURL,
            clientID: clientID,
            callback: callback,
            code: code,
            verifier: verifier
        )
        try await api.setTokens(tokenResponse)
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        NSApp.keyWindow ?? NSApp.windows.first ?? ASPresentationAnchor()
    }

    private func authorize(url: URL) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: ReplicaConfiguration.callbackScheme) { url, error in
                if let url { continuation.resume(returning: url) }
                else { continuation.resume(throwing: error ?? SecondBrainError.invalidResponse) }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = true
            presentationSession = session
            session.start()
        }
    }

    private func registerPublicClient(baseURL: URL) async throws -> String {
        var request = URLRequest(url: baseURL.appending(path: "register"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "client_name": "Second Brain Siri",
            "redirect_uris": [ReplicaConfiguration.callbackURL],
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none",
        ])
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
              let clientID = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let id = clientID["client_id"] as? String else {
            throw SecondBrainError.server("Could not register the native OAuth client.")
        }
        return id
    }

    private func exchangeCode(
        baseURL: URL, clientID: String, callback: String, code: String, verifier: String
    ) async throws -> OAuthTokens {
        var request = URLRequest(url: baseURL.appending(path: "token"))
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = [
            "grant_type": "authorization_code",
            "client_id": clientID,
            "redirect_uri": callback,
            "code": code,
            "code_verifier": verifier,
        ].map { "\($0.key.urlQueryEncoded)=\($0.value.urlQueryEncoded)" }
            .joined(separator: "&").data(using: .utf8)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw SecondBrainError.server("OAuth token exchange failed.")
        }
        let raw = try JSONDecoder().decode(TokenResponse.self, from: data)
        return OAuthTokens(
            accessToken: raw.accessToken,
            refreshToken: raw.refreshToken,
            expiresAt: raw.expiresIn.map { Date().addingTimeInterval(TimeInterval($0)) }
        )
    }
}

private struct TokenResponse: Decodable {
    let accessToken: String
    let refreshToken: String?
    let expiresIn: Int?

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token", refreshToken = "refresh_token", expiresIn = "expires_in"
    }
}

enum PKCE {
    static func verifier() -> String {
        var bytes = [UInt8](repeating: 0, count: 48)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return Data(bytes).base64URLEncodedString()
    }

    static func challenge(for verifier: String) -> String {
        Data(SHA256.hash(data: Data(verifier.utf8))).base64URLEncodedString()
    }
}

private extension Data {
    func base64URLEncodedString() -> String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

private extension String {
    var urlQueryEncoded: String {
        var allowed = CharacterSet.urlQueryAllowed
        allowed.remove(charactersIn: "&=+")
        return addingPercentEncoding(withAllowedCharacters: allowed) ?? self
    }
}
