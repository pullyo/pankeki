import Foundation
import Vision
import CoreImage
import ImageIO

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

let data = FileHandle.standardInput.readData(ofLength: 20 * 1024 * 1024 + 1)
guard data.count > 8, data.count <= 20 * 1024 * 1024,
      data.prefix(8) == Data([137,80,78,71,13,10,26,10]),
      let source = CGImageSourceCreateWithData(data as CFData, nil),
      CGImageSourceGetCount(source) == 1,
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
      image.width * image.height <= 16_777_216 else { fail("Invalid bounded PNG input") }

if #available(macOS 14.0, *) {
    do {
        let handler = VNImageRequestHandler(cgImage: image, options: [:])
        let request = VNGenerateForegroundInstanceMaskRequest()
        try handler.perform([request])
        guard let result = request.results?.first, !result.allInstances.isEmpty else {
            fail("No foreground instances detected")
        }
        let mask = try result.generateScaledMaskForImage(forInstances: result.allInstances, from: handler)
        guard CVPixelBufferGetWidth(mask) == image.width, CVPixelBufferGetHeight(mask) == image.height else {
            fail("Foreground dimensions differ")
        }
        let context = CIContext(options: [.useSoftwareRenderer: true])
        guard let png = context.pngRepresentation(of: CIImage(cvPixelBuffer: mask), format: .L8,
            colorSpace: CGColorSpaceCreateDeviceGray()), png.count <= 20 * 1024 * 1024 else {
            fail("Could not encode bounded matte")
        }
        FileHandle.standardOutput.write(png)
    } catch {
        fail("Vision foreground detection failed: \(error.localizedDescription)")
    }
} else {
    fail("Foreground removal requires macOS 14 or newer")
}
