import AppKit
import AVFoundation
import Combine

enum Speaker: String, CaseIterable {
    case me = "Ja"
    case others = "Rozmówcy"
}

struct Segment: Identifiable {
    let id = UUID()
    let speaker: Speaker
    let offset: TimeInterval
    let text: String
}

enum TranscriptionLanguage: String, CaseIterable, Identifiable {
    case auto, pl, en
    var id: String { rawValue }
    var label: String {
        switch self {
        case .auto: "Auto"
        case .pl: "Polski"
        case .en: "English"
        }
    }
    var code: String? { self == .auto ? nil : rawValue }
}

@MainActor
final class RecorderModel: ObservableObject {
    enum State { case idle, starting, recording, stopping }

    @Published private(set) var state: State = .idle
    @Published private(set) var segments: [Segment] = []
    @Published private(set) var partials: [Speaker: String] = [:]
    @Published private(set) var elapsed: TimeInterval = 0
    @Published private(set) var status: String?
    @Published private(set) var lastFolder: URL?
    @Published var language: TranscriptionLanguage {
        didSet { UserDefaults.standard.set(language.rawValue, forKey: "language") }
    }
    @Published var apiKey: String {
        didSet { Keychain.save(apiKey, for: "elevenlabs-api-key") }
    }

    private var mic: MicrophoneCapture?
    private var system: SystemAudioCapture?
    private var pipelines: [Speaker: SourcePipeline] = [:]
    private var clients: [Speaker: ScribeRealtimeClient] = [:]
    private var startDate: Date?
    private var timer: Timer?
    private var folder: URL?
    private var transcriptHandle: FileHandle?

    init() {
        apiKey = ProcessInfo.processInfo.environment["ELEVENLABS_API_KEY"]
            ?? Keychain.read("elevenlabs-api-key") ?? ""
        language = TranscriptionLanguage(rawValue: UserDefaults.standard.string(forKey: "language") ?? "") ?? .auto
    }

    static let recordingsRoot = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("Bestie", isDirectory: true)

    // MARK: - Start / stop

    func toggle() {
        switch state {
        case .idle: Task { await start() }
        case .recording: Task { await stop() }
        default: break
        }
    }

    private func start() async {
        guard !apiKey.trimmingCharacters(in: .whitespaces).isEmpty else {
            status = "Wklej klucz API ElevenLabs w Ustawieniach (⌘,)."
            return
        }
        state = .starting
        status = nil

        guard await MicrophoneCapture.requestPermission() else {
            fail("Brak dostępu do mikrofonu — włącz go w Ustawieniach systemowych → Prywatność → Mikrofon.")
            return
        }

        let folder: URL
        do {
            folder = try makeSessionFolder()
        } catch {
            fail("Nie mogę utworzyć folderu nagrania: \(error.localizedDescription)")
            return
        }
        self.folder = folder
        segments = []
        partials = [:]

        let apiKey = self.apiKey.trimmingCharacters(in: .whitespaces)
        for speaker in Speaker.allCases {
            let client = ScribeRealtimeClient(apiKey: apiKey, languageCode: language.code)
            client.onEvent = { [weak self] event in
                Task { @MainActor in self?.handle(event, from: speaker) }
            }
            client.connect()
            clients[speaker] = client
            let name = speaker == .me ? "mikrofon.m4a" : "system.m4a"
            pipelines[speaker] = SourcePipeline(fileURL: folder.appendingPathComponent(name), scribe: client)
        }

        startDate = Date()

        let mic = MicrophoneCapture()
        let micPipeline = pipelines[.me]!
        mic.onBuffer = { micPipeline.process($0) }
        do {
            try mic.start()
        } catch {
            await teardown()
            fail("Nie udało się uruchomić mikrofonu: \(error.localizedDescription)")
            return
        }
        self.mic = mic

        let system = SystemAudioCapture()
        let systemPipeline = pipelines[.others]!
        system.onBuffer = { systemPipeline.process($0) }
        system.onError = { [weak self] error in
            Task { @MainActor in self?.status = "Przechwytywanie dźwięku systemu przerwane: \(error.localizedDescription)" }
        }
        do {
            try await system.start()
            self.system = system
        } catch {
            // Keep going with the mic only — the most common cause is the missing Screen Recording permission.
            status = "Nagrywam tylko mikrofon. Dźwięk systemu wymaga uprawnienia „Nagrywanie ekranu i dźwięku systemowego” (\(error.localizedDescription))."
        }

        state = .recording
        elapsed = 0
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, let startDate = self.startDate else { return }
                self.elapsed = Date().timeIntervalSince(startDate)
            }
        }
    }

    private func stop() async {
        state = .stopping
        status = "Kończę transkrypcję…"
        await teardown()

        // Anything still pending as a partial would otherwise be lost.
        for (speaker, text) in partials where !text.trimmingCharacters(in: .whitespaces).isEmpty {
            appendSegment(Segment(speaker: speaker, offset: elapsed, text: text))
        }
        partials = [:]

        if let folder {
            status = "Miksuję nagranie…"
            await mixdown(in: folder)
            lastFolder = folder
            status = "Zapisano w \(folder.path(percentEncoded: false))"
        }
        try? transcriptHandle?.close()
        transcriptHandle = nil
        state = .idle
    }

    private func teardown() async {
        timer?.invalidate()
        timer = nil
        mic?.stop()
        mic = nil
        await system?.stop()
        system = nil
        await withTaskGroup(of: Void.self) { group in
            for client in clients.values {
                group.addTask { await client.finish() }
            }
        }
        clients = [:]
    }

    private func fail(_ message: String) {
        status = message
        state = .idle
    }

    // MARK: - Transcript

    private func handle(_ event: ScribeRealtimeClient.Event, from speaker: Speaker) {
        switch event {
        case .partial(let text):
            partials[speaker] = text
        case .committed(let text):
            partials[speaker] = nil
            let offset = startDate.map { Date().timeIntervalSince($0) } ?? 0
            appendSegment(Segment(speaker: speaker, offset: offset, text: text))
        case .error(let message):
            status = message
        }
    }

    private func appendSegment(_ segment: Segment) {
        segments.append(segment)
        let line = "**[\(Self.format(segment.offset))] \(segment.speaker.rawValue):** \(segment.text)\n\n"
        transcriptHandle?.write(Data(line.utf8))
    }

    static func format(_ interval: TimeInterval) -> String {
        let total = Int(interval)
        return String(format: "%02d:%02d:%02d", total / 3600, (total / 60) % 60, total % 60)
    }

    // MARK: - Files

    private func makeSessionFolder() throws -> URL {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH-mm-ss"
        let folder = Self.recordingsRoot.appendingPathComponent(formatter.string(from: Date()), isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)

        let transcriptURL = folder.appendingPathComponent("transkrypcja.md")
        let header = "# Spotkanie \(formatter.string(from: Date()))\n\n"
        try header.write(to: transcriptURL, atomically: true, encoding: .utf8)
        transcriptHandle = try FileHandle(forWritingTo: transcriptURL)
        transcriptHandle?.seekToEndOfFile()
        return folder
    }

    /// Combines mic and system tracks into a single `spotkanie.m4a`, aligned by when each started.
    private func mixdown(in folder: URL) async {
        guard let startDate else { return }
        let sources = pipelines.values.compactMap { pipeline -> (URL, TimeInterval)? in
            guard pipeline.closeFile(), let first = pipeline.firstBufferDate else { return nil }
            return (pipeline.fileURL, max(0, first.timeIntervalSince(startDate)))
        }
        pipelines = [:]
        guard !sources.isEmpty else { return }

        let composition = AVMutableComposition()
        for (url, offset) in sources {
            let asset = AVURLAsset(url: url)
            guard let sourceTrack = try? await asset.loadTracks(withMediaType: .audio).first,
                  let duration = try? await asset.load(.duration),
                  let track = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)
            else { continue }
            try? track.insertTimeRange(
                CMTimeRange(start: .zero, duration: duration),
                of: sourceTrack,
                at: CMTime(seconds: offset, preferredTimescale: 48_000)
            )
        }

        guard let export = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetAppleM4A) else { return }
        do {
            try await export.export(to: folder.appendingPathComponent("spotkanie.m4a"), as: .m4a)
        } catch {
            status = "Nie udało się zmiksować nagrania: \(error.localizedDescription)"
        }
    }

    func revealLastFolder() {
        let url = lastFolder ?? Self.recordingsRoot
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        NSWorkspace.shared.activateFileViewerSelecting([url])
    }
}
