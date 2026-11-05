import AVFoundation
import ScreenCaptureKit

/// Captures everything the Mac plays (Zoom, Meet, Teams…) via ScreenCaptureKit, excluding this app's own audio.
final class SystemAudioCapture: NSObject, SCStreamOutput, SCStreamDelegate {
    enum CaptureError: LocalizedError {
        case noDisplay
        var errorDescription: String? { "Nie znaleziono ekranu do przechwycenia dźwięku systemu." }
    }

    private var stream: SCStream?
    private let audioQueue = DispatchQueue(label: "bestie.system-audio")
    private let videoQueue = DispatchQueue(label: "bestie.system-video")
    var onBuffer: ((AVAudioPCMBuffer) -> Void)?
    var onError: ((Error) -> Void)?

    func start() async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = content.displays.first else { throw CaptureError.noDisplay }

        let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.excludesCurrentProcessAudio = true
        config.sampleRate = 48_000
        config.channelCount = 2
        // We only want audio; keep the video side as cheap as possible.
        config.width = 2
        config.height = 2
        config.minimumFrameInterval = CMTime(value: 1, timescale: 1)

        let stream = SCStream(filter: filter, configuration: config, delegate: self)
        try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: audioQueue)
        // Without a screen output SCStream logs a dropped-frame error for every video frame.
        try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: videoQueue)
        try await stream.startCapture()
        self.stream = stream
    }

    func stop() async {
        try? await stream?.stopCapture()
        stream = nil
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, sampleBuffer.isValid,
              let description = sampleBuffer.formatDescription
        else { return }
        let format = AVAudioFormat(cmAudioFormatDescription: description)

        try? sampleBuffer.withAudioBufferList { audioBufferList, _ in
            guard let buffer = AVAudioPCMBuffer(pcmFormat: format, bufferListNoCopy: audioBufferList.unsafePointer) else { return }
            onBuffer?(buffer)
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        onError?(error)
    }
}
