import Foundation

/// WebSocket client for ElevenLabs Scribe v2 Realtime (`/v1/speech-to-text/realtime`).
/// Audio goes in as 16 kHz mono Int16 PCM; VAD on the server decides when a segment is committed.
/// Mutable state is only touched on `queue`.
final class ScribeRealtimeClient: NSObject, @unchecked Sendable {
    enum Event {
        case partial(String)
        case committed(String)
        case error(String)
    }

    private static let endpoint = "wss://api.elevenlabs.io/v1/speech-to-text/realtime"
    private static let modelID = "scribe_v2_realtime"
    /// ~100 ms of audio at 16 kHz Int16.
    private static let chunkBytes = 3_200

    private let apiKey: String
    private let languageCode: String?
    private let queue = DispatchQueue(label: "bestie.scribe")
    private lazy var session = URLSession(configuration: .default)
    private var task: URLSessionWebSocketTask?
    private var pending = Data()
    private var isActive = false

    var onEvent: ((Event) -> Void)?

    init(apiKey: String, languageCode: String?) {
        self.apiKey = apiKey
        self.languageCode = languageCode
    }

    func connect() {
        queue.async {
            self.isActive = true
            self.openSocket()
        }
    }

    func append(_ pcm: Data) {
        queue.async {
            self.pending.append(pcm)
            if self.pending.count >= Self.chunkBytes {
                self.sendChunk(self.pending, commit: false)
                self.pending.removeAll(keepingCapacity: true)
            }
        }
    }

    /// Flushes buffered audio, forces a final commit and gives the server a moment to answer before closing.
    func finish() async {
        await withCheckedContinuation { continuation in
            queue.async {
                self.sendChunk(self.pending, commit: true)
                self.pending.removeAll()
                continuation.resume()
            }
        }
        try? await Task.sleep(for: .seconds(2))
        queue.async {
            self.isActive = false
            self.task?.cancel(with: .normalClosure, reason: nil)
            self.task = nil
        }
    }

    // MARK: - Socket

    private func openSocket() {
        var components = URLComponents(string: Self.endpoint)!
        var items = [
            URLQueryItem(name: "model_id", value: Self.modelID),
            URLQueryItem(name: "audio_format", value: "pcm_16000"),
            URLQueryItem(name: "commit_strategy", value: "vad"),
        ]
        if let languageCode {
            items.append(URLQueryItem(name: "language_code", value: languageCode))
        }
        components.queryItems = items

        var request = URLRequest(url: components.url!)
        request.setValue(apiKey, forHTTPHeaderField: "xi-api-key")

        let task = session.webSocketTask(with: request)
        self.task = task
        task.resume()
        receive(on: task)
    }

    private func sendChunk(_ pcm: Data, commit: Bool) {
        guard let task else { return }
        let message: [String: Any] = [
            "message_type": "input_audio_chunk",
            "audio_base_64": pcm.base64EncodedString(),
            "commit": commit,
            "sample_rate": 16_000,
        ]
        guard let json = try? JSONSerialization.data(withJSONObject: message) else { return }
        task.send(.string(String(decoding: json, as: UTF8.self))) { _ in
            // Send failures surface through receive(), which handles reconnecting.
        }
    }

    private func receive(on task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let message):
                if case .string(let text) = message {
                    self.handle(text)
                }
                self.receive(on: task)
            case .failure(let error):
                self.queue.async { self.handleDisconnect(of: task, error: error) }
            }
        }
    }

    private func handleDisconnect(of failedTask: URLSessionWebSocketTask, error: Error) {
        guard isActive, task === failedTask else { return }
        onEvent?(.error("Połączenie z ElevenLabs zerwane (\(error.localizedDescription)), łączę ponownie…"))
        task = nil
        queue.asyncAfter(deadline: .now() + 1) {
            guard self.isActive, self.task == nil else { return }
            self.openSocket()
        }
    }

    private func handle(_ text: String) {
        guard let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["message_type"] as? String
        else { return }

        switch type {
        case "session_started":
            break
        case "partial_transcript":
            onEvent?(.partial(json["text"] as? String ?? ""))
        case "committed_transcript", "committed_transcript_with_timestamps":
            let text = (json["text"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if !text.isEmpty { onEvent?(.committed(text)) }
        case "insufficient_audio_activity":
            break
        default:
            let detail = json["error"] as? String ?? json["message"] as? String ?? text
            onEvent?(.error("\(type): \(detail)"))
        }
    }
}
