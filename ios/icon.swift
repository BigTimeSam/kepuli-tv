// The app's icon: brand/tv-master-1024.png drawn over the player's ground.
//
//   xcrun swift ios/icon.swift <in.png> <out.png>      (ios/build.mjs runs it)
//
// The master has an alpha channel (its corners are clear), and the App
// Store refuses an icon with one. iOS rounds the corners itself, so the
// icon is the full square: the ground colour #0f1320 with the master on
// top, written without alpha.

import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let arguments = CommandLine.arguments
guard arguments.count == 3 else {
    FileHandle.standardError.write(Data("usage: icon.swift <in.png> <out.png>\n".utf8))
    exit(1)
}
guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: arguments[1]) as CFURL, nil),
      let master = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    FileHandle.standardError.write(Data("cannot read \(arguments[1])\n".utf8))
    exit(1)
}

let side = 1024
// noneSkipLast: four bytes a pixel with the fourth ignored, which ImageIO
// writes as an RGB PNG with no alpha channel.
guard let canvas = CGContext(data: nil, width: side, height: side, bitsPerComponent: 8, bytesPerRow: 0,
                             space: CGColorSpace(name: CGColorSpace.sRGB)!,
                             bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { exit(1) }
let square = CGRect(x: 0, y: 0, width: side, height: side)
canvas.setFillColor(red: 0x0f / 255.0, green: 0x13 / 255.0, blue: 0x20 / 255.0, alpha: 1)
canvas.fill(square)
canvas.interpolationQuality = .high
canvas.draw(master, in: square)

guard let icon = canvas.makeImage(),
      let destination = CGImageDestinationCreateWithURL(URL(fileURLWithPath: arguments[2]) as CFURL, UTType.png.identifier as CFString, 1, nil) else { exit(1) }
CGImageDestinationAddImage(destination, icon, nil)
guard CGImageDestinationFinalize(destination) else { exit(1) }
