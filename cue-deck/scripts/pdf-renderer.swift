import AppKit
import Foundation
import PDFKit

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

let arguments = CommandLine.arguments
guard arguments.count >= 3 else {
    fail("Usage: cue-deck-pdf-renderer input.pdf output-directory [scale]")
}

let inputURL = URL(fileURLWithPath: arguments[1])
let outputURL = URL(fileURLWithPath: arguments[2], isDirectory: true)
let scale = max(Double(arguments.dropFirst(3).first ?? "1.5") ?? 1.5, 0.5)

guard let document = PDFDocument(url: inputURL) else {
    fail("Unable to open PDF")
}

do {
    try FileManager.default.createDirectory(at: outputURL, withIntermediateDirectories: true)
    for index in 0..<document.pageCount {
        guard let page = document.page(at: index) else { continue }
        let bounds = page.bounds(for: .mediaBox)
        let width = max(Int(ceil(bounds.width * scale)), 1)
        let height = max(Int(ceil(bounds.height * scale)), 1)
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        guard let context = CGContext(
            data: nil,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: width * 4,
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else {
            fail("Unable to create PDF render context")
        }

        context.setFillColor(NSColor.white.cgColor)
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        context.saveGState()
        context.scaleBy(x: scale, y: scale)
        page.draw(with: .mediaBox, to: context)
        context.restoreGState()

        guard let image = context.makeImage() else {
            fail("Unable to create PDF page image")
        }
        let bitmap = NSBitmapImageRep(cgImage: image)
        guard let data = bitmap.representation(using: .png, properties: [:]) else {
            fail("Unable to encode PDF page image")
        }
        let pageURL = outputURL.appendingPathComponent("slide-\(index + 1).png")
        try data.write(to: pageURL, options: .atomic)
    }

    let countURL = outputURL.appendingPathComponent("page-count.txt")
    try Data(String(document.pageCount).utf8).write(to: countURL, options: .atomic)
} catch {
    fail(error.localizedDescription)
}
