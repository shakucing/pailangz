import Foundation
import AVFoundation
import AppKit

struct Scene: Decodable { let image: String; let duration: Double }
struct Manifest: Decodable { let scenes: [Scene]; let output: String; let audio: String }

@main
struct RenderVideo {
  static func main() async throws {
    let manifest = try JSONDecoder().decode(Manifest.self, from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])))
    let output = URL(fileURLWithPath: manifest.output)
    let silent = output.deletingPathExtension().appendingPathExtension("silent.mp4")
    try? FileManager.default.removeItem(at: silent)
    try? FileManager.default.removeItem(at: output)
    let width = 1920, height = 1080, fps = 10
    let writer = try AVAssetWriter(url: silent, fileType: .mp4)
    let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
      AVVideoCodecKey: AVVideoCodecType.h264,
      AVVideoWidthKey: width,
      AVVideoHeightKey: height,
      AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 1_200_000, AVVideoMaxKeyFrameIntervalKey: 30]
    ])
    input.expectsMediaDataInRealTime = false
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
      kCVPixelBufferWidthKey as String: width,
      kCVPixelBufferHeightKey as String: height,
      kCVPixelBufferCGImageCompatibilityKey as String: true,
      kCVPixelBufferCGBitmapContextCompatibilityKey as String: true
    ])
    writer.add(input)
    guard writer.startWriting() else { throw writer.error! }
    writer.startSession(atSourceTime: .zero)
    var frame = 0
    for scene in manifest.scenes {
      guard let image = NSImage(contentsOfFile: scene.image)?.cgImage(forProposedRect: nil, context: nil, hints: nil) else { throw NSError(domain: "Tutorial", code: 1) }
      var maybeBuffer: CVPixelBuffer?
      CVPixelBufferPoolCreatePixelBuffer(nil, adaptor.pixelBufferPool!, &maybeBuffer)
      let buffer = maybeBuffer!
      CVPixelBufferLockBaseAddress(buffer, [])
      let context = CGContext(data: CVPixelBufferGetBaseAddress(buffer), width: width, height: height, bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(buffer), space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue)!
      context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
      CVPixelBufferUnlockBaseAddress(buffer, [])
      let count = max(1, Int((scene.duration * Double(fps)).rounded()))
      for _ in 0..<count {
        while !input.isReadyForMoreMediaData {
          if writer.status == .failed { throw writer.error! }
          try await Task.sleep(for: .milliseconds(5))
        }
        guard adaptor.append(buffer, withPresentationTime: CMTime(value: Int64(frame), timescale: Int32(fps))) else { throw writer.error! }
        frame += 1
      }
    }
    input.markAsFinished()
    await writer.finishWriting()
    if let error = writer.error { throw error }
    let composition = AVMutableComposition()
    let video = AVURLAsset(url: silent)
    let sound = AVURLAsset(url: URL(fileURLWithPath: manifest.audio))
    let videoTrack = try await video.loadTracks(withMediaType: .video).first!
    let audioTrack = try await sound.loadTracks(withMediaType: .audio).first!
    let audioDuration = try await sound.load(.duration)
    let videoDuration = try await video.load(.duration)
    let v = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)!
    try v.insertTimeRange(CMTimeRange(start: .zero, duration: videoDuration), of: videoTrack, at: .zero)
    let a = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)!
    try a.insertTimeRange(CMTimeRange(start: .zero, duration: audioDuration), of: audioTrack, at: .zero)
    let exporter = AVAssetExportSession(asset: composition, presetName: AVAssetExportPreset1920x1080)!
    exporter.shouldOptimizeForNetworkUse = true
    try await exporter.export(to: output, as: .mp4)
    try FileManager.default.removeItem(at: silent)
    print("Rendered \(output.lastPathComponent): \(String(format: "%.1f", audioDuration.seconds)) seconds, 1920x1080, H.264 video and narration")
  }
}
