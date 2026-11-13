// A PNG written again without its alpha channel, pixel for pixel.
//
//   xcrun swiftc -O -o <tool> ios/flatten.swift     (ios/sim.mjs compiles it on first use)
//   <tool> <file.png>
//
// A simulator's screenshot is RGBA, every pixel opaque, and the App Store
// takes no screenshot with an alpha channel: `ios/release.mjs status`
// turned away every picture taken the documented way. Drawn into a bitmap
// that has no alpha and written by ImageIO, the file is an RGB PNG of the
// same size and the same colours (measured on a 1206 × 2622 screenshot:
// no colour byte differs; a round trip by JPEG changed a quarter of them).

import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let arguments = CommandLine.arguments
guard arguments.count == 2 else {
    FileHandle.standardError.write(Data("usage: flatten <file.png>\n".utf8))
    exit(1)
}
let file = URL(fileURLWithPath: arguments[1]) as CFURL
guard let source = CGImageSourceCreateWithURL(file, nil), let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
      // noneSkipLast: four bytes a pixel with the fourth ignored, which
      // ImageIO writes as an RGB PNG (ios/icon.swift does the same).
      let canvas = CGContext(data: nil, width: image.width, height: image.height, bitsPerComponent: 8, bytesPerRow: 0,
                             space: image.colorSpace ?? CGColorSpace(name: CGColorSpace.sRGB)!,
                             bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else {
    FileHandle.standardError.write(Data("cannot read \(arguments[1])\n".utf8))
    exit(1)
}
canvas.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
guard let flat = canvas.makeImage(),
      let destination = CGImageDestinationCreateWithURL(file, UTType.png.identifier as CFString, 1, nil) else { exit(1) }
CGImageDestinationAddImage(destination, flat, nil)
exit(CGImageDestinationFinalize(destination) ? 0 : 1)
