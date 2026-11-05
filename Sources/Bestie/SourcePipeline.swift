import AVFoundation

/// One audio source (mic or system): writes it to a local .m4a and streams it to Scribe.
/// `process` is called from that source's capture thread only.
final class SourcePipeline {
    let fileURL: URL
    private let scribe: ScribeRealtimeClient
    private let recordingConverter = AudioConverter(outputFormat: .recordingPCM)
    private let scribeConverter = AudioConverter(outputFormat: .scribePCM)
    private var file: AVAudioFile?
    private let lock = NSLock()
    private(set) var firstBufferDate: Date?

    init(fileURL: URL, scribe: ScribeRealtimeClient) {
        self.fileURL = fileURL
        self.scribe = scribe
    }

    func process(_ buffer: AVAudioPCMBuffer) {
        lock.lock()
        defer { lock.unlock() }

        if let recording = recordingConverter.convert(buffer) {
            if file == nil {
                firstBufferDate = Date()
                file = try? AVAudioFile(
                    forWriting: fileURL,
                    settings: [
                        AVFormatIDKey: kAudioFormatMPEG4AAC,
                        AVSampleRateKey: recording.format.sampleRate,
                        AVNumberOfChannelsKey: 1,
                        AVEncoderBitRateKey: 96_000,
                    ],
                    commonFormat: .pcmFormatFloat32,
                    interleaved: false
                )
            }
            try? file?.write(from: recording)
        }

        if let pcm = scribeConverter.convert(buffer)?.int16Data {
            scribe.append(pcm)
        }
    }

    /// Closes the file (AVAudioFile finalizes on release). Returns true if anything was recorded.
    func closeFile() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        let recorded = file != nil
        file = nil
        return recorded
    }
}
