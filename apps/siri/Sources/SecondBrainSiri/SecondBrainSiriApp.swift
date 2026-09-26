import SwiftUI

@main
struct SecondBrainSiriApp: App {
    @StateObject private var store = BrainStore()

    var body: some Scene {
        WindowGroup("Second Brain") {
            ContentView()
                .environmentObject(store)
                .task { await IntentPageCache.shared.replace(with: store.pages) }
                .onChange(of: store.pages) { _, pages in
                    Task { await IntentPageCache.shared.replace(with: pages) }
                }
        }
        Settings {
            SettingsView()
                .environmentObject(store)
        }
    }
}

struct ContentView: View {
    @EnvironmentObject private var store: BrainStore
    @State private var query = ""
    @State private var answer: AnswerWithSources?
    @State private var captureText = ""
    @State private var showPrivacyNotice = false

    var body: some View {
        NavigationSplitView {
            List(store.pages.filter { !$0.archived }) { page in
                VStack(alignment: .leading) {
                    Text(page.title ?? page.fileKey).font(.headline)
                    Text(page.fileKey).font(.caption).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Second Brain")
        } detail: {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    TextField("Ask Second Brain", text: $query)
                        .onSubmit { ask() }
                    Button("Ask", action: ask).disabled(query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    if store.isConnected {
                        Button("Sync") { Task { await store.sync() } }
                            .disabled(store.isSyncing)
                    } else {
                        Button("Sign in with GitHub") { Task { await store.signIn() } }
                    }
                }
                if let answer {
                    GroupBox("Answer") {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(answer.text)
                            Text(answer.usedOnDeviceModel ? "On-device summary" : "Verbatim excerpts — on-device model unavailable")
                                .font(.caption).foregroundStyle(.secondary)
                            ForEach(Array(answer.sources.enumerated()), id: \.element.id) { index, source in
                                Text("[\(index + 1)] \(source.title ?? source.fileKey)")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                } else {
                    Text("Searches return sources first; the concise answer is generated only by the on-device system model.")
                        .foregroundStyle(.secondary)
                }
                Divider()
                Text("Quick capture").font(.headline)
                TextEditor(text: $captureText).frame(minHeight: 120)
                Button("Save immutable voice-style capture") {
                    let text = captureText
                    captureText = ""
                    Task { try? await store.capture(title: nil, content: text) }
                }.disabled(captureText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !store.isConnected)
                if let error = store.errorMessage { Text(error).foregroundStyle(.red) }
                Spacer()
            }
            .padding()
            .navigationTitle("Ask and capture")
        }
        .task {
            guard store.isConnected else { return }
            if UserDefaults.standard.bool(forKey: "second-brain.siri.local-copy-approved") {
                await store.sync()
            } else {
                showPrivacyNotice = true
            }
        }
        .sheet(isPresented: $showPrivacyNotice) {
            PrivacyConsentView { Task { await store.initialSyncAfterPrivacyConsent() } }
        }
    }

    private func ask() {
        let question = query
        Task {
            do {
                let results = try await store.api.search(query: question)
                answer = await SummaryEngine.answer(question: question, sources: results.results)
            } catch {
                store.errorMessage = error.localizedDescription
            }
        }
    }
}

struct PrivacyConsentView: View {
    @Environment(\.dismiss) private var dismiss
    let accept: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Local vault copy").font(.title2).bold()
            Text("To make Siri and Spotlight useful, Second Brain copies the full text of every active vault page into this Mac’s local SwiftData cache and Core Spotlight index. Archived pages remain in the app archive but are removed from Spotlight. FileVault is strongly recommended.")
            HStack {
                Button("Not now", role: .cancel) { dismiss() }
                Button("Copy and index active pages") { accept(); dismiss() }.keyboardShortcut(.defaultAction)
            }
        }
        .padding()
        .frame(width: 520)
    }
}

struct SettingsView: View {
    @EnvironmentObject private var store: BrainStore

    var body: some View {
        Form {
            Section("Account") {
                if store.isConnected {
                    Text("Connected to Second Brain")
                    Button("Disconnect and erase local data", role: .destructive) {
                        Task { await store.disconnectAndErase() }
                    }
                } else {
                    Button("Sign in with GitHub") { Task { await store.signIn() } }
                }
            }
            Section("Privacy") {
                Text("Disconnect revokes the local OAuth token, clears Keychain items, SwiftData cache, and all Second Brain Core Spotlight entries.")
            }
        }
        .padding()
        .frame(width: 500)
    }
}
