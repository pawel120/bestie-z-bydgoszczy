import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var model: RecorderModel

    var body: some View {
        VStack(spacing: 0) {
            toolbar
            Divider()
            transcript
            if let status = model.status {
                Divider()
                Text(status)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .textSelection(.enabled)
            }
        }
        .frame(minWidth: 520, minHeight: 420)
    }

    private var toolbar: some View {
        HStack(spacing: 12) {
            Button(action: model.toggle) {
                HStack(spacing: 8) {
                    Image(systemName: isRecording ? "stop.circle.fill" : "record.circle")
                        .foregroundStyle(.red)
                        .font(.title2)
                    Text(buttonTitle)
                }
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
            .keyboardShortcut("r", modifiers: .command)
            .disabled(model.state == .starting || model.state == .stopping)

            Text(RecorderModel.format(model.elapsed))
                .font(.system(.title3, design: .monospaced))
                .foregroundStyle(isRecording ? .primary : .secondary)

            Spacer()

            Picker("Język", selection: $model.language) {
                ForEach(TranscriptionLanguage.allCases) { Text($0.label).tag($0) }
            }
            .fixedSize()
            .disabled(model.state != .idle)

            Button {
                model.revealLastFolder()
            } label: {
                Image(systemName: "folder")
            }
            .help("Pokaż nagrania w Finderze")
        }
        .padding(16)
    }

    private var transcript: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    if model.segments.isEmpty && model.partials.isEmpty {
                        Text(isRecording ? "Słucham…" : "Naciśnij Nagrywaj (⌘R), aby rozpocząć.")
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .center)
                            .padding(.top, 40)
                    }
                    ForEach(model.segments) { segment in
                        SegmentRow(speaker: segment.speaker, time: segment.offset, text: segment.text, isPartial: false)
                    }
                    ForEach(Speaker.allCases, id: \.self) { speaker in
                        if let text = model.partials[speaker], !text.isEmpty {
                            SegmentRow(speaker: speaker, time: model.elapsed, text: text, isPartial: true)
                        }
                    }
                    Color.clear.frame(height: 1).id("bottom")
                }
                .padding(16)
            }
            .onChange(of: model.segments.count) { proxy.scrollTo("bottom") }
            .onChange(of: model.partials) { proxy.scrollTo("bottom") }
        }
    }

    private var isRecording: Bool { model.state == .recording }

    private var buttonTitle: String {
        switch model.state {
        case .idle: "Nagrywaj"
        case .starting: "Uruchamiam…"
        case .recording: "Zatrzymaj"
        case .stopping: "Zapisuję…"
        }
    }
}

private struct SegmentRow: View {
    let speaker: Speaker
    let time: TimeInterval
    let text: String
    let isPartial: Bool

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(RecorderModel.format(time))
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(.tertiary)
            Text(speaker.rawValue)
                .font(.callout.weight(.semibold))
                .foregroundStyle(speaker == .me ? Color.blue : Color.orange)
                .frame(width: 72, alignment: .leading)
            Text(text)
                .foregroundStyle(isPartial ? .secondary : .primary)
                .italic(isPartial)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

struct SettingsView: View {
    @EnvironmentObject private var model: RecorderModel

    var body: some View {
        Form {
            SecureField("Klucz API ElevenLabs", text: $model.apiKey)
            Text("Klucz jest zapisywany w pęku kluczy macOS. Zmienna środowiskowa ELEVENLABS_API_KEY ma pierwszeństwo.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(20)
        .frame(width: 440)
    }
}
