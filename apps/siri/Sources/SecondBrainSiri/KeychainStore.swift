import Foundation
import Security

enum KeychainStore {
    private static let service = ReplicaConfiguration.storageNamespace
    private static let tokensAccount = "oauth-tokens"
    private static let configurationAccount = "server-configuration"

    static func saveTokens(_ tokens: OAuthTokens) throws {
        try save(try JSONEncoder().encode(tokens), account: tokensAccount)
    }

    static func loadTokens() throws -> OAuthTokens? {
        guard let data = try load(account: tokensAccount) else { return nil }
        return try JSONDecoder().decode(OAuthTokens.self, from: data)
    }

    static func saveConfiguration(_ configuration: ServerConfiguration) throws {
        try save(try JSONEncoder().encode(configuration), account: configurationAccount)
    }

    static func loadConfiguration() throws -> ServerConfiguration? {
        guard let data = try load(account: configurationAccount) else { return nil }
        return try JSONDecoder().decode(ServerConfiguration.self, from: data)
    }

    static func removeAll() throws {
        for account in [tokensAccount, configurationAccount] {
            let query: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecAttrAccount as String: account,
            ]
            let status = SecItemDelete(query as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else {
                throw keychainError(status)
            }
        }
    }

    private static func save(_ data: Data, account: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
        let attributes = query.merging([
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]) { _, new in new }
        let status = SecItemAdd(attributes as CFDictionary, nil)
        guard status == errSecSuccess else { throw keychainError(status) }
    }

    private static func load(account: String) throws -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else {
            throw keychainError(status)
        }
        return data
    }

    private static func keychainError(_ status: OSStatus) -> NSError {
        NSError(domain: NSOSStatusErrorDomain, code: Int(status))
    }
}
