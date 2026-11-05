import AVFoundation

/// Converts arbitrary PCM buffers (any rate / channel count) into a fixed output format.
final class AudioConverter {
    let outputFormat: AVAudioFormat
    private var converter: AVAudioConverter?
    private var inputFormat: AVAudioFormat?

    init(outputFormat: AVAudioFormat) {
        self.outputFormat = outputFormat
    }

    func convert(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        if converter == nil || inputFormat != buffer.format {
            converter = AVAudioConverter(from: buffer.format, to: outputFormat)
            converter?.downmix = true
            inputFormat = buffer.format
        }
        guard let converter, buffer.frameLength > 0 else { return nil }

        let ratio = outputFormat.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount((Double(buffer.frameLength) * ratio).rounded(.up)) + 64
        guard let output = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: capacity) else { return nil }

        var consumed = false
        var error: NSError?
        converter.convert(to: output, error: &error) { _, status in
            if consumed {
                status.pointee = .noDataNow
                return nil
            }
            consumed = true
            status.pointee = .haveData
            return buffer
        }
        guard error == nil, output.frameLength > 0 else { return nil }
        return output
    }
}

extension AVAudioFormat {
    /// 16 kHz mono signed 16-bit little-endian PCM — what Scribe realtime expects as `pcm_16000`.
    static let scribePCM = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16_000, channels: 1, interleaved: true)!
    /// Mono float format used for writing the local recording.
    static let recordingPCM = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48_000, channels: 1, interleaved: false)!
}

extension AVAudioPCMBuffer {
    var int16Data: Data? {
        guard let channel = int16ChannelData?[0] else { return nil }
        return Data(bytes: channel, count: Int(frameLength) * MemoryLayout<Int16>.size)
    }
}
